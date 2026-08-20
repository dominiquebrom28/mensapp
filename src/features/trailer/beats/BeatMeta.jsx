// Beat 2 -- The hook (creative spec §3, Beat 2). Big date reveal + location,
// with a weekend tag echo when `data.type==="weekend"` (consistent with
// `EventCard`'s existing weekend tag, per creative spec §5's colour table).
//
// The live "X DAGEN TE GAAN" countdown chip described in the same shot-list
// entry renders here, inline, when `data.daysToGo` is present.
//
// FLAGGED FIX (visual QA pass, 2026-08-20): this used to be deliberately
// NOT rendered here -- an earlier pass read the countdown as buildBeats.js's
// own separate `COUNTDOWN` beat (see the now-unused `BeatCountdown.jsx`)
// immediately after this one. That was wrong: it meant a full hard gold
// wipe-cut between the date reveal and its own countdown chip, an extra cut
// in the first ten seconds that the creative brief never called for --
// §3 Beat 2 describes both as ONE beat. `buildBeats.js` now folds
// `daysToGo`/`startsAtIso` onto THIS beat's `data` instead of emitting a
// standalone beat; `BeatCountdown.jsx` is left in the tree, unused, in case
// the standalone beat ever comes back (`BEAT_KINDS.COUNTDOWN` and
// `DURATIONS.COUNTDOWN` were kept defined for the same reason).
export default function BeatMeta({ data }) {
  const { dateLabel, location, theme, type, daysToGo } = data;
  const hasCountdown = typeof daysToGo === 'number';
  return (
    <div className="tr-content">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '.9rem' }}>
        <span className="tr-kicker">📅 Save the date</span>
        {type === 'weekend' && <span className="tr-chip tr-chip-purple">🏕️ Weekend</span>}
        {theme && <span className="tr-chip tr-chip-amber">✨ {theme}</span>}
      </div>
      <h2 className="tr-title tr-slam">{dateLabel}</h2>
      {location && <div className="tr-sub fu1" style={{ marginTop: '.7rem' }}>📍 {location}</div>}
      {hasCountdown && (
        <div className="fu2" style={{ marginTop: '.9rem' }}>
          <span className="tr-chip tr-chip-amber">
            ⚡ {daysToGo} {daysToGo === 1 ? 'DAG' : 'DAGEN'} TE GAAN
          </span>
        </div>
      )}
    </div>
  );
}
