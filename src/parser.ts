export type InstrumentType =
  | 'sine'
  | 'triangle'
  | 'sawtooth'
  | 'square'
  | 'fm'
  | 'kick'
  | 'snare'
  | 'hat';

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface VoiceFX {
  reverb: number;
  delay: number;
  distortion: number;
  chorus: number;
}

export type PatternExpression =
  | {
      kind: 'seq';
      notes: (string[] | null)[];
      dur: TimeSignature;
    }
  | {
      kind: 'euclid';
      pulses: number;
      steps: number;
      rotation: number;
      notes: string[][];
    }
  | {
      kind: 'fibonacci';
      steps: number;
      notes: string[][];
    }
  | {
      kind: 'cellular';
      rule: number;
      steps: number;
      notes: string[][];
    }
  | {
      kind: 'modulo';
      steps: number;
      modulus: number;
      offset: number;
      notes: string[][];
    }
  | {
      kind: 'prime';
      steps: number;
      notes: string[][];
    };

export interface VoiceLayer {
  instrument: InstrumentType;
  play: PatternExpression;
  gain: number;
  pan: number;
  fx: VoiceFX;
}

export interface BlockNode {
  name: string;
  meter: TimeSignature;
  voices: VoiceLayer[];
  line: number;
}

export interface SequenceEntry {
  blockName: string;
  repeat: number;
}

export interface PlaybackNode {
  tempo: number;
  swing: number;
  sequence: SequenceEntry[];
  loop: boolean;
  repeat: number;
}

export interface ProgramAST {
  playback: PlaybackNode;
  blocks: Record<string, BlockNode>;
}

export class DSLParseError extends Error {
  public readonly line: number;

  constructor(message: string, line: number) {
    super(`[Line ${line}] Syntax Error: ${message}`);
    this.name = 'DSLParseError';
    this.line = line;
  }
}

const VALID_INSTRUMENTS: InstrumentType[] = [
  'sine',
  'triangle',
  'sawtooth',
  'square',
  'fm',
  'kick',
  'snare',
  'hat'
];

export function createDefaultFX(): VoiceFX {
  return {
    reverb: 0,
    delay: 0,
    distortion: 0,
    chorus: 0
  };
}

function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx !== -1 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

function getLineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function parseFraction(raw: string, line: number): TimeSignature {
  const match = raw.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    throw new DSLParseError(
      `Expected fraction format N/M (e.g. 4/4, 7/8, 5/4), got "${raw}".`,
      line
    );
  }
  const numerator = parseInt(match[1], 10);
  const denominator = parseInt(match[2], 10);

  if (numerator <= 0 || denominator <= 0 || ![1, 2, 4, 8, 16, 32].includes(denominator)) {
    throw new DSLParseError(
      `Invalid meter "${raw}". Denominator must be a power of two (2, 4, 8, 16, 32).`,
      line
    );
  }
  return { numerator, denominator };
}

function parseNoteTokens(rawNotes: string, line: number): (string[] | null)[] {
  const tokens = rawNotes
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new DSLParseError('Note pattern string cannot be empty.', line);
  }

  const singleNoteRegex = /^[a-gA-G][#b]?\d$/;

  return tokens.map((token) => {
    if (token === '~' || token === '-' || token === '_' || token === '.') {
      return null;
    }

    const chordParts = token.split('+');
    for (const part of chordParts) {
      if (!singleNoteRegex.test(part)) {
        throw new DSLParseError(
          `Invalid note token "${token}". Use scientific pitch (e.g. "c3", "f#4"), chords ("c3+g3"), or "~" for rest.`,
          line
        );
      }
    }
    return chordParts.map((p) => p.toUpperCase());
  });
}

function requirePitchedNotes(rawNotes: string, generatorName: string, line: number): string[][] {
  const notes = parseNoteTokens(rawNotes, line).filter((n): n is string[] => n !== null);
  if (notes.length === 0) {
    throw new DSLParseError(
      `Generator "${generatorName}" requires at least one pitched note after 'on "..."'.`,
      line
    );
  }
  return notes;
}

