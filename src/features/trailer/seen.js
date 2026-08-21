// localStorage["md-trailer-seen"]: { [eventId]: { v, at } }. Per-device,
// non-authoritative, cosmetic ("replayable any number of times, no gating"
// -- technical spec §10). Matches the app's existing localStorage-only
// preference pattern (`ann-dismissed`, `md-sj-unlocked`).
//
// Not pure (does real localStorage I/O) and not required to be -- unchanged
// by the 2026-08-21 video-player direction change, which only touched the
// beat-engine files (now deleted) this module never depended on.
import { SEEN_KEY, TRAILER_VERSION } from './constants.js';

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(next) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable/full -- seen-tracking is a cosmetic nudge, never
    // required for the trailer to function.
  }
}

/**
 * @param {string} eventId
 * @param {{version?:number}} [opts]
 */
export function hasSeenTrailer(eventId, opts = {}) {
  const version = Number.isFinite(opts.version) ? opts.version : TRAILER_VERSION;
  if (!eventId) return false;
  const entry = readAll()[eventId];
  return !!entry && entry.v === version;
}

/**
 * @param {string} eventId
 * @param {{version?:number, nowMs?:number}} [opts]
 */
export function markTrailerSeen(eventId, opts = {}) {
  if (!eventId) return;
  const version = Number.isFinite(opts.version) ? opts.version : TRAILER_VERSION;
  const at = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const all = readAll();
  all[eventId] = { v: version, at };
  writeAll(all);
}

/** @param {string} eventId */
export function clearSeenTrailer(eventId) {
  if (!eventId) return;
  const all = readAll();
  if (eventId in all) {
    delete all[eventId];
    writeAll(all);
  }
}
