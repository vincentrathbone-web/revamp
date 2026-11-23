import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keysMarkdown } from '../../src/app/keys-doc';

const file = new URL('../../docs/KEYS.md', import.meta.url);

describe('docs/KEYS.md', () => {
  it('matches the shortcut table (npm run docs:keys rewrites it)', () => {
    const md = keysMarkdown();
    if (process.env.UPDATE_DOCS || !existsSync(file)) writeFileSync(file, md);
    expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(md);
  });
});