function parsePlayExpression(expr: string, line: number): PatternExpression {
  const trimmed = expr.trim();

  const seqMatch = trimmed.match(/^seq\(\s*"([^"]+)"(?:\s*,\s*dur\s*:\s*([0-9/]+))?\s*\)$/i);
  if (seqMatch) {
    const notes = parseNoteTokens(seqMatch[1], line);
    const dur = seqMatch[2]
      ? parseFraction(seqMatch[2], line)
      : { numerator: 1, denominator: 4 };
    return { kind: 'seq', notes, dur };
  }

  const euclidMatch = trimmed.match(
    /^euclid\(\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(-?\d+))?\s*\)\s+on\s+"([^"]+)"$/i
  );
  if (euclidMatch) {
    const pulses = parseInt(euclidMatch[1], 10);
    const steps = parseInt(euclidMatch[2], 10);
    const rotation = euclidMatch[3] ? parseInt(euclidMatch[3], 10) : 0;

    if (steps <= 0 || steps > 64) {
      throw new DSLParseError('euclid(k, n) step count must be between 1 and 64.', line);
    }
    if (pulses < 0 || pulses > steps) {
      throw new DSLParseError(
        `In euclid(${pulses}, ${steps}), pulses (${pulses}) cannot exceed steps (${steps}).`,
        line
      );
    }
    const notes = requirePitchedNotes(euclidMatch[4], 'euclid', line);
    return { kind: 'euclid', pulses, steps, rotation, notes };
  }

  const modMatch = trimmed.match(
    /^modulo\(\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*\)\s+on\s+"([^"]+)"$/i
  );
  if (modMatch) {
    const steps = parseInt(modMatch[1], 10);
    const modulus = parseInt(modMatch[2], 10);
    const offset = modMatch[3] ? parseInt(modMatch[3], 10) : 0;

    if (steps <= 0 || steps > 64) {
      throw new DSLParseError('modulo(steps, mod) steps must be between 1 and 64.', line);
    }
    if (modulus <= 0) {
      throw new DSLParseError('modulo(steps, mod) modulus must be >= 1.', line);
    }
    const notes = requirePitchedNotes(modMatch[4], 'modulo', line);
    return { kind: 'modulo', steps, modulus, offset, notes };
  }

  const fibMatch = trimmed.match(/^fibonacci\(\s*(\d+)\s*\)\s+on\s+"([^"]+)"$/i);
  if (fibMatch) {
    const steps = parseInt(fibMatch[1], 10);
    if (steps <= 0 || steps > 64) {
      throw new DSLParseError('fibonacci(n) step count must be between 1 and 64.', line);
    }
    const notes = requirePitchedNotes(fibMatch[2], 'fibonacci', line);
    return { kind: 'fibonacci', steps, notes };
  }

  const cellMatch = trimmed.match(
    /^cellular\(\s*(?:rule)?(\d+)\s*,\s*(\d+)\s*\)\s+on\s+"([^"]+)"$/i
  );
  if (cellMatch) {
    const rule = parseInt(cellMatch[1], 10);
    const steps = parseInt(cellMatch[2], 10);
    if (rule < 0 || rule > 255) {
      throw new DSLParseError('Cellular automaton rule must be between 0 and 255.', line);
    }
    if (steps <= 0 || steps > 64) {
      throw new DSLParseError('cellular(rule, n) step count must be between 1 and 64.', line);
    }
    const notes = requirePitchedNotes(cellMatch[3], 'cellular', line);
    return { kind: 'cellular', rule, steps, notes };
  }

  const primeMatch = trimmed.match(/^prime\(\s*(\d+)\s*\)\s+on\s+"([^"]+)"$/i);
  if (primeMatch) {
    const steps = parseInt(primeMatch[1], 10);
    if (steps <= 0 || steps > 64) {
      throw new DSLParseError('prime(n) step count must be between 1 and 64.', line);
    }
    const notes = requirePitchedNotes(primeMatch[2], 'prime', line);
    return { kind: 'prime', steps, notes };
  }

  throw new DSLParseError(
    `Unrecognized play generator "${trimmed}". Supported: seq(...), euclid(k,n) on "...", modulo(n,m) on "...", fibonacci(n) on "...", cellular(rule30,n) on "...", prime(n) on "...".`,
    line
  );
}

function parseInstrument(raw: string, blockName: string, line: number): InstrumentType {
  const cleanInst = raw.replace(/^"|"$/g, '').trim() as InstrumentType;
  if (!VALID_INSTRUMENTS.includes(cleanInst)) {
    throw new DSLParseError(
      `Unknown instrument "${cleanInst}" in block "${blockName}". Valid instruments: ${VALID_INSTRUMENTS.map((i) => `"${i}"`).join(', ')}.`,
      line
    );
  }
  return cleanInst;
}

