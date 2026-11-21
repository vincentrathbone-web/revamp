import { expect, test } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from '../../src/config/settings';

test('round trip keeps every value, including optional ones', () => {
  const s = defaultSettings();
  s.ui.skin = 'D:\\Skins\\cool.wsz';
  s.resumePosition = 61.5;
  s.playlistIndex = 3;
  s.audio.chain.volume = 0.42;
  s.userPresets = [{ name: 'Mine', preampDb: -2, bandsDb: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }];
  expect(loadSettings(saveSettings(s))).toEqual(s);
});

test('missing or broken data gives defaults', () => {
  expect(loadSettings(null)).toEqual(defaultSettings());
  expect(loadSettings('{not json')).toEqual(defaultSettings());
});

test('new settings get defaults; wrong types are ignored', () => {
  const s = loadSettings(JSON.stringify({ version: 2, ui: { snap: 'yes', snapDistance: 15 } }));
  expect(s.ui.snap).toBe(true);
  expect(s.ui.snapDistance).toBe(15);
  expect(s.ui.vis).toEqual(defaultSettings().ui.vis);
});

test('version 1 volume moves into the audio chain', () => {
  const s = loadSettings(JSON.stringify({ version: 1, volume: 0.3 }));
  expect(s.audio.chain.volume).toBe(0.3);
  expect(s.version).toBe(2);
});
