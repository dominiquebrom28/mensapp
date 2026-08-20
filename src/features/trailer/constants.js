// Shared constants for the event-trailer feature (src/features/trailer/).
// Plain values only -- no React, no DOM, safe to import from any file in
// this directory (pure `buildBeats`/`timeline` included) or from a test.
//
// See docs/trailer-technical-spec.md (the contract) and
// docs/trailer-creative-spec.md (creative direction/runtime formula) for
// where these numbers come from. Deviations from a literal reading of
// either doc are called out inline.

export const TRAILER_VERSION = 1;

// The exhaustive set of beat kinds `buildBeats.js` is allowed to emit
// (technical spec §5.1). Declared here rather than in buildBeats.js so any
// file in this directory can depend on the enum without importing
// buildBeats.js -- buildBeats.js re-exports it too, matching the shape shown
// inline in the spec.
export const BEAT_KINDS = Object.freeze({
  TITLE: 'title',
  META: 'meta',
  STOP: 'stop',
  SECRET: 'secret',
  // "Last year's champion" continuity nod (creative spec §3 Beat 5). Added
  // after the initial pass, which had flagged this beat as a spec gap
  // (technical spec §5.1's original enum had no entry for it) rather than
  // inventing a kind unasked -- the architect confirmed: extend, don't drop.
  LEGACY: 'legacy',
  ROSTER: 'roster',
  COUNTDOWN: 'countdown',
  OUTRO: 'outro',
});

// Per-kind default on-screen durations (ms).
//
// Source: docs/trailer-creative-spec.md §7 "Runtime formula" (5s open, 6s
// hook, 2.6s/stop, 6s secret, 7s close), generalised in one place: the
// creative doc hardcodes the montage cap at 4 stops, but the technical spec
// (§5.5) is explicit that `maxStopBeats` defaults to 6 and is the ceiling
// buildBeats.js must actually honour -- that number governs here, not "4".
export const DURATIONS = Object.freeze({
  TITLE: 5000,
  META: 6000,
  COUNTDOWN: 3000, // not specified by either doc; a deliberately short data beat -- days-to-go readable in one glance. Revisit with design.
  STOP: 2600,
  STOP_SPOTLIGHT: 13000, // single-stop "extended spotlight" degrade, creative §7
  SECRET: 6000, // flat regardless of secret count, creative §6
  LEGACY: 4000, // creative §3 Beat 5 "Legacy flash": "skips if no prior-edition data, else 4s"
  OUTRO: 7000,
});

// Roster duration formula, creative spec §7: "8 + 0.7 x min(n,10), capped 16"
// (seconds) -- converted to ms below.
export const ROSTER_BASE_MS = 8000;
export const ROSTER_PER_PERSON_MS = 700;
export const ROSTER_MAX_MS = 16000;
// creative §7: "cap named call-outs at the first 8-10 confirmed 'going'".
export const ROSTER_MAX_NAMED = 10;

// Technical spec §5.5 ceiling default ("maxStopBeats default 6").
export const MAX_STOP_BEATS_DEFAULT = 6;

// Technical spec §5.3 says "hard cap 60 s"; creative spec §7 says the
// ceiling is "~60-65s, never enumerated further no matter how much data
// exists." 65000 wins: it's the number the creative doc's own per-beat
// durations (the ones DURATIONS above is built from) were actually designed
// around, and the technical spec's 60s reads as the same ballpark rounded
// down, not a stricter separate requirement. This is enforced as a real
// invariant in buildBeats -- see the trimming step near the end of
// buildBeats() -- not just a number asserted in one test case.
export const MAX_TOTAL_MS = 65000;

// Two audio layers (Dom amendment, landed mid-build -- see useTrailerAudio.js
// docblock): a music bed and an *optional* voiceover. Both versioned
// filenames so immutable caching is safe (technical spec §6.3). NOTE:
// neither file exists yet under public/trailer/ -- sourcing/licensing the
// music track is an explicit out-of-scope blocker (spec §1 "Blocker to
// flag" / §13 risk 2), and the VO may never exist at all. Both are safe to
// reference regardless: useTrailerAudio treats a 404/load failure on either
// as a silent degrade (music -> "unavailable", VO -> "not available", VO's
// absence is the *default* expected state, not an error).
export const MUSIC_SRC = '/trailer/theme-v1.mp3';
// Back-compat alias -- this is the name the technical spec's §6.3 uses for
// "the one asset" before the two-layer amendment.
export const AUDIO_SRC = MUSIC_SRC;
export const VO_SRC = '/trailer/vo-v1.mp3';
// When the VO track should start, relative to the trailer's own t=0. Dom
// doesn't know the real timing until the line is recorded -- exposed as a
// constant rather than hardcoded into the hook so it's a one-line change.
export const VO_START_MS = 0;

// Ducking: while the VO is audible, the music bed drops to roughly this
// fraction of its normal volume, ramping over DUCK_DOWN_MS, and ramps back
// up over DUCK_UP_MS once the VO ends. Reuses the same rAF ramp helper as
// fade-in/fade-out -- no second mechanism, no Web Audio API.
export const DUCK_VOLUME_RATIO = 0.28;
export const DUCK_DOWN_MS = 300;
export const DUCK_UP_MS = 500;

// localStorage keys (technical spec §10), matching the app's existing
// per-device-preference naming convention (`ann-dismissed`, `md-sj-unlocked`).
export const SEEN_KEY = 'md-trailer-seen';
export const MUTE_KEY = 'md-trailer-muted';

// Media/audio tuning (technical spec §6).
export const PRELOAD_TIMEOUT_MS = 4000;
export const PRELOAD_CONCURRENCY = 3;
export const PRELOAD_LOOKAHEAD = 2;
export const PREFLIGHT_COUNT = 2;
export const PREFLIGHT_BUDGET_MS = 3000;

export const AUDIO_FAILURE_TIMEOUT_MS = 5000;
export const AUDIO_FADE_IN_MS = 400;
export const AUDIO_FADE_OUT_MS = 600;
export const AUDIO_DRIFT_THRESHOLD_MS = 250;
export const AUDIO_DRIFT_CLAMP_MS = 400;

// Frame-delta clamp for the rAF clock (technical spec §5.4): a backgrounded
// tab or GC pause must not teleport several beats forward in one tick.
export const CLOCK_MAX_FRAME_DELTA_MS = 100;