function parseUnitAmount(val: string, propName: string, line: number): number {
  const num = Number(val);
  if (Number.isNaN(num) || num < 0 || num > 1) {
    throw new DSLParseError(
      `Effect parameter "${propName}" must be a number between 0.0 and 1.0 (got "${val}").`,
      line
    );
  }
  return num;
}

function applyVoiceModifier(
  target: { gain: number; pan: number; fx: VoiceFX },
  key: string,
  val: string,
  lineNum: number
): boolean {
  switch (key) {
    case 'gain': {
      const g = Number(val);
      if (Number.isNaN(g) || g < 0.05 || g > 1.5) {
        throw new DSLParseError('Parameter "gain" must be between 0.05 and 1.5.', lineNum);
      }
      target.gain = g;
      return true;
    }
    case 'pan': {
      const p = Number(val);
      if (Number.isNaN(p) || p < -1 || p > 1) {
        throw new DSLParseError('Parameter "pan" must be between -1.0 and 1.0.', lineNum);
      }
      target.pan = p;
      return true;
    }
    case 'reverb': {
      target.fx.reverb = parseUnitAmount(val, 'reverb', lineNum);
      return true;
    }
    case 'delay': {
      target.fx.delay = parseUnitAmount(val, 'delay', lineNum);
      return true;
    }
    case 'distortion':
    case 'dist': {
      target.fx.distortion = parseUnitAmount(val, key, lineNum);
      return true;
    }
    case 'chorus': {
      target.fx.chorus = parseUnitAmount(val, 'chorus', lineNum);
      return true;
    }
    default:
      return false;
  }
}

function parsePlaybackBody(body: string, baseLine: number): PlaybackNode {
  let tempo = 110;
  let swing = 0;
  let loop = true;
  let repeat = 1;
  let sequence: SequenceEntry[] = [];

  const lines = body.split('\n');
  lines.forEach((rawLine, offset) => {
    const lineNum = baseLine + offset;
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      throw new DSLParseError(
        `Expected "key: value" inside $playback, got "${trimmed}".`,
        lineNum
      );
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case 'tempo': {
        const parsed = Number(val);
        if (Number.isNaN(parsed) || parsed < 30 || parsed > 300) {
          throw new DSLParseError(
            `Parameter "tempo" must be a number between 30 and 300 (got "${val}").`,
            lineNum
          );
        }
        tempo = parsed;
        break;
      }
      case 'swing': {
        const parsed = Number(val);
        if (Number.isNaN(parsed) || parsed < 0 || parsed > 0.5) {
          throw new DSLParseError(
            `Parameter "swing" must be between 0.0 and 0.5 (got "${val}").`,
            lineNum
          );
        }
        swing = parsed;
        break;
      }
      case 'loop': {
        if (val !== 'true' && val !== 'false') {
          throw new DSLParseError(
            `Parameter "loop" must be true or false (got "${val}").`,
            lineNum
          );
        }
        loop = val === 'true';
        break;
      }
      case 'repeat': {
        const parsed = parseInt(val, 10);
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 32) {
          throw new DSLParseError('Parameter "repeat" must be an integer between 1 and 32.', lineNum);
        }
        repeat = parsed;
        break;
      }
      case 'sequence': {
        const match = val.match(/^\[(.*)\]$/);
        if (!match) {
          throw new DSLParseError(
            'Parameter "sequence" must be a bracketed list, e.g. sequence: [intro, main * 2].',
            lineNum
          );
        }
        const items = match[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        if (items.length === 0) {
          throw new DSLParseError('The "sequence" list in $playback cannot be empty.', lineNum);
        }

        sequence = items.map((item) => {
          const multMatch = item.match(/^([a-zA-Z0-9_]+)(?:\s*\*\s*(\d+))?$/);
          if (!multMatch) {
            throw new DSLParseError(
              `Invalid sequence item "${item}". Use block name or "block_name * N".`,
              lineNum
            );
          }
          return {
            blockName: multMatch[1],
            repeat: multMatch[2] ? Math.max(1, parseInt(multMatch[2], 10)) : 1
          };
        });
        break;
      }
      default:
        throw new DSLParseError(
          `Unknown property "${key}" in $playback. Allowed: tempo, swing, sequence, loop, repeat.`,
          lineNum
        );
    }
  });

  if (sequence.length === 0) {
    throw new DSLParseError('$playback must define a "sequence: [...]" list.', baseLine);
  }

  return { tempo, swing, sequence, loop, repeat };
}

