import * as Tone from 'tone';
import { InstrumentType, VoiceFX } from './parser';

interface AppliedSlotConfig {
  gain: number;
  pan: number;
  reverb: number;
  delay: number;
  distortion: number;
  chorus: number;
}

interface VoiceChannelSlot {
  synths: Partial<Record<InstrumentType, Tone.PolySynth | Tone.MembraneSynth | Tone.NoiseSynth>>;
  distortion: Tone.Distortion;
  panner: Tone.Panner;
  channelGain: Tone.Gain;
  chorusSend: Tone.Gain;
  delaySend: Tone.Gain;
  reverbSend: Tone.Gain;
  applied: AppliedSlotConfig;
}

const MAX_VOICE_SLOTS = 8;

export class AudioEngine {
  private initialized = false;
  private limiter!: Tone.Limiter;
  private waveform!: Tone.Waveform;

  private chorusBus!: Tone.Chorus;
  private delayBus!: Tone.PingPongDelay;
  private reverbBus!: Tone.Freeverb;

  private slots: VoiceChannelSlot[] = [];

  public async init(): Promise<void> {
    await Tone.start();
    if (this.initialized) return;

    // Slightly higher lookAhead prevents main-thread UI spikes from causing audio clicks
    Tone.getContext().lookAhead = 0.08;

    this.waveform = new Tone.Waveform(128);
    this.limiter = new Tone.Limiter(-1.5).connect(this.waveform).toDestination();

    this.chorusBus = new Tone.Chorus({
      frequency: 2.2,
      delayTime: 3.5,
      depth: 0.7,
      wet: 1
    })
      .start()
      .connect(this.limiter);

    this.delayBus = new Tone.PingPongDelay({
      delayTime: '8n.',
      feedback: 0.35,
      wet: 1
    }).connect(this.limiter);

    this.reverbBus = new Tone.Freeverb({
      roomSize: 0.82,
      dampening: 2800,
      wet: 1
    }).connect(this.limiter);

    for (let i = 0; i < MAX_VOICE_SLOTS; i++) {
      this.slots.push(this.createEmptyVoiceSlot());
    }

    this.initialized = true;
  }

  private createEmptyVoiceSlot(): VoiceChannelSlot {
    // oversample: 'none' drastically reduces CPU usage across multiple layers
    const distortion = new Tone.Distortion({
      distortion: 0,
      wet: 0,
      oversample: 'none'
    });
    const panner = new Tone.Panner(0);
    const channelGain = new Tone.Gain(0.85);

    const chorusSend = new Tone.Gain(0).connect(this.chorusBus);
    const delaySend = new Tone.Gain(0).connect(this.delayBus);
    const reverbSend = new Tone.Gain(0).connect(this.reverbBus);

    distortion.connect(panner);
    panner.connect(channelGain);
    channelGain.connect(this.limiter);
    channelGain.connect(chorusSend);
    channelGain.connect(delaySend);
    channelGain.connect(reverbSend);

    return {
      synths: {},
      distortion,
      panner,
      channelGain,
      chorusSend,
      delaySend,
      reverbSend,
      applied: {
        gain: 0.85,
        pan: 0,
        reverb: 0,
        delay: 0,
        distortion: 0,
        chorus: 0
      }
    };
  }

