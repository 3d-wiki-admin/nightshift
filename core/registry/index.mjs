// core/registry/index.mjs — global registry of nightshift-managed projects.
//
// Layout:
//   ~/.nightshift/registry/
//     index.json              — { schema_version, projects: [{id, path, stage, ...}] }
//     projects/<id>.json       — per-project record (stage, template, stack, providers, etc.)
//     .lock                    — simple mutex file
//
// Writes are atomic: write temp → rename. A .bak copy is kept before each
// overwrite so a partial write can't corrupt the live file.
//
// Schema version = 1. Incompatible bumps must be handled in a migration step
// (not implemented yet; v1 will reject v>1 records).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';

export class RegistryError extends Error {
  constructor(msg, code) { super(msg); this.name = 'RegistryError'; this.code = code; }
}

const DEFAULT_ROOT = path.join(os.homedir(), '.nightshift', 'registry');
const SCHEMA_VERSION = 1;

export class Registry {
  constructor({ root = DEFAULT_ROOT } = {}) {
    this.root = root;
    this.indexPath = path.join(root, 'index.json');
    this.projectsDir = path.join(root, 'projects');
    this.lockPath = path.join(root, '.lock');
  }

  async _ensureRoot() {
    await fs.mkdir(this.projectsDir, { recursive: true });
  }

  // Simple lockfile mutex. Blocks up to 5s, then gives up with RegistryError.
  async _acquireLock() {
    await this._ensureRoot();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const fh = await fs.open(this.lockPath, 'wx');
        await fh.write(`${process.pid}\n${new Date().toISOString()}\n`);
        await fh.close();
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        // Stale lock? — take it if older than 10s.
        try {
          const st = await fs.stat(this.lockPath);
          if (Date.now() - st.mtimeMs > 10000) {
            await fs.rm(this.lockPath, { force: true });
            continue;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 50));
      }
    }
    throw new RegistryError('failed to acquire registry lock', 'LOCK_TIMEOUT');
  }

  async _releaseLock() {
    try { await fs.rm(this.lockPath, { force: true }); } catch {}
  }

  // Atomic write via temp+rename, with .bak of the previous file.
  async _atomicWrite(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.copyFile(filePath, `${filePath}.bak`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const tmp = `${filePath}.tmp-${Date.now()}-${randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, filePath);
  }

  async _readJson(filePath, fallback) {
    try {
      const text = await fs.readFile(filePath, 'utf8');
      return JSON.parse(text);
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      // Corrupted file — try .bak recovery.
      try {
        const backup = await fs.readFile(`${filePath}.bak`, 'utf8');
        return JSON.parse(backup);
      } catch { throw new RegistryError(`corrupt registry file: ${filePath}`, 'CORRUPT'); }
    }
  }

  async _loadIndex() {
    const defaultIdx = { schema_version: SCHEMA_VERSION, updated_at: new Date().toISOString(), projects: [] };
    const idx = await this._readJson(this.indexPath, defaultIdx);
    if (idx.schema_version > SCHEMA_VERSION) {
      throw new RegistryError(`registry schema_version ${idx.schema_version} is newer than this binary supports (${SCHEMA_VERSION})`, 'SCHEMA_NEWER');
    }
    return idx;
  }

  async _writeIndex(idx) {
    idx.updated_at = new Date().toISOString();
    await this._atomicWrite(this.indexPath, JSON.stringify(idx, null, 2) + '\n');
  }

  async _projectPath(id) {
    return path.join(this.projectsDir, `${id}.json`);
  }

  // Generate a stable project id from the absolute path.
  static idFromPath(absPath) {
    const norm = path.resolve(absPath).toLowerCase();
    const digest = createHash('sha256').update(norm).digest('hex').slice(0, 12);
    return `proj_${digest}`;
  }

  async register({ path: projectPath, name, template, stack, providers, stage = 'intake' }) {
    if (!projectPath) throw new RegistryError('register: path is required', 'INVALID');
    await this._acquireLock();
    try {
      const abs = path.resolve(projectPath);
      const id = Registry.idFromPath(abs);
      const now = new Date().toISOString();
      const record = {
        schema_version: SCHEMA_VERSION,
        project_id: id,
        path: abs,
        name: name || path.basename(abs),
        stage,
        template: template || null,
        stack: stack || null,
        providers: providers || [],
        active_wave: null,
        last_digest_at: null,
        launchd_enabled: false,
        created_at: now,
        updated_at: now
      };
      await this._atomicWrite(await this._projectPath(id), JSON.stringify(record, null, 2) + '\n');

      const idx = await this._loadIndex();
      const existing = idx.projects.findIndex(p => p.project_id === id);
      const indexRow = { project_id: id, path: abs, name: record.name, stage: record.stage, created_at: now };
      if (existing >= 0) idx.projects[existing] = indexRow;
      else idx.projects.push(indexRow);
      await this._writeIndex(idx);

      return record;
    } finally {
      await this._releaseLock();
    }
  }

  async get(idOrPath) {
    await this._ensureRoot();
    let id = idOrPath;
    if (!idOrPath.startsWith('proj_')) id = Registry.idFromPath(idOrPath);
    return await this._readJson(await this._projectPath(id), null);
  }

  async list() {
    const idx = await this._loadIndex();
    return idx.projects;
  }

  async update(idOrPath, partial) {
    await this._acquireLock();
    try {
      let id = idOrPath;
      if (!idOrPath.startsWith('proj_')) id = Registry.idFromPath(idOrPath);
      const pPath = await this._projectPath(id);
      const current = await this._readJson(pPath, null);
      if (!current) throw new RegistryError(`project not found: ${idOrPath}`, 'NOT_FOUND');
      const updated = { ...current, ...partial, updated_at: new Date().toISOString() };
      await this._atomicWrite(pPath, JSON.stringify(updated, null, 2) + '\n');

      // Mirror a few fields into the index for quick listing.
      const idx = await this._loadIndex();
      const row = idx.projects.find(p => p.project_id === id);
      if (row) {
        if ('stage' in partial) row.stage = updated.stage;
        if ('name' in partial) row.name = updated.name;
        await this._writeIndex(idx);
      }
      return updated;
    } finally {
      await this._releaseLock();
    }
  }

  async remove(idOrPath) {
    await this._acquireLock();
    try {
      let id = idOrPath;
      if (!idOrPath.startsWith('proj_')) id = Registry.idFromPath(idOrPath);
      await fs.rm(await this._projectPath(id), { force: true });
      await fs.rm(`${await this._projectPath(id)}.bak`, { force: true });
      const idx = await this._loadIndex();
      idx.projects = idx.projects.filter(p => p.project_id !== id);
      await this._writeIndex(idx);
    } finally {
      await this._releaseLock();
    }
  }
}

export { DEFAULT_ROOT, SCHEMA_VERSION };
