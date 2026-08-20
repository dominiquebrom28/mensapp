// Beat 6 -- The roll call (creative spec §3 Beat 6 + §7 degrade rules).
// Only ever mounted when `buildBeats.js` found `goingCount >= 3` (technical
// spec §5.5) -- the "zero attendees" and "few attendees" degrades in the
// creative brief are handled as follows:
//
//  - "Few (2-3)": ROSTER's own gate already only fires at 3+, so the
//    smallest roster this component ever renders IS the 3-person case.
//    `.tr-roster-grid`'s `auto-fit` grid naturally gives 3 people more room
//    per avatar than 10 would -- no extra branch needed for "bigger, not
//    sparse."
//  - "Zero confirmed attendees -> CTA beat" (creative §7): NOT implemented.
//    `buildBeats.js`'s BEAT_KINDS enum has no zero-attendee CTA variant, and
//    inventing a synthetic beat outside the fixed engine would violate the
//    "a mounted beat is guaranteed to have what it needs, by construction"
//    contract this package is built against. With <3 going, ROSTER is
//    simply dropped and the trailer runs shorter, straight to `OUTRO` --
//    whose own RSVP CTA (§2 end state) already covers the call-to-action.
//    Flagged in the trailer report as a genuine engine/creative gap, not a
//    silent simplification.
//
// TrailerAvatar (technical spec §3): deliberately NOT the app's `Avatar` --
// no import across the App.jsx -> trailer boundary, and no dependency on
// `ANIMALS` (avoids duplicating that 10-entry emoji/colour table). Falls
// back to a monogram on an amber-toned gradient, picked from
// `avatarIndex` purely for visual variety -- never the app's actual animal
// palette. "Honest downside" (spec's own words): this never reflects a
// person's real chosen avatar when they have no photo.
const MONO_GRADIENTS = [
  'linear-gradient(135deg,var(--gold),var(--amber))',
  'linear-gradient(135deg,var(--amber),var(--amber2))',
  'linear-gradient(135deg,#8B4513,var(--gold))',
  'linear-gradient(135deg,var(--gold),#f5b866)',
];

export function TrailerAvatar({ name, photoUrl, avatarIndex = 0, size = 72, style = {} }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      className="tr-avatar tr-stamp"
      style={{
        width: size,
        height: size,
        background: photoUrl ? undefined : MONO_GRADIENTS[avatarIndex % MONO_GRADIENTS.length],
        ...style,
      }}
    >
      {photoUrl
        ? <img src={photoUrl} alt="" />
        : <span className="tr-avatar-mono" style={{ fontSize: size * 0.42 }} aria-hidden="true">{initial}</span>}
    </div>
  );
}

export default function BeatRoster({ data }) {
  const { going, goingCount, moreCount } = data;
  return (
    <div className="tr-content tr-content-center">
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
            <div
              className="tr-avatar tr-stamp"
              style={{ width: 72, height: 72, background: 'rgba(255,255,255,.1)', border: '2px dashed rgba(255,255,255,.3)', animationDelay: `${going.length * 70}ms` }}
            >
              <span className="tr-avatar-mono" style={{ fontSize: 22, color: '#fff' }}>+{moreCount}</span>
            </div>
            <span className="tr-name">more legends</span>
          </div>
        )}
      </div>
    </div>
  );
}
