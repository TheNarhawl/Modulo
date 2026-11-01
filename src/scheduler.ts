import * as Tone from 'tone';
import { AudioEngine } from './audio';
import {
  BlockNode,
  InstrumentType,
  PatternExpression,
  ProgramAST,
  VoiceFX,
  generateCellularSteps,
  generateEuclideanMask,
  generateFibonacciSteps,
  generateModuloSteps,
  generatePrimeSteps
} from './parser';

export interface VoiceRuntimeSnapshot {
  instrument: InstrumentType;
  gain: number;
  pan: number;
  fx: VoiceFX;
  stepIndex: number;
  totalSteps: number;
  pattern: (string[] | null)[];
}

export interface ActiveStepSnapshot {
  blockName: string;
  queueIndex: number;
  meterLabel: string;
  stepIndex: number;
  totalSteps: number;
  generation: number;
  tempo: number;
  voices: VoiceRuntimeSnapshot[];
}

export interface SchedulerCallbacks {
  onStep: (snapshot: ActiveStepSnapshot) => void;
  onBlockChange: (blockName: string, queueIndex: number, totalBlocks: number) => void;
  onStop: () => void;
}

interface CompiledVoice {
  instrument: InstrumentType;
  gain: number;
  pan: number;
  fx: VoiceFX;
  steps: (string[] | null)[];
  stepDurationSec: number;
}

export class TransportScheduler {
  private ast: ProgramAST | null = null;
  private queue: string[] = [];
  private currentQueueIdx = 0;
  private currentStepIdx = 0;
  private cellularGeneration = 0;
  private scheduledEventId: number | null = null;
  private isPlaying = false;

  constructor(
    private readonly audio: AudioEngine,
    private readonly callbacks: SchedulerCallbacks
  ) {}

  public get running(): boolean {
    return this.isPlaying;
  }

  public getExpandedQueue(): string[] {
    return this.queue;
  }

  public loadAST(newAst: ProgramAST): void {
    this.ast = newAst;
    this.queue = this.buildExpandedQueue(newAst);

    Tone.Transport.bpm.value = newAst.playback.tempo;
    Tone.Transport.swing = newAst.playback.swing;

    if (this.currentQueueIdx >= this.queue.length) {
      this.currentQueueIdx = 0;
      this.currentStepIdx = 0;
    }
  }

