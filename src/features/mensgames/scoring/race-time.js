// race-time — lower is better (a timed race/heat). Supports two shapes:
// head-to-head `matches` (two entrants race, faster one wins the match,
// round ranks on match wins like best-of), and `freeform` (every entrant
// submits their own time against the clock, round ranks on raw time).
// §13 Q3: not covered by that question explicitly; a dead-heat tie is
// treated as a draw (real timing ties happen), matching simple-points.
import { entrantIdsOf, rankByValue, resolveBye, tallyMatchWins } from './shared.js';
import { RACE_TIME_MAX_SECONDS } from '../constants.js';

const id = 'race-time';

const configFields = [];

const blankEntry = () => ({ seconds: null });

const entryFields = () => [
  { key: 'seconds', label: 'Tijd (sec)', type: 'number', min: 0, max: RACE_TIME_MAX_SECONDS },
];

function readSeconds(entry) {
  const v = entry?.seconds;
  if (v === null || v === undefined || v === '') return null; // not run yet
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const validate = (entry) => {
  const v = entry?.seconds;
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 'Ongeldige tijd';
  if (n < 0) return 'Tijd kan niet negatief zijn';
  if (n > RACE_TIME_MAX_SECONDS) return 'Tijd te lang';
  return null;
};

const resolve = (match) => {
  if (!match || typeof match !== 'object') return { winnerId: null, complete: false, label: '–' };
  if (match.bId == null) return resolveBye(match);
  const a = readSeconds(match.entry?.a);
  const b = readSeconds(match.entry?.b);
  if (a === null || b === null) return { winnerId: null, complete: false, label: '–' };
  const label = `${a}s–${b}s`;
  if (a === b) return { winnerId: 'draw', complete: true, label };
  return { winnerId: a < b ? match.aId : match.bId, complete: true, label };
};

function rankFromFreeform(round) {
  const ids = entrantIdsOf(round);
  const entries = (round.freeform && typeof round.freeform.entries === 'object' && round.freeform.entries) || {};
  return rankByValue(
    ids.map((eid) => {
      const raw = entries[eid]?.value;
      const n = typeof raw === 'number' ? raw : Number(raw);
      return { entrantId: eid, value: Number.isFinite(n) ? n : Infinity };
    }),
    { ascending: true, labelFn: (e) => (e.value === Infinity ? '–' : `${e.value}s`) },
  );
}

const rank = (round, config) => {
  if (!round || typeof round !== 'object') return [];
  if (round.format === 'freeform') return rankFromFreeform(round);
  const { ids, stats } = tallyMatchWins(round, resolve, config);
  return rankByValue(
    ids.map((eid) => ({ entrantId: eid, value: stats[eid].wins })),
    { labelFn: (e) => `${e.value}W` },
  );
};

export default {
  id,
  label: 'Tijdrace',
  icon: '⏱️',
  appliesTo: ['matches', 'freeform'],
  configFields,
  blankEntry,
  entryFields,
  validate,
  resolve,
  rank,
};
