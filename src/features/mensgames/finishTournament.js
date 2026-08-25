// The tournament -> event/team-library write-back (docs/mensgames-spec.md
// §6, WP-J). Today "Afronden" only flips `tournament.status` -- a finished
// tournament leaves no trace anywhere else in the app. This module is what
// makes it mean something:
//  - every medalled entrant (top 3 in the final standings, ties share a
//    medal) gets a `Winner` row pushed onto the linked event, in the exact
//    shape `events.winners` already uses (`{id, category, winner, detail,
//    icon}`) -- so `WinnersTab` and `HallOfFame` render it with **no
//    changes to either**, which is the entire point of reusing that path.
//  - every medalled *team* entrant additionally gets a `TeamAward` (§3.1)
//    on its originating `team_sets` row, resolved via the `teamSetId`/
//    `sourceTeamId` provenance stamped onto the entrant when it was
//    materialised (`model.js`'s `entrantsFromTeamSet`). Individual-player
//    entrants (`kind:'player'`) have no team set and simply don't get one
//    -- they still get a Winner row.
//  - a tournament with no `eventId` still writes team awards; there is just
//    nothing to decorate on the event side (standalone tournaments are an
//    explicit part of the model, §4.2/§13 Q2).
//  - archiving the awarded team set(s) is an explicit, default-**off**
//    opt-in (`archiveWinningSets` -- §13 Q5: "manual tick, default off").
//    Never automatic.
//
// 2026-08-25 (WP-Q1, docs/quiz-unification-spec.md §7.1): the actual
// write-back logic (event re-read-before-write, sequential team-set award
// chaining, deterministic ids, per-write error collection) moved to
// `awards/publishResults.js`, generalised to be source-agnostic so the quiz
// can reuse it instead of a second copy. This file is now a thin adapter:
// it turns a `(tournament, standings)` pair into the tournament-shaped
// `source` descriptor and `Placement[]` that module expects, and keeps
// exporting the exact same names tournament callers already use.
// `winnerRowsFromTournament` and `buildTeamAwards` are pure, synchronous,
// and never throw on malformed input (`standings`, `tournament.entrants`
// and `teamSets` are all ultimately hand-editable JSONB -- the existing
// unguarded `w.winner.toLowerCase()` at App.jsx's `computeMemberStats` is
// the standing example of how an unguarded read like this bites). Only
// `finishTournament` itself does I/O, and a failed write for one team set
// doesn't stop the others -- it's reported back in `errors` instead of
// losing the whole operation.
import { buildTeamAwards as buildTeamAwardsForSource, publishResults, winnerRowsFromPlacements } from '../awards/publishResults.js';

function isoOf(now) {
  return new Date(now).toISOString();
}

function safeTournamentName(tournament) {
  return (tournament && typeof tournament.name === 'string' && tournament.name.trim()) || 'Toernooi';
}

function tournamentId(tournament) {
  return (tournament && typeof tournament.id === 'string' && tournament.id) || 'trn';
}

function tournamentEventId(tournament) {
  return (tournament && typeof tournament.eventId === 'string' && tournament.eventId) || null;
}

function toSource(tournament) {
  return { kind: 'tournament', id: tournamentId(tournament), name: safeTournamentName(tournament), eventId: tournamentEventId(tournament) };
}

/**
 * Standings rows ranked 1-3, paired with the entrant they belong to.
 * Ties share a rank (`computeStandings` already does this), so e.g. two
 * entrants tied for 2nd both come back — deliberately: both actually won
 * silver, and the next entrant does NOT get bronze (there is no rank 3
 * that round). Defensive against a malformed `standings` array, a rank
 * that isn't a finite number, or an entrant that no longer exists in
 * `tournament.entrants` (edited out after the round that scored it) —
 * those rows are dropped, never thrown on.
 */
