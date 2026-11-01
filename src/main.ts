import { AudioEngine } from './audio';
import { DSLParseError, parseDSL } from './parser';
import { ActiveStepSnapshot, TransportScheduler, VoiceRuntimeSnapshot } from './scheduler';

const PRESETS: Record<string, string> = {
  empty: `// MODULO // Empty Starter Project
// Define your blocks below or select a preset from the top bar

$playback {
  tempo: 110
  sequence: [main]
  loop: true
}

block main {
  meter: 4/4
  instrument: "sine"
  gain: 0.8
  pan: 0.0
  reverb: 0.2
  play: seq("c4 ~ g3 ~", dur: 1/4)
}
`,

  euclid_fx: `// PRESET 01 // Euclidean 7/8 with Per-Layer Mix & DSP Effects
// Press [ PLAY ] or Ctrl+Enter to evaluate

$playback {
  tempo: 114
  swing: 0.05
  sequence: [intro, odd_euclid * 2, modulo_bridge]
  loop: true
}

block intro {
  meter: 4/4
  instrument: "triangle"
  gain: 0.85
  pan: -0.2
  chorus: 0.4
  reverb: 0.35
  play: seq("c3 g3 d#4 d4 c3 g3 a#3 g3", dur: 1/8)
  layer: "kick" | euclid(3, 8) on "c1" | gain: 1.1, dist: 0.25
  layer: "hat"  | euclid(5, 8) on "c5" | gain: 0.4, pan: 0.5, delay: 0.3
}

block odd_euclid {
  meter: 7/8
  instrument: "sawtooth"
  gain: 0.75
  pan: -0.35
  distortion: 0.3
  delay: 0.35
  reverb: 0.4
  play: euclid(5, 8, 1) on "c3 d#3 g3 a#3 d4"
  layer: "kick"  | euclid(2, 7) on "c1"    | gain: 1.2, dist: 0.4
  layer: "snare" | euclid(2, 7, 3) on "c2" | gain: 0.85, reverb: 0.45
  layer: "hat"   | prime(14) on "c5"       | gain: 0.45, pan: 0.65, chorus: 0.3
}

block modulo_bridge {
  meter: 5/4
  instrument: "fm"
  gain: 0.8
  pan: 0.25
  chorus: 0.55
  delay: 0.45
  reverb: 0.6
  play: modulo(10, 3, 1) on "c4 d#4 g4 b4 d5"
  layer: "snare" | euclid(3, 10, 2) on "c2" | gain: 0.75, delay: 0.25
}
`,

  automata: `// PRESET 02 // Wolfram Rule 30 Elementary Cellular Automaton

$playback {
  tempo: 120
  sequence: [cell_seed * 4, cell_dense * 2]
  loop: true
}

block cell_seed {
  meter: 4/4
  instrument: "fm"
  gain: 0.75
  reverb: 0.5
  delay: 0.35
  play: cellular(rule30, 16) on "c3 d#3 f3 g3 a#3 c4 d#4"
  layer: "kick" | euclid(4, 16) on "c1"    | gain: 1.1, dist: 0.35
  layer: "hat"  | euclid(7, 16, 1) on "c5" | gain: 0.4, pan: 0.5, delay: 0.25
}

block cell_dense {
  meter: 9/8
  instrument: "sawtooth"
  gain: 0.7
  distortion: 0.4
  chorus: 0.5
  play: cellular(rule110, 9) on "c3 g3 c4 d#4 g4 a#4"
  layer: "snare" | euclid(4, 9, 2) on "c2" | gain: 0.85, reverb: 0.4
}
`,

  polyrhythm: `// PRESET 03 // Modular Congruence & Prime Sieve Polyrhythm

$playback {
  tempo: 106
  sequence: [prime_matrix * 2, mod_counter * 2]
  loop: true
}

block prime_matrix {
  meter: 11/8
  instrument: "square"
  gain: 0.7
  pan: -0.4
  delay: 0.4
  reverb: 0.35
  play: prime(11) on "c3 d3 f3 g3 a3 c4 d4"
  layer: "triangle" | euclid(4, 11) on "c2 g2"  | gain: 0.9, pan: 0.4, chorus: 0.4
  layer: "kick"     | euclid(3, 11) on "c1"     | gain: 1.15, dist: 0.3
  layer: "hat"      | modulo(11, 2, 0) on "c5"  | gain: 0.4, pan: 0.65
}

block mod_counter {
  meter: 7/8
  instrument: "sawtooth"
  gain: 0.75
  chorus: 0.5
  reverb: 0.45
  play: modulo(14, 3, 0) on "c3+g3 d#3+a#3 f3+c4 g3+d4"
  layer: "kick"  | euclid(3, 7) on "c1"    | gain: 1.1, dist: 0.35
  layer: "snare" | euclid(2, 7, 3) on "c2" | gain: 0.8, delay: 0.3
}
`,

  fibonacci: `// PRESET 04 // Fibonacci Space Dub in 5/4

$playback {
  tempo: 116
  sequence: [fib_phase * 2, fib_chord]
  loop: true
}

block fib_phase {
  meter: 5/4
  instrument: "triangle"
  gain: 0.85
  pan: -0.25
  delay: 0.55
  reverb: 0.65
  play: fibonacci(10) on "c3 d#3 g3 a#3 c4 d4 f4 g4"
  layer: "sine" | euclid(3, 5) on "c2 g2"  | gain: 1.0, dist: 0.2
  layer: "hat"  | euclid(7, 10) on "c5"    | gain: 0.4, pan: 0.55, delay: 0.4
}

block fib_chord {
  meter: 4/4
  instrument: "fm"
  gain: 0.75
  chorus: 0.6
  reverb: 0.7
  play: seq("c3+d#3+g3 ~ d3+f3+a#3 ~ g2+d3+f#3 ~ c3+g3+b3 ~", dur: 1/8)
  layer: "kick" | euclid(3, 8) on "c1" | gain: 1.1, dist: 0.3
}
`
};

