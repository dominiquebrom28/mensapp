// CURRENTLY UNUSED (visual QA fix, 2026-08-20): this used to render
// `buildBeats.js`'s standalone `COUNTDOWN` beat. That beat added a hard
// gold wipe-cut between the date reveal and its own countdown chip that
// the creative brief never called for (§3 Beat 2 describes both as ONE
// beat) -- `buildBeats.js` now folds `daysToGo` onto the `META` beat's
// `data` instead, rendered by `BeatMeta.jsx`. Left in the tree, unwired
// from `TrailerStage`'s active beat-kind map, on purpose: `BEAT_KINDS.
// COUNTDOWN`/`DURATIONS.COUNTDOWN` (constants.js) were also deliberately
// kept defined rather than removed, so the standalone beat is a one-line
// revert away (re-add the `beats.push({kind:BEAT_KINDS.COUNTDOWN,...})`
// call in buildBeats.js) if a future pass wants it back.
export default function BeatCountdown({ data }) {
  const { daysToGo } = data;
  return (
    <div className="tr-content tr-content-center">
      <div className="tr-kicker" style={{ marginBottom: '.6rem' }}>⚡ T-minus</div>
      <div className="tr-title tr-slam" style={{ fontSize: 'clamp(2.6rem,12vw,5.5rem)' }}>
        {daysToGo}
      </div>
      <div className="tr-kicker fu1" style={{ marginTop: '.5rem' }}>
        {daysToGo === 1 ? 'DAG TE GAAN' : 'DAGEN TE GAAN'}
      </div>
    </div>
  );
}
