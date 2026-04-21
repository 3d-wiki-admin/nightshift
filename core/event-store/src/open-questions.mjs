// open-questions.mjs — single source of truth on which question.asked
// events are still unresolved. Hotfix-2 §Cross-cutting.
//
// Resolution rules:
//   - Add on `question.asked` keyed by payload.question_id.
//   - Drop entries with missing/empty payload.question_id (cannot be
//     resolved by any future event; log dropped event_ids to stderr so
//     the operator notices the bad producer).
//   - Remove on `question.answered` with same question_id.
//   - Remove on `decision.recorded` with payload.question_id matching.
//   This matches `core/event-store/src/projection.mjs:184-190` resolution.

function hasQuestionId(questionId) {
  return questionId !== undefined && questionId !== null && questionId !== '';
}

export function openQuestions(events) {
  const unresolved = new Map();
  let order = 0;

  for (const event of events) {
    if (event?.action === 'question.asked') {
      const questionId = event.payload?.question_id;

      if (!hasQuestionId(questionId)) {
        console.warn('openQuestions: dropped malformed question.asked event', event?.event_id);
        continue;
      }

      unresolved.set(questionId, {
        id: questionId,
        ts: event.ts,
        payload: event.payload,
        wave: event.wave,
        task_id: event.task_id,
        order: order++
      });
      continue;
    }

    if (event?.action === 'question.answered' || event?.action === 'decision.recorded') {
      const questionId = event.payload?.question_id;
      if (hasQuestionId(questionId)) unresolved.delete(questionId);
    }
  }

  return [...unresolved.values()]
    .sort((a, b) => a.ts.localeCompare(b.ts) || a.order - b.order)
    .map(({ order: _order, ...question }) => question);
}
