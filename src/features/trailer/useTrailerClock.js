// The rAF sequencing clock. See docs/trailer-technical-spec.md §5.2-§5.4.
//
// One requestAnimationFrame loop over an injectable clock. React re-renders
// only when the active beat index changes (or on state transitions) --
// never once per frame; continuous progress is a ref, for a caller to push
// straight to the DOM via a CSS custom property (§5.3).
//
// DEVIATION FROM THE LITERAL SIGNATURE IN THE SPEC: §5.4 shows
// `useTrailerClock({ totalMs, onBeatChange, onEnd, now, raf, caf })`. A
// clock that only knows a grand total, with no way to resolve *which* beat
// a given `tMs` falls in, cannot itself decide when a "boundary" has been
// crossed -- and firing `onBeatChange` exactly once per boundary (including
// when one frame spans two beats) is the hook's core contract. So this
// implementation accepts a `timeline` (the `buildTimeline()` output, §5.1)
// as the primary input, and still accepts a plain `totalMs` as a fallback
// for a boundary-less single-segment clock (useful in isolation / tests).
// Exactly one of the two must be supplied.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { beatIndexAt } from './timeline.js';
import { CLOCK_MAX_FRAME_DELTA_MS } from './constants.js';

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const defaultRaf = (cb) => (typeof window !== 'undefined' && window.requestAnimationFrame
  ? window.requestAnimationFrame(cb)
  : setTimeout(() => cb(defaultNow()), 16));
const defaultCaf = (handle) => {
  if (typeof window !== 'undefined' && window.cancelAnimationFrame) window.cancelAnimationFrame(handle);
  else clearTimeout(handle);
};

/**
 * @param {Object} opts
 * @param {{segments: Array, totalMs: number}} [opts.timeline]
 * @param {number} [opts.totalMs] fallback single-segment mode when no `timeline` is given
 * @param {(index:number, prevIndex:number) => void} [opts.onBeatChange]
 * @param {() => void} [opts.onEnd]
 * @param {() => number} [opts.now]
 * @param {(cb:(t:number)=>void) => any} [opts.raf]
 * @param {(handle:any) => void} [opts.caf]
 */
