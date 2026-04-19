// SecretBackend — see NIGHTSHIFT spec §18.
//
// interface SecretBackend {
//   read(project, key): Promise<string>;
//   write(project, key, value, meta?): Promise<void>;
//   list(project): Promise<string[]>;
//   rotate(project, key): Promise<{ oldRef, newRef }>;
// }
//
// Implementations MUST:
//   - NEVER log secret values
//   - return rotation refs (opaque ids), not values
//   - throw on unknown key (no silent empty string)

export class SecretBackendError extends Error {
  constructor(msg, { code = 'SECRET_ERROR', cause } = {}) {
    super(msg);
    this.name = 'SecretBackendError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export function assertBackend(b) {
  for (const m of ['read', 'write', 'list', 'rotate']) {
    if (typeof b[m] !== 'function') {
      throw new SecretBackendError(`Backend missing method: ${m}`, { code: 'BACKEND_INVALID' });
    }
  }
  return b;
}
