import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../router.mjs';

test('safe + small → gpt-5.4 default', () => {
  const r = route({
    risk_class: 'safe',
    diff_budget_lines: 80,
    allowed_files: ['app/page.tsx'],
    scope: { in_scope: ['Add login link'] }
  });
  assert.equal(r.model, 'gpt-5.4');
  assert.equal(r.effort, 'default');
});

test('review-required → codex high', () => {
  const r = route({
    risk_class: 'review-required',
    diff_budget_lines: 80,
    allowed_files: ['app/api/x/route.ts'],
    scope: { in_scope: ['Add new API endpoint'] }
  });
  assert.equal(r.model, 'gpt-5.3-codex');
  assert.equal(r.effort, 'high');
});

test('diff_budget > 150 → codex high', () => {
  const r = route({
    risk_class: 'safe',
    diff_budget_lines: 250,
    allowed_files: ['lib/feature.ts'],
    scope: { in_scope: ['Build feature X'] }
  });
  assert.equal(r.model, 'gpt-5.3-codex');
  assert.equal(r.effort, 'high');
});

test('diff_budget > 300 or refactor → codex xhigh', () => {
  const r = route({
    risk_class: 'safe',
    diff_budget_lines: 400,
    allowed_files: ['lib/big.ts'],
    scope: { in_scope: ['Refactor lib/big.ts for clarity'] }
  });
  assert.equal(r.model, 'gpt-5.3-codex');
  assert.equal(r.effort, 'xhigh');
});

test('approval-required → codex xhigh', () => {
  const r = route({
    risk_class: 'approval-required',
    diff_budget_lines: 50,
    allowed_files: ['supabase/migrations/001.sql'],
    scope: { in_scope: ['Add user table migration'] }
  });
  assert.equal(r.model, 'gpt-5.3-codex');
  assert.equal(r.effort, 'xhigh');
});

test('mechanical → spark', () => {
  const r = route({
    risk_class: 'safe',
    diff_budget_lines: 20,
    allowed_files: ['app/page.tsx'],
    scope: { in_scope: ['Rename button label (text-only)'] }
  });
  assert.equal(r.model, 'gpt-5.3-codex-spark');
});

test('core types touched → codex high at least', () => {
  const r = route({
    risk_class: 'safe',
    diff_budget_lines: 50,
    allowed_files: ['lib/types/user.ts'],
    scope: { in_scope: ['Add field'] }
  });
  assert.equal(r.model, 'gpt-5.3-codex');
});

test('codex unavailable → claude fallback', () => {
  const r = route(
    { risk_class: 'safe', diff_budget_lines: 100, allowed_files: ['x.ts'], scope: { in_scope: ['thing'] } },
    { codexAvailable: false }
  );
  assert.equal(r.model, 'claude-sonnet-4-6');
  assert.match(r.reason, /codex-unavailable/);
});
