/** Simple HTML dialogs (file info, open URL, jump to file, about). */
export interface DialogOptions {
  title: string;
  body: HTMLElement | string;
  buttons?: { label: string; primary?: boolean; action?: () => boolean | void }[];
  width?: number;
}

export function dialog(opts: DialogOptions): { close: () => void; el: HTMLElement } {
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
  const close = () => layer.remove();
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
  return { close, el: body };
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
