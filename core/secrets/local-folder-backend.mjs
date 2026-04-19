import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SecretBackendError } from './interface.mjs';

const DEFAULT_ROOT = path.join(os.homedir(), '.nightshift', 'secrets');

function envFile(root, project) {
  return path.join(root, project, '.env');
}

async function parseEnv(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      out[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return out;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeEnv(file, map) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lines = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  await fs.writeFile(file, lines.join('\n') + '\n', { mode: 0o600 });
}

export class LocalFolderBackend {
  constructor({ root = DEFAULT_ROOT } = {}) {
    this.root = root;
  }

  async read(project, key) {
    const map = await parseEnv(envFile(this.root, project));
    if (!(key in map)) {
      throw new SecretBackendError(`Secret not found: ${project}/${key}`, { code: 'SECRET_NOT_FOUND' });
    }
    return map[key];
  }

  async write(project, key, value, meta = {}) {
    if (!key || /[\r\n=]/.test(key)) throw new SecretBackendError('Invalid key', { code: 'BAD_KEY' });
    const file = envFile(this.root, project);
    const map = await parseEnv(file);
    map[key] = value;
    await writeEnv(file, map);
    if (meta.rotatedFrom) {
      const audit = path.join(this.root, project, 'rotation.log');
      await fs.appendFile(audit, `${new Date().toISOString()} ${key} rotated (from=${meta.rotatedFrom})\n`, { mode: 0o600 });
    }
  }

  async list(project) {
    const map = await parseEnv(envFile(this.root, project));
    return Object.keys(map).sort();
  }

  async rotate(project, key) {
    const oldRef = `${project}/${key}@${Date.now() - 1}`;
    const newRef = `${project}/${key}@${Date.now()}`;
    return { oldRef, newRef };
  }
}
