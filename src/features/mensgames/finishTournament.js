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
// `winnerRowsFromTournament` and `buildTeamAwards` are pure, synchronous,
// and never throw on malformed input (`standings`, `tournament.entrants`
// and `teamSets` are all ultimately hand-editable JSONB -- the existing
// unguarded `w.winner.toLowerCase()` at App.jsx's `computeMemberStats` is
// the standing example of how an unguarded read like this bites). Only
// `finishTournament` itself does I/O, and a failed write for one team set
// doesn't stop the others -- it's reported back in `errors` instead of
// losing the whole operation.
import { supabase } from '../../supabase.js';
import { addTeamAward, archiveTeamSet } from '../teamlib/api.js';

const MEDAL_ICON = { 1: '🥇', 2: '🥈', 3: '🥉' };
const MEDAL_LABEL = { 1: '1e plaats', 2: '2e plaats', 3: '3e plaats' };

function isoOf(now) {
  return new Date(now).toISOString();
}

function safeTournamentName(tournament) {
  return (tournament && typeof tournament.name === 'string' && tournament.name.trim()) || 'Toernooi';
}

function medalLabel(rank) {
  return MEDAL_LABEL[rank] || `${rank}e plaats`;
}

function medalIcon(rank) {
  return MEDAL_ICON[rank] || '🏆';
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
 * `Winner[]` in the exact shape `events.winners` already uses. `id` is
 * deterministic (`mg-<tournamentId>-<entrantId>`), not time-based, so
 * re-finishing the same tournament (heropen -> afronden again, e.g. after
 * fixing a score) replaces its own previously-written rows instead of
 * piling up duplicates — see `finishTournament`'s dedup-by-replace.
 */
export function winnerRowsFromTournament(tournament, standings) {
  const tName = safeTournamentName(tournament);
  const tId = (tournament && typeof tournament.id === 'string' && tournament.id) || 'trn';
  return medalRows(tournament, standings).map(({ row, entrant }) => {
    const rank = row.rank;
    const members = Array.isArray(entrant.memberNames) ? entrant.memberNames.filter((m) => typeof m === 'string' && m) : [];
    const points = Number.isFinite(row.points) ? row.points : 0;
    const detail = [`${points} punt${points === 1 ? '' : 'en'}`, members.length ? members.join(', ') : null].filter(Boolean).join(' · ');
    return {
      id: `mg-${tId}-${entrant.id}`,
      category: `🏆 ${tName} — ${medalLabel(rank)}`,
      winner: (typeof entrant.name === 'string' && entrant.name.trim()) || 'Onbekend',
      detail,
      icon: medalIcon(rank),
    };
  });
}

/**
 * `TeamAward`s (§3.1) for every medalled *team* entrant, paired with the
 * `team_sets` row (from `teamSets`) they belong to. Player entrants, teams
 * with no provenance (`teamSetId`/`sourceTeamId`) and teams whose set is no
 * longer present in `teamSets` (deleted since the tournament ran) are
 * silently skipped. `award.id` is deterministic for the same
 * re-finish-is-idempotent reason as `winnerRowsFromTournament`.
 */
export function buildTeamAwards(tournament, standings, teamSets, { now = Date.now() } = {}) {
  const sets = Array.isArray(teamSets) ? teamSets : [];
  const setsById = new Map(sets.filter((s) => s && typeof s.id === 'string').map((s) => [s.id, s]));
  const tName = safeTournamentName(tournament);
  const tId = (tournament && typeof tournament.id === 'string' && tournament.id) || 'trn';
  const eventId = (tournament && typeof tournament.eventId === 'string' && tournament.eventId) || null;
  const awardedAt = isoOf(now);
  const out = [];
  medalRows(tournament, standings).forEach(({ row, entrant }) => {
    if (!entrant || entrant.kind !== 'team') return;
    if (typeof entrant.teamSetId !== 'string' || !entrant.teamSetId) return;
    if (typeof entrant.sourceTeamId !== 'string' || !entrant.sourceTeamId) return;
    const teamSet = setsById.get(entrant.teamSetId);
    if (!teamSet) return;
    const rank = row.rank;
    out.push({
      teamSet,
      award: {
        id: `aw_${tId}_${entrant.sourceTeamId}`,
        teamId: entrant.sourceTeamId,
        label: `${medalIcon(rank)} ${tName} — ${medalLabel(rank)}`,
        placement: rank,
        tournamentId: tId,
        eventId,
        note: '',
        awardedAt,
      },
    });
  });
  return out;
}

function isSecretTournament(tournament) {
  return !!(tournament && tournament.settings && tournament.settings.secret);
}

async function pushWinnersToEvent(tournament, winners, event, onUpdateEvent) {
  if (!(event && typeof event === 'object' && typeof onUpdateEvent === 'function')) return null;
  const tId = (tournament && typeof tournament.id === 'string' && tournament.id) || 'trn';
  const prefix = `mg-${tId}-`;
  try {
    // Re-read the event row immediately before writing rather than
    // trusting the possibly-stale `event` object passed in. The global
    // Mens-Games page has no realtime subscription on events (only a 30s
    // poll), so building the write off that stale object and letting
    // `onUpdateEvent` do its usual full-row upsert could silently discard
    // a concurrent write to any other field on the same event -- live
    // quiz scores, RSVPs, kretjes, photos. Same idiom App.jsx's own quiz
    // handlers use (`writeAnswer`, `changeTeamAvatar`, "End Session"):
    // fetch fresh, merge, write off the fresh copy. Falls back to the
    // passed-in `event` only if the fresh read itself comes back empty
    // (e.g. a transient blip) so a finish still completes rather than
    // silently dropping the awards.
    const { data: fresh } = await supabase.from('events').select('*').eq('id', event.id).single();
    const base = (fresh && typeof fresh === 'object') ? fresh : event;
    const existing = Array.isArray(base.winners) ? base.winners : [];
    const kept = existing.filter((w) => !(w && typeof w.id === 'string' && w.id.startsWith(prefix)));
    await onUpdateEvent({ ...base, winners: [...kept, ...winners] });
    return null;
  } catch (error) {
    return { scope: 'event', error };
  }
}

async function writeTeamAwards(teamAwards, { archiveWinningSets = false } = {}) {
  const errors = [];
  // Two medalled entrants can share one team set (e.g. gold and silver both
  // coming out of the same 4-team library set) -- writes for the same set
  // must chain off each other's result, not off the original stale object,
  // or the second write's full-row upsert clobbers the first award. Tracked
  // by id, sequentially, one HTTP round trip at a time (rare, small N --
  // a tournament has at most 3 medals).
  const latestById = new Map();
  for (const { teamSet, award } of teamAwards) {
    const current = latestById.get(teamSet.id) || teamSet;
    const already = Array.isArray(current.awards) && current.awards.some((a) => a && a.id === award.id);
    if (already) { latestById.set(teamSet.id, current); continue; }
    const res = await addTeamAward(current, award);
    if (!res.ok) { errors.push({ scope: 'teamAward', teamSetId: teamSet.id, error: res.error }); latestById.set(teamSet.id, current); }
    else latestById.set(teamSet.id, res.teamSet);
  }

  if (archiveWinningSets) {
    for (const [id, set] of latestById) {
      if (set.status === 'archived') continue;
      const res = await archiveTeamSet(set);
      if (!res.ok) errors.push({ scope: 'archive', teamSetId: id, error: res.error });
      else latestById.set(id, res.teamSet);
    }
  }

  return { errors, updatedTeamSets: [...latestById.values()] };
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
  const winners = winnerRowsFromTournament(tournament, standings);
  const teamAwards = buildTeamAwards(tournament, standings, teamSets, { now });
  const errors = [];

  const eventError = await pushWinnersToEvent(tournament, winners, event, onUpdateEvent);
  if (eventError) errors.push(eventError);

  const { errors: awardErrors, updatedTeamSets } = await writeTeamAwards(teamAwards, { archiveWinningSets });
  errors.push(...awardErrors);

  return { ok: errors.length === 0, winners, teamAwards, updatedTeamSets, errors };
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
