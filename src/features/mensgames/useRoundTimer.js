// Round timer (WP-H; docs/mensgames-spec.md §4.5). Same interval+ref
// pattern as `TimerPage` in App.jsx — **deliberately duplicated**, not
// extracted (§4.5: extracting TimerPage risks a working feature mid-sprint
// for no functional gain, and the round timer's behaviour genuinely differs
// — per-match, stamps startedAt/endedAt, has a compact expired state).
// Timing is injectable (setInterval/clearInterval/now) so this is testable
// without real timers, following the pattern src/test/mocks/mediaEnv.js
// established for the trailer feature.
import { useEffect, useRef, useState } from 'react';
import { ROUND_TIMER_MAX_SECONDS, ROUND_TIMER_MIN_SECONDS } from './constants.js';

function clampSeconds(seconds) {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(n)) return ROUND_TIMER_MIN_SECONDS;
  return Math.min(ROUND_TIMER_MAX_SECONDS, Math.max(ROUND_TIMER_MIN_SECONDS, Math.round(n)));
}

export function useRoundTimer(initialSeconds = 60, {
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  now = () => Date.now(),
} = {}) {
  const clampedInitial = clampSeconds(initialSeconds);
  const [totalSeconds, setTotalSeconds] = useState(clampedInitial);
  const [remaining, setRemaining] = useState(clampedInitial);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [endedAt, setEndedAt] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setIntervalFn(() => {
        setRemaining((r) => {
          if (r <= 1) {
            clearIntervalFn(intervalRef.current);
            setRunning(false);
            setFinished(true);
            setEndedAt(now());
            return 0;
          }
          return r - 1;
        });
      }, 1000);
    } else {
      clearIntervalFn(intervalRef.current);
    }
    return () => clearIntervalFn(intervalRef.current);
  }, [running, setIntervalFn, clearIntervalFn, now]);

  const setSeconds = (seconds) => {
    const clamped = clampSeconds(seconds);
    clearIntervalFn(intervalRef.current);
    setRunning(false);
    setFinished(false);
    setStartedAt(null);
    setEndedAt(null);
    setTotalSeconds(clamped);
    setRemaining(clamped);
  };

  const start = () => {
    if (remaining <= 0) return;
    setFinished(false);
    setEndedAt(null);
    setStartedAt((prev) => prev ?? now());
    setRunning(true);
  };

  const pause = () => setRunning(false);

  const reset = () => {
    clearIntervalFn(intervalRef.current);
    setRunning(false);
    setFinished(false);
    setStartedAt(null);
    setEndedAt(null);
    setRemaining(totalSeconds);
  };

  return {
    totalSeconds,
    remaining,
    running,
    finished,
    startedAt,
    endedAt,
    progress: totalSeconds > 0 ? remaining / totalSeconds : 0,
    setSeconds,
    start,
    pause,
    reset,
  };
}
