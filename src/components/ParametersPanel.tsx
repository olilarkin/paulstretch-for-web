import { useStore } from '../state/store';
import {
  fftResolution,
  formatDuration,
  formatFftSize,
  formatStretchFactor,
  sliderToFftSize,
  sliderToStretch,
} from '../state/mappings';
import type { StretchMode, WindowType } from '../types';
import { EnvelopeEditor } from './EnvelopeEditor/EnvelopeEditor';

const MODES: StretchMode[] = ['Stretch', 'HyperStretch', 'Shorten'];
const WINDOWS: WindowType[] = ['Rectangular', 'Hamming', 'Hann', 'Blackman', 'BlackmanHarris'];

export function ParametersPanel() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const setStretchSlider = useStore((s) => s.setStretchSlider);
  const setMode = useStore((s) => s.setMode);
  const setWindowSlider = useStore((s) => s.setWindowSlider);
  const setWindowType = useStore((s) => s.setWindowType);
  const setOnsetSensitivity = useStore((s) => s.setOnsetSensitivity);

  const sr = source?.sampleRate ?? 44100;
  const dur = source?.durationSec ?? 0;
  const stretch = sliderToStretch(params.mode, params.stretchSlider);
  const fftSize = sliderToFftSize(params.windowSlider);
  const res = fftResolution(fftSize, sr);

  return (
    <div className="parameters-panel">
      <div className="param-row">
        <span className="label">
          Stretch: {formatStretchFactor(stretch)} ({formatDuration(dur * stretch)})
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={params.stretchSlider}
          onChange={(e) => setStretchSlider(parseFloat(e.target.value))}
          className="slider grow"
        />
        <span className="inline-control">
          <button className="small-button" title="Edit numerically"
            onClick={() => {
              const v = prompt('Stretch factor (raw multiplier):', stretch.toString());
              if (v == null) return;
              const num = parseFloat(v);
              if (!isFinite(num) || num <= 0) return;
              const x = inverseStretch(params.mode, num);
              setStretchSlider(x);
            }}
          >
            S
          </button>
          <label>Mode:</label>
          <select value={params.mode} onChange={(e) => setMode(e.target.value as StretchMode)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </span>
      </div>
      <hr />
      <div className="param-row">
        <span className="label">Window size (samples): {formatFftSize(fftSize)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={params.windowSlider}
          onChange={(e) => setWindowSlider(parseFloat(e.target.value))}
          className="slider grow"
        />
        <span className="inline-control">
          <label>Type:</label>
          <select value={params.windowType} onChange={(e) => setWindowType(e.target.value as WindowType)}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="param-row sub">
        <span className="label small">
          Resolution: {res.seconds.toFixed(4)} seconds ({res.hz.toFixed(4)} Hz)
        </span>
      </div>
      <div className="param-row">
        <span className="label">Onset sensitivity:</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={params.onsetSensitivity}
          onChange={(e) => setOnsetSensitivity(parseFloat(e.target.value))}
          className="slider onset"
        />
        <span className="value-readout">{params.onsetSensitivity.toFixed(2)}</span>
        <span className="envelope-title">Stretch Multiplier</span>
      </div>
      <EnvelopeEditor />
    </div>
  );
}

function inverseStretch(mode: StretchMode, stretch: number): number {
  // Inverse of the sliderToStretch formulas.
  switch (mode) {
    case 'Stretch': {
      // stretch = pow(10, x^1.2 * 4)  =>  x = (log10(stretch)/4)^(1/1.2)
      const t = Math.log10(stretch) / 4;
      return Math.max(0, Math.min(1, Math.pow(Math.max(0, t), 1 / 1.2)));
    }
    case 'HyperStretch': {
      const t = Math.log10(stretch) / 18;
      return Math.max(0, Math.min(1, Math.pow(Math.max(0, t), 1 / 1.5)));
    }
    case 'Shorten': {
      // stretch = 1 / pow(10, x * 2)  =>  x = -log10(stretch) / 2
      return Math.max(0, Math.min(1, -Math.log10(stretch) / 2));
    }
  }
}
