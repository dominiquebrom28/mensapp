// Package E. Fullscreen shell: tap-to-start poster, chrome, controls, close.
// Wires together the already-built engine layer (buildBeats/timeline/
// useTrailerClock/useMediaPreloader/useTrailerAudio/seen) with package C's
// visuals (TrailerStyles/TrailerStage/beats). See
// docs/trailer-technical-spec.md §3-§7 for the contract this follows.
//
// Prop surface is deliberately minimal (technical spec §10): `input`
// (TrailerInput, already redacted/formatted by the App.jsx adapter) and
// `onClose`. No Supabase, no navigation callback, no currentUser -- see
// BeatOutro.jsx's docblock for the one place that constrains the CTA copy.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildBeats, BEAT_KINDS } from './buildBeats.js';
import { buildTimeline } from './timeline.js';
import { useTrailerClock } from './useTrailerClock.js';
import { useMediaPreloader } from './useMediaPreloader.js';
import { useTrailerAudio } from './useTrailerAudio.js';
import { markTrailerSeen } from './seen.js';
import { isSafeImageUrl } from './safeUrl.js';
import { AUDIO_DRIFT_THRESHOLD_MS } from './constants.js';
import TrailerStyles from './TrailerStyles.jsx';
import TrailerStage from './TrailerStage.jsx';

const IDLE_MS = 2000;
const WIPE_MS = 200;
const WIPE_MS_RM = 60;

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

// Save-data / slow-connection detection (technical spec §6.2) -- read once;
// a live `navigator.connection` change listener would be a re-render source
// this feature doesn't need.
function isSaveData() {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null;
  return !!c && (c.saveData === true || ['slow-2g', '2g'].includes(c.effectiveType));
}

function announceFor(beat) {
  if (!beat) return '';
  const d = beat.data || {};
  switch (beat.kind) {
    case BEAT_KINDS.TITLE: return 'MENSDAY';
    // `d.daysToGo` is folded onto META's own data now (buildBeats.js no
    // longer emits a standalone COUNTDOWN beat) -- announced as part of the
    // same beat rather than a separate one. The `COUNTDOWN` case below is
    // unreachable today but left in place alongside `BEAT_KINDS.COUNTDOWN`
    // itself (kept defined, unused) in case the standalone beat returns.
    case BEAT_KINDS.META: return [d.dateLabel, d.location, typeof d.daysToGo === 'number' ? `${d.daysToGo} days to go` : ''].filter(Boolean).join(' — ');
    case BEAT_KINDS.COUNTDOWN: return `${d.daysToGo} days to go`;
    case BEAT_KINDS.STOP: return d.activity || '';
    case BEAT_KINDS.SECRET: return "Something we're not telling you";
    case BEAT_KINDS.LEGACY: return d.name ? `Reigning champion: ${d.name}` : '';
    case BEAT_KINDS.ROSTER: return `${d.goingCount ?? 0} confirmed going`;
    case BEAT_KINDS.OUTRO: return [d.name, d.dateLabel].filter(Boolean).join(' — ');
    default: return '';
  }
}

