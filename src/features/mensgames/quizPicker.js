// Feeds the quiz round's picker (`RoundEditor.jsx`'s `QuizPanel`) a single,
// deduped list of finished quizzes to choose from — WP-Q10, docs/
// quiz-unification-spec.md §8.4, extended by the owner's direct request
// (2026-08-26): pick a quiz straight from the quiz feature, no event
// required first.
//
// `fetchQuizResults()` (features/quiz/results.js) alone only sees quizzes
// that have a row in the `quizzes` table. As of tonight's "the quiz is its
// own tool now" cutover, three shapes of finished quiz are real at once:
//
//   - migrated    — a `quizzes` row from the one-time migration
//   - built-since — finished under the old in-event system after the
//                   migration ran but before tonight's cutover; lives only
//                   in that event's `evt.quizzes[]`, no table row at all
//   - new         — has a `quizzes` row (and may also still carry a legacy
//                   `evt.quizzes[]` entry from before the cutover)
//
// `fetchQuizResults()` finds "migrated" and "new". It cannot find
// "built-since" — that quiz has no table row to select. This module folds
// the legacy per-event array back in, using the exact same merge rule
// App.jsx's `computeMemberStats`/`WinnersTab` already established for the
// same problem (docs/quiz-unification-spec.md §8.3 items 1 and 7, see the
// comments there): scan every event's `quizzes[]` for `status==='finished'`
// first, then add table results whose id isn't already covered. One merge
// rule in the codebase, not two — and for a genuinely duplicate id the
// content is expected identical (the table starts life as a snapshot of
// the legacy row, and nothing writes back to `events.quizzes` after the
// standalone cutover), so which copy is kept first doesn't change what a
// human sees.
import { useCallback, useEffect, useState } from 'react';
import { fetchQuizResults, isMissingTableError } from '../quiz/results.js';

export { isMissingTableError };

function fromLegacyQuiz(evt, q) {
  if (!q || typeof q !== 'object' || typeof q.id !== 'string' || !q.id) return null;
  return {
    id: q.id,
    title: typeof q.title === 'string' ? q.title : '',
    eventId: (evt && typeof evt.id === 'string') ? evt.id : null,
    status: typeof q.status === 'string' ? q.status : 'ready',
    teams: Array.isArray(q.teams) ? q.teams : [],
    scores: q.scores && typeof q.scores === 'object' ? q.scores : {},
    memberScores: q.memberScores && typeof q.memberScores === 'object' ? q.memberScores : {},
    settings: q.settings && typeof q.settings === 'object' ? q.settings : {},
    source: 'legacy',
  };
}

/**
 * Combines legacy `events.quizzes[]` with `tableQuizzes` (the shape
 * `fetchQuizResults()` resolves to) into one **finished-only**, deduped-by-
 * id list, legacy first. Never throws — a malformed `events` or
 * `tableQuizzes` argument degrades to treating that side as empty rather
 * than blowing up the whole list.
 */
export function combineFinishedQuizzes(events, tableQuizzes) {
  return combineFinishedQuizzesWithHidden(events, tableQuizzes).quizzes;
}

/**
 * Same merge, but also counts the finished quizzes withheld for being
 * secret. A secret quiz is correctly absent from the picker — but absent
 * and non-existent look identical in a dropdown, and someone who has just
 * marked a quiz secret and then cannot find it has no way to tell which
 * they are looking at. That ambiguity is the same shape as the silent
 * failures that cost this project a whole evening (a query returning `[]`
 * rather than throwing, an update matching zero rows without erroring), so
 * the count is surfaced and the UI says so rather than leaving a gap.
 *
 * Only the legacy half can be counted here: `fetchQuizResults()` filters
 * secret quizzes server-side before this ever sees them, by design (§7.3 —
 * a member's stats bumping pre-reveal is itself a tell). So this
 * undercounts for table-only quizzes, and the copy must not promise a
 * total.
 */
export function combineFinishedQuizzesWithHidden(events, tableQuizzes) {
  const eventList = Array.isArray(events) ? events : [];
  const fromLegacy = [];
  const seenIds = new Set();
  let hiddenSecret = 0;
  eventList.forEach((evt) => {
    const list = Array.isArray(evt?.quizzes) ? evt.quizzes : [];
    list.forEach((q) => {
      const norm = fromLegacyQuiz(evt, q);
      if (!norm || norm.status !== 'finished') return;
      if (norm.settings.secret === true) { hiddenSecret += 1; return; }
      if (seenIds.has(norm.id)) return;
      seenIds.add(norm.id);
      fromLegacy.push(norm);
    });
  });
  const fromTable = (Array.isArray(tableQuizzes) ? tableQuizzes : [])
    .filter((q) => q && typeof q === 'object' && typeof q.id === 'string' && q.id && !seenIds.has(q.id))
    .map((q) => ({ ...q, source: 'table' }));
  return { quizzes: [...fromLegacy, ...fromTable], hiddenSecret };
}

/**
 * `events` feeds the always-available, synchronous legacy half immediately
 * (no network round trip — `events` is already loaded app-wide); the table
 * half loads via `fetchQuizResults()` and merges in once it resolves.
 * Never rejects, matching `fetchQuizResults()`'s own contract: a table
 * fetch failure degrades `quizzes` to legacy-only plus a surfaced `error`
 * (and `isMissingTable` if that's what it is), never a silent empty list
 * indistinguishable from "no quizzes exist" — that distinction is the
 * caller's job to render, not this hook's to hide.
 */
export function useFinishedQuizzes(events) {
  const [table, setTable] = useState({ loading: true, quizzes: [], error: null, isMissingTable: false });

  const load = useCallback(() => {
    let cancelled = false;
    setTable((s) => ({ ...s, loading: true }));
    fetchQuizResults().then((res) => {
      if (cancelled) return;
      setTable({
        loading: false,
        quizzes: res.ok ? res.quizResults : [],
        error: res.ok ? null : res.error,
        isMissingTable: res.ok ? false : isMissingTableError(res.error),
      });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(), [load]);

  const merged = combineFinishedQuizzesWithHidden(events, table.quizzes);
  return {
    quizzes: merged.quizzes,
    // Finished-but-secret quizzes withheld from the list. Surfaced so the
    // UI can explain the gap instead of leaving one.
    hiddenSecret: merged.hiddenSecret,
    loading: table.loading,
    error: table.error,
    isMissingTable: table.isMissingTable,
    refetch: load,
  };
}
