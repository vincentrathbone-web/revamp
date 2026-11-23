/** Simple HTML dialogs (file info, open URL, jump to file, about). */
export interface DialogOptions {
  title: string;
  body: HTMLElement | string;
  buttons?: { label: string; primary?: boolean; action?: () => boolean | void }[];
  width?: number;
  /** Close when the user clicks somewhere else (in RevAmp or in another program). */
  closeOnOutside?: boolean;
}

export interface DialogHandle {
  close: () => void;
  el: HTMLElement;
  /** Keeps a click-away dialog open for a moment (e.g. while RevAmp opens a Windows page on purpose). */
  hold: (ms: number) => void;
}

type Area = { x: number; y: number; w: number; h: number };
/** Where dialogs appear (page pixels): the screen the player is on. Unset = the middle of the page. */
let dialogArea: (() => Area | null) | null = null;
export function setDialogArea(fn: () => Area | null): void {
  dialogArea = fn;
}

/** Is page point (x, y) on an open dialog? (The desktop app lets clicks anywhere else through.) */
export function overDialog(x: number, y: number): boolean {
  for (const box of document.querySelectorAll('.rv-dialog')) {
    const r = box.getBoundingClientRect();
    if (x >= r.left && y >= r.top && x < r.right && y < r.bottom) return true;
  }
  return false;
}

export function dialog(opts: DialogOptions): DialogHandle {
  const layer = document.createElement('div');
  layer.className = 'rv-dialog-layer';
  const box = document.createElement('div');
  box.className = 'rv-dialog';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', opts.title);
  if (opts.width) box.style.width = `${opts.width}px`;
  const head = document.createElement('div');
  head.className = 'rv-dialog-title';
  head.textContent = opts.title;
  const x = document.createElement('button');
  x.className = 'rv-dialog-x';
  x.textContent = '×';
  x.setAttribute('aria-label', 'Close');
  head.appendChild(x);
  const body = document.createElement('div');
  body.className = 'rv-dialog-body';
  if (typeof opts.body === 'string') body.textContent = opts.body;
  else body.appendChild(opts.body);
  const foot = document.createElement('div');
  foot.className = 'rv-dialog-buttons';
  let holdUntil = 0;
  const close = () => {
    layer.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('blur', blurred);
  };
  // click-away: a press outside the box, or RevAmp losing focus to another program
  const outside = (e: PointerEvent) => {
    if (!box.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('.rv-menu-layer'))
      close();
  };
  const blurred = () => {
    if (performance.now() >= holdUntil) close();
  };
  if (opts.closeOnOutside) {
    // added after this click is over, so the click that opened the dialog doesn't close it
    setTimeout(() => {
      if (!layer.isConnected) return;
      addEventListener('pointerdown', outside, true);
      addEventListener('blur', blurred);
    }, 0);
  }
  for (const b of opts.buttons ?? [{ label: 'Close', primary: true }]) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.primary) btn.className = 'primary';
    btn.addEventListener('click', () => {
      if (b.action?.() !== false) close();
    });
    foot.appendChild(btn);
  }
  x.addEventListener('click', close);
  layer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      (foot.querySelector('button.primary') as HTMLButtonElement | null)?.click();
    }
    e.stopPropagation();
  });
  box.append(head, body, foot);
  layer.appendChild(box);
  document.body.appendChild(layer);
  // on the player's screen, not in the middle of all monitors together
  const area = dialogArea?.();
  if (area) {
    const r = box.getBoundingClientRect();
    box.style.position = 'fixed';
    box.style.left = `${Math.round(area.x + Math.max(16, (area.w - r.width) / 2))}px`;
    box.style.top = `${Math.round(area.y + Math.max(16, (area.h - r.height) / 2))}px`;
    box.style.maxHeight = `${Math.max(200, area.h - 32)}px`;
  }
  // drag by the title
  head.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect();
    const ox = e.clientX - r.left,
      oy = e.clientY - r.top;
    const mv = (ev: PointerEvent) => {
      box.style.position = 'fixed';
      box.style.left = `${ev.clientX - ox}px`;
      box.style.top = `${ev.clientY - oy}px`;
    };
    const up = () => (removeEventListener('pointermove', mv), removeEventListener('pointerup', up));
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  });
  setTimeout(
    () =>
      (
        (body.querySelector('input,select,textarea,button') as HTMLElement | null) ??
        foot.querySelector('button')
      )?.focus(),
    0,
  );
  return { close, el: body, hold: (ms) => (holdUntil = performance.now() + ms) };
}

export function prompt(title: string, label: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('label');
    wrap.className = 'rv-field';
    wrap.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = initial;
    wrap.appendChild(input);
    let done = false;
    const d = dialog({
      title,
      body: wrap,
      buttons: [
        {
          label: 'Open',
          primary: true,
          action: () => {
            done = true;
            resolve(input.value.trim() || null);
          },
        },
        {
          label: 'Cancel',
          action: () => {
            done = true;
            resolve(null);
          },
        },
      ],
    });
    const obs = new MutationObserver(() => {
      if (!d.el.isConnected) {
        obs.disconnect();
        if (!done) resolve(null);
      }
    });
    obs.observe(document.body, { childList: true });
  });
}

/** A two-column table of facts. */
export function factTable(rows: [string, string | undefined][]): HTMLElement {
  const t = document.createElement('table');
  t.className = 'rv-facts';
  for (const [k, v] of rows) {
    if (v === undefined || v === '') continue;
    const tr = t.insertRow();
    const th = document.createElement('th');
    th.textContent = k;
    tr.appendChild(th);
    tr.insertCell().textContent = v;
  }
  return t;
}
