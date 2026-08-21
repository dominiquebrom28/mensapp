// Fullscreen shell for the event trailer. Owner direction change,
// 2026-08-21: the generated beat sequence (rAF clock, dual-layer audio,
// eight beat components) is gone -- the owner shipped a real video. This
// now does two things: (1) plays that video, fullscreen-capable, with
// native `<video controls>` -- no hand-rolled scrubber; (2) on the video
// ending, shows a single end-card view (never a further sequence) with the
// lads who've RSVP'd, the kretjes counter, and both CTAs, all at once.
//
// docs/trailer-creative-spec.md and docs/trailer-technical-spec.md describe
// the old generated-trailer engine and are now largely superseded -- kept
// only for the parts that still apply (the fullscreen-shell pattern
// borrowed from `PresentationMode`, the body-scroll lock, focus/keyboard
// basics, reduced-motion handling for the end card specifically).
//
// Prop surface (unchanged from the original spec): `input` (the
// App.jsx-adapter's redacted/formatted view model) and `onClose`. No
// Supabase, no navigation callback, no currentUser -- see BeatOutro.jsx's
// own docblock for the one place that constrains the RSVP CTA's copy.
import { useCallback, useEffect, useRef, useState } from 'react';
import { markTrailerSeen } from './seen.js';
import { ROSTER_MAX_NAMED } from './constants.js';
import TrailerStyles from './TrailerStyles.jsx';
import BeatRoster, { EmptyRoster } from './beats/BeatRoster.jsx';
import BeatOutro from './beats/BeatOutro.jsx';

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

  // No safe video URL at all (shouldn't happen -- the entry point on the
  // event page only shows "Watch the trailer" once `trailer_video_url` is
  // set and validated -- but defensive: never strand the viewer on a black
  // screen if it does). Lazy initializers so there's no visible flash of a
  // video player before immediately swapping to the end card.
  const [ended, setEnded] = useState(() => !hasVideo);
  const [videoError, setVideoError] = useState(() => !hasVideo);

  const videoRef = useRef(null);
  const endCardRef = useRef(null);

  // Body scroll lock (PresentationMode lacks this, the trailer adds it) --
  // restore the exact previous inline value on unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const handleEnded = useCallback(() => {
    if (input?.eventId) markTrailerSeen(input.eventId);
    setEnded(true);
  }, [input]);

  // Broken/unreachable video: surface a clear message and still show the
  // end card rather than leaving the viewer on a dead black frame with
  // controls that do nothing.
  const handleError = useCallback(() => {
    setVideoError(true);
    setEnded(true);
  }, []);

  const handleClose = useCallback(() => { onClose?.(); }, [onClose]);

  // The <video> element is mounted for the component's whole lifetime
  // (never unmounted between "playing" and "ended") specifically so this
  // handler always has a live ref to call `.play()` on -- a direct
  // synchronous call inside a click handler is the one thing every browser
  // reliably honours as a user gesture for audio.
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
      el.play().catch(() => {}); // best-effort -- native controls are the fallback either way
      el.focus();
    }
    setVideoError(false);
    setEnded(false);
  }, [hasVideo, videoError]);

  const handleRsvp = useCallback(() => { onClose?.(); }, [onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  // Move focus into the end card when it appears, so keyboard/AT users land
  // somewhere sensible rather than on a now-hidden <video>.
  useEffect(() => {
    if (ended) endCardRef.current?.focus();
  }, [ended]);

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

      {/* Always mounted (never unmounted between "playing" and "ended") so
          `videoRef` stays valid for Replay -- just visually hidden behind
          the end card, which is fully opaque, when `ended` is true. */}
      <div className="tr-video-wrap" style={ended ? { display: 'none' } : undefined} aria-hidden={ended || undefined}>
        <video
          ref={videoRef}
          src={hasVideo ? input.videoUrl : undefined}
          controls
          playsInline
          autoFocus={!ended}
          tabIndex={ended ? -1 : 0}
          aria-label={input?.name ? `${input.name} trailer video` : 'Event trailer video'}
          onEnded={handleEnded}
          onError={handleError}
        />
      </div>

      {ended && (
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
        {ended
          ? (videoError
            ? "Couldn't play the trailer video. Here's the roll call and RSVP options instead."
            : 'Trailer ended. Roll call and RSVP options below.')
          : ''}
      </div>
    </div>
  );
}
