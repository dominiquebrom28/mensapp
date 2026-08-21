// Fullscreen shell for the event trailer. Owner direction change,
// 2026-08-21: the generated beat sequence (rAF clock, dual-layer audio,
// eight beat components) is gone -- the owner shipped a real video. This
// now does three things: (1) a 3-2-1 countdown, then autoplay -- no
// tap-to-play any more (2026-08-21b amendment); (2) plays that video,
// fullscreen-capable, with native `<video controls>` -- no hand-rolled
// scrubber; (3) on the video ending, shows a single end-card view (never a
// further sequence) with the lads who've RSVP'd, the kretjes counter, and
// both CTAs, all at once.
//
// docs/trailer-creative-spec.md and docs/trailer-technical-spec.md describe
// the old generated-trailer engine and are now largely superseded -- kept
// only for the parts that still apply (the fullscreen-shell pattern
// borrowed from `PresentationMode`, the body-scroll lock, focus/keyboard
// basics, reduced-motion handling for the end card specifically).
//
// AUTOPLAY-POLICY TRAP (2026-08-21b), read before touching this file: the
// countdown means `video.play()` fires ~3s *after* the "Watch the trailer"
// tap that opened this component -- long enough that some browsers (Safari/
// iOS in particular) may no longer treat it as tied to that user gesture,
// and will silently refuse to play (never mind with sound). Two-part
// mitigation:
//  1. The "bless the element" effect below fires a `play()` -> `pause()` ->
//     `currentTime = 0` round-trip on mount, while the opening tap's
//     activation is still fresh. This "blesses" the <video> element in
//     browsers that track per-element activation state, so the *real*
//     `play()` after the countdown is resuming an already-unlocked element
//     rather than cold-starting one.
//  2. If the real `play()` call still rejects, we do NOT sit on a frozen
//     countdown and we do NOT mute to force autoplay (muting would defeat
//     the entire point -- the owner's video has real audio). Instead
//     `needsManualPlay` renders a large, obvious play button; the tap that
//     hits it is a fresh, direct gesture, so it reliably succeeds.
//
// POSTMORTEM -- "the video keeps starting over" (2026-08-21c): the unlock
// attempt's `play()` does not resolve promptly with a real file on a real
// connection; it can stay pending for seconds while the video buffers. That
// meant: mount -> unlock play() (pending, buffering) -> countdown runs its
// 3s -> startPlayback()'s play() actually starts real playback -> the
// *original* unlock promise finally resolves -> its `.then()` fired
// `pause()` + `currentTime = 0` on a video the viewer was already
// watching, restarting it from 0 (and could repeat, or interleave with
// Replay). Invisible in tests because a mocked play() resolves instantly,
// so the unlock always completed long before the countdown ended --
// `src/test/mocks/mediaEnv.js`'s `defer` mode exists specifically so a test
// can reproduce this ordering. Fix: `realPlaybackAttemptedRef` is a one-way
// latch set the moment ANY real (non-unlock) play() attempt begins --
// post-countdown, a skip, Replay, or the manual-play fallback, all funnel
// through `playAndTrack` below. The unlock's `.then()` checks it and is a
// complete no-op once set, no matter how late it resolves. Once real
// playback has been attempted, the unlock's job is permanently moot -- there
// is nothing left for a "stale" unlock resolution to usefully do.
//
// Prop surface (unchanged from the original spec): `input` (the
// App.jsx-adapter's redacted/formatted view model) and `onClose`. No
// Supabase, no navigation callback, no currentUser -- see BeatOutro.jsx's
// own docblock for the one place that constrains the RSVP CTA's copy.
//
// FULLSCREEN TRAP (2026-08-21f, owner-reported): there is no fullscreen
// handling of our own anywhere in this file -- the only fullscreen comes
// from native `<video controls>`'s own fullscreen button, which puts THE
// <video> ELEMENT ITSELF into fullscreen, not our `.tr-root` container.
// While an element is fullscreened, the browser composites only that
// element and its descendants; `.tr-endcard` is a *sibling* of `<video>` in
// the DOM (see the render below), so once the video ends while still
// fullscreened, the end card renders into a subtree nobody can see -- the
// viewer is stuck on the last frame or native player chrome, Watch again/
// RSVP unreachable. Fix: `exitVideoFullscreenIfActive` leaves native
// fullscreen the instant the video ends OR errors, before the end card
// needs to be visible. `.tr-root` is already `position:fixed;inset:0`, so
// exiting still reads as fullscreen to the viewer -- no jarring shrink.
// Two unrelated APIs, easily confused by name:
//  - Standard: `document.exitFullscreen()`, only when `document.
//    fullscreenElement` (or the older `webkitFullscreenElement`) is
//    actually OUR video -- never yanks the viewer out of some unrelated
//    fullscreen element.
//  - iOS Safari does NOT use the Fullscreen API for video at all -- it's
//    the native player, via a *video-element* method,
//    `video.webkitExitFullscreen()`, guarded on `video.
//    webkitDisplayingFullscreen`. iOS also often auto-exits fullscreen on
//    its own the instant the video ends, firing `webkitendfullscreen` --
//    our guard means calling `webkitExitFullscreen()` again after that is
//    a safe no-op, never a double-exit or a throw.
// Every one of these APIs can be absent, throw synchronously, or return a
// rejecting promise -- `exitVideoFullscreenIfActive` wraps all of it so a
// failed exit can never block the end card from appearing (degrading to
// "end card shows, maybe still fullscreen" is fine; "nothing happens at
// all" -- the original bug -- is not). Replay is deliberately NOT touched
// by any of this: it doesn't try to restore fullscreen, the viewer can hit
// the native fullscreen button again if they want it back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { markTrailerSeen } from './seen.js';
import { ROSTER_MAX_NAMED, COUNTDOWN_SECONDS } from './constants.js';
import TrailerStyles from './TrailerStyles.jsx';
import BeatRoster, { EmptyRoster } from './beats/BeatRoster.jsx';
import BeatOutro from './beats/BeatOutro.jsx';

