/**
 * MilkDrop presets: the built-in Butterchurn pack (100 presets, loaded on first use) plus the user's own .milk
 * files, converted once with milkdrop-preset-converter and kept in the settings store.
 */

export interface MilkPreset {
  name: string;
  preset: object;
  /** Added by the user (can be removed again). */
  own?: boolean;
}

/** Storage key for the user's converted presets. */
export const OWN_PRESETS_KEY = 'milkPresets';
/** Keep the store well under the browser's storage limit. */
const MAX_OWN_BYTES = 3_000_000;

export interface PresetStore {
  loadSetting(key: string): string | null;
  saveSetting(key: string, value: string): void;
}

/** Turns a file name like "Author - Name.milk" into the preset's name. */
export function presetName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.milk$/i, '').trim() || 'Untitled';
}

export class PresetLibrary {
  private builtIn: MilkPreset[] | null = null;
  private own: MilkPreset[] = [];

  constructor(private readonly store: PresetStore) {
    try {
      const saved = JSON.parse(store.loadSetting(OWN_PRESETS_KEY) ?? '[]') as {
        name: string;
        preset: object;
      }[];
      if (Array.isArray(saved))
        this.own = saved.filter((p) => p?.name && p.preset).map((p) => ({ ...p, own: true }));
    } catch {
      this.own = [];
    }
  }

  /** Loads the built-in pack (a separate download chunk). */
  async load(): Promise<void> {
    if (this.builtIn) return;
    const mod = await import('butterchurn-presets/lib/butterchurnPresets.min.js');
    // the UMD build can arrive wrapped in `default`s, depending on the bundler
    let pack = mod as unknown as { default?: unknown; getPresets?: () => Record<string, object> };
    while (typeof pack.getPresets !== 'function' && pack.default) pack = pack.default as typeof pack;
    if (typeof pack.getPresets !== 'function') throw new Error('Preset pack did not load');
    this.builtIn = Object.entries(pack.getPresets())
      .map(([name, preset]) => ({ name, preset }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  /** The user's presets first, then the built-in ones. */
  get all(): MilkPreset[] {
    return [...this.own, ...(this.builtIn ?? [])];
  }

  get ownPresets(): readonly MilkPreset[] {
    return this.own;
  }

  find(name: string): MilkPreset | undefined {
    return this.all.find((p) => p.name === name);
  }

  /**
   * Converts .milk files and keeps them. Returns the names added and the files that could not be read.
   * A preset with the same name as an own one replaces it.
   */
  async addMilkFiles(
    files: { name: string; text: string }[],
  ): Promise<{ added: string[]; failed: string[] }> {
    const { convertPreset } = await import('milkdrop-preset-converter');
    const added: string[] = [];
    const failed: string[] = [];
    for (const f of files) {
      try {
        const preset = await convertPreset(f.text);
        const name = presetName(f.name);
        this.own = this.own.filter((p) => p.name !== name);
        this.own.push({ name, preset, own: true });
        added.push(name);
      } catch {
        failed.push(f.name);
      }
    }
    this.own.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    this.save();
    return { added, failed };
  }

  remove(name: string): void {
    this.own = this.own.filter((p) => p.name !== name);
    this.save();
  }

  private save(): void {
    let list = this.own.map(({ name, preset }) => ({ name, preset }));
    let json = JSON.stringify(list);
    // too big: keep the newest additions that fit
    while (json.length > MAX_OWN_BYTES && list.length) {
      list = list.slice(1);
      json = JSON.stringify(list);
    }
    this.store.saveSetting(OWN_PRESETS_KEY, json);
  }
}

/** Picks the next index: in order, or random (never the same one twice in a row when there is a choice). */
export function nextIndex(
  current: number,
  count: number,
  random: boolean,
  step = 1,
  rnd = Math.random,
): number {
  if (count <= 0) return -1;
  if (!random) return (((current + step) % count) + count) % count;
  if (count === 1) return 0;
  const r = Math.floor(rnd() * (count - 1));
  return r >= current && current >= 0 ? r + 1 : r;
}