function medalRows(tournament, standings) {
  const entrants = Array.isArray(tournament?.entrants) ? tournament.entrants : [];
  const byId = new Map(entrants.filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  const rows = Array.isArray(standings) ? standings : [];
  return rows
    .filter((r) => r && typeof r === 'object' && typeof r.entrantId === 'string' && Number.isFinite(r.rank) && r.rank >= 1 && r.rank <= 3)
    .map((r) => ({ row: r, entrant: byId.get(r.entrantId) || null }))
    .filter((x) => x.entrant);
}

/**
 * `(tournament, standings)` -> `Placement[]` (`awards/publishResults.js`'s
 * source-agnostic shape). `slot` carries the entrant's own stable id
 * (distinct from `sourceTeamId`, and the only stable id a player entrant
 * has) so `winnerRowsFromTournament`'s ids stay exactly what they were
 * before this extraction -- see that module's comment on `slot` for why.
 */
function tournamentPlacements(tournament, standings) {
  return medalRows(tournament, standings).map(({ row, entrant }) => {
    const members = Array.isArray(entrant.memberNames) ? entrant.memberNames.filter((m) => typeof m === 'string' && m) : [];
    const points = Number.isFinite(row.points) ? row.points : 0;
    const detail = [`${points} punt${points === 1 ? '' : 'en'}`, members.length ? members.join(', ') : null].filter(Boolean).join(' · ');
    return {
      rank: row.rank,
      name: (typeof entrant.name === 'string' && entrant.name.trim()) || 'Onbekend',
      kind: entrant.kind === 'team' ? 'team' : 'player',
      memberNames: members,
      teamSetId: typeof entrant.teamSetId === 'string' ? entrant.teamSetId : null,
      sourceTeamId: typeof entrant.sourceTeamId === 'string' ? entrant.sourceTeamId : null,
      detail,
      slot: entrant.id,
    };
  });
}

/**
 * `Winner[]` in the exact shape `events.winners` already uses. `id` is
 * deterministic (`mg-<tournamentId>-<entrantId>`), not time-based, so
 * re-finishing the same tournament (heropen -> afronden again, e.g. after
 * fixing a score) replaces its own previously-written rows instead of
 * piling up duplicates — see `finishTournament`'s dedup-by-replace.
 */
export function winnerRowsFromTournament(tournament, standings) {
  return winnerRowsFromPlacements(toSource(tournament), tournamentPlacements(tournament, standings));
}

/**
 * `TeamAward`s (§3.1) for every medalled *team* entrant, paired with the
 * `team_sets` row (from `teamSets`) they belong to. Player entrants, teams
 * with no provenance (`teamSetId`/`sourceTeamId`) and teams whose set is no
 * longer present in `teamSets` (deleted since the tournament ran) are
 * silently skipped. `award.id` is deterministic for the same
 * re-finish-is-idempotent reason as `winnerRowsFromTournament`.
 */
export function buildTeamAwards(tournament, standings, teamSets, opts = {}) {
  return buildTeamAwardsForSource(toSource(tournament), tournamentPlacements(tournament, standings), teamSets, opts);
}

function isSecretTournament(tournament) {
  return !!(tournament && tournament.settings && tournament.settings.secret);
}

/**
 * The actual publish: pushes deduped winner rows onto `event.winners`
 * (skipped entirely when there's no linked `event` or no `onUpdateEvent` --
 * a standalone tournament still awards teams, it just has nothing to
 * decorate) and adds a `TeamAward` to each medalled team's originating team
 * set. Split out from `finishTournament` (2026-08-24) so a tournament that
 * finished while still secret can call exactly this again, later, from its
 * "onthullen" (reveal) action -- see that function's own comment for why
 * finishing and publishing are two different moments for a secret one.
 * Never throws: a failed write for one team set (or the event) is collected
 * in `errors` rather than aborting the rest.
 */
export async function publishTournamentResults({ tournament, standings, event = null, onUpdateEvent, teamSets = [], archiveWinningSets = false, now = Date.now() }) {
  return publishResults({ source: toSource(tournament), placements: tournamentPlacements(tournament, standings), event, onUpdateEvent, teamSets, archiveWinningSets, now });
}

/**
 * The write-back itself (WP-J). Always sets `tournament.status` to
 * `'finished'` -- "afronden" locks scoring in either case. But when the
 * tournament is secret (`settings.secret`, 2026-08-24), publishing is
 * deferred: `events.winners` (read by every member via WinnersTab/
 * HallOfFame) and `team_sets.awards` (read by every member via the Team
 * Trophy Cabinet, also on Hall of Fame) are both visible surfaces that
 * would spoil the reveal the instant "Afronden" is clicked, regardless of
 * whether the tournament's own row/standings/scoreboard stay hidden
 * elsewhere. `TournamentEditor`'s reveal ("onthullen") action calls
 * `publishTournamentResults` itself once the owner actually lifts the
 * secrecy, using the (by-then-current) standings at that moment.
 */
export async function finishTournament({ tournament, standings, event = null, onUpdateEvent, teamSets = [], archiveWinningSets = false, now = Date.now() }) {
  const finishedTournament = { ...tournament, status: 'finished', updatedAt: isoOf(now) };

  if (isSecretTournament(tournament)) {
    const winners = winnerRowsFromTournament(tournament, standings);
    const teamAwards = buildTeamAwards(tournament, standings, teamSets, { now });
    return { ok: true, tournament: finishedTournament, winners, teamAwards, updatedTeamSets: [], errors: [], deferred: true };
  }

  const published = await publishTournamentResults({ tournament, standings, event, onUpdateEvent, teamSets, archiveWinningSets, now });
  return { ...published, tournament: finishedTournament, deferred: false };
}
