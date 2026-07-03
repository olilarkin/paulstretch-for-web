import type { AudioSource } from '../types';

function ascii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/**
 * Decode an uncompressed PCM WAV entirely in JS, at the file's native sample
 * rate, without touching the browser's `decodeAudioData` (its most fragile path
 * on iOS Safari). Handles integer PCM (8/16/24/32-bit) and IEEE float
 * (32/64-bit), including `WAVE_FORMAT_EXTENSIBLE`.
 *
 * Returns `null` for anything it doesn't confidently understand — compressed
 * formats (ADPCM, A-law, …), RF64, unusual bit depths, or malformed headers —
 * so the caller can fall back to `decodeAudioData`.
 *
 * Up to two channels are returned (the engine is stereo); extra channels are
 * dropped, matching the previous decode path.
 */
export function decodeWav(arrayBuffer: ArrayBuffer, name: string): AudioSource | null {
  try {
    if (arrayBuffer.byteLength < 44) return null;
    const view = new DataView(arrayBuffer);
    if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') return null;

    let audioFormat = 0;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = -1;
    let dataSize = -1;

    let offset = 12;
    while (offset + 8 <= view.byteLength) {
      const id = ascii(view, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const body = offset + 8;
      if (id === 'fmt ' && size >= 16) {
        audioFormat = view.getUint16(body, true);
        channels = view.getUint16(body + 2, true);
        sampleRate = view.getUint32(body + 4, true);
        bitsPerSample = view.getUint16(body + 14, true);
        // WAVE_FORMAT_EXTENSIBLE: the real format lives in the subformat GUID.
        if (audioFormat === 0xfffe && size >= 40) {
          audioFormat = view.getUint16(body + 24, true);
        }
      } else if (id === 'data') {
        dataOffset = body;
        dataSize = size;
        if (audioFormat !== 0) break; // have fmt + data; data is normally last
      }
      offset = body + size + (size & 1); // chunks are word-aligned
    }

    if (audioFormat === 0 || dataOffset < 0 || dataSize < 0) return null;
    if (channels < 1 || sampleRate < 1) return null;

    const isPcm = audioFormat === 1;
    const isFloat = audioFormat === 3;
    if (!isPcm && !isFloat) return null; // compressed → let the browser try

    const bytesPerSample = bitsPerSample >> 3;
    const blockAlign = bytesPerSample * channels;
    if (bytesPerSample < 1 || blockAlign < 1) return null;

    // Some encoders over-report the data size; never read past the buffer.
    dataSize = Math.min(dataSize, view.byteLength - dataOffset);
    const frames = Math.floor(dataSize / blockAlign);
    if (frames <= 0) return null;

    // Per-sample reader → normalized Float32 in [-1, 1].
    let read: (o: number) => number;
    if (isFloat && bitsPerSample === 32) {
      read = (o) => view.getFloat32(o, true);
    } else if (isFloat && bitsPerSample === 64) {
      read = (o) => view.getFloat64(o, true);
    } else if (isPcm && bitsPerSample === 8) {
      read = (o) => (view.getUint8(o) - 128) / 128; // 8-bit WAV is unsigned
    } else if (isPcm && bitsPerSample === 16) {
      read = (o) => view.getInt16(o, true) / 32768;
    } else if (isPcm && bitsPerSample === 24) {
      read = (o) => {
        const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
        return (v & 0x800000 ? v - 0x1000000 : v) / 8388608; // sign-extend
      };
    } else if (isPcm && bitsPerSample === 32) {
      read = (o) => view.getInt32(o, true) / 2147483648;
    } else {
      return null; // unusual bit depth → fall back
    }

    const outChannels = Math.min(channels, 2);
    const out: Float32Array[] = [];
    for (let c = 0; c < outChannels; c++) out.push(new Float32Array(frames));
    for (let i = 0; i < frames; i++) {
      const frameBase = dataOffset + i * blockAlign;
      for (let c = 0; c < outChannels; c++) {
        out[c][i] = read(frameBase + c * bytesPerSample);
      }
    }

    return { name, sampleRate, durationSec: frames / sampleRate, channels: out };
  } catch {
    return null;
  }
}
