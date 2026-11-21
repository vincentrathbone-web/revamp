/** Pop-up menus (HTML) with submenus, check marks and shortcuts. */
export type MenuItem =
  | 'sep'
  | {
      label: string;
      shortcut?: string;
      checked?: boolean;
      radio?: boolean;
      disabled?: boolean;
      action?: () => void;
      submenu?: MenuItem[] | (() => MenuItem[]);
    };

let openRoot: HTMLElement | null = null;

export function closeMenus(): void {
  openRoot?.remove();
  openRoot = null;
}

export function showMenu(items: MenuItem[], x: number, y: number): void {
  closeMenus();
  const root = document.createElement('div');
  root.className = 'rv-menu-layer';
  document.body.appendChild(root);
  openRoot = root;
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) closeMenus();
  });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  buildMenu(root, items, x, y, 0);
}

function buildMenu(
  layer: HTMLElement,
  items: MenuItem[],
  x: number,
  y: number,
  depth: number,
  altX?: number,
): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'rv-menu';
  menu.setAttribute('role', 'menu');
  menu.dataset.depth = String(depth);
  const closeChild = () =>
    layer
      .querySelectorAll<HTMLElement>('.rv-menu')
      .forEach((m) => Number(m.dataset.depth) > depth && m.remove());
  for (const it of items) {
    if (it === 'sep') {
      const s = document.createElement('div');
      s.className = 'rv-menu-sep';
      menu.appendChild(s);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'rv-menu-item' + (it.disabled ? ' disabled' : '');
    row.setAttribute('role', 'menuitem');
    row.innerHTML = `<span class="chk">${it.checked ? (it.radio ? '●' : '✓') : ''}</span><span class="lbl"></span><span class="key"></span><span class="sub">${it.submenu ? '▸' : ''}</span>`;
    row.querySelector('.lbl')!.textContent = it.label;
    row.querySelector('.key')!.textContent = it.shortcut ?? '';
    row.addEventListener('pointerenter', () => {
      closeChild();
      if (it.submenu && !it.disabled) {
        const r = row.getBoundingClientRect();
        const sub = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
        buildMenu(layer, sub, r.right - 2, r.top - 3, depth + 1, menu.getBoundingClientRect().left);
      }
    });
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (it.disabled || it.submenu) return;
      closeMenus();
      it.action?.();
    });
    menu.appendChild(row);
  }
  layer.appendChild(menu);
  // keep on screen
  const r = menu.getBoundingClientRect();
  let left = x;
  if (x + r.width > innerWidth)
    left = depth && altX !== undefined ? altX - r.width + 2 : innerWidth - r.width - 2;
  const top = y + r.height > innerHeight ? Math.max(0, innerHeight - r.height - 2) : y;
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${top}px`;
  return menu;
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && openRoot) {
        closeMenus();
        e.stopPropagation();
      }
    },
    true,
  );
  window.addEventListener('blur', closeMenus);
}
