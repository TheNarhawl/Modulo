import * as Tone from 'tone';
import { InstrumentType, VoiceFX } from './parser';

interface VoiceChannelSlot {
  sine: Tone.PolySynth;
  triangle: Tone.PolySynth;
  saw: Tone.PolySynth;
  square: Tone.PolySynth;
  fm: Tone.PolySynth;
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hat: Tone.NoiseSynth;

  distortion: Tone.Distortion;
  panner: Tone.Panner;
  channelGain: Tone.Gain;

  chorusSend: Tone.Gain;
  delaySend: Tone.Gain;
  reverbSend: Tone.Gain;
}

const MAX_VOICE_SLOTS = 8;

export class AudioEngine {
  private initialized = false;
  private limiter!: Tone.Limiter;
  private waveform!: Tone.Waveform;

  // Shared Stereo Return Effect Buses
  private chorusBus!: Tone.Chorus;
  private delayBus!: Tone.PingPongDelay;
  private reverbBus!: Tone.Freeverb;

  // Independent Voice Channel Strips (0 = primary voice, 1..7 = layers)
  private slots: VoiceChannelSlot[] = [];

  public async init(): Promise<void> {
    await Tone.start();
    if (this.initialized) return;

    this.waveform = new Tone.Waveform(256);
    this.limiter = new Tone.Limiter(-1.5).connect(this.waveform).toDestination();

    // Global FX Return Buses (100% wet, fed by per-voice send gains)
    this.chorusBus = new Tone.Chorus({
      frequency: 2.2,
      delayTime: 3.5,
      depth: 0.75,
      wet: 1
    })
      .start()
      .connect(this.limiter);

    this.delayBus = new Tone.PingPongDelay({
      delayTime: '8n.',
      feedback: 0.38,
      wet: 1
    }).connect(this.limiter);

    this.reverbBus = new Tone.Freeverb({
      roomSize: 0.84,
      dampening: 2800,
      wet: 1
    }).connect(this.limiter);

    for (let i = 0; i < MAX_VOICE_SLOTS; i++) {
      this.slots.push(this.createVoiceSlot());
    }

    this.initialized = true;
  }

  private createVoiceSlot(): VoiceChannelSlot {
    const distortion = new Tone.Distortion({ distortion: 0.0, wet: 0.0 });
    const panner = new Tone.Panner(0);
    const channelGain = new Tone.Gain(0.85);

    const chorusSend = new Tone.Gain(0).connect(this.chorusBus);
    const delaySend = new Tone.Gain(0).connect(this.delayBus);
    const reverbSend = new Tone.Gain(0).connect(this.reverbBus);

    // Signal flow per voice slot:
    // Instrument -> Distortion -> Panner -> ChannelGain -> [Limiter (Dry) + Chorus/Delay/Reverb Sends]
    distortion.connect(panner);
    panner.connect(channelGain);
    channelGain.connect(this.limiter);
    channelGain.connect(chorusSend);
    channelGain.connect(delaySend);
    channelGain.connect(reverbSend);

    const sine = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.008, decay: 0.22, sustain: 0.2, release: 0.4 }
    }).connect(distortion);
    sine.volume.value = -6;

    const triangle = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.006, decay: 0.18, sustain: 0.2, release: 0.35 }
    }).connect(distortion);
    triangle.volume.value = -5;

    const saw = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.005, decay: 0.16, sustain: 0.15, release: 0.22 }
    }).connect(distortion);
    saw.volume.value = -9;

    const square = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'square' },
      envelope: { attack: 0.004, decay: 0.14, sustain: 0.1, release: 0.18 }
    }).connect(distortion);
    square.volume.value = -10;

    const fm = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 8,
      envelope: { attack: 0.004, decay: 0.25, sustain: 0.1, release: 0.35 }
    }).connect(distortion);
    fm.volume.value = -7;

    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.26, sustain: 0.01, release: 0.18 }
    }).connect(distortion);
    kick.volume.value = -2;

    const snare = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.06 }
    }).connect(distortion);
    snare.volume.value = -7;

    const hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 }
    }).connect(distortion);
    hat.volume.value = -12;

    return {
      sine,
      triangle,
      saw,
      square,
      fm,
      kick,
      snare,
      hat,
      distortion,
      panner,
      channelGain,
      chorusSend,
      delaySend,
      reverbSend
    };
  }

  public triggerVoice(
    slotIndex: number,
    instrument: InstrumentType,
    notes: string[],
    durationSeconds: number,
    time: number,
    gain: number,
    pan: number,
    fx: VoiceFX
  ): void {
    if (!this.initialized || notes.length === 0) return;

    const slot = this.slots[slotIndex % this.slots.length];

    // Update channel strip parameters smoothly at scheduled audio time
    slot.channelGain.gain.setValueAtTime(Math.max(0, Math.min(1.5, gain)), time);
    slot.panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), time);

    const distAmt = Math.max(0, Math.min(1, fx.distortion));
    slot.distortion.distortion = distAmt * 0.9;
    slot.distortion.wet.setValueAtTime(distAmt > 0 ? Math.min(1, distAmt * 1.1) : 0, time);

    slot.chorusSend.gain.setValueAtTime(Math.max(0, Math.min(1, fx.chorus)) * 0.75, time);
    slot.delaySend.gain.setValueAtTime(Math.max(0, Math.min(1, fx.delay)) * 0.7, time);
    slot.reverbSend.gain.setValueAtTime(Math.max(0, Math.min(1, fx.reverb)) * 0.85, time);

    const safeDuration = Math.max(0.03, durationSeconds * 0.82);

    switch (instrument) {
      case 'sine':
        slot.sine.triggerAttackRelease(notes, safeDuration, time);
        break;
      case 'triangle':
        slot.triangle.triggerAttackRelease(notes, safeDuration, time);
        break;
      case 'sawtooth':
        slot.saw.triggerAttackRelease(notes, safeDuration, time);
        break;
      case 'square':
        slot.square.triggerAttackRelease(notes, safeDuration, time);
        break;
      case 'fm':
        slot.fm.triggerAttackRelease(notes, safeDuration, time);
        break;
      case 'kick':
        slot.kick.triggerAttackRelease(notes[0] || 'C1', safeDuration, time);
        break;
      case 'snare':
        slot.snare.triggerAttackRelease(Math.min(0.14, safeDuration), time);
        break;
      case 'hat':
        slot.hat.triggerAttackRelease(Math.min(0.05, safeDuration), time);
        break;
    }
  }

  public getWaveformValues(): Float32Array {
    if (!this.initialized) {
      return new Float32Array(256);
    }
    return this.waveform.getValue();
  }

  public releaseAll(): void {
    if (!this.initialized) return;
    for (const slot of this.slots) {
      slot.sine.releaseAll();
      slot.triangle.releaseAll();
      slot.saw.releaseAll();
      slot.square.releaseAll();
      slot.fm.releaseAll();
    }
  }
}