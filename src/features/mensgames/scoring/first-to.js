// first-to — "first to N points/legs" (squash, pool race, darts). §13 Q3:
// no draws, same reasoning as best-of.
import { clamp, rankByValue, resolveBye, tallyMatchWins, toFiniteNumber } from './shared.js';

const id = 'first-to';

const configFields = [{ key: 'target', label: 'Eerst tot', type: 'number', default: 21, min: 1, max: 999 }];

const blankEntry = () => ({ score: 0 });

const entryFields = (config) => [
  { key: 'score', label: 'Score', type: 'stepper', min: 0, max: toFiniteNumber(config?.target, 21) },
];

const validate = (entry, config) => {
  const max = toFiniteNumber(config?.target, 21);
  const n = toFiniteNumber(entry?.score, NaN);
  if (!Number.isFinite(n)) return 'Ongeldige score';
  if (n < 0) return 'Score kan niet negatief zijn';
  if (n > max) return 'Meer punten dan mogelijk';
  return null;
};

const resolve = (match, config) => {
  if (!match || typeof match !== 'object') return { winnerId: null, complete: false, label: '–' };
  if (match.bId == null) return resolveBye(match);
  const target = Math.max(1, toFiniteNumber(config?.target, 21));
  const a = clamp(toFiniteNumber(match.entry?.a?.score, 0), 0, target);
  const b = clamp(toFiniteNumber(match.entry?.b?.score, 0), 0, target);
  const label = `${a}–${b}`;
  const aWon = a >= target;
  const bWon = b >= target;
  if (aWon && !bWon) return { winnerId: match.aId, complete: true, label };
  if (bWon && !aWon) return { winnerId: match.bId, complete: true, label };
  if (aWon && bWon) {
    if (a === b) return { winnerId: null, complete: false, label };
    return { winnerId: a > b ? match.aId : match.bId, complete: true, label };
  }
  return { winnerId: null, complete: false, label };
};

const rank = (round, config) => {
  const { ids, stats } = tallyMatchWins(round, resolve, config);
  return rankByValue(
    ids.map((eid) => ({ entrantId: eid, value: stats[eid].wins })),
    { labelFn: (e) => `${e.value}W` },
  );
};

export default {
  id,
  label: 'Eerst tot',
  icon: '🎯',
  appliesTo: ['matches'],
  configFields,
  blankEntry,
  entryFields,
  validate,
  resolve,
  rank,
};