// DOM references
const codeInput = document.getElementById('code-input') as HTMLTextAreaElement;
const codeHighlight = document.getElementById('code-highlight') as HTMLPreElement;
const lineNumbers = document.getElementById('line-numbers') as HTMLDivElement;

const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnEval = document.getElementById('btn-eval') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const presetSelect = document.getElementById('preset-select') as HTMLSelectElement;
const btnDocs = document.getElementById('btn-docs') as HTMLButtonElement;
const btnCloseDocs = document.getElementById('btn-close-docs') as HTMLButtonElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const docsModal = document.getElementById('docs-modal') as HTMLDivElement;

const statusState = document.getElementById('status-state') as HTMLSpanElement;
const statusBpm = document.getElementById('status-bpm') as HTMLSpanElement;
const statusBlock = document.getElementById('status-block') as HTMLSpanElement;
const statusMeter = document.getElementById('status-meter') as HTMLSpanElement;
const statusStep = document.getElementById('status-step') as HTMLSpanElement;
const statusGen = document.getElementById('status-gen') as HTMLSpanElement;

const terminalConsole = document.getElementById('terminal-console') as HTMLDivElement;
const patternVisualizer = document.getElementById('pattern-visualizer') as HTMLDivElement;
const sequenceVisualizer = document.getElementById('sequence-visualizer') as HTMLDivElement;
const scopeCanvas = document.getElementById('scope-canvas') as HTMLCanvasElement;
const scopeCtx = scopeCanvas.getContext('2d')!;

let currentErrorLine: number | null = null;

// Cached DOM references to avoid innerHTML reconstruction on every step
interface CachedVoiceDOM {
  counterEl: HTMLSpanElement;
  cells: HTMLDivElement[];
  lastActiveIdx: number;
}

let renderedMatrixSignature = '';
let cachedVoiceDOMs: CachedVoiceDOM[] = [];
let renderedQueueSignature = '';
let cachedQueueItems: HTMLDivElement[] = [];
let lastQueueActiveIdx = -1;

function logToTerminal(
  message: string,
  type: 'info' | 'success' | 'error' = 'info'
): void {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  const row = document.createElement('div');
  row.className = `log-line log-${type}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${timeStr}]`;

  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;

  row.appendChild(timeSpan);
  row.appendChild(msgSpan);
  terminalConsole.appendChild(row);

  // Keep console log bounded to 100 entries so DOM doesn't grow indefinitely
  while (terminalConsole.childElementCount > 100 && terminalConsole.firstChild) {
    terminalConsole.removeChild(terminalConsole.firstChild);
  }
  terminalConsole.scrollTop = terminalConsole.scrollHeight;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

function highlightDSL(code: string): string {
  const tokenRegex =
    /(\/\/[^\n]*)|("[^"]*")|(\$playback|\b(?:block|on|true|false)\b)|\b(seq|euclid|modulo|fibonacci|cellular|prime)\b|\b(tempo|swing|sequence|loop|repeat|meter|доля|instrument|gain|pan|reverb|delay|distortion|dist|chorus|play|layer|dur)(?=\s*:)|(-?\b\d+(?:[./]\d+)?\b)/g;

  let result = '';
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIdx) {
      result += escapeHtml(code.slice(lastIdx, match.index));
    }

    const [full, comment, strLit, keyword, fn, prop, num] = match;
    const safeText = escapeHtml(full);

    if (comment !== undefined) {
      result += `<span class="tok-comment">${safeText}</span>`;
    } else if (strLit !== undefined) {
      result += `<span class="tok-string">${safeText}</span>`;
    } else if (keyword !== undefined) {
      result += `<span class="tok-keyword">${safeText}</span>`;
    } else if (fn !== undefined) {
      result += `<span class="tok-fn">${safeText}</span>`;
    } else if (prop !== undefined) {
      result += `<span class="tok-prop">${safeText}</span>`;
    } else if (num !== undefined) {
      result += `<span class="tok-number">${safeText}</span>`;
    } else {
      result += safeText;
    }

    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < code.length) {
    result += escapeHtml(code.slice(lastIdx));
  }

  return result;
}

