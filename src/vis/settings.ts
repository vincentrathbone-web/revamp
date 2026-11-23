/** Settings of the visualization window. */

export type VisualEngineId = 'milkdrop' | 'drift';

export interface VisualSettings {
  visible: boolean;
  size: { w: number; h: number };
  engine: VisualEngineId;
  /** Last MilkDrop preset shown (name), so it comes back next time. */
  preset: string;
  /** Change the preset (or Drift scene) by itself every this many seconds; 0 = never. */
  autoNextSec: number;
  /** Next preset is a random one instead of the next in the list. */
  random: boolean;
  /** Seconds to blend from one MilkDrop preset into the next. */
  blendSec: number;
}

export function defaultVisualSettings(): VisualSettings {
  return {
    visible: false,
    size: { w: 275, h: 232 },
    engine: 'milkdrop',
    preset: '',
    autoNextSec: 20,
    random: true,
    blendSec: 2.7,
  };
}
