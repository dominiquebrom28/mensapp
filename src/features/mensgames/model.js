// Pure builders + entrant/match generators for the tournament data model
// (docs/mensgames-spec.md §3.2). No React, no Supabase, no DOM. Every blank*
// builder takes an injectable `now` (default `Date.now()`, evaluated once
// per call as a default parameter — real callers get today's convenient
// call-site convention, tests get a fixed, reproducible id/timestamp) so
// nothing here silently reaches for the wall clock mid-computation. All
// generator functions are defensive against malformed input arrays and
// never mutate what's passed in.
import { getScoringType } from './scoring/index.js';
import {
  ATTENDING_STATUSES,
  DEFAULT_PER_DRAW,
  DEFAULT_PER_WIN,
  DEFAULT_PLACEMENT_TABLE,
  DEFAULT_RAW_FACTOR,
  DEFAULT_TIE_BREAK_ORDER,
  ROUND_TIMER_DEFAULT_SECONDS,
} from './constants.js';

function isoOf(now) {
  return new Date(now).toISOString();
}

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entrant';
}

function defaultConfigFor(scoringType) {
  const fields = Array.isArray(scoringType?.configFields) ? scoringType.configFields : [];
  const config = {};
  fields.forEach((f) => {
    if (f && typeof f.key === 'string') config[f.key] = f.default;
  });
  return config;
}

/** A brand-new, empty tournament (§3.2). */
export const blankTournament = ({ name = '', eventId = null, createdBy = '', now = Date.now() } = {}) => ({
  id: `trn_${now}`,
  name: (typeof name === 'string' && name.trim()) || 'Naamloos toernooi',
  eventId: eventId ?? null,
  status: 'draft',
  entrants: [],
  rounds: [],
  // `secret` (2026-08-24): "let me create a tournament but make it secret,
  // same as other features" -- scoped to the whole tournament (not
  // per-round), stored in this same `settings` JSONB so no migration is
  // needed. Explicit `false` here rather than just leaving the key absent,
  // so every freshly-created tournament's settings shape is predictable.
  settings: { showLivePreview: true, tieBreak: [...DEFAULT_TIE_BREAK_ORDER], secret: false },
  teamSetId: null,
  createdBy: typeof createdBy === 'string' ? createdBy : '',
  createdAt: isoOf(now),
  updatedAt: isoOf(now),
});

/** A brand-new round, seeded with its scoring type's default config (§3.2, §4.3). */
export const blankRound = ({
  name = '',
  scoringTypeId = 'manual',
  format = 'matches',
  icon = '🎮',
  now = Date.now(),
} = {}) => {
  const type = getScoringType(scoringTypeId);
  const fmt = ['matches', 'freeform', 'quiz'].includes(format) ? format : 'matches';
  return {
    id: `rnd_${now}`,
    name: (typeof name === 'string' && name.trim()) || 'Nieuwe ronde',
    icon: typeof icon === 'string' && icon ? icon : '🎮',
    notes: '',
    entrantIds: [],
    teamSetId: null,
    scoring: { typeId: type.id, config: defaultConfigFor(type) },
    format: fmt,
    matches: [],
    freeform: { entries: {} },
    source: fmt === 'quiz' ? { type: 'quiz', eventId: null, quizId: null, nameMap: {}, pulledAt: null, raw: {} } : null,
    timer: { seconds: ROUND_TIMER_DEFAULT_SECONDS, perMatch: true },
    award: {
      mode: 'placement',
      table: [...DEFAULT_PLACEMENT_TABLE],
      perWin: DEFAULT_PER_WIN,
      perDraw: DEFAULT_PER_DRAW,
      rawFactor: DEFAULT_RAW_FACTOR,
    },
    status: 'pending',
    results: null,
  };
};

/**
 * A single match. `bId=null` means a bye. The default `id` is
 * `mt_<now>` (matching the app's existing `x${Date.now()}` id idiom for
 * one-off "add match" clicks); the round-robin/random-pair generators below
 * pass an explicit `id` per match instead, so multiple matches created in
 * the same tick never collide.
 */
