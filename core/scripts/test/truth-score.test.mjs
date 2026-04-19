import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore } from '../truth-score.mjs';

test('all pass gives 1.0', () => {
  const { score } = computeScore({ tests: 'pass', types: 'pass', lint: 'pass', build: 'pass' });
  assert.equal(score, 1);
});

test('tests fail drops score by exact tests weight', () => {
  const { score, weights } = computeScore({ tests: 'fail', types: 'pass', lint: 'pass', build: 'pass' });
  const expected = 1 - weights.tests;
  assert.ok(Math.abs(score - expected) < 0.001, `expected ~${expected}, got ${score}`);
});

test('partial test pass ratio', () => {
  const { score, breakdown } = computeScore({
    tests: { passed: 3, total: 4 },
    types: 'pass', lint: 'pass', build: 'pass'
  });
  assert.equal(breakdown.tests, 0.75);
  assert.ok(score < 1);
  assert.ok(score > 0.9);
});

test('optional gates default to 1 when missing', () => {
  const { breakdown } = computeScore({ tests: 'pass', types: 'pass', lint: 'pass', build: 'pass' });
  assert.equal(breakdown.reuse, 1);
  assert.equal(breakdown.file_size, 1);
  assert.equal(breakdown.docs_sync, 1);
});

test('all fail gives 0', () => {
  const { score } = computeScore({ tests: 'fail', types: 'fail', lint: 'fail', build: 'fail', reuse: 0, file_size: 0, docs_sync: 0 });
  assert.equal(score, 0);
});