  /**
   * Lazily instantiates only the requested instrument synth for a slot,
   * keeping the Web Audio graph compact and fast.
   */
  private getOrCreateSynth(
    slot: VoiceChannelSlot,
    instrument: InstrumentType
  ): Tone.PolySynth | Tone.MembraneSynth | Tone.NoiseSynth {
    const existing = slot.synths[instrument];
    if (existing) return existing;

    let created: Tone.PolySynth | Tone.MembraneSynth | Tone.NoiseSynth;

    switch (instrument) {
      case 'sine': {
        const poly = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.008, decay: 0.2, sustain: 0.2, release: 0.3 }
        }).connect(slot.distortion);
        poly.maxPolyphony = 6;
        poly.volume.value = -6;
        created = poly;
        break;
      }
      case 'triangle': {
        const poly = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.006, decay: 0.18, sustain: 0.2, release: 0.28 }
        }).connect(slot.distortion);
        poly.maxPolyphony = 6;
        poly.volume.value = -5;
        created = poly;
        break;
      }
      case 'sawtooth': {
        const poly = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.005, decay: 0.15, sustain: 0.15, release: 0.2 }
        }).connect(slot.distortion);
        poly.maxPolyphony = 6;
        poly.volume.value = -9;
        created = poly;
        break;
      }
      case 'square': {
        const poly = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'square' },
          envelope: { attack: 0.004, decay: 0.14, sustain: 0.1, release: 0.16 }
        }).connect(slot.distortion);
        poly.maxPolyphony = 6;
        poly.volume.value = -10;
        created = poly;
        break;
      }
      case 'fm': {
        const poly = new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 8,
          envelope: { attack: 0.004, decay: 0.22, sustain: 0.1, release: 0.25 }
        }).connect(slot.distortion);
        poly.maxPolyphony = 6;
        poly.volume.value = -7;
        created = poly;
        break;
      }
      case 'kick': {
        const kick = new Tone.MembraneSynth({
          pitchDecay: 0.04,
          octaves: 6,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.24, sustain: 0.01, release: 0.15 }
        }).connect(slot.distortion);
        kick.volume.value = -2;
        created = kick;
        break;
      }
      case 'snare': {
        const snare = new Tone.NoiseSynth({
          noise: { type: 'pink' },
          envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.05 }
        }).connect(slot.distortion);
        snare.volume.value = -7;
        created = snare;
        break;
      }
      case 'hat': {
        const hat = new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 }
        }).connect(slot.distortion);
        hat.volume.value = -12;
        created = hat;
        break;
      }
    }

    slot.synths[instrument] = created;
    return created;
  }

  /**
   * Updates channel strip parameters ONLY when values have changed (dirty-checking).
   * Avoids expensive WaveShaper curve regeneration and redundant AudioParam events.
   */
  public configureSlot(
    slotIndex: number,
    gain: number,
    pan: number,
    fx: VoiceFX,
    time?: number
  ): void {
    if (!this.initialized) return;

    const slot = this.slots[slotIndex % this.slots.length];
    const app = slot.applied;
    const t = time ?? Tone.now();

    const clampedGain = Math.max(0, Math.min(1.5, gain));
    if (Math.abs(app.gain - clampedGain) > 0.001) {
      slot.channelGain.gain.setValueAtTime(clampedGain, t);
      app.gain = clampedGain;
    }

    const clampedPan = Math.max(-1, Math.min(1, pan));
    if (Math.abs(app.pan - clampedPan) > 0.001) {
      slot.panner.pan.setValueAtTime(clampedPan, t);
      app.pan = clampedPan;
    }

    const distAmt = Math.max(0, Math.min(1, fx.distortion));
    if (Math.abs(app.distortion - distAmt) > 0.005) {
      // Only rebuild WaveShaper curve when distortion amount actually changed!
      slot.distortion.distortion = distAmt * 0.85;
      slot.distortion.wet.setValueAtTime(distAmt > 0 ? Math.min(1, distAmt * 1.1) : 0, t);
      app.distortion = distAmt;
    }

    const chorusAmt = Math.max(0, Math.min(1, fx.chorus));
    if (Math.abs(app.chorus - chorusAmt) > 0.001) {
      slot.chorusSend.gain.setValueAtTime(chorusAmt * 0.75, t);
      app.chorus = chorusAmt;
    }

    const delayAmt = Math.max(0, Math.min(1, fx.delay));
    if (Math.abs(app.delay - delayAmt) > 0.001) {
      slot.delaySend.gain.setValueAtTime(delayAmt * 0.7, t);
      app.delay = delayAmt;
    }

    const reverbAmt = Math.max(0, Math.min(1, fx.reverb));
    if (Math.abs(app.reverb - reverbAmt) > 0.001) {
      slot.reverbSend.gain.setValueAtTime(reverbAmt * 0.85, t);
      app.reverb = reverbAmt;
    }
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

    const idx = slotIndex % this.slots.length;
    const slot = this.slots[idx];

    this.configureSlot(idx, gain, pan, fx, time);
    const synth = this.getOrCreateSynth(slot, instrument);

    const safeDuration = Math.max(0.03, durationSeconds * 0.8);

    if (synth instanceof Tone.PolySynth) {
      synth.triggerAttackRelease(notes, safeDuration, time);
    } else if (synth instanceof Tone.MembraneSynth) {
      synth.triggerAttackRelease(notes[0] || 'C1', safeDuration, time);
    } else if (synth instanceof Tone.NoiseSynth) {
      const noiseDur = instrument === 'snare' ? Math.min(0.13, safeDuration) : Math.min(0.045, safeDuration);
      synth.triggerAttackRelease(noiseDur, time);
    }
  }

  public getWaveformValues(): Float32Array {
    if (!this.initialized) {
      return new Float32Array(128);
    }
    return this.waveform.getValue();
  }

  public releaseAll(): void {
    if (!this.initialized) return;
    for (const slot of this.slots) {
      for (const synth of Object.values(slot.synths)) {
        if (synth instanceof Tone.PolySynth) {
          synth.releaseAll();
        }
      }
    }
  }
}