// See the module docblock's "FULLSCREEN TRAP" note. Module-scope (not a
// hook) -- it's a plain, stateless DOM-API call, nothing here needs to be
// React-aware.
function exitVideoFullscreenIfActive(video) {
  if (!video) return;
  // iOS Safari's native fullscreen player -- a video-element method,
  // distinct from (and easily confused with) document.webkitExitFullscreen
  // below. Guarded so this is a no-op if iOS has already auto-exited on its
  // own by the time we get here (it often does, right as the video ends).
  try {
    if (video.webkitDisplayingFullscreen && typeof video.webkitExitFullscreen === 'function') {
      video.webkitExitFullscreen();
    }
  } catch {
    // Defensive -- a failed iOS exit must never block the end card.
  }
  // Standard Fullscreen API (+ older desktop Safari/Chrome's document-level
  // webkit-prefixed equivalent). Only acts if OUR video is the thing
  // actually fullscreened right now -- never yanks the viewer out of some
  // unrelated fullscreen element.
  try {
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsElement !== video) return;
    const exit = document.exitFullscreen
      ? () => document.exitFullscreen()
      : document.webkitExitFullscreen
        ? () => document.webkitExitFullscreen()
        : null;
    const result = exit?.();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        // Defensive -- a rejected exitFullscreen() (e.g. called outside a
        // user-gesture context, which some browsers enforce) must never
        // block the end card either.
      });
    }
  } catch {
    // Defensive, same reasoning -- some browsers throw synchronously
    // instead of rejecting.
  }
}

function usePrefersReducedMotion() {
  const getMatch = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false);
  const [reduced, setReduced] = useState(getMatch);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