export const blankMatch = (aId, bId = null, { now = Date.now(), id } = {}) => ({
  id: id || `mt_${now}`,
  aId: aId ?? null,
  bId: bId ?? null,
  entry: { a: {}, b: {} },
  winnerId: null,
  status: 'pending',
  startedAt: null,
  endedAt: null,
  note: '',
  bracket: null,
});

/**
 * Materialises entrants from a team_sets row (§4.2) — a snapshot **copy**,
 * not a live reference, so renaming a team in the library later doesn't
 * rewrite a finished tournament's history. `sourceTeamId` is kept for the
 * awards archive to find its way home.
 */
export const entrantsFromTeamSet = (teamSet) => {
  const teams = teamSet && Array.isArray(teamSet.teams) ? teamSet.teams : [];
  return teams
    .filter((t) => t && typeof t === 'object' && typeof t.id === 'string' && t.id)
    .map((t) => ({
      id: `ent_${t.id}`,
      kind: 'team',
      name: (typeof t.name === 'string' && t.name.trim()) || 'Naamloos team',
      avatar: typeof t.avatar === 'string' && t.avatar ? t.avatar : '🎯',
      memberNames: Array.isArray(t.members) ? t.members.filter((m) => typeof m === 'string') : [],
      teamSetId: (teamSet && typeof teamSet.id === 'string' && teamSet.id) || null,
      sourceTeamId: t.id,
    }));
};

/**
 * Individual-player entrants seeded from `evt.attendees` (§4.2) — needed
 * for pool/darts rounds that don't use teams. Only RSVP statuses in
 * `statuses` (default: actually showed up) become entrants.
 */
export const entrantsFromAttendees = (attendees, { statuses = ATTENDING_STATUSES } = {}) => {
  const list = Array.isArray(attendees) ? attendees : [];
  const allowed = Array.isArray(statuses) ? statuses : ATTENDING_STATUSES;
  return list
    .filter((a) => a && typeof a.name === 'string' && a.name.trim() && allowed.includes(a.status))
    .map((a) => ({
      id: `ent_p_${slugify(a.name)}`,
      kind: 'player',
      name: a.name,
      avatar: '🙂',
      memberNames: [],
      teamSetId: null,
      sourceTeamId: null,
    }));
};

/**
 * Every unordered pair exactly once (full round-robin: everyone plays
 * everyone within this round — no time-sliced "rounds" or byes needed for
 * an even/odd count, since it's just C(n,2) combinations).
 */
export const generateRoundRobin = (entrantIds, { now = Date.now() } = {}) => {
  const ids = dedupeIds(entrantIds);
  const matches = [];
  let i = 0;
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      matches.push(blankMatch(ids[a], ids[b], { now, id: `mt_${now}_${i}` }));
      i++;
    }
  }
  return matches;
};

/**
 * Shuffles entrants and pairs them off; an odd entrant gets a bye
 * (`bId: null`). `rng` is injectable (defaults to `Math.random`) so a test
 * can supply a seeded/mock generator and assert a specific, reproducible
 * shuffle — the same "pass the source of non-determinism in" rule as `now`.
 */
export const generateRandomPairs = (entrantIds, { now = Date.now(), rng = Math.random } = {}) => {
  const ids = dedupeIds(entrantIds);
  const shuffled = ids.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const matches = [];
  let k = 0;
  for (let i = 0; i < shuffled.length; i += 2) {
    const aId = shuffled[i];
    const bId = shuffled[i + 1] ?? null;
    matches.push(blankMatch(aId, bId, { now, id: `mt_${now}_${k}` }));
    k++;
  }
  return matches;
};

function dedupeIds(entrantIds) {
  const raw = Array.isArray(entrantIds) ? entrantIds : [];
  return [...new Set(raw.filter((id) => typeof id === 'string' && id))];
}

// generateSingleElim — phase 2 (docs/mensgames-spec.md §5, §10 cut line 2).
