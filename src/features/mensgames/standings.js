// Round ranking → award points → tournament standings (docs/mensgames-spec.md
// §3.2, §4.3). The one rule that matters most here: `round.results` is
// persisted on lock and **never recomputed** afterwards. `computeStandings`
// reads locked results as-is; unlocked rounds only contribute a *live
// preview* when `includeUnlocked` is set, and that preview is never written
// back anywhere. Pure, no React, no Supabase; nothing here mutates its
// arguments.
import { getScoringType } from './scoring/index.js';
import { rankByValue, toFiniteNumber } from './scoring/shared.js';
import { DEFAULT_TIE_BREAK_ORDER } from './constants.js';

function isoOf(now) {
  return new Date(now).toISOString();
}

/**
 * Ranks a round using its own scoring plugin (falling back to `manual` for
 * an unknown/malformed `scoring.typeId`, same as `getScoringType`). Never
 * throws: a plugin that blows up on malformed match/entry data degrades to
 * "everyone tied at 0" rather than taking standings down with it.
 */
export function rankRound(round) {
  if (!round || typeof round !== 'object') return [];
  const type = getScoringType(round?.scoring?.typeId);
  const config = (round.scoring && typeof round.scoring.config === 'object' && round.scoring.config) || {};
  try {
    const ranking = type.rank(round, config);
    return Array.isArray(ranking) ? ranking : fallbackRanking(round);
  } catch {
    return fallbackRanking(round);
  }
}

function fallbackRanking(round) {
  const ids = Array.isArray(round?.entrantIds) ? round.entrantIds.filter((id) => typeof id === 'string') : [];
  return rankByValue(ids.map((id) => ({ entrantId: id, value: 0 })), { labelFn: () => '0' });
}

/**
 * Converts a round ranking into `{ [entrantId]: points }` per `round.award`
 * (§4.3: this decoupling is what lets a 300-point quiz and a best-of-3 both
 * be worth the same, and what lets Dom invent scoring without touching this
 * file). Three modes:
 *  - `placement`: `award.table[rank-1]` (tied ranks share the same slot).
 *  - `perWin`: `value * perWin + draws * perDraw`. Reads optional `wins`/
 *    `draws` fields a plugin may attach to its ranking entries (best-of,
 *    first-to, manual, goal-diff all do); falls back to treating `value`
 *    itself as the win count with 0 draws when a plugin doesn't expose them
 *    (e.g. simple-points, quiz-linked) — see report for why this is a
 *    judgment call, not something the spec pins down.
 *  - `raw`: `value * rawFactor`.
 * Unknown modes silently award 0 (same "degrade, don't crash" posture as
 * the scoring registry fallback).
 */
export function awardPoints(ranking, award) {
  const list = Array.isArray(ranking) ? ranking : [];
  const cfg = award && typeof award === 'object' ? award : {};
  const mode = cfg.mode || 'placement';
  const points = {};
  list.forEach((entry) => {
    if (!entry || typeof entry.entrantId !== 'string') return;
    let pts = 0;
    if (mode === 'placement') {
      const table = Array.isArray(cfg.table) && cfg.table.length ? cfg.table : [];
      const idx = (Number.isFinite(entry.rank) ? entry.rank : 0) - 1;
      pts = idx >= 0 && idx < table.length ? toFiniteNumber(table[idx], 0) : 0;
    } else if (mode === 'perWin') {
      const wins = Number.isFinite(entry.wins) ? entry.wins : toFiniteNumber(entry.value, 0);
      const draws = Number.isFinite(entry.draws) ? entry.draws : 0;
      pts = wins * toFiniteNumber(cfg.perWin, 0) + draws * toFiniteNumber(cfg.perDraw, 0);
    } else if (mode === 'raw') {
      pts = toFiniteNumber(entry.value, 0) * toFiniteNumber(cfg.rawFactor, 1);
    }
    points[entry.entrantId] = Math.round(pts * 100) / 100; // avoid float dust
  });
  return points;
}

/**
 * Freezes a round's ranking + points into `round.results` and marks it
 * `done`. Returns a **new** tournament object; never mutates the input.
 */
export function lockRound(tournament, roundId, { now = Date.now() } = {}) {
  const rounds = Array.isArray(tournament?.rounds) ? tournament.rounds : [];
  const idx = rounds.findIndex((r) => r?.id === roundId);
  if (idx === -1) return tournament;
  const round = rounds[idx];
  const ranking = rankRound(round);
  const points = awardPoints(ranking, round?.award);
  const newRounds = rounds.slice();
  newRounds[idx] = {
    ...round,
    status: 'done',
    results: { ranking, points, lockedAt: isoOf(now) },
  };
  return { ...tournament, rounds: newRounds, updatedAt: isoOf(now) };
}

/**
 * Explicit, confirmed-by-the-admin undo of `lockRound` — clears
 * `round.results` and puts the round back in `live` so it can be edited.
 */
