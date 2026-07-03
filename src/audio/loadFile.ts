import type { AudioSource } from '../types';
import { getAudioContext } from './playback';
import { decodeWav } from './decodeWav';

function ascii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

export function sniffWavSampleRate(arrayBuffer: ArrayBuffer): number | null {
  if (arrayBuffer.byteLength < 44) return null;

  const view = new DataView(arrayBuffer);
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + size > view.byteLength) return null;

    if (id === 'fmt ' && size >= 16) {
      const sampleRate = view.getUint32(dataOffset + 4, true);
      return sampleRate > 0 ? sampleRate : null;
    }

    offset = dataOffset + size + (size & 1);
  }

  return null;
}

export async function loadAudioFile(
  file: File,
  context: AudioContext = getAudioContext(),
  arrayBuffer?: ArrayBuffer,
): Promise<AudioSource> {
  const audioData = arrayBuffer ?? await file.arrayBuffer();

  // Prefer the dependency-free PCM path for uncompressed WAV: it decodes at the
  // file's native rate and never touches the browser's decodeAudioData (its most
  // fragile path on iOS). Only usable when the audio context is already at the
  // file's rate, since the streaming engine plays source samples out 1:1 at the
  // context rate with no resampling. Otherwise fall through to decodeAudioData,
  // which resamples to the context rate.
  const pcm = decodeWav(audioData, file.name);
  if (pcm && pcm.channels.length > 0 && Math.abs(context.sampleRate - pcm.sampleRate) < 1) {
    return pcm;
  }

  const audioBuffer = await context.decodeAudioData(audioData.slice(0));

  const channels: Float32Array[] = [];
  const channelCount = Math.min(audioBuffer.numberOfChannels, 2);
  for (let c = 0; c < channelCount; c++) {
    // Copy because the underlying buffer is owned by the AudioBuffer.
    channels.push(new Float32Array(audioBuffer.getChannelData(c)));
  }

  return {
    name: file.name,
    sampleRate: audioBuffer.sampleRate,
    durationSec: audioBuffer.duration,
    channels,
  };
}
