import { describe, expect, it, vi } from 'vitest';
import { loadAudioFile, sniffWavSampleRate } from './loadFile';

function makeWavHeader(sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, 0, true);

  return buffer;
}

describe('sniffWavSampleRate', () => {
  it('reads the sample rate from a PCM WAV header', () => {
    expect(sniffWavSampleRate(makeWavHeader(44100))).toBe(44100);
    expect(sniffWavSampleRate(makeWavHeader(48000))).toBe(48000);
  });

  it('returns null for non-WAV data', () => {
    expect(sniffWavSampleRate(new ArrayBuffer(16))).toBeNull();
  });
});

// A 16-bit stereo WAV with `frames` frames of silence at the given rate.
function makeWav(sampleRate: number, frames: number): ArrayBuffer {
  const dataSize = frames * 4;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (o: number, t: string) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
  writeAscii(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  writeAscii(36, 'data'); view.setUint32(40, dataSize, true);
  return buffer;
}

function fileFrom(buffer: ArrayBuffer, name: string): File {
  return { name, arrayBuffer: async () => buffer } as unknown as File;
}

describe('loadAudioFile', () => {
  it('decodes WAV in JS without decodeAudioData when the rate matches the context', async () => {
    const buffer = makeWav(44100, 100);
    // A context whose decodeAudioData would throw — proves the JS path is used
    // and stays reliable even if the browser codec is broken (the iOS case).
    const decodeAudioData = vi.fn(() => { throw new Error('decodeAudioData must not be called'); });
    const ctx = { sampleRate: 44100, decodeAudioData } as unknown as AudioContext;

    const src = await loadAudioFile(fileFrom(buffer, 'x.wav'), ctx, buffer);
    expect(decodeAudioData).not.toHaveBeenCalled();
    expect(src.sampleRate).toBe(44100);
    expect(src.durationSec).toBeCloseTo(100 / 44100, 9);
    expect(src.channels.length).toBe(2);
  });

  it('falls back to decodeAudioData when the file rate differs from the context', async () => {
    const buffer = makeWav(44100, 100); // 44.1k file, 48k context → must resample
    const fakeBuffer = {
      numberOfChannels: 1,
      sampleRate: 48000,
      duration: 100 / 48000,
      getChannelData: () => new Float32Array(100),
    };
    const decodeAudioData = vi.fn(async () => fakeBuffer as unknown as AudioBuffer);
    const ctx = { sampleRate: 48000, decodeAudioData } as unknown as AudioContext;

    const src = await loadAudioFile(fileFrom(buffer, 'x.wav'), ctx, buffer);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(src.sampleRate).toBe(48000);
  });
});
