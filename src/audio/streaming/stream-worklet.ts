// AudioWorkletGlobalScope-level declarations (not in lib.dom).
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

// Inline message-type duplication: worklet bundle doesn't share module graph
// with the main app, so we redeclare the minimum we need. Kept in sync with
// ./types.ts.
type WorkerToWorklet =
  | {
      type: 'block';
      channels: Float32Array[];
      blockId: number;
      endOfStream: boolean;
    }
  | { type: 'reset' }
  | { type: 'silence'; durationFrames?: number };

type ControlMessage = { type: '__connect'; port: MessagePort };

interface QueueEntry {
  channels: Float32Array[];
  blockId: number;
  endOfStream: boolean;
}

class PaulstretchProcessor extends AudioWorkletProcessor {
  private dataPort: MessagePort | null = null;
  private queue: QueueEntry[] = [];
  private readIdx = 0;
  private framesMissed = 0;
  private lastUnderrunReport = 0;

  constructor() {
    super();
    // The main thread sends us a MessagePort connected to the worker. From
    // then on, all audio block traffic and acks flow through that channel.
    this.port.onmessage = (e: MessageEvent<ControlMessage>) => {
      if (e.data?.type === '__connect' && e.data.port) {
        this.dataPort = e.data.port;
        this.dataPort.onmessage = (ev: MessageEvent<WorkerToWorklet>) => this.handleData(ev.data);
        this.dataPort.start?.();
      }
    };
  }

  private handleData(m: WorkerToWorklet): void {
    if (m.type === 'block') {
      this.queue.push({
        channels: m.channels,
        blockId: m.blockId,
        endOfStream: m.endOfStream,
      });
    } else if (m.type === 'reset' || m.type === 'silence') {
      this.queue.length = 0;
      this.readIdx = 0;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const nFrames = out[0].length;
    const outChannels = out.length;

    for (let i = 0; i < nFrames; i++) {
      // Drop fully-drained blocks.
      while (this.queue.length > 0 && this.readIdx >= this.queue[0].channels[0].length) {
        const finished = this.queue.shift()!;
        this.readIdx = 0;
        this.dataPort?.postMessage({ type: 'ack', blockId: finished.blockId });
      }

      if (this.queue.length === 0) {
        for (let c = 0; c < outChannels; c++) out[c][i] = 0;
        this.framesMissed++;
        continue;
      }

      const block = this.queue[0];
      const inChannels = block.channels.length;
      for (let c = 0; c < outChannels; c++) {
        // Mono-to-stereo: replicate channel 0.
        const src = block.channels[c < inChannels ? c : 0];
        out[c][i] = src[this.readIdx];
      }
      this.readIdx++;
    }

    // Trailing drain so the ack arrives in this tick, not the next.
    while (this.queue.length > 0 && this.readIdx >= this.queue[0].channels[0].length) {
      const finished = this.queue.shift()!;
      this.readIdx = 0;
      this.dataPort?.postMessage({ type: 'ack', blockId: finished.blockId });
    }

    if (this.framesMissed > 0) {
      const now = currentTime;
      if (now - this.lastUnderrunReport > 0.05) {
        this.dataPort?.postMessage({
          type: 'underrun',
          framesMissed: this.framesMissed,
        });
        this.framesMissed = 0;
        this.lastUnderrunReport = now;
      }
    }

    return true;
  }
}

// Keep declared bindings referenced so TSC emit retains them.
void sampleRate;

registerProcessor('paulstretch-processor', PaulstretchProcessor);
