// The pure half of the quiz round adapter (WP-G; docs/mensgames-spec.md
// §4.4). No quiz code is touched or reimplemented — this only reads
// `evt.quizzes` and matches its score keys (free-typed names) against
// entrant names. Case-insensitive **exact** match only: nothing is guessed.
// Anything that doesn't match is surfaced as `unmatched` for the UI to
// resolve via a dropdown, never auto-assigned.
import { toFiniteNumber } from './scoring/shared.js';

function normalizeName(name) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/**
 * Matches a quiz's `{name: score}` map against a list of entrants.
 *  - `nameMap` (existing `round.source.nameMap`) is treated as
 *    already-resolved: if it maps a name to an id that's still a valid
 *    entrant, that name is matched to that id, no re-matching. This is what
 *    lets a previously-confirmed manual pick survive a re-pull without
 *    flip-flopping.
 *  - Everything else gets one shot at a case-insensitive exact match
 *    against `entrant.name`.
 *  - Anything left is `unmatched` — surfaced, never guessed.
 * Returns `{ matched: [{name, entrantId, score}], unmatched: [{name, score}] }`.
 */
export function matchQuizNames(scores, entrants, nameMap = {}) {
  const raw = scores && typeof scores === 'object' ? scores : {};
  const entrantList = Array.isArray(entrants) ? entrants.filter((e) => e && typeof e.id === 'string') : [];
  const validIds = new Set(entrantList.map((e) => e.id));
  const byNormalizedName = new Map();
  entrantList.forEach((e) => {
    const key = normalizeName(e.name);
    if (key && !byNormalizedName.has(key)) byNormalizedName.set(key, e.id);
  });
  const map = nameMap && typeof nameMap === 'object' ? nameMap : {};

  const matched = [];
  const unmatched = [];
  Object.keys(raw).forEach((name) => {
    const score = toFiniteNumber(raw[name], 0);
    const existing = map[name];
    if (typeof existing === 'string' && validIds.has(existing)) {
      matched.push({ name, entrantId: existing, score });
      return;
    }
    const auto = byNormalizedName.get(normalizeName(name));
    if (auto) {
      matched.push({ name, entrantId: auto, score });
      return;
    }
    unmatched.push({ name, score });
  });

  return { matched, unmatched };
}

/**
 * Pulls the finished quiz named on `round.source.quizId` from `event` and
 * **freezes** a snapshot into `source.raw` / `source.pulledAt`, so a later
 * edit to the live quiz can never retroactively change a locked standing
 * (§4.4). Returns a new round object; never mutates `round`. If no matching
 * finished quiz is found, returns `round` unchanged.
 */
export function pullQuizResults(round, event, nowIso = new Date().toISOString()) {
  if (!round || typeof round !== 'object' || !round.source || typeof round.source !== 'object') return round;
  const quizzes = Array.isArray(event?.quizzes) ? event.quizzes : [];
  const quiz = quizzes.find((q) => q && q.id === round.source.quizId && q.status === 'finished');
  if (!quiz) return round;
  const raw = quiz.scores && typeof quiz.scores === 'object' ? JSON.parse(JSON.stringify(quiz.scores)) : {};
  return {
    ...round,
    source: {
      ...round.source,
      raw,
      pulledAt: nowIso,
    },
  };
}
