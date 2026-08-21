// quiz-linked — consumes a frozen quiz-score snapshot (see ../quizRound.js)
// via `round.source.raw` (name → score) and `round.source.nameMap`
// (name → entrantId, resolved by matchQuizNames + the admin's manual
// picks for anything unmatched). This plugin never edits a match -- format
// 'quiz' rounds carry no `matches` at all -- so `resolve` is a no-op.
import { entrantIdsOf, rankByValue, toFiniteNumber } from './shared.js';

const id = 'quiz-linked';

const configFields = [];

const blankEntry = () => ({});

const entryFields = () => [];

const validate = () => null;

const resolve = () => ({ winnerId: null, complete: false, label: '—' });

const rank = (round) => {
  if (!round || typeof round !== 'object') return [];
  const ids = entrantIdsOf(round);
  const source = round.source && typeof round.source === 'object' ? round.source : {};
  const raw = source.raw && typeof source.raw === 'object' ? source.raw : {};
  const nameMap = source.nameMap && typeof source.nameMap === 'object' ? source.nameMap : {};

  const totals = {};
  ids.forEach((eid) => {
    totals[eid] = 0;
  });
  Object.keys(raw).forEach((name) => {
    const entrantId = nameMap[name];
    if (typeof entrantId === 'string' && Object.prototype.hasOwnProperty.call(totals, entrantId)) {
      totals[entrantId] += toFiniteNumber(raw[name], 0);
    }
    // Names with no (or a stale) nameMap entry contribute nothing --
    // "nothing is guessed" (§4.4). They stay visible via matchQuizNames'
    // `unmatched` list for the UI to resolve, never silently folded in here.
  });

  return rankByValue(
    ids.map((eid) => ({ entrantId: eid, value: totals[eid] })),
    { labelFn: (e) => `${e.value} pt` },
  );
};

export default {
  id,
  label: 'Gekoppelde quiz',
  icon: '🧠',
  appliesTo: ['quiz'],
  configFields,
  blankEntry,
  entryFields,
  validate,
  resolve,
  rank,
};
