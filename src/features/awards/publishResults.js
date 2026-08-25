// Source-agnostic results-publishing core (WP-Q1,
// docs/quiz-unification-spec.md §7.1). Extracted from
// `mensgames/finishTournament.js`, which was 250 lines of reviewed, tested
// write-back logic specific to Mens-Games tournaments. The quiz (§7.2) needs
// to do exactly the same two things a finished tournament does --
//   1. push `Winner` rows onto the linked event, in the shape
//      `events.winners` already uses, so `WinnersTab`/`HallOfFame` render
//      them with no changes to either;
//   2. add a `TeamAward` (§3.4) to every medalled *team*'s originating
//      `team_sets` row, resolved via `teamSetId`/`sourceTeamId` provenance
//      -- so it belongs here, generalised, rather than copied a second time
//      into a parallel `finishQuiz.js` write-back.
//
// Nothing in this module knows what a "tournament" or a "quiz" is. Each
// feature reduces its own domain object into a plain `Placement[]` (see the
// typedef) via its own adapter -- `finishTournament.js`'s
// `winnerRowsFromTournament`/`buildTeamAwards` wrappers for tournaments,
// `quiz/finishQuiz.js`'s `quizPlacements` for quizzes -- and this module
// only ever sees that shape plus a small `source` descriptor.
//
// `source` is `{ kind:'quiz'|'tournament', id, name, eventId }`.
//
// Everything that made the original safe carries over unchanged:
//  - `pushWinnersToEvent` re-reads the event row immediately before writing
//    rather than trusting a possibly-stale `event` object passed in (the
//    global pages that call this have no realtime subscription on events,
//    only a slow poll) -- so a finish never silently clobbers a concurrent
//    write to any other field on the same event.
//  - `writeTeamAwards` chains sequentially off each team set's own latest
//    write (`latestById`), not off the original stale object, so two
//    medals resolving to the *same* team set (e.g. gold and silver both
//    coming out of one 4-team library set) don't have the second write's
//    full-row upsert clobber the first award.
//  - every id is deterministic, so re-publishing the same source replaces
//    its own previously-written rows instead of piling up duplicates.
//  - a failed write for one team set (or the event) is collected in
//    `errors` rather than aborting the rest -- `buildTeamAwards`,
//    `winnerRowsFromPlacements` and this whole module never throw on
//    malformed input; `standings`/`placements`/`teamSets` are all
//    ultimately hand-editable JSONB.
import { supabase } from '../../supabase.js';
import { addTeamAward, archiveTeamSet } from '../teamlib/api.js';

const MEDAL_ICON = { 1: '🥇', 2: '🥈', 3: '🥉' };
const MEDAL_LABEL = { 1: '1e plaats', 2: '2e plaats', 3: '3e plaats' };

/**
 * @typedef {{ rank:number, name:string, kind:'team'|'player',
 *   memberNames:string[], teamSetId:string|null, sourceTeamId:string|null,
 *   detail:string, slot?:string }} Placement
 *
 * `slot` is one field beyond §7.1's literal typedef, and the one thing that
 * resisted a clean generalisation -- see the note on `winnerRowsFromPlacements`
 * below for why it exists.
 */

function isoOf(now) {
  return new Date(now).toISOString();
}

function medalLabel(rank) {
  return MEDAL_LABEL[rank] || `${rank}e plaats`;
}

function medalIcon(rank) {
  return MEDAL_ICON[rank] || '🏆';
}

