// Eager, tiny -- imported by App.jsx directly, NOT part of the lazy quiz
// chunk (docs/quiz-unification-spec.md §8.1, mirrors `teamlib/api.js`'s
// reasoning for its own eager exports). `fetchQuizResults()` feeds
// `computeMemberStats`/`HallOfFame` at boot, so it must project columns
// explicitly -- never `select *` -- to keep a finished quiz at ~1 kB
// instead of ~33 kB of `rounds`. It also must **never reject**: the App
// boot `Promise.all` (App.jsx, alongside `fetchTeamSets`) depends on that,
// and `App.quizResultsError.test.jsx`-style coverage guards it below.
import { supabase } from '../../supabase.js';
import { isMissingTableError } from './api.js';

export { isMissingTableError };

function fromResultRow(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  return {
    id: row.id,
    title: row.title || '',
    eventId: row.event_id ?? null,
    status: row.status || 'finished',
    teams: Array.isArray(row.teams) ? row.teams : [],
    scores: row.scores && typeof row.scores === 'object' ? row.scores : {},
    memberScores: row.member_scores && typeof row.member_scores === 'object' ? row.member_scores : {},
    finishedAt: row.finished_at || null,
    settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
  };
}

/**
 * Column projection only -- `id,title,event_id,status,teams,scores,
 * member_scores,finished_at,settings`, deliberately excluding `rounds`
 * (the ~33 kB field). ~1 kB per finished quiz. Never rejects: a Supabase
 * error (including a missing-table error pre-migration) resolves to
 * `{ok:false,error,quizResults:[]}`, exactly like `fetchTeamSets` in
 * `teamlib/api.js` -- callers that need to tell "not set up" apart from
 * "network problem" use the re-exported `isMissingTableError(error)`.
 *
 * 2026-08-26 (WP-Q6, §7.3): excludes a still-secret quiz
 * (`settings.secret===true`) even though it's `status==='finished'`. This
 * feeds `computeMemberStats`/`HallOfFame` once WP-Q8/Q9 wire it up -- and
 * although §7.3 only names `events.winners`/`team_sets.awards` as the two
 * member-visible leaks a secret quiz must not spring, this eager,
 * every-boot fetch is the same shape of leak (a member's own stats bumping
 * before the reveal is a tell) and costs one line to close pre-emptively,
 * before anything depends on the opposite behaviour. A revealed quiz flips
 * `settings.secret` back to `false` (the same convention
 * `finishTournament.js`'s `toggleSecret` uses), so it appears here again
 * the moment it's revealed, with no separate "revealed" flag to keep in
 * sync.
 */
export async function fetchQuizResults() {
  try {
    const { data, error } = await supabase
      .from('quizzes')
      .select('id,title,event_id,status,teams,scores,member_scores,finished_at,settings')
      .eq('status', 'finished');
    if (error) {
      console.error('fetchQuizResults failed:', error);
      return { ok: false, error, quizResults: [] };
    }
    const results = (Array.isArray(data) ? data : [])
      .map(fromResultRow)
      .filter(Boolean)
      .filter((q) => !(q.settings && q.settings.secret === true));
    return { ok: true, error: null, quizResults: results };
  } catch (error) {
    // Belt-and-braces: a hard network throw (not a resolved {error}) must
    // still resolve, never reject -- the boot `Promise.all` has no `.catch`
    // per-item, only one at the very end for a genuinely unreachable app.
    console.error('fetchQuizResults threw:', error);
    return { ok: false, error, quizResults: [] };
  }
}

/**
 * The §7.4 "derived quiz-winner card" filter, as a pure, tested function
 * rather than inline WinnersTab logic (which lives in App.jsx, off limits
 * to this work package -- see this file's own report for the exact
 * one-line call WP-Q7/Q8 needs to wire in).
 *
 * `WinnersTab` synthesizes an "AUTO" card per finished quiz straight off
 * `evt.quizzes`/`scores` (App.jsx ~2916). Once `finishQuiz` writes a real,
 * editable `Winner` row for that same quiz (`awards/
 * publishResults.js`'s `qz-<quizId>-<slot>` id scheme), rendering both is a
 * double card for one result. This is the dedup check: true if `winners`
 * already contains a real award for this quiz, in which case the AUTO card
 * should be suppressed for it.
 *
 * Deliberately NOT the regex §7.4 proposes
 * (`/^qz-(.+?)-\d+$/`) -- that pattern assumes the id's last segment is
 * plain digits, but `winnerRowsFromPlacements`'s `slot` is a team's
 * `sourceTeamId` (arbitrary library id) or a slugified name for a player,
 * neither of which is reliably numeric; the regex silently fails to match
 * real quiz winner rows for exactly the common cases (a real quiz result)
 * this filter exists to catch. Matching on the exact, already-known prefix
 * (`qz-<quiz.id>-`) -- the same prefix `pushWinnersToEvent` itself dedupes
 * on -- is unambiguous and needs no parsing.
 */
export function isQuizAlreadyPublished(quiz, winners) {
  const id = quiz && typeof quiz.id === 'string' && quiz.id;
  if (!id) return false;
  const prefix = `qz-${id}-`;
  return (Array.isArray(winners) ? winners : []).some((w) => w && typeof w.id === 'string' && w.id.startsWith(prefix));
}
