import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHandoff, renderHandoff } from '../wave-handoff.mjs';

function baseInput() {
  return {
    source_wave: 3,
    next_wave: 4,
    source_session_id: 'sess_01KPP9ABCDEFGHJKMNPQRSTVW',
    handoff_token: '20260421T120000Z-deadbeef',
    summary: 'Wave 3 finished implementation and queued the remaining review follow-up.',
    pending: ['TASK_REVIEW_01', 'TASK_DOC_02'],
    next_manifest: 'tasks/waves/4/manifest.yaml',
    first_task: 'TASK_DEPLOY_03',
    reread_files: [
      'CLAUDE.md',
      'HANDOFF.md',
      'tasks/waves/4/manifest.yaml',
      'tasks/waves/3/handoff-to-next.md (this file)'
    ],
    ephemeral_nuances: ['CI is flaky on Darwin; rerun once before escalating.']
  };
}

function render() {
  return renderHandoff(baseInput());
}

test('render -> parse round-trips identity and is deterministic', () => {
  const input = baseInput();
  const first = renderHandoff(input);
  const second = renderHandoff(input);

  assert.equal(first, second);
  assert.deepEqual(
    parseHandoff(first),
    {
      machine_fields: {
        source_wave: 3,
        next_wave: 4,
        source_session_id: 'sess_01KPP9ABCDEFGHJKMNPQRSTVW',
        handoff_token: '20260421T120000Z-deadbeef'
      },
      wave_summary: 'Wave 3 finished implementation and queued the remaining review follow-up.',
      pending: ['TASK_REVIEW_01', 'TASK_DOC_02'],
      next_wave_pointer: {
        manifest: 'tasks/waves/4/manifest.yaml',
        first_task: 'TASK_DEPLOY_03'
      },
      reread_files: [
        'tasks/events.ndjson',
        'CLAUDE.md',
        'HANDOFF.md',
        'tasks/waves/4/manifest.yaml',
        'tasks/waves/3/handoff-to-next.md (this file)'
      ],
      ephemeral_nuances: ['CI is flaky on Darwin; rerun once before escalating.']
    }
  );
});

test('rendered output places tasks/events.ndjson first in Canonical state to re-read', () => {
  const markdown = render();
  const canonicalSection = markdown.match(
    /## Canonical state to re-read\n([\s\S]*?)\n## Ephemeral nuances/
  );

  assert.ok(canonicalSection, 'canonical state section missing');
  const bullets = canonicalSection[1]
    .trim()
    .split('\n')
    .filter(Boolean);
  assert.equal(bullets[0], '- tasks/events.ndjson');
});

test('parser rejects missing section', () => {
  const markdown = render().replace(/\n## Ephemeral nuances[\s\S]*$/, '\n');
  assert.throws(() => parseHandoff(markdown), /Missing required section: Ephemeral nuances/);
});

test('parser rejects duplicate H2 heading', () => {
  const markdown = `${render()}\n## Pending from this wave\n- EXTRA_TASK\n`;
  assert.throws(() => parseHandoff(markdown), /Duplicate H2 heading: Pending from this wave/);
});

test('parser rejects out-of-order sections', () => {
  const markdown = [
    '# Handoff — wave 3 → wave 4',
    '',
    '## Machine fields',
    '- source_wave: 3',
    '- next_wave: 4',
    '- source_session_id: sess_01KPP9ABCDEFGHJKMNPQRSTVW',
    '- handoff_token: 20260421T120000Z-deadbeef',
    '',
    '## Wave 3 summary',
    'Wave 3 finished implementation and queued the remaining review follow-up.',
    '',
    '## Next wave pointer',
    '- manifest: tasks/waves/4/manifest.yaml',
    '- first task: TASK_DEPLOY_03',
    '',
    '## Pending from this wave',
    '- TASK_REVIEW_01',
    '',
    '## Canonical state to re-read',
    '- tasks/events.ndjson',
    '',
    '## Ephemeral nuances',
    '- none',
    ''
  ].join('\n');

  assert.throws(() => parseHandoff(markdown), /Sections out of order/);
});

test('parser rejects missing Machine fields subfield', () => {
  const markdown = render().replace(/- handoff_token: .*?\n/, '');
  assert.throws(() => parseHandoff(markdown), /Machine fields missing required subfield: handoff_token/);
});

test('parser rejects non-integer wave numbers', () => {
  const markdown = render().replace('- source_wave: 3', '- source_wave: three');
  assert.throws(() => parseHandoff(markdown), /source_wave must be parseable as an integer/);
});

test('parser rejects extra level-1 heading', () => {
  const markdown = `${render()}\n# Extra heading\n`;
  assert.throws(() => parseHandoff(markdown), /Unexpected extra H1 heading/);
});
