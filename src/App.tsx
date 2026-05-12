import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './state/store';
import { TitleBar } from './components/TitleBar';
import { FileInfoBar } from './components/FileInfoBar';
import { Tabs } from './components/Tabs';
import { ParametersPanel } from './components/ParametersPanel';
import { ProcessPanel } from './components/ProcessPanel';
import { BinauralPanel } from './components/BinauralPanel';
import { TransportBar } from './components/TransportBar';
import { StreamingEngine } from './audio/streaming/engine';
import { syncEngineFromStore } from './audio/streaming/sync';
import {
  audioContextMatches,
  getAudioContext,
  replaceAudioContext,
  resumeAudioContext,
} from './audio/playback';
import { loadAudioFile, sniffWavSampleRate } from './audio/loadFile';

// Module-level singleton — survives React StrictMode's double-mount.
let activeEngine: StreamingEngine | null = null;
let enginePromise: Promise<StreamingEngine> | null = null;

async function destroyActiveEngine(): Promise<void> {
  if (activeEngine) {
    activeEngine.destroy();
  } else if (enginePromise) {
    try {
      const e = await enginePromise;
      e.destroy();
    } catch {
      // Ignore boot failures; the replacement path will report its own error.
    }
  }
  activeEngine = null;
  enginePromise = null;
}

function createEngine(sampleRate?: number): Promise<StreamingEngine> {
  const ctx = getAudioContext(sampleRate);
  enginePromise = StreamingEngine.create(ctx)
    .then((e) => {
      activeEngine = e;
      return e;
    })
    .catch((err) => {
      activeEngine = null;
      enginePromise = null;
      throw err;
    });
  return enginePromise;
}

async function getEngine(sampleRate?: number): Promise<StreamingEngine> {
  if (activeEngine) {
    if (sampleRate && !audioContextMatches(sampleRate)) {
      await destroyActiveEngine();
      await replaceAudioContext(sampleRate);
      return createEngine(sampleRate);
    }
    return activeEngine;
  }

  if (enginePromise) {
    const e = await enginePromise;
    if (sampleRate && Math.abs(e.audioContext().sampleRate - sampleRate) > 1) {
      await destroyActiveEngine();
      await replaceAudioContext(sampleRate);
      return createEngine(sampleRate);
    }
    return e;
  }

  if (sampleRate && !audioContextMatches(sampleRate)) {
    await replaceAudioContext(sampleRate);
  }
  if (!enginePromise) {
    enginePromise = createEngine(sampleRate);
  }
  return enginePromise;
}

export function App() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const processParams = useStore((s) => s.processParams);
  const binauralParams = useStore((s) => s.binauralParams);
  const envelope = useStore((s) => s.envelope);
  const activeTab = useStore((s) => s.activeTab);
  const setSource = useStore((s) => s.setSource);
  const setEngineState = useStore((s) => s.setEngineState);
  const setPlayhead = useStore((s) => s.setPlayhead);

  const engineRef = useRef<StreamingEngine | null>(null);
  const unsubscribeRef = useRef<Array<() => void>>([]);
  const [dragActive, setDragActive] = useState(false);

  const detachEngine = useCallback(() => {
    engineRef.current = null;
    while (unsubscribeRef.current.length > 0) unsubscribeRef.current.pop()?.();
  }, []);

  const attachEngine = useCallback((e: StreamingEngine) => {
    detachEngine();
    engineRef.current = e;
    unsubscribeRef.current.push(e.onReady((info) => {
      console.log('[paulstretch-wasm]', info.backend, info.simdArch, 'simd-width', info.simdSize);
      setEngineState('ready');
      syncEngineFromStore(e);
    }));
    unsubscribeRef.current.push(e.onError((msg) => {
      console.error('[engine error]', msg);
      setEngineState('error', msg);
    }));
    unsubscribeRef.current.push(e.onPosition((cursor, total /*, running */) => {
      setPlayhead(cursor, total);
    }));
    unsubscribeRef.current.push(e.onEnded(() => {
      setEngineState('ready');
    }));
  }, [detachEngine, setEngineState, setPlayhead]);

  // Boot the engine once on first mount.
  useEffect(() => {
    let cancelled = false;
    setEngineState('loading');
    getEngine()
      .then((e) => {
        if (cancelled) return;
        attachEngine(e);
      })
      .catch((err) => {
        console.error('[engine boot]', err);
        setEngineState('error', err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      detachEngine();
    };
  }, [attachEngine, detachEngine, setEngineState]);

  // Push param changes to the engine.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setParams(params);
  }, [params]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setProcessParams(processParams);
  }, [processParams]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setBinauralParams(binauralParams);
  }, [binauralParams]);

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
  const loadFileIntoEngine = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const sampleRate = sniffWavSampleRate(arrayBuffer) ?? undefined;
      setEngineState('loading');
      const e = await getEngine(sampleRate);
      attachEngine(e);
      await resumeAudioContext(e.audioContext());
      const src = await loadAudioFile(file, e.audioContext(), arrayBuffer);
      setSource(src);
    } catch (err) {
      console.error('decode failed', err);
      alert('Failed to decode audio file: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [attachEngine, setEngineState, setSource]);

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragActive(false);
    await loadFileIntoEngine(ev.dataTransfer.files?.[0]);
  };

  return (
    <div
      className={'app' + (dragActive ? ' drag-active' : '')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TitleBar onFile={loadFileIntoEngine} />
      <FileInfoBar />
      <Tabs />
      <div className="panel">
        {activeTab === 'Parameters' && <ParametersPanel />}
        {activeTab === 'Process' && <ProcessPanel />}
        {activeTab === 'Binaural beats' && <BinauralPanel />}
        {activeTab === 'Write to file' && <ParametersPanel />}
      </div>
      <TransportBar engineRef={engineRef} />
    </div>
  );
}
