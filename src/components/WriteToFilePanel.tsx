import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  fftResolution,
  formatDuration,
  formatFftSize,
  formatStretchFactor,
  sliderToStreamingFftSize,
  sliderToStretch,
} from '../state/mappings';
import { densifyLogValuesWithBreakpoints } from './EnvelopeEditor/interpolation';
import type {
  RenderJob,
  RenderMainToWorker,
  RenderWorkerToMain,
} from '../audio/render/types';
import {
  encodeWavPcm16Async,
  estimateWavPcm16Size,
  stretchedFilename,
  WAV_MAX_BYTES,
} from '../audio/render/wav';

type RenderStatus =
  | { kind: 'idle' }
  | { kind: 'rendering'; fraction: number }
  | { kind: 'encoding'; fraction: number }
  | { kind: 'done'; filename: string }
  | { kind: 'error'; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

export function WriteToFilePanel() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const processParams = useStore((s) => s.processParams);
  const binauralParams = useStore((s) => s.binauralParams);
  const envelope = useStore((s) => s.envelope);

  const [status, setStatus] = useState<RenderStatus>({ kind: 'idle' });
  // The last successfully rendered file, kept so the user can Download or Share
  // it. `shareable` is whether the OS share sheet accepts this file (iOS Safari,
  // Android Chrome) — checked once at render time.
  const [rendered, setRendered] = useState<{ file: File; shareable: boolean } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const jobIdRef = useRef(0);

  // The render worker is heavier than the streaming one (it allocates the
  // entire output buffer). Tear it down when the panel unmounts.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const sr = source?.sampleRate ?? 44100;
  const dur = source?.durationSec ?? 0;
  const stretch = sliderToStretch(params.mode, params.stretchSlider);
  // Offline rendering reuses the same FFT-size mapping as preview so the
  // result matches what the user just heard. The streaming-clamped size
  // (<=64K) is enough headroom for everything other than max-slider
  // hyperstretch, and matches what was previewed.
  const fftSize = sliderToStreamingFftSize(params.windowSlider);
  const res = fftResolution(fftSize, sr);
  const numChannels = source?.channels.length ?? 0;
  const outFrames = Math.round(dur * stretch * sr);
  const outBytes = numChannels > 0 ? estimateWavPcm16Size(outFrames, numChannels) : 0;
  const outDurationSec = dur * stretch;
  const tooLarge = outBytes > WAV_MAX_BYTES;

  const buildJob = useCallback((): RenderJob | null => {
    if (!source) return null;
    const { arbitraryFilter, ...processOptions } = processParams;
    const filterCurve = arbitraryFilter.enabled
      ? densifyLogValuesWithBreakpoints(arbitraryFilter, 512)
      : { positions: new Float32Array(0), values: new Float32Array(0) };
    const envCurve = envelope.enabled
      ? densifyLogValuesWithBreakpoints(envelope, 256)
      : null;
    const binauralCurve = densifyLogValuesWithBreakpoints(binauralParams.frequencyEnvelope, 256);

    return {
      jobId: ++jobIdRef.current,
      sampleRate: source.sampleRate,
      channels: source.channels.map((c) => new Float32Array(c)),
      stretch,
      fftSize,
      windowType: params.windowType,
      onsetSensitivity: params.onsetSensitivity,
      processOptions,
      arbitraryFilter: {
        enabled: arbitraryFilter.enabled,
        positions: filterCurve.positions,
        values: filterCurve.values,
      },
      stretchEnvelope: envCurve
        ? { positions: envCurve.positions, values: envCurve.values }
        : null,
      binaural: {
        enabled: binauralParams.enabled,
        stereoMode: binauralParams.stereoMode,
        mono: binauralParams.mono,
        beatFrequencyHz: binauralParams.beatFrequencyHz,
        frequencyEnvelope: {
          positions: binauralCurve.positions,
          values: binauralCurve.values,
        },
      },
    };
  }, [source, params, processParams, binauralParams, envelope, stretch, fftSize]);

  const onRender = useCallback(async () => {
    if (!source) return;
    if (tooLarge) {
      setStatus({
        kind: 'error',
        message: `Output would be ${formatBytes(outBytes)} — exceeds the 4 GiB WAV limit. Lower the stretch factor.`,
      });
      return;
    }
    const job = buildJob();
    if (!job) return;

    // Reuse the worker across renders so the wasm module stays warm.
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../audio/render/render-worker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    const worker = workerRef.current;

    setRendered(null);
    setStatus({ kind: 'rendering', fraction: 0 });

    const transfer = job.channels.map((c) => c.buffer);
    const result = await new Promise<RenderWorkerToMain>((resolve) => {
      const onMessage = (e: MessageEvent<RenderWorkerToMain>) => {
        const m = e.data;
        if (m.type === 'progress' && m.jobId === job.jobId) {
          setStatus({ kind: 'rendering', fraction: m.fraction });
        } else if (m.type === 'rendered' && m.jobId === job.jobId) {
          worker.removeEventListener('message', onMessage);
          resolve(m);
        } else if (m.type === 'error') {
          worker.removeEventListener('message', onMessage);
          resolve(m);
        }
      };
      worker.addEventListener('message', onMessage);
      const msg: RenderMainToWorker = { type: 'render', ...job };
      worker.postMessage(msg, transfer);
    });

    if (result.type === 'error') {
      setStatus({ kind: 'error', message: result.message });
      return;
    }
    if (result.type !== 'rendered') return;

    setStatus({ kind: 'encoding', fraction: 0 });
    try {
      const blob = await encodeWavPcm16Async(result.channels, result.sampleRate, {
        onProgress: (fraction) => setStatus({ kind: 'encoding', fraction }),
      });
      const filename = stretchedFilename(source.name);
      const file = new File([blob], filename, { type: 'audio/wav' });
      // navigator.share() needs its own user gesture, so we stash the result
      // and let the Download / Share buttons act on it.
      const shareable =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
      setRendered({ file, shareable });
      setStatus({ kind: 'done', filename });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [source, buildJob, outBytes, tooLarge]);

  const onDownload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after the browser has consumed the URL. A microtask is too early
    // in some browsers; a second is plenty.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const onShare = useCallback(async (file: File) => {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (err) {
      // AbortError just means the user dismissed the share sheet.
      if ((err as Error)?.name !== 'AbortError') console.error('share failed', err);
    }
  }, []);

  const busy = status.kind === 'rendering' || status.kind === 'encoding';

  return (
    <div className="parameters-panel write-panel">
      <div className="param-row">
        <span className="label">
          Stretch: {formatStretchFactor(stretch)} ({formatDuration(dur * stretch)})
        </span>
      </div>
      <div className="param-row sub">
        <span className="label small">
          Window: {formatFftSize(fftSize)} ({res.seconds.toFixed(4)} s, {res.hz.toFixed(4)} Hz)
        </span>
      </div>
      <hr />
      <div className="param-row">
        <span className="label">Format:</span>
        <span className="value-readout" style={{ minWidth: 0 }}>WAV, 16-bit PCM</span>
        <span className="label small" style={{ marginLeft: 'auto' }}>
          {numChannels === 2 ? 'Stereo' : numChannels === 1 ? 'Mono' : '—'}, {sr} Hz
        </span>
      </div>
      <div className="param-row">
        <span className="label">Output:</span>
        <span className="value-readout">
          {source ? `${formatDuration(outDurationSec)} (${formatBytes(outBytes)})` : '—'}
        </span>
      </div>
      {tooLarge && (
        <div className="param-row">
          <span className="label small" style={{ color: 'var(--accent-red)' }}>
            Exceeds the 4 GiB WAV limit. Lower the stretch factor or shorten the source.
          </span>
        </div>
      )}
      <hr />
      <div className="param-row">
        <button
          className="menu-button"
          disabled={!source || busy || tooLarge}
          onClick={onRender}
          title={!source ? 'Load a source file first' : 'Render a WAV file'}
        >
          {busy ? 'Rendering…' : 'Render'}
        </button>
        <span className="status" style={{ minWidth: 200 }}>
          <span
            className={
              'status-dot ' +
              (status.kind === 'rendering' || status.kind === 'encoding'
                ? 'rendering'
                : status.kind === 'done'
                  ? 'done'
                  : status.kind === 'error'
                    ? 'error'
                    : 'idle')
            }
          />
          {status.kind === 'idle' && 'Idle'}
          {status.kind === 'rendering' && `Rendering… ${Math.round(status.fraction * 100)}%`}
          {status.kind === 'encoding' && `Encoding WAV… ${Math.round(status.fraction * 100)}%`}
          {status.kind === 'done' && `Ready: ${status.filename}`}
          {status.kind === 'error' && `Error: ${status.message}`}
        </span>
      </div>
      {busy && (
        <div className="param-row">
          <progress
            className="render-progress"
            value={status.kind === 'rendering' || status.kind === 'encoding' ? status.fraction : 0}
            max={1}
          />
        </div>
      )}
      {status.kind === 'done' && rendered && (
        <div className="param-row">
          <button
            className="menu-button"
            onClick={() => onDownload(rendered.file)}
            title="Save the WAV file"
          >
            Download
          </button>
          {rendered.shareable && (
            <button
              className="menu-button"
              onClick={() => onShare(rendered.file)}
              title="Share the WAV via the system share sheet"
            >
              Share…
            </button>
          )}
        </div>
      )}
      <div className="param-row sub">
        <span className="label small">
          Renders use the current Parameters / Process / Binaural beats settings. The page may
          appear unresponsive on very long stretches — the work happens in a background worker.
        </span>
      </div>
    </div>
  );
}
