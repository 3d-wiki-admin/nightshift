import { createReadStream, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { eventId } from './id.mjs';
import { validateEvent } from './validator.mjs';

export { buildState, applyEvent, initialState } from './projection.mjs';
export { validateEvent, validateState, validateContract, validateManifest } from './validator.mjs';
export { eventId, sessionId, ulid } from './id.mjs';

export class EventStore {
  constructor(logPath) {
    if (!logPath) throw new Error('EventStore requires a logPath');
    this.logPath = logPath;
  }

  async append(partial) {
    const filled = {
      event_id: partial.event_id || eventId(),
      ts: partial.ts || new Date().toISOString(),
      ...partial
    };
    filled.event_id = filled.event_id;
    filled.ts = filled.ts;

    const { ok, errors } = validateEvent(filled);
    if (!ok) {
      throw new Error(`Invalid event: ${errors.join('; ')}\npayload=${JSON.stringify(filled)}`);
    }

    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    const line = JSON.stringify(filled) + '\n';
    await fs.appendFile(this.logPath, line, 'utf8');
    return filled;
  }

  async *read() {
    let stream;
    try {
      stream = createReadStream(this.logPath, { encoding: 'utf8' });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    try {
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch (err) {
          throw new Error(`Corrupt log line in ${this.logPath}: ${trimmed.slice(0, 80)}...`);
        }
        yield parsed;
      }
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
  }

  async all() {
    const out = [];
    try {
      for await (const ev of this.read()) out.push(ev);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return out;
  }

  async size() {
    try {
      const st = await fs.stat(this.logPath);
      return st.size;
    } catch (err) {
      if (err.code === 'ENOENT') return 0;
      throw err;
    }
  }
}
