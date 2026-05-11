import type {
  AudioSource,
  Envelope,
  Params,
} from '../../types';
import { sliderToFftSize, sliderToStretch } from '../../state/mappings';
import { densify } from '../../components/EnvelopeEditor/interpolation';
// Vite's `?worker&url` resolves to a URL that points at a JS-transformed,
// separately-bundled file for the worklet. AudioWorklet.addModule then
// loads it as a module. The same URL works in both dev and prod.
import workletUrl from './stream-worklet.ts?worker&url';
import type { MainToWorker, StretcherConfig, WorkerToMain } from './types';

type PositionListener = (cursor: number, totalFrames: number, running: boolean) => void;
type ErrorListener = (message: string) => void;
type EndedListener = () => void;
type ReadyListener = (info: { backend: string; simdArch: string; simdSize: number }) => void;

export class StreamingEngine {
  private readonly ctx: AudioContext;
  private readonly worker: Worker;
  private readonly node: AudioWorkletNode;
  private ready = false;
  private readyInfo: { backend: string; simdArch: string; simdSize: number } | null = null;
  private playing = false;

  private positionListeners = new Set<PositionListener>();
  private errorListeners = new Set<ErrorListener>();
  private endedListeners = new Set<EndedListener>();
  private readyListeners = new Set<ReadyListener>();

  private constructor(ctx: AudioContext, worker: Worker, node: AudioWorkletNode) {
    this.ctx = ctx;
    this.worker = worker;
    this.node = node;

    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => {
      const m = e.data;
      if (m.type === 'ready') {
        this.ready = true;
        this.readyInfo = { backend: m.backend, simdArch: m.simdArch, simdSize: m.simdSize };
        for (const l of this.readyListeners) l(this.readyInfo);
      } else if (m.type === 'position') {
        for (const l of this.positionListeners) l(m.cursor, m.totalFrames, m.running);
      } else if (m.type === 'ended') {
        this.playing = false;
        for (const l of this.endedListeners) l();
      } else if (m.type === 'error') {
        for (const l of this.errorListeners) l(m.message);
      }
    };
    this.worker.onerror = (e) => {
      for (const l of this.errorListeners) l(e.message || 'Worker error');
    };
  }

  static async create(ctx: AudioContext): Promise<StreamingEngine> {
    await ctx.audioWorklet.addModule(workletUrl);

    const node = new AudioWorkletNode(ctx, 'paulstretch-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.connect(ctx.destination);

    const worker = new Worker(
      new URL('./stream-worker.ts', import.meta.url),
      { type: 'module' },
    );

    // Direct Worker ↔ Worklet pipe via a MessageChannel. Audio blocks flow
    // through this without bouncing through the main thread.
    const channel = new MessageChannel();
    worker.postMessage({ type: '__connect', port: channel.port1 }, [channel.port1]);
    node.port.postMessage({ type: '__connect', port: channel.port2 }, [channel.port2]);

    const engine = new StreamingEngine(ctx, worker, node);
    engine.send({
      type: 'init',
      channelCount: 2,
      sampleRate: ctx.sampleRate,
    });
    return engine;
  }

  private send(msg: MainToWorker, transfer?: Transferable[]): void {
    this.worker.postMessage(msg, transfer ?? []);
  }

  onReady(cb: ReadyListener): () => void {
    this.readyListeners.add(cb);
    // Late-subscribe: if the worker already reported ready, fire immediately.
    if (this.readyInfo) cb(this.readyInfo);
    return () => this.readyListeners.delete(cb);
  }
  onPosition(cb: PositionListener): () => void {
    this.positionListeners.add(cb);
    return () => this.positionListeners.delete(cb);
  }
  onError(cb: ErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }
  onEnded(cb: EndedListener): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  isReady(): boolean { return this.ready; }
  isPlaying(): boolean { return this.playing; }
  audioContext(): AudioContext { return this.ctx; }

  loadSource(source: AudioSource): void {
    const channels = source.channels.map((c) => new Float32Array(c));
    this.send(
      {
        type: 'source',
        source: {
          channels,
          sampleRate: source.sampleRate,
          totalFrames: channels[0].length,
        },
      },
      channels.map((c) => c.buffer),
    );
  }

  setParams(params: Params): void {
    const config: StretcherConfig = {
      stretch: sliderToStretch(params.mode, params.stretchSlider),
      fftSize: sliderToFftSize(params.windowSlider),
      windowType: params.windowType,
      onsetSensitivity: params.onsetSensitivity,
    };
    this.send({ type: 'params', config });
  }

  setEnvelope(envelope: Envelope): void {
    if (envelope.enabled) {
      const { positions, values } = densify(envelope, 256);
      this.send(
        { type: 'envelope', enabled: true, positions, values },
        [positions.buffer, values.buffer],
      );
    } else {
      this.send({
        type: 'envelope',
        enabled: false,
        positions: new Float32Array(0),
        values: new Float32Array(0),
      });
    }
  }

  async play(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.send({ type: 'play' });
    this.playing = true;
  }

  pause(): void {
    this.send({ type: 'pause' });
    this.playing = false;
  }

  stop(): void {
    this.send({ type: 'stop' });
    this.playing = false;
  }

  seek(frac: number): void {
    this.send({ type: 'seek', positionFrac: frac });
  }

  setLoop(enabled: boolean): void {
    this.send({ type: 'loop', enabled });
  }

  destroy(): void {
    this.send({ type: 'shutdown' });
    try { this.node.disconnect(); } catch { /* ignore */ }
    try { this.worker.terminate(); } catch { /* ignore */ }
  }
}
