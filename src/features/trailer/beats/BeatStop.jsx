// Beat 3 -- The montage (creative spec §3, Beat 3 + the "single stop
// spotlight" / "no images" degrade rules in §7). One of these mounts per
// selected public schedule stop; `buildBeats.js` already guarantees
// `data.activity` is non-empty and caps the montage, so there is no runtime
// "no stops" branch here (technical spec §5.5).
//
// `data.moreCount` -- when present, this is the LAST stop beat surviving
// the montage cap, and the engine has folded the "+N more stops" indicator
// onto its own data rather than inventing a dedicated closing-card beat
// kind (see buildBeats.js's `reconcileMoreCount`). Rendered here as a small
// chip stacked above the day/time row, which is the faithful reading of
// what the fixed engine actually produces -- see the trailer report for the
// full reconciliation against the creative brief's literal "1.5s closing
// card" description.
//
// FLAGGED FIX (visual QA pass): this chip used to be pinned at
// `top: calc(3.2vh + .9rem); right: 1.1rem` -- the EXACT same coordinates
// EventTrailer.jsx uses for the persistent ✕ exit/skip control, which sits
// above every beat regardless of chrome idle-fade. The two collided (chip
// text ran under the button). Moved into the normal document flow instead
// of a screen-absolute position, stacked as the first element of
// `.tr-content` (which is bottom-anchored via `justify-content:flex-end`)
// -- reads as "above the activity block", bottom-left, where this beat's
// content already lives, and can't collide with anything pinned to the
// screen's corners at any viewport. Confirmed no other beat in this
// directory reuses the exit button's coordinates.
export default function BeatStop({ data, hasMedia, isMultiDay }) {
  const { icon, activity, location, note, dayLabel, time, moreCount } = data;
  return (
    <div className="tr-content">
      {!hasMedia && icon && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'clamp(6rem,30vw,14rem)', opacity: '.16', pointerEvents: 'none',
          }}
        >
          {icon}
        </div>
      )}
      {moreCount > 0 && (
        <div style={{ marginBottom: '.6rem' }}>
          <span className="tr-chip tr-chip-amber">+{moreCount} more stops 👀</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '.8rem' }}>
        {isMultiDay && dayLabel && <span className="tr-chip">{dayLabel}</span>}
        {time && <span className="tr-chip tr-chip-amber">{time}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        {icon && <span className="tr-slam" style={{ fontSize: 'clamp(2rem,6vw,3.4rem)', lineHeight: 1 }} aria-hidden="true">{icon}</span>}
        <h2 className="tr-title tr-slam">{activity}</h2>
      </div>
      {location && <div className="tr-sub fu1" style={{ marginTop: '.6rem' }}>{location}</div>}
      {note && <div className="tr-note fu2" style={{ marginTop: '.5rem', maxWidth: 560 }}>{note}</div>}
    </div>
  );
}
