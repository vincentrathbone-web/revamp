/** Preferences dialog: playback, fades, ReplayGain, volume, interface. Plain HTML form bound to settings. */
import { AudioEngine } from '../audio/engine';
import type { FadeEvent } from '../audio/fades';
import { dialog } from '../ui/dialogs';
import type { App } from './app';

type Getter<T> = () => T;
type Setter<T> = (v: T) => void;

function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const r = document.createElement('label');
  r.className = 'rv-pref-row';
  const l = document.createElement('span');
  l.textContent = label;
  r.append(l, control);
  if (hint) r.title = hint;
  return r;
}

function check(get: Getter<boolean>, set: Setter<boolean>): HTMLInputElement {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.checked = get();
  c.addEventListener('change', () => set(c.checked));
  return c;
}

function num(get: Getter<number>, set: Setter<number>, min: number, max: number, step = 1): HTMLInputElement {
  const n = document.createElement('input');
  n.type = 'number';
  n.min = String(min);
  n.max = String(max);
  n.step = String(step);
  n.value = String(get());
  n.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, Number(n.value)));
    if (Number.isFinite(v)) set(v);
    n.value = String(get());
  });
  return n;
}

function choice<T extends string>(get: Getter<T>, set: Setter<T>, options: [T, string][]): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    s.appendChild(o);
  }
  s.value = get();
  s.addEventListener('change', () => set(s.value as T));
  return s;
}

function section(title: string, ...rows: HTMLElement[]): HTMLElement {
  const f = document.createElement('fieldset');
  const lg = document.createElement('legend');
  lg.textContent = title;
  f.append(lg, ...rows);
  return f;
}

const FADE_LABELS: Record<FadeEvent, string> = {
  start: 'Fade in when a track starts',
  firstStart: 'Fade in on first play',
  endOfSong: 'Fade out at end of track',
  pause: 'Fade on pause',
  resume: 'Fade on resume',
  seek: 'Fade on seek',
  stop: 'Fade on stop',
};

