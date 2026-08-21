// The trailer's end-card content: the kretjes counter (with a bit of
// personality, not corporate marketing copy) and the two CTAs. Repurposed
// 2026-08-21 -- the owner shipped a real video, so this is no longer a
// timed "closing beat" in a sequence; it's rendered once, alongside
// BeatRoster, in the single view shown when the video ends
// (docs/trailer-creative-spec.md §2 "End state", direction updated by the
// brief: roster + kretjes + both CTAs, together, one view).
//
// Structural note, same as BeatRoster.jsx: this used to be a full-bleed
// `.tr-content` layer. Now it's a normal-flow section inside
// `EventTrailer.jsx`'s scrollable end-card shell, so it renders just its
// own content.
//
// Data shape shrunk along with `toTrailerInput` (App.jsx): no more
// dateLabel/location/theme -- the adapter no longer carries them (the
// trailer isn't building a schedule montage or a closing "poster frame"
// bookended on a hero image any more, it's showing a real video).
//
// `onRsvp` closes the trailer (EventTrailer's own `onClose`) rather than
// navigating anywhere -- there's no navigation callback in the trailer's
// prop surface. It returns the viewer to the event page, whose Overview tab
// (the default landing tab) already has the real RSVP control.
//
// No MENSAPP wordmark here (removed 2026-08-21d, Dom: "isn't needed on this
// screen") -- the event `name` is now the card's top billing text, so it
// picks up a bit more size/presence than it had while sitting under the
// wordmark, to fill the visual weight the wordmark used to carry rather
// than leaving a gap above it. The `.tr-wordmark`/`.tr-wordmark-settled`
// classes had no other consumer and were pruned from TrailerStyles.jsx in
// the same change.
export default function BeatOutro({ data, onReplay, onRsvp }) {
  const { name, kretjes } = data;
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="tr-title fu" style={{ fontSize: 'clamp(1.8rem,7vw,3rem)' }}>{name}</div>

      <div className="tr-kretjes fu1">
        <div className="tr-kretjes-title">Kretjes so far</div>
        <div className="tr-kretjes-count">{kretjes}</div>
        <div className="tr-kretjes-copy">
          That number doesn&apos;t climb on its own — YOU do that. We need YOU to RSVP. Now.
        </div>
      </div>

      <div className="fu2" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: '1.6rem' }}>
        <button type="button" className="tr-cta tr-cta-ghost" onClick={onReplay}>↻ Watch again</button>
        <button type="button" className="tr-cta tr-cta-gold" onClick={onRsvp}>RSVP now →</button>
      </div>
    </div>
  );
}
