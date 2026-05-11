/// <reference lib="webworker" />
import PaulstretchModule, {
  type PaulstretchModule as PSModule,
  type StreamingStretcher,
} from 'paulstretch-wasm';
import wasmUrl from 'paulstretch-wasm/paulstretch.wasm?url';
import type {
  AudioBlock,
  MainToWorker,
  StretcherConfig,
  WorkerToMain,
  WorkerToWorklet,
  WorkletToWorker,
} from './types';
import type { WindowType } from '../../types';

// Flow control: number of blocks the worker may have in flight (sent but not
// yet acked by the worklet). At bufsize=4096 @ 48kHz, one block ≈ 85 ms; HIGH=24
// gives ~2 s of pre-buffered audio, which masks UI jank without burning much
// memory.
const HIGH_WATER = 24;
const LOW_WATER = 12;

// ── Module load ────────────────────────────────────────────────────────────

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

// ── Engine state ───────────────────────────────────────────────────────────

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
  workletPort: null as MessagePort | null,
  source: null as Source | null,
  config: null as StretcherConfig | null,
  envelope: null as EnvelopeState | null,
  stretchers: [] as StreamingStretcher[],     // one per channel
  cursor: 0,                                   // current input cursor (frames)
  firstStep: true,                             // tracks the first-fill state
  running: false,                              // produce or not
  loop: true,                                  // restart at EOS by default
  blocksInFlight: 0,
  nextBlockId: 0,
  inputScratch: [] as Float32Array[],          // sized to max_input_chunk
  pendingResume: false,                        // need to kick the loop after ack
  positionTimer: 0 as number | ReturnType<typeof setInterval>,
};

function post(msg: WorkerToMain, transfer?: Transferable[]): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

function postToWorklet(msg: WorkerToWorklet, transfer?: Transferable[]): void {
  state.workletPort?.postMessage(msg, transfer ?? []);
}

// ── Stretcher lifecycle ────────────────────────────────────────────────────

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
  // After a rebuild we tell the worklet to drop any queued audio so the new
  // sound starts cleanly.
  postToWorklet({ type: 'reset' });
  state.blocksInFlight = 0;
}

// ── Production loop ────────────────────────────────────────────────────────

function produceOneBlock(): boolean {
  if (!state.source || !state.stretchers.length) return false;
  const channels = state.source.channels;
  const totalFrames = state.source.totalFrames;

  const want = state.firstStep
    ? state.stretchers[0].maxInputChunk()
    : state.stretchers[0].nextInputSize();

  // Termination: same heuristic as the offline renderer. After the first
  // step, if we've consumed past the end and the stretcher still wants input,
  // we've reached the EOS tail.
  if (want > 0 && state.cursor >= totalFrames && !state.firstStep) {
    if (state.loop) {
      // Reset the stretcher's DSP state and rewind input. Do NOT clear the
      // worklet queue — already-queued audio plays through, then the loop's
      // new initial fill follows seamlessly. Blocks in flight stay counted
      // because they will be acked normally when drained.
      for (const s of state.stretchers) s.reset();
      // Re-apply envelope after reset (StreamingStretcher.reset preserves it,
      // but setStretchEnvelope's wasm-side rebuild does not survive reset()
      // anymore — actually it does, so this is belt-and-braces).
      if (state.envelope?.enabled && state.envelope.positions.length > 0) {
        for (const s of state.stretchers) {
          s.setStretchEnvelope(state.envelope.positions, state.envelope.values);
        }
      }
      state.cursor = 0;
      state.firstStep = true;
      return true; // produce next block on the rewound source
    }
    // EOS, no loop. Emit a final empty block as a sentinel.
    const empty: AudioBlock = {
      channels: channels.map(() => new Float32Array(state.stretchers[0].bufsize())),
      blockId: state.nextBlockId++,
      endOfStream: true,
    };
    postToWorklet({ type: 'block', ...empty }, empty.channels.map((c) => c.buffer));
    state.running = false;
    post({ type: 'ended' });
    return false;
  }

  // Gather input frames per channel, zero-padding past EOF.
  for (let c = 0; c < channels.length; c++) {
    if (want > 0) {
      const remain = totalFrames - state.cursor;
      const take = Math.min(want, Math.max(0, remain));
      if (take > 0) {
        state.inputScratch[c].set(
          channels[c].subarray(state.cursor, state.cursor + take),
        );
      }
      if (take < want) {
        state.inputScratch[c].fill(0, take, want);
      }
    }
  }

  const positionPct = (100.0 * state.cursor) / totalFrames;
  const outputChannels: Float32Array[] = [];
  for (let c = 0; c < channels.length; c++) {
    const result = state.stretchers[c].step(
      want > 0 ? state.inputScratch[c].subarray(0, want) : null,
      positionPct,
    );
    outputChannels.push(result.output);
  }

  if (want > 0) {
    state.cursor = Math.min(state.cursor + want, totalFrames);
  }
  const skip = state.stretchers[0].skipAfterStep();
  if (skip > 0) state.cursor = Math.min(state.cursor + skip, totalFrames);

  state.firstStep = false;

  const block: AudioBlock = {
    channels: outputChannels,
    blockId: state.nextBlockId++,
    endOfStream: false,
  };
  postToWorklet(
    { type: 'block', ...block },
    outputChannels.map((c) => c.buffer),
  );
  state.blocksInFlight++;
  return true;
}