function parseBlockBody(name: string, body: string, baseLine: number): BlockNode {
  let meter: TimeSignature = { numerator: 4, denominator: 4 };
  let primaryInstrument: InstrumentType = 'sine';
  const primaryMix = {
    gain: 0.85,
    pan: 0,
    fx: createDefaultFX()
  };
  let primaryPlay: PatternExpression | null = null;
  const extraLayers: VoiceLayer[] = [];

  const lines = body.split('\n');
  lines.forEach((rawLine, offset) => {
    const lineNum = baseLine + offset;
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      throw new DSLParseError(
        `Expected "property: value" inside block "${name}", got "${trimmed}".`,
        lineNum
      );
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();

    if (applyVoiceModifier(primaryMix, key, val, lineNum)) {
      return;
    }

    switch (key) {
      case 'meter':
      case 'доля': {
        meter = parseFraction(val, lineNum);
        break;
      }
      case 'instrument': {
        primaryInstrument = parseInstrument(val, name, lineNum);
        break;
      }
      case 'play': {
        primaryPlay = parsePlayExpression(val, lineNum);
        break;
      }
      case 'layer': {
        // Supports:
        // layer: "kick" | euclid(3, 8) on "c1" | gain: 1.0, pan: -0.2, reverb: 0.4, dist: 0.3
        const segments = val
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);

        if (segments.length < 2) {
          throw new DSLParseError(
            'Layer syntax requires: layer: "instrument" | <generator> [| gain: 0.8, pan: -0.2, reverb: 0.3, ...]',
            lineNum
          );
        }

        const layerInst = parseInstrument(segments[0], name, lineNum);
        const layerPlay = parsePlayExpression(segments[1], lineNum);
        const layerMix = {
          gain: 0.8,
          pan: 0,
          fx: createDefaultFX()
        };

        // Parse optional modifier segments (supports both comma-separated and pipe-separated)
        for (let sIdx = 2; sIdx < segments.length; sIdx++) {
          const pairs = segments[sIdx]
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);

          for (const pair of pairs) {
            const cIdx = pair.indexOf(':');
            if (cIdx === -1) {
              throw new DSLParseError(
                `Invalid layer modifier "${pair}" in block "${name}". Expected "key: value" (e.g. gain: 0.8, reverb: 0.4).`,
                lineNum
              );
            }
            const mKey = pair.slice(0, cIdx).trim();
            const mVal = pair.slice(cIdx + 1).trim();
            if (!applyVoiceModifier(layerMix, mKey, mVal, lineNum)) {
              throw new DSLParseError(
                `Unknown layer modifier "${mKey}". Supported: gain, pan, reverb, delay, distortion (or dist), chorus.`,
                lineNum
              );
            }
          }
        }

        extraLayers.push({
          instrument: layerInst,
          play: layerPlay,
          gain: layerMix.gain,
          pan: layerMix.pan,
          fx: layerMix.fx
        });
        break;
      }
      default:
        throw new DSLParseError(
          `Unknown property "${key}" in block "${name}". Supported: meter, instrument, play, gain, pan, reverb, delay, distortion, chorus, layer.`,
          lineNum
        );
    }
  });

  const voices: VoiceLayer[] = [];
  if (primaryPlay) {
    voices.push({
      instrument: primaryInstrument,
      play: primaryPlay,
      gain: primaryMix.gain,
      pan: primaryMix.pan,
      fx: primaryMix.fx
    });
  }
  voices.push(...extraLayers);

  if (voices.length === 0) {
    throw new DSLParseError(
      `Block "${name}" must contain at least one "play:" or "layer:" statement.`,
      baseLine
    );
  }

  return {
    name,
    meter,
    voices,
    line: baseLine
  };
}

