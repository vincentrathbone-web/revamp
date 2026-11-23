// Writes docs/KEYS.md from the shortcut table in src/app/keys.ts (through the unit test that also checks it).
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', '--project', 'unit', 'tests/unit/keys-doc.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, UPDATE_DOCS: '1' },
});
process.exit(r.status ?? 1);
