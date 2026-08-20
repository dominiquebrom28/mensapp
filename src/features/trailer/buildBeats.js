// Pure. No React, no Date.now(), no DOM. Deterministic for a given
// (input, opts) pair -- see docs/trailer-technical-spec.md §5.1/§5.5.
//
// `buildBeats(input, opts)` turns a `TrailerInput` view model (already
// built + redacted by the App.jsx adapter, §2.3) into an ordered `Beat[]`.
// Each beat kind has a build-time guard: a beat is only ever emitted when
// its data is present and non-empty. There are deliberately no runtime
// `if (!data) return null` branches in beat *components* (package C) --
// a mounted beat is guaranteed to have what it needs, by construction here.
//
// Beat ordering (title -> meta -> countdown -> stop* -> secret -> legacy ->
// roster -> outro) is this file's own synthesis of the creative shot list
// (§3) onto the technical spec's BEAT_KINDS enum (§5.1), extended with
// `LEGACY` -- see the typedef below for the `champion` shape it reads.
import { isSafeImageUrl } from './safeUrl.js';
import {
  BEAT_KINDS,
  DURATIONS,
  MAX_STOP_BEATS_DEFAULT,
  MAX_TOTAL_MS,
  ROSTER_BASE_MS,
  ROSTER_MAX_MS,
  ROSTER_MAX_NAMED,
  ROSTER_PER_PERSON_MS,
} from './constants.js';

// Re-exported so `import { BEAT_KINDS } from './buildBeats.js'` (the shape
// shown inline next to the Beat typedef in the technical spec, §5.1) also
// works, without a second source of truth -- constants.js owns the values.
export { BEAT_KINDS } from './constants.js';

/**
 * @typedef {Object} Beat
 * @property {string}  id
 * @property {string}  kind
 * @property {number}  durationMs
 * @property {Object}  data
 * @property {string}  [media]
 * @property {boolean} [flash]
 */

/**
 * "Last year's champion" continuity nod (creative spec §3 Beat 5). Not
 * part of the technical spec's original `TrailerInput` (§2.3) -- extending
 * it here rather than inventing the data out of thin air, because the
 * ADAPTER's job of actually populating it is a real problem this pass
 * doesn't solve: `champion` comes from a *previous* event's Hall-of-Fame/
 * quiz-board results, not the current `evt` row, so `toTrailerInput` will
 * need the full events list, not just `evt`, to compute it. That wiring is
 * package E's problem (App.jsx is untouched in this pass) -- this file only
 * defines the shape and the conditional-emission rule below.
 * @typedef {Object} Champion
 * @property {string} name
 * @property {string} photoUrl
 * @property {number} avatarIndex
 * @property {string} title    what they won, e.g. "Overall Champion", "Quiz Legend"
 * @property {string} detail   short line, e.g. "142 pts · Mensday 2026"
 */

/**
 * @param {import('./types').TrailerInput & {champion?: Champion}} input
 * @param {{reducedMotion?:boolean, saveData?:boolean, maxStopBeats?:number, nowMs?:number}} [opts]
 * @returns {Beat[]}
 */
