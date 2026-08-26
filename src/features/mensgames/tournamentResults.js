// Eager, tiny -- imported by App.jsx directly, NOT part of the lazy
// mens-games chunk. Mirrors `features/quiz/results.js` exactly (same
// contract, same "eager, tiny" reasoning from docs/quiz-unification-spec.md
// §8.1) for the symmetrical need on the tournament side: the owner's
// 2026-08-26 decision retired the event page's Mens-Games 🏆 tab, and
// `WinnersTab`'s existing quiz-AUTO-card pattern (App.jsx ~2916, §7.4) is
// the one, shared pattern for "a finished result shows up on its event's
// Winners tab automatically" -- this file is what lets the tournament side
// use the *same* pattern instead of a second one.
//
// App.jsx never fetches the whole `tournaments` table or imports
// `MensGamesShell`/anything else from this feature's lazy chunk
// (docs/mensgames-spec.md §5.3, App.jsx's own header comment) -- this stays
// the one deliberate crack in that wall, exactly as narrow as
// `fetchQuizResults()` is on the quiz side.
//
// **Why this can't be as cheap as `fetchQuizResults()`.** A finished quiz
// carries its final result on a flat, already-aggregated `scores` column --
// `fetchQuizResults()` can exclude the (heavy, ~33kB) `rounds` field
// entirely and still know who won. A tournament has no such column: its
// only record of who scored what is the per-round `results.points` frozen
// onto each locked round by `lockRound` (`standings.js`). There is nothing
// to compute a winner from other than `entrants` + `rounds`, so unlike the
// quiz projection, both are selected here -- this is "the columns Winners
// actually needs", not "select *" (excludes `team_set_id`, `created_by`,
// `created_at`, `updated_at`, none of which the AUTO card renders).
//
// **Why this doesn't import `standings.js`.** `computeStandings` (and the
// head-to-head tie-break it builds via `getScoringType(...).resolve(...)`)
// pulls in the entire scoring-plugin registry -- exactly the "anything
// heavy" App.jsx's main chunk must not gain. The AUTO card only needs *a*
// leader, not an authoritative, tie-broken final ranking (the real award
// rows `finishTournament`/`publishResults.js` write already are that,
// off the lazy chunk, and win the dedupe below the moment they exist) --
// so `tournamentWinnerPlacement` below sums each locked round's already-
// frozen `results.points` itself, in plain arithmetic, with no scoring
// plugin involved. An unlocked/live round (no `results` yet) simply
// doesn't count, same as `computeStandings` without `includeUnlocked`.
import { supabase } from '../../supabase.js';
import { isMissingTableError } from './api.js';

export { isMissingTableError };

function fromResultRow(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  return {
    id: row.id,
    name: row.name || '',
    eventId: row.event_id ?? null,
    status: row.status || 'finished',
    entrants: Array.isArray(row.entrants) ? row.entrants : [],
    rounds: Array.isArray(row.rounds) ? row.rounds : [],
    settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
  };
}

/**
 * Column projection only -- `id,name,event_id,status,entrants,rounds,
 * settings`. Never rejects: a Supabase error (including a missing-table
 * error pre-migration, e.g. mens-games never unlocked) resolves to
 * `{ok:false,error,tournamentResults:[]}`, exactly like `fetchQuizResults`/
 * `fetchTeamSets`.
 *
 * Excludes a still-secret tournament (`settings.secret===true`) even though
 * it's `status==='finished'` -- defence in depth, not the only guard: this
 * is the *fetch-layer* half of "a secret tournament must never appear" (the
 * *display-layer* half is `WinnersTab`'s own `!settings.secret` check before
 * it ever calls `tournamentWinnerPlacement`). Two independent checks,
 * deliberately redundant, because this exact invariant has already been
 * broken twice on this project by a single leaking channel -- see
 * `finishTournament.js`'s own secret-deferral comment. A revealed
 * tournament flips `settings.secret` back to `false` (same convention as
 * the quiz's `toggleSecret`), so it appears here again the moment it's
 * revealed, with no separate "revealed" flag to keep in sync.
 */
