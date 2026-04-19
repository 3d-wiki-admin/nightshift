#!/usr/bin/env node
// router.mjs — implementer router (Path C, spec §6.1).
// Given a task contract (JSON from YAML frontmatter), returns the model and effort
// the orchestrator should dispatch with, and the reason.

import { promises as fs } from 'node:fs';

const CORE_TYPE_PATTERNS = [
  /^lib\/types\//,
  /^lib\/schema\//,
  /^core\//,
  /^app\/api\/.+\/schema\.ts$/,
  /\/contracts\//
];

function touchesCoreTypes(files = []) {
  return files.some(f => CORE_TYPE_PATTERNS.some(re => re.test(f)));
}

function looksMechanical(contract) {
  const hints = (contract.scope?.in_scope || []).join(' ').toLowerCase();
  return /\b(rename|typo|text-only|obvious|trivial|punctuation)\b/.test(hints)
    && (contract.diff_budget_lines || 0) <= 50;
}

function looksRefactor(contract) {
  const hints = (contract.scope?.in_scope || []).join(' ').toLowerCase();
  return /\brefactor\b/.test(hints);
}

export function route(contract, { codexAvailable = true } = {}) {
  const diffBudget = contract.diff_budget_lines || 150;
  const risk = contract.risk_class;

  if (!codexAvailable) {
    return {
      model: 'claude-sonnet-4-6',
      effort: 'default',
      reason: 'codex-unavailable (fallback per §23 degraded mode)'
    };
  }

  if (risk === 'approval-required') {
    return {
      model: 'gpt-5.3-codex',
      effort: 'xhigh',
      reason: 'risk=approval-required → xhigh effort required'
    };
  }

  if (looksMechanical(contract)) {
    return {
      model: 'gpt-5.3-codex-spark',
      effort: 'default',
      reason: 'scope keywords suggest mechanical/trivial change'
    };
  }

  if (
    risk === 'review-required' ||
    diffBudget > 150 ||
    looksRefactor(contract) ||
    touchesCoreTypes(contract.allowed_files || [])
  ) {
    const effort = diffBudget > 300 || looksRefactor(contract) ? 'xhigh' : 'high';
    const reasons = [];
    if (risk === 'review-required') reasons.push('risk=review-required');
    if (diffBudget > 150) reasons.push(`diff_budget=${diffBudget}`);
    if (looksRefactor(contract)) reasons.push('refactor keyword');
    if (touchesCoreTypes(contract.allowed_files || [])) reasons.push('touches core types');
    return {
      model: 'gpt-5.3-codex',
      effort,
      reason: reasons.join(', ')
    };
  }

  return {
    model: 'gpt-5.4',
    effort: 'default',
    reason: 'safe + small + straightforward'
  };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(`
Usage: router.mjs <contract.json> [--no-codex]

Reads a task contract (JSON) and prints the routing decision:
  { "model": "...", "effort": "...", "reason": "..." }
    `.trim());
    process.exit(2);
  }
  const contract = JSON.parse(await fs.readFile(arg, 'utf8'));
  const codexAvailable = !process.argv.includes('--no-codex');
  const decision = route(contract, { codexAvailable });
  process.stdout.write(JSON.stringify(decision, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
