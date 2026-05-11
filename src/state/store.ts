import { create } from 'zustand';
import type {
  AudioSource,
  Envelope,
  EnvelopePoint,
  InterpType,
  Params,
  StretchMode,
  WindowType,
} from '../types';

export type EngineState = 'unloaded' | 'loading' | 'ready' | 'playing' | 'error';

interface StoreState {
  source: AudioSource | null;
  params: Params;
  envelope: Envelope;
  engineState: EngineState;
  engineError: string | null;
  // Playback position reported by the streaming engine (in input frames).
  playheadCursor: number;
  playheadTotal: number;

  setSource: (s: AudioSource | null) => void;
  setEngineState: (s: EngineState, error?: string | null) => void;
  setPlayhead: (cursor: number, total: number) => void;

  setStretchSlider: (x: number) => void;
  setMode: (m: StretchMode) => void;
  setWindowSlider: (x: number) => void;
  setWindowType: (w: WindowType) => void;
  setOnsetSensitivity: (x: number) => void;

  setEnvelopeEnabled: (e: boolean) => void;
  setEnvelopePoints: (pts: EnvelopePoint[]) => void;
  setEnvelopeInterp: (i: InterpType) => void;
  setEnvelopeValueRange: (min: number, max: number) => void;
  setEnvelopeSmoothing: (s: number) => void;
  selectEnvelopePoint: (i: number | null) => void;
  clearEnvelope: () => void;
}

const defaultEnvelope: Envelope = {
  enabled: false,
  points: [
    { position: 0, value: 1, enabled: true },
    { position: 1, value: 1, enabled: true },
  ],
  interp: 'Cosine',
  valueMin: 0.1,
  valueMax: 50,
  smoothing: 0,
  selectedIndex: null,
};

const defaultParams: Params = {
  // The original FLTK app defaults to 0.5 (≈55×). Now that the engine is
  // block-streaming there's no buffer-size constraint, so we keep the
  // original default — paulstretch's whole point is heavy stretching.
  stretchSlider: 0.5,
  mode: 'Stretch',
  windowSlider: 0.47,
  windowType: 'Hann',
  onsetSensitivity: 0,
};

export const useStore = create<StoreState>((set) => ({
  source: null,
  params: defaultParams,
  envelope: defaultEnvelope,
  engineState: 'unloaded',
  engineError: null,
  playheadCursor: 0,
  playheadTotal: 0,

  setSource: (s) => set({ source: s }),
  setEngineState: (s, error = null) => set({ engineState: s, engineError: error }),
  setPlayhead: (cursor, total) => set({ playheadCursor: cursor, playheadTotal: total }),

  setStretchSlider: (x) => set((st) => ({ params: { ...st.params, stretchSlider: x } })),
  setMode: (m) => set((st) => ({ params: { ...st.params, mode: m } })),
  setWindowSlider: (x) => set((st) => ({ params: { ...st.params, windowSlider: x } })),
  setWindowType: (w) => set((st) => ({ params: { ...st.params, windowType: w } })),
  setOnsetSensitivity: (x) => set((st) => ({ params: { ...st.params, onsetSensitivity: x } })),

  setEnvelopeEnabled: (e) => set((st) => ({ envelope: { ...st.envelope, enabled: e } })),
  setEnvelopePoints: (pts) =>
    set((st) => ({
      envelope: { ...st.envelope, points: [...pts].sort((a, b) => a.position - b.position) },
    })),
  setEnvelopeInterp: (i) => set((st) => ({ envelope: { ...st.envelope, interp: i } })),
  setEnvelopeValueRange: (min, max) =>
    set((st) => ({ envelope: { ...st.envelope, valueMin: min, valueMax: max } })),
  setEnvelopeSmoothing: (s) => set((st) => ({ envelope: { ...st.envelope, smoothing: s } })),
  selectEnvelopePoint: (i) => set((st) => ({ envelope: { ...st.envelope, selectedIndex: i } })),
  clearEnvelope: () =>
    set((st) => ({
      envelope: {
        ...st.envelope,
        points: [
          { position: 0, value: 1, enabled: true },
          { position: 1, value: 1, enabled: true },
        ],
        selectedIndex: null,
      },
    })),
}));
