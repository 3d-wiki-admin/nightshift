import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);

async function read(rel) {
  return await fs.readFile(path.join(ROOT, rel), 'utf8');
}

// /nightshift command must dispatch on intake + confirm-scaffold + start.
test('claude/commands/nightshift.md declares intake / confirm-scaffold / start subcommands', async () => {
  const md = await read('claude/commands/nightshift.md');
  assert.match(md, /`intake --project/);
  assert.match(md, /`confirm-scaffold`/);
  assert.match(md, /`start`/);
  assert.match(md, /intake-interview/);
});

// intake-interview must require the CLI helper for ALL intake state writes.
test('intake-interview agent requires nightshift intake-record for all intake writes', async () => {
  const md = await read('claude/agents/intake-interview.md');
  assert.match(md, /nightshift intake-record <project-path> q/);
  assert.match(md, /nightshift intake-record <project-path> proposal/);
  assert.match(md, /nightshift intake-record <project-path> approve-last/);
  assert.match(md, /nightshift intake-record <project-path> revision/);
  assert.match(md, /nightshift intake-record <project-path> abort/);

  // Explicit rule: no raw file writes to intake.ndjson.
  assert.match(md, /NEVER write to `\.nightshift\/intake\.ndjson`/);
  // The `tools:` frontmatter must NOT grant Write or Edit.
  const fm = md.split('---')[1] || '';
  assert.doesNotMatch(fm, /\b(Write|Edit|MultiEdit|NotebookEdit)\b/);
});

// intake-interview must NOT scaffold files itself.
test('intake-interview agent explicitly forbids creating files under memory/, tasks/, .github/, scripts/', async () => {
  const md = await read('claude/agents/intake-interview.md');
  assert.match(md, /NEVER create files under `memory\/`/);
  assert.match(md, /NEVER call `nightshift scaffold` directly/);
});

// README must document the v1.1 idea-first flow.
test('README documents the v1.1 flow: nightshift init → /nightshift intake → /nightshift confirm-scaffold → /plan', async () => {
  const md = await read('README.md');
  assert.match(md, /nightshift init/);
  assert.match(md, /\/nightshift intake/);
  assert.match(md, /\/nightshift confirm-scaffold/);
  assert.match(md, /\/plan/);
  // Install docs must use --link-bin.
  assert.match(md, /install\.sh --link-bin/);
});

// /bootstrap is demoted.
test('claude/commands/bootstrap.md is marked INTERNAL recovery, not the public entry', async () => {
  const md = await read('claude/commands/bootstrap.md');
  assert.match(md, /INTERNAL/i);
  assert.match(md, /recovery/i);
  // Steer users to nightshift init.
  assert.match(md, /nightshift init/);
});

// The command surface we claim in the brief must actually resolve.
test('nightshift CLI subcommand surface covers init / scaffold / intake-record', async () => {
  const sh = await read('scripts/nightshift.sh');
  assert.match(sh, /init\|new\)/);
  assert.match(sh, /\n\s*scaffold\)/);
  assert.match(sh, /intake-record\)/);
});
