// Package C. Renders the active beat's typographic content plus the
// outgoing beat's media crossfade layer (technical spec §3 file layout,
// §6.4 crossfade contract).
//
// Two concerns are deliberately kept separate here, per the creative spec's
// own reconciliation of "hard cuts" (§3 transition rule, §4 cut rhythm) with
// the technical spec's media crossfade (§6.4, and §7's "crossfades survive
// as opacity-only"): the FOREGROUND content (typography/layout) hard-cuts --
// each beat's component remounts fresh (`key={beat.id}`) the instant the
// wipe bar passes centre, exactly as the creative brief specifies -- while
// the BACKGROUND photograph crossfades underneath it so a new full-bleed
// image doesn't hard-pop distractingly mid Ken-Burns pan. The wipe bar itself
// is the visible "hard cut" signature; the media fade happens mostly hidden
// behind it.
//
// Perf budget (technical spec §5.3): at most two <img> elements mounted at
// once -- enforced below by capping the layer stack at 2 on every push.
import { useEffect, useRef, useState } from 'react';
import { BEAT_KINDS } from './buildBeats.js';
import BeatTitle from './beats/BeatTitle.jsx';
import BeatMeta from './beats/BeatMeta.jsx';
import BeatStop from './beats/BeatStop.jsx';
import BeatSecret from './beats/BeatSecret.jsx';
import BeatLegacy from './beats/BeatLegacy.jsx';
import BeatRoster from './beats/BeatRoster.jsx';
import BeatOutro from './beats/BeatOutro.jsx';

// `BEAT_KINDS.COUNTDOWN` has no entry here on purpose (visual QA fix,
// 2026-08-20): `buildBeats.js` no longer emits a standalone COUNTDOWN beat
// -- the countdown is folded into META's own data, rendered by
// `BeatMeta.jsx`. `beats/BeatCountdown.jsx` is left in the tree, unwired,
// in case the standalone beat comes back (see its own docblock).
const BEAT_COMPONENTS = {
  [BEAT_KINDS.TITLE]: BeatTitle,
  [BEAT_KINDS.META]: BeatMeta,
  [BEAT_KINDS.STOP]: BeatStop,
  [BEAT_KINDS.SECRET]: BeatSecret,
  [BEAT_KINDS.LEGACY]: BeatLegacy,
  [BEAT_KINDS.ROSTER]: BeatRoster,
  [BEAT_KINDS.OUTRO]: BeatOutro,
};

// Beats never carry a media URL that shouldn't be Ken-Burns'd EXCEPT the
// secret tease, which the creative brief holds deliberately still (§6:
// "everything else moves, this holds still"). SECRET never has `beat.media`
// in the first place (buildBeats.js's leak-invariant -- see its own
// docblock), so this only ever matters for its CSS gradient fallback layer.
const NO_KEN_BURNS_KINDS = new Set([BEAT_KINDS.SECRET]);

const CROSSFADE_MS = 560; // backstop slightly past the CSS's 500ms transition
const CROSSFADE_MS_RM = 260; // backstop past the reduced-motion 200ms transition

export default function TrailerStage({ beat, index, reducedMotion, isMultiDay, onReplay, onRsvp }) {
  const mediaUrl = beat?.media || '';
  const [layers, setLayers] = useState(() => [{ url: mediaUrl, key: 0 }]);
  const nextKeyRef = useRef(1);
  const prevUrlRef = useRef(mediaUrl);
  const timeoutRef = useRef(null);

  useEffect(() => {
    const url = beat?.media || '';
    if (url === prevUrlRef.current) return undefined;
    prevUrlRef.current = url;
    const key = nextKeyRef.current++;
    // Cap at 2 layers at all times (perf budget: at most two <img>s mounted).
    setLayers((prev) => [...prev, { url, key }].slice(-2));
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setLayers((prev) => prev.slice(-1));
    }, reducedMotion ? CROSSFADE_MS_RM : CROSSFADE_MS);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed off beat.media only; reducedMotion read fresh each run intentionally.
  }, [beat?.media]);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  if (!beat) return null;

  const BeatComponent = BEAT_COMPONENTS[beat.kind] || null;
  const kenBurns = !reducedMotion && !NO_KEN_BURNS_KINDS.has(beat.kind);
  const kenBurnsVariant = index % 2 === 0 ? 'zoom' : 'pan';

  return (
    <div className="tr-stage">
      <div className="tr-stage-media">
        {layers.map((layer, i) => {
          const isFront = i === layers.length - 1;
          return (
            <div key={layer.key} className={`tr-media-layer${isFront ? ' tr-media-front' : ''}`}>
              {layer.url ? (
                <img
                  src={layer.url}
                  alt=""
                  decoding="async"
                  loading="eager"
                  // React 18.3 doesn't recognise the camelCase `fetchPriority`
                  // prop (that mapping landed in React 19) -- confirmed
                  // empirically against this repo's installed react-dom
                  // 18.3.1 via renderToStaticMarkup: camelCase logs "React
                  // does not recognize the `fetchPriority` prop... spell it
                  // as lowercase `fetchpriority` instead" on every render AND
                  // emits a non-standard `fetchPriority="high"` DOM
                  // attribute; lowercase `fetchpriority` renders silently and
                  // correctly. `eslint-plugin-react`'s `no-unknown-property`
                  // rule recommends the camelCase spelling -- that rule is
                  // built against React 19's attribute list and is simply
                  // wrong for the React version this app is actually on.
                  // eslint-disable-next-line react/no-unknown-property -- see above; the rule's advice is for React 19, not this app's React 18.3.1.
                  fetchpriority={isFront ? 'high' : undefined}
                  className={kenBurns ? `tr-kenburns-${kenBurnsVariant}` : undefined}
                  style={kenBurns ? { animationDuration: `${Math.max(beat.durationMs, 400)}ms` } : undefined}
                />
              ) : (
                <div
                  className={`tr-media-fallback${kenBurns ? ` tr-kenburns-${kenBurnsVariant}` : ''}`}
                  style={kenBurns ? { animationDuration: `${Math.max(beat.durationMs, 400)}ms` } : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="tr-scrim" />
      <div className="tr-vignette" />
      <div className="tr-grain" />
      {BeatComponent && (
        <BeatComponent
          key={beat.id}
          data={beat.data}
          durationMs={beat.durationMs}
          hasMedia={!!beat.media}
          isMultiDay={isMultiDay}
          reducedMotion={reducedMotion}
          onReplay={onReplay}
          onRsvp={onRsvp}
        />
      )}
    </div>
  );
}
