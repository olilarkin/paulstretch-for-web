export type StretchMode = 'Stretch' | 'HyperStretch' | 'Shorten';

export type WindowType =
  | 'Rectangular'
  | 'Hamming'
  | 'Hann'
  | 'Blackman'
  | 'BlackmanHarris';

export type InterpType = 'Linear' | 'Cosine';
export type ActiveTab = 'Parameters' | 'Process' | 'Binaural beats' | 'Write to file';
export type BinauralStereoMode = 'LeftRight' | 'RightLeft' | 'Symmetric';

export interface EnvelopePoint {
  position: number; // 0..1
  value: number;    // multiplier on base stretch
  enabled: boolean;
}

export interface CurvePoint {
  position: number; // 0..1
  value: number;
  enabled: boolean;
}

export interface Envelope {
  enabled: boolean;
  points: EnvelopePoint[];
  interp: InterpType;
  valueMin: number;
  valueMax: number;
  smoothing: number; // 0..1
  selectedIndex: number | null;
}

export interface Curve {
  enabled: boolean;
  points: CurvePoint[];
  interp: InterpType;
  valueMin: number;
  valueMax: number;
  smoothing: number;
  selectedIndex: number | null;
}

export interface Params {
  stretchSlider: number; // 0..1
  mode: StretchMode;
  windowSlider: number;  // 0..1
  windowType: WindowType;
  onsetSensitivity: number; // 0..1
}

export interface ProcessParams {
  pitchShiftEnabled: boolean;
  pitchShiftCents: number;

  octaveEnabled: boolean;
  octaveMinus2: number;
  octaveMinus1: number;
  octave0: number;
  octavePlus1: number;
  octavePlus15: number;
  octavePlus2: number;

  frequencyShiftEnabled: boolean;
  frequencyShiftHz: number;

  compressorEnabled: boolean;
  compressorPower: number;

  filterEnabled: boolean;
  filterLowHz: number;
  filterHighHz: number;
  filterHighDamp: number;
  filterStop: boolean;

  harmonicsEnabled: boolean;
  harmonicsFrequencyHz: number;
  harmonicsBandwidthCents: number;
  harmonicsCount: number;
  harmonicsGauss: boolean;

  spreadEnabled: boolean;
  spreadBandwidth: number;

  tonalNoiseEnabled: boolean;
  tonalNoisePreserve: number;
  tonalNoiseBandwidth: number;

  arbitraryFilter: Curve;
}

export interface BinauralParams {
  enabled: boolean;
  stereoMode: BinauralStereoMode;
  mono: number;
  beatFrequencyHz: number;
  frequencyEnvelope: Curve;
}

export interface AudioSource {
  name: string;
  sampleRate: number;
  durationSec: number;
  channels: Float32Array[]; // 1 (mono) or 2 (stereo)
}

export interface RenderJob {
  jobId: number;
  sampleRate: number;
  channels: Float32Array[]; // mono or stereo
  stretch: number;
  fftSize: number;
  windowType: WindowType;
  onsetSensitivity: number;
  envelope: {
    positions: Float32Array;
    values: Float32Array;
  } | null;
}

export interface RenderResult {
  jobId: number;
  channels: Float32Array[]; // matches input channel count
  sampleRate: number;
}

export type WorkerInbound =
  | { type: 'init' }
  | ({ type: 'render' } & RenderJob);

export type WorkerOutbound =
  | { type: 'ready'; backend: string; simdArch: string; simdSize: number }
  | { type: 'rendered'; result: RenderResult }
  | { type: 'error'; jobId?: number; message: string };
