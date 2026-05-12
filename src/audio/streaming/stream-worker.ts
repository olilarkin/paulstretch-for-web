/// <reference lib="webworker" />
import PaulstretchModule, {
  type BinauralBeatsProcessor,
  type PaulstretchModule as PSModule,
  type StreamingStretcher,
} from 'paulstretch-wasm';
import wasmUrl from 'paulstretch-wasm/paulstretch.wasm?url';
import type {
  BinauralConfig,
  MainToWorker,
  ProcessConfig,
  StretcherConfig,
  WorkerToMain,
} from './types';
import type { BinauralStereoMode, WindowType } from '../../types';
import type { RingHandles, RingView } from './ring-buffer';
import { ringAttach, ringReset, ringWrite } from './ring-buffer';

// When the ring is full we yield and retry. 20 ms is much shorter than the
// ring's buffered duration (~1 s by default), so the worklet is never close
// to underrunning. Tighter polling burns CPU; looser polling risks bursty
// production with the worker waking up only to find the ring drained.
const POLL_MS_WHEN_FULL = 20;

let modulePromise: Promise<PSModule> | null = null;
function getModule(): Promise<PSModule> {
  if (!modulePromise) {
    modulePromise = PaulstretchModule({
      locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
    });
  }
  return modulePromise;
}

function mapWindow(M: PSModule, w: WindowType): number {
  switch (w) {
    case 'Rectangular':
      return M.Window.Rectangular;
    case 'Hamming':
      return M.Window.Hamming;
    case 'Hann':
      return M.Window.Hann;
    case 'Blackman':
      return M.Window.Blackman;
    case 'BlackmanHarris':
      return M.Window.BlackmanHarris;
    default:
      return M.Window.Hann;
  }
}

function mapBinauralMode(M: PSModule, mode: BinauralStereoMode): number {
  switch (mode) {
    case 'LeftRight':
      return M.BinauralStereoMode.LeftRight;
    case 'RightLeft':
      return M.BinauralStereoMode.RightLeft;
    case 'Symmetric':
      return M.BinauralStereoMode.Symmetric;
    default:
      return M.BinauralStereoMode.LeftRight;
  }
}

interface Source {
  channels: Float32Array[];
  totalFrames: number;
  sampleRate: number;
}

interface EnvelopeState {
  enabled: boolean;
  positions: Float32Array;
  values: Float32Array;
}

const state = {
  module: null as PSModule | null,
  ring: null as RingView | null,
  source: null as Source | null,
  config: null as StretcherConfig | null,
  processConfig: null as ProcessConfig | null,
  binauralConfig: null as BinauralConfig | null,
  binauralProcessor: null as BinauralBeatsProcessor | null,
  outputSampleRate: 44100,
  envelope: null as EnvelopeState | null,
  stretchers: [] as StreamingStretcher[],
  cursor: 0,
  firstStep: true,
  running: false,
  loop: true,
  inputScratch: [] as Float32Array[],
  pendingOutputs: null as Float32Array[] | null,
  pendingOffset: 0,
  pumpTimer: 0 as number | ReturnType<typeof setTimeout>,
  positionTimer: 0 as number | ReturnType<typeof setInterval>,
};

function post(msg: WorkerToMain, transfer?: Transferable[]): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

function disposeStretchers() {
  for (const s of state.stretchers) {
    try { s.delete(); } catch { /* ignore */ }
  }
  state.stretchers = [];
}

function disposeBinauralProcessor() {
  try { state.binauralProcessor?.delete(); } catch { /* ignore */ }
  state.binauralProcessor = null;
}

function applyProcessConfig(s: StreamingStretcher) {
  const cfg = state.processConfig;
  if (!cfg) return;
  s.setProcessOptions(cfg.options);
  if (cfg.arbitraryFilter.enabled && cfg.arbitraryFilter.positions.length > 0) {
    s.setArbitraryFilter(cfg.arbitraryFilter.positions, cfg.arbitraryFilter.values);
  } else {
    s.clearArbitraryFilter();
  }
}

function applyBinauralConfig() {
  if (!state.module || !state.binauralProcessor || !state.binauralConfig) return;
  const options = state.binauralConfig.options;
  state.binauralProcessor.setOptions({
    enabled: options.enabled,
    stereoMode: mapBinauralMode(state.module, options.stereoMode),
    mono: options.mono,
    beatFrequencyHz: options.beatFrequencyHz,
  });
  if (state.binauralConfig.frequencyEnvelope.positions.length > 0) {
    state.binauralProcessor.setFrequencyEnvelope(
      state.binauralConfig.frequencyEnvelope.positions,
      state.binauralConfig.frequencyEnvelope.values,
    );
  } else {
    state.binauralProcessor.clearFrequencyEnvelope();
  }
}

function ensureBinauralProcessor() {
  if (!state.module) return;
  if (!state.binauralProcessor) {
    state.binauralProcessor = new state.module.BinauralBeatsProcessor(state.outputSampleRate);
  }
  applyBinauralConfig();
}

