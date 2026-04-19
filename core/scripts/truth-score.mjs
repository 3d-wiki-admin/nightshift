#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const WEIGHTS = {
  tests: 0.30,
  types: 0.20,
  lint: 0.15,
  build: 0.15,
  reuse: 0.10,
  file_size: 0.05,
  docs_sync: 0.05
};

function pass(value) {
  if (value === true || value === 'pass' || value === 'ok' || value === 1) return 1;
  if (value === 'n/a' || value === 'na' || value === null || value === undefined) return null;
  return 0;
}

function ratio(obj) {
  if (typeof obj === 'number') return Math.max(0, Math.min(1, obj));
  if (obj && typeof obj === 'object' && 'passed' in obj && 'total' in obj) {
    return obj.total > 0 ? obj.passed / obj.total : 1;
  }
  const p = pass(obj);
  return p == null ? 1 : p;
}

export function computeScore(gates) {
  let score = 0;
  let totalWeight = 0;
  const breakdown = {};

  const tests = ratio(gates.tests);
  breakdown.tests = tests;
  score += WEIGHTS.tests * tests;
  totalWeight += WEIGHTS.tests;

  const types = ratio(gates.types);
  breakdown.types = types;
  score += WEIGHTS.types * types;
  totalWeight += WEIGHTS.types;

  const lint = ratio(gates.lint);
  breakdown.lint = lint;
  score += WEIGHTS.lint * lint;
  totalWeight += WEIGHTS.lint;

  const build = ratio(gates.build);
  breakdown.build = build;
  score += WEIGHTS.build * build;
  totalWeight += WEIGHTS.build;

  const reuse = gates.reuse == null ? 1 : ratio(gates.reuse);
  breakdown.reuse = reuse;
  score += WEIGHTS.reuse * reuse;
  totalWeight += WEIGHTS.reuse;

  const fileSize = gates.file_size == null ? 1 : ratio(gates.file_size);
  breakdown.file_size = fileSize;
  score += WEIGHTS.file_size * fileSize;
  totalWeight += WEIGHTS.file_size;

  const docs = gates.docs_sync == null ? 1 : ratio(gates.docs_sync);
  breakdown.docs_sync = docs;
  score += WEIGHTS.docs_sync * docs;
  totalWeight += WEIGHTS.docs_sync;

  const normalized = totalWeight > 0 ? score / totalWeight : 0;
  return { score: +normalized.toFixed(4), breakdown, weights: WEIGHTS };
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error(`
Usage: truth-score.mjs <gates.json>

Computes quality score (0-1) from a gates JSON file. See NIGHTSHIFT spec §14.2.
Used for RANKING only. Acceptance is decided by hard gates, not this score.

Input JSON shape:
  {
    "tests": "pass" | "fail" | {"passed": 3, "total": 4},
    "types": "pass" | "fail",
    "lint":  "pass" | "fail",
    "build": "pass" | "fail",
    "reuse": 0..1,           // optional
    "file_size": 0..1,       // optional
    "docs_sync": 0..1        // optional
  }
    `.trim());
    process.exit(2);
  }
  const text = await fs.readFile(path.resolve(input), 'utf8');
  const gates = JSON.parse(text);
  const result = computeScore(gates);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
