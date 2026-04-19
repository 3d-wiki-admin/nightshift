import { randomBytes } from 'node:crypto';

const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ms, length) {
  let out = '';
  let n = ms;
  for (let i = length - 1; i >= 0; i--) {
    out = ULID_CHARS[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRand(length) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ULID_CHARS[bytes[i] % 32];
  }
  return out;
}

export function ulid(prefix = '') {
  const ts = encodeTime(Date.now(), 10);
  const rand = encodeRand(16);
  return prefix + ts + rand;
}

export function eventId() { return ulid('ev_'); }
export function sessionId() { return ulid('sess_'); }
