let ctx: AudioContext | null = null;

function createAudioContext(sampleRate?: number): AudioContext {
  if (sampleRate && Number.isFinite(sampleRate) && sampleRate > 0) {
    try {
      return new AudioContext({ sampleRate });
    } catch {
      // Some browsers may reject uncommon rates. Fall back to the device rate;
      // decodeAudioData will then resample consistently to this context.
    }
  }
  return new AudioContext();
}

export function getAudioContext(sampleRate?: number): AudioContext {
  if (!ctx) ctx = createAudioContext(sampleRate);
  return ctx;
}

export function audioContextMatches(sampleRate: number, toleranceHz = 1): boolean {
  return !!ctx && Math.abs(ctx.sampleRate - sampleRate) <= toleranceHz;
}

export async function replaceAudioContext(sampleRate?: number): Promise<AudioContext> {
  const old = ctx;
  ctx = createAudioContext(sampleRate);
  if (old && old.state !== 'closed') {
    try { await old.close(); } catch { /* ignore */ }
  }
  return ctx;
}

export async function resumeAudioContext(context: AudioContext = getAudioContext()): Promise<void> {
  const c = context;
  if (c.state === 'suspended') await c.resume();
}
