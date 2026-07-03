import { describe, it, expect } from 'vitest';
import { decodeWav } from './decodeWav';

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

function writeSample(view: DataView, o: number, v: number, format: number, bits: number): void {
  if (format === 3 && bits === 32) return view.setFloat32(o, v, true);
  if (format === 3 && bits === 64) return view.setFloat64(o, v, true);
  if (bits === 8) return view.setUint8(o, Math.max(0, Math.min(255, Math.round(v * 128 + 128))));
  if (bits === 16) return view.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * 32768))), true);
  if (bits === 24) {
    let x = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388608)));
    if (x < 0) x += 0x1000000;
    view.setUint8(o, x & 0xff);
    view.setUint8(o + 1, (x >> 8) & 0xff);
    view.setUint8(o + 2, (x >> 16) & 0xff);
    return;
  }
  if (bits === 32) return view.setInt32(o, Math.max(-2147483648, Math.min(2147483647, Math.round(v * 2147483648))), true);
  throw new Error('unsupported test bits');
}

interface WavOpts {
  format?: number; // 1 = PCM, 3 = float, 0xfffe = extensible
  channels: number;
  sampleRate: number;
  bits: number;
  data: number[][]; // per-channel samples in [-1, 1]
  extensibleSubFormat?: number; // real format when format === 0xfffe
  dataSizeOverride?: number; // to test over-reported sizes
}

function buildWav(opts: WavOpts): ArrayBuffer {
  const { channels, sampleRate, bits, data } = opts;
  const format = opts.format ?? 1;
  const extensible = format === 0xfffe;
  const frames = data[0].length;
  const bytesPerSample = bits / 8;
  const blockAlign = bytesPerSample * channels;
  const dataSize = frames * blockAlign;
  const fmtSize = extensible ? 40 : 16;
  const buf = new ArrayBuffer(12 + (8 + fmtSize) + (8 + dataSize));
  const view = new DataView(buf);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, buf.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  if (extensible) {
    view.setUint16(36, 22, true); // cbSize
    view.setUint16(38, bits, true); // valid bits
    view.setUint32(40, 0, true); // channel mask
    view.setUint16(44, opts.extensibleSubFormat ?? 1, true); // subformat GUID (first 2 bytes)
  }

  const dataChunk = 12 + 8 + fmtSize;
  writeAscii(view, dataChunk, 'data');
  view.setUint32(dataChunk + 4, opts.dataSizeOverride ?? dataSize, true);
  let o = dataChunk + 8;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      writeSample(view, o, data[c][i], format, bits);
      o += bytesPerSample;
    }
  }
  return buf;
}

// Values chosen to be exactly representable at every tested bit depth.
const V = [0, 0.5, -0.5, 0.25];

describe('decodeWav', () => {
  it('decodes 16-bit stereo with correct metadata and samples', () => {
    const src = decodeWav(buildWav({ channels: 2, sampleRate: 44100, bits: 16, data: [V, [-0.5, 0.25, 0, 0.5]] }), 'x.wav');
    expect(src).not.toBeNull();
    expect(src!.sampleRate).toBe(44100);
    expect(src!.channels.length).toBe(2);
    expect(src!.durationSec).toBeCloseTo(4 / 44100, 9);
    expect(Array.from(src!.channels[0])).toEqual(V);
    expect(Array.from(src!.channels[1])).toEqual([-0.5, 0.25, 0, 0.5]);
  });

  it('decodes 24-bit mono', () => {
    const src = decodeWav(buildWav({ channels: 1, sampleRate: 48000, bits: 24, data: [V] }), 'x.wav');
    expect(src!.sampleRate).toBe(48000);
    for (let i = 0; i < V.length; i++) expect(src!.channels[0][i]).toBeCloseTo(V[i], 6);
  });

  it('decodes 32-bit int mono', () => {
    const src = decodeWav(buildWav({ channels: 1, sampleRate: 44100, bits: 32, data: [V] }), 'x.wav');
    for (let i = 0; i < V.length; i++) expect(src!.channels[0][i]).toBeCloseTo(V[i], 6);
  });

  it('decodes 32-bit float exactly', () => {
    const f = [0, 0.123456, -0.98765, 1, -1];
    const src = decodeWav(buildWav({ format: 3, channels: 1, sampleRate: 96000, bits: 32, data: [f] }), 'x.wav');
    for (let i = 0; i < f.length; i++) expect(src!.channels[0][i]).toBeCloseTo(f[i], 6);
  });

  it('decodes 8-bit unsigned mono', () => {
    const src = decodeWav(buildWav({ channels: 1, sampleRate: 8000, bits: 8, data: [V] }), 'x.wav');
    expect(Array.from(src!.channels[0])).toEqual(V);
  });

  it('handles WAVE_FORMAT_EXTENSIBLE wrapping PCM', () => {
    const src = decodeWav(buildWav({ format: 0xfffe, extensibleSubFormat: 1, channels: 1, sampleRate: 44100, bits: 16, data: [V] }), 'x.wav');
    expect(src).not.toBeNull();
    expect(Array.from(src!.channels[0])).toEqual(V);
  });

  it('caps to two channels', () => {
    const src = decodeWav(buildWav({ channels: 3, sampleRate: 44100, bits: 16, data: [V, V, V] }), 'x.wav');
    expect(src!.channels.length).toBe(2);
  });

  it('clamps an over-reported data size to the buffer', () => {
    const src = decodeWav(buildWav({ channels: 1, sampleRate: 44100, bits: 16, data: [V], dataSizeOverride: 1 << 20 }), 'x.wav');
    expect(src!.channels[0].length).toBe(4); // not the bogus size
  });

  it('returns null for a non-RIFF buffer', () => {
    expect(decodeWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, 'x')).toBeNull();
  });

  it('returns null for a compressed format code (fallback to decodeAudioData)', () => {
    const buf = buildWav({ channels: 1, sampleRate: 44100, bits: 16, data: [V] });
    new DataView(buf).setUint16(20, 0x0011, true); // IMA ADPCM
    expect(decodeWav(buf, 'x.wav')).toBeNull();
  });
});