function updateEditorView(): void {
  const value = codeInput.value;
  codeHighlight.innerHTML = highlightDSL(value) + (value.endsWith('\n') ? ' ' : '');

  const linesCount = value.split('\n').length;
  lineNumbers.innerHTML = Array.from({ length: linesCount }, (_, i) => {
    const lineNum = i + 1;
    if (currentErrorLine === lineNum) {
      return `<span class="line-num-error">${lineNum}</span>`;
    }
    return String(lineNum);
  }).join('<br/>');
}

function syncEditorScroll(): void {
  codeHighlight.scrollTop = codeInput.scrollTop;
  codeHighlight.scrollLeft = codeInput.scrollLeft;
  lineNumbers.scrollTop = codeInput.scrollTop;
}

/**
 * Updates sequence queue with O(1) class toggling unless the queue structure changed
 */
function renderSequenceQueue(queue: string[], activeIndex: number, forceRebuild = false): void {
  const sig = queue.join(',');
  if (forceRebuild || sig !== renderedQueueSignature) {
    renderedQueueSignature = sig;
    sequenceVisualizer.innerHTML = '';
    cachedQueueItems = [];
    lastQueueActiveIdx = -1;

    queue.forEach((blockName, idx) => {
      const item = document.createElement('div');
      item.className = 'seq-item';
      item.innerHTML = `<span>#${idx + 1} ${escapeHtml(blockName)}</span><span class="seq-status"></span>`;
      sequenceVisualizer.appendChild(item);
      cachedQueueItems.push(item);
    });
  }

  if (lastQueueActiveIdx !== activeIndex) {
    if (lastQueueActiveIdx >= 0 && cachedQueueItems[lastQueueActiveIdx]) {
      const prev = cachedQueueItems[lastQueueActiveIdx];
      prev.classList.remove('active-block');
      const statusEl = prev.querySelector('.seq-status');
      if (statusEl) statusEl.textContent = '';
    }
    if (activeIndex >= 0 && cachedQueueItems[activeIndex]) {
      const curr = cachedQueueItems[activeIndex];
      curr.classList.add('active-block');
      const statusEl = curr.querySelector('.seq-status');
      if (statusEl) statusEl.textContent = 'ACTIVE';
    }
    lastQueueActiveIdx = activeIndex;
  }
}

function renderVoiceBadges(voice: VoiceRuntimeSnapshot): string {
  const badges: string[] = [
    `<span class="fx-badge">GAIN ${voice.gain.toFixed(2)}</span>`,
    `<span class="fx-badge">PAN ${voice.pan >= 0 ? '+' : ''}${voice.pan.toFixed(2)}</span>`
  ];
  if (voice.fx.reverb > 0) {
    badges.push(`<span class="fx-badge">REV ${Math.round(voice.fx.reverb * 100)}%</span>`);
  }
  if (voice.fx.delay > 0) {
    badges.push(`<span class="fx-badge">DLY ${Math.round(voice.fx.delay * 100)}%</span>`);
  }
  if (voice.fx.distortion > 0) {
    badges.push(`<span class="fx-badge">DST ${Math.round(voice.fx.distortion * 100)}%</span>`);
  }
  if (voice.fx.chorus > 0) {
    badges.push(`<span class="fx-badge">CHR ${Math.round(voice.fx.chorus * 100)}%</span>`);
  }
  return badges.join('');
}

/**
 * High-performance step matrix renderer:
 * Only builds DOM elements when the block or generation changes.
 * On each step, simply toggles '.current-step' on cached DOM nodes.
 */
