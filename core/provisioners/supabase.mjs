import { spawnSync } from 'node:child_process';
import { BaseProvisioner, ProvisionerError, cliExists, resolveSessionId } from './interface.mjs';

export class SupabaseProvisioner extends BaseProvisioner {
  constructor(opts = {}) {
    super({ ...opts, service: 'supabase' });
  }

  async preflight() {
    const reasons = [];
    if (!cliExists('supabase')) reasons.push('supabase CLI not installed (`brew install supabase/tap/supabase`)');
    else {
      const projects = spawnSync('supabase', ['projects', 'list'], { encoding: 'utf8' });
      if (projects.status !== 0) {
        if (/not.*logged.*in|login/i.test(projects.stderr)) {
          reasons.push('supabase CLI not logged in (`supabase login`)');
        } else if (/access.*token/i.test(projects.stderr)) {
          reasons.push('missing SUPABASE_ACCESS_TOKEN env');
        } else {
          reasons.push(`supabase CLI error: ${projects.stderr.trim().slice(0, 120)}`);
        }
      }
    }
    return { ok: reasons.length === 0, reasons };
  }

  async docsUrl() {
    return {
      url: 'https://supabase.com/docs/reference/cli/supabase-projects-create',
      summary: 'Create project: `supabase projects create <name> --db-password <pw> --region <region> --org-id <org>`. Returns project ref used as api subdomain.'
    };
  }

  async create({ name, dbPassword, region = 'us-east-1', orgId } = {}) {
    if (!name) throw new ProvisionerError('create: name required');
    if (!dbPassword) throw new ProvisionerError('create: dbPassword required (provide via secret backend)');
    if (!orgId) throw new ProvisionerError('create: orgId required');
    const pre = await this.preflight();
    if (!pre.ok) throw new ProvisionerError(`preflight failed: ${pre.reasons.join('; ')}`, { code: 'PREFLIGHT' });

    const cmd = ['supabase', 'projects', 'create', name, '--db-password', dbPassword, '--region', region, '--org-id', orgId];

    let id = `pending_${Date.now()}`;
    if (this.execute) {
      const res = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8' });
      if (res.status !== 0) throw new ProvisionerError(`supabase projects create failed: ${res.stderr}`, { code: 'SUPABASE_CREATE_FAILED' });
      const m = res.stdout.match(/ID:\s*([a-z0-9-]+)/i);
      if (m) id = m[1];
    }
    const ref = `supabase://projects/${id}`;

    if (this.secrets && this.execute) {
      await this.secrets.write(name, 'SUPABASE_DB_PASSWORD', dbPassword);
    }

    await this._emit({
      agent: 'infra-provisioner',
      session_id: resolveSessionId(),
      action: 'infra.provisioned',
      payload: { service: 'supabase', resource_id: id, ref, dry_run: !this.execute }
    });
    return { id, ref, secrets: ['SUPABASE_DB_PASSWORD'] };
  }

  async rotate(projectRef, key) {
    if (!key) throw new ProvisionerError('rotate: key required');
    const oldRef = `supabase://keys/${projectRef}/${key}@${Date.now() - 1}`;
    const newRef = `supabase://keys/${projectRef}/${key}@${Date.now()}`;

    await this._emit({
      agent: 'infra-provisioner',
      session_id: resolveSessionId(),
      action: 'infra.rotated',
      payload: { service: 'supabase', resource_id: projectRef, key, oldRef, newRef, dry_run: !this.execute }
    });
    return { oldRef, newRef };
  }
}
