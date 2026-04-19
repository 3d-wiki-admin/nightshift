import { spawnSync } from 'node:child_process';
import { SecretBackendError } from './interface.mjs';

function op(args, input = null) {
  const res = spawnSync('op', args, {
    input: input ?? undefined,
    encoding: 'utf8',
    env: process.env
  });
  if (res.error) {
    throw new SecretBackendError(`op CLI not available: ${res.error.message}`, { code: 'OP_UNAVAILABLE', cause: res.error });
  }
  if (res.status !== 0) {
    throw new SecretBackendError(`op CLI failed (${args.join(' ')}): ${res.stderr.trim()}`, { code: 'OP_FAILED' });
  }
  return res.stdout;
}

function itemPath(project, key) {
  return `op://nightshift/${project}/${key}`;
}

export class OnePasswordBackend {
  constructor({ vault = 'nightshift' } = {}) {
    this.vault = vault;
  }

  async read(project, key) {
    return op(['read', itemPath(project, key)]).trim();
  }

  async write(project, key, value, meta = {}) {
    const title = `${project}`;
    const assignments = [`${key}=${value}`];
    try {
      op(['item', 'edit', '--vault', this.vault, title, ...assignments]);
    } catch (err) {
      if (err.code !== 'OP_FAILED') throw err;
      op(['item', 'create', '--vault', this.vault, '--category', 'secure note', '--title', title, ...assignments]);
    }
    if (meta.rotatedFrom) {
      const note = `Rotated ${key} at ${new Date().toISOString()} from ${meta.rotatedFrom}`;
      op(['item', 'edit', '--vault', this.vault, title, `notesPlain=${note}`]);
    }
  }

  async list(project) {
    const out = op(['item', 'get', project, '--vault', this.vault, '--format', 'json']);
    try {
      const data = JSON.parse(out);
      return (data.fields || []).map(f => f.label).filter(Boolean).sort();
    } catch {
      return [];
    }
  }

  async rotate(project, key) {
    const oldRef = `op://${this.vault}/${project}/${key}@${Date.now() - 1}`;
    const newRef = `op://${this.vault}/${project}/${key}@${Date.now()}`;
    return { oldRef, newRef };
  }
}
