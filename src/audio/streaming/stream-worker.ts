/// <reference lib="webworker" />
import PaulstretchModule, {
  type PaulstretchModule as PSModule,
  type StreamingStretcher,
} from 'paulstretch-wasm';
import wasmUrl from 'paulstretch-wasm/paulstretch.wasm?url';
import type {
  MainToWorker,
  StretcherConfig,
  WorkerToMain,
} from './types';
import type { WindowType } from '../../types';
import type { RingHandles, RingView } from './ring-buffer';
import { ringAttach, ringReset, ringWrite, writableFrames } from './ring-buffer';

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
  envelope: null as EnvelopeState | null,
  stretchers: [] as StreamingStretcher[],
  cursor: 0,
  firstStep: true,
  running: false,
  loop: true,
  inputScratch: [] as Float32Array[],
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
  const maxIn = state.stretchers[0].maxInputChunk();
  state.inputScratch = state.source.channels.map(() => new Float32Array(maxIn));
  state.firstStep = true;
  // Don't reset the ring on rebuild — already-produced samples play out and
  // the new stretcher's first fill appends behind them. A small phase
  // discontinuity at the seam is audible but no silence drops.
}

// Produce one block (= bufsize frames per channel) and write into the ring.
// Returns false if the ring is full (caller should yield) or if EOS was
// reached without looping.
function produceOneBlock(stretchOutputs: Float32Array[]): 'wrote' | 'ringFull' | 'done' {
  if (!state.source || !state.stretchers.length || !state.ring) return 'done';
  const totalFrames = state.source.totalFrames;
  const channels = state.source.channels;

  // Need bufsize frames of headroom in the ring before producing — otherwise
  // we'd block in mid-step and overwrite the start of our just-produced
  // block.
  const bufsize = state.stretchers[0].bufsize();
  if (writableFrames(state.ring) < bufsize) return 'ringFull';

  const want = state.firstStep
    ? state.stretchers[0].maxInputChunk()
    : state.stretchers[0].nextInputSize();

  if (want > 0 && state.cursor >= totalFrames && !state.firstStep) {
    if (state.loop) {
      for (const s of state.stretchers) s.reset();
      if (state.envelope?.enabled && state.envelope.positions.length > 0) {
        for (const s of state.stretchers) {
          s.setStretchEnvelope(state.envelope.positions, state.envelope.values);
        }
      }
      state.cursor = 0;
      state.firstStep = true;
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
  for (let c = 0; c < channels.length; c++) {
    const result = state.stretchers[c].step(
      want > 0 ? state.inputScratch[c].subarray(0, want) : null,
      positionPct,
    );
    // Step's wasm-returned Float32Array is freshly allocated each call.
    stretchOutputs[c] = result.output;
  }

  if (want > 0) state.cursor = Math.min(state.cursor + want, totalFrames);
  const skip = state.stretchers[0].skipAfterStep();
  if (skip > 0) state.cursor = Math.min(state.cursor + skip, totalFrames);

  state.firstStep = false;

  ringWrite(state.ring, stretchOutputs, bufsize);
  return 'wrote';
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
      const M = await getModule();
      state.module = M;
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
      if (state.config) rebuildStretchers();
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
      for (const s of state.stretchers) s.reset();
      if (state.ring) ringReset(state.ring);
      return;
    }
    if (msg.type === 'seek') {
      if (!state.source) return;
      const frac = Math.max(0, Math.min(1, msg.positionFrac));
      state.cursor = Math.floor(frac * state.source.totalFrames);
      state.firstStep = true;
      for (const s of state.stretchers) s.reset();
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
      state.running = false;
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