export function openPreferences(app: App): void {
  const s = app.settings;
  const a = s.audio;
  const audio = () => app.engine.setSettings(a);
  const save = () => {
    audio();
    app.scheduleSave();
  };
  const ui = () => {
    app.invalidateAll();
    app.scheduleSave();
  };

  const tabs: [string, HTMLElement][] = [];

  tabs.push([
    'Playback',
    section(
      'Playback',
      row(
        'Gapless playback',
        check(
          () => a.gapless,
          (v) => ((a.gapless = v), save()),
        ),
      ),
      row(
        'Crossfade (ms, 0 = off)',
        num(
          () => a.crossfadeMs,
          (v) => ((a.crossfadeMs = v), save()),
          0,
          12000,
          100,
        ),
      ),
      row(
        'Skip silence at start and end',
        check(
          () => a.silenceRemover.enabled,
          (v) => ((a.silenceRemover.enabled = v), save()),
        ),
      ),
      row(
        'Silence threshold (dB)',
        num(
          () => a.silenceRemover.thresholdDb,
          (v) => ((a.silenceRemover.thresholdDb = v), save()),
          -90,
          -20,
        ),
      ),
      row(
        'Stream files longer than (min)',
        num(
          () => a.maxDecodeMinutes,
          (v) => ((a.maxDecodeMinutes = v), save()),
          1,
          180,
        ),
        'Longer files play directly instead of being loaded into memory (no gapless or crossfade for them).',
      ),
    ),
  ]);

  const fadeRows: HTMLElement[] = [];
  for (const ev of Object.keys(FADE_LABELS) as FadeEvent[]) {
    const wrap = document.createElement('span');
    wrap.className = 'rv-pref-pair';
    wrap.append(
      check(
        () => a.fades[ev].enabled,
        (v) => ((a.fades[ev].enabled = v), save()),
      ),
      num(
        () => a.fades[ev].ms,
        (v) => ((a.fades[ev].ms = v), save()),
        0,
        10000,
        10,
      ),
    );
    fadeRows.push(row(FADE_LABELS[ev], wrap));
  }
  fadeRows.push(
    row(
      'Fade curve',
      choice(
        () => a.fadeShape,
        (v) => ((a.fadeShape = v), save()),
        [
          ['log', 'Smooth (logarithmic)'],
          ['linear', 'Linear'],
        ],
      ),
    ),
  );
  tabs.push(['Fades', section('Fades (ms)', ...fadeRows)]);

  const rg = a.replayGain;
  tabs.push([
    'ReplayGain',
    section(
      'ReplayGain',
      row(
        'Use ReplayGain',
        check(
          () => rg.enabled,
          (v) => ((rg.enabled = v), save()),
        ),
      ),
      row(
        'Prefer',
        choice(
          () => rg.source,
          (v) => ((rg.source = v), save()),
          [
            ['track', 'Track gain'],
            ['album', 'Album gain'],
          ],
        ),
      ),
      row(
        'Use the other gain if missing',
        check(
          () => rg.fallbackToOther,
          (v) => ((rg.fallbackToOther = v), save()),
        ),
      ),
      row(
        'Gain for untagged files (dB)',
        num(
          () => rg.noTagGainDb,
          (v) => ((rg.noTagGainDb = v), save()),
          -24,
          12,
          0.5,
        ),
      ),
      row(
        'Extra gain for tagged files (dB)',
        num(
          () => rg.preampDb,
          (v) => ((rg.preampDb = v), save()),
          -12,
          12,
          0.5,
        ),
      ),
      row(
        'Prevent clipping',
        check(
          () => rg.preventClipping,
          (v) => ((rg.preventClipping = v), save()),
        ),
      ),
    ),
  ]);

  const c = a.chain;
  const dev = choice<string>(
    () => s.ui.outputDevice,
    (v) => {
      s.ui.outputDevice = v;
      void app.engine.setOutputDevice(v);
      app.scheduleSave();
    },
    [['', 'System default']],
  );
  void AudioEngine.outputDevices()
    .then((list) => {
      for (const d of list) {
        if (!d.id || d.id === 'default') continue;
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.label || d.id;
        dev.appendChild(o);
      }
      dev.value = s.ui.outputDevice;
    })
    .catch(() => {});
  tabs.push([
    'Output',
    section(
      'Output',
      row('Output device', dev),
      row(
        'Volume curve',
        choice(
          () => c.volumeCurve,
          (v) => ((c.volumeCurve = v), save()),
          [
            ['linear', 'Linear'],
            ['db', 'Decibel (finer at low volume)'],
          ],
        ),
      ),
      row(
        'Volume range (dB)',
        num(
          () => c.volumeRangeDb,
          (v) => ((c.volumeRangeDb = v), save()),
          20,
          100,
        ),
      ),
      row(
        'Smooth volume changes',
        check(
          () => c.smoothVolume,
          (v) => ((c.smoothVolume = v), save()),
        ),
      ),
      row(
        'Mono output',
        check(
          () => c.mono,
          (v) => ((c.mono = v), save()),
        ),
      ),
    ),
  ]);

  tabs.push([
    'Interface',
    section(
      'Interface',
      row(
        'Snap windows together',
        check(
          () => s.ui.snap,
          (v) => ((s.ui.snap = v), ui()),
        ),
      ),
      row(
        'Snap distance (px)',
        num(
          () => s.ui.snapDistance,
          (v) => ((s.ui.snapDistance = v), ui()),
          1,
          40,
        ),
      ),
      row(
        'Scroll long titles',
        check(
          () => s.ui.scrollTitle,
          (v) => ((s.ui.scrollTitle = v), ui()),
        ),
      ),
      row(
        'Use skin cursors',
        check(
          () => s.ui.skinCursors,
          (v) => ((s.ui.skinCursors = v), ui()),
        ),
      ),
      row(
        'Show track numbers',
        check(
          () => s.ui.showNumbers,
          (v) => ((s.ui.showNumbers = v), ui()),
        ),
      ),
      row(
        'Double size includes equalizer',
        check(
          () => s.ui.doubleSizeEq,
          (v) => {
            s.ui.doubleSizeEq = v;
            app.host.sizeChanged('eq');
            ui();
          },
        ),
      ),
    ),
  ]);

  const body = document.createElement('div');
  body.className = 'rv-prefs';
  const nav = document.createElement('div');
  nav.className = 'rv-prefs-nav';
  nav.setAttribute('role', 'tablist');
  const page = document.createElement('div');
  page.className = 'rv-prefs-page';
  const show = (i: number) => {
    page.replaceChildren(tabs[i]![1]);
    [...nav.children].forEach((b, k) => b.classList.toggle('active', k === i));
  };
  tabs.forEach(([name], i) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => show(i));
    nav.appendChild(b);
  });
  body.append(nav, page);
  show(0);
  dialog({ title: 'Preferences', body, width: 560 });
}