function renderPatternMatrix(snapshot: ActiveStepSnapshot): void {
  statusBpm.textContent = String(snapshot.tempo);
  statusBlock.textContent = snapshot.blockName;
  statusMeter.textContent = snapshot.meterLabel;
  statusStep.textContent = `${snapshot.stepIndex + 1}/${snapshot.totalSteps}`;
  statusGen.textContent = String(snapshot.generation);

  const sig = `${snapshot.blockName}:${snapshot.generation}:${snapshot.voices.length}`;

  if (sig !== renderedMatrixSignature) {
    renderedMatrixSignature = sig;
    patternVisualizer.innerHTML = '';
    cachedVoiceDOMs = [];

    snapshot.voices.forEach((voice, vIdx) => {
      const card = document.createElement('div');
      card.className = 'voice-card';

      const title = document.createElement('div');
      title.className = 'voice-title';

      const roleLabel = vIdx === 0 ? 'PRIMARY' : `LAYER #${vIdx}`;
      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${roleLabel} // ${voice.instrument.toUpperCase()}`;

      const counterSpan = document.createElement('span');
      counterSpan.textContent = `${voice.stepIndex + 1}/${voice.totalSteps}`;

      title.appendChild(nameSpan);
      title.appendChild(counterSpan);

      const meta = document.createElement('div');
      meta.className = 'voice-meta';
      meta.innerHTML = renderVoiceBadges(voice);

      const grid = document.createElement('div');
      grid.className = 'step-grid';

      const cells: HTMLDivElement[] = [];
      voice.pattern.forEach((chord) => {
        const cell = document.createElement('div');
        cell.className = chord !== null ? 'step-cell active-hit' : 'step-cell';
        cell.textContent = chord ? chord.join('+') : '.';
        grid.appendChild(cell);
        cells.push(cell);
      });

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(grid);
      patternVisualizer.appendChild(card);

      cachedVoiceDOMs.push({
        counterEl: counterSpan,
        cells,
        lastActiveIdx: -1
      });
    });
  }

  // Fast O(voices) class toggle on existing DOM nodes
  snapshot.voices.forEach((voice, vIdx) => {
    const dom = cachedVoiceDOMs[vIdx];
    if (!dom) return;

    dom.counterEl.textContent = `${voice.stepIndex + 1}/${voice.totalSteps}`;

    if (dom.lastActiveIdx !== voice.stepIndex) {
      if (dom.lastActiveIdx >= 0 && dom.cells[dom.lastActiveIdx]) {
        dom.cells[dom.lastActiveIdx].classList.remove('current-step');
      }
      if (dom.cells[voice.stepIndex]) {
        dom.cells[voice.stepIndex].classList.add('current-step');
      }
      dom.lastActiveIdx = voice.stepIndex;
    }
  });
}

const audioEngine = new AudioEngine();

const scheduler = new TransportScheduler(audioEngine, {
  onStep: (snapshot) => {
    renderPatternMatrix(snapshot);
    renderSequenceQueue(scheduler.getExpandedQueue(), snapshot.queueIndex);
  },
  onBlockChange: (blockName, queueIndex, totalBlocks) => {
    logToTerminal(
      `Playing block "${blockName}" [queue ${queueIndex + 1}/${totalBlocks}]`,
      'info'
    );
  },
  onStop: () => {
    statusState.textContent = 'STOPPED';
    statusState.classList.remove('state-running');
    statusBlock.textContent = '--';
    statusMeter.textContent = '--';
    statusStep.textContent = '0/0';
    drawIdleOscilloscope();
    logToTerminal('Transport stopped.', 'info');
  }
});

function drawIdleOscilloscope(): void {
  const width = scopeCanvas.width;
  const height = scopeCanvas.height;
  scopeCtx.fillStyle = '#070402';
  scopeCtx.fillRect(0, 0, width, height);

  scopeCtx.strokeStyle = '#54321e';
  scopeCtx.lineWidth = 1.2;
  scopeCtx.beginPath();
  scopeCtx.moveTo(0, height / 2);
  scopeCtx.lineTo(width, height / 2);
  scopeCtx.stroke();
}

let lastScopeFrameTime = 0;

