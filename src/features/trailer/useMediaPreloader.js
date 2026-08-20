// Preload + decode + timeout + concurrency cap for the trailer's beat
// images. See docs/trailer-technical-spec.md §6.1.
//
// The timeline is authoritative; media is opportunistic and never blocks a
// beat transition -- this hook only ever reports status, it never gates
// playback.
//
// Implementation note: `pump`/`startLoad`/`enqueue` are mutually
// referential (loading a url can free a concurrency slot that pumps the
// next one, forever). Wrapping each in its own `useCallback` would create a
// dependency cycle fighting `react-hooks/exhaustive-deps` for no real
// benefit -- none of the three are handed to a child or an effect that
// needs referential stability. They're plain functions closing over refs
// instead; only the three methods actually returned to the caller
// (`statusOf`, `ensureFrom`, `preflight`) are memoized.
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { isSafeImageUrl } from './safeUrl.js';
import {
  PRELOAD_CONCURRENCY,
  PRELOAD_LOOKAHEAD,
  PRELOAD_TIMEOUT_MS,
  PREFLIGHT_BUDGET_MS,
  PREFLIGHT_COUNT,
} from './constants.js';

export const PRELOAD_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  FAILED: 'failed',
});

/**
 * @param {string[]} urls  beat-ordered list of image URLs (may contain gaps --
 *   a typographic beat simply has no entry). MUST already exclude any secret
 *   stop's image (buildBeats.js never emits one -- see its leak-invariant
 *   tests). This hook additionally never issues a request for a URL that
 *   fails `isSafeImageUrl`, as defence in depth.
 * @param {Object} [opts]
 * @param {number} [opts.lookahead]
 * @param {number} [opts.concurrency]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.enabled]
 */
export function useMediaPreloader(urls, opts = {}) {
  const {
    lookahead = PRELOAD_LOOKAHEAD,
    concurrency = PRELOAD_CONCURRENCY,
    timeoutMs = PRELOAD_TIMEOUT_MS,
    enabled = true,
  } = opts;

  const list = useMemo(() => (Array.isArray(urls) ? urls : []), [urls]);

  const statusRef = useRef(new Map()); // url -> PRELOAD_STATUS
  const queueRef = useRef([]); // pending urls, FIFO
  const inFlightRef = useRef(new Set());
  const mountedRef = useRef(true);
  // Status lives in a ref (so a status flip never forces a per-frame-style
  // render storm), with a small `useReducer` counter to trigger exactly one
  // re-render per flip so a caller reading `statusOf()` during render sees
  // it -- the same "ref for data, tiny setState for 'something changed'"
  // shape as the trailer clock (§5.3).
  const [, bump] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const setStatus = (url, status) => {
    if (statusRef.current.get(url) === status) return;
    statusRef.current.set(url, status);
    if (mountedRef.current) bump();
  };

  function pump() {
    if (!enabled) return;
    while (inFlightRef.current.size < concurrency && queueRef.current.length > 0) {
      const url = queueRef.current.shift();
      const cur = statusRef.current.get(url);
      if (cur === PRELOAD_STATUS.READY || cur === PRELOAD_STATUS.FAILED || cur === PRELOAD_STATUS.LOADING) continue;
      startLoad(url);
    }
  }

  function startLoad(url) {
    inFlightRef.current.add(url);
    setStatus(url, PRELOAD_STATUS.LOADING);

    if (!isSafeImageUrl(url)) {
      // Never construct an Image()/issue a request for an unsafe URL --
      // "unsafe URL -> failed, silently" (§6.1), and belt-and-suspenders
      // against ever handing a secret stop's URL to the network (§5.5.3).
      inFlightRef.current.delete(url);
      setStatus(url, PRELOAD_STATUS.FAILED);
      pump();
      return;
    }

    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      inFlightRef.current.delete(url);
      setStatus(url, status);
      pump();
    };

    const timer = setTimeout(() => finish(PRELOAD_STATUS.FAILED), timeoutMs);

    const img = new Image();
    // Deliberately no `crossOrigin` -- we never read pixels; setting it
    // would turn a CORS misconfiguration into a hard failure (§6.1).
    img.decoding = 'async';
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(() => finish(PRELOAD_STATUS.READY)).catch(() => {
          // decode() rejected -- the image already loaded via onload, so
          // treat it as ready rather than retrying decode() again; this is
          // the "fall back to onload once, then give up" path (§6.1).
          finish(PRELOAD_STATUS.READY);
        });
      } else {
        finish(PRELOAD_STATUS.READY);
      }
    };
    img.onerror = () => finish(PRELOAD_STATUS.FAILED);
    img.src = url;
    // Some environments settle `decode()` independently of `onload`; racing
    // both is harmless since `finish` is idempotent.
    if (typeof img.decode === 'function') {
      img.decode().then(() => finish(PRELOAD_STATUS.READY)).catch(() => { /* wait for onload/onerror/timeout */ });
    }
  }

  function enqueue(url) {
    if (!url) return;
    const cur = statusRef.current.get(url);
    if (cur === PRELOAD_STATUS.READY || cur === PRELOAD_STATUS.LOADING) return;
    if (cur === PRELOAD_STATUS.FAILED) return; // give up once, per §6.1 -- no retry storm
    if (queueRef.current.includes(url)) return;
    queueRef.current.push(url);
    pump();
  }

  const statusOf = useCallback((url) => statusRef.current.get(url) || PRELOAD_STATUS.IDLE, []);

  // Rolling preload: on each beat change, load `index+1 .. index+lookahead`.
  const ensureFrom = useCallback((beatIndex) => {
    if (!enabled) return;
    for (let i = 1; i <= lookahead; i++) {
      const url = list[beatIndex + i];
      if (url) enqueue(url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enqueue/pump/startLoad close over refs + the opts destructured above, not over anything requiring re-memoization; re-running on [enabled, lookahead, list] is exactly right.
  }, [enabled, lookahead, list]);

  // Preflight: load the first `count` (default PREFLIGHT_COUNT) URLs while
  // the tap-to-start poster is up, racing an overall budget so a slow/dead
  // asset never delays the tap-to-play affordance beyond it.
  const preflight = useCallback((count = PREFLIGHT_COUNT) => {
    if (!enabled) return Promise.resolve();
    const targets = list.slice(0, count).filter(Boolean);
    if (targets.length === 0) return Promise.resolve();
    targets.forEach(enqueue);
    const settle = Promise.all(targets.map((url) => waitForSettled(statusRef, url)));
    const budget = new Promise((resolve) => setTimeout(resolve, PREFLIGHT_BUDGET_MS));
    return Promise.race([settle, budget]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see ensureFrom above.
  }, [enabled, list]);

  return { statusOf, ensureFrom, preflight };
}

function waitForSettled(statusRef, url) {
  return new Promise((resolve) => {
    const check = () => {
      const s = statusRef.current.get(url);
      if (s === PRELOAD_STATUS.READY || s === PRELOAD_STATUS.FAILED) {
        resolve();
      } else {
        setTimeout(check, 30);
      }
    };
    check();
  });
}
