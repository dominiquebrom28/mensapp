// Beat 7 -- Closing card / poster frame (creative spec §3 Beat 7, §2 "End
// state"). The wordmark "returns... not re-igniting" -- a plain fade, no
// letter-by-letter stagger (that's Beat 1's signature move only).
//
// FLAGGED DEVIATION: the creative brief asks for the RSVP CTA's label to
// change per-viewer ("Lock it in ->" vs "See you there ->"), which needs
// the *current viewer's* RSVP status. Neither `TrailerInput` (the adapter's
// per-event, not per-viewer, view model) nor `EventTrailer`'s deliberately
// minimal `{ input, onClose }` prop surface (technical spec §10 -- the only
// two props enumerated) carries that. Widening EventTrailer's API to thread
// `currentUser` through would contradict the "App.jsx delta exactly as
// spec §3 lists it" instruction for this pass, so this uses one universal,
// always-correct label ("RSVP now") instead of the personalised copy.
// `onRsvp` closes the trailer (technical spec's own `onClose`) rather than
// navigating anywhere -- there's no navigation callback in the trailer's
// prop surface either -- returning the viewer to the event page, whose
// Overview tab (the default landing tab) already has the real RSVP control.
export default function BeatOutro({ data, onReplay, onRsvp }) {
  const { name, dateLabel, location, theme } = data;
  return (
    <div className="tr-content tr-content-center">
      <h1 className="tr-wordmark tr-wordmark-settled fu">MENSDAY</h1>
      <div className="tr-title fu1" style={{ fontSize: 'clamp(1.5rem,6vw,2.6rem)', marginTop: '.9rem' }}>{name}</div>
      {dateLabel && <div className="tr-sub fu2" style={{ marginTop: '.6rem' }}>{dateLabel}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: '.6rem' }}>
        {location && <span className="tr-chip">📍 {location}</span>}
        {theme && <span className="tr-chip tr-chip-amber">✨ {theme}</span>}
      </div>
      <div className="fu2" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: '1.8rem' }}>
        <button type="button" className="tr-cta tr-cta-ghost" onClick={onReplay}>↻ Watch again</button>
        <button type="button" className="tr-cta tr-cta-gold" onClick={onRsvp}>RSVP now →</button>
      </div>
    </div>
  );
}
