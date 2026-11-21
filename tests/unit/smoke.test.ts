import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

test('generated assets have a manifest', () => {
  const m = JSON.parse(readFileSync('test-assets/generated/manifest.json', 'utf8')) as Record<string, string>;
  expect(Object.keys(m).length).toBeGreaterThanOrEqual(9);
});
