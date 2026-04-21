import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname);
const SCRIPT = path.join(ROOT, 'core', 'scripts', 'preflight.sh');

function tmp(name = 'ns-preflight') {
  return path.join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function writeExec(filePath, body) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, { mode: 0o755 });
}

async function bootstrapProject() {
  const project = tmp('ns-preflight-project');
  await fs.mkdir(path.join(project, 'memory'), { recursive: true });
  await fs.mkdir(path.join(project, 'tasks'), { recursive: true });
  await fs.writeFile(path.join(project, 'memory', 'constitution.md'), '# constitution\n', 'utf8');
  await fs.writeFile(path.join(project, 'tasks', 'spec.md'), '# spec\n', 'utf8');
  await fs.writeFile(path.join(project, 'tasks', 'events.ndjson'), '', 'utf8');

  const gitInit = spawnSync('git', ['init', '-q'], { cwd: project, encoding: 'utf8' });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  return project;
}

async function setupDarwinPath({ launchctlOutput = '' } = {}) {
  const binDir = tmp('ns-preflight-bin');
  await writeExec(path.join(binDir, 'uname'), '#!/usr/bin/env bash\necho Darwin\n');
  await writeExec(
    path.join(binDir, 'launchctl'),
    `#!/usr/bin/env bash\nprintf '%s' ${JSON.stringify(launchctlOutput)}\n`
  );
  await writeExec(path.join(binDir, 'codex'), '#!/usr/bin/env bash\nexit 0\n');
  return binDir;
}

function runPreflight(project, args, binDir) {
  return spawnSync('bash', [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`
    }
  });
}

test('F-O: --require-launchd upgrades missing launchd from WARN to FAIL', async () => {
  const project = await bootstrapProject();
  const binDir = await setupDarwinPath({ launchctlOutput: '' });

  try {
    const warnRes = runPreflight(project, [project], binDir);
    assert.equal(warnRes.status, 2, warnRes.stderr);
    assert.match(warnRes.stdout, /launchd pinger not loaded — optional, needed only for overnight runs/);

    const failRes = runPreflight(project, ['--require-launchd', project], binDir);
    assert.equal(failRes.status, 1, failRes.stderr);
    assert.match(failRes.stdout, /launchd pinger not loaded — run nightshift launchd install --project/);
    assert.match(failRes.stderr, new RegExp(`nightshift launchd install --project ${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    await fs.rm(project, { recursive: true, force: true });
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

// Future work (F-P): the manual fallback lives in the orchestrator skill text,
// not a runtime module. If that behavior is later materialized into code, add
// an integration test here that asserts `tasks/paused.md` receives the recovery
// command when Darwin launchd is absent.
