import type { StretchMode } from '../types';

const FFT_MIN = 512;
// Matches the original C++: 2^12 * 512 ≈ 2,097,152 at slider=1. The renderer
// rounds to backend constraints, so we don't snap to a power of two here —
// this lets the displayed sample count vary smoothly with the slider, like
// the original UI.
const FFT_MAX = 2097152;

export function sliderToStretch(mode: StretchMode, x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  switch (mode) {
    case 'Stretch':
      return Math.pow(10, Math.pow(clamped, 1.2) * 4);
    case 'HyperStretch':
      return Math.pow(10, Math.pow(clamped, 1.5) * 18);
    case 'Shorten':
      return 1 / Math.pow(10, clamped * 2);
  }
}

export function sliderToFftSize(x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  const raw = 512 * Math.pow(2, Math.pow(clamped, 1.5) * 12);
  return Math.max(FFT_MIN, Math.min(FFT_MAX, Math.round(raw)));
}

export function formatStretchFactor(stretch: number): string {
  if (stretch >= 1000) return stretch.toExponential(2) + 'x';
  if (stretch >= 100) return stretch.toFixed(1) + 'x';
  if (stretch >= 1) return stretch.toFixed(2) + 'x';
  return stretch.toFixed(3) + 'x';
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--:--';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatFftSize(n: number): string {
  if (n >= 1024) return (n / 1024).toFixed(1) + 'K';
  return n.toString();
}

export function fftResolution(fftSize: number, sampleRate: number): { seconds: number; hz: number } {
  return {
    seconds: fftSize / sampleRate,
    hz: sampleRate / fftSize,
  };
}
