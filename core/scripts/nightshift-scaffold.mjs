#!/usr/bin/env node
// nightshift-scaffold.mjs — post-approval scaffold for `nightshift scaffold <path>`.
//
// Preconditions:
//   - `<path>/.nightshift/intake-pending` exists (project was init'd).
//   - `<path>/.nightshift/intake.ndjson` contains at least one
//     kind=proposal line with approved=true.
//
// Actions:
//   1. Locate the templates dir (sibling of this script under core/templates/).
//   2. Pick template by proposal.template (default next-supabase-vercel).
//   3. Copy template files into the project, with substitutions for <project>.
//   4. Populate memory/constitution.md and tasks/spec.md from intake answers.
//   5. Emit decision.recorded event in tasks/events.ndjson (via dispatch).
//   6. Update registry stage=ready, fill template/stack/providers fields.
//   7. Return summary.

import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '../registry/index.mjs';
import { appendEvent } from './dispatch.mjs';
import { sessionId as genSessionId } from '../event-store/src/id.mjs';

export class ScaffoldError extends Error {
  constructor(msg, { code = 'SCAFFOLD_ERROR' } = {}) {
    super(msg);
    this.name = 'ScaffoldError';
    this.code = code;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function templatesRoot() {
  // core/scripts/nightshift-scaffold.mjs → ../../templates → core/templates/
  return path.resolve(__dirname, '..', 'templates');
}

export async function findApprovedProposal(project) {
  const logPath = path.join(project, '.nightshift', 'intake.ndjson');
  let text;
  try { text = await fs.readFile(logPath, 'utf8'); }
  catch { throw new ScaffoldError(`intake log not found at ${logPath}. Run 'nightshift init' + '/nightshift intake' first.`, { code: 'NO_INTAKE' }); }

  const lines = text.split('\n').filter(Boolean);
  let questions = [];
  let proposal = null;
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (e.kind === 'q') questions.push(e);
      if (e.kind === 'proposal') proposal = e;
    } catch { /* ignore malformed */ }
  }

  if (!proposal) throw new ScaffoldError('no proposal found in intake.ndjson — the interview did not finish.', { code: 'NO_PROPOSAL' });
  if (proposal.approved !== true) throw new ScaffoldError('latest proposal is not approved — run /nightshift intake through to approval first.', { code: 'NOT_APPROVED' });

  return { proposal, questions };
}

async function pathExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function copyTree(srcDir, dstDir, { substitutions = {}, excludeRel = [] } = {}) {
  const copied = [];
  const skipped = [];
  const excludeSet = new Set(excludeRel);
  async function walk(src, dst) {
    await fs.mkdir(dst, { recursive: true });
    for (const name of await fs.readdir(src)) {
      const s = path.join(src, name);
      const d = path.join(dst, name);
      const rel = path.relative(dstDir, d);
      if (excludeSet.has(rel)) {
        skipped.push(rel);
        continue;
      }
      const stat = await fs.stat(s);
      if (stat.isDirectory()) {
        await walk(s, d);
      } else {
        if (await pathExists(d)) {
          skipped.push(path.relative(dstDir, d));
          continue;
        }
        let content;
        if (/\.(md|json|yaml|yml|ts|tsx|js|mjs|jsx|sh|template|env|txt|example)$/.test(name) || !path.extname(name)) {
          content = await fs.readFile(s, 'utf8');
          for (const [key, value] of Object.entries(substitutions)) {
            content = content.split(`<${key}>`).join(value);
          }
          await fs.writeFile(d, content, 'utf8');
        } else {
          content = await fs.readFile(s);
          await fs.writeFile(d, content);
        }
        copied.push(path.relative(dstDir, d));
      }
    }
  }
  if (await pathExists(srcDir)) await walk(srcDir, dstDir);
  return { copied, skipped };
}

