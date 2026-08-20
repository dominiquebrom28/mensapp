// Beat 4 -- The secret tease (creative spec §6). Only ever mounted when
// `buildBeats.js` determined `secretCount > 0` (technical spec §5.5) --
// there is no "no secrets" branch to handle here.
//
// FLAGGED DEVIATION: the creative brief asks for the secret stop's own
// still at heavy blur (`filter: blur(28px) brightness(.5)`) so "the mood ...
// leaks through with no legible detail." The already-built, fixed
// `buildBeats.js` NEVER attaches a `media` URL to the SECRET beat, by
// design -- it is one of that file's own leak-prevention invariants
// (checked by its "no secret stop's image URL is ever handed to the
// preloader" test, technical spec §5.5.3), so that even a hostile/
// un-redacted upstream input can't leak a secret stop's asset through the
// network panel. That guarantee is stronger than the creative brief's
// blurred-still idea and I'm not re-opening it -- this beat therefore
// always uses the plain "rich amber-black gradient" fallback the creative
// brief itself already allows for the no-image case (§6: "with no image,
// fall back to a rich amber-black gradient, never a grey placeholder"),
// never a blurred photo. No Ken Burns is applied to it either way (§6:
// "this holds still") -- enforced by TrailerStage's `NO_KEN_BURNS_KINDS`.
export default function BeatSecret({ data }) {
  const { count } = data;
  const copy = count > 1
    ? 'A few stops are staying under lock…'
    : 'One stop on the schedule stays under lock until the day.';
  return (
    <>
      <div className="tr-secret-bg" aria-hidden="true" />
      <div className="tr-content tr-content-center">
        <div className="tr-lock" aria-hidden="true">🔒</div>
        <div className="tr-kicker tr-kicker-red" style={{ marginTop: '1.1rem' }}>
          Something we&apos;re not telling you
        </div>
        <div className="tr-sub fu1" style={{ marginTop: '.7rem', maxWidth: 460 }}>{copy}</div>
      </div>
    </>
  );
}