function renderOscilloscope(timestamp: number): void {
  // Only sample and draw waveform at ~30 FPS while transport is running
  if (scheduler.running && timestamp - lastScopeFrameTime >= 32) {
    lastScopeFrameTime = timestamp;
    const width = scopeCanvas.width;
    const height = scopeCanvas.height;
    scopeCtx.fillStyle = '#070402';
    scopeCtx.fillRect(0, 0, width, height);

    scopeCtx.strokeStyle = '#26150b';
    scopeCtx.lineWidth = 1;
    scopeCtx.beginPath();
    scopeCtx.moveTo(0, height / 2);
    scopeCtx.lineTo(width, height / 2);
    scopeCtx.stroke();

    const values = audioEngine.getWaveformValues();
    scopeCtx.strokeStyle = '#ff6b35';
    scopeCtx.lineWidth = 1.6;
    scopeCtx.beginPath();

    const sliceWidth = width / values.length;
    let x = 0;
    for (let i = 0; i < values.length; i++) {
      const v = Math.max(-1, Math.min(1, values[i]));
      const y = ((1 - v) * height) / 2;
      if (i === 0) {
        scopeCtx.moveTo(x, y);
      } else {
        scopeCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    scopeCtx.stroke();
  }

  requestAnimationFrame(renderOscilloscope);
}

async function evaluateAndPlay(forceRestart: boolean): Promise<void> {
  try {
    const source = codeInput.value;
    const ast = parseDSL(source);

    currentErrorLine = null;
    renderedMatrixSignature = ''; // Force matrix DOM refresh on evaluate
    updateEditorView();

    statusBpm.textContent = String(ast.playback.tempo);

    if (!scheduler.running || forceRestart) {
      await scheduler.start(ast);
      statusState.textContent = 'RUNNING';
      statusState.classList.add('state-running');
      renderSequenceQueue(scheduler.getExpandedQueue(), 0, true);
      logToTerminal(
        `AST compiled (BPM: ${ast.playback.tempo}, queue length: ${
          scheduler.getExpandedQueue().length
        }). Transport started.`,
        'success'
      );
    } else {
      scheduler.loadAST(ast);
      renderSequenceQueue(scheduler.getExpandedQueue(), 0, true);
      logToTerminal(
        `Hot-reloaded AST on the fly (BPM: ${ast.playback.tempo}).`,
        'success'
      );
    }
  } catch (err) {
    if (err instanceof DSLParseError) {
      currentErrorLine = err.line;
      updateEditorView();
      logToTerminal(err.message, 'error');
    } else if (err instanceof Error) {
      logToTerminal(`Runtime Error: ${err.message}`, 'error');
    } else {
      logToTerminal('Unknown execution error.', 'error');
    }
  }
}

function exportProjectFile(): void {
  const source = codeInput.value;
  const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  link.href = url;
  link.download = `modulo-session-${timestamp}.mod`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  logToTerminal(`Exported project to "${link.download}".`, 'success');
}

codeInput.value = PRESETS.empty;
updateEditorView();
drawIdleOscilloscope();
requestAnimationFrame(renderOscilloscope);

codeInput.addEventListener('input', () => {
  if (currentErrorLine !== null) {
    currentErrorLine = null;
  }
  updateEditorView();
});

codeInput.addEventListener('scroll', syncEditorScroll);

codeInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    evaluateAndPlay(false);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === '.') {
    e.preventDefault();
    scheduler.stop();
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    codeInput.value =
      codeInput.value.substring(0, start) + '  ' + codeInput.value.substring(end);
    codeInput.selectionStart = codeInput.selectionEnd = start + 2;
    updateEditorView();
  }
});

btnPlay.addEventListener('click', () => evaluateAndPlay(true));
btnEval.addEventListener('click', () => evaluateAndPlay(false));
btnStop.addEventListener('click', () => scheduler.stop());
btnExport.addEventListener('click', exportProjectFile);

presetSelect.addEventListener('change', () => {
  const key = presetSelect.value;
  if (PRESETS[key]) {
    codeInput.value = PRESETS[key];
    currentErrorLine = null;
    updateEditorView();
    logToTerminal(`Loaded template "${key}". Press [ PLAY ] or Ctrl+Enter.`, 'info');
    if (scheduler.running) {
      evaluateAndPlay(false);
    }
  }
});

btnDocs.addEventListener('click', () => {
  docsModal.classList.remove('hidden');
});

btnCloseDocs.addEventListener('click', () => {
  docsModal.classList.add('hidden');
});

docsModal.addEventListener('click', (e: MouseEvent) => {
  if (e.target === docsModal) {
    docsModal.classList.add('hidden');
  }
});

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && !docsModal.classList.contains('hidden')) {
    docsModal.classList.add('hidden');
  }
});

logToTerminal(
  'MODULO v0.3.1 (Optimized DSP & DOM Engine) ready. Select a preset or press [ PLAY ].',
  'info'
);