// Build a `## 1. Stack` block from the approved proposal. Until this fix
// the constitution template hard-coded Next.js+Supabase+Vercel — which lied
// to /plan whenever intake picked a different stack (Python+FastAPI+Celery,
// Go, Rails, whatever). The block now reflects what the intake actually
// decided.
function renderStackBlock(proposal) {
  const stack = (proposal.stack || '').trim();
  const providers = Array.isArray(proposal.providers) ? proposal.providers : [];
  const template = proposal.template || '(unset)';
  const stackLines = stack
    ? stack.split(/[-,+ /]+/).filter(Boolean).map(s => `- ${s}`)
    : ['- _(stack unset — intake proposal did not pin a stack)_'];
  return [
    '## 1. Stack',
    `- Template: \`${template}\``,
    `- Stack identifier: \`${stack || '(unset)'}\``,
    ...(providers.length ? ['- Providers:', ...providers.map(p => `  - ${p}`)] : ['- Providers: _(none pinned at intake)_']),
    '- Components (from stack identifier — confirm each during /plan):',
    ...stackLines.map(l => `  ${l}`),
    '',
    '> This Stack section is generated from the intake proposal. If the plan reveals',
    '> a component was wrong, open an `approval-required` task to change it — do not',
    '> silently edit this block.',
    ''
  ].join('\n');
}

