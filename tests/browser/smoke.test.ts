import { expect, test } from 'vitest';

test('Web Audio decodes a generated WAV in Edge', async () => {
  const bytes = await (await fetch('/test-assets/generated/tone1k.wav')).arrayBuffer();
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  const buf = await ctx.decodeAudioData(bytes);
  expect(buf.numberOfChannels).toBe(2);
  expect(buf.length).toBe(3 * 44100);
  expect(navigator.userAgent).toContain('Edg');
});
