// Internal helpers shared by the scoring plugins. Not part of the registry
// interface itself (§4.3 of docs/mensgames-spec.md) -- these just keep the
// seven plugin files from re-deriving the same defensive numeric parsing
// and ranking arithmetic. Pure, no React, no Date.now(), never mutates its
// arguments.

/** Coerce anything (string, null, undefined, NaN) to a finite number, or `fallback`. */
export function toFiniteNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  let v = value;
  if (typeof min === 'number' && v < min) v = min;
  if (typeof max === 'number' && v > max) v = max;
  return v;
}

/** `round.entrantIds`, defensively filtered to non-empty strings. */
export function entrantIdsOf(round) {
  const ids = round && Array.isArray(round.entrantIds) ? round.entrantIds : [];
  return ids.filter((id) => typeof id === 'string' && id);
}

/** `round.matches`, defensively defaulted to []. */
export function matchesOf(round) {
  return round && Array.isArray(round.matches) ? round.matches : [];
}

/** A bye (`match.bId == null`) always auto-resolves in the a-side's favour. */
export function resolveBye(match) {
  return { winnerId: match?.aId ?? null, complete: match?.aId != null, label: 'bye' };
}

function omit(obj, keys) {
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (!keys.includes(k)) out[k] = obj[k];
  });
  return out;
}

function buildRanked(sorted, keyFn, labelFn) {
  const out = [];
  let prevKey = null;
  let prevRank = 0;
  sorted.forEach((entry, i) => {
    const key = keyFn(entry);
    const rank = prevKey !== null && key === prevKey ? prevRank : i + 1;
    const rest = omit(entry, ['_i', 'sortKey', 'entrantId', 'value']);
    out.push({
      entrantId: entry.entrantId,
      rank,
      value: entry.value,
      label: labelFn ? labelFn(entry) : String(entry.value),
      ...rest,
    });
    prevKey = key;
    prevRank = rank;
  });
  return out;
}

/**
 * Standard competition ranking ("1224") over a single numeric `value` per
 * entry. Ties share a rank and the next distinct value skips accordingly.
 * Equal values keep their original (input) order -- deterministic given a
 * given input order, no randomness.
 */
export function rankByValue(entries, { ascending = false, labelFn } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const withIndex = list.map((e, i) => ({ ...e, _i: i }));
  withIndex.sort((a, b) => {
    if (a.value !== b.value) return ascending ? a.value - b.value : b.value - a.value;
    return a._i - b._i;
  });
  return buildRanked(withIndex, (e) => e.value, labelFn);
}

/**
 * Same "1224" ranking, but compares a multi-key `sortKey` tuple (each key
 * higher-is-better) instead of a single `value` -- used by goal-diff for
 * points → goal difference → goals for.
 */
export function rankByComparator(entries, { labelFn } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const withIndex = list.map((e, i) => ({ ...e, _i: i }));
  withIndex.sort((x, y) => {
    const kx = x.sortKey || [x.value];
    const ky = y.sortKey || [y.value];
    const len = Math.max(kx.length, ky.length);
    for (let i = 0; i < len; i++) {
      const a = kx[i] ?? 0;
      const b = ky[i] ?? 0;
      if (a !== b) return b - a;
    }
    return x._i - y._i;
  });
  return buildRanked(withIndex, (e) => JSON.stringify(e.sortKey || [e.value]), labelFn);
}

/**
 * Tallies wins/draws/losses/played per entrant in `round.entrantIds` from
 * `round.matches`, using `resolveFn` (a scoring plugin's own `resolve`) to
 * decide each match's outcome. Byes and unresolved/incomplete matches don't
 * count. Ignores matches referencing an id outside `round.entrantIds`
 * (defensive against hand-edited JSONB) rather than throwing.
 */
export function tallyMatchWins(round, resolveFn, config) {
  const ids = entrantIdsOf(round);
  const stats = {};
  ids.forEach((id) => {
    stats[id] = { wins: 0, draws: 0, losses: 0, played: 0 };
  });
  matchesOf(round).forEach((match) => {
    if (!match || typeof match !== 'object') return;
    const { aId, bId } = match;
    if (bId == null) return; // byes don't feed win tallies
    let resolved;
    try {
      resolved = resolveFn(match, config);
    } catch {
      resolved = null;
    }
    if (!resolved || !resolved.complete) return;
    if (stats[aId]) stats[aId].played += 1;
    if (stats[bId]) stats[bId].played += 1;
    if (resolved.winnerId === 'draw') {
      if (stats[aId]) stats[aId].draws += 1;
      if (stats[bId]) stats[bId].draws += 1;
    } else if (resolved.winnerId && stats[resolved.winnerId]) {
      stats[resolved.winnerId].wins += 1;
      const loserId = resolved.winnerId === aId ? bId : aId;
      if (stats[loserId]) stats[loserId].losses += 1;
    }
  });
  return { ids, stats };
}