// Build memory/constitution.md by applying the approved proposal to the
// template. Inserts stack, forbidden items, risk class, etc.
async function renderConstitution(project, proposal) {
  const templatePath = path.join(templatesRoot(), 'project-starter', 'memory', 'constitution.md');
  let text;
  try { text = await fs.readFile(templatePath, 'utf8'); }
  catch { return null; }

  text = text.replaceAll('<project>', path.basename(project));
  // Substitute the stack-block marker with a concrete stack section built
  // from the intake proposal. If the marker isn't found (older template)
  // we prepend the stack block above `## 2.` as a fallback.
  const stackBlock = renderStackBlock(proposal);
  const markerRe = /<!--\s*nightshift:stack-block[^>]*-->\s*/;
  if (markerRe.test(text)) {
    text = text.replace(markerRe, stackBlock);
  } else {
    text = text.replace(/^## 2\. /m, `${stackBlock}\n## 2. `);
  }
  // Append an intake snapshot so /plan can read it as first-class input.
  const snapshot = [
    '',
    '---',
    '',
    '## Intake snapshot (from /nightshift intake)',
    '',
    `- template: ${proposal.template}`,
    `- stack: ${proposal.stack}`,
    `- providers: ${(proposal.providers || []).join(', ') || '(none)'}`,
    `- initial_risk_class: ${proposal.initial_risk_class}`,
    `- success_criteria: ${proposal.success_criteria || '(unspecified)'}`,
    ...((proposal.out_of_scope || []).length
      ? ['- out_of_scope:', ...proposal.out_of_scope.map(s => `  - ${s}`)]
      : []),
    ...((proposal.questions || []).length
      ? ['- open_questions_at_intake:', ...proposal.questions.map(q => `  - ${q}`)]
      : []),
    ''
  ].join('\n');

  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  const outPath = path.join(project, 'memory', 'constitution.md');
  if (await pathExists(outPath)) {
    return { path: outPath, overwritten: false };
  }
  await fs.writeFile(outPath, text + snapshot, 'utf8');
  return { path: outPath, overwritten: true };
}

// Build tasks/spec.md from the 6 intake Q/A pairs.
async function renderSpec(project, proposal, questions) {
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  const outPath = path.join(project, 'tasks', 'spec.md');
  if (await pathExists(outPath)) return { path: outPath, overwritten: false };

  const byN = {};
  for (const q of questions) byN[q.n] = q;

  const section = (n, heading, fallback = '_(no answer recorded)_') => [
    `## ${heading}`,
    '',
    byN[n]?.answer || fallback,
    ''
  ].join('\n');

  const md = [
    `# Spec — ${path.basename(project)}`,
    '',
    '_Generated from `/nightshift intake` on ' + new Date().toISOString() + '._',
    '',
    section(1, '1. Problem'),
    section(2, '2. Primary user'),
    section(3, '3. Must-not-miss features'),
    section(5, '4. Hard constraints'),
    section(4, '5. Out of scope'),
    section(6, '6. Success criteria at wake-up'),
    '## 7. Open questions at intake',
    '',
    ...(((proposal.questions || []).length)
      ? proposal.questions.map(q => `- ${q}`)
      : ['_(none — answer the remaining ones before `/plan`.)_']),
    ''
  ].join('\n');

  await fs.writeFile(outPath, md, 'utf8');
  return { path: outPath, overwritten: true };
}

export async function scaffold(project, {
  registryRoot,
  autoCheckpoint = false,
  templateOverride
} = {}) {
  if (!project) throw new ScaffoldError('project path is required', { code: 'MISSING_PATH' });
  const abs = path.resolve(project);

  const intakeMarker = path.join(abs, '.nightshift', 'intake-pending');
  if (!await pathExists(intakeMarker)) {
    throw new ScaffoldError(`no intake marker at ${intakeMarker}. Run 'nightshift init' first.`, { code: 'NOT_INITIALIZED' });
  }

  const { proposal, questions } = await findApprovedProposal(abs);

  // Choose template. Currently only 'next-supabase-vercel' ships; other names
  // resolve to the same dir by design (ТЗ §1 fast-path hint).
  const template = templateOverride || proposal.template || 'next-supabase-vercel';
  const templateDir = path.join(templatesRoot(), 'project-starter');
  if (!await pathExists(templateDir)) {
    throw new ScaffoldError(`template dir not found: ${templateDir}`, { code: 'NO_TEMPLATE_DIR' });
  }

  // Copy template (selective — skip files we render from intake answers).
  const { copied, skipped } = await copyTree(templateDir, abs, {
    substitutions: { project: path.basename(abs) },
    excludeRel: [
      path.join('memory', 'constitution.md'),
      path.join('tasks', 'spec.md')
    ]
  });

  // Render constitution + spec from intake answers.
  const con = await renderConstitution(abs, proposal);
  const spec = await renderSpec(abs, proposal, questions);

  // Wave C — seed the retrieval-memory surface. ndjson files start empty;
  // JSON stores get a schema_version=1 header so readers never see "missing".
  await fs.mkdir(path.join(abs, 'memory'), { recursive: true });
  for (const f of ['decisions.ndjson', 'incidents.ndjson']) {
    const p = path.join(abs, 'memory', f);
    if (!await pathExists(p)) await fs.writeFile(p, '', 'utf8');
  }
  const servicesPath = path.join(abs, 'memory', 'services.json');
  if (!await pathExists(servicesPath)) {
    await fs.writeFile(servicesPath, JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      providers: {}
    }, null, 2) + '\n', 'utf8');
  }
  const reuseIndexPath = path.join(abs, 'memory', 'reuse-index.json');
  if (!await pathExists(reuseIndexPath)) {
    const seededReuse = [
      { file: 'lib/supabase/server.ts', symbol: 'supabaseServer', purpose: 'Server-side Supabase client (SSR cookies)', tags: ['supabase', 'ssr'], safe_to_extend: true, examples: [] },
      { file: 'lib/supabase/client.ts', symbol: 'supabaseBrowser', purpose: 'Browser-side Supabase client (singleton)', tags: ['supabase', 'browser'], safe_to_extend: true, examples: [] }
    ];
    await fs.writeFile(reuseIndexPath, JSON.stringify({
      schema_version: 1,
      updated_at: new Date().toISOString(),
      entries: seededReuse
    }, null, 2) + '\n', 'utf8');
  }

  // Emit decision.recorded for the approval (single entry, atomic).
  const logPath = path.join(abs, 'tasks', 'events.ndjson');
  const reg = new Registry(registryRoot ? { root: registryRoot } : {});
  const record = await reg.get(abs);
  const projectId = record?.project_id;
  const sid = genSessionId();

  const envBackup = process.env.NIGHTSHIFT_AUTO_CHECKPOINT;
  if (!autoCheckpoint) process.env.NIGHTSHIFT_AUTO_CHECKPOINT = '0';
  try {
    await appendEvent(logPath, {
      session_id: sid,
      agent: 'orchestrator',
      action: 'decision.recorded',
      payload: {
        kind: 'intake_approval',
        project_id: projectId,
        approved: true,
        template: proposal.template,
        stack: proposal.stack,
        providers: proposal.providers || [],
        initial_risk_class: proposal.initial_risk_class
      },
      notes: 'intake-interview verdict=approved → /nightshift confirm-scaffold'
    });
    await appendEvent(logPath, {
      session_id: sid,
      agent: 'orchestrator',
      action: 'session.start',
      payload: { project: path.basename(abs), stage: 'scaffolded' }
    });
  } finally {
    if (!autoCheckpoint) {
      if (envBackup == null) delete process.env.NIGHTSHIFT_AUTO_CHECKPOINT;
      else process.env.NIGHTSHIFT_AUTO_CHECKPOINT = envBackup;
    }
  }

  // Update registry: stage=ready, fill in what intake decided.
  if (record) {
    await reg.update(record.project_id, {
      stage: 'ready',
      template,
      stack: proposal.stack,
      providers: proposal.providers || []
    });
  }

  // Clear the intake-pending marker (convert it to intake-complete).
  await fs.rename(intakeMarker, path.join(abs, '.nightshift', 'intake-complete')).catch(() => {});

  // TZ fix-batch P0.5: seed a git repo + initial commit so the `/preflight`
  // guard ("is git tree clean or at least committed?") passes on the first
  // wave. Skipped if a repo already exists in the project dir.
  const gitInit = await maybeInitGit(abs);

  return {
    project_id: projectId,
    project_path: abs,
    template,
    files_copied: copied.length,
    files_skipped: skipped.length,
    constitution: con?.path,
    spec: spec?.path,
    git: gitInit
  };
}

