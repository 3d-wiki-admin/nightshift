import { LocalFolderBackend } from './local-folder-backend.mjs';
import { OnePasswordBackend } from './onepassword-backend.mjs';
import { assertBackend } from './interface.mjs';

export { SecretBackendError } from './interface.mjs';
export { LocalFolderBackend } from './local-folder-backend.mjs';
export { OnePasswordBackend } from './onepassword-backend.mjs';

export function makeBackend(name = process.env.NIGHTSHIFT_SECRET_BACKEND || 'local') {
  switch (name) {
    case 'local':
    case 'localfolder':
    case 'local-folder':
      return assertBackend(new LocalFolderBackend());
    case '1password':
    case 'op':
      return assertBackend(new OnePasswordBackend());
    default:
      throw new Error(`Unknown secret backend: ${name}`);
  }
}
