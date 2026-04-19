import { spawnSync } from 'node:child_process';
import { BaseProvisioner, ProvisionerError, cliExists, resolveSessionId } from './interface.mjs';

export class UpstashRedisProvisioner extends BaseProvisioner {
  constructor(opts = {}) {
    super({ ...opts, service: 'redis' });
  }

  async preflight() {
    const reasons = [];
    if (!cliExists('upstash')) reasons.push('upstash CLI not installed (`brew install upstash/tap/upstash`)');
    return { ok: reasons.length === 0, reasons };
  }

  async docsUrl() {
    return {
      url: 'https://upstash.com/docs/redis/overall/getstarted',
      summary: 'Create Redis DB via Upstash: `upstash redis create --region <r> --name <n>`. Returns REST URL and token.'
    };
  }

  async create({ name, region = 'us-east-1' } = {}) {
    if (!name) throw new ProvisionerError('create: name required');
    const pre = await this.preflight();
    if (!pre.ok) throw new ProvisionerError(`preflight failed: ${pre.reasons.join('; ')}`, { code: 'PREFLIGHT' });

    let id = `pending_${Date.now()}`;
    if (this.execute) {
      const res = spawnSync('upstash', ['redis', 'create', '--name', name, '--region', region], { encoding: 'utf8' });
      if (res.status !== 0) throw new ProvisionerError(`upstash redis create failed: ${res.stderr}`, { code: 'REDIS_CREATE_FAILED' });
      const m = res.stdout.match(/database id:\s*([a-f0-9-]+)/i);
      if (m) id = m[1];
    }
    const ref = `upstash://redis/${id}`;

    await this._emit({
      agent: 'infra-provisioner',
      session_id: resolveSessionId(),
      action: 'infra.provisioned',
      payload: { service: 'redis', resource_id: id, ref, dry_run: !this.execute }
    });
    return { id, ref, secrets: ['REDIS_URL', 'REDIS_TOKEN'] };
  }

  async rotate(resourceId, key) {
    const oldRef = `upstash://redis/${resourceId}/${key}@${Date.now() - 1}`;
    const newRef = `upstash://redis/${resourceId}/${key}@${Date.now()}`;
    await this._emit({
      agent: 'infra-provisioner',
      session_id: resolveSessionId(),
      action: 'infra.rotated',
      payload: { service: 'redis', resource_id: resourceId, key, oldRef, newRef, dry_run: !this.execute }
    });
    return { oldRef, newRef };
  }
}