export function useTrailerClock({
  timeline,
  totalMs: totalMsOpt,
  onBeatChange,
  onEnd,
  now = defaultNow,
  raf = defaultRaf,
  caf = defaultCaf,
} = {}) {
  const segmentCount = timeline ? timeline.segments.length : (Number.isFinite(totalMsOpt) && totalMsOpt > 0 ? 1 : 0);
  const totalMsSafe = timeline ? timeline.totalMs : Math.max(0, Number.isFinite(totalMsOpt) ? totalMsOpt : 0);

  const [state, setStateReact] = useState('idle');
  const [index, setIndexReact] = useState(segmentCount > 0 ? 0 : -1);

  const stateRef = useRef('idle');
  const tRef = useRef(0);
  const indexRef = useRef(segmentCount > 0 ? 0 : -1);
  const lastTickRef = useRef(null); // last raf-callback timestamp we integrated, or null when not ticking
  const handleRef = useRef(null); // pending raf id, or null
  const endedFiredRef = useRef(false);

  // Keep latest callbacks/handlers in refs so the imperative tick loop
  // never closes over a stale render's props (StrictMode remounts this
  // hook's effect, not just re-renders it -- the loop itself must survive
  // that untouched).
  const onBeatChangeRef = useRef(onBeatChange);
  const onEndRef = useRef(onEnd);
  useEffect(() => { onBeatChangeRef.current = onBeatChange; }, [onBeatChange]);
  useEffect(() => { onEndRef.current = onEnd; }, [onEnd]);

  const indexAt = useCallback((tMs) => {
    if (timeline) return beatIndexAt(timeline, tMs);
    if (segmentCount === 0) return -1;
    return tMs >= totalMsSafe ? -1 : 0;
  }, [timeline, segmentCount, totalMsSafe]);

  const setPlaybackState = useCallback((next) => {
    stateRef.current = next;
    setStateReact(next);
  }, []);

  // Move the exposed `index` to `nextIndex`. `mode: 'walk'` (used by the
  // frame tick) fires onBeatChange once for every boundary between the old
  // index and the new one -- required so a single long frame that skips a
  // short beat still notifies for it (§5.4). `mode: 'jump'` (seek/restart)
  // fires once, directly, for the destination -- a seek is a single
  // teleport, not a sequence of crossings.
  const moveIndexTo = useCallback((nextIndex, mode) => {
    const prev = indexRef.current;
    if (nextIndex === prev) return;
    if (mode === 'walk' && nextIndex > prev && prev >= 0 && segmentCount > 0) {
      for (let i = prev + 1; i <= nextIndex; i++) {
        indexRef.current = i;
        setIndexReact(i);
        onBeatChangeRef.current?.(i, i - 1);
      }
    } else {
      indexRef.current = nextIndex;
      setIndexReact(nextIndex);
      onBeatChangeRef.current?.(nextIndex, prev);
    }
  }, [segmentCount]);

  const stopTicking = useCallback(() => {
    if (handleRef.current != null) {
      caf(handleRef.current);
      handleRef.current = null;
    }
    lastTickRef.current = null;
  }, [caf]);

  // Shared "apply a new absolute time" path for tick/seek/restart/nudgeTo.
  const applyTime = useCallback((rawT, mode) => {
    const clamped = Math.max(0, Math.min(rawT, totalMsSafe));
    tRef.current = clamped;
    const resolved = indexAt(clamped);

    if (resolved === -1) {
      // Reached (or was placed at/after) the end. Hold on the final beat's
      // last frame rather than unmounting (§5.4).
      const finalIndex = segmentCount > 0 ? segmentCount - 1 : -1;
      if (finalIndex >= 0) moveIndexTo(finalIndex, mode === 'tick' ? 'walk' : 'jump');
      stopTicking();
      if (!endedFiredRef.current) {
        endedFiredRef.current = true;
        setPlaybackState('ended');
        onEndRef.current?.();
      } else if (stateRef.current !== 'ended') {
        setPlaybackState('ended');
      }
      return;
    }

    endedFiredRef.current = false;
    moveIndexTo(resolved, mode === 'tick' ? 'walk' : 'jump');
  }, [indexAt, moveIndexTo, segmentCount, setPlaybackState, stopTicking, totalMsSafe]);

  const tick = useCallback((rafNow) => {
    handleRef.current = null;
    const prevNow = lastTickRef.current == null ? rafNow : lastTickRef.current;
    const rawDelta = rafNow - prevNow;
    const delta = Math.max(0, Math.min(rawDelta, CLOCK_MAX_FRAME_DELTA_MS));
    lastTickRef.current = rafNow;
    applyTime(tRef.current + delta, 'tick');
    if (stateRef.current === 'playing') {
      handleRef.current = raf(tick);
    }
  }, [applyTime, raf]);

  // The loop itself: starts exactly one pending frame whenever `state`
  // becomes 'playing', and its cleanup always cancels whatever is the most
  // recently scheduled frame (read live off `handleRef`, not a stale
  // closure) -- this is what keeps StrictMode's mount/unmount/remount from
  // ever leaving two loops alive at once (§5.4, the required unmount test).
  useEffect(() => {
    if (state !== 'playing') return undefined;
    lastTickRef.current = now();
    handleRef.current = raf(tick);
    return () => {
      if (handleRef.current != null) {
        caf(handleRef.current);
        handleRef.current = null;
      }
      lastTickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- raf/caf/now/tick are stable per the caller's contract (injected once); re-subscribing only on `state` is intentional.
  }, [state]);

  const play = useCallback(() => {
    if (segmentCount === 0) return;
    if (stateRef.current === 'playing') return;
    if (stateRef.current === 'ended') return; // use restart() instead
    setPlaybackState('playing');
  }, [segmentCount, setPlaybackState]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'playing') return;
    setPlaybackState('paused');
  }, [setPlaybackState]);

  const toggle = useCallback(() => {
    if (stateRef.current === 'playing') pause();
    else if (stateRef.current === 'paused' || stateRef.current === 'idle') play();
    // 'ended': no-op by design -- replay is an explicit, separate control.
  }, [pause, play]);

  const seek = useCallback((tMs) => {
    applyTime(tMs, 'seek');
  }, [applyTime]);

  const restart = useCallback(() => {
    endedFiredRef.current = false;
    applyTime(0, 'seek');
    if (segmentCount > 0) setPlaybackState('playing');
  }, [applyTime, segmentCount, setPlaybackState]);

  // One-way soft drift correction (§6.3): nudges the clock's own time
  // toward `targetMs` (typically the <audio> element's currentTime, read
  // by the caller -- never the reverse), clamped to +-400ms per call.
  const nudgeTo = useCallback((targetMs) => {
    const AUDIO_DRIFT_CLAMP_MS = 400;
    const diff = Math.max(-AUDIO_DRIFT_CLAMP_MS, Math.min(AUDIO_DRIFT_CLAMP_MS, targetMs - tRef.current));
    if (diff === 0) return;
    applyTime(tRef.current + diff, 'tick');
  }, [applyTime]);

  return useMemo(() => ({
    state,
    index,
    tRef,
    play,
    pause,
    toggle,
    seek,
    restart,
    nudgeTo,
  }), [state, index, play, pause, toggle, seek, restart, nudgeTo]);
}