export async function fetchTournamentResults() {
  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id,name,event_id,status,entrants,rounds,settings')
      .eq('status', 'finished');
    if (error) {
      console.error('fetchTournamentResults failed:', error);
      return { ok: false, error, tournamentResults: [] };
    }
    const results = (Array.isArray(data) ? data : [])
      .map(fromResultRow)
      .filter(Boolean)
      .filter((t) => !(t.settings && t.settings.secret === true));
    return { ok: true, error: null, tournamentResults: results };
  } catch (error) {
    // Belt-and-braces: a hard network throw (not a resolved {error}) must
    // still resolve, never reject -- the boot `Promise.all` has no `.catch`
    // per-item, only one at the very end for a genuinely unreachable app.
    console.error('fetchTournamentResults threw:', error);
    return { ok: false, error, tournamentResults: [] };
  }
}

/**
 * The tournament-side `isQuizAlreadyPublished` -- a prefix match on
 * `mg-<tournament.id>-`, the exact id scheme `winnerRowsFromPlacements`
 * (`features/awards/publishResults.js`) already writes real award rows
 * under, and the exact prefix `pushWinnersToEvent` itself dedupes on. True
 * if `winners` already contains a real award for this tournament, in which
 * case `WinnersTab` must suppress the AUTO card for it.
 */
export function isTournamentAlreadyPublished(tournament, winners) {
  const id = tournament && typeof tournament.id === 'string' && tournament.id;
  if (!id) return false;
  const prefix = `mg-${id}-`;
  return (Array.isArray(winners) ? winners : []).some((w) => w && typeof w.id === 'string' && w.id.startsWith(prefix));
}

/**
 * Pure, synchronous, never throws (`entrants`/`rounds` are ultimately
 * hand-editable JSONB, same posture `finishTournament.js` takes on the same
 * data). Returns the single highest-scoring entrant across every *locked*
 * round (`round.status==='done'` with a frozen `round.results.points`) as
 * `{name, detail, isTeam, avatar}`, or `null` if no round has been locked
 * yet (nothing to show -- same as the quiz AUTO card requiring
 * `Object.keys(quiz.scores).length>0`).
 *
 * Deliberately *not* `computeStandings` (see module header): this is a
 * best-effort leader for a fallback display card, not an authoritative
 * placement. A genuine tie for first is broken arbitrarily (first entrant
 * encountered keeps it) -- the same level of rigor the quiz AUTO card
 * applies to its own `Object.entries(quiz.scores).sort(...)[0]`.
 */
export function tournamentWinnerPlacement(tournament) {
  if (!tournament || typeof tournament !== 'object') return null;
  const entrants = Array.isArray(tournament.entrants) ? tournament.entrants : [];
  const rounds = Array.isArray(tournament.rounds) ? tournament.rounds : [];
  const byId = new Map(entrants.filter((e) => e && typeof e === 'object' && typeof e.id === 'string').map((e) => [e.id, e]));

  const totals = new Map();
  rounds.forEach((round) => {
    if (!round || typeof round !== 'object' || round.status !== 'done') return;
    const points = round.results && typeof round.results === 'object' && round.results.points && typeof round.results.points === 'object'
      ? round.results.points
      : null;
    if (!points) return;
    Object.entries(points).forEach(([entrantId, pts]) => {
      if (!byId.has(entrantId)) return;
      const n = Number.isFinite(pts) ? pts : 0;
      totals.set(entrantId, (totals.get(entrantId) || 0) + n);
    });
  });
  if (totals.size === 0) return null;

  let topId = null;
  let topScore = -Infinity;
  totals.forEach((score, entrantId) => {
    if (score > topScore) {
      topScore = score;
      topId = entrantId;
    }
  });
  const entrant = topId ? byId.get(topId) : null;
  if (!entrant) return null;

  const isTeam = entrant.kind === 'team';
  const members = Array.isArray(entrant.memberNames) ? entrant.memberNames.filter((m) => typeof m === 'string' && m) : [];
  const detail = isTeam && members.length ? `${topScore} pts · ${members.join(', ')}` : `${topScore} pts`;
  return {
    name: (typeof entrant.name === 'string' && entrant.name.trim()) || 'Onbekend',
    detail,
    isTeam,
    avatar: (typeof entrant.avatar === 'string' && entrant.avatar) || (isTeam ? '🎯' : '🏆'),
  };
}