export function unlockRound(tournament, roundId, { now = Date.now() } = {}) {
  const rounds = Array.isArray(tournament?.rounds) ? tournament.rounds : [];
  const idx = rounds.findIndex((r) => r?.id === roundId);
  if (idx === -1) return tournament;
  const round = rounds[idx];
  const newRounds = rounds.slice();
  newRounds[idx] = { ...round, status: 'live', results: null };
  return { ...tournament, rounds: newRounds, updatedAt: isoOf(now) };
}

/** Head-to-head win table, built fresh from `round.matches` for every round
 * that's contributing to this standings computation (re-resolving each
 * match via its own plugin — a pure re-derivation, not a mutation of
 * anything frozen). Used only as the second tie-break rung. */
function buildHeadToHead(rounds) {
  const table = {};
  const bump = (winnerId, loserId) => {
    if (!table[winnerId]) table[winnerId] = {};
    table[winnerId][loserId] = (table[winnerId][loserId] || 0) + 1;
  };
  rounds.forEach((round) => {
    if (!round || round.format !== 'matches' || !Array.isArray(round.matches)) return;
    const type = getScoringType(round?.scoring?.typeId);
    const config = (round.scoring && typeof round.scoring.config === 'object' && round.scoring.config) || {};
    round.matches.forEach((match) => {
      if (!match || typeof match !== 'object' || match.bId == null) return;
      let resolved;
      try {
        resolved = type.resolve(match, config);
      } catch {
        resolved = null;
      }
      if (!resolved || !resolved.complete || !resolved.winnerId || resolved.winnerId === 'draw') return;
      const loserId = resolved.winnerId === match.aId ? match.bId : match.aId;
      bump(resolved.winnerId, loserId);
    });
  });
  return table;
}

function compareStandingsRows(a, b, h2h, tieBreak) {
  if (a.points !== b.points) return b.points - a.points;
  for (const rule of tieBreak) {
    if (rule === 'roundWins') {
      if (a.roundWins !== b.roundWins) return b.roundWins - a.roundWins;
    } else if (rule === 'headToHead') {
      const aWins = h2h?.[a.entrantId]?.[b.entrantId] || 0;
      const bWins = h2h?.[b.entrantId]?.[a.entrantId] || 0;
      if (aWins !== bWins) return bWins - aWins;
    } else if (rule === 'jointPlacing') {
      return 0; // explicit stop: share the rank, don't invent a tiebreak
    }
  }
  return 0;
}

/**
 * Rolls up every round into one standings table. Locked (`status:'done'`
 * with a `results` object) rounds always contribute their frozen
 * ranking/points as-is. Unlocked rounds only contribute when
 * `includeUnlocked` is set — a live preview, recomputed on every call,
 * never persisted. Entrants who didn't play a given round simply don't
 * appear in that round's ranking, so they pick up 0 for it (§4.2).
 */
export function computeStandings(tournament, { includeUnlocked = false } = {}) {
  const entrants = Array.isArray(tournament?.entrants) ? tournament.entrants : [];
  const rounds = Array.isArray(tournament?.rounds) ? tournament.rounds : [];
  const tieBreak = Array.isArray(tournament?.settings?.tieBreak) && tournament.settings.tieBreak.length
    ? tournament.settings.tieBreak
    : DEFAULT_TIE_BREAK_ORDER;

  const totals = {};
  const ensure = (entrantId) => {
    if (!totals[entrantId]) {
      totals[entrantId] = { entrantId, points: 0, roundWins: 0, roundsPlayed: 0 };
    }
    return totals[entrantId];
  };
  entrants.forEach((e) => {
    if (e && typeof e.id === 'string') ensure(e.id);
  });

  const contributingRounds = [];

  rounds.forEach((round) => {
    if (!round || typeof round !== 'object') return;
    let ranking;
    let points;
    if (round.status === 'done' && round.results && typeof round.results === 'object') {
      ranking = Array.isArray(round.results.ranking) ? round.results.ranking : [];
      points = round.results.points && typeof round.results.points === 'object' ? round.results.points : {};
    } else if (includeUnlocked) {
      ranking = rankRound(round);
      points = awardPoints(ranking, round.award);
    } else {
      return;
    }
    contributingRounds.push(round);
    ranking.forEach((entry) => {
      if (!entry || typeof entry.entrantId !== 'string') return;
      const row = ensure(entry.entrantId);
      row.roundsPlayed += 1;
      if (entry.rank === 1) row.roundWins += 1;
    });
    Object.entries(points).forEach(([entrantId, pts]) => {
      ensure(entrantId).points += toFiniteNumber(pts, 0);
    });
  });

  const h2h = buildHeadToHead(contributingRounds);
  const rows = Object.values(totals);
  rows.sort((a, b) => compareStandingsRows(a, b, h2h, tieBreak));

  const result = [];
  let rank = 0;
  rows.forEach((row, i) => {
    if (i === 0 || compareStandingsRows(rows[i - 1], row, h2h, tieBreak) !== 0) rank = i + 1;
    result.push({ ...row, rank });
  });
  return result;
}