export function buildBeats(input, opts = {}) {
  const reducedMotion = !!opts.reducedMotion;
  const saveData = !!opts.saveData;
  const maxStopBeats = Number.isFinite(opts.maxStopBeats) && opts.maxStopBeats > 0
    ? Math.floor(opts.maxStopBeats)
    : MAX_STOP_BEATS_DEFAULT;
  // `nowMs` is the only clock input this pure function is allowed to see
  // (spec §5.1: "no Date.now()"). When the caller doesn't supply one, we
  // treat "now" as unknowable rather than reaching for a real clock --
  // which means a startsAtIso can never look "in the future" by default,
  // so COUNTDOWN is safely dropped unless the caller opts in with a real
  // `nowMs`. Tests must pass `nowMs` explicitly to exercise COUNTDOWN.
  const nowMs = typeof opts.nowMs === 'number' && Number.isFinite(opts.nowMs)
    ? opts.nowMs
    : Number.POSITIVE_INFINITY;

  const stops = Array.isArray(input?.stops) ? input.stops : [];
  const dateLabel = typeof input?.dateLabel === 'string' ? input.dateLabel : '';
  const name = typeof input?.name === 'string' ? input.name : '';
  const location = typeof input?.location === 'string' ? input.location : '';
  const theme = typeof input?.theme === 'string' ? input.theme : '';
  const type = input?.type === 'weekend' ? 'weekend' : 'day';
  const going = Array.isArray(input?.going) ? input.going : [];
  const goingCount = Number.isFinite(input?.goingCount) ? input.goingCount : 0;

  const heroImage = pickHeroImage(stops);

  const beats = [];

  // TITLE -- always emitted. NOT marked `flash`: a letter-by-letter type-on
  // is not a vestibular hazard (strobe/rapid-cut/hard-zoom, per §7.1) and
  // dropping it under reduced motion would remove the opening wordmark
  // entirely -- the spec is explicit that "reduced motion removes movement,
  // not information" (§7). No beat in the current shot list is flagged
  // `flash` today; the designer marks one if/when the finished storyboard
  // actually has a strobe/rapid-cut/hard-zoom moment (§9's constraint list).
  beats.push({
    id: 'title',
    kind: BEAT_KINDS.TITLE,
    durationMs: DURATIONS.TITLE,
    data: { name, dateLabel },
  });

  // META -- only when there's a date line to show (§5.5). When dropped,
  // TITLE's own `dateLabel` field (above) is what a beat component absorbs
  // it into -- no separate handling needed here.
  if (dateLabel) {
    const metaBeat = {
      id: 'meta',
      kind: BEAT_KINDS.META,
      durationMs: DURATIONS.META,
      data: { dateLabel, location, theme, type },
    };
    if (heroImage) metaBeat.media = heroImage;
    beats.push(metaBeat);
  }

  // COUNTDOWN -- startsAtIso must parse AND be strictly in the future
  // relative to `nowMs` (§5.5).
  const startsAtMs = parseIsoMs(input?.startsAtIso);
  if (startsAtMs !== null && startsAtMs > nowMs) {
    beats.push({
      id: 'countdown',
      kind: BEAT_KINDS.COUNTDOWN,
      durationMs: DURATIONS.COUNTDOWN,
      data: {
        startsAtIso: input.startsAtIso,
        daysToGo: Math.max(0, Math.ceil((startsAtMs - nowMs) / 86400000)),
      },
    });
  }

  // STOP -- eligible: `!secret && activity` non-empty (§5.5). This filter,
  // and everything below it, reads ONLY `icon/activity/location/note/image`
  // off stops that are NOT secret. `!s.secret` (a coercing check), not
  // `s.secret !== true` -- the adapter is supposed to write a real boolean,
  // but `schedule` is hand-editable JSONB and no adapter enforcing that
  // exists yet (App.jsx is untouched in this pass), so a truthy-but-not-
  // `=== true` value (`1`, `"true"`, a boxed `Boolean`) must still count as
  // secret here. Getting this wrong previously let such a stop slip past
  // BOTH this filter and `pickHeroImage`'s guard below while still being
  // counted in `secretCount` -- the worst combination: the trailer claims a
  // secret exists and then shows it. Fixed; regression-guarded in
  // secretLeak.hostile.test.js. A secret stop's content -- even given a
  // hostile/un-redacted input -- is never touched by this branch. See
  // buildBeats.test.js's secret-leak invariant tests too.
  const eligible = stops.filter((s) => s && !s.secret && !!s.activity);
  if (eligible.length === 1) {
    const s = eligible[0];
    const beat = {
      id: s.key || 'stop-0',
      kind: BEAT_KINDS.STOP,
      // "One schedule stop only" degrade: the full montage budget goes to
      // this one stop instead of a rushed 2.6s beat (creative §7).
      durationMs: DURATIONS.STOP_SPOTLIGHT,
      data: stopBeatData(s),
    };
    if (!saveData && isSafeImageUrl(s.image)) beat.media = s.image;
    beats.push(beat);
  } else if (eligible.length > 1) {
    // Creative §3's "+N more stops on the day" closing chip is folded into
    // the last surviving STOP beat's data rather than invented as an
    // eighth BEAT_KIND -- the technical spec's enum (§5.1) is treated as
    // exhaustive for this pass. Computed once, globally, by
    // `reconcileMoreCount` near the end of this function -- not here --
    // because the total-duration trim below can remove MORE stop beats
    // after this montage-cap selection runs, and a count set here would go
    // stale the moment that happens.
    const selected = selectStopBeats(eligible, maxStopBeats);
    selected.forEach((s, i) => {
      const beat = {
        id: s.key || `stop-${i}`,
        kind: BEAT_KINDS.STOP,
        durationMs: DURATIONS.STOP,
        data: stopBeatData(s),
      };
      if (!saveData && isSafeImageUrl(s.image)) beat.media = s.image;
      beats.push(beat);
    });
  }

  // SECRET -- exactly one beat for the whole event, never one per secret
  // stop (§5.5). Reads ONLY `time`/`day`/`dayLabel` off secret stops --
  // never `activity`/`note`/`location`/`image`, which is the invariant the
  // deep-scan test in buildBeats.test.js exists to prove.
  const secretStops = stops.filter((s) => s && !!s.secret);
  const secretCount = Number.isFinite(input?.secretCount) ? input.secretCount : secretStops.length;
  if (secretCount > 0) {
    const times = secretStops.map((s) => (typeof s?.time === 'string' ? s.time : '')).filter(Boolean);
    const dayLabels = [];
    const seenDayLabel = new Set();
    for (const s of secretStops) {
      const dl = typeof s?.dayLabel === 'string' ? s.dayLabel : '';
      if (dl && !seenDayLabel.has(dl)) {
        seenDayLabel.add(dl);
        dayLabels.push(dl);
      }
    }
    beats.push({
      id: 'secret',
      kind: BEAT_KINDS.SECRET,
      durationMs: DURATIONS.SECRET,
      data: { count: secretCount, times, dayLabels },
      // No `media` key, ever -- see the leak-invariant tests. Not merely
      // "we chose not to preload it": this beat never reads `.image` off a
      // secret stop in the first place, so there is nothing to leak.
    });
  }

  // LEGACY -- only when the adapter supplied a champion (§ typedef above).
  // Same conditional-emission pattern as ROSTER/COUNTDOWN: present -> one
  // beat, absent -> dropped entirely, never a placeholder/empty state.
  const champion = input?.champion;
  if (champion && typeof champion === 'object') {
    beats.push({
      id: 'legacy',
      kind: BEAT_KINDS.LEGACY,
      durationMs: DURATIONS.LEGACY,
      data: {
        name: typeof champion.name === 'string' ? champion.name : '',
        photoUrl: isSafeImageUrl(champion.photoUrl) ? champion.photoUrl : '',
        avatarIndex: Number.isFinite(champion.avatarIndex) ? champion.avatarIndex : 0,
        title: typeof champion.title === 'string' ? champion.title : '',
        detail: typeof champion.detail === 'string' ? champion.detail : '',
      },
    });
  }

  // ROSTER -- only when there are enough confirmed "going" to be worth
  // naming (§5.5: `goingCount >= 3`, else dropped outright).
  if (goingCount >= 3) {
    const named = going.slice(0, ROSTER_MAX_NAMED).map((g) => ({
      name: typeof g?.name === 'string' ? g.name : '',
      photoUrl: isSafeImageUrl(g?.photoUrl) ? g.photoUrl : '',
      avatarIndex: Number.isFinite(g?.avatarIndex) ? g.avatarIndex : 0,
    }));
    const moreCount = Math.max(0, goingCount - named.length);
    beats.push({
      id: 'roster',
      kind: BEAT_KINDS.ROSTER,
      durationMs: Math.min(
        ROSTER_MAX_MS,
        ROSTER_BASE_MS + ROSTER_PER_PERSON_MS * Math.min(goingCount, 10),
      ),
      data: { going: named, goingCount, ...(moreCount > 0 ? { moreCount } : {}) },
    });
  }

  // OUTRO -- always emitted, bookends TITLE/META with the same hero image.
  const outroBeat = {
    id: 'outro',
    kind: BEAT_KINDS.OUTRO,
    durationMs: DURATIONS.OUTRO,
    data: { name, dateLabel, location, theme },
  };
  if (heroImage) outroBeat.media = heroImage;
  beats.push(outroBeat);

  // Total-duration invariant (technical spec §5.3 / creative spec §7:
  // "hard cap ~60-65s"). This is enforced here, on the fully assembled beat
  // list, for every input -- not asserted once in a test and hoped for.
  // If the timeline would run over MAX_TOTAL_MS, drop STOP beats -- the
  // only genuinely repeatable content -- from the END of the montage
  // backwards until it fits. TITLE/META/COUNTDOWN/SECRET/LEGACY/ROSTER/
  // OUTRO are never sacrificed to make room. If removing every stop beat
  // still isn't enough (shouldn't be reachable given the per-kind duration
  // budget, but this must never loop forever or throw), stop and return
  // what's left rather than guessing further.
  let totalMs = beats.reduce((sum, b) => sum + b.durationMs, 0);
  while (totalMs > MAX_TOTAL_MS) {
    const lastStopIdx = lastIndexOfKind(beats, BEAT_KINDS.STOP);
    if (lastStopIdx === -1) break;
    totalMs -= beats[lastStopIdx].durationMs;
    beats.splice(lastStopIdx, 1);
  }

  // The "+N more stops" chip must stay accurate after ANY trimming --
  // montage-cap selection (selectStopBeats) and the total-duration trim
  // above can each remove stop beats, so it's computed once, here, as the
  // single source of truth, rather than duplicated (and going stale) in
  // more than one place.
  reconcileMoreCount(beats, eligible.length);

  // Reduced motion (§7): drop every beat marked `flash`. Content/order is
  // otherwise unchanged -- reduced motion removes movement, not information.
  // No beat sets `flash` today (see the TITLE comment above), so this is
  // currently a no-op in production; the mechanism itself is covered
  // directly in buildBeats.test.js via a synthetic beat, not by relying on
  // real output -- the drop rule shouldn't depend on any *particular* beat
  // existing to prove itself.
  let result = reducedMotion ? dropFlashBeatsForReducedMotion(beats) : beats;

  // Save-data / slow connection (§6.2): every beat loses `media`. The
  // trailer becomes a fully typographic cut, not a broken one.
  if (saveData) {
    result = result.map((b) => {
      if (!('media' in b)) return b;
      const { media: _media, ...rest } = b; // `_media` discarded on purpose -- destructuring-to-omit
      return rest;
    });
  }

  return result;
}

