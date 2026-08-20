// Two <audio> layers: `music` (the bed, required-but-droppable) and `vo`
// (an OPTIONAL voiceover). See docs/trailer-technical-spec.md §6.3 for the
// original single-track design; this file implements a mid-build amendment
// from Dom layering a second, optional voiceover track on top of it, with
// ducking. Everything the original spec says about the music bed still
// holds (created on mount, gesture-gated `start()`, never the master
// clock, one-way soft drift correction, 5s failure timeout, fade in/out,
// shared mute). The amendment adds:
//
//  - a second element for VO, whose absence/404/load-failure is a total,
//    silent no-op -- "no voiceover" is the default state, not an error;
//  - ducking the music bed to ~28% while VO is audible, ramping down over
//    DUCK_DOWN_MS and back up over DUCK_UP_MS, using the SAME rAF
//    volume-ramp helper as fade-in/fade-out (no second mechanism, still no
//    Web Audio API -- the spec's rejection of WebAudio stands);
//  - one mute control for both layers together;
//  - VO_START_MS as a constant, not hardcoded, since Dom won't know the
//    real timing until the line is recorded.
//
// BOUNDARY NOTE ON DRIFT CORRECTION (unchanged from the original design):
// the technical spec's `nudgeTo(...)` is the *clock's* method (§5.4), not
// this hook's. Per the amendment, that correction keys off the MUSIC
// element only -- the VO is fire-and-forget from its own start offset and
// never drives the clock. The comparison itself is glue that belongs in
// the component wiring both hooks together (package E, `EventTrailer.jsx`
// -- out of this pass's scope):
//
//   onBeatChange: (index, prev, tMs) => {
//     audio.startVoIfDue(tMs); // no-op once VO has started, or if unavailable
//     if (audio.isPlaying()) {
//       const musicMs = audio.getCurrentTimeMs();
//       if (musicMs != null && Math.abs(musicMs - clock.tRef.current) > AUDIO_DRIFT_THRESHOLD_MS) {
//         clock.nudgeTo(musicMs); // clock.js clamps to +-AUDIO_DRIFT_CLAMP_MS itself
//       }
//     }
//   }
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DUCK_DOWN_MS,
  DUCK_UP_MS,
  DUCK_VOLUME_RATIO,
  AUDIO_FADE_IN_MS,
  AUDIO_FADE_OUT_MS,
  AUDIO_FAILURE_TIMEOUT_MS,
  MUSIC_SRC,
  MUTE_KEY,
  VO_SRC,
  VO_START_MS,
} from './constants.js';

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const defaultRaf = (cb) => (typeof window !== 'undefined' && window.requestAnimationFrame
  ? window.requestAnimationFrame(cb)
  : setTimeout(() => cb(defaultNow()), 16));
const defaultCaf = (handle) => {
  if (typeof window !== 'undefined' && window.cancelAnimationFrame) window.cancelAnimationFrame(handle);
  else clearTimeout(handle);
};
const defaultCreateAudio = () => (typeof Audio !== 'undefined' ? new Audio() : null);

function readMutedPref() {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeMutedPref(v) {
  try {
    localStorage.setItem(MUTE_KEY, v ? 'true' : 'false');
  } catch {
    // Storage unavailable (private mode, quota) -- mute preference is a
    // per-device nicety, not required for the trailer to function.
  }
}

function clamp01(n) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.musicSrc]
 * @param {string} [opts.voSrc]
 * @param {number} [opts.voStartMs]
 * @param {() => number} [opts.now]
 * @param {(cb:(t:number)=>void) => any} [opts.raf]
 * @param {(handle:any) => void} [opts.caf]
 * @param {() => HTMLAudioElement|null} [opts.createAudio]  injectable for tests; called once per layer
 * @param {number} [opts.failureTimeoutMs]
 * @param {number} [opts.fadeInMs]
 * @param {number} [opts.fadeOutMs]
 * @param {number} [opts.volume]  music bed's normal (un-ducked) target volume, 0..1
 */
