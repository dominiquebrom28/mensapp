// best-of — "best of X sets" (table tennis, pool, darts legs). §13 Q3: no
// draws -- a match only completes once one side reaches a strict majority
// of `config.sets`.
import { clamp, rankByValue, resolveBye, tallyMatchWins, toFiniteNumber } from './shared.js';

const id = 'best-of';

const configFields = [{ key: 'sets', label: 'Best of', type: 'number', default: 3, min: 1, max: 15 }];

const blankEntry = () => ({ sets: 0 });

const entryFields = (config) => [
  { key: 'sets', label: 'Sets', type: 'stepper', min: 0, max: toFiniteNumber(config?.sets, 3) },
];

const validate = (entry, config) => {
  const max = toFiniteNumber(config?.sets, 3);
  const n = toFiniteNumber(entry?.sets, NaN);
  if (!Number.isFinite(n)) return 'Ongeldig aantal sets';
  if (n < 0) return 'Sets kunnen niet negatief zijn';
  if (n > max) return 'Meer sets dan mogelijk';
  return null;
};

const resolve = (match, config) => {
  if (!match || typeof match !== 'object') return { winnerId: null, complete: false, label: '–' };
  if (match.bId == null) return resolveBye(match);
  const totalSets = Math.max(1, toFiniteNumber(config?.sets, 3));
  const threshold = Math.floor(totalSets / 2) + 1;
  const a = clamp(toFiniteNumber(match.entry?.a?.sets, 0), 0, totalSets);
  const b = clamp(toFiniteNumber(match.entry?.b?.sets, 0), 0, totalSets);
  const label = `${a}–${b}`;
  const aWon = a >= threshold;
  const bWon = b >= threshold;
  if (aWon && !bWon) return { winnerId: match.aId, complete: true, label };
  if (bWon && !aWon) return { winnerId: match.bId, complete: true, label };
  if (aWon && bWon) {
    // Malformed data (e.g. an even `config.sets` letting both sides reach
    // the threshold simultaneously). No draws for best-of, so resolve
    // deterministically by score, or leave incomplete if truly tied.
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
  label: 'Best of X',
  icon: '🏓',
  appliesTo: ['matches'],
  configFields,
  blankEntry,
  entryFields,
  validate,
  resolve,
  rank,
};
