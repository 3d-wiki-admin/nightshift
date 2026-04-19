import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalFolderBackend, SecretBackendError } from '../index.mjs';

function tmpRoot() {
  return path.join(tmpdir(), `ns-sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

test('write then read roundtrip', async () => {
  const root = tmpRoot();
  const b = new LocalFolderBackend({ root });
  await b.write('demo', 'API_KEY', 'abc123');
  assert.equal(await b.read('demo', 'API_KEY'), 'abc123');
  await fs.rm(root, { recursive: true, force: true });
});

test('read missing throws SECRET_NOT_FOUND', async () => {
  const root = tmpRoot();
  const b = new LocalFolderBackend({ root });
  await assert.rejects(
    () => b.read('demo', 'NOPE'),
    (err) => err instanceof SecretBackendError && err.code === 'SECRET_NOT_FOUND'
  );
  await fs.rm(root, { recursive: true, force: true });
});

test('list returns keys sorted', async () => {
  const root = tmpRoot();
  const b = new LocalFolderBackend({ root });
  await b.write('demo', 'B_KEY', '2');
  await b.write('demo', 'A_KEY', '1');
  assert.deepEqual(await b.list('demo'), ['A_KEY', 'B_KEY']);
  await fs.rm(root, { recursive: true, force: true });
});

test('rotate returns two distinct refs', async () => {
  const root = tmpRoot();
  const b = new LocalFolderBackend({ root });
  await b.write('demo', 'K', 'v');
  const { oldRef, newRef } = await b.rotate('demo', 'K');
  assert.ok(oldRef !== newRef);
  await fs.rm(root, { recursive: true, force: true });
});

test('write rejects keys with newline or equals', async () => {
  const root = tmpRoot();
  const b = new LocalFolderBackend({ root });
  await assert.rejects(() => b.write('demo', 'BAD=KEY', 'v'), /Invalid key/);
  await assert.rejects(() => b.write('demo', 'BAD\nKEY', 'v'), /Invalid key/);
  await fs.rm(root, { recursive: true, force: true });
});
