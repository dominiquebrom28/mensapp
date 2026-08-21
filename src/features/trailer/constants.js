// Shared constants for the event-trailer feature (src/features/trailer/).
// Plain values only -- no React, no DOM, safe to import from any file in
// this directory or from a test.
//
// Stripped down (2026-08-21, owner direction change: a real video replaces
// the generated beat sequence) to just what the video-player + single
// end-card view actually still uses. The beat-engine's timing/degradation
// budget (durations, roster caps, audio tuning, clock-frame clamp, etc.)
// is gone along with the engine itself.

export const TRAILER_VERSION = 1;

// localStorage key for "has this device watched this event's trailer"
// (matches the app's existing per-device-preference naming convention:
// `ann-dismissed`, `md-sj-unlocked`). Marked on the video's `ended` event.
export const SEEN_KEY = 'md-trailer-seen';

// End-card roster cap: named avatars shown before the grid folds the rest
// into a "+N more legends" tile.
export const ROSTER_MAX_NAMED = 10;

// Pre-play countdown length in whole seconds (2026-08-21b: "a 3-second
// countdown, then autoplay" -- see EventTrailer.jsx's own docblock for the
// autoplay-policy mitigation this gates).
export const COUNTDOWN_SECONDS = 3;
