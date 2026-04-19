import { spawnSync } from 'node:child_process';
import { BaseProvisioner, ProvisionerError, cliExists, resolveSessionId } from './interface.mjs';

export class VercelProvisioner extends BaseProvisioner {
  constructor(opts = {}) {
    super({ ...opts, service: 'vercel' });
  }

  async preflight() {
    const reasons = [];
    if (!cliExists('vercel')) reasons.push('vercel CLI not installed (`npm i -g vercel`)');
    else {
      const who = spawnSync('vercel', ['whoami'], { encoding: 'utf8' });
      if (who.status !== 0) reasons.push('vercel CLI not logged in (`vercel login`)');
    }
    return { ok: reasons.length === 0, reasons };
  }

  async docsUrl() {
    return {
      url: 'https://vercel.com/docs/cli/project',
      summary: 'Create project: `vercel link` (interactive) or `vercel --token=$VERCEL_TOKEN --yes` from repo root. Set env vars via `vercel env add <KEY> production`.'
    };
  }

  async create({ project, repo, rootDirectory } = {}) {
    if (!project) throw new ProvisionerError('create: project name required');
    const pre = await this.preflight();
    if (!pre.ok) throw new ProvisionerError(`preflight failed: ${pre.reasons.join('; ')}`, { code: 'PREFLIGHT' });

    const cmd = ['vercel', 'project', 'add', project];
    if (this.execute) {
      const res = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8' });
      if (res.status !== 0) throw new ProvisionerError(`vercel project add failed: ${res.stderr}`, { code: 'VERCEL_ADD_FAILED' });
    }

    const ref = `vercel://projects/${project}`;
    await this.eventStore?.append?.({
      agent: 'infra-provisioner',
      model: null,
      session_id: resolveSessionId(),
      action: 'infra.provisioned',
      payload: { service: 'vercel', resource_id: project, ref, dry_run: !this.execute }
    });
    return { id: project, ref, secrets: [] };
  }

  async rotate(resourceId, key) {
    if (!key) throw new ProvisionerError('rotate: key required');
    const oldRef = `vercel://env/${resourceId}/${key}@${Date.now() - 1}`;
    const newRef = `vercel://env/${resourceId}/${key}@${Date.now()}`;

    if (this.execute) {
      spawnSync('vercel', ['env', 'rm', key, 'production', '--yes', '--scope', resourceId]);
      spawnSync('vercel', ['env', 'add', key, 'production', '--scope', resourceId], { stdio: 'inherit' });
    }

    await this.eventStore?.append?.({
      agent: 'infra-provisioner',
      session_id: resolveSessionId(),
      action: 'infra.rotated',
      payload: { service: 'vercel', resource_id: resourceId, key, oldRef, newRef, dry_run: !this.execute }
    });
    return { oldRef, newRef };
  }
}
