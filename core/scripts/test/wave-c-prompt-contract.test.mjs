import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);

async function read(rel) {
  return await fs.readFile(path.join(ROOT, rel), 'utf8');
}

test('context-packer skill requires nightshift memory-retrieve + embeds the block', async () => {
  const md = await read('core/skills/context-packer/SKILL.md');
  assert.match(md, /nightshift memory-retrieve/);
  assert.match(md, /--markdown/);
  // Must name all four memory surfaces as first-class inputs.
  assert.match(md, /memory\/decisions\.ndjson/);
  assert.match(md, /memory\/incidents\.ndjson/);
  assert.match(md, /memory\/services\.json/);
  assert.match(md, /memory\/reuse-index\.json/);
  // Must include a `Retrieval memory` section in the pack template.
  assert.match(md, /## Retrieval memory/);
  // Must forbid direct file writes to the memory surface.
  assert.match(md, /NEVER write memory files directly/);
});

test('plan-writer skill requires memory-retrieve + decision.recorded via memory-record', async () => {
  const md = await read('core/skills/plan-writer/SKILL.md');
  assert.match(md, /nightshift memory-retrieve/);
  assert.match(md, /--include decisions,reuse,services,incidents/);
  assert.match(md, /nightshift memory-record/);
  // Must declare all four memory surfaces as inputs.
  assert.match(md, /memory\/decisions\.ndjson/);
  assert.match(md, /memory\/reuse-index\.json/);
  assert.match(md, /memory\/services\.json/);
  assert.match(md, /memory\/incidents\.ndjson/);
  // Must say decisions in memory override plan (no silent re-litigation).
  assert.match(md, /Decisions in memory override plan/);
  // Must say "Reuse first".
  assert.match(md, /Reuse first/);
});

test('wave-orchestrator skill consults services.json before infra + records on approve', async () => {
  const md = await read('core/skills/wave-orchestrator/SKILL.md');
  assert.match(md, /nightshift memory-retrieve/);
  assert.match(md, /services\.json/);
  // Must say: read services.json before infra-provisioner dispatch.
  assert.match(md, /infra-provisioner.*services\.json|services\.json.*infra-provisioner/is);
  // Must persist approvals into memory.
  assert.match(md, /nightshift memory-record .* decision/);
  // Must update services.json on newly provisioned infra.
  assert.match(md, /nightshift memory-record service/);
  // Must update reuse-index on newly accepted reusable helpers.
  assert.match(md, /nightshift memory-record reuse/);
  // Incident record on 3 consecutive blocks.
  assert.match(md, /nightshift memory-record .* incident/);
});

test('all three skills explicitly forbid direct file writes to memory surface', async () => {
  const cp = await read('core/skills/context-packer/SKILL.md');
  const pw = await read('core/skills/plan-writer/SKILL.md');
  const wo = await read('core/skills/wave-orchestrator/SKILL.md');
  // Every prompt must carry an explicit raw-write prohibition in addition
  // to recommending the CLI path; "mentions the CLI" is not enough.
  assert.match(cp, /NEVER write memory files directly/);
  assert.match(pw, /NEVER write `memory\/\*\.\{ndjson,json\}` directly/);
  assert.match(wo, /Only the CLI writes `memory\//);
});