function pumpLoop() {
  if (!state.running) return;
  try {
    while (state.running && state.blocksInFlight < HIGH_WATER) {
      if (!produceOneBlock()) return;
    }
    state.pendingResume = true;
  } catch (err) {
    console.error(
      '[paulstretch worker] production threw:',
      err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
    );
    state.running = false;
  }
}

function kickPumpSoon() {
  // Yield to the event loop so we don't block postMessage processing.
  setTimeout(() => pumpLoop(), 0);
}

// ── Position reporter ──────────────────────────────────────────────────────

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

// ── Message handling ───────────────────────────────────────────────────────

async function handleMain(msg: MainToWorker) {
  try {
    if (msg.type === 'init') {
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
      return;
    }
    if (msg.type === 'params') {
      const prev = state.config;
      state.config = msg.config;
      // fft_size and window changes require a full rebuild (they're construction
      // parameters). The stretch and onset values flow into the next step
      // naturally, but since the constructor consumed them already we still
      // need to rebuild to apply the new constructor args. For now: rebuild
      // on any param change. A future optimisation can crossfade between old
      // and new stretchers to avoid the click.
      if (state.module && state.source) {
        const needsRebuild =
          !prev ||
          prev.fftSize !== msg.config.fftSize ||
          prev.windowType !== msg.config.windowType ||
          prev.stretch !== msg.config.stretch ||
          prev.onsetSensitivity !== msg.config.onsetSensitivity;
        if (needsRebuild) rebuildStretchers();
        // kick the pump in case we were paused at high-water
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
        // setStretchEnvelope on the wasm side rebuilds internal state, so
        // discard any in-flight queued audio.
        postToWorklet({ type: 'reset' });
        state.blocksInFlight = 0;
        state.firstStep = true;
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
      postToWorklet({ type: 'reset' });
      state.blocksInFlight = 0;
      return;
    }
    if (msg.type === 'seek') {
      if (!state.source) return;
      const frac = Math.max(0, Math.min(1, msg.positionFrac));
      state.cursor = Math.floor(frac * state.source.totalFrames);
      state.firstStep = true;
      for (const s of state.stretchers) s.reset();
      // Re-apply envelope after reset.
      if (state.envelope?.enabled && state.envelope.positions.length > 0) {
        for (const s of state.stretchers) {
          s.setStretchEnvelope(state.envelope.positions, state.envelope.values);
        }
      }
      postToWorklet({ type: 'reset' });
      state.blocksInFlight = 0;
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
      state.workletPort?.close();
      state.workletPort = null;
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

function handleWorklet(msg: WorkletToWorker) {
  if (msg.type === 'ack') {
    state.blocksInFlight = Math.max(0, state.blocksInFlight - 1);
    if (state.pendingResume && state.blocksInFlight <= LOW_WATER) {
      state.pendingResume = false;
      kickPumpSoon();
    }
  } else if (msg.type === 'underrun') {
    // Surfaced as diagnostic only; flow control already handles back-pressure.
    void msg.framesMissed;
  }
}

self.onmessage = (e: MessageEvent) => {
  const data = e.data as MainToWorker | { type: '__connect'; port: MessagePort };
  if ((data as { type: string }).type === '__connect') {
    const portMsg = data as { type: '__connect'; port: MessagePort };
    state.workletPort = portMsg.port;
    state.workletPort.onmessage = (ev) => handleWorklet(ev.data as WorkletToWorker);
    return;
  }
  void handleMain(data as MainToWorker);
};
