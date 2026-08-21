// The lads who've already RSVP'd -- rendered as part of the trailer's single
// end-card view (docs/trailer-creative-spec.md §3 Beat 6's roll call,
// repurposed 2026-08-21: the owner shipped a real video, so this no longer
// plays as its own timed beat inside a sequence -- it's folded, alongside
// the kretjes counter and the two CTAs, into the one view shown when the
// video ends). Kept as its own component (rather than inlined into
// EventTrailer.jsx) because it composes cleanly and is independently
// testable.
//
// Structural note: this used to be a full-bleed `.tr-content` layer (one of
// several stacked beats, each owning the whole viewport). Now it's one
// section inside a normal-flow, scrollable end card -- so it renders just
// its own content, not a positioned wrapper. `EventTrailer.jsx` supplies the
// card's shell/background/scroll.
//
// TrailerAvatar (technical spec §3, unchanged): deliberately NOT the app's
// `Avatar` -- no import across the App.jsx -> trailer boundary, and no
// dependency on `ANIMALS` (avoids duplicating that 10-entry emoji/colour
// table). Falls back to a monogram on an amber-toned gradient, picked from
// `avatarIndex` purely for visual variety -- never the app's actual animal
// palette. Honest downside: this never reflects a person's real chosen
// avatar when they have no photo.
const MONO_GRADIENTS = [
  'linear-gradient(135deg,var(--gold),var(--amber))',
  'linear-gradient(135deg,var(--amber),var(--amber2))',
  'linear-gradient(135deg,#8B4513,var(--gold))',
  'linear-gradient(135deg,var(--gold),#f5b866)',
];

// `size` is deliberately NOT defaulted to a pixel number any more (2026-08-21g,
// HIGH: the roster grid overflowed a 375px viewport by ~684px). With no
// `size` passed (the only case this component is actually invoked with),
// width/height/monogram-font-size all fall through untouched to
// `.tr-avatar`/`.tr-avatar-mono` in TrailerStyles.jsx, which size themselves
// with `clamp()` -- genuinely responsive, shrinking on narrow screens instead
// of forcing a fixed-width grid track. Passing an explicit `size` still works
// exactly as before (pixel-perfect override, e.g. for a future non-responsive
// use) -- it's opt-in now rather than the only path.
export function TrailerAvatar({ name, photoUrl, avatarIndex = 0, size, style = {} }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const sizeStyle = size ? { width: size, height: size } : undefined;
  return (
    <div
      className="tr-avatar tr-stamp"
      style={{
        ...sizeStyle,
        background: photoUrl ? undefined : MONO_GRADIENTS[avatarIndex % MONO_GRADIENTS.length],
        ...style,
      }}
    >
      {photoUrl
        ? <img src={photoUrl} alt="" />
        : <span className="tr-avatar-mono" style={size ? { fontSize: size * 0.42 } : undefined} aria-hidden="true">{initial}</span>}
    </div>
  );
}

// Empty state (zero confirmed "going"): never an empty grid -- a short,
// on-brand nudge instead. `EventTrailer.jsx` renders this in BeatRoster's
// place rather than mounting BeatRoster with nothing to show.
export function EmptyRoster() {
  return (
    <div className="tr-roster-section" style={{ textAlign: 'center' }}>
      <div className="tr-kicker" style={{ marginBottom: '.4rem' }}>🍺 The lads showing up</div>
      <div className="tr-title tr-slam" style={{ fontSize: 'clamp(1.3rem,5vw,2rem)' }}>Nobody&apos;s locked in yet</div>
      <div className="tr-note" style={{ marginTop: '.5rem' }}>We need YOU to RSVP. Now. Be the first name on this list — not the last lad wondering what he missed.</div>
    </div>
  );
}

export default function BeatRoster({ data }) {
  const { going, goingCount, moreCount } = data;
  return (
    <div className="tr-roster-section" style={{ textAlign: 'center' }}>
      <div className="tr-kicker" style={{ marginBottom: '.3rem' }}>🍺 The lads showing up</div>
      <h2 className="tr-title tr-slam" style={{ fontSize: 'clamp(1.6rem,6vw,2.6rem)', marginBottom: '1.6rem' }}>
        {goingCount} confirmed
      </h2>
      <div className="tr-roster-grid">
        {going.map((p, i) => (
          <div key={p.name || i} className="tr-roster-person">
            <TrailerAvatar name={p.name} photoUrl={p.photoUrl} avatarIndex={p.avatarIndex} style={{ animationDelay: `${i * 70}ms` }} />
            <span className="tr-name">{p.name}</span>
          </div>
        ))}
        {moreCount > 0 && (
          <div className="tr-roster-more">
            {/* No fixed width/height here either (2026-08-21g) -- same
                `.tr-avatar` clamp() as every named avatar, so the "+N" tile
                shrinks in step with the rest of the row instead of being the
                one fixed-size item forcing its column wide. */}
            <div
              className="tr-avatar tr-stamp"
              style={{ background: 'rgba(255,255,255,.1)', border: '2px dashed rgba(255,255,255,.3)', animationDelay: `${going.length * 70}ms` }}
            >
              <span className="tr-avatar-mono" style={{ color: '#fff' }}>+{moreCount}</span>
            </div>
            <span className="tr-name">more legends</span>
          </div>
        )}
      </div>
    </div>
  );
}
