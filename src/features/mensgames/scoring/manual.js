// manual — admin picks the winner by hand. Also the **hard-required
// fallback** for any unknown scoring type id (see scoring/index.js
// `getScoringType`), so it has to gracefully degrade for every round
// format, not just `matches`.
import { entrantIdsOf, matchesOf, rankByValue, resolveBye, toFiniteNumber } from './shared.js';

const id = 'manual';

const configFields = [];

const blankEntry = () => ({});

const entryFields = () => [];

const validate = () => null;

/**
 * Unlike every other plugin, `manual` doesn't derive a winner from stat
 * fields -- the admin sets `match.winnerId` directly (via a "pick winner"
 * control in the UI) and this just echoes/validates that pick into the
 * standard `{winnerId, complete, label}` shape.
 */
const resolve = (match) => {
  if (!match || typeof match !== 'object') return { winnerId: null, complete: false, label: '–' };
  if (match.bId == null) return resolveBye(match);
  if (match.winnerId === 'draw') return { winnerId: 'draw', complete: true, label: 'gelijkspel' };
  if (match.winnerId === match.aId || match.winnerId === match.bId) {
    return { winnerId: match.winnerId, complete: true, label: '—' };
  }
  return { winnerId: null, complete: false, label: '–' };
};

function rankFromMatches(round) {
  const ids = entrantIdsOf(round);
  const stats = {};
  ids.forEach((eid) => {
    stats[eid] = { wins: 0, draws: 0 };
  });
  matchesOf(round).forEach((match) => {
    if (!match || typeof match !== 'object') return;
    const resolved = resolve(match);
    if (!resolved.complete) return;
    if (resolved.winnerId === 'draw') {
      if (stats[match.aId]) stats[match.aId].draws += 1;
      if (match.bId != null && stats[match.bId]) stats[match.bId].draws += 1;
    } else if (resolved.winnerId && stats[resolved.winnerId]) {
      stats[resolved.winnerId].wins += 1;
    }
  });
  return rankByValue(
    ids.map((eid) => ({ entrantId: eid, value: stats[eid].wins, wins: stats[eid].wins, draws: stats[eid].draws })),
    { labelFn: (e) => `${e.wins}W${e.draws ? ` ${e.draws}D` : ''}` },
  );
}

function rankFromFreeform(round) {
  const ids = entrantIdsOf(round);
  const entries = (round.freeform && typeof round.freeform.entries === 'object' && round.freeform.entries) || {};
  return rankByValue(
    ids.map((eid) => ({ entrantId: eid, value: toFiniteNumber(entries[eid]?.value, 0) })),
    { labelFn: (e) => String(e.value) },
  );
}

/**
 * Format-agnostic on purpose: a round saved with a future scoring type
 * degrades to `manual` regardless of whether its format is `matches`,
 * `freeform` or `quiz`, so this must never throw for any of them.
 */
const rank = (round) => {
  if (!round || typeof round !== 'object') return [];
  if (matchesOf(round).length > 0) return rankFromMatches(round);
  if (round.freeform && typeof round.freeform === 'object') return rankFromFreeform(round);
  const ids = entrantIdsOf(round);
  return rankByValue(ids.map((eid) => ({ entrantId: eid, value: 0 })), { labelFn: () => '0' });
};

export default {
  id,
  label: 'Handmatig',
  icon: '✍️',
  appliesTo: ['matches', 'freeform', 'quiz'],
  configFields,
  blankEntry,
  entryFields,
  validate,
  resolve,
  rank,
};
