// core/memory/index.mjs — one-stop entry for the retrieval-memory layer.
//
// Re-exports each helper namespace and provides a readAll() that returns
// compact slices suitable for inlining into a context-pack.

import * as decisions from './decisions.mjs';
import * as incidents from './incidents.mjs';
import * as services from './services.mjs';
import * as reuseIndex from './reuse-index.mjs';

export { decisions, incidents, services, reuseIndex };

// Collect the smallest useful slice of each memory surface for the
// context-packer. Callers pass a `query` hint (task goal / keywords) and
// optional `limit` values.
export async function readAll(project, {
  decisionsLimit = 20,
  incidentsLimit = 10,
  reuseTag = null,
  query = null
} = {}) {
  const q = (query || '').trim() || null;
  const [dec, inc, svc, reuse] = await Promise.all([
    decisions.list(project, { limit: decisionsLimit, subjectIncludes: q }),
    incidents.list(project, { limit: incidentsLimit, symptomIncludes: q }),
    services.read(project),
    reuseIndex.list(project, { tag: reuseTag, purposeIncludes: q })
  ]);
  return {
    decisions: dec,
    incidents: inc,
    services: svc,
    reuse_index: reuse
  };
}
