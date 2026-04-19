#!/usr/bin/env node
import { EventStore, validateEvent } from '../event-store/src/index.mjs';
import { buildState, validateState } from '../event-store/src/index.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = { input: null, output: null, write: false, pretty: true, strict: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--output' || a === '-o') args.output = argv[++i];
    else if (a === '--write') args.write = true;
    else if (a === '--compact') args.pretty = false;
    else if (a === '--lax') args.strict = false;
    else if (a === '--help' || a === '-h') {
      console.log(`
Usage: replay-events.mjs <events.ndjson> [--output state.json] [--write] [--compact] [--lax]

Rebuilds state.json from the canonical event log.
This script is the DEFINITION of state semantics. If state.json and the log disagree,
the log wins and state is rebuilt from here.

Flags:
  --output/-o <path>   Write state to this path (default: stdout).
  --write              Shorthand for --output <dir>/state.json (dir = parent of input).
  --compact            Single-line JSON (default: pretty).
  --lax                Skip per-event schema validation (default: strict).
      `.trim());
      process.exit(0);
    } else if (!args.input) args.input = a;
  }
  if (!args.input) {
    console.error('error: <events.ndjson> is required (or pass --help)');
    process.exit(2);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const store = new EventStore(path.resolve(args.input));
  const events = await store.all();

  if (args.strict) {
    let invalid = 0;
    for (let i = 0; i < events.length; i++) {
      const check = validateEvent(events[i]);
      if (!check.ok) {
        invalid += 1;
        console.error(`[replay] event #${i + 1} (id=${events[i].event_id || '?'}) failed schema: ${check.errors.join('; ')}`);
      }
    }
    if (invalid > 0) {
      console.error(`[replay] ${invalid}/${events.length} invalid events — refusing to project (pass --lax to override).`);
      process.exit(4);
    }
  }

  const state = buildState(events);

  const check = validateState(state);
  if (!check.ok) {
    console.error('[replay] state failed schema validation:', check.errors);
    process.exit(3);
  }

  const json = args.pretty ? JSON.stringify(state, null, 2) : JSON.stringify(state);

  if (args.write && !args.output) {
    args.output = path.join(path.dirname(path.resolve(args.input)), 'state.json');
  }

  if (args.output) {
    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.writeFile(args.output, json + '\n', 'utf8');
    console.error(`[replay] wrote ${args.output} (events=${events.length})`);
  } else {
    process.stdout.write(json + '\n');
  }
}

main().catch((err) => {
  console.error('[replay] fatal:', err.message);
  process.exit(1);
});
