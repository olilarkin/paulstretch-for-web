import { useState, type RefObject } from 'react';
import { useStore } from '../state/store';
import { sliderToStretch } from '../state/mappings';
import type { StreamingEngine } from '../audio/streaming/engine';

interface Props {
  engineRef: RefObject<StreamingEngine | null>;
}

export function TransportBar({ engineRef }: Props) {
  const engineState = useStore((s) => s.engineState);
  const engineError = useStore((s) => s.engineError);
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const cursor = useStore((s) => s.playheadCursor);
  const total = useStore((s) => s.playheadTotal);
  const [playing, setPlaying] = useState(false);

  const frac = total > 0 ? cursor / total : 0;
  const stretch = sliderToStretch(params.mode, params.stretchSlider);
  const inputSec = source ? source.durationSec : 0;
  // Input cursor in seconds.
  const inputCurSec = source && total > 0 ? (cursor / total) * inputSec : 0;
  // Estimated total output duration (input × stretch).
  const outputTotalSec = inputSec * stretch;
  const outputCurSec = frac * outputTotalSec;

  const ready = engineState === 'ready' || engineState === 'playing';
  const canPlay = ready && !!source && !playing;
  const canPause = playing;
  const canStop = !!source;

  const handlePlay = async () => {
    const e = engineRef.current;
    if (!e) return;
    await e.play();
    setPlaying(true);
  };
  const handlePause = () => {
    engineRef.current?.pause();
    setPlaying(false);
  };
  const handleStop = () => {
    engineRef.current?.stop();
    setPlaying(false);
  };
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = parseFloat(e.target.value);
    engineRef.current?.seek(f);
  };

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button onClick={handlePlay} disabled={!canPlay} title="Play">▶</button>
        <button onClick={handlePause} disabled={!canPause} title="Pause">❚❚</button>
        <button onClick={handleStop} disabled={!canStop} title="Stop">■</button>
      </div>
      <div className="position-readout">{(frac * 100).toFixed(2)}</div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.0001}
        value={frac}
        onChange={handleSeek}
        className="position-slider"
        disabled={!source}
      />
      <div className="time-readout">
        in: {fmt(inputCurSec)} / {fmt(inputSec)} · out: {fmt(outputCurSec)} / {fmt(outputTotalSec)}
      </div>
      <div className="status">
        <span className={'status-dot ' + (engineState === 'playing' ? 'done' : engineState)}></span>
        {engineState === 'loading' && 'loading wasm…'}
        {engineState === 'ready' && (playing ? 'playing' : 'ready')}
        {engineState === 'unloaded' && 'idle'}
        {engineState === 'error' && (engineError ?? 'error')}
      </div>
    </div>
  );
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
