import type { AudioSource } from '../types';
import { getAudioContext } from './playback';

export async function loadAudioFile(file: File): Promise<AudioSource> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = getAudioContext();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

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
