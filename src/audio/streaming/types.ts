import type { Params, WindowType } from '../../types';

// ── Worker config (subset of Params, already-resolved) ─────────────────────

export interface StretcherConfig {
  stretch: number;       // resolved multiplier (mode mapping already applied)
  fftSize: number;
  windowType: WindowType;
  onsetSensitivity: number;
}

// Stored on the worker; pulled out so the worker doesn't need to know the
// slider→stretch math.
export interface ResolvedParams extends StretcherConfig {
  // Kept for future telemetry / UI mirroring; not required for the wasm side.
  raw: Params;
}

// ── Source descriptor ──────────────────────────────────────────────────────

export interface SourcePayload {
  channels: Float32Array[];   // mono or stereo, at AudioContext sample rate
  sampleRate: number;          // === audioContext.sampleRate
  totalFrames: number;         // == channels[0].length
}

// ── Main → Worker messages ─────────────────────────────────────────────────

export type MainToWorker =
  | { type: 'init'; channelCount: number; sampleRate: number }
  | { type: 'source'; source: SourcePayload }
  | { type: 'params'; config: StretcherConfig }
  | {
      type: 'envelope';
      enabled: boolean;
      positions: Float32Array; // already densified by the host
      values: Float32Array;
    }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; positionFrac: number }
  | { type: 'loop'; enabled: boolean }
  | { type: 'shutdown' };

// ── Worker → Main messages ─────────────────────────────────────────────────

export type WorkerToMain =
  | { type: 'ready'; backend: string; simdArch: string; simdSize: number }
  | { type: 'position'; cursor: number; totalFrames: number; running: boolean }
  | { type: 'ended' }
  | { type: 'error'; message: string };

// ── Worker → Worklet messages (via MessageChannel) ─────────────────────────

export interface AudioBlock {
  // Each entry is one channel of `bufsize` Float32 samples.
  channels: Float32Array[];
  // Monotonic block id; used to correlate acks for flow control.
  blockId: number;
  // True for the final block of the current source — worklet drains it then
  // emits silence until a new source arrives or loop wraps.
  endOfStream: boolean;
}

export type WorkerToWorklet =
  | ({ type: 'block' } & AudioBlock)
  | { type: 'reset' }                  // discard queue (used on seek / param rebuild)
  | { type: 'silence'; durationFrames?: number }; // soft pause: continue running but drain to silence

// ── Worklet → Worker messages ──────────────────────────────────────────────

export type WorkletToWorker =
  | { type: 'ack'; blockId: number }    // worklet finished draining this block
  | { type: 'underrun'; framesMissed: number };
