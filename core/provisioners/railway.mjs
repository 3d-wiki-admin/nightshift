import { spawnSync } from 'node:child_process';
import { BaseProvisioner, ProvisionerError, cliExists, resolveSessionId } from './interface.mjs';

export class RailwayProvisioner extends BaseProvisioner {
  constructor(opts = {}) {
    super({ ...opts, service: 'railway' });
  }

  async preflight() {
    const reasons = [];
    if (!cliExists('railway')) reasons.push('railway CLI not installed (`brew install railway` or `npm i -g @railway/cli`)');
    else {
      const who = spawnSync('railway', ['whoami'], { encoding: 'utf8' });
      if (who.status !== 0) reasons.push('railway CLI not logged in (`railway login`)');
    }
    return { ok: reasons.length === 0, reasons };
  }

  async docsUrl() {
    return {
      url: 'https://docs.railway.com/guides/cli',
      summary: 'Create service: `railway init` then `railway up`. Environment: `railway variables set KEY=value`.'
    };
  }

  async create({ name, templateSlug } = {}) {
    if (!name) throw new ProvisionerError('create: name required');
    const pre = await this.preflight();
    if (!pre.ok) throw new ProvisionerError(`preflight failed: ${pre.reasons.join('; ')}`, { code: 'PREFLIGHT' });

    let id = `pending_${Date.now()}`;
    if (this.execute) {
      const args = templateSlug ? ['init', '--template', templateSlug, '--name', name] : ['init', '--name', name];
      const res = spawnSync('railway', args, { encoding: 'utf8' });
      if (res.status !== 0) throw new ProvisionerError(`railway init failed: ${res.stderr}`, { code: 'RAILWAY_INIT_FAILED' });
      const m = res.stdout.match(/project id:\s*([a-f0-9-]+)/i);
      if (m) id = m[1];
    }
    const ref = `railway://projects/${id}`;

    await this._emit({
      agent: 'infra-provisioner',
      session_id: resolveSessionId(),
      action: 'infra.provisioned',
      payload: { service: 'railway', resource_id: id, ref, dry_run: !this.execute }
    });
    return { id, ref, secrets: [] };
  }

  async rotate(resourceId, key) {
    const oldRef = `railway://env/${resourceId}/${key}@${Date.now() - 1}`;
    const newRef = `railway://env/${resourceId}/${key}@${Date.now()}`;
    await this._emit({
      agent: 'infra-provisioner',
      session_id: resolveSessionId(),
      action: 'infra.rotated',
      payload: { service: 'railway', resource_id: resourceId, key, oldRef, newRef, dry_run: !this.execute }
    });
    return { oldRef, newRef };
  }
}
