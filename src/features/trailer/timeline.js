// Pure. No React, no Date.now(), no DOM. See docs/trailer-technical-spec.md
// §5.1: `buildTimeline / beatIndexAt / progressAt`.

/**
 * @typedef {Object} TimelineSegment
 * @property {import('./buildBeats').Beat} beat
 * @property {number} startMs  inclusive
 * @property {number} endMs    exclusive
 */

/**
 * @typedef {Object} Timeline
 * @property {TimelineSegment[]} segments
 * @property {number} totalMs
 */

/**
 * @param {import('./buildBeats').Beat[]} beats
 * @returns {Timeline}
 */
export function buildTimeline(beats) {
  const list = Array.isArray(beats) ? beats : [];
  let t = 0;
  const segments = list.map((beat) => {
    const dur = Math.max(0, Number.isFinite(beat?.durationMs) ? beat.durationMs : 0);
    const seg = { beat, startMs: t, endMs: t + dur };
    t += dur;
    return seg;
  });
  return { segments, totalMs: t };
}

/**
 * Index of the beat active at `tMs`, clamped 0..n-1 on the low end;
 * `-1` once `tMs >= totalMs` (playback has ended) or when there are no
 * segments at all.
 *
 * Segments are half-open [startMs, endMs). A zero-duration beat therefore
 * has an empty range and can never be the one returned -- the search simply
 * passes through it to whichever segment actually contains `tMs`. That's
 * the "zero-duration beat guard": callers never get stuck on, or have to
 * special-case, an instantaneous beat.
 *
 * @param {Timeline} timeline
 * @param {number} tMs
 * @returns {number}
 */
export function beatIndexAt(timeline, tMs) {
  const segments = timeline?.segments || [];
  const totalMs = timeline?.totalMs ?? 0;
  if (segments.length === 0) return -1;
  if (tMs >= totalMs) return -1;
  const clamped = tMs < 0 ? 0 : tMs;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (clamped >= seg.startMs && clamped < seg.endMs) return i;
  }
  // Every real (non-zero-duration) millisecond in [0, totalMs) belongs to
  // some segment's half-open range, so this is unreachable in practice --
  // guarded rather than asserted, so a future malformed timeline degrades
  // to "ended" instead of throwing mid-playback.
  return -1;
}

/**
 * @param {Timeline} timeline
 * @param {number} tMs
 * @returns {{index:number, localMs:number, localPct:number, globalPct:number}}
 */
export function progressAt(timeline, tMs) {
  const totalMs = timeline?.totalMs ?? 0;
  const index = beatIndexAt(timeline, tMs);
  if (index === -1) {
    return { index: -1, localMs: 0, localPct: 1, globalPct: 1 };
  }
  const seg = timeline.segments[index];
  const dur = seg.endMs - seg.startMs;
  const localMs = Math.max(0, tMs - seg.startMs);
  const localPct = dur > 0 ? clamp01(localMs / dur) : 1;
  const globalPct = totalMs > 0 ? clamp01(tMs / totalMs) : 0;
  return { index, localMs, localPct, globalPct };
}

function clamp01(n) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