  public async start(ast: ProgramAST): Promise<void> {
    await this.audio.init();
    this.loadAST(ast);

    this.currentQueueIdx = 0;
    this.currentStepIdx = 0;
    this.cellularGeneration = 0;

    if (this.scheduledEventId !== null) {
      Tone.Transport.clear(this.scheduledEventId);
      this.scheduledEventId = null;
    }

    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    this.isPlaying = true;

    if (this.queue.length > 0) {
      this.callbacks.onBlockChange(this.queue[0], 0, this.queue.length);
    }

    this.scheduleNextTick(0);
    Tone.Transport.start('+0.03');
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.scheduledEventId !== null) {
      Tone.Transport.clear(this.scheduledEventId);
      this.scheduledEventId = null;
    }
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    this.audio.releaseAll();
    this.callbacks.onStop();
  }

  private buildExpandedQueue(ast: ProgramAST): string[] {
    const result: string[] = [];
    const globalRepeat = Math.max(1, ast.playback.repeat || 1);

    for (const entry of ast.playback.sequence) {
      const count = entry.repeat * globalRepeat;
      for (let i = 0; i < count; i++) {
        result.push(entry.blockName);
      }
    }
    return result;
  }

  private evaluateExpression(
    expr: PatternExpression,
    measureDurationSec: number,
    quarterNoteSec: number
  ): { steps: (string[] | null)[]; stepDurationSec: number } {
    switch (expr.kind) {
      case 'seq': {
        const stepDurSec =
          expr.dur.numerator * (4 / expr.dur.denominator) * quarterNoteSec;
        const stepsInMeasure = Math.max(1, Math.round(measureDurationSec / stepDurSec));
        const steps: (string[] | null)[] = [];
        for (let i = 0; i < stepsInMeasure; i++) {
          steps.push(expr.notes[i % expr.notes.length]);
        }
        return { steps, stepDurationSec: measureDurationSec / stepsInMeasure };
      }

      case 'euclid': {
        const mask = generateEuclideanMask(expr.pulses, expr.steps, expr.rotation);
        let hitCounter = 0;
        const steps = mask.map((active) => {
          if (!active) return null;
          const chord = expr.notes[hitCounter % expr.notes.length];
          hitCounter++;
          return chord;
        });
        return { steps, stepDurationSec: measureDurationSec / expr.steps };
      }

      case 'modulo': {
        const steps = generateModuloSteps(
          expr.steps,
          expr.modulus,
          expr.offset,
          expr.notes
        );
        return { steps, stepDurationSec: measureDurationSec / expr.steps };
      }

      case 'fibonacci': {
        const steps = generateFibonacciSteps(expr.steps, expr.notes);
        return { steps, stepDurationSec: measureDurationSec / expr.steps };
      }

      case 'cellular': {
        const steps = generateCellularSteps(
          expr.rule,
          expr.steps,
          expr.notes,
          this.cellularGeneration
        );
        return { steps, stepDurationSec: measureDurationSec / expr.steps };
      }

      case 'prime': {
        const steps = generatePrimeSteps(expr.steps, expr.notes);
        return { steps, stepDurationSec: measureDurationSec / expr.steps };
      }
    }
  }

  private compileBlockVoices(block: BlockNode, tempo: number): CompiledVoice[] {
    const quarterNoteSec = 60 / tempo;
    const measureDurationSec =
      block.meter.numerator * (4 / block.meter.denominator) * quarterNoteSec;

    return block.voices.map((v) => {
      const evaluated = this.evaluateExpression(
        v.play,
        measureDurationSec,
        quarterNoteSec
      );
      return {
        instrument: v.instrument,
        gain: v.gain,
        pan: v.pan,
        fx: v.fx,
        steps: evaluated.steps,
        stepDurationSec: evaluated.stepDurationSec
      };
    });
  }

  private scheduleNextTick(transportTime: number): void {
    this.scheduledEventId = Tone.Transport.scheduleOnce((audioTime) => {
      if (!this.isPlaying || !this.ast || this.queue.length === 0) return;

      const blockName = this.queue[this.currentQueueIdx];
      const block = this.ast.blocks[blockName];
      if (!block) {
        this.stop();
        return;
      }

      const tempo = this.ast.playback.tempo;
      const compiledVoices = this.compileBlockVoices(block, tempo);
      const primaryVoice = compiledVoices[0];

      if (this.currentStepIdx >= primaryVoice.steps.length) {
        this.currentStepIdx = 0;
      }

      const isBarStart = this.currentStepIdx === 0;

      // Schedule secondary layers across the bar on their own isolated channel slots (1..N)
      if (isBarStart && compiledVoices.length > 1) {
        for (let vIdx = 1; vIdx < compiledVoices.length; vIdx++) {
          const layerVoice = compiledVoices[vIdx];
          layerVoice.steps.forEach((chord, stepIdx) => {
            if (chord !== null) {
              this.audio.triggerVoice(
                vIdx,
                layerVoice.instrument,
                chord,
                layerVoice.stepDurationSec,
                audioTime + stepIdx * layerVoice.stepDurationSec,
                layerVoice.gain,
                layerVoice.pan,
                layerVoice.fx
              );
            }
          });
        }
      }

      // Trigger primary voice on slot 0
      const primaryChord = primaryVoice.steps[this.currentStepIdx];
      if (primaryChord !== null) {
        this.audio.triggerVoice(
          0,
          primaryVoice.instrument,
          primaryChord,
          primaryVoice.stepDurationSec,
          audioTime,
          primaryVoice.gain,
          primaryVoice.pan,
          primaryVoice.fx
        );
      }

      const barProgressRatio = this.currentStepIdx / primaryVoice.steps.length;

      const snapshot: ActiveStepSnapshot = {
        blockName: block.name,
        queueIndex: this.currentQueueIdx,
        meterLabel: `${block.meter.numerator}/${block.meter.denominator}`,
        stepIndex: this.currentStepIdx,
        totalSteps: primaryVoice.steps.length,
        generation: this.cellularGeneration,
        tempo,
        voices: compiledVoices.map((cv, idx) => ({
          instrument: cv.instrument,
          gain: cv.gain,
          pan: cv.pan,
          fx: cv.fx,
          stepIndex:
            idx === 0
              ? this.currentStepIdx
              : Math.min(
                  cv.steps.length - 1,
                  Math.floor(barProgressRatio * cv.steps.length)
                ),
          totalSteps: cv.steps.length,
          pattern: cv.steps
        }))
      };

      const activeBlockName = block.name;
      const activeQueueIdx = this.currentQueueIdx;
      const totalQueueLen = this.queue.length;

      Tone.Draw.schedule(() => {
        if (!this.isPlaying) return;
        if (isBarStart) {
          this.callbacks.onBlockChange(activeBlockName, activeQueueIdx, totalQueueLen);
        }
        this.callbacks.onStep(snapshot);
      }, audioTime);

      this.currentStepIdx++;
      if (this.currentStepIdx >= primaryVoice.steps.length) {
        this.currentStepIdx = 0;
        this.cellularGeneration++;
        this.currentQueueIdx++;

        if (this.currentQueueIdx >= this.queue.length) {
          if (this.ast.playback.loop) {
            this.currentQueueIdx = 0;
          } else {
            Tone.Draw.schedule(
              () => this.stop(),
              audioTime + primaryVoice.stepDurationSec
            );
            return;
          }
        }
      }

      const nextTransportTime = transportTime + primaryVoice.stepDurationSec;
      this.scheduleNextTick(nextTransportTime);
    }, transportTime);
  }
}