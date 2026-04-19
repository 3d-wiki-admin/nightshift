import { spawnSync } from 'node:child_process';
import { LocalFolderBackend } from './local-folder-backend.mjs';
import { OnePasswordBackend } from './onepassword-backend.mjs';
import { assertBackend } from './interface.mjs';

export { SecretBackendError } from './interface.mjs';
export { LocalFolderBackend } from './local-folder-backend.mjs';
export { OnePasswordBackend } from './onepassword-backend.mjs';

function opAvailable() {
  const res = spawnSync('bash', ['-lc', 'command -v op'], { encoding: 'utf8' });
  return res.status === 0 && res.stdout.trim().length > 0;
}

export function makeBackend(name = process.env.NIGHTSHIFT_SECRET_BACKEND || 'local', { silent = false } = {}) {
  switch (name) {
    case 'local':
    case 'localfolder':
    case 'local-folder':
      return assertBackend(new LocalFolderBackend());
    case '1password':
    case 'op':
      if (!opAvailable()) {
        if (!silent) {
          process.stderr.write('[secrets] `op` CLI not available — falling back to LocalFolderBackend (spec §23 degraded mode).\n');
        }
        return assertBackend(new LocalFolderBackend());
      }
      return assertBackend(new OnePasswordBackend());
    default:
      throw new Error(`Unknown secret backend: ${name}`);
  }
}
