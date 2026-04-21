const PRIMARY_REREAD_FILE = 'tasks/events.ndjson';
const REQUIRED_SECTIONS = [
  'Machine fields',
  'Wave summary',
  'Pending from this wave',
  'Next wave pointer',
  'Canonical state to re-read',
  'Ephemeral nuances'
];
const REQUIRED_MACHINE_FIELDS = [
  'source_wave',
  'next_wave',
  'source_session_id',
  'handoff_token'
];

function asTrimmedString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeItems(value) {
  if (Array.isArray(value)) {
    return value.map(item => asTrimmedString(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map(line => line.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function renderBullets(items, { noneLabel = false } = {}) {
  if (items.length === 0 && noneLabel) return '- none';
  return items.map(item => `- ${item}`).join('\n');
}

function classifyHeading(heading) {
  if (heading === 'Machine fields') return { key: 'Machine fields' };
  const summaryMatch = heading.match(/^Wave\s+(\d+)\s+summary$/);
  if (summaryMatch) {
    return {
      key: 'Wave summary',
      wave: Number.parseInt(summaryMatch[1], 10)
    };
  }
  if (heading === 'Pending from this wave') return { key: 'Pending from this wave' };
  if (heading === 'Next wave pointer') return { key: 'Next wave pointer' };
  if (heading === 'Canonical state to re-read') return { key: 'Canonical state to re-read' };
  if (heading === 'Ephemeral nuances') return { key: 'Ephemeral nuances' };
  return null;
}

function getSectionBody(section) {
  return section.lines.join('\n').trim();
}

function parseBulletItems(sectionName, raw) {
  const body = raw.trim();
  if (!body) return [];
  return body.split('\n').map((line, index) => {
    const match = line.match(/^[-*]\s+(.*)$/);
    if (!match) {
      throw new Error(`${sectionName} line ${index + 1} must be a bullet`);
    }
    return match[1].trim();
  });
}

function parseKeyValueBullets(sectionName, raw) {
  const fields = {};
  for (const item of parseBulletItems(sectionName, raw)) {
    const match = item.match(/^([^:]+):\s*(.*)$/);
    if (!match) {
      throw new Error(`${sectionName} bullet must be "key: value"`);
    }
    fields[match[1].trim()] = match[2].trim();
  }
  return fields;
}

function parseIntegerField(name, value) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be parseable as an integer`);
  }
  return Number.parseInt(value, 10);
}

export function renderHandoff({
  source_wave,
  next_wave,
  source_session_id,
  handoff_token,
  summary,
  pending,
  next_manifest,
  first_task,
  reread_files,
  ephemeral_nuances
}) {
  const reread = unique([
    PRIMARY_REREAD_FILE,
    ...normalizeItems(reread_files).filter(item => item !== PRIMARY_REREAD_FILE)
  ]);
  const pendingItems = normalizeItems(pending);
  const nuanceItems = normalizeItems(ephemeral_nuances);

  return [
    `# Handoff — wave ${source_wave} → wave ${next_wave}`,
    '',
    '## Machine fields',
    `- source_wave: ${source_wave}`,
    `- next_wave: ${next_wave}`,
    `- source_session_id: ${source_session_id}`,
    `- handoff_token: ${handoff_token}`,
    '',
    `## Wave ${source_wave} summary`,
    asTrimmedString(summary),
    '',
    '## Pending from this wave',
    renderBullets(pendingItems, { noneLabel: true }),
    '',
    '## Next wave pointer',
    `- manifest: ${asTrimmedString(next_manifest)}`,
    `- first task: ${asTrimmedString(first_task)}`,
    '',
    '## Canonical state to re-read',
    renderBullets(reread),
    '',
    '## Ephemeral nuances',
    renderBullets(nuanceItems, { noneLabel: true }),
    ''
  ].join('\n');
}

export function parseHandoff(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new Error('parseHandoff requires a non-empty markdown string');
  }

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;
  let h1Count = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#\s+/.test(line)) {
      h1Count += 1;
      if (h1Count > 1) {
        throw new Error(`Unexpected extra H1 heading at line ${index + 1}`);
      }
    }

    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].trim(), lines: [] };
      continue;
    }

    if (current) current.lines.push(line);
  }

  if (current) sections.push(current);

  const seen = new Set();
  const keys = [];
  for (const section of sections) {
    const classified = classifyHeading(section.heading);
    if (!classified) {
      throw new Error(`Unexpected H2 heading: ${section.heading}`);
    }
    if (seen.has(classified.key)) {
      throw new Error(`Duplicate H2 heading: ${section.heading}`);
    }
    seen.add(classified.key);
    keys.push(classified.key);
    section.key = classified.key;
    section.meta = classified;
  }

  for (const required of REQUIRED_SECTIONS) {
    if (!seen.has(required)) {
      throw new Error(`Missing required section: ${required}`);
    }
  }

  if (keys.length !== REQUIRED_SECTIONS.length) {
    throw new Error(`Expected exactly ${REQUIRED_SECTIONS.length} H2 sections, found ${keys.length}`);
  }

  for (let index = 0; index < REQUIRED_SECTIONS.length; index += 1) {
    if (keys[index] !== REQUIRED_SECTIONS[index]) {
      throw new Error(
        `Sections out of order: expected "${REQUIRED_SECTIONS[index]}" before "${keys[index]}"`
      );
    }
  }

  const machineFields = parseKeyValueBullets('Machine fields', getSectionBody(sections[0]));
  for (const field of REQUIRED_MACHINE_FIELDS) {
    if (!machineFields[field]) {
      throw new Error(`Machine fields missing required subfield: ${field}`);
    }
  }

  machineFields.source_wave = parseIntegerField('source_wave', machineFields.source_wave);
  machineFields.next_wave = parseIntegerField('next_wave', machineFields.next_wave);

  if (sections[1].meta.wave !== machineFields.source_wave) {
    throw new Error(
      `Wave summary heading does not match source_wave: ${sections[1].meta.wave} vs ${machineFields.source_wave}`
    );
  }

  const pointerFields = parseKeyValueBullets('Next wave pointer', getSectionBody(sections[3]));

  return {
    machine_fields: machineFields,
    wave_summary: getSectionBody(sections[1]),
    pending: (() => {
      const items = parseBulletItems('Pending from this wave', getSectionBody(sections[2]));
      return items.length === 1 && items[0].toLowerCase() === 'none' ? [] : items;
    })(),
    next_wave_pointer: {
      manifest: pointerFields.manifest ?? '',
      first_task: pointerFields['first task'] ?? ''
    },
    reread_files: parseBulletItems('Canonical state to re-read', getSectionBody(sections[4])),
    ephemeral_nuances: (() => {
      const items = parseBulletItems('Ephemeral nuances', getSectionBody(sections[5]));
      return items.length === 1 && items[0].toLowerCase() === 'none' ? [] : items;
    })()
  };
}