// Reduced-motion drop rule (§7 point 1): "the designer must mark any
// rapid-cut, strobe or hard-zoom beat with this flag" -- `flash` is a
// vestibular-safety marker, not a decoration. Exported and independently
// testable with a synthetic beat so its coverage never depends on whether
// any *real* beat currently happens to carry the flag.
export function dropFlashBeatsForReducedMotion(beats) {
  return beats.filter((b) => !b.flash);
}

function stopBeatData(s) {
  return {
    icon: typeof s.icon === 'string' ? s.icon : '',
    activity: s.activity,
    location: typeof s.location === 'string' ? s.location : '',
    note: typeof s.note === 'string' ? s.note : '',
    day: s.day ?? 0,
    dayLabel: typeof s.dayLabel === 'string' ? s.dayLabel : '',
    time: typeof s.time === 'string' ? s.time : '',
  };
}

// First safe, non-secret stop image in the given (already day/time sorted)
// order. Used as the shared hero image for META/OUTRO (creative §3 beats
// 2 & 7 "bookend" on the same still).
function pickHeroImage(stops) {
  for (const s of stops) {
    if (s && !s.secret && isSafeImageUrl(s.image)) return s.image;
  }
  return '';
}

function parseIsoMs(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// Deterministic ceiling selector (technical spec §5.5): first stop of each
// day (in day order), then fill remaining slots with the earliest
// unselected stops (in the caller's day/time order), then re-sort the final
// set by (day, time). Deterministic input -> deterministic output, so
// replays are identical. Returns just the selected stops -- the "+N more"
// count is computed globally by `reconcileMoreCount`, once, after the
// total-duration trim has also had its say (see buildBeats()).
function selectStopBeats(eligibleSorted, maxStopBeats) {
  if (eligibleSorted.length <= maxStopBeats) {
    return eligibleSorted.slice();
  }

  const seenDays = new Set();
  const firstOfDay = [];
  for (const s of eligibleSorted) {
    const day = s.day ?? 0;
    if (!seenDays.has(day)) {
      seenDays.add(day);
      firstOfDay.push(s);
    }
  }

  const selectedKeys = new Set(firstOfDay.map((s) => s.key));
  const selected = firstOfDay.slice();
  for (const s of eligibleSorted) {
    if (selected.length >= maxStopBeats) break;
    if (!selectedKeys.has(s.key)) {
      selected.push(s);
      selectedKeys.add(s.key);
    }
  }

  const capped = selected.slice(0, maxStopBeats);
  capped.sort((a, b) => (a.day ?? 0) - (b.day ?? 0)
    || String(a.time || '').localeCompare(String(b.time || '')));

  return capped;
}

// Index of the last beat of `kind` in `beats`, or -1. Used by the
// total-duration trim to repeatedly sacrifice the montage's newest-added
// (i.e. last) STOP beat first.
function lastIndexOfKind(beats, kind) {
  for (let i = beats.length - 1; i >= 0; i--) {
    if (beats[i].kind === kind) return i;
  }
  return -1;
}

// Recomputes the "+N more stops" indicator from scratch: `eligibleTotal`
// (every stop that qualified for a STOP beat in the first place) minus
// however many STOP beats actually survive in `beats` right now. Clears any
// stale `moreCount` first, so trimming can never leave two beats claiming
// it, or a beat claiming a number that's since gone wrong.
function reconcileMoreCount(beats, eligibleTotal) {
  const stopIndices = [];
  beats.forEach((b, i) => { if (b.kind === BEAT_KINDS.STOP) stopIndices.push(i); });

  stopIndices.forEach((i) => {
    if ('moreCount' in beats[i].data) {
      const { moreCount: _moreCount, ...rest } = beats[i].data; // discarded on purpose
      beats[i] = { ...beats[i], data: rest };
    }
  });

  if (stopIndices.length === 0) return;

  const moreCount = Math.max(0, eligibleTotal - stopIndices.length);
  if (moreCount > 0) {
    const lastIdx = stopIndices[stopIndices.length - 1];
    beats[lastIdx] = { ...beats[lastIdx], data: { ...beats[lastIdx].data, moreCount } };
  }
}
