// Beat 1 -- Cold open (creative spec §3, Beat 1). Deliberately abstract: no
// event name/date here (that's Beat 2/`BeatMeta`'s job) -- just the ignited
// `MENSDAY` wordmark and a rotating hype kicker, "like a studio logo card."
//
// `data.name`/`data.dateLabel` (buildBeats.js's TITLE beat shape) are
// intentionally NOT rendered by this component. They exist on the beat only
// as a defensive absorption seam for a hypothetical future where META's own
// gate is decoupled from TITLE's (see buildBeats.js's own comment on the
// META beat) -- today the two gates are perfectly correlated, so there is
// nothing this beat would ever need to show that Beat 2 doesn't already.
//
// The hype-line pool is reused from `Home` (App.jsx) verbatim, per the
// creative brief ("pulled from the same hype-line pool Home already uses").
// It's duplicated here rather than imported: buildBeats.js is a pure
// function with no Date.now() access (§5.1), and the dependency edge
// between App.jsx and src/features/trailer/ runs one way only (App.jsx ->
// trailer, never the reverse, per technical spec §3) -- so this small,
// bounded copy is the only place a same-day-deterministic hype line can be
// picked. Keep this array in sync with `Home`'s `hypers` if that copy ever
// changes.
const HYPE_LINES = [
  "No excuses. No mercy. Just lads.",
  "The brotherhood doesn't sleep.",
  'Every year. No matter what.',
  'Legends are made here.',
  "It's that time again.",
];

function pickHype() {
  const d = new Date();
  return HYPE_LINES[(d.getMonth() + d.getDate()) % HYPE_LINES.length];
}

const WORDMARK = 'MENSDAY';

export default function BeatTitle({ reducedMotion }) {
  const hype = pickHype();
  return (
    <>
      {!reducedMotion && (
        <div className="tr-embers" aria-hidden="true">
          <span className="tr-ember" />
          <span className="tr-ember" />
          <span className="tr-ember" />
        </div>
      )}
      <div className="tr-content tr-content-center">
        <h1 className="tr-wordmark" aria-label={WORDMARK}>
          {WORDMARK.split('').map((ch, i) => (
            // Static string, always the same length/order -- index is a stable identity here.
            <span key={i} aria-hidden="true">{ch}</span>
          ))}
        </h1>
        <div className="tr-kicker fu1" style={{ marginTop: '1.1rem' }}>{hype}</div>
      </div>
    </>
  );
}
