import { describe, expect, it } from 'vitest';
import { loadSettings } from '../../src/config/settings';
import {
  BeatFinder,
  paletteBytes,
  randomPalette,
  randomScene,
  WARP_MODES,
  WAVE_MODES,
} from '../../src/vis/drift';
import { OWN_PRESETS_KEY, PresetLibrary, nextIndex, presetName } from '../../src/vis/presets';

function memoryStore(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    loadSetting: (k: string) => data.get(k) ?? null,
    saveSetting: (k: string, v: string) => void data.set(k, v),
  };
}

const MILK = `[preset00]
fRating=3.000000
fGammaAdj=2.000000
fDecay=0.980000
zoom=1.010000
rot=0.020000
nWaveMode=2
per_frame_1=wave_r = 0.5 + 0.5*sin(time);
per_frame_2=rot = rot + 0.01*bass;
per_pixel_1=zoom = zoom + 0.02*rad;
`;

describe('preset order', () => {
  it('steps forwards and backwards around the list', () => {
    expect(nextIndex(0, 5, false)).toBe(1);
    expect(nextIndex(4, 5, false)).toBe(0);
    expect(nextIndex(0, 5, false, -1)).toBe(4);
    expect(nextIndex(-1, 5, false)).toBe(0);
    expect(nextIndex(3, 0, false)).toBe(-1);
  });

  it('random never repeats the current preset', () => {
    for (let i = 0; i < 200; i++) {
      const r = nextIndex(2, 5, true);
      expect(r).not.toBe(2);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(5);
    }
    expect(nextIndex(0, 1, true)).toBe(0);
    // every other preset can come up
    const seen = new Set([0, 0.3, 0.6, 0.99].map((x) => nextIndex(1, 5, true, 1, () => x)));
    expect([...seen].sort()).toEqual([0, 2, 3, 4]);
  });

  it('names presets after their file', () => {
    expect(presetName('C:\\presets\\Geiss - Swirl 2.milk')).toBe('Geiss - Swirl 2');
    expect(presetName('a/b/My Preset.MILK')).toBe('My Preset');
    expect(presetName('.milk')).toBe('Untitled');
  });
});

describe('own presets', () => {
  it('converts .milk files, keeps them, and removes them again', async () => {
    const store = memoryStore();
    const lib = new PresetLibrary(store);
    const r = await lib.addMilkFiles([
      { name: 'Test - Spin.milk', text: MILK },
      { name: 'Broken.milk', text: '[preset00]\nper_frame_1=a = (((;\n' },
    ]);
    expect(r.added).toContain('Test - Spin');
    const p = lib.find('Test - Spin')!;
    expect(p.own).toBe(true);
    const preset = p.preset as { baseVals: Record<string, number>; frame_eqs_str: string };
    expect(preset.baseVals.zoom).toBeCloseTo(1.01);
    expect(preset.frame_eqs_str).toContain('bass');
    // kept in the store and read back by a new library
    expect(store.data.get(OWN_PRESETS_KEY)).toContain('Test - Spin');
    const again = new PresetLibrary(store);
    expect(again.ownPresets.map((x) => x.name)).toContain('Test - Spin');
    again.remove('Test - Spin');
    expect(new PresetLibrary(store).ownPresets.map((x) => x.name)).not.toContain('Test - Spin');
  });

  it('ignores a damaged store', () => {
    const lib = new PresetLibrary(memoryStore({ [OWN_PRESETS_KEY]: '{not json' }));
    expect(lib.ownPresets).toEqual([]);
  });

  it('loads the built-in pack, sorted, after the own presets', async () => {
    const lib = new PresetLibrary(memoryStore());
    await lib.addMilkFiles([{ name: 'zz mine.milk', text: MILK }]);
    await lib.load();
    expect(lib.all.length).toBe(101);
    expect(lib.all[0]!.name).toBe('zz mine');
    const names = lib.all.slice(1).map((p) => p.name);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    );
  });
});

describe('Drift', () => {
  it('makes scenes within range', () => {
    for (let i = 0; i < 100; i++) {
      const s = randomScene();
      expect(s.warp).toBeGreaterThanOrEqual(0);
      expect(s.warp).toBeLessThan(WARP_MODES.length);
      expect(s.wave).toBeLessThan(WAVE_MODES.length);
      expect(s.zoom).toBeGreaterThan(0.95);
      expect(s.zoom).toBeLessThan(1);
      expect(s.decay).toBeLessThan(1);
      expect(Math.abs(s.rot)).toBeLessThanOrEqual(0.03);
      expect(s.palette).toHaveLength(9);
    }
  });

  it('palettes start black and get brighter', () => {
    for (let i = 0; i < 20; i++) {
      const b = paletteBytes(randomPalette());
      expect([b[0], b[1], b[2], b[3]]).toEqual([0, 0, 0, 255]);
      const lum = (k: number) => b[k * 4]! + b[k * 4 + 1]! + b[k * 4 + 2]!;
      expect(lum(255)).toBeGreaterThan(lum(32));
    }
  });

  it('finds beats in bass bursts, not in steady sound', () => {
    const steady = new BeatFinder();
    let n = 0;
    for (let f = 0; f < 600; f++) if (steady.step(0.5, f / 60)) n++;
    expect(n).toBe(0);

    const pulsing = new BeatFinder();
    n = 0;
    for (let f = 0; f < 600; f++) if (pulsing.step(f % 30 < 3 ? 0.8 : 0.2, f / 60)) n++;
    expect(n).toBeGreaterThanOrEqual(18); // 20 bursts in 10 s
    expect(n).toBeLessThanOrEqual(20);
  });
});

describe('settings', () => {
  it('older settings get the visualization window defaults', () => {
    const s = loadSettings(JSON.stringify({ version: 2, ui: { videoVisible: true } }));
    expect(s.ui.visual.engine).toBe('milkdrop');
    expect(s.ui.visual.visible).toBe(false);
    expect(s.ui.positions.visual).toEqual({ x: 315, y: 272 });
    expect(s.ui.videoVisible).toBe(true);
  });
});
