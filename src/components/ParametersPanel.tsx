import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import {
  fftResolution,
  formatDuration,
  formatFftSize,
  formatStretchFactor,
  sliderToStreamingFftSize,
  sliderToStretch,
} from '../state/mappings';
import type { StretchMode, WindowType } from '../types';
import { EnvelopeEditor } from './EnvelopeEditor/EnvelopeEditor';

const MODES: StretchMode[] = ['Stretch', 'HyperStretch', 'Shorten'];
const WINDOWS: WindowType[] = ['Rectangular', 'Hamming', 'Hann', 'Blackman', 'BlackmanHarris'];
const STRETCH_PRESETS = [1, 2, 4, 5, 10, 20, 100];

export function ParametersPanel() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const setStretchSlider = useStore((s) => s.setStretchSlider);
  const setMode = useStore((s) => s.setMode);
  const setWindowSlider = useStore((s) => s.setWindowSlider);
  const setWindowType = useStore((s) => s.setWindowType);
  const setOnsetSensitivity = useStore((s) => s.setOnsetSensitivity);

  const [stretchModalOpen, setStretchModalOpen] = useState(false);
  const [customStretch, setCustomStretch] = useState('');

  const sr = source?.sampleRate ?? 44100;
  const dur = source?.durationSec ?? 0;
  const stretch = sliderToStretch(params.mode, params.stretchSlider);
  const fftSize = sliderToStreamingFftSize(params.windowSlider);
  const res = fftResolution(fftSize, sr);

  const applyStretch = (value: number) => {
    if (!isFinite(value) || value <= 0) return;
    setStretchSlider(inverseStretch(params.mode, value));
    setStretchModalOpen(false);
  };

  return (
    <div className="parameters-panel">
      <div className="param-row">
        <span
          className="label"
          title="Base time-stretch amount. If the Stretch Multiplier graph is enabled, its values multiply this amount."
        >
          Stretch: {formatStretchFactor(stretch)} ({formatDuration(dur * stretch)})
        </span>
        <input
          title="Base time-stretch amount. If the Stretch Multiplier graph is enabled, its values multiply this amount."
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={params.stretchSlider}
          onChange={(e) => setStretchSlider(parseFloat(e.target.value))}
          className="slider grow"
        />
        <span className="inline-control">
          <button className="small-button" title="Choose or enter a stretch factor."
            onClick={() => {
              // Seed the custom field to match the displayed "Stretch: 10.00x"
              // label — not the raw slider float (e.g. 10.0017) — so people
              // never start from an ugly decimal.
              setCustomStretch(formatStretchFactor(stretch).replace(/x$/, ''));
              setStretchModalOpen(true);
            }}
          >
            S
          </button>
          <label title="Choose the stretch scale: normal stretch, extreme stretch, or shortening.">Mode:</label>
          <select
            title="Choose the stretch scale: normal stretch, extreme stretch, or shortening."
            value={params.mode}
            onChange={(e) => setMode(e.target.value as StretchMode)}
          >
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
        <span
          className="label"
          title="FFT window size. Larger windows improve frequency resolution but smear time detail."
        >
          Window size (samples): {formatFftSize(fftSize)}
        </span>
        <input
          title="FFT window size. Larger windows improve frequency resolution but smear time detail."
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={params.windowSlider}
          onChange={(e) => setWindowSlider(parseFloat(e.target.value))}
          className="slider grow"
        />
        <span className="inline-control">
          <label title="Window shape used before spectrum analysis. It changes leakage and transient softness.">Type:</label>
          <select
            title="Window shape used before spectrum analysis. It changes leakage and transient softness."
            value={params.windowType}
            onChange={(e) => setWindowType(e.target.value as WindowType)}
          >
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
        <span
          className="label"
          title="Detect strong attacks and advance input faster around them to reduce transient smearing."
        >
          Onset sensitivity:
        </span>
        <input
          title="Detect strong attacks and advance input faster around them to reduce transient smearing."
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

      {stretchModalOpen &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setStretchModalOpen(false)}>
            <div className="modal stretch-modal" onClick={(e) => e.stopPropagation()}>
              <h2>Stretch factor</h2>
              <div className="stretch-presets">
                {STRETCH_PRESETS.map((v) => (
                  <button
                    key={v}
                    className={'stretch-preset' + (Math.abs(stretch - v) <= v * 0.01 ? ' active' : '')}
                    onClick={() => applyStretch(v)}
                  >
                    {v}×
                  </button>
                ))}
              </div>
              <label className="stretch-custom-label" htmlFor="custom-stretch">
                Custom factor
              </label>
              <form
                className="stretch-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyStretch(parseFloat(customStretch));
                }}
              >
                <input
                  id="custom-stretch"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={customStretch}
                  onChange={(e) => setCustomStretch(e.target.value)}
                />
                <button type="submit">Apply</button>
              </form>
              <button className="modal-cancel" onClick={() => setStretchModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
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
