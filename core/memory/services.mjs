// memory/services.mjs — live infrastructure state for the project.
//
// Shape:
//   {
//     schema_version: 1,
//     updated_at,
//     providers: {
//       vercel:   { project_id, preview_url, prod_url, env: {...}, deploy_owner, ... },
//       supabase: { project_ref, api_url, db_host, secret_refs: {...}, ... },
//       railway:  { ... },
//       redis:    { ... }
//     }
//   }
//
// Atomic write via temp+rename. Never contains secret VALUES — only refs
// to the SecretBackend (op://nightshift/<proj>/<KEY> or LocalFolder paths).

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

function filePath(project) {
  return path.join(project, 'memory', 'services.json');
}

async function atomicWrite(p, content) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, content);
  try { await fs.copyFile(p, `${p}.bak`); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  await fs.rename(tmp, p);
}

function blank() {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    providers: {}
  };
}

export async function read(project) {
  const p = filePath(project);
  try {
    const text = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(text);
    if (parsed.schema_version > SCHEMA_VERSION) {
      throw new Error(`services.json schema_version ${parsed.schema_version} is newer than this binary (${SCHEMA_VERSION})`);
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return blank();
    // Attempt .bak recovery.
    try {
      const backup = await fs.readFile(`${p}.bak`, 'utf8');
      return JSON.parse(backup);
    } catch { throw new Error(`services.json is corrupt and no .bak recovery available: ${p}`); }
  }
}

// Merge a partial provider record into services.providers[provider].
// Will not overwrite existing values with null/undefined — use unset() to clear.
export async function setProvider(project, provider, patch) {
  if (!provider) throw new Error('services.setProvider: provider is required');
  const state = await read(project);
  const current = state.providers[provider] || {};
  const merged = { ...current };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue;
    merged[k] = v;
  }
  state.providers[provider] = merged;
  state.updated_at = new Date().toISOString();
  await atomicWrite(filePath(project), JSON.stringify(state, null, 2) + '\n');
  return state.providers[provider];
}

export async function unsetProviderField(project, provider, field) {
  const state = await read(project);
  if (!state.providers[provider]) return;
  delete state.providers[provider][field];
  state.updated_at = new Date().toISOString();
  await atomicWrite(filePath(project), JSON.stringify(state, null, 2) + '\n');
}

export async function removeProvider(project, provider) {
  const state = await read(project);
  if (!state.providers[provider]) return;
  delete state.providers[provider];
  state.updated_at = new Date().toISOString();
  await atomicWrite(filePath(project), JSON.stringify(state, null, 2) + '\n');
}

export async function getProvider(project, provider) {
  const state = await read(project);
  return state.providers[provider] || null;
}