export function parseDSL(rawSource: string): ProgramAST {
  const cleanSource = stripComments(rawSource);

  let playback: PlaybackNode | null = null;
  const blocks: Record<string, BlockNode> = {};

  const topLevelRegex = /(\$playback|block\s+[a-zA-Z0-9_]+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = topLevelRegex.exec(cleanSource)) !== null) {
    const between = cleanSource.slice(lastIndex, match.index).trim();
    if (between.length > 0) {
      const errLine = getLineNumber(cleanSource, lastIndex);
      throw new DSLParseError(
        `Unexpected token outside block definition: "${between.split('\n')[0]}"`,
        errLine
      );
    }

    const header = match[1].trim();
    const body = match[2];
    const startLine = getLineNumber(cleanSource, match.index);

    if (header === '$playback') {
      if (playback !== null) {
        throw new DSLParseError('$playback block can only be defined once.', startLine);
      }
      playback = parsePlaybackBody(body, startLine);
    } else if (header.startsWith('block')) {
      const parts = header.split(/\s+/);
      const blockName = parts[1];
      if (!blockName) {
        throw new DSLParseError('Missing block identifier after "block".', startLine);
      }
      if (blocks[blockName]) {
        throw new DSLParseError(`Duplicate block identifier "${blockName}".`, startLine);
      }
      blocks[blockName] = parseBlockBody(blockName, body, startLine);
    }

    lastIndex = topLevelRegex.lastIndex;
  }

  const trailing = cleanSource.slice(lastIndex).trim();
  if (trailing.length > 0) {
    const errLine = getLineNumber(cleanSource, lastIndex);
    throw new DSLParseError(
      `Syntax error or unclosed brace near: "${trailing.split('\n')[0]}"`,
      errLine
    );
  }

  if (!playback) {
    throw new DSLParseError('Missing required global "$playback { ... }" configuration.', 1);
  }

  for (const item of playback.sequence) {
    if (!blocks[item.blockName]) {
      throw new DSLParseError(
        `$playback.sequence references undefined block "${item.blockName}".`,
        1
      );
    }
  }

  return { playback, blocks };
}

export function generateEuclideanMask(
  pulses: number,
  steps: number,
  rotation = 0
): boolean[] {
  if (pulses <= 0) return new Array(steps).fill(false);
  if (pulses >= steps) return new Array(steps).fill(true);

  const raw: boolean[] = [];
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += pulses;
    if (bucket >= steps) {
      bucket -= steps;
      raw.push(true);
    } else {
      raw.push(false);
    }
  }

  const normRot = ((rotation % steps) + steps) % steps;
  if (normRot === 0) return raw;
  return raw.map((_, idx) => raw[(idx - normRot + steps) % steps]);
}

export function generateModuloSteps(
  steps: number,
  modulus: number,
  offset: number,
  notes: string[][]
): (string[] | null)[] {
  const result: (string[] | null)[] = [];
  let hitCount = 0;
  for (let i = 0; i < steps; i++) {
    const val = (i + offset) % modulus;
    if (val === 0) {
      const chord = notes[(hitCount + i) % notes.length];
      hitCount++;
      result.push(chord);
    } else {
      result.push(null);
    }
  }
  return result;
}

export function generateFibonacciSteps(
  steps: number,
  notes: string[][]
): (string[] | null)[] {
  const result: (string[] | null)[] = [];
  let a = 1;
  let b = 1;

  for (let i = 0; i < steps; i++) {
    const isHit = a % 3 !== 0;
    if (isHit) {
      result.push(notes[a % notes.length]);
    } else {
      result.push(null);
    }
    const next = (a + b) % 997;
    a = b;
    b = next;
  }
  return result;
}

export function generateCellularSteps(
  rule: number,
  steps: number,
  notes: string[][],
  generation: number
): (string[] | null)[] {
  let cells = new Array<number>(steps).fill(0);
  cells[Math.floor(steps / 2)] = 1;

  for (let g = 0; g < generation; g++) {
    const nextCells = new Array<number>(steps).fill(0);
    for (let i = 0; i < steps; i++) {
      const left = cells[(i - 1 + steps) % steps];
      const center = cells[i];
      const right = cells[(i + 1) % steps];
      const neighborhood = (left << 2) | (center << 1) | right;
      nextCells[i] = (rule >> neighborhood) & 1;
    }
    cells = nextCells;
  }

  let noteCounter = 0;
  return cells.map((bit, idx) => {
    if (bit === 1) {
      const chord = notes[(noteCounter + idx) % notes.length];
      noteCounter++;
      return chord;
    }
    return null;
  });
}

export function generatePrimeSteps(
  steps: number,
  notes: string[][]
): (string[] | null)[] {
  const isPrime = (n: number): boolean => {
    if (n < 2) return false;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) return false;
    }
    return true;
  };

  let hit = 0;
  const result: (string[] | null)[] = [];
  for (let i = 0; i < steps; i++) {
    if (i === 0 || isPrime(i + 1)) {
      result.push(notes[hit % notes.length]);
      hit++;
    } else {
      result.push(null);
    }
  }
  return result;
}