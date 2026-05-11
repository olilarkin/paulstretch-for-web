import { useStore } from '../../state/store';
import type { InterpType } from '../../types';

export function EnvelopeSidebar() {
  const envelope = useStore((s) => s.envelope);
  const setEnvelopeEnabled = useStore((s) => s.setEnvelopeEnabled);
  const setEnvelopePoints = useStore((s) => s.setEnvelopePoints);
  const setEnvelopeInterp = useStore((s) => s.setEnvelopeInterp);
  const setEnvelopeValueRange = useStore((s) => s.setEnvelopeValueRange);
  const setEnvelopeSmoothing = useStore((s) => s.setEnvelopeSmoothing);
  const clearEnvelope = useStore((s) => s.clearEnvelope);

  const idx = envelope.selectedIndex;
  const selected = idx != null ? envelope.points[idx] : null;

  const updateSelectedPosition = (val: number) => {
    if (idx == null) return;
    const isEndpoint = idx === 0 || idx === envelope.points.length - 1;
    if (isEndpoint) return;
    const next = envelope.points.map((p, i) => (i === idx ? { ...p, position: Math.max(0, Math.min(1, val)) } : p));
    setEnvelopePoints(next);
  };

  const updateSelectedValue = (val: number) => {
    if (idx == null) return;
    const next = envelope.points.map((p, i) => (i === idx ? { ...p, value: val } : p));
    setEnvelopePoints(next);
  };

  return (
    <div className="envelope-sidebar">
      <button
        className={'enable-btn' + (envelope.enabled ? ' on' : '')}
        onClick={() => setEnvelopeEnabled(!envelope.enabled)}
        title="Enable the stretch-multiplier envelope"
      >
        {envelope.enabled ? '■ Enabled' : '□ Enable'}
      </button>
      <label>
        Position
        <input
          type="number"
          step={0.001}
          min={0}
          max={1}
          value={selected ? selected.position.toFixed(3) : ''}
          disabled={!selected}
          onChange={(e) => updateSelectedPosition(parseFloat(e.target.value))}
        />
      </label>
      <label>
        Value
        <input
          type="number"
          step={0.01}
          value={selected ? selected.value.toFixed(4) : ''}
          disabled={!selected}
          onChange={(e) => updateSelectedValue(parseFloat(e.target.value))}
        />
      </label>
      <label>
        Val.Min
        <input
          type="number"
          step={0.01}
          value={envelope.valueMin}
          onChange={(e) => setEnvelopeValueRange(parseFloat(e.target.value), envelope.valueMax)}
        />
      </label>
      <label>
        Val.Max
        <input
          type="number"
          step={1}
          value={envelope.valueMax}
          onChange={(e) => setEnvelopeValueRange(envelope.valueMin, parseFloat(e.target.value))}
        />
      </label>
      <label className="sm-row">
        Sm
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={envelope.smoothing}
          onChange={(e) => setEnvelopeSmoothing(parseFloat(e.target.value))}
        />
      </label>
      <label>
        Interpolate
        <select value={envelope.interp} onChange={(e) => setEnvelopeInterp(e.target.value as InterpType)}>
          <option value="Linear">Linear</option>
          <option value="Cosine">Cosine</option>
        </select>
      </label>
      <button className="clear-btn" onClick={clearEnvelope}>
        clear
      </button>
    </div>
  );
}