export default function EventTrailer({ input, onClose }) {
  const reducedMotion = usePrefersReducedMotion();
  const saveData = useMemo(() => isSaveData(), []);
  // Fixed at mount, not re-read per render: this is "when did the viewer
  // start watching", not "when did the parent last re-render" -- a
  // COUNTDOWN day-count shouldn't jitter because someone RSVP'd elsewhere
  // while the trailer is open.
  const [nowMs] = useState(() => Date.now());
  const isMultiDay = (input?.dayCount ?? 1) > 1;

  // The App.jsx call site builds `input` inline (`toTrailerInput(evt,
  // users, events)`) on every EventPage render, per the technical spec's
  // literal §3 delta -- so a fresh object identity arrives here on every
  // unrelated realtime sync of the event row while the trailer is open
  // (RSVPs, admin edits, etc.), even when nothing the trailer actually
  // reads has changed. Re-deriving `beats`/`timeline` from a bare `[input]`
  // dependency would rebuild the timeline (and could shift beat boundaries
  // mid-playback -- e.g. a live RSVP changing ROSTER's duration formula)
  // purely from that churn. `inputKey` turns that into real value-based
  // memoization: primitive strings compare by value, so downstream memos
  // only actually recompute when the data they depend on truly changed.
  const inputKey = useMemo(() => JSON.stringify(input), [input]);

  const beats = useMemo(
    () => buildBeats(input, { reducedMotion, saveData, nowMs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `inputKey` is the intentional, value-based proxy for `input` (see comment above); `input` itself is read fresh inside the memo callback only when inputKey actually changes.
    [inputKey, reducedMotion, saveData, nowMs],
  );
  const timeline = useMemo(() => buildTimeline(beats), [beats]);
  const mediaUrls = useMemo(() => beats.map((b) => b.media || ''), [beats]);

  const posterImage = useMemo(() => {
    if (saveData) return '';
    const stop = (input?.stops || []).find((s) => !s.secret && isSafeImageUrl(s.image));
    return stop ? stop.image : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see `beats`' inputKey comment above.
  }, [inputKey, saveData]);

  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Body scroll lock (technical spec §4: PresentationMode lacks this, the
  // trailer adds it) -- restore the exact previous inline value on unmount.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const preloader = useMediaPreloader(mediaUrls, { enabled: !saveData });
  const audio = useTrailerAudio();

  const clockRef = useRef(null);
  const skipNextWipeRef = useRef(true);
  const [wipeVisible, setWipeVisible] = useState(false);
  const wipeTimeoutRef = useRef(null);

  const handleEnd = useCallback(() => {
    if (input?.eventId) markTrailerSeen(input.eventId);
  }, [input]);

  // Audio<->clock glue (see useTrailerAudio.js's own docblock for the
  // intended wiring): drift correction keys off the music bed only and is
  // one-way (audio -> clock.nudgeTo), never the reverse (technical spec
  // §6.3). `clockRef` sidesteps the chicken/egg of `useTrailerClock` itself
  // needing this callback before it can return the very `tRef` the callback
  // reads -- safe because `onBeatChange` is only ever invoked from a later
  // rAF frame, never synchronously during this render.
  const handleBeatChange = useCallback((index) => {
    preloader.ensureFrom(index);
    const c = clockRef.current;
    const tMs = c ? c.tRef.current : 0;
    audio.startVoIfDue(tMs);
    if (c && audio.isPlaying()) {
      const musicMs = audio.getCurrentTimeMs();
      if (musicMs != null && Math.abs(musicMs - tMs) > AUDIO_DRIFT_THRESHOLD_MS) {
        c.nudgeTo(musicMs);
      }
    }
    if (skipNextWipeRef.current) {
      skipNextWipeRef.current = false;
    } else {
      setWipeVisible(true);
      clearTimeout(wipeTimeoutRef.current);
      wipeTimeoutRef.current = setTimeout(() => setWipeVisible(false), reducedMotion ? WIPE_MS_RM : WIPE_MS);
    }
  }, [preloader, audio, reducedMotion]);

  const clock = useTrailerClock({ timeline, onBeatChange: handleBeatChange, onEnd: handleEnd });
  clockRef.current = clock;

  useEffect(() => () => clearTimeout(wipeTimeoutRef.current), []);

  const handleStart = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
    // Synchronous, inside the tap handler -- must not follow an `await`
    // (technical spec §6.3) or the gesture is lost.
    audio.start();
    const el = typeof document !== 'undefined' ? document.documentElement : null;
    if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    preloader.preflight().then(() => {
      if (mountedRef.current) clockRef.current?.play();
    });
  }, [audio, preloader]);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // FLAGGED ENGINE GAP: the technical spec's own control table (§5.4) says
  // Replay should do `restart() + audio currentTime = 0`, but
  // `useTrailerAudio` (fixed, package D/already built) exposes no seek/
  // currentTime setter on its two <audio> elements -- only start/stop. The
  // visual timeline restarts exactly on cue; the audio bed is a best-effort
  // stop+start, which resumes playback rather than guaranteeing a sample-
  // accurate restart from 0. See the trailer report for the full callout.
  const handleReplay = useCallback(() => {
    skipNextWipeRef.current = true;
    clockRef.current?.restart();
    audio.stop();
    audio.start();
  }, [audio]);

  const handleRsvp = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // Idle-fade chrome (creative spec §2): fades 2s after the last
  // tap/pointer move, reappears on interaction, and stays permanently
  // visible once the trailer holds on its closing frame (`state==='ended'`).
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimerRef = useRef(null);
  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    clearTimeout(idleTimerRef.current);
    if (clockRef.current?.state === 'playing') {
      idleTimerRef.current = setTimeout(() => setChromeVisible(false), IDLE_MS);
    }
  }, []);
  useEffect(() => {
    bumpChrome();
    return () => clearTimeout(idleTimerRef.current);
  }, [bumpChrome, clock.state]);

  const goNext = useCallback(() => {
    const c = clockRef.current;
    if (!c) return;
    const seg = timeline.segments[c.index];
    if (!seg) return;
    c.seek(seg.endMs);
    bumpChrome();
  }, [timeline, bumpChrome]);

  const goPrev = useCallback(() => {
    const c = clockRef.current;
    if (!c) return;
    const seg = timeline.segments[c.index];
    if (!seg) return;
    const withinBeat = c.tRef.current - seg.startMs;
    if (withinBeat > 1000) {
      c.seek(seg.startMs);
    } else {
      const prevSeg = timeline.segments[c.index - 1];
      c.seek(prevSeg ? prevSeg.startMs : 0);
    }
    bumpChrome();
  }, [timeline, bumpChrome]);

  // FLAGGED SPEC CONFLICT, resolved rather than silently picked: technical
  // spec §5.4's control table says "Tap/click the stage: toggle() pause/
  // resume" and explicitly rules out next/prev ("No scrubbing, no
  // next/prev -- that's PresentationMode's job"). Creative spec §2 says the
  // opposite for the same gesture: "tap right half = skip to next beat; tap
  // left half = replay current/previous beat," explicitly the Instagram/
  // Snapchat Stories convention, and mobile is stated as the primary
  // canvas. I followed the creative spec (`goNext`/`goPrev` below, wired to
  // `.tr-tapzone-left`/`.tr-tapzone-right`) -- that's what anyone opening an
  // autoplaying vertical video expects a tap to do, and the technical
  // spec's own table is the more generic of the two documents here.
  //
  // The real cost of that choice: the technical spec's pause/resume gesture
  // disappears, and until this fix the ONLY way to pause was the spacebar
  // (`handleTogglePlay` below) -- which doesn't exist on the phone this
  // feature is built for. Resolved properly, not by re-picking a spec: the
  // chrome gets its own always-visible ⏸/▶ control (below, next to mute),
  // same 44px target, same idle-fade behaviour as the rest of the top bar.
  // That keeps the Stories tap zones from the creative spec AND keeps pause
  // genuinely reachable on a touchscreen, which is what the technical
  // spec's requirement was actually protecting.
  const handleTogglePlay = useCallback(() => {
    clockRef.current?.toggle();
    bumpChrome();
  }, [bumpChrome]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { handleClose(); return; }
      if (!startedRef.current) return;
      if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); handleTogglePlay(); }
      else if (e.key === 'ArrowRight') { goNext(); }
      else if (e.key === 'ArrowLeft') { goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose, handleTogglePlay, goNext, goPrev]);

  // Progress bar (technical spec §5.3): the active segment's fill is
  // written straight to a CSS custom property via a dedicated rAF loop --
  // never through React state. Segments before/after the active one are
  // set declaratively (cheap; only re-renders on the ~8-12 beat changes).
  const activeSegRef = useRef(null);
  useEffect(() => {
    if (reducedMotion) return undefined;
    if (clock.state !== 'playing') return undefined;
    const el = activeSegRef.current;
    const seg = timeline.segments[clock.index];
    if (!el || !seg) return undefined;
    el.style.setProperty('--tr-progress', '0');
    const dur = Math.max(1, seg.endMs - seg.startMs);
    let handle = null;
    const tick = () => {
      const t = clockRef.current ? clockRef.current.tRef.current : 0;
      const pct = Math.max(0, Math.min(1, (t - seg.startMs) / dur));
      el.style.setProperty('--tr-progress', String(pct));
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { if (handle != null) cancelAnimationFrame(handle); };
  }, [clock.index, clock.state, reducedMotion, timeline]);

  const activeBeat = beats[clock.index] ?? null;

  return (
    <div
      className="tr-root"
      role="dialog"
      aria-modal="true"
      aria-label={input?.name ? `${input.name} trailer` : 'Event trailer'}
      data-tr-rm={reducedMotion ? '1' : undefined}
      onPointerMove={bumpChrome}
      onClick={bumpChrome}
    >
      <TrailerStyles />

      <button
        type="button"
        className="tr-icon-btn"
        aria-label="Skip trailer"
        onClick={handleClose}
        style={{ position: 'absolute', top: 'calc(3.2vh + .9rem)', right: '1.1rem', zIndex: 56 }}
      >
        ✕
      </button>

      {!started ? (
        <div className="tr-poster">
          <div className="tr-stage-media" aria-hidden="true">
            {posterImage
              ? <img src={posterImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div className="tr-media-fallback" style={{ position: 'absolute', inset: 0 }} />}
          </div>
          <div className="tr-scrim" />
          <div className="tr-vignette" />
          <div className="tr-poster-card">
            <div className="tr-kicker">🎬 Event trailer</div>
            <h1 className="tr-title" style={{ fontSize: 'clamp(1.8rem,7vw,3.2rem)' }}>{input?.name}</h1>
            {input?.dateLabel && <div className="tr-sub">{input.dateLabel}</div>}
            <button
              type="button"
              className="tr-cta tr-cta-gold"
              style={{ fontSize: '1rem', padding: '15px 34px', marginTop: '.6rem' }}
              onClick={handleStart}
              autoFocus
            >
              ▶ Play Trailer
            </button>
          </div>
        </div>
      ) : (
        <>
          <TrailerStage
            beat={activeBeat}
            index={clock.index}
            reducedMotion={reducedMotion}
            isMultiDay={isMultiDay}
            onReplay={handleReplay}
            onRsvp={handleRsvp}
          />

          {wipeVisible && <div className="tr-wipe" />}

          <button type="button" className="tr-tapzone tr-tapzone-left" aria-label="Previous beat" onClick={goPrev} />
          <button type="button" className="tr-tapzone tr-tapzone-right" aria-label="Next beat" onClick={goNext} />

          <div className={`tr-chrome-top tr-chrome-fade${chromeVisible ? '' : ' tr-chrome-hidden'}`}>
            <div className="tr-eyebrow">{input?.name}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {clock.state !== 'ended' && (
                <button
                  type="button"
                  className="tr-icon-btn"
                  aria-label={clock.state === 'playing' ? 'Pause' : 'Play'}
                  onClick={handleTogglePlay}
                >
                  {clock.state === 'playing' ? '⏸' : '▶'}
                </button>
              )}
              {!audio.unavailable && (
                <button type="button" className="tr-icon-btn" aria-label={audio.muted ? 'Unmute' : 'Mute'} onClick={audio.toggleMute}>
                  {audio.muted ? '🔇' : '🔊'}
                </button>
              )}
            </div>
          </div>

          {reducedMotion ? (
            <div className="tr-seg-counter">{Math.max(clock.index, 0) + 1} / {timeline.segments.length}</div>
          ) : (
            <div className="tr-chrome-bottom">
              {timeline.segments.map((seg, i) => (
                <div key={seg.beat.id} className="tr-seg-track">
                  <div
                    className="tr-seg-fill"
                    ref={i === clock.index ? activeSegRef : undefined}
                    style={i < clock.index ? { transform: 'scaleX(1)' } : i > clock.index ? { transform: 'scaleX(0)' } : undefined}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="tr-letterbox tr-letterbox-top" />
      <div className="tr-letterbox tr-letterbox-bottom" />

      <div aria-live="polite" className="tr-sr-only">{started ? announceFor(activeBeat) : ''}</div>
    </div>
  );
}
