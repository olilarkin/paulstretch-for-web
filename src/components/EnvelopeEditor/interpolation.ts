import type { Envelope, EnvelopePoint } from '../../types';

/**
 * Sample the envelope at evenly spaced positions in [0,1].
 * Inactive points are skipped (effectively bypassed in the curve).
 * Returns N values matching N positions = linspace(0,1,N).
 */
export function densify(env: Envelope, n = 256): { positions: Float32Array; values: Float32Array } {
  const active = env.points.filter((p) => p.enabled).sort((a, b) => a.position - b.position);
  if (active.length === 0) {
    const positions = new Float32Array(2);
    const values = new Float32Array([1, 1]);
    positions[0] = 0;
    positions[1] = 1;
    return { positions, values };
  }
  const positions = new Float32Array(n);
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    positions[i] = x;
    values[i] = sampleAt(active, x, env.interp);
  }
  if (env.smoothing > 0) {
    smoothInPlace(values, env.smoothing);
  }
  return { positions, values };
}

function sampleAt(points: EnvelopePoint[], x: number, interp: 'Linear' | 'Cosine'): number {
  if (x <= points[0].position) return points[0].value;
  if (x >= points[points.length - 1].position) return points[points.length - 1].value;
  // Find bracketing segment.
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].position <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.position - a.position;
  const t = span > 0 ? (x - a.position) / span : 0;
  if (interp === 'Cosine') {
    const k = (1 - Math.cos(t * Math.PI)) * 0.5;
    return a.value + (b.value - a.value) * k;
  }
  return a.value + (b.value - a.value) * t;
}

function smoothInPlace(values: Float32Array, amount: number): void {
  // Box-filter with radius proportional to amount.
  const radius = Math.max(1, Math.round(amount * values.length * 0.05));
  const tmp = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    for (let j = start; j <= end; j++) {
      sum += values[j];
      count++;
    }
    tmp[i] = sum / count;
  }
  values.set(tmp);
}
