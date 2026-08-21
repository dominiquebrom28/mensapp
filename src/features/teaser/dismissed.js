// localStorage["md-teaser-dismissed"]: array of event ids the user has
// explicitly skipped the login teaser for, on this device. Mirrors the app's
// existing per-device-preference conventions -- `ann-dismissed` (App.jsx,
// also array-of-ids) and `md-sj-unlocked` -- and sits alongside the
// trailer's own `md-trailer-seen` (features/trailer/seen.js), which the
// login-teaser feature also checks: the teaser stops showing once the user
// EITHER skips it (tracked here) OR actually watches the trailer through to
// the end (tracked there). See App.jsx's "LOGIN TEASER" section for how the
// two are combined.
//
// Deliberately keyed on the event id alone, never on the teaser's content
// (title/text/button label) or a hash of it: an admin fixing a typo in a
// live teaser must not silently re-nag everyone who already dismissed it.
// Known and accepted trade-off, not a bug.
const DISMISSED_KEY = 'md-teaser-dismissed';

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeAll(next) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable/full -- dismissal is a cosmetic nudge (worst case:
    // the teaser shows again next entry), never required for the app to
    // function.
  }
}

/** @param {string} eventId */
export function hasDismissedTeaser(eventId) {
  if (!eventId) return false;
  return readAll().includes(eventId);
}

/** @param {string} eventId */
export function dismissTeaser(eventId) {
  if (!eventId) return;
  const all = readAll();
  if (!all.includes(eventId)) writeAll([...all, eventId]);
}

/** @param {string} eventId */
export function clearDismissedTeaser(eventId) {
  if (!eventId) return;
  const all = readAll();
  if (all.includes(eventId)) writeAll(all.filter((id) => id !== eventId));
}