export default function EventTrailer({ input, onClose }) {
  const reducedMotion = usePrefersReducedMotion();
  const hasVideo = !!input?.videoUrl;

  // Phase machine: 'countdown' -> 'playing' -> 'ended'. No safe video URL at
  // all (shouldn't happen -- the entry point on the event page only shows
  // "Watch the trailer" once `trailer_video_url` is set and validated --
  // but defensive: never strand the viewer on a black screen if it does)
  // skips straight to 'ended' with the same "couldn't play" messaging.
  // Lazy initializers so there's no visible flash of the wrong phase.
  const [phase, setPhase] = useState(() => (hasVideo ? 'countdown' : 'ended'));
  const [count, setCount] = useState(COUNTDOWN_SECONDS);
  const [videoError, setVideoError] = useState(() => !hasVideo);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);

  const videoRef = useRef(null);
  const endCardRef = useRef(null);
  const countdownRef = useRef(null);
  const manualPlayRef = useRef(null);
  // One-way latch: has any REAL (non-unlock) play() attempt begun yet? See
  // the module docblock's "keeps starting over" postmortem -- set inside
  // `playAndTrack` below, checked by the unlock effect's `.then()`.
  const realPlaybackAttemptedRef = useRef(false);

  // Body scroll lock (PresentationMode lacks this, the trailer adds it) --
  // restore the exact previous inline value on unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  // Mitigation part 1 (see module docblock): bless the element once, on
  // mount, while the opening tap's gesture is still fresh. Deliberately NOT
  // gated on `phase` -- this must fire immediately, not after the countdown.
  useEffect(() => {
    if (!hasVideo) return;
    const el = videoRef.current;
    if (!el) return;
    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        // A real play() attempt may have already started by the time this
        // (possibly long-buffering) unlock promise finally resolves --
        // pausing/resetting now would stop a video the viewer is actually
        // watching. See the module docblock's postmortem.
        if (realPlaybackAttemptedRef.current) return;
        el.pause();
        el.currentTime = 0;
      }).catch(() => {
        // Unlock attempt itself was refused -- the real post-countdown
        // play() will very likely fail too; `needsManualPlay` covers that.
      });
    }
  }, [hasVideo]);

  // Depends on the stable `eventId` primitive, not the whole `input` object
  // -- `input` is a fresh object identity on every realtime sync of the
  // event row (App.jsx's adapter re-runs on any `evt`/`users` change), and
  // this callback has no reason to be re-created just because some
  // unrelated field (kretjes, an RSVP) changed elsewhere on the page.
  const eventId = input?.eventId;
  const handleEnded = useCallback(() => {
    // See the module docblock's "FULLSCREEN TRAP" note -- must happen
    // before/alongside the end card becoming the active phase, or it
    // renders invisibly behind native fullscreen chrome.
    exitVideoFullscreenIfActive(videoRef.current);
    if (eventId) markTrailerSeen(eventId);
    setPhase('ended');
  }, [eventId]);

  // Broken/unreachable video: surface a clear message and still show the
  // end card rather than leaving the viewer on a dead black frame with
  // controls that do nothing. Same fullscreen trap applies here -- a video
  // that errors out mid-playback while fullscreened strands the viewer
  // identically to the plain `ended` case.
  const handleError = useCallback(() => {
    exitVideoFullscreenIfActive(videoRef.current);
    setVideoError(true);
    setPhase('ended');
  }, []);

  const handleClose = useCallback(() => { onClose?.(); }, [onClose]);

  // Shared "attempt to play, track whether it actually took" helper --
  // every real play() attempt in this component (post-countdown, Replay,
  // the manual-play fallback tap) goes through this one path so the
  // rejected-promise handling can't drift between call sites, AND so
  // `realPlaybackAttemptedRef` (the unlock race's guard -- see the module
  // docblock) is set from exactly one place, synchronously, the instant any
  // real attempt begins -- not waiting for its promise to settle. Never
  // mutes to force it through -- the audio is the point.
  const playAndTrack = useCallback((el) => {
    realPlaybackAttemptedRef.current = true;
    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(() => setNeedsManualPlay(false)).catch(() => setNeedsManualPlay(true));
    }
  }, []);

  // Mitigation part 2 (see module docblock): the real start, after the
  // countdown (or a skip).
  const startPlayback = useCallback(() => {
    setPhase('playing');
    setNeedsManualPlay(false);
    const el = videoRef.current;
    if (el) playAndTrack(el);
  }, [playAndTrack]);

  // Countdown ticker: a plain 1s-interval chain (a discrete "3, 2, 1" UI
  // beat, not a continuous timeline -- doesn't need the old engine's rAF
  // clock). Skippable (tap or Escape -- see the countdown overlay's own
  // handlers below): calling `startPlayback()` directly changes `phase`
  // away from 'countdown', which lets this effect's own cleanup cancel
  // whatever tick is still pending.
  useEffect(() => {
    if (phase !== 'countdown') return undefined;
    if (count <= 1) {
      const t = setTimeout(startPlayback, 1000);
      countdownRef.current = t;
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    countdownRef.current = t;
    return () => clearTimeout(t);
  }, [phase, count, startPlayback]);

  const handleSkipCountdown = useCallback(() => {
    if (phase !== 'countdown') return;
    clearTimeout(countdownRef.current);
    startPlayback();
  }, [phase, startPlayback]);

  // The <video> element is mounted for the component's whole lifetime
  // (never unmounted between "countdown"/"playing"/"ended") specifically so
  // every handler here always has a live ref to call `.play()` on -- a
  // direct synchronous call inside a click handler is the one thing every
  // browser reliably honours as a user gesture for audio.
  const handleReplay = useCallback(() => {
    if (!hasVideo) return; // nothing to replay -- stay on the end card
    const el = videoRef.current;
    if (el) {
      // `.load()` is only needed to clear a prior fatal error's network
      // state and re-prime the source -- skip it on the plain "watched it
      // through, want to watch again" path, where the element is already
      // healthy and re-loading would just be wasted work (and a needless
      // fresh request for the same URL).
      if (videoError) el.load();
      el.currentTime = 0;
      setVideoError(false);
      setPhase('playing');
      setNeedsManualPlay(false);
      playAndTrack(el);
      el.focus();
    }
  }, [hasVideo, videoError, playAndTrack]);

  // The manual-play fallback's own tap is itself a fresh, direct user
  // gesture -- the one thing every browser reliably honours -- so this
  // reliably succeeds even when the post-countdown attempt didn't.
  const handleManualPlay = useCallback(() => {
    const el = videoRef.current;
    if (el) playAndTrack(el);
  }, [playAndTrack]);

  const handleRsvp = useCallback(() => { onClose?.(); }, [onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  // Focus management: land somewhere sensible on every phase change rather
  // than leaving focus on a now-hidden/removed element.
  useEffect(() => {
    if (phase === 'ended') { endCardRef.current?.focus(); return; }
    if (phase === 'playing') {
      if (needsManualPlay) manualPlayRef.current?.focus();
      else videoRef.current?.focus();
    }
  }, [phase, needsManualPlay]);

  // iOS's native fullscreen player can dismiss itself asynchronously --
  // either from our own `exitVideoFullscreenIfActive` call in handleEnded/
  // handleError, or the OS's own auto-exit right as the video ends (see the
  // module docblock's "FULLSCREEN TRAP" note). By the time it actually
  // finishes, the focus effect above may already have run and tried to
  // focus the end card while it was still hidden behind native fullscreen
  // chrome. Re-run that once the exit has genuinely completed, regardless
  // of which of the two triggered it.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    const onWebkitEndFullscreen = () => {
      if (phase === 'ended') endCardRef.current?.focus();
    };
    el.addEventListener('webkitendfullscreen', onWebkitEndFullscreen);
    return () => el.removeEventListener('webkitendfullscreen', onWebkitEndFullscreen);
  }, [phase]);

  const going = (input?.going || []).slice(0, ROSTER_MAX_NAMED);
  const goingCount = input?.goingCount ?? 0;
  const moreCount = Math.max(0, goingCount - going.length);

  return (
    <div
      className="tr-root"
      role="dialog"
      aria-modal="true"
      aria-label={input?.name ? `${input.name} trailer` : 'Event trailer'}
      data-tr-rm={reducedMotion ? '1' : undefined}
    >
      <TrailerStyles />

      <button
        type="button"
        className="tr-icon-btn"
        aria-label="Close trailer"
        onClick={handleClose}
        style={{ position: 'absolute', top: 'calc(1.1rem + env(safe-area-inset-top,0px))', right: '1.1rem', zIndex: 60 }}
      >
        ✕
      </button>

      {/* Always mounted (never unmounted across phases) so `videoRef` stays
          valid for the unlock effect / Replay / the manual-play fallback --
          just visually hidden behind the countdown or the end card, both
          fully opaque, when they're the active phase. */}
      <div className="tr-video-wrap" style={phase === 'ended' ? { display: 'none' } : undefined} aria-hidden={phase === 'playing' ? undefined : true}>
        <video
          ref={videoRef}
          src={hasVideo ? input.videoUrl : undefined}
          controls
          playsInline
          tabIndex={phase === 'playing' ? 0 : -1}
          aria-label={input?.name ? `${input.name} trailer video` : 'Event trailer video'}
          onEnded={handleEnded}
          onError={handleError}
        />
        {phase === 'playing' && needsManualPlay && (
          <div className="tr-playfallback-wrap">
            <button
              type="button"
              ref={manualPlayRef}
              className="tr-playfallback"
              onClick={handleManualPlay}
              aria-label="Play trailer"
            >
              <span className="tr-playfallback-icon" aria-hidden="true">▶</span>
              <span>Tap to play</span>
            </button>
          </div>
        )}
      </div>

      {phase === 'countdown' && (
        <div
          className="tr-countdown"
          role="button"
          tabIndex={0}
          autoFocus
          aria-label={`Starting in ${count}. Tap or press Enter to skip.`}
          onClick={handleSkipCountdown}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSkipCountdown(); }
          }}
        >
          <div className="tr-countdown-bg" aria-hidden="true" />
          <div className="tr-vignette" aria-hidden="true" />
          <div className="tr-countdown-inner">
            {input?.name && <div className="tr-kicker">🎬 {input.name}</div>}
            <div key={count} className="tr-countdown-num tr-slam" aria-hidden="true">{count}</div>
            <div className="tr-countdown-hint">Tap to skip</div>
          </div>
        </div>
      )}

      {phase === 'ended' && (
        <div className="tr-endcard" ref={endCardRef} tabIndex={-1}>
          <div className="tr-endcard-bg" aria-hidden="true" />
          <div className="tr-vignette" aria-hidden="true" />
          <div className="tr-grain" aria-hidden="true" />
          <div className="tr-endcard-inner">
            {videoError && (
              <div className="tr-error-banner" role="status">
                ⚠ Couldn&apos;t play the trailer video this time — here&apos;s what&apos;s cooking anyway.
              </div>
            )}
            {goingCount > 0
              ? <BeatRoster data={{ going, goingCount, ...(moreCount > 0 ? { moreCount } : {}) }} />
              : <EmptyRoster />}
            <BeatOutro
              data={{ name: input?.name || '', kretjes: input?.kretjes ?? 0 }}
              onReplay={handleReplay}
              onRsvp={handleRsvp}
            />
          </div>
        </div>
      )}

      <div aria-live="polite" className="tr-sr-only">
        {phase === 'countdown' && `Trailer starting in ${count}.`}
        {phase === 'playing' && needsManualPlay && 'Autoplay was blocked. Tap play to start the trailer.'}
        {phase === 'ended' && (videoError
          ? "Couldn't play the trailer video. Here's the roll call and RSVP options instead."
          : 'Trailer ended. Roll call and RSVP options below.')}
      </div>
    </div>
  );
}
