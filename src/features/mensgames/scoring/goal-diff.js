// goal-diff — a mini football-style league table for one round: 3 points
// for a win, 1 for a draw, ranked by points → goal difference → goals for.
// §13 Q3: draws allowed (0-0 is a fully valid, complete result).
import { entrantIdsOf, matchesOf, rankByComparator, resolveBye, toFiniteNumber } from './shared.js';
import { GOAL_DIFF_DRAW_POINTS, GOAL_DIFF_MAX_GOALS, GOAL_DIFF_WIN_POINTS } from '../constants.js';

const id = 'goal-diff';

const configFields = [];

const blankEntry = () => ({ goals: 0 });

const entryFields = () => [
  { key: 'goals', label: 'Doelpunten', type: 'stepper', min: 0, max: GOAL_DIFF_MAX_GOALS },
];

const validate = (entry) => {
  const n = toFiniteNumber(entry?.goals, NaN);
  if (!Number.isFinite(n)) return 'Ongeldig aantal doelpunten';
  if (n < 0) return 'Doelpunten kunnen niet negatief zijn';
  if (n > GOAL_DIFF_MAX_GOALS) return 'Te veel doelpunten';
  return null;
};

const resolve = (match) => {
  if (!match || typeof match !== 'object') return { winnerId: null, complete: false, label: '–' };
  if (match.bId == null) return resolveBye(match);
  const a = toFiniteNumber(match.entry?.a?.goals, 0);
  const b = toFiniteNumber(match.entry?.b?.goals, 0);
  const label = `${a}–${b}`;
  if (a === b) return { winnerId: 'draw', complete: true, label };
  return { winnerId: a > b ? match.aId : match.bId, complete: true, label };
};

function tally(round) {
  const ids = entrantIdsOf(round);
  const stats = {};
  ids.forEach((eid) => {
    stats[eid] = { points: 0, goalsFor: 0, goalsAgainst: 0, wins: 0, draws: 0, losses: 0, played: 0 };
  });
  matchesOf(round).forEach((match) => {
    if (!match || typeof match !== 'object' || match.bId == null) return;
    const { aId, bId } = match;
    const a = toFiniteNumber(match.entry?.a?.goals, 0);
    const b = toFiniteNumber(match.entry?.b?.goals, 0);
    if (stats[aId]) {
      stats[aId].goalsFor += a;
      stats[aId].goalsAgainst += b;
      stats[aId].played += 1;
    }
    if (stats[bId]) {
      stats[bId].goalsFor += b;
      stats[bId].goalsAgainst += a;
      stats[bId].played += 1;
    }
    if (a === b) {
      if (stats[aId]) {
        stats[aId].draws += 1;
        stats[aId].points += GOAL_DIFF_DRAW_POINTS;
      }
      if (stats[bId]) {
        stats[bId].draws += 1;
        stats[bId].points += GOAL_DIFF_DRAW_POINTS;
      }
    } else {
      const winnerId = a > b ? aId : bId;
      const loserId = a > b ? bId : aId;
      if (stats[winnerId]) {
        stats[winnerId].wins += 1;
        stats[winnerId].points += GOAL_DIFF_WIN_POINTS;
      }
      if (stats[loserId]) stats[loserId].losses += 1;
    }
  });
  return { ids, stats };
}

const rank = (round) => {
  if (!round || typeof round !== 'object') return [];
  const { ids, stats } = tally(round);
  const entries = ids.map((eid) => {
    const s = stats[eid];
    const diff = s.goalsFor - s.goalsAgainst;
    return { entrantId: eid, value: s.points, wins: s.wins, draws: s.draws, sortKey: [s.points, diff, s.goalsFor] };
  });
  return rankByComparator(entries, { labelFn: (e) => `${e.value} pt` });
};

export default {
  id,
  label: 'Doelsaldo',
  icon: '⚽',
  appliesTo: ['matches'],
  configFields,
  blankEntry,
  entryFields,
  validate,
  resolve,
  rank,
};