function rebuildStretchers() {
  if (!state.module || !state.source || !state.config) return;
  disposeStretchers();
  const M = state.module;
  const sr = state.source.sampleRate;
  const win = mapWindow(M, state.config.windowType) as never;
  state.stretchers = state.source.channels.map(
    () =>
      new M.StreamingStretcher(
        state.config!.stretch,
        state.config!.fftSize,
        sr,
        win,
        state.config!.onsetSensitivity,
      ),
  );
  if (state.envelope?.enabled && state.envelope.positions.length > 0) {
    for (const s of state.stretchers) {
      s.setStretchEnvelope(state.envelope.positions, state.envelope.values);
    }
  }
  for (const s of state.stretchers) applyProcessConfig(s);
  const maxIn = state.stretchers[0].maxInputChunk();
  state.inputScratch = state.source.channels.map(() => new Float32Array(maxIn));
  state.firstStep = true;
  // Don't reset the ring on rebuild — already-produced samples play out and
  // the new stretcher's first fill appends behind them. A small phase
  // discontinuity at the seam is audible but no silence drops.
}

function processBinaural(outputs: Float32Array[], positionPct: number): Float32Array[] {
  if (!state.binauralConfig?.options.enabled || !state.binauralProcessor || outputs.length === 0) {
    return outputs;
  }
  const left = outputs[0];
  const right = outputs.length > 1 ? outputs[1] : new Float32Array(left);
  const result = state.binauralProcessor.process(left, right, positionPct);
  return [result.left, result.right];
}

function clearPendingOutput() {
  state.pendingOutputs = null;
  state.pendingOffset = 0;
}

function flushPendingOutput(): boolean {
  if (!state.ring || !state.pendingOutputs) return true;
  const totalFrames = state.pendingOutputs[0]?.length ?? 0;
  const remaining = totalFrames - state.pendingOffset;
  if (remaining <= 0) {
    clearPendingOutput();
    return true;
  }
  const written = ringWrite(
    state.ring,
    state.pendingOutputs,
    remaining,
    state.pendingOffset,
  );
  state.pendingOffset += written;
  if (state.pendingOffset >= totalFrames) {
    clearPendingOutput();
    return true;
  }
  return false;
}

// Produce one block (= bufsize frames per channel) and write into the ring.
// Returns false if the ring is full (caller should yield) or if EOS was
// reached without looping.
function produceOneBlock(stretchOutputs: Float32Array[]): 'wrote' | 'ringFull' | 'done' {
  if (!state.source || !state.stretchers.length || !state.ring) return 'done';
  if (state.pendingOutputs && !flushPendingOutput()) return 'ringFull';
  const totalFrames = state.source.totalFrames;
  const channels = state.source.channels;

  const want = state.firstStep
    ? state.stretchers[0].maxInputChunk()
    : state.stretchers[0].nextInputSize();

  if (want > 0 && state.cursor >= totalFrames && !state.firstStep) {
    if (state.loop) {
      for (const s of state.stretchers) s.reset();
      state.binauralProcessor?.reset();
      if (state.envelope?.enabled && state.envelope.positions.length > 0) {
        for (const s of state.stretchers) {
          s.setStretchEnvelope(state.envelope.positions, state.envelope.values);
        }
      }
      state.cursor = 0;
      state.firstStep = true;
      clearPendingOutput();
      return 'wrote'; // try again on rewound source
    }
    state.running = false;
    post({ type: 'ended' });
    return 'done';
  }

  for (let c = 0; c < channels.length; c++) {
    if (want > 0) {
      const remain = totalFrames - state.cursor;
      const take = Math.min(want, Math.max(0, remain));
      if (take > 0) {
        state.inputScratch[c].set(
          channels[c].subarray(state.cursor, state.cursor + take),
        );
      }
      if (take < want) state.inputScratch[c].fill(0, take, want);
    }
  }

  const positionPct = (100.0 * state.cursor) / totalFrames;
  let maxOnset = 0;
  for (let c = 0; c < channels.length; c++) {
    const result = state.stretchers[c].stepWithoutOnsetFeedback(
      want > 0 ? state.inputScratch[c].subarray(0, want) : null,
      positionPct,
    );
    // Step's wasm-returned Float32Array is freshly allocated each call.
    stretchOutputs[c] = result.output;
    maxOnset = Math.max(maxOnset, result.onset);
  }
  for (const s of state.stretchers) {
    s.applyOnset(maxOnset);
  }

  if (want > 0) state.cursor = Math.min(state.cursor + want, totalFrames);
  const skip = state.stretchers[0].skipAfterStep();
  if (skip > 0) state.cursor = Math.min(state.cursor + skip, totalFrames);

  state.firstStep = false;

  state.pendingOutputs = processBinaural(stretchOutputs, positionPct).slice();
  state.pendingOffset = 0;
  return flushPendingOutput() ? 'wrote' : 'ringFull';
}