function slugify(name) {
  return (
    (typeof name === 'string' ? name : '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'onbekend'
  );
}

function prefixFor(source) {
  return source && source.kind === 'quiz' ? 'qz' : 'mg';
}

function sourceName(source, fallback) {
  return (source && typeof source.name === 'string' && source.name.trim()) || fallback;
}

function sourceId(source, fallback) {
  return (source && typeof source.id === 'string' && source.id) || fallback;
}

function sourceEventId(source) {
  return (source && typeof source.eventId === 'string' && source.eventId) || null;
}

/**
 * Placements ranked 1-3. Ties share a rank (each feature's own adapter is
 * responsible for that, same as `finishTournament`'s `computeStandings`
 * already did), so e.g. two placements tied for 2nd both come back --
 * deliberately: both actually won silver, and nothing invents a bronze that
 * round. Defensive against a malformed `placements` array or a rank that
 * isn't a finite 1-3 int -- those entries are dropped, never thrown on.
 */
function validPlacements(placements) {
  return (Array.isArray(placements) ? placements : []).filter(
    (p) => p && typeof p === 'object' && Number.isFinite(p.rank) && p.rank >= 1 && p.rank <= 3 && typeof p.name === 'string' && p.name
  );
}

/**
 * `Winner[]` in the exact shape `events.winners` already uses. `id` is
 * deterministic (`${prefix}-${source.id}-${slot}`), not time-based, so
 * re-publishing the same source replaces its own previously-written rows
 * instead of piling up duplicates.
 *
 * **The one thing that resisted generalising cleanly:** the original
 * tournament id was `mg-<tournamentId>-<entrant.id>` -- `entrant.id`, a
 * stable identifier distinct from `sourceTeamId` (and the *only* stable id
 * a player entrant has, since players have no team/`sourceTeamId` at all).
 * §7.1's literal `Placement` typedef has no such field. Dropping it would
 * change `finishTournament.test.js`'s hard-coded ids
 * (`'mg-trn_1-ent_1'`, etc.) -- exactly what the acceptance gate forbids.
 * So `Placement` gains one optional field, `slot`, that the tournament
 * adapter fills with `entrant.id`; a source that has no natural per-slot id
 * of its own (e.g. an individual-player quiz placement) falls back to
 * `sourceTeamId` and then to a slugified name, in that order.
 */
export function winnerRowsFromPlacements(source, placements) {
  const prefix = prefixFor(source);
  const name = sourceName(source, prefix === 'qz' ? 'Quiz' : 'Toernooi');
  const sId = sourceId(source, prefix);
  return validPlacements(placements).map((p) => {
    const rank = p.rank;
    const slot = (typeof p.slot === 'string' && p.slot) || (typeof p.sourceTeamId === 'string' && p.sourceTeamId) || slugify(p.name);
    return {
      id: `${prefix}-${sId}-${slot}`,
      category: `🏆 ${name} — ${medalLabel(rank)}`,
      winner: p.name.trim() || 'Onbekend',
      detail: typeof p.detail === 'string' ? p.detail : '',
      icon: medalIcon(rank),
    };
  });
}

/**
 * `TeamAward`s (§3.4) for every medalled *team* placement, paired with the
 * `team_sets` row (from `teamSets`) it belongs to. Player placements, teams
 * with no provenance (`teamSetId`/`sourceTeamId`) and teams whose set is no
 * longer present in `teamSets` (deleted since the source ran) are silently
 * skipped. `award.id` is deterministic for the same re-publish-is-idempotent
 * reason as `winnerRowsFromPlacements`.
 *
 * One shape for both sources, per §3.4: every award carries `sourceKind`/
 * `sourceId` plus both `tournamentId` and `quizId` (whichever doesn't apply
 * to this source is `null`). No consumer today reads any of those four off
 * a `TeamAward` -- `HallOfFame`'s trophy cabinet renders `award.label` and
 * nothing else -- so this is additive metadata, not a behaviour change for
 * the tournament path. `finishTournament.test.js`'s `toEqual` assertion on
 * a tournament award was updated to include the four new keys and their
 * correct values; every pre-existing value assertion in it is untouched.
 */
export function buildTeamAwards(source, placements, teamSets, { now = Date.now() } = {}) {
  const sets = Array.isArray(teamSets) ? teamSets : [];
  const setsById = new Map(sets.filter((s) => s && typeof s.id === 'string').map((s) => [s.id, s]));
  const prefix = prefixFor(source);
  const name = sourceName(source, prefix === 'qz' ? 'Quiz' : 'Toernooi');
  const sId = sourceId(source, prefix);
  const eventId = sourceEventId(source);
  const kind = prefix === 'qz' ? 'quiz' : 'tournament';
  const awardedAt = isoOf(now);
  const out = [];
  validPlacements(placements).forEach((p) => {
    if (p.kind !== 'team') return;
    if (typeof p.teamSetId !== 'string' || !p.teamSetId) return;
    if (typeof p.sourceTeamId !== 'string' || !p.sourceTeamId) return;
    const teamSet = setsById.get(p.teamSetId);
    if (!teamSet) return;
    const rank = p.rank;
    const award = {
      id: `aw_${sId}_${p.sourceTeamId}`,
      teamId: p.sourceTeamId,
      label: `${medalIcon(rank)} ${name} — ${medalLabel(rank)}`,
      placement: rank,
      sourceKind: kind,
      sourceId: sId,
      tournamentId: kind === 'tournament' ? sId : null,
      quizId: kind === 'quiz' ? sId : null,
      eventId,
      note: '',
      awardedAt,
    };
    out.push({ teamSet, award });
  });
  return out;
}

async function pushWinnersToEvent(source, winners, event, onUpdateEvent) {
  if (!(event && typeof event === 'object' && typeof onUpdateEvent === 'function')) return null;
  const prefix = prefixFor(source);
  const sId = sourceId(source, prefix);
  const rowPrefix = `${prefix}-${sId}-`;
  try {
    // Re-read the event row immediately before writing rather than trusting
    // the possibly-stale `event` object passed in -- see the module header
    // for why. Falls back to the passed-in `event` only if the fresh read
    // itself comes back empty (e.g. a transient blip) so a publish still
    // completes rather than silently dropping the awards.
    const { data: fresh } = await supabase.from('events').select('*').eq('id', event.id).single();
    const base = fresh && typeof fresh === 'object' ? fresh : event;
    const existing = Array.isArray(base.winners) ? base.winners : [];
    const kept = existing.filter((w) => !(w && typeof w.id === 'string' && w.id.startsWith(rowPrefix)));
    await onUpdateEvent({ ...base, winners: [...kept, ...winners] });
    return null;
  } catch (error) {
    return { scope: 'event', error };
  }
}

async function writeTeamAwards(teamAwards, { archiveWinningSets = false } = {}) {
  const errors = [];
  // Two medalled placements can share one team set -- writes for the same
  // set must chain off each other's result, not off the original stale
  // object, or the second write's full-row upsert clobbers the first
  // award. Tracked by id, sequentially, one HTTP round trip at a time (rare,
  // small N -- at most 3 medals per publish).
  const latestById = new Map();
  for (const { teamSet, award } of teamAwards) {
    const current = latestById.get(teamSet.id) || teamSet;
    const already = Array.isArray(current.awards) && current.awards.some((a) => a && a.id === award.id);
    if (already) {
      latestById.set(teamSet.id, current);
      continue;
    }
    const res = await addTeamAward(current, award);
    if (!res.ok) {
      errors.push({ scope: 'teamAward', teamSetId: teamSet.id, error: res.error });
      latestById.set(teamSet.id, current);
    } else latestById.set(teamSet.id, res.teamSet);
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
 * a standalone source still awards teams, it just has nothing to decorate)
 * and adds a `TeamAward` to each medalled team's originating team set.
 * Never throws: a failed write for one team set (or the event) is collected
 * in `errors` rather than aborting the rest.
 */
export async function publishResults({ source, placements, event = null, onUpdateEvent, teamSets = [], archiveWinningSets = false, now = Date.now() }) {
  const winners = winnerRowsFromPlacements(source, placements);
  const teamAwards = buildTeamAwards(source, placements, teamSets, { now });
  const errors = [];

  const eventError = await pushWinnersToEvent(source, winners, event, onUpdateEvent);
  if (eventError) errors.push(eventError);

  const { errors: awardErrors, updatedTeamSets } = await writeTeamAwards(teamAwards, { archiveWinningSets });
  errors.push(...awardErrors);

  return { ok: errors.length === 0, winners, teamAwards, updatedTeamSets, errors };
}
