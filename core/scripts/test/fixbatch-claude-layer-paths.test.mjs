import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const CLAUDE_DIR = path.join(ROOT, 'claude');

// TZ fix-batch P0.3: the Claude prompt layer (commands + agents) must not
// reference the repo-relative core/ tree. When the plugin is installed to
// ~/.claude/plugins/cache/... the referenced paths do not exist, and the
// model would silently follow broken instructions. Any skill reference
// must be by name; any schema/template read must go through the CLI.
//
// Runtime helpers that live under claude/bin/runtime/ are shipped with the
// plugin and may legitimately mention "core/skills/..." inside comments;
// they also receive string prompts built at runtime. This test walks the
// prompt-visible surface (claude/commands/**.md + claude/agents/**.md +
// runtime prompt-building scripts) and asserts the token is absent.

async function readAllPromptFiles() {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(path.join(CLAUDE_DIR, 'commands'));
  await walk(path.join(CLAUDE_DIR, 'agents'));
  return files.filter(f => f.endsWith('.md'));
}

const FORBIDDEN_TOKENS = [
  'core/skills/',
  'core/templates/',
  'core/schemas/'
];

test('claude/commands/**.md has no repo-relative core/ paths', async () => {
  const files = (await readAllPromptFiles()).filter(f => f.includes('/commands/'));
  for (const f of files) {
    const body = await fs.readFile(f, 'utf8');
    for (const tok of FORBIDDEN_TOKENS) {
      assert.equal(
        body.includes(tok),
        false,
        `${path.relative(ROOT, f)} must not mention "${tok}" — installed plugin cannot reach repo paths. Reference the skill by name or delegate to the CLI.`
      );
    }
  }
});

test('claude/agents/**.md has no repo-relative core/ paths', async () => {
  const files = (await readAllPromptFiles()).filter(f => f.includes('/agents/'));
  for (const f of files) {
    const body = await fs.readFile(f, 'utf8');
    for (const tok of FORBIDDEN_TOKENS) {
      assert.equal(
        body.includes(tok),
        false,
        `${path.relative(ROOT, f)} must not mention "${tok}" — installed plugin cannot reach repo paths. Reference the skill by name or delegate to the CLI.`
      );
    }
  }
});

test('runtime prompt-building scripts do not hand core/ paths to reviewers', async () => {
  const runtimePrompts = [
    path.join(CLAUDE_DIR, 'bin', 'runtime', 'scripts', 'wave-reviewer.mjs')
  ];
  // Capture only *string literals* that the script would send as the prompt —
  // skip single-line comments (starting with `// `) so we don't flag
  // documentation that explains the relocation.
  for (const f of runtimePrompts) {
    const body = await fs.readFile(f, 'utf8');
    const lines = body.split('\n');
    for (const ln of lines) {
      const trimmed = ln.trim();
      if (trimmed.startsWith('//')) continue;
      for (const tok of FORBIDDEN_TOKENS) {
        assert.equal(
          ln.includes(tok),
          false,
          `${path.relative(ROOT, f)}: runtime prompt line must not contain "${tok}". Line: ${ln}`
        );
      }
    }
  }
});