function pumpLoop() {
  if (!state.running) return;
  try {
    const tmp: Float32Array[] = [];
    while (state.running) {
      const result = produceOneBlock(tmp);
      if (result === 'ringFull') {
        // Try again after the worklet has drained some samples.
        state.pumpTimer = setTimeout(pumpLoop, POLL_MS_WHEN_FULL);
        return;
      }
      if (result === 'done') return;
    }
  } catch (err) {
    console.error(
      '[paulstretch worker] production threw:',
      err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
    );
    state.running = false;
  }
}

function kickPumpSoon() {
  if (state.pumpTimer) {
    clearTimeout(state.pumpTimer as ReturnType<typeof setTimeout>);
    state.pumpTimer = 0;
  }
  state.pumpTimer = setTimeout(pumpLoop, 0);
}

function startPositionReports() {
  stopPositionReports();
  state.positionTimer = setInterval(() => {
    if (!state.source) return;
    post({
      type: 'position',
      cursor: state.cursor,
      totalFrames: state.source.totalFrames,
      running: state.running,
    });
  }, 100);
}

function stopPositionReports() {
  if (state.positionTimer) {
    clearInterval(state.positionTimer as ReturnType<typeof setInterval>);
    state.positionTimer = 0;
  }
}

async function handleMain(msg: MainToWorker) {
  try {
    if (msg.type === 'init') {
      state.ring = ringAttach(msg.ring as RingHandles);
      state.outputSampleRate = msg.sampleRate;
      const M = await getModule();
      state.module = M;
      ensureBinauralProcessor();
      post({
        type: 'ready',
        backend: M.fftBackendName(),
        simdArch: M.fftSimdArch(),
        simdSize: M.fftSimdSize(),
      });
      return;
    }
    if (msg.type === 'source') {
      state.source = {
        channels: msg.source.channels,
        totalFrames: msg.source.totalFrames,
        sampleRate: msg.source.sampleRate,
      };
      state.cursor = 0;
      state.firstStep = true;
      clearPendingOutput();
      if (state.config) rebuildStretchers();
      state.binauralProcessor?.reset();
      if (state.ring) ringReset(state.ring);
      return;
    }
    if (msg.type === 'params') {
      const prev = state.config;
      state.config = msg.config;
      if (state.module && state.source) {
        const needsRebuild =
          !prev ||
          !state.stretchers.length ||
          prev.fftSize !== msg.config.fftSize ||
          prev.windowType !== msg.config.windowType;
        if (needsRebuild) {
          rebuildStretchers();
        } else {
          for (const s of state.stretchers) {
            if (prev!.stretch !== msg.config.stretch) {
              s.setStretchFactor(msg.config.stretch);
            }
            if (prev!.onsetSensitivity !== msg.config.onsetSensitivity) {
              s.setOnsetDetectionSensitivity(msg.config.onsetSensitivity);
            }
          }
        }
        kickPumpSoon();
      }
      return;
    }
    if (msg.type === 'process') {
      state.processConfig = msg.config;
      for (const s of state.stretchers) applyProcessConfig(s);
      kickPumpSoon();
      return;
    }
    if (msg.type === 'binaural') {
      state.binauralConfig = msg.config;
      ensureBinauralProcessor();
      applyBinauralConfig();
      kickPumpSoon();
      return;
    }
    if (msg.type === 'envelope') {
      state.envelope = {
        enabled: msg.enabled,
        positions: msg.positions,
        values: msg.values,
      };
      if (state.stretchers.length) {
        for (const s of state.stretchers) {
          if (msg.enabled && msg.positions.length > 0) {
            s.setStretchEnvelope(msg.positions, msg.values);
          } else {
            s.clearStretchEnvelope();
          }
        }
        kickPumpSoon();
      }
      return;
    }
    if (msg.type === 'play') {
      if (!state.stretchers.length) return;
      state.running = true;
      startPositionReports();
      kickPumpSoon();
      return;
    }
    if (msg.type === 'pause') {
      state.running = false;
      return;
    }
    if (msg.type === 'stop') {
      state.running = false;
      state.cursor = 0;
      state.firstStep = true;
      clearPendingOutput();
      for (const s of state.stretchers) s.reset();
      state.binauralProcessor?.reset();
      if (state.ring) ringReset(state.ring);
      return;
    }
    if (msg.type === 'seek') {
      if (!state.source) return;
      const frac = Math.max(0, Math.min(1, msg.positionFrac));
      state.cursor = Math.floor(frac * state.source.totalFrames);
      state.firstStep = true;
      clearPendingOutput();
      for (const s of state.stretchers) s.reset();
      state.binauralProcessor?.reset();
      if (state.envelope?.enabled && state.envelope.positions.length > 0) {
        for (const s of state.stretchers) {
          s.setStretchEnvelope(state.envelope.positions, state.envelope.values);
        }
      }
      if (state.ring) ringReset(state.ring);
      if (state.running) kickPumpSoon();
      return;
    }
    if (msg.type === 'loop') {
      state.loop = msg.enabled;
      return;
    }
    if (msg.type === 'shutdown') {
      stopPositionReports();
      disposeStretchers();
      disposeBinauralProcessor();
      state.running = false;
      clearPendingOutput();
      return;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

self.onmessage = (e: MessageEvent<MainToWorker>) => {
  void handleMain(e.data);
};
