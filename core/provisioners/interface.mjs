// Provisioner interface — see NIGHTSHIFT spec §3.2 ("front door / execution engine")
// and the infra-provisioner skill (core/skills/infra-provisioner/SKILL.md).
//
// Every adapter MUST:
//   1. preflight() — detect CLI presence + auth.
//   2. docsUrl()    — return the official docs URL to WebFetch before acting.
//   3. create(params) / rotate(resourceId, key) / deleteRequested(resourceId).
//   4. Never echo secret values in logs or return shapes. Use refs.
//   5. Run `--execute` mode only when explicitly requested; default is dry-run.

import { spawnSync } from 'node:child_process';
import { sessionId as genSessionId } from '../event-store/src/id.mjs';

export function resolveSessionId() {
  const env = process.env.NIGHTSHIFT_SESSION_ID;
  if (env && /^sess_[0-9A-HJKMNP-TV-Z]{20,40}$/.test(env)) return env;
  return genSessionId();
}

export class ProvisionerError extends Error {
  constructor(msg, { code = 'PROVISIONER_ERROR' } = {}) {
    super(msg);
    this.code = code;
  }
}

export function cliExists(cmd) {
  const res = spawnSync('bash', ['-lc', `command -v "${cmd}"`], { encoding: 'utf8' });
  return res.status === 0 && res.stdout.trim().length > 0;
}

export class BaseProvisioner {
  constructor({ service, execute = false, secrets, eventStore } = {}) {
    this.service = service;
    this.execute = execute;
    this.secrets = secrets;
    this.eventStore = eventStore;
  }

  async preflight() { throw new ProvisionerError('not implemented', { code: 'ABSTRACT' }); }
  async docsUrl()   { throw new ProvisionerError('not implemented', { code: 'ABSTRACT' }); }
  async create()    { throw new ProvisionerError('not implemented', { code: 'ABSTRACT' }); }
  async rotate()    { throw new ProvisionerError('not implemented', { code: 'ABSTRACT' }); }
  async deleteRequested(resourceId) {
    await this.eventStore?.append?.({
      agent: 'infra-provisioner',
      action: 'infra.deleted_requested',
      session_id: resolveSessionId(),
      payload: { service: this.service, resource_id: resourceId }
    });
  }
}
