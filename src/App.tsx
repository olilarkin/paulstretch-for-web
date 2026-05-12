import { useEffect, useRef, useState } from 'react';
import { useStore } from './state/store';
import { TitleBar } from './components/TitleBar';
import { FileInfoBar } from './components/FileInfoBar';
import { Tabs } from './components/Tabs';
import { ParametersPanel } from './components/ParametersPanel';
import { TransportBar } from './components/TransportBar';
import { StreamingEngine } from './audio/streaming/engine';
import { syncEngineFromStore } from './audio/streaming/sync';
import { getAudioContext, resumeAudioContext } from './audio/playback';
import { loadAudioFile } from './audio/loadFile';

// Module-level singleton — survives React StrictMode's double-mount.
let enginePromise: Promise<StreamingEngine> | null = null;
function getEngine(): Promise<StreamingEngine> {
  if (!enginePromise) {
    enginePromise = StreamingEngine.create(getAudioContext());
  }
  return enginePromise;
}

export function App() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const envelope = useStore((s) => s.envelope);
  const setSource = useStore((s) => s.setSource);
  const setEngineState = useStore((s) => s.setEngineState);
  const setPlayhead = useStore((s) => s.setPlayhead);

  const engineRef = useRef<StreamingEngine | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Boot the engine once on first mount.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe: Array<() => void> = [];
    setEngineState('loading');
    getEngine()
      .then((e) => {
        if (cancelled) return;
        unsubscribe.push(e.onReady((info) => {
          engineRef.current = e;
          console.log('[paulstretch-wasm]', info.backend, info.simdArch, 'simd-width', info.simdSize);
          setEngineState('ready');
          syncEngineFromStore(e);
        }));
        unsubscribe.push(e.onError((msg) => {
          console.error('[engine error]', msg);
          setEngineState('error', msg);
        }));
        unsubscribe.push(e.onPosition((cursor, total /*, running */) => {
          setPlayhead(cursor, total);
        }));
        unsubscribe.push(e.onEnded(() => {
          setEngineState('ready');
        }));
      })
      .catch((err) => {
        console.error('[engine boot]', err);
        setEngineState('error', err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      engineRef.current = null;
      while (unsubscribe.length > 0) unsubscribe.pop()?.();
    };
  }, [setEngineState, setPlayhead]);

  // Push param changes to the engine.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setParams(params);
  }, [params]);

  // Push envelope changes to the engine.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setEnvelope(envelope);
  }, [envelope]);

  // Push source to engine when it changes.
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !source) return;
    e.loadSource(source);
  }, [source]);

  const onDragOver = (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragActive(true);
  };
  const onDragLeave = (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragActive(false);
  };
  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragActive(false);
    const file = ev.dataTransfer.files?.[0];
    if (!file) return;
    await resumeAudioContext();
    try {
      const src = await loadAudioFile(file);
      setSource(src);
    } catch (err) {
      console.error('decode failed', err);
      alert('Failed to decode audio file: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div
      className={'app' + (dragActive ? ' drag-active' : '')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TitleBar />
      <FileInfoBar />
      <Tabs />
      <div className="panel">
        <ParametersPanel />
      </div>
      <TransportBar engineRef={engineRef} />
    </div>
  );
}
