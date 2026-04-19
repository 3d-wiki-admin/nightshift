import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackend, LocalFolderBackend } from '../index.mjs';

// This environment does not have `op` CLI installed (verified in CI by the
// shell syntax step). We expect a request for the 1password backend to
// transparently fall back to LocalFolderBackend.
test('makeBackend("1password") falls back to LocalFolder when op CLI is missing', () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-to-ensure-op-missing';
  try {
    const b = makeBackend('1password', { silent: true });
    assert.ok(b instanceof LocalFolderBackend, 'expected LocalFolderBackend fallback');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('makeBackend default is LocalFolderBackend', () => {
  const b = makeBackend('local', { silent: true });
  assert.ok(b instanceof LocalFolderBackend);
});

test('unknown backend name throws', () => {
  assert.throws(() => makeBackend('bogus', { silent: true }), /Unknown secret backend/);
});
