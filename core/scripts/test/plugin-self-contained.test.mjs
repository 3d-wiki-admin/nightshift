import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);

// Scan the executable claude-side surface (hooks + settings + plugin manifest)
// and fail if any reference a path outside the plugin dir.
// Rationale: Claude Code copies the plugin into a cache dir; any literal
// reference to `../core/...`, `NIGHTSHIFT_HOME/core/...`, or similar repo-
// relative paths breaks the installed plugin.
const FORBIDDEN = [
  /\$NIGHTSHIFT_HOME\//,
  /\$\{NIGHTSHIFT_HOME\}/,
  /(?:^|\s|"|')\.\.\/core\//,
  /\$NIGHTSHIFT_HOME\/core\//,
  /\$\{NIGHTSHIFT_HOME[:}]/
];

const SCAN_DIRS = [
  path.join(ROOT, 'claude', 'hooks'),
  path.join(ROOT, 'claude', '.claude-plugin')
];
const SCAN_FILES = [
  path.join(ROOT, 'claude', 'settings.json')
];

async function collectFiles(dir) {
  const out = [];
  async function walk(d) {
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'test') continue; // hooks/test/* is test infra, not plugin surface
        await walk(p);
      } else {
        out.push(p);
      }
    }
  }
  await walk(dir);
  return out;
}

test('claude plugin surface has no repo-relative path references', async () => {
  const files = [];
  for (const d of SCAN_DIRS) files.push(...(await collectFiles(d)));
  for (const f of SCAN_FILES) {
    try { await fs.access(f); files.push(f); } catch {}
  }

  const offenders = [];
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8');
    for (const re of FORBIDDEN) {
      const m = text.match(re);
      if (m) {
        offenders.push({ file: path.relative(ROOT, f), match: m[0].slice(0, 80) });
      }
    }
  }

  if (offenders.length) {
    const detail = offenders.map(o => `  ${o.file}: ${o.match}`).join('\n');
    assert.fail(`claude plugin surface references forbidden paths — installed plugin will break once copied to cache:\n${detail}`);
  }
});

test('claude hooks resolve runtime via NIGHTSHIFT_RUNTIME_DIR or ${PLUGIN_ROOT}', async () => {
  const commonSh = await fs.readFile(path.join(ROOT, 'claude', 'hooks', 'lib', 'common.sh'), 'utf8');
  assert.match(commonSh, /NIGHTSHIFT_RUNTIME_DIR/, 'common.sh must define NIGHTSHIFT_RUNTIME_DIR');
  assert.match(commonSh, /PLUGIN_ROOT=/, 'common.sh must derive PLUGIN_ROOT from its own file path');
  assert.doesNotMatch(commonSh, /NIGHTSHIFT_HOME/, 'common.sh must NOT use NIGHTSHIFT_HOME (legacy)');
});

test('prepare-claude-plugin-runtime.sh produces a MANIFEST.json when runtime is built', async () => {
  const manifest = path.join(ROOT, 'claude', 'bin', 'runtime', 'MANIFEST.json');
  // The runtime is gitignored; presence depends on prepare having been run.
  // In CI and `pnpm test` the package.json runs prepare beforehand, so this
  // should exist. If it doesn't, point developers at the command.
  try { await fs.access(manifest); }
  catch {
    assert.fail('claude/bin/runtime/MANIFEST.json missing — run `bash scripts/prepare-claude-plugin-runtime.sh` first');
  }
  const text = await fs.readFile(manifest, 'utf8');
  const parsed = JSON.parse(text);
  assert.equal(parsed.schema_version, 1);
  assert.ok(parsed.runtime_version);
  assert.ok(Array.isArray(parsed.files) && parsed.files.length > 0);
  for (const f of parsed.files) {
    assert.ok(typeof f.path === 'string' && f.path.length > 0);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
  }
});
