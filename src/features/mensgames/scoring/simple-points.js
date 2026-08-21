// simple-points — each side just racks up a raw point total per match
// (darts leg score, beer pong cups, whatever); highest total across the
// round wins. §13 Q3: draws are allowed here (equal totals).
import { entrantIdsOf, matchesOf, rankByValue, resolveBye, toFiniteNumber } from './shared.js';
import { SIMPLE_POINTS_MAX } from '../constants.js';

const id = 'simple-points';

const configFields = [];

const blankEntry = () => ({ points: 0 });

const entryFields = () => [{ key: 'points', label: 'Punten', type: 'stepper', min: 0, max: SIMPLE_POINTS_MAX }];

const validate = (entry) => {
  const n = toFiniteNumber(entry?.points, NaN);
  if (!Number.isFinite(n)) return 'Ongeldig puntental';
  if (n < 0) return 'Punten kunnen niet negatief zijn';
  if (n > SIMPLE_POINTS_MAX) return 'Te veel punten';
  return null;
};

const resolve = (match) => {
  if (!match || typeof match !== 'object') return { winnerId: null, complete: false, label: '–' };
  if (match.bId == null) return resolveBye(match);
  const a = toFiniteNumber(match.entry?.a?.points, 0);
  const b = toFiniteNumber(match.entry?.b?.points, 0);
  const label = `${a}–${b}`;
  if (a === b) return { winnerId: 'draw', complete: true, label };
  return { winnerId: a > b ? match.aId : match.bId, complete: true, label };
};

function sumPoints(round) {
  const ids = entrantIdsOf(round);
  const totals = {};
  ids.forEach((eid) => {
    totals[eid] = 0;
  });
  matchesOf(round).forEach((match) => {
    if (!match || typeof match !== 'object') return;
    const a = toFiniteNumber(match.entry?.a?.points, 0);
    const b = toFiniteNumber(match.entry?.b?.points, 0);
    if (Object.prototype.hasOwnProperty.call(totals, match.aId)) totals[match.aId] += a;
    if (match.bId != null && Object.prototype.hasOwnProperty.call(totals, match.bId)) totals[match.bId] += b;
  });
  return { ids, totals };
}

const rank = (round) => {
  if (!round || typeof round !== 'object') return [];
  const { ids, totals } = sumPoints(round);
  return rankByValue(
    ids.map((eid) => ({ entrantId: eid, value: totals[eid] })),
    { labelFn: (e) => `${e.value} ptn` },
  );
};

export default {
  id,
  label: 'Simpele punten',
  icon: '🔢',
  appliesTo: ['matches'],
  configFields,
  blankEntry,
  entryFields,
  validate,
  resolve,
  rank,
};