export function useTrailerAudio(opts = {}) {
  const {
    musicSrc = MUSIC_SRC,
    voSrc = VO_SRC,
    voStartMs = VO_START_MS,
    now = defaultNow,
    raf = defaultRaf,
    caf = defaultCaf,
    createAudio = defaultCreateAudio,
    failureTimeoutMs = AUDIO_FAILURE_TIMEOUT_MS,
    fadeInMs = AUDIO_FADE_IN_MS,
    fadeOutMs = AUDIO_FADE_OUT_MS,
    volume = 1,
  } = opts;

  const [muted, setMuted] = useState(readMutedPref);
  const [ready, setReady] = useState(false); // music bed ready
  const [unavailable, setUnavailable] = useState(false); // music bed unavailable -- hide the mute toggle
  const [voAvailable, setVoAvailable] = useState(false); // becomes true only once the VO has actually loaded

  const musicElRef = useRef(null);
  const voElRef = useRef(null);
  const musicFadeHandleRef = useRef(null);
  const voFadeHandleRef = useRef(null);
  const voStartedRef = useRef(false);
  const voDuckedRef = useRef(false);
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Shared rAF volume-ramp mechanism -- used for fade-in, fade-out AND
  // ducking, per the amendment ("reuse... rather than adding a second
  // mechanism"). `fadeHandleRef` is per-element so a music duck-ramp and a
  // VO fade can be in flight at the same time without cancelling each other.
  const ramp = useCallback((el, fadeHandleRef, from, to, durationMs, onDone) => {
    if (!el) { onDone?.(); return; }
    if (fadeHandleRef.current != null) {
      caf(fadeHandleRef.current);
      fadeHandleRef.current = null;
    }
    const target = mutedRef.current ? 0 : to;
    const start = now();
    const step = (t) => {
      const elapsed = Math.max(0, (typeof t === 'number' ? t : now()) - start);
      const pct = durationMs > 0 ? Math.min(1, elapsed / durationMs) : 1;
      el.volume = clamp01(from + (target - from) * pct);
      if (pct < 1) {
        fadeHandleRef.current = raf(step);
      } else {
        fadeHandleRef.current = null;
        onDone?.();
      }
    };
    fadeHandleRef.current = raf(step);
  }, [caf, now, raf]);

  const cancelAllFades = useCallback(() => {
    if (musicFadeHandleRef.current != null) { caf(musicFadeHandleRef.current); musicFadeHandleRef.current = null; }
    if (voFadeHandleRef.current != null) { caf(voFadeHandleRef.current); voFadeHandleRef.current = null; }
  }, [caf]);

  // The music bed's current "resting" target volume: full, or ducked while
  // the VO is audible.
  const musicRestingVolume = useCallback(
    () => volume * (voDuckedRef.current ? DUCK_VOLUME_RATIO : 1),
    [volume],
  );

  const duckMusicDown = useCallback(() => {
    voDuckedRef.current = true;
    const el = musicElRef.current;
    if (el) ramp(el, musicFadeHandleRef, el.volume, musicRestingVolume(), DUCK_DOWN_MS);
  }, [ramp, musicRestingVolume]);

  const duckMusicUp = useCallback(() => {
    voDuckedRef.current = false;
    const el = musicElRef.current;
    if (el) ramp(el, musicFadeHandleRef, el.volume, musicRestingVolume(), DUCK_UP_MS);
  }, [ramp, musicRestingVolume]);

  // --- Music bed lifecycle --------------------------------------------
  useEffect(() => {
    const el = createAudio();
    if (!el) {
      setUnavailable(true);
      return undefined;
    }
    el.preload = 'auto';
    el.src = musicSrc;
    el.loop = false;
    el.volume = 0; // fades in via start()
    musicElRef.current = el;

    let settled = false;
    const onReady = () => { if (!settled) { settled = true; setReady(true); } };
    const onError = () => { if (!settled) { settled = true; setUnavailable(true); } };
    el.addEventListener('canplaythrough', onReady);
    el.addEventListener('error', onError);
    const failTimer = setTimeout(() => {
      if (!settled) { settled = true; setUnavailable(true); }
    }, failureTimeoutMs);

    return () => {
      clearTimeout(failTimer);
      el.removeEventListener('canplaythrough', onReady);
      el.removeEventListener('error', onError);
      if (musicFadeHandleRef.current != null) { caf(musicFadeHandleRef.current); musicFadeHandleRef.current = null; }
      el.pause();
      musicElRef.current = null;
    };
  }, [musicSrc, failureTimeoutMs, createAudio, caf]);

  // --- VO lifecycle -- OPTIONAL. Absence/404/failure is a silent no-op:
  // `voAvailable` simply never becomes true, nothing else is affected. ---
  useEffect(() => {
    if (!voSrc) return undefined; // no track configured at all -- nothing to do
    const el = createAudio();
    if (!el) return undefined; // <audio> unsupported -- silent, music is unaffected

    el.preload = 'auto';
    el.src = voSrc;
    el.loop = false;
    el.volume = 0;
    voElRef.current = el;

    let settled = false;
    const onReady = () => { if (!settled) { settled = true; setVoAvailable(true); } };
    const onFail = () => { if (!settled) { settled = true; setVoAvailable(false); } };
    const onEnded = () => { duckMusicUp(); };
    el.addEventListener('canplaythrough', onReady);
    el.addEventListener('error', onFail);
    el.addEventListener('ended', onEnded);
    // Same failure discipline as the music bed, but the outcome is silent
    // rather than user-visible: no mute-toggle hiding, no fallback UI.
    const failTimer = setTimeout(() => { if (!settled) { settled = true; onFail(); } }, failureTimeoutMs);

    return () => {
      clearTimeout(failTimer);
      el.removeEventListener('canplaythrough', onReady);
      el.removeEventListener('error', onFail);
      el.removeEventListener('ended', onEnded);
      if (voFadeHandleRef.current != null) { caf(voFadeHandleRef.current); voFadeHandleRef.current = null; }
      el.pause();
      voElRef.current = null;
    };
  }, [voSrc, failureTimeoutMs, createAudio, caf, duckMusicUp]);

  // Attempts to start the VO exactly once. Best-effort: a rejected play()
  // (autoplay-policy or otherwise) is swallowed, same as a load failure --
  // never surfaced, never retried, never affects the music bed.
  const attemptVoStart = useCallback(() => {
    if (voStartedRef.current) return;
    const el = voElRef.current;
    if (!el || !voAvailable) return;
    voStartedRef.current = true;
    const playResult = el.play();
    duckMusicDown();
    ramp(el, voFadeHandleRef, 0, 1, fadeInMs);
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => {
        // Couldn't actually start (autoplay policy, etc.) -- undo the duck,
        // stay silent about it.
        voStartedRef.current = false;
        duckMusicUp();
      });
    }
  }, [voAvailable, duckMusicDown, duckMusicUp, ramp, fadeInMs]);

  // Called by the caller's onBeatChange wiring (see the module docblock)
  // with the clock's current tMs. No-op once started, or if the VO isn't
  // available -- cheap to call every beat change.
  const startVoIfDue = useCallback((tMs) => {
    if (voStartedRef.current || !voAvailable) return;
    if (typeof tMs === 'number' && tMs >= voStartMs) attemptVoStart();
  }, [voAvailable, voStartMs, attemptVoStart]);

  // `start()` MUST be invoked synchronously inside the user's tap handler --
  // anything async ahead of `el.play()` loses the gesture (§6.3). Starts
  // the music bed, and also starts the VO immediately if `voStartMs <= 0`
  // (the common case) so it rides the same gesture rather than depending on
  // the browser continuing to allow programmatic play() later.
  const start = useCallback(() => {
    const el = musicElRef.current;
    if (!el || unavailable) return false;
    const playResult = el.play();
    ramp(el, musicFadeHandleRef, 0, musicRestingVolume(), fadeInMs);
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => setUnavailable(true));
    }
    // When voStartMs <= 0, startVoIfDue -> attemptVoStart -> duckMusicDown
    // fires on the very next line and ramps the SAME `musicFadeHandleRef`
    // as the fade-in just above -- the duck-down cancels/replaces the
    // fade-in before it reaches full volume, so the music goes straight to
    // the ducked level rather than audibly reaching full first, then
    // dipping. That's the intended audible outcome (the VO is about to
    // start immediately, so there's no beat where it should be at full),
    // not a bug in the shared-handle reuse.
    if (voStartMs <= 0) startVoIfDue(0);
    return true;
  }, [unavailable, ramp, musicRestingVolume, fadeInMs, voStartMs, startVoIfDue]);

  const stop = useCallback(() => {
    cancelAllFades();
    musicElRef.current?.pause();
    voElRef.current?.pause();
  }, [cancelAllFades]);

  // 600ms fade-out on outro/close (§6.3), applied to both layers together,
  // resolving once both have hit 0 and are paused.
  const fadeOutAndPause = useCallback((onDone) => {
    const musicEl = musicElRef.current;
    const voEl = voElRef.current;
    let pending = 0;
    const done = () => { pending -= 1; if (pending <= 0) onDone?.(); };

    if (musicEl) {
      pending += 1;
      ramp(musicEl, musicFadeHandleRef, musicEl.volume, 0, fadeOutMs, () => { musicEl.pause(); done(); });
    }
    if (voEl && !voEl.paused) {
      pending += 1;
      ramp(voEl, voFadeHandleRef, voEl.volume, 0, fadeOutMs, () => { voEl.pause(); done(); });
    }
    if (pending === 0) onDone?.();
  }, [ramp, fadeOutMs]);

  // One mute control for both layers together (amendment point 6).
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      writeMutedPref(next);
      if (musicElRef.current) musicElRef.current.volume = next ? 0 : musicRestingVolume();
      if (voElRef.current && voStartedRef.current) voElRef.current.volume = next ? 0 : 1;
      return next;
    });
  }, [musicRestingVolume]);

  // Drift correction keys off the music element only (amendment point 5) --
  // the VO is fire-and-forget and never consulted here.
  const getCurrentTimeMs = useCallback(() => {
    const el = musicElRef.current;
    if (!el || unavailable) return null;
    const t = el.currentTime;
    return Number.isFinite(t) ? t * 1000 : null;
  }, [unavailable]);

  const isPlaying = useCallback(() => {
    const el = musicElRef.current;
    return !!el && !el.paused;
  }, []);

  return {
    ready,
    unavailable,
    voAvailable,
    muted,
    toggleMute,
    start,
    stop,
    fadeOutAndPause,
    getCurrentTimeMs,
    isPlaying,
    startVoIfDue,
  };
}
