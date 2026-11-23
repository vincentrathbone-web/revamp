import { afterEach, expect, test } from 'vitest';
import '../../src/styles.css';
import { dialog, overDialog, setDialogArea } from '../../src/ui/dialogs';

afterEach(() => {
  document.querySelectorAll('.rv-dialog-layer').forEach((l) => l.remove());
  setDialogArea(() => null);
});

const tick = () => new Promise((r) => setTimeout(r, 10));

test('a dialog neither dims nor blocks the rest of the page', () => {
  dialog({ title: 'Info', body: 'Hello' });
  const layer = document.querySelector('.rv-dialog-layer') as HTMLElement;
  const box = document.querySelector('.rv-dialog') as HTMLElement;
  expect(getComputedStyle(layer).pointerEvents).toBe('none');
  expect(getComputedStyle(layer).backgroundColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(getComputedStyle(box).pointerEvents).toBe('auto');
  const r = box.getBoundingClientRect();
  expect(overDialog(r.left + 5, r.top + 5)).toBe(true);
  expect(overDialog(r.right + 5, r.top + 5)).toBe(false);
});

test('a dialog opens on the given screen area', () => {
  setDialogArea(() => ({ x: 300, y: 100, w: 600, h: 400 }));
  dialog({ title: 'Info', body: 'Hello', width: 200 });
  const r = document.querySelector('.rv-dialog')!.getBoundingClientRect();
  expect(r.left).toBeGreaterThanOrEqual(300);
  expect(r.right).toBeLessThanOrEqual(900);
  expect(Math.round(r.left + r.width / 2)).toBeCloseTo(600, -1);
});

test('click-away closes, clicks inside and held blur do not', async () => {
  const d = dialog({ title: 'Prefs', body: 'x', closeOnOutside: true });
  await tick();
  const box = document.querySelector('.rv-dialog')!;
  box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(document.querySelector('.rv-dialog')).not.toBeNull();
  // RevAmp losing focus on purpose (opening Windows' Settings) while held
  d.hold(1000);
  dispatchEvent(new Event('blur'));
  expect(document.querySelector('.rv-dialog')).not.toBeNull();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(document.querySelector('.rv-dialog')).toBeNull();

  dialog({ title: 'Prefs', body: 'x', closeOnOutside: true });
  await tick();
  dispatchEvent(new Event('blur')); // clicked another program
  expect(document.querySelector('.rv-dialog')).toBeNull();
});

test('dialogs without click-away stay open', async () => {
  dialog({ title: 'Open location', body: 'x' });
  await tick();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  dispatchEvent(new Event('blur'));
  expect(document.querySelector('.rv-dialog')).not.toBeNull();
});
