// Tiny AudioContext singleton + resume helper. The previous offline-render
// playback (AudioBufferSourceNode + manual position tracking) has been
// retired in favour of the StreamingEngine, which owns its own
// AudioWorkletNode and routes audio directly to ctx.destination.

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export async function resumeAudioContext(): Promise<void> {
  const c = getAudioContext();
  if (c.state === 'suspended') await c.resume();
}