async function maybeInitGit(projectDir) {
  const existing = path.join(projectDir, '.git');
  if (await pathExists(existing)) return { initialized: false, reason: 'repo_already_present' };

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status !== 0) return { initialized: false, reason: 'git_not_on_path' };

  const runGit = (args, opts = {}) =>
    spawnSync('git', args, { cwd: projectDir, encoding: 'utf8', ...opts });

  const init = runGit(['init', '-b', 'main']);
  if (init.status !== 0) {
    // Older git (<2.28) doesn't know -b; fall back to default branch +
    // manual rename. We still emit a diagnostic so callers can see why
    // the branch ended up as `master`.
    const legacy = runGit(['init']);
    if (legacy.status !== 0) {
      return { initialized: false, reason: 'git_init_failed', stderr: (init.stderr || legacy.stderr || '').trim() };
    }
    runGit(['checkout', '-b', 'main']);
  }

  // Seed a .gitignore tailored to nightshift — .nightshift/ is local-state
  // that must never land in the repo. Leave existing one alone if present.
  const gi = path.join(projectDir, '.gitignore');
  if (!await pathExists(gi)) {
    const body = [
      'node_modules/',
      '.env',
      '.env.local',
      '.env.*.local',
      '.next/',
      'dist/',
      'build/',
      '.DS_Store',
      '# nightshift local state (registry cache, intake markers, ping failcounts)',
      '.nightshift/',
      ''
    ].join('\n');
    await fs.writeFile(gi, body, 'utf8');
  }

  // Stage everything we just wrote. The commit message intentionally
  // doesn't reference the event log — that surface is internal state.
  const add = runGit(['add', '-A']);
  if (add.status !== 0) {
    return { initialized: true, committed: false, reason: 'git_add_failed', stderr: (add.stderr || '').trim() };
  }

  // Local committer config when the host has none configured; `git commit`
  // exits non-zero with a cryptic message otherwise. Scoped to this repo.
  runGit(['config', 'user.email', 'nightshift@local']);
  runGit(['config', 'user.name', 'nightshift scaffold']);

  const commit = runGit(['commit', '-m', 'chore: nightshift scaffold']);
  if (commit.status !== 0) {
    return { initialized: true, committed: false, reason: 'git_commit_failed', stderr: (commit.stderr || '').trim() };
  }

  return { initialized: true, committed: true, branch: 'main' };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args[0] || args[0] === '-h' || args[0] === '--help') {
    process.stderr.write(`
Usage: nightshift-scaffold.mjs <project-path> [--template <name>]

Expects the project to already have .nightshift/intake-pending and an
approved proposal in .nightshift/intake.ndjson. Writes the full project
scaffold and flips the registry record to stage=ready.
    `.trim() + '\n');
    process.exit(args[0] ? 0 : 2);
  }
  const project = args[0];
  const override = (() => {
    const i = args.indexOf('--template');
    return i >= 0 ? args[i + 1] : undefined;
  })();
  try {
    const result = await scaffold(project, { templateOverride: override });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    if (err instanceof ScaffoldError) {
      process.stderr.write(`nightshift scaffold: ${err.message}\n`);
      process.exit(err.code === 'NOT_APPROVED' || err.code === 'NO_PROPOSAL' ? 3 : 2);
    }
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('[nightshift scaffold] fatal:', err.message); process.exit(1); });
}
