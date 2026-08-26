import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { supabase, hashPin } from "./supabase.js";
import { isSafeImageUrl, isSafeVideoUrl } from "./features/trailer/safeUrl.js";
import { hasSeenTrailer } from "./features/trailer/seen.js";
import { hasDismissedTeaser, dismissTeaser } from "./features/teaser/dismissed.js";
// `unlinkTeamSetFromEvent` no longer has a caller here -- it only ever
// backed the event page's Teams tab (`TeamsTab`'s own `unlink`), removed
// 2026-08-26 along with the tab itself. Still exported from teamlib/api.js
// and covered by its own test; not deleted there since that file is out of
// this change's scope and the function may find a new caller once Team
// Creator grows its own "linked event history" view (mirroring mens-games').
import { fetchTeamSets, saveTeamSet, deleteTeamSet, archiveTeamSet, unarchiveTeamSet } from "./features/teamlib/api.js";
import { blankTeamSet, setCaptain, removeMember, teamSetSummary, namesFromUsers, mergeNames, generateTeams, resizeTeams, splitPreview } from "./features/teamlib/model.js";
// `TEAM_AVATARS` moved to the quiz feature in the Q3 pure-move (docs/
// quiz-unification-spec.md §8.3 -- one of the six declarations that
// "legitimately leave" App.jsx, §9) -- imported back here because
// `TeamCreatorPage`'s own team-avatar picker (unrelated to the quiz) still
// needs it and always has, per §5.2/§5.3 there being one team concept.
import { TEAM_AVATARS } from "./features/quiz/model.js";

// The app's first code split (technical spec `docs/trailer-technical-spec.md`
// §3): keeps the trailer's weight out of the main chunk, loaded only when an
// event page's "🎬 Watch the trailer" button is actually clicked.
const EventTrailer = lazy(() => import("./features/trailer/EventTrailer.jsx"));
// Mens-games (docs/mensgames-spec.md §5.3): lazy like the trailer -- must
// not add to the main chunk. App.jsx never fetches tournaments itself; the
// feature owns its own Supabase I/O once this actually mounts.
// `MensGamesTab` (the event-tab mount) is gone -- the owner's 2026-08-26
// decision retired the event page's Quiz/Teams/Mens-Games 🏆 tabs; Mens-Games
// is reached exclusively through this top-level page now (Tools/Home).
const MensGamesPage = lazy(() => import("./features/mensgames/MensGamesPage.jsx"));
// Eager, deliberately not in the lazy chunk (mirrors `fetchQuizResults`
// below, docs/quiz-unification-spec.md §8.1's "eager, tiny" reasoning):
// selects only the columns `WinnersTab`'s tournament-AUTO-card needs, never
// the tournament's whole row, and never a secret one -- see the module for
// why `entrants`/`rounds` (not just a flat `scores` column, which
// tournaments have no equivalent of) are unavoidable here.
import { fetchTournamentResults, isTournamentAlreadyPublished, tournamentWinnerPlacement } from "./features/mensgames/tournamentResults.js";
// Quiz (docs/quiz-unification-spec.md §8.1/§8.3/§14 decision 1, WP-Q7/Q8):
// same lazy-mount pattern as Mens-games above. `QuizTabMount` (the event-tab
// mount) is gone for the same 2026-08-26 reason as `MensGamesTab` above --
// only `QuizPage` (top-level, `pageView==="quiz"`) still lazily loads
// `QuizShell.jsx`, ~2,250 lines/90-110kB out of the main chunk. `QuizTab`/
// `QuizDashboard` are no longer imported here directly -- `QuizShell.jsx`
// owns mounting them now (§8.3 item 3: EventPage drops its own `quizDash`
// state).
// Eager, deliberately not in the lazy chunk (docs/quiz-unification-spec.md
// §4.5/§8.1): discovery has to run for someone who never opens the quiz at
// all, since finding a live quiz is what invites them in. `fetchQuizResults`
// is the same posture (§8.1: "eager, tiny") -- it feeds `computeMemberStats`/
// `HallOfFame`/`WinnersTab` at boot, all of which render regardless of
// whether the quiz feature itself is ever opened.
import { useLiveQuizWatch } from "./features/quiz/liveWatch.js";
import { fetchQuiz } from "./features/quiz/api.js";
import { fetchQuizResults, isQuizAlreadyPublished } from "./features/quiz/results.js";
const QuizPage = lazy(() => import("./features/quiz/QuizPage.jsx"));
const QuizParticipantView = lazy(() => import("./features/quiz/QuizParticipantView.jsx"));

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STYLES
// ─────────────────────────────────────────────────────────────────────────────
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&family=DM+Sans:wght@300;400;500;600;700&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#0c0901;--bg2:#150e04;--bg3:#1d1408;--bg4:#27190c;
      --amber:#e8943a;--amber2:#f5b866;--gold:#c9922a;
      --cream:#f0e6d3;
      /* Contrast fix (docs/ux-plan.md §2.3/§5.7, 2026-08-26): the old
         --muted (#8a7460) measured 4.50:1 on --bg but only 4.33/4.11/3.86:1
         on --bg2/--bg3/--bg4 -- under the 4.5:1 AA text minimum on every
         card, which is where secondary text actually lives. The fix already
         existed in this file as AA_MUTED inside TeamCreatorPage-adjacent
         code -- translucent cream instead of an opaque brown-grey -- and
         measured 7.49-7.61:1 across every surface because alpha-blended
         cream stays close to --cream's own ~14-16:1 headroom. Promoted here
         so every var(--muted) call site gets it for free; --muted2 is
         left alone (still fails AA everywhere, tracked as a later-phase
         cleanup, not one of this pass's three measured failures).
         --muted2 kept as-is intentionally -- do not "fix" it here. */
      --muted:rgba(240,230,211,.68);--muted2:#6a5848;
      /* Contrast fix (docs/ux-plan.md §2.3/§5.7): --border was
         rgba(232,148,58,.12), which measures 1.17-1.23:1 against
         --bg/--bg2/--bg3/--bg4 -- effectively invisible, and this is the
         border on every Card/Inp/ghost Btn. WCAG 1.4.11 wants 3:1 for a UI
         component boundary. .55 alpha of the same amber clears 3:1 on all
         four surfaces (3.08-3.17:1) while staying the same hue -- verified
         by alpha-compositing the border colour over each background and
         computing WCAG relative-luminance contrast against that background
         (not just comparing the two flat hex codes, which is what a naive
         script would do and get wrong for any translucent colour). */
      --border:rgba(232,148,58,.55);--border2:rgba(232,148,58,.35);
      --green:#4caf7d;--red:#e05555;--blue:#5b9bd5;--purple:#9b7fe8;--orange:#ff6b35;
      --font-h:'Playfair Display',serif;--font-b:'DM Sans',sans-serif;
      --radius:14px;--radius-sm:9px;
      --hero-glow:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(232,148,58,.18),transparent 70%);
    }
    body{background:var(--bg);color:var(--cream);font-family:var(--font-b);min-height:100vh}
    ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:linear-gradient(var(--amber),var(--gold));border-radius:3px}
    input,select,textarea{font-family:var(--font-b)}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes pop{0%{transform:scale(.8);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
    @keyframes countdown{from{stroke-dashoffset:0}to{stroke-dashoffset:251}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
    @keyframes goldShimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    @keyframes glowPulse{0%,100%{box-shadow:0 0 20px rgba(232,148,58,.1),0 0 60px rgba(232,148,58,.05)}50%{box-shadow:0 0 40px rgba(232,148,58,.35),0 0 120px rgba(232,148,58,.15)}}
    @keyframes shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}
    @keyframes borderFire{0%,100%{border-color:rgba(232,148,58,.25)}50%{border-color:rgba(232,148,58,.85)}}
    @keyframes annPulse{0%,100%{box-shadow:0 0 0 0 rgba(232,148,58,.0),0 4px 24px rgba(0,0,0,.4)}50%{box-shadow:0 0 0 4px rgba(232,148,58,.12),0 4px 32px rgba(0,0,0,.5)}}
    .ann-banner{animation:annPulse 3.5s ease-in-out infinite}
    @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes countUp{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
    @keyframes reveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0% 0 0)}}
    @keyframes scoreReveal{0%{transform:translateX(-20px);opacity:0}100%{transform:translateX(0);opacity:1}}
    @keyframes timerPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
    @keyframes musicWave{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.6)}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes teamReveal{0%{opacity:0;transform:scale(.85) translateY(10px)}100%{opacity:1;transform:scale(1) translateY(0)}}
    @keyframes timerFinish{0%,100%{background:rgba(224,85,85,.07)}50%{background:rgba(224,85,85,.18)}}
    .qp-score-row{animation:scoreReveal .4s ease both}
    .qp-timer-warn{animation:timerPulse .6s ease-in-out infinite}
    .fu{animation:fadeUp .45s ease both}
    .fu1{animation:fadeUp .45s .08s ease both}
    .fu2{animation:fadeUp .45s .16s ease both}
    .fu3{animation:fadeUp .45s .24s ease both}
    .fu4{animation:fadeUp .45s .32s ease both}
    .ov{animation:fadeIn .2s ease both}
    .pop{animation:pop .35s ease both}
    .float{animation:float 3.5s ease-in-out infinite}
    .glow-pulse{animation:glowPulse 3s ease-in-out infinite}
    .fire-border{animation:borderFire 2s ease-in-out infinite}
    .skeleton{background:linear-gradient(90deg,var(--bg3) 25%,var(--bg4) 50%,var(--bg3) 75%);background-size:600px 100%;animation:shimmer 1.5s infinite;border-radius:8px}
    .event-card-upcoming:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(232,148,58,.15)!important}
    .event-card-upcoming{transition:all .25s cubic-bezier(.4,0,.2,1)}
    .schedule-card{transition:all .22s ease;animation:slideUp .32s ease both}
    .schedule-card:hover{transform:translateX(5px);border-color:var(--border2)!important;background:var(--bg4)!important}
    .rsvp-btn{transition:all .2s cubic-bezier(.4,0,.2,1)!important}
    .rsvp-btn:hover{transform:translateY(-1px);filter:brightness(1.1)}
    .rsvp-btn:active{transform:scale(.97)}
    input:hover,textarea:hover{border-color:rgba(232,148,58,.38)!important}
    select:hover{border-color:rgba(232,148,58,.38)!important}
    /* Contrast fix (docs/ux-plan.md §2.3/§5.7): this rule used to strip the
       UA focus outline (outline:none!important) and replace it with a
       translucent box-shadow, rgba(232,148,58,.13) -- alpha-composited over
       --bg3 (the Inp background) that measures 1.24:1, worse than doing
       nothing. Replaced with the same solid ring features/mensgames/ui/
       styles.jsx already uses and documents as WCAG-verified (3px solid
       var(--amber2), which measures 9.7-11.3:1 against every --bg*
       surface) -- copied verbatim per §5.7 rather than inventing a new
       ring. */
    input:focus,textarea:focus,select:focus{border-color:var(--amber)!important;outline:3px solid var(--amber2)!important;outline-offset:2px!important}
    .nav-btn{transition:all .18s ease!important}
    .nav-btn:hover{background:rgba(232,148,58,.12)!important;border-color:rgba(232,148,58,.5)!important;color:var(--amber2)!important}
    .nav-btn:active{transform:scale(.95)!important}
    .nav-logout:hover{background:rgba(224,85,85,.12)!important;border-color:rgba(224,85,85,.55)!important}
    .nav-logout:active{transform:scale(.95)!important}
    .notif-item{transition:background .15s ease}
    .notif-item:hover{background:var(--bg4)!important}
    @keyframes sj-reveal{0%{transform:scale(.93);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes sj-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
    @keyframes sj-correct{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
    .sj-img{animation:sj-reveal .35s cubic-bezier(.4,0,.2,1) both}
    .sj-wrong{animation:sj-shake .4s ease both}
    .sj-correct{animation:sj-correct .35s ease both}
    .sj-btn{transition:all .18s cubic-bezier(.4,0,.2,1)!important;user-select:none}
    .sj-btn:hover:not(:disabled){transform:translateY(-3px) scale(1.03)!important}
    .sj-btn:active:not(:disabled){transform:scale(.95)!important}
  `}</style>
);

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
const Card = ({children,style={},className="",id}) => (
  <div id={id} className={className} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.4rem",...style}}>{children}</div>
);
const H = ({children,size="1.35rem",style={}}) => (
  <h2 style={{fontFamily:"var(--font-h)",fontSize:size,color:"var(--amber2)",marginBottom:".9rem",lineHeight:1.2,...style}}>{children}</h2>
);
// NOTE (docs/ux-plan.md §2.1/§9): this is one half of a design-system fork.
// `features/mensgames/ui/Kit.jsx:37` defines a second `Btn` -- same name,
// same variant/size names, different values -- because App.jsx's own
// components can never gain an `export` (§5.4 of docs/mensgames-spec.md;
// the test-source extractors in src/test/extract*FromAppSource.js read this
// file as text and would break). Merging the two is a later phase, blocked
// on removing that constraint first. This pass only brings this Btn's
// `minHeight`s up to the mensgames one's values (36/44/48) -- do not merge.
const Btn = ({children,onClick,variant="primary",size="md",style={},disabled=false,type="button"}) => {
  // Tap-target fix (docs/ux-plan.md §2.1/§2.9): these three sizes used to
  // have no `minHeight` at all -- `sm` (97 of the app's 133 `<Btn>` uses)
  // rendered at roughly 27px tall, `md` ~37px, `lg` ~42px, all under the
  // WCAG 2.2 24px minimum and well under the app's own stated 44px bar.
  // Values below match `features/mensgames/ui/Kit.jsx`'s `BTN_SIZES`
  // exactly (36/44/48), justified there as "scored at a bar, on a phone,
  // one-handed".
  const sz={sm:{padding:"6px 14px",fontSize:".78rem",minHeight:36},md:{padding:"10px 22px",fontSize:".88rem",minHeight:44},lg:{padding:"13px 30px",fontSize:"1rem",minHeight:48}};
  const vr={
    primary:{background:"var(--amber)",color:"var(--bg)",border:"none"},
    ghost:{background:"transparent",color:"var(--cream)",border:"1px solid var(--border)"},
    danger:{background:"transparent",color:"var(--red)",border:"1px solid rgba(224,85,85,.3)"},
    subtle:{background:"var(--bg3)",color:"var(--cream)",border:"1px solid var(--border)"},
    success:{background:"transparent",color:"var(--green)",border:"1px solid rgba(76,175,125,.3)"},
    gold:{background:"linear-gradient(135deg,var(--gold),var(--amber))",color:"var(--bg)",border:"none"},
  };
  const btnRef=useRef(null);
  // What this exact render considers "resting" -- the single source of
  // truth for both the JSX `style` prop below and every hover/press
  // cleanup path. Read fresh off this render's `variant`/`style` closure,
  // never cached, so it can never go stale relative to the props React
  // actually committed.
  const computed={...sz[size],...vr[variant],...style};
  const onEnter=e=>{if(disabled)return;const el=e.currentTarget;
    if(variant==="primary"){el.style.background="var(--amber2)";el.style.transform="translateY(-1px)";el.style.boxShadow="0 4px 16px rgba(232,148,58,.35)";}
    else if(variant==="ghost"){el.style.background="rgba(232,148,58,.09)";el.style.borderColor="var(--border2)";}
    else if(variant==="danger"){el.style.background="rgba(224,85,85,.12)";el.style.borderColor="rgba(224,85,85,.55)";}
    else if(variant==="subtle"){el.style.background="var(--bg4)";el.style.borderColor="var(--border2)";}
    else if(variant==="success"){el.style.background="rgba(76,175,125,.12)";el.style.borderColor="rgba(76,175,125,.55)";}
    else if(variant==="gold"){el.style.filter="brightness(1.12)";el.style.transform="translateY(-1px)";el.style.boxShadow="0 4px 18px rgba(201,146,42,.35)";}
  };
  // Bug (2026-08-25 visible-controls audit): the old implementation
  // snapshotted each button's pre-hover inline style once, on mouseenter,
  // and replayed that exact snapshot back on mouseleave. Two confirmed ways
  // that goes wrong:
  //  1. A browser that dispatches hover events to *disabled* controls
  //     (Chromium suppresses these; WebKit/Firefox are documented not to)
  //     delivers a mouseleave with no matching mouseenter ever having run
  //     (onEnter's own `if(disabled)return` above skips the save) -- the
  //     snapshot was never taken, so restoring it wiped every inline
  //     override to nothing via `??""`, falling through to the bare UA
  //     button-face colour while `color` (never snapshotted) stayed as the
  //     light text -- unreadable, "completely white".
  //  2. Even when a snapshot exists, it goes stale the moment this exact
  //     button's own click flips its `variant` (e.g. the Team Creator
  //     library's Actief/Gearchiveerd pair swapping primary<->ghost on
  //     every click) or `disabled` state before the matching mouseleave
  //     arrives -- most reachable on touch, where WebKit defers a tapped
  //     element's synthetic mouseleave until the *next* tap lands
  //     elsewhere, by which point the button can be a different variant
  //     entirely. Replaying the old snapshot then paints the *previous*
  //     variant's background under the *current* variant's text colour.
  // Fixed by never trusting a snapshot: `rest()` always recomputes the
  // resting look from `computed` above -- this render's actual props --
  // instead of replaying history. A spurious leave with no matching enter,
  // or one that arrives after the variant changed underneath it, is now a
  // harmless reset to the already-correct resting style, never a wipe.
  const rest=el=>{
    el.style.background=computed.background??"";
    el.style.border=computed.border??"";
    // A handful of callers override just the border's colour via a
    // longhand in `style` (e.g. Admin's role-change buttons) on top of the
    // variant's shorthand `border`. Re-apply it after the shorthand, same
    // order React itself would apply the merged style object in, so it
    // wins instead of being silently re-covered by the shorthand.
    if("borderColor" in style)el.style.borderColor=style.borderColor;
    el.style.transform=computed.transform??"";el.style.boxShadow=computed.boxShadow??"";el.style.filter=computed.filter??"";
  };
  const onLeave=e=>rest(e.currentTarget);
  // Mirror case: hovered while *enabled*, then a re-render disables this
  // exact button (most commonly its own onClick flipping the condition
  // that drives `disabled`, e.g. "Deselecteer alles" after it empties the
  // selection) while the pointer never left it. A disabled control can't
  // dispatch mouseleave at all in this browser (confirmed), so `onLeave`
  // above would never otherwise run and the hover-tinted style would be
  // stuck for as long as it stays disabled.
  useEffect(()=>{
    if(disabled&&btnRef.current)rest(btnRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[disabled,variant]);
  // Save the pre-press transform (may be a hover transform) so onUp restores to it
  const onDown=e=>{if(!disabled){const el=e.currentTarget;el._preTr=el.style.transform;el.style.transform="scale(.96)";}};
  const onUp=e=>{if(!disabled){const el=e.currentTarget;el.style.transform=el._preTr??"";}}
  // display/alignItems/justifyContent (added alongside the minHeight fix
  // above, same values as `features/mensgames/ui/Kit.jsx`'s Btn): a plain
  // <button> lays its text out top-aligned once minHeight makes the box
  // taller than the text itself, so minHeight alone would enforce a taller
  // tap target with the label stuck to the top of it. Still overridable via
  // a caller's own `style` (spread last, in `computed`, same as always).
  return <button ref={btnRef} type={type} onClick={onClick} disabled={disabled} onMouseEnter={onEnter} onMouseLeave={onLeave} onMouseDown={onDown} onMouseUp={onUp} style={{borderRadius:"var(--radius-sm)",cursor:disabled?"not-allowed":"pointer",fontFamily:"var(--font-b)",fontWeight:600,transition:"all .18s",opacity:disabled?.5:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,...computed}}>{children}</button>;
};
// Shared tab-strip button, extracted out of the Admin Panel and EventPage
// tab bars (2026-08-26 visible-controls audit): both had hand-rolled the
// exact snapshot-and-replay anti-pattern `Btn` was just fixed for above --
// stash the pre-hover color/background on the entering element via `el._sc`/
// `el._sb`, replay that snapshot on mouseleave. Same failure: click a tab to
// make it active, and the mouseleave that eventually lands (deferred past
// the click on touch, or just a slow mouse) replays the *pre-click, inactive*
// muted color under the *now-active* amber underline/bold weight -- the
// "half-active, half-disabled" tab the owner saw. Fixed the same way as
// `Btn`: never trust a snapshot, recompute the resting color/background from
// this render's own `active` prop on every leave.
const TabBtn = ({active,onClick,children,style={}}) => {
  // Tap-target fix (docs/ux-plan.md §2.1/§2.9, same audit as `Btn` above):
  // `padding:"8px 14px"` at `.83rem` with no `minHeight` renders at roughly
  // 32-34px tall -- under the 44px bar this app already applies to member-
  // facing controls elsewhere (Nav's 7 `minHeight:44` uses). `display`/
  // `alignItems`/`justifyContent` added alongside it for the same reason as
  // `Btn`: a plain <button>'s text top-aligns once `minHeight` makes the box
  // taller than the label, so `minHeight` alone would just push the text to
  // the top of a now-taller tab.
  const computed={background:"none",border:"none",borderBottom:active?"2px solid var(--amber)":"2px solid transparent",color:active?"var(--amber2)":"var(--muted)",cursor:"pointer",padding:"8px 14px",fontFamily:"var(--font-b)",fontWeight:active?600:400,fontSize:".83rem",marginBottom:-1,transition:"color .15s,background .15s",borderRadius:"6px 6px 0 0",minHeight:44,display:"inline-flex",alignItems:"center",justifyContent:"center",...style};
  const onEnter=e=>{if(active)return;const el=e.currentTarget;el.style.color="var(--amber)";el.style.background="rgba(232,148,58,.06)";};
  const onLeave=e=>{const el=e.currentTarget;el.style.color=computed.color??"";el.style.background=computed.background??"";};
  return <button onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave} style={computed}>{children}</button>;
};
const Inp = ({value,onChange,placeholder,style={},type="text",multiline=false,onKeyDown,autoFocus=false,rows=3}) => {
  const base={background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%",outline:"none"};
  return multiline
    ? <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={{...base,resize:"vertical",...style}}/>
    : <input type={type} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown} autoFocus={autoFocus} style={{...base,...style}}/>;
};
const Lbl = ({children,style={}}) => <div style={{fontSize:".75rem",color:"var(--muted)",letterSpacing:".06em",textTransform:"uppercase",marginBottom:5,...style}}>{children}</div>;
// Accessible on/off toggle -- a real `<button role="switch">` (native
// Enter/Space activation + a visible focus ring for free), unlike the
// ad-hoc `<div onClick>` `Toggle` scoped inside PollsTab (not reachable from
// here, and not keyboard-operable). 42x24 hit area clears WCAG 2.2's 24x24
// minimum target size.
const Switch = ({checked,onChange,label,id}) => (
  <div style={{display:"flex",alignItems:"center",gap:10}}>
    <button type="button" id={id} role="switch" aria-checked={checked} onClick={()=>onChange(!checked)} style={{width:42,height:24,borderRadius:12,border:`1px solid ${checked?"var(--amber)":"var(--border)"}`,background:checked?"var(--amber)":"var(--bg3)",position:"relative",cursor:"pointer",padding:0,flexShrink:0}}>
      <span aria-hidden="true" style={{position:"absolute",top:2,left:checked?20:2,width:18,height:18,borderRadius:"50%",background:checked?"#1a1008":"var(--muted2)",transition:"left .15s"}}/>
    </button>
    {label&&<label htmlFor={id} style={{fontSize:".83rem",color:"var(--cream)",cursor:"pointer"}}>{label}</label>}
  </div>
);
const Tag = ({children,color="var(--amber)"}) => (
  <span style={{background:color+"22",color,border:`1px solid ${color}33`,borderRadius:6,padding:"3px 10px",fontSize:".73rem",fontWeight:600}}>{children}</span>
);
const Avatar = ({name,size=32,index=0,photoUrl="",style={}}) => {
  if(photoUrl) return <div style={{width:size,height:size,borderRadius:"50%",flexShrink:0,overflow:"hidden",border:"2px solid var(--bg2)",...style}}><img src={photoUrl} alt={name} style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>;
  const animal=ANIMALS[index%ANIMALS.length];
  return <div style={{width:size,height:size,borderRadius:"50%",flexShrink:0,background:animal.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.5,border:"2px solid var(--bg2)",...style}}>{animal.emoji}</div>;
};
const getUA=(name,users=[])=>{const u=users.find(x=>x.username?.toLowerCase()===name?.toLowerCase());return{index:u?.animal_avatar??u?.avatar??0,photoUrl:u?.photo_url||""};};
const getDisplayName=(name,users=[])=>{const u=users.find(x=>x.username?.toLowerCase()===name?.toLowerCase());return u?.display_name||name;};
const Tooltip=({label,children})=>{
  const [show,setShow]=useState(false);
  return(
    <div style={{position:"relative",display:"inline-flex"}} onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      {children}
      {show&&label&&<div style={{position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",background:"rgba(15,15,20,.97)",border:"1px solid var(--border2)",borderRadius:6,padding:"3px 8px",fontSize:".7rem",color:"#fff",whiteSpace:"nowrap",pointerEvents:"none",zIndex:200,boxShadow:"0 2px 8px rgba(0,0,0,.4)"}}>
        {label}
        <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",width:0,height:0,border:"5px solid transparent",borderTopColor:"rgba(15,15,20,.97)"}}/>
      </div>}
    </div>
  );
};
const Modal = ({children,onClose,maxWidth=500,onBackdropClose}) => {
  const ready=useRef(false);
  useEffect(()=>{const t=setTimeout(()=>{ready.current=true;},350);return()=>clearTimeout(t);},[]);
  return (
  <div className="ov" onClick={()=>{if(ready.current)(onBackdropClose||onClose)();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
    <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth,maxHeight:"92vh",overflowY:"auto"}}>
      <Card style={{padding:"1.8rem"}}>{children}</Card>
    </div>
  </div>
  );
};
const RoleBadge = ({role}) => {
  const badges=[];
  if(hasAdmin({role}))badges.push({color:"var(--amber)",label:"Admin"});
  if(hasOrg({role}))badges.push({color:"var(--purple)",label:"Org"});
  if(!badges.length){
    if(role==="lad"||role==="member")badges.push({color:"var(--green)",label:"Lad"});
    else badges.push({color:"var(--muted)",label:"Pending"});
  }
  return <>{badges.map(b=><Tag key={b.label} color={b.color}>{b.label}</Tag>)}</>;
};
const Divider = ({label}) => (
  <div style={{display:"flex",alignItems:"center",gap:12,margin:".5rem 0"}}>
    <div style={{flex:1,height:1,background:"var(--border)"}}/>
    {label&&<span style={{color:"var(--muted)",fontSize:".72rem",letterSpacing:".08em",textTransform:"uppercase"}}>{label}</span>}
    <div style={{flex:1,height:1,background:"var(--border)"}}/>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────
const ACTIVE_ROLES=["admin","admin+org","org","organisation","lad","member"];
const hasAdmin=u=>["admin","admin+org"].includes(u?.role);
const hasOrg=u=>["org","admin+org","organisation"].includes(u?.role);
const can = {
  editEvent:    u=>hasAdmin(u),
  manageUsers:  u=>hasAdmin(u),
  addWinner:    u=>hasAdmin(u)||hasOrg(u),
  editSchedule: u=>hasOrg(u),
  createPoll:   u=>hasOrg(u),
  closePoll:    u=>hasOrg(u),
  deletePoll:   u=>hasOrg(u),
  deletePhoto:  u=>hasAdmin(u),
  hostQuiz:     u=>hasOrg(u),
  announce:     u=>hasAdmin(u)||hasOrg(u),
  vote:         u=>ACTIVE_ROLES.includes(u?.role),
  uploadPhoto:  u=>ACTIVE_ROLES.includes(u?.role),
  reactPhoto:   u=>ACTIVE_ROLES.includes(u?.role),
  updateRsvp:   u=>ACTIVE_ROLES.includes(u?.role),
  // Mens-games (docs/mensgames-spec.md §13 Q6 proposed default: admin/org
  // only can score/manage a tournament for now). The feature dir can't
  // import `can` (it's lazy, App.jsx-local, unexported per §5.4) -- App.jsx
  // computes this once and passes the boolean down as `canManage`.
  runTournament:u=>hasAdmin(u)||hasOrg(u),
};

// ─────────────────────────────────────────────────────────────────────────────
// COUNTDOWN HOOK
// ─────────────────────────────────────────────────────────────────────────────
const useIsMobile = () => {
  const [mobile,setMobile]=useState(typeof window!=="undefined"&&window.innerWidth<640);
  useEffect(()=>{const h=()=>setMobile(window.innerWidth<640);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  return mobile;
};

const useCountdown = (dateStr,startTime="12:00") => {
  const [t,setT]=useState({});
  useEffect(()=>{
    const tick=()=>{
      const diff=new Date(`${dateStr}T${startTime}:00`)-Date.now();
      if(diff<=0)return setT({past:true});
      setT({d:Math.floor(diff/86400000),h:Math.floor((diff%86400000)/3600000),m:Math.floor((diff%3600000)/60000),s:Math.floor((diff%60000)/1000)});
    };
    tick();const id=setInterval(tick,1000);return()=>clearInterval(id);
  },[dateStr,startTime]);
  return t;
};
const CU = ({v,l}) => (
  <div style={{textAlign:"center",minWidth:50}}>
    <div style={{fontFamily:"var(--font-h)",fontSize:"2.1rem",fontWeight:900,color:"var(--amber)",lineHeight:1}}>{String(v??0).padStart(2,"0")}</div>
    <div style={{color:"var(--muted)",fontSize:".62rem",letterSpacing:".12em",textTransform:"uppercase",marginTop:3}}>{l}</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────────────────────
const statusMap={
  going:{color:"var(--green)",label:"Going"},maybe:{color:"var(--amber)",label:"Maybe"},
  "not coming":{color:"var(--red)",label:"Out"},went:{color:"var(--blue)",label:"Attended"},absent:{color:"var(--muted2)",label:"Absent"},
};
const ANIMALS=[
  {name:"Beer",   emoji:"🐻",bg:"linear-gradient(135deg,#8B4513,#D2691E)"},
  {name:"Vos",    emoji:"🦊",bg:"linear-gradient(135deg,#c0392b,#e8943a)"},
  {name:"Kikker", emoji:"🐸",bg:"linear-gradient(135deg,#27ae60,#52c41a)"},
  {name:"Pinguïn",emoji:"🐧",bg:"linear-gradient(135deg,#2c3e50,#4a6278)"},
  {name:"Uil",    emoji:"🦉",bg:"linear-gradient(135deg,#6B3FA0,#9B59B6)"},
  {name:"Leeuw",  emoji:"🦁",bg:"linear-gradient(135deg,#c9922a,#f5b866)"},
  {name:"Wolf",   emoji:"🐺",bg:"linear-gradient(135deg,#485460,#808e9b)"},
  {name:"Konijn", emoji:"🐰",bg:"linear-gradient(135deg,#a55eea,#d980fa)"},
  {name:"Koala",  emoji:"🐨",bg:"linear-gradient(135deg,#0984e3,#74b9ff)"},
  {name:"Panda",  emoji:"🐼",bg:"linear-gradient(135deg,#2d3436,#636e72)"},
];
const computeMemberStats=(username,events,quizResults=[])=>{
  const n=username.toLowerCase();
  const attended=events.filter(e=>e.archived&&(e.attendees||[]).some(a=>a.name.toLowerCase()===n&&a.status==="went"));
  const mensdays=attended.filter(e=>e.type!=="weekend").length;
  const weekends=attended.filter(e=>e.type==="weekend").length;
  let quizWins=0;
  // §8.3 item 1 (docs/quiz-unification-spec.md): a third, optional arg --
  // never breaks a caller still on two -- feeding wins from the `quizzes`
  // table (WP-Q2's `fetchQuizResults()`) alongside the legacy `evt.quizzes[]`
  // scan below. Needed for a quiz with no linked event at all (a standalone
  // quiz has nowhere in `events` to have ever lived) and, defensively, for
  // one whose `events.quizzes[]` write never landed. `countedIds` keeps a
  // dual-write quiz (both places, "new" per the brief's three-state note)
  // from being counted twice.
  const countedIds=new Set();
  events.forEach(e=>{(e.quizzes||[]).forEach(q=>{
    if(q&&q.id)countedIds.add(q.id);
    if(!q.scores||!Object.keys(q.scores).length)return;
    const max=Math.max(...Object.values(q.scores));
    if(max>0&&q.scores[username]===max)quizWins++;
  });});
  (quizResults||[]).forEach(q=>{
    if(!q||countedIds.has(q.id))return;
    const scores=q.scores||{};
    if(!Object.keys(scores).length)return;
    const max=Math.max(...Object.values(scores));
    if(max>0&&scores[username]===max)quizWins++;
  });
  const mentions=[];
  events.forEach(e=>{(e.winners||[]).forEach(w=>{if(w.winner.toLowerCase()===n)mentions.push({...w,eventName:e.name});});});
  return{mensdays,weekends,quizWins,mentions,total:mensdays+weekends};
};
// Formats a single date, or a start–end range when endDateStr is a different
// day, in nl-NL. Falls back to the plain single-day format (unchanged from
// pre-multi-day behaviour) whenever there's no end date or it equals the
// start date. opts.weekday/opts.year toggle those parts (both default true),
// opts.month picks "long"|"short" (default "long"). Defensive against a
// reversed range (endDateStr before dateStr, e.g. bad/legacy data) -- the
// earlier date always renders first rather than producing garbled output.
const formatEventDateRange=(dateStr,endDateStr,opts={})=>{
  if(!dateStr)return"";
  const{weekday=true,year=true,month="long"}=opts;
  const start=new Date(dateStr+"T12:00:00");
  const hasRange=!!endDateStr&&endDateStr!==dateStr;
  if(!hasRange){
    const o={day:"numeric",month};
    if(weekday)o.weekday="long";
    if(year)o.year="numeric";
    return start.toLocaleDateString("nl-NL",o);
  }
  const endRaw=new Date(endDateStr+"T12:00:00");
  const[from,to]=endRaw<start?[endRaw,start]:[start,endRaw];
  const sameYear=from.getFullYear()===to.getFullYear();
  const sameMonth=sameYear&&from.getMonth()===to.getMonth();
  const wd=dt=>weekday?`${dt.toLocaleDateString("nl-NL",{weekday:"short"})} `:"";
  const showYear=year||!sameYear;
  const endStr=`${wd(to)}${to.getDate()} ${to.toLocaleDateString("nl-NL",{month})}${showYear?` ${to.getFullYear()}`:""}`;
  const startStr=sameMonth
    ?`${wd(from)}${from.getDate()}`
    :`${wd(from)}${from.getDate()} ${from.toLocaleDateString("nl-NL",{month})}${!sameYear?` ${from.getFullYear()}`:""}`;
  return`${startStr} – ${endStr}`;
};
// Number of calendar days an event spans (inclusive), `date` as day 0 and
// `end_date` (if any) as the last day. No end_date, blank, or equal-to-date
// all mean a single-day event (returns 1). Defensive against a reversed
// range the same way formatEventDateRange is.
const eventDayCount=(dateStr,endDateStr)=>{
  if(!dateStr||!endDateStr||endDateStr===dateStr)return 1;
  const start=new Date(dateStr+"T12:00:00");
  const end=new Date(endDateStr+"T12:00:00");
  const days=Math.round(Math.abs(end-start)/86400000);
  return days+1;
};
// Maps a schedule stop's 0-based `day` index to its actual calendar date,
// offset from the event's start `date` (day:0 = the start date itself).
// Deliberately date-derived rather than stored, so moving the whole event
// (editing `date`) keeps every stop correctly attached instead of orphaning
// them -- see the `day` field on schedule stops.
const dateForEventDay=(dateStr,dayIndex)=>{
  if(!dateStr)return"";
  const d=new Date(dateStr+"T12:00:00");
  d.setDate(d.getDate()+(dayIndex||0));
  return d.toISOString().slice(0,10);
};
// Human label for a schedule day group/heading, e.g. "Dag 1 · vrijdag 12 september".
const dayHeadingLabel=(dateStr,dayIndex)=>{
  const iso=dateForEventDay(dateStr,dayIndex);
  const suffix=iso?` · ${new Date(iso+"T12:00:00").toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long"})}`:"";
  return`Dag ${(dayIndex||0)+1}${suffix}`;
};
// Zero-pads a single-digit hour ("9:00"->"09:00") so time strings compare
// numerically, not lexicographically, in scheduleDayTimeOrder below. `time`
// has been free text historically and `schedule` is hand-editable JSONB, so
// an unpadded legacy/imported value is a real (if currently dormant) risk --
// every *current* write path (the modals' `<Inp type="time">`) already
// zero-pads. Leaves "" (and anything that doesn't look like `\d{1,2}:...`)
// untouched so the "blank sorts before any timed stop" behavior below is
// unaffected.
const padTimeForSort=t=>{
  if(!t)return"";
  const m=/^(\d{1,2})(:.*)$/.exec(t);
  return m&&m[1].length===1?`0${m[1]}${m[2]}`:t;
};
// Sort comparator for schedule stops: day first (missing/undefined treated
// as 0, i.e. pre-multi-day stops), then time-of-day within the day. Stable
// (ties keep their existing relative order) so manual reordering via the
// editor's ↑/↓ still shows through whenever times are equal or blank.
const scheduleDayTimeOrder=(a,b)=>((a.day??0)-(b.day??0))||padTimeForSort(a.time).localeCompare(padTimeForSort(b.time));
// Boundary adapter for the trailer feature (src/features/trailer/). The
// trailer now plays the event's real, owner-produced video and ends on a
// single end-card view -- direction change from the owner, 2026-08-21. The
// beat-engine this used to feed (schedule montage, secret tease, "reigning
// champion" legacy nod scanning every archived edition) has no consumer any
// more and was deleted outright, not just unwired -- see `findChampion`'s
// removal in the same change. Produces a plain, serialisable view model with
// exactly what the end card needs: roster, kretjes, event identity, the
// video URL. Keep the `const NAME=(...)=>{ ... };` shape: the
// source-extraction test helpers in src/test/ match on it.
// `kretjes` is the all-time total across every event, not this one's --
// 2026-08-21 owner direction change (matches `Home`'s own
// `events.reduce((s,e)=>s+(e.kretjes||0),0)` total at the top of the app).
// Needs the full `events` list for that, hence the third param. Guarded with
// the same `Number.isFinite` check `Home` doesn't bother with but this file
// already applies elsewhere below -- `kretjes` is hand-editable JSONB-
// adjacent data, so a stray string/null on any one event must not corrupt
// the sum via string concatenation.
const toTrailerInput=(evt,users=[],events=[])=>{
  const going=(evt.attendees||[]).filter(a=>a.status==="going")
    .slice(0,12).map(a=>({name:getDisplayName(a.name,users),...getUA(a.name,users)}));
  return{
    eventId:evt.id,name:evt.name||"",
    videoUrl:isSafeVideoUrl(evt.trailer_video_url)?evt.trailer_video_url:"",
    kretjes:events.reduce((s,e)=>s+(Number.isFinite(e.kretjes)?e.kretjes:0),0),
    goingCount:(evt.attendees||[]).filter(a=>a.status==="going").length,
    going:going.map(g=>({name:g.name,photoUrl:isSafeImageUrl(g.photoUrl)?g.photoUrl:"",avatarIndex:g.index??0})),
  };
};
// ─────────────────────────────────────────────────────────────────────────────
// LOGIN TEASER (owner request, 2026-08-21): an admin-configurable modal that
// greets users on entry and routes them to an event's trailer. Lives next to
// the trailer adapter above because both read the same
// `trailer_video_url`/`teaser_*` event columns and exist for the same
// reason: getting the trailer actually watched.
//
// Selection rule: any NON-archived event with `teaser_active` AND a valid
// `trailer_video_url` (same `isSafeVideoUrl` guard `canTrailer` uses on the
// event page, so a teaser can never point its own button at a dead end).
// Deliberately NOT filtered on the event being upcoming -- direct owner
// instruction: "it doesn't matter when the event is... the feature should
// work regardless of when an event is." A date comparison would
// second-guess the admin's own `teaser_active` decision; archiving is the
// deliberate way to retire a teaser (`isPast` is `evt.archived`, not
// date-derived, same as the event page). Among qualifying events the
// soonest `date` wins.
//
// No-video edge case: handled right here, at selection, by simply excluding
// that event from the candidate pool -- NOT by suppressing the whole
// feature or pointing the button at the event page instead. That way, if a
// different qualifying event DOES have a valid video, the teaser still
// shows for that one; only an admin flipping `teaser_active` on with no
// video AND no other qualifying event stays silent (same "no qualifying
// event -> nothing shows" rule as any other empty-candidates case).
const selectTeaserEvent=(events=[])=>{
  const candidates=events.filter(e=>!e.archived&&e.teaser_active&&isSafeVideoUrl(e.trailer_video_url));
  if(!candidates.length)return null;
  return[...candidates].sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
};
// Purely presentational -- no localStorage, no navigation, no Supabase. The
// caller decides what "watch"/"skip" actually mean: the real App-root mount
// wires them to navigation + dismissal/seen-state (see `App`'s "teaser"
// state below), while EditEventModal/NewEventModal's preview affordance
// wires both to just closing the preview -- so an admin can check their own
// teaser copy any number of times without ever touching the real
// dismissed-state, which would otherwise cost them their only look at their
// own teaser the moment they tried it once.
// Sensible fallbacks for a blank title/text/button label: an
// active-but-unconfigured teaser must never render an empty dialog or a
// button with no label.
//
// FULL-SCREEN TAKEOVER (owner direction change, 2026-08-21b): "i want the
// modal... to be bigger. maybe even screen-covering. so they HAVE to
// interact with it without being able to see things behind it". Used to
// render through the shared `Modal` -- a centred card over a semi-
// transparent (see-through) backdrop. Now its own fullscreen shell, same
// `position:fixed;inset:0` fullscreen-shell pattern EventTrailer.jsx and
// PresentationMode already use (see EventTrailer's own docblock for the
// pattern's rationale), with three differences from a plain copy-paste:
//  1. OPAQUE background, not a dim -- nothing behind may be visible at all,
//     that's the explicit ask (EventTrailer/PresentationMode's own
//     backgrounds are opaque too, so no new pattern here, just confirming
//     it's deliberate and not an oversight if this ever gets "simplified").
//  2. No backdrop at all, therefore no backdrop-click-to-dismiss -- the
//     small-modal version's `onBackdropClose={()=>{}}` no-op doesn't even
//     have an equivalent here; only Escape or the explicit Skip button can
//     close this, full stop (unchanged behaviour, just nothing left that
//     could regress it).
//  3. Escape is wired to `onSkip` (the SAME handler the Skip button uses),
//     not a bare close -- owner-confirmed: this is a real, persisted
//     dismissal, not a temporary one that would just show the teaser again
//     next entry. (The admin preview affordance's `onSkip` is itself wired
//     to just closing the preview, not `dismissTeaser` -- see
//     EditEventModal/NewEventModal above -- so Escape there is correctly
//     "free", same as its Skip button already was.)
// Layout: `.teaser-scroll` is the only element that scrolls -- body-scroll
// lock (identical technique to EventTrailer's) stops the page underneath
// from scrolling instead. `.teaser-actions` is a flex sibling OUTSIDE the
// scroll container, not inside it, so the CTA row stays pinned/reachable at
// the bottom of the viewport no matter how long `text` runs -- a teaser
// whose call to action is hidden below a wall of copy would defeat itself.
// Focus: lands on the dialog itself on mount (same idea as EventTrailer's
// `endCardRef` -- a non-interactive, tabIndex={-1} focus target so a
// screen reader announces the dialog's accessible name immediately,
// without risking an accidental Enter/Space activating the primary button
// the instant it opens).
const TeaserModal=({evt,onWatch,onSkip})=>{
  const title=evt.teaser_title?.trim()||"🎬 A new trailer just dropped";
  const text=evt.teaser_text?.trim()||`Get hyped for ${evt.name||"the next Mensdag"} — the trailer is ready.`;
  const buttonLabel=evt.teaser_button_label?.trim()||"🎬 Watch the trailer";
  const rootRef=useRef(null);
  useEffect(()=>{rootRef.current?.focus();},[]);
  useEffect(()=>{
    const prevOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{document.body.style.overflow=prevOverflow;};
  },[]);
  useEffect(()=>{
    const onKey=e=>{if(e.key==="Escape")onSkip();};
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[onSkip]);
  return(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="teaser-root">
      <style>{`
        .teaser-root{position:fixed;inset:0;height:100dvh;z-index:1000;background:var(--bg);color:var(--cream);display:flex;flex-direction:column;overflow:hidden;outline:none;font-family:var(--font-b);-webkit-tap-highlight-color:transparent}
        .teaser-bg{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 70% 60% at 50% 15%,rgba(232,148,58,.24),transparent 60%),linear-gradient(160deg,var(--bg4),var(--bg2) 55%,var(--bg))}
        .teaser-scroll{position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex}
        .teaser-inner{position:relative;z-index:1;margin:auto;max-width:640px;width:100%;padding:calc(3rem + env(safe-area-inset-top,0px)) 1.5rem 2rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:1.1rem}
        .teaser-kicker{font-family:var(--font-b);font-weight:700;font-size:.78rem;letter-spacing:.24em;text-transform:uppercase;color:var(--amber)}
        .teaser-title{font-family:var(--font-h);font-style:italic;font-weight:900;line-height:1.05;color:var(--amber2);text-shadow:0 2px 40px rgba(232,148,58,.35);font-size:clamp(2rem,7vw,3.4rem);margin:0}
        .teaser-text{color:var(--cream);opacity:.9;font-size:clamp(.95rem,2.4vw,1.1rem);line-height:1.65;max-width:520px;white-space:pre-wrap}
        .teaser-actions{position:relative;z-index:1;flex:0 0 auto;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;padding:1.1rem 1.5rem calc(1.3rem + env(safe-area-inset-bottom,0px));border-top:1px solid var(--border);background:var(--bg2)}
        @media(prefers-reduced-motion:no-preference){.teaser-inner{animation:teaser-fade .35s ease both}}
        @keyframes teaser-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .teaser-root button:focus-visible{outline:3px solid var(--amber);outline-offset:3px}
      `}</style>
      <div className="teaser-bg" aria-hidden="true"/>
      <div className="teaser-scroll">
        <div className="teaser-inner">
          <div className="teaser-kicker">🎬 Trailer</div>
          <h2 className="teaser-title">{title}</h2>
          <div className="teaser-text">{text}</div>
        </div>
      </div>
      <div className="teaser-actions">
        <Btn onClick={onWatch} variant="gold" size="lg">{buttonLabel}</Btn>
        <Btn onClick={onSkip} variant="ghost" size="lg">Skip</Btn>
      </div>
    </div>
  );
};
const ICONS=["📍","🍺","🏎️","🎯","🧠","🍽️","🍝","🍹","🎳","🔐","🎤","🎲","🏆","🚗","🎉","🍻","🎸","🏄","⚽","🎾","🎨","🎭"];
const TROPHY_ICONS=["🏆","🥇","🥈","🥉","🎯","🧠","🍺","😴","😅","📸","🎤","🏎️","🔐","🎳","🎲","👑","💀","🤡","🎖️","⚡","🦆","🐐"];
const REACTIONS=["🍺","😂","❤️","🔥","👑"];
const HIGHLIGHT_EMOJIS=["✨","😂","😬","🎷","🍰","🚗","🎯","🏆","🍺","🤦","👀","💀","🐐","🔥","❤️","🎉"];

const SEED_EVENTS=[
  {
    id:"evt-2023",name:"Mensday 2023",type:"day",date:"2023-09-09",start_time:"12:00",end_time:"23:00",
    location:"Amsterdam",description:"The sixth edition. Legendary go-karting afternoon.",theme:"Racing Edition",archived:true,
    attendees:[{name:"Doom",status:"went"},{name:"Bram",status:"went"},{name:"Sander",status:"went"},{name:"Tim",status:"went"},{name:"Ruben",status:"absent"},{name:"Daan",status:"went"}],
    schedule:[
      {time:"12:00",activity:"Arrival & welcome beers",location:"Café de Kroeg, Leidseplein",locationUrl:"",icon:"🍺",note:""},
      {time:"14:00",activity:"Go-karting",location:"Karting Amsterdam Noord",locationUrl:"",icon:"🏎️",note:"Teams of 2"},
      {time:"17:30",activity:"Pub quiz",location:"The Minds, Spui",locationUrl:"",icon:"🧠",note:""},
      {time:"19:30",activity:"Dinner",location:"Trattoria Roma, Jordaan",locationUrl:"",icon:"🍝",note:"3-course set menu"},
      {time:"22:00",activity:"Bar crawl",location:"Leidseplein area",locationUrl:"",icon:"🍻",note:""},
    ],
    faqs:[],polls:[],photos:[],quizzes:[
      {id:"q1",title:"General Knowledge 2023",status:"finished",questions:[
        {q:"What year was the first Mensday?",options:["2017","2018","2016","2019"],answer:2,points:100},
        {q:"How many countries are in the EU?",options:["25","27","30","28"],answer:1,points:100},
        {q:"Who won the 2022 World Cup?",options:["France","Brazil","Argentina","Germany"],answer:2,points:100},
      ],scores:{"Doom":200,"Bram":300,"Tim":100,"Sander":300,"Daan":200}},
    ],
    winners:[
      {id:"w1",category:"🏆 Overall Champion",winner:"Doom",detail:"Dominated go-karting AND won the pub quiz.",icon:"🏆"},
      {id:"w2",category:"😴 First to Bed",winner:"Sander",detail:"Gone by 11pm. Classic.",icon:"😴"},
      {id:"w3",category:"🍺 Last Man Standing",winner:"Bram",detail:"Still going at 2am.",icon:"🍺"},
    ],
    highlights:[
      {id:"h1",text:"Doom claimed his kart had a technical disadvantage but still finished first.",emoji:"🏎️"},
      {id:"h2",text:"The waiter brought out free tiramisu after we sang happy birthday to nobody.",emoji:"🍰"},
    ],
  },
  {
    id:"evt-2024",name:"Mensday 2024",type:"day",date:"2024-09-14",start_time:"13:00",end_time:"23:30",
    location:"Rotterdam",description:"The seventh edition. Escape room & rooftop dinner.",theme:"",archived:true,
    attendees:[{name:"Doom",status:"went"},{name:"Bram",status:"went"},{name:"Sander",status:"absent"},{name:"Tim",status:"went"},{name:"Ruben",status:"went"},{name:"Daan",status:"went"}],
    schedule:[
      {time:"13:00",activity:"Lunch",location:"De Markthal",locationUrl:"",icon:"🥗",note:""},
      {time:"15:00",activity:"Escape room",location:"Sherlocked Rotterdam",locationUrl:"",icon:"🔐",note:"We failed with 4 min left"},
      {time:"17:30",activity:"Rooftop drinks",location:"Hotel New York",locationUrl:"",icon:"🍹",note:""},
      {time:"20:00",activity:"Dinner",location:"FG Restaurant",locationUrl:"",icon:"🍷",note:"Michelin star"},
    ],
    faqs:[],polls:[],photos:[],quizzes:[],
    winners:[
      {id:"w1",category:"🔐 Escape Room MVP",winner:"Tim",detail:"Cracked 3 of the 5 puzzles.",icon:"🔐"},
      {id:"w2",category:"😅 Most Useless",winner:"Ruben",detail:"Stood reading the same clue for 20 minutes.",icon:"😅"},
    ],
    highlights:[
      {id:"h1",text:"We failed the escape room but convinced ourselves we 'almost' had it. Staff said everyone says that.",emoji:"🔐"},
      {id:"h2",text:"The rooftop bar had a live jazz trio. Nobody planned this. Perfect.",emoji:"🎷"},
    ],
  },
  {
    id:"evt-2025",name:"Mensday 2025",type:"day",date:"2025-09-13",start_time:"12:00",end_time:"",
    location:"TBD",description:"The eighth edition. Planning in progress!",theme:"",archived:false,
    attendees:[{name:"Doom",status:"going"},{name:"Bram",status:"going"},{name:"Sander",status:"maybe"},{name:"Tim",status:"going"},{name:"Ruben",status:"not coming"},{name:"Daan",status:"going"}],
    schedule:[
      {time:"12:00",activity:"Arrival",location:"TBD",locationUrl:"",icon:"📍",note:""},
      {time:"14:00",activity:"Activity (vote!)",location:"TBD",locationUrl:"",icon:"🎯",note:""},
      {time:"19:00",activity:"Dinner (vote!)",location:"TBD",locationUrl:"",icon:"🍽️",note:""},
      {time:"21:00",activity:"Bar crawl",location:"TBD",locationUrl:"",icon:"🍻",note:""},
    ],
    faqs:[
      {id:"faq1",question:"What time does it kick off?",askedBy:"Bram",askedAt:"2025-06-01T10:00:00Z",answer:"We're aiming for 12:00. Keep an eye on the schedule tab for updates.",answeredBy:"Doom",answeredAt:"2025-06-01T11:30:00Z"},
      {id:"faq2",question:"Do we need to bring cash?",askedBy:"Tim",askedAt:"2025-06-03T09:00:00Z",answer:null,answeredBy:null,answeredAt:null},
    ],polls:[
      {id:"p1",title:"What should we eat?",emoji:"🍽️",closed:false,options:[{label:"BBQ at the park",votes:["Doom","Tim","Daan"]},{label:"Indonesian Rijsttafel",votes:[]},{label:"Italian — pasta & wine",votes:["Bram"]},{label:"Steakhouse",votes:["Sander"]}]},
      {id:"p2",title:"Which activity?",emoji:"🎯",closed:false,options:[{label:"Laser tag",votes:["Doom","Tim"]},{label:"Bowling",votes:["Sander"]},{label:"Padel tennis",votes:["Daan"]},{label:"Axe throwing",votes:["Bram"]}]},
    ],
    photos:[],quizzes:[],winners:[],highlights:[],
  },
];

const SEED_USERS=[
  {id:"u-admin",username:"Doom",pin:"1234",role:"admin",joined_at:"2023-01-01",avatar:0},
];

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SCREENS
// ─────────────────────────────────────────────────────────────────────────────
const AuthShell = ({children}) => (
  <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem",background:"var(--bg)"}}>
    <GS/><div style={{width:"100%",maxWidth:420}}>
      <div style={{textAlign:"center",marginBottom:"2rem"}}>
        <div style={{fontSize:"3.2rem",marginBottom:".4rem"}}>🍺</div>
        <div style={{fontFamily:"var(--font-h)",fontSize:"2.2rem",color:"var(--amber2)"}}>MensApp</div>
        <div style={{color:"var(--muted)",fontSize:".8rem",letterSpacing:".08em",marginTop:4}}>THE ANNUAL GATHERING</div>
      </div>
      {children}
    </div>
  </div>
);

const LoginScreen = ({users,onLogin,onGoRegister}) => {
  const [username,setUsername]=useState("");
  const [pin,setPin]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const submit=async()=>{
    setErr("");setLoading(true);
    const pinH=await hashPin(pin);
    const u=users.find(u=>u.username.toLowerCase()===username.trim().toLowerCase()&&u.pin_hash===pinH);
    if(!u){setErr("Wrong username or PIN.");setLoading(false);return;}
    if(u.role==="pending"){setErr("Your account is awaiting admin approval. Hang tight!");setLoading(false);return;}
    onLogin(u);setLoading(false);
  };
  return (
    <AuthShell>
      <Card className="fu" style={{padding:"2rem"}}>
        <H size="1.5rem" style={{textAlign:"center"}}>Welcome back</H>
        <div style={{display:"grid",gap:".9rem"}}>
          <div><Lbl>Username</Lbl><Inp value={username} onChange={e=>setUsername(e.target.value)} placeholder="Your name" autoFocus/></div>
          <div><Lbl>PIN</Lbl><Inp value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••" type="password" onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
          {err&&<div style={{background:"rgba(224,85,85,.1)",border:"1px solid rgba(224,85,85,.3)",borderRadius:"var(--radius-sm)",padding:"9px 13px",color:"var(--red)",fontSize:".83rem"}}>{err}</div>}
          <Btn onClick={submit} disabled={loading||!username||!pin} style={{marginTop:4}}>{loading?"Logging in…":"Log In"}</Btn>
        </div>
      </Card>
      <div style={{textAlign:"center",marginTop:"1.2rem",color:"var(--muted)",fontSize:".83rem"}}>
        New here?{" "}<span onClick={onGoRegister} style={{color:"var(--amber)",cursor:"pointer",textDecoration:"underline"}}>Request access</span>
      </div>
    </AuthShell>
  );
};

const RegisterScreen = ({users,onRegister,onGoLogin}) => {
  const [username,setUsername]=useState("");
  const [pin,setPin]=useState("");
  const [pin2,setPin2]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const submit=async()=>{
    setErr("");
    if(username.trim().length<2){setErr("Gebruikersnaam moet minimaal 2 tekens zijn.");return;}
    if(users.find(u=>u.username.toLowerCase()===username.trim().toLowerCase())){setErr("Deze naam is al bezet.");return;}
    if(pin.length<4){setErr("PIN moet minimaal 4 cijfers zijn.");return;}
    if(pin!==pin2){setErr("PINs komen niet overeen.");return;}
    setLoading(true);
    const pinH=await hashPin(pin);
    const errMsg=await onRegister({id:`u-${Date.now()}`,username:username.trim(),pin_hash:pinH,role:"pending",joined_at:new Date().toISOString(),avatar:Math.floor(Math.random()*8)});
    setLoading(false);
    if(!errMsg)setDone(true);
    else setErr("Fout: "+errMsg);
  };
  if(done)return(
    <AuthShell>
      <Card className="fu" style={{padding:"2rem",textAlign:"center"}}>
        <div style={{fontSize:"3rem",marginBottom:"1rem"}}>⏳</div>
        <H size="1.4rem">Aanvraag verstuurd!</H>
        <p style={{color:"var(--muted)",fontSize:".88rem",lineHeight:1.7,marginBottom:"1.5rem"}}>Je account wacht op goedkeuring van de admin. Log daarna in met je gebruikersnaam en PIN.</p>
        <Btn onClick={onGoLogin} variant="ghost">Terug naar inloggen</Btn>
      </Card>
    </AuthShell>
  );
  return(
    <AuthShell>
      <Card className="fu" style={{padding:"2rem"}}>
        <H size="1.5rem" style={{textAlign:"center"}}>Toegang aanvragen</H>
        <p style={{color:"var(--muted)",fontSize:".83rem",textAlign:"center",marginBottom:"1.4rem",marginTop:"-.4rem"}}>Kies een gebruikersnaam & PIN. Een admin keurt je account goed.</p>
        <div style={{display:"grid",gap:".9rem"}}>
          <div><Lbl>Gebruikersnaam</Lbl><Inp value={username} onChange={e=>setUsername(e.target.value)} placeholder="Je voornaam of bijnaam" autoFocus/></div>
          <div><Lbl>PIN (4–6 cijfers)</Lbl><Inp value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••" type="password"/></div>
          <div><Lbl>PIN bevestigen</Lbl><Inp value={pin2} onChange={e=>setPin2(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="••••" type="password" onKeyDown={e=>e.key==="Enter"&&!loading&&submit()}/></div>
          {err&&<div style={{background:"rgba(224,85,85,.1)",border:"1px solid rgba(224,85,85,.3)",borderRadius:"var(--radius-sm)",padding:"9px 13px",color:"var(--red)",fontSize:".83rem"}}>{err}</div>}
          <Btn onClick={submit} disabled={!username||!pin||!pin2||loading} style={{marginTop:4}}>{loading?"Bezig…":"Toegang aanvragen"}</Btn>
        </div>
      </Card>
      <div style={{textAlign:"center",marginTop:"1.2rem",color:"var(--muted)",fontSize:".83rem"}}>
        Al goedgekeurd?{" "}<span onClick={onGoLogin} style={{color:"var(--amber)",cursor:"pointer",textDecoration:"underline"}}>Inloggen</span>
      </div>
    </AuthShell>
  );
};

const PendingScreen = ({user,onLogout}) => (
  <AuthShell>
    <Card className="fu" style={{padding:"2rem",textAlign:"center"}}>
      <div style={{fontSize:"3rem",marginBottom:"1rem"}}>⏳</div>
      <H size="1.4rem">Pending Approval</H>
      <p style={{color:"var(--muted)",fontSize:".88rem",lineHeight:1.7,marginBottom:"1.5rem"}}>Hey <strong style={{color:"var(--cream)"}}>{user.username}</strong> — your account is waiting for admin approval. Nag the group chat.</p>
      <Btn onClick={onLogout} variant="ghost">Log Out</Btn>
    </Card>
  </AuthShell>
);

// ─────────────────────────────────────────────────────────────────────────────
// NAV
// ─────────────────────────────────────────────────────────────────────────────
// Nav-only responsive tiers -- deliberately independent of `useIsMobile`
// above (that hook drives several *other*, unrelated components at a 640px
// threshold; this fix must not perturb those). Three tiers close the
// 768-1000px dead zone where the old 10-button row silently clipped items
// off-screen (measured in-browser 2026-08-24, nav rework brief): "full"
// shows icon+label, "compact" drops labels to icon-only (with accessible
// names via aria-label), "mobile" hands off to the existing hamburger,
// unchanged.
const NAV_MOBILE_BP=768, NAV_COMPACT_BP=1000;
const useNavTier = () => {
  // Duplicated (not shared via a helper referenced from the effect) on
  // purpose, matching `useIsMobile` above -- a named helper closed over by
  // the resize listener would trip `react-hooks/exhaustive-deps` since
  // it's re-created every render.
  const [tier,setTier]=useState(()=>{
    if(typeof window==="undefined")return"full";
    const w=window.innerWidth;
    return w<NAV_MOBILE_BP?"mobile":w<NAV_COMPACT_BP?"compact":"full";
  });
  useEffect(()=>{
    const h=()=>{
      const w=window.innerWidth;
      setTier(w<NAV_MOBILE_BP?"mobile":w<NAV_COMPACT_BP?"compact":"full");
    };
    window.addEventListener("resize",h);
    return()=>window.removeEventListener("resize",h);
  },[]);
  return tier;
};
// Hand-rolled dropdown primitive for the Tools/Account menus (no menu
// library per project constraints -- this is the APG "disclosure" pattern,
// not a full ARIA menu, so plain Tab/Enter/Space already operates it):
// closes on outside click and on Escape, and Escape returns focus to the
// trigger so keyboard users don't lose their place.
const useNavDropdown = () => {
  const [open,setOpen]=useState(false);
  const rootRef=useRef(null);
  const triggerRef=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const onDocClick=e=>{if(rootRef.current&&!rootRef.current.contains(e.target))setOpen(false);};
    const onKey=e=>{if(e.key==="Escape"){setOpen(false);triggerRef.current?.focus();}};
    document.addEventListener("click",onDocClick);
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("click",onDocClick);document.removeEventListener("keydown",onKey);};
  },[open]);
  return{open,setOpen,rootRef,triggerRef};
};
const Nav = ({view,eventName,onBack,currentUser,onLogout,onAdmin,onHof,onHome,onMembers,onAnnounce,pendingCount,notifications,notifLastRead,onUpdates,onProfile,onTeams,onTimer,onQuiz,onMensGames,mensGamesUnlocked,onSaraJay,saraJayUnlocked}) => {
  const [menuOpen,setMenuOpen]=useState(false);
  const tier=useNavTier();
  const compact=tier!=="full";
  const tools=useNavDropdown();
  const account=useNavDropdown();
  const unread=notifications.filter(n=>n.timestamp>notifLastRead).length;
  const displayName=currentUser.display_name||currentUser.username;
  const isAdmin=can.manageUsers(currentUser);
  const canAnnounce=can.announce(currentUser);
  const toolsActive=view==="teams"||view==="timer"||view==="quiz"||view==="mensgames"||view==="sarajay";
  useEffect(()=>{
    if(!menuOpen)return;
    const close=()=>setMenuOpen(false);
    document.addEventListener("click",close);
    return()=>document.removeEventListener("click",close);
  },[menuOpen]);
  const bellBtn=(mobile=false)=>(
    <button onClick={onUpdates} aria-label="Updates" className="nav-btn" style={{position:"relative",background:view==="updates"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--cream)",padding:mobile?"6px 10px":"0 10px",minHeight:mobile?undefined:44,minWidth:mobile?undefined:44,display:mobile?undefined:"inline-flex",alignItems:mobile?undefined:"center",justifyContent:mobile?undefined:"center",cursor:"pointer",fontSize:mobile?"1rem":".95rem",fontFamily:"var(--font-b)",fontWeight:600,flexShrink:0}}>
      📬{unread>0&&<span style={{position:"absolute",top:-2,right:-2,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{unread}</span>}
    </button>
  );
  // Icon+label direct link, used for the two always-visible destinations
  // (Lads, Hall of Fame). Drops its text label at the compact tier but
  // keeps an aria-label so the accessible name never changes with width.
  const navLink=(icon,label,active,onClick)=>(
    <button key={label} onClick={onClick} aria-label={label} className="nav-btn" style={{background:active?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:compact?"0 10px":"0 12px",minHeight:44,minWidth:44,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600,flexShrink:0}}>
      <span aria-hidden="true">{icon}</span>{!compact&&<span>{label}</span>}
    </button>
  );
  // Shared row style for items inside the Tools/Account dropdown panels --
  // these always show full icon+text regardless of tier (the panel itself
  // is only ever rendered on demand, so it never contributes to the
  // 768-1000px clipping the rest of Nav had to solve for).
  const menuItemStyle=(active,locked=false)=>({background:active?"rgba(232,148,58,.12)":"transparent",border:"none",borderRadius:8,color:locked?"var(--muted)":"var(--amber2)",padding:"10px 12px",minHeight:44,display:"flex",alignItems:"center",gap:8,cursor:locked?"not-allowed":"pointer",fontSize:".85rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left",width:"100%",opacity:locked?.55:1});
  const menuPanelStyle={position:"absolute",top:"calc(100% + 8px)",right:0,minWidth:210,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:6,display:"grid",gap:4,boxShadow:"0 12px 32px rgba(0,0,0,.5)",zIndex:210};
  return(
    <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:200,background:"rgba(15,11,7,.94)",backdropFilter:"blur(14px)",borderBottom:"1px solid var(--border)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 1.2rem",height:58,gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1}}>
          {view!=="home"&&<button onClick={onBack} className="nav-btn" style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--muted)",padding:"5px 12px",cursor:"pointer",fontSize:".8rem",fontFamily:"var(--font-b)",flexShrink:0}}>← Terug</button>}
          <div onClick={onHome} onMouseEnter={e=>e.currentTarget.style.opacity=".72"} onMouseLeave={e=>e.currentTarget.style.opacity=""} style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--amber)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",cursor:"pointer",transition:"opacity .15s"}}>
            {view==="home"?"🍺 MensApp":view==="hof"?"🏅 Hall of Fame":view==="members"?"👥 Lads":view==="updates"?"📬 Updates":view==="teams"?"🎲 Team Creator":view==="timer"?"⏱ Timer":view==="quiz"?"🧠 Quiz":view==="mensgames"?"🏆 Mens-Games":view==="sarajay"?"🤖 Sara Jay":eventName}
          </div>
        </div>
        {tier!=="mobile"&&(
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {navLink("👥","Lads",view==="members"||view==="member",onMembers)}
            {navLink("🏅","Hall of Fame",view==="hof",onHof)}
            <div ref={tools.rootRef} style={{position:"relative"}}>
              <button ref={tools.triggerRef} onClick={e=>{e.stopPropagation();tools.setOpen(o=>!o);}} aria-expanded={tools.open} aria-controls="nav-tools-menu" aria-label="Tools menu" className="nav-btn" style={{background:toolsActive?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:compact?"0 10px":"0 12px",minHeight:44,minWidth:44,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600}}>
                <span aria-hidden="true">🧰</span>{!compact&&<span>Tools</span>}<span aria-hidden="true" style={{fontSize:".65rem"}}>▾</span>
              </button>
              {tools.open&&(
                <div id="nav-tools-menu" style={menuPanelStyle}>
                  <button onClick={()=>{onTeams();tools.setOpen(false);}} className="nav-btn" style={menuItemStyle(view==="teams")}>🎲 Team Creator</button>
                  <button onClick={()=>{onTimer();tools.setOpen(false);}} className="nav-btn" style={menuItemStyle(view==="timer")}>⏱ Timer</button>
                  <button onClick={()=>{onQuiz();tools.setOpen(false);}} className="nav-btn" style={menuItemStyle(view==="quiz")}>🧠 Quiz</button>
                  {/* Locked mens-games gets a recognisable "🔒 Mens-Games" label, not
                      the Sara Jay "🔒 ???" mystery treatment -- mens-games is just
                      a feature not yet switched on, Sara Jay is a deliberate
                      surprise. Owner-flagged ambiguity, 2026-08-21; same
                      distinction now lives inside Tools. */}
                  <button onClick={mensGamesUnlocked?()=>{onMensGames();tools.setOpen(false);}:undefined} disabled={!mensGamesUnlocked} className={mensGamesUnlocked?"nav-btn":undefined} style={menuItemStyle(view==="mensgames",!mensGamesUnlocked)}>{mensGamesUnlocked?"🏆 Mens-Games":"🔒 Mens-Games"}</button>
                  <button onClick={saraJayUnlocked?()=>{onSaraJay();tools.setOpen(false);}:undefined} disabled={!saraJayUnlocked} className={saraJayUnlocked?"nav-btn":undefined} style={menuItemStyle(view==="sarajay",!saraJayUnlocked)}>{saraJayUnlocked?"🤖 Sara Jay":"🔒 ???"}</button>
                </div>
              )}
            </div>
            {bellBtn()}
            <div ref={account.rootRef} style={{position:"relative"}}>
              <button ref={account.triggerRef} onClick={e=>{e.stopPropagation();account.setOpen(o=>!o);}} aria-expanded={account.open} aria-controls="nav-account-menu" aria-label={`${displayName} — account menu`} className="nav-btn" style={{position:"relative",display:"flex",alignItems:"center",gap:7,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:compact?"0 8px":"0 10px",minHeight:44,cursor:"pointer"}}>
                <Avatar name={currentUser.username} size={22} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
                {!compact&&<span style={{fontSize:".8rem",color:"var(--cream)"}}>{displayName}</span>}
                {!compact&&<RoleBadge role={currentUser.role}/>}
                <span aria-hidden="true" style={{fontSize:".65rem",color:"var(--muted)"}}>▾</span>
                {isAdmin&&pendingCount>0&&<span aria-hidden="true" style={{position:"absolute",top:-6,right:-6,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingCount}</span>}
              </button>
              {account.open&&(
                <div id="nav-account-menu" style={menuPanelStyle}>
                  <button onClick={()=>{onProfile();account.setOpen(false);}} className="nav-btn" style={menuItemStyle(false)}>👤 Profile</button>
                  {canAnnounce&&<button onClick={()=>{onAnnounce();account.setOpen(false);}} className="nav-btn" style={menuItemStyle(false)}>📢 Announce</button>}
                  {isAdmin&&<button onClick={()=>{onAdmin();account.setOpen(false);}} className="nav-btn" style={{...menuItemStyle(false),position:"relative"}}>⚙ Admin{pendingCount>0&&<span style={{background:"var(--red)",color:"#fff",borderRadius:"50%",minWidth:18,height:18,padding:"0 4px",fontSize:".65rem",fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",marginLeft:"auto"}}>{pendingCount}</span>}</button>}
                  <div style={{height:1,background:"var(--border)",margin:"2px 0"}}/>
                  <button onClick={()=>{onLogout();account.setOpen(false);}} className="nav-logout" style={{...menuItemStyle(false),color:"var(--red)"}}>Uitloggen</button>
                </div>
              )}
            </div>
          </div>
        )}
        {tier==="mobile"&&(
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {bellBtn(true)}
            <button onClick={e=>{e.stopPropagation();setMenuOpen(o=>!o);}} className="nav-btn" style={{position:"relative",background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--cream)",padding:"6px 11px",cursor:"pointer",fontSize:"1.1rem",lineHeight:1}}>
              {menuOpen?"✕":"☰"}{!menuOpen&&pendingCount>0&&<span style={{position:"absolute",top:-7,right:-7,background:"var(--red)",color:"#fff",borderRadius:"50%",width:17,height:17,fontSize:".65rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingCount}</span>}
            </button>
          </div>
        )}
      </div>
      {tier==="mobile"&&menuOpen&&(
        <div onClick={e=>e.stopPropagation()} style={{background:"rgba(15,11,7,.98)",borderBottom:"1px solid var(--border)",padding:".8rem 1.2rem",display:"grid",gap:".5rem"}}>
          <button onClick={()=>{onMembers();setMenuOpen(false);}} className="nav-btn" style={{background:(view==="members"||view==="member")?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>👥 Lads</button>
          <button onClick={()=>{onHof();setMenuOpen(false);}} className="nav-btn" style={{background:view==="hof"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>🏅 Hall of Fame</button>
          <button onClick={()=>{onTeams();setMenuOpen(false);}} className="nav-btn" style={{background:view==="teams"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>🎲 Team Creator</button>
          <button onClick={()=>{onTimer();setMenuOpen(false);}} className="nav-btn" style={{background:view==="timer"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>⏱ Timer</button>
          <button onClick={()=>{onQuiz();setMenuOpen(false);}} className="nav-btn" style={{background:view==="quiz"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>🧠 Quiz</button>
          {/* Same "recognisable, not mysterious" locked label as the desktop
              button above. */}
          <button onClick={mensGamesUnlocked?()=>{onMensGames();setMenuOpen(false);}:undefined} className="nav-btn" style={{background:view==="mensgames"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:mensGamesUnlocked?"var(--amber2)":"var(--muted)",padding:"10px 14px",cursor:mensGamesUnlocked?"pointer":"not-allowed",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left",opacity:mensGamesUnlocked?1:.55}}>{mensGamesUnlocked?"🏆 Mens-Games":"🔒 Mens-Games"}</button>
          <button onClick={saraJayUnlocked?()=>{onSaraJay();setMenuOpen(false);}:undefined} className="nav-btn" style={{background:view==="sarajay"?"rgba(232,148,58,.15)":"transparent",border:"1px solid var(--border)",borderRadius:8,color:saraJayUnlocked?"var(--amber2)":"var(--muted)",padding:"10px 14px",cursor:saraJayUnlocked?"pointer":"not-allowed",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left",opacity:saraJayUnlocked?1:.55}}>{saraJayUnlocked?"🤖 Sara Jay or JAI":"🔒 ???"}</button>
          {can.announce(currentUser)&&<button onClick={()=>{onAnnounce();setMenuOpen(false);}} className="nav-btn" style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber2)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left"}}>📢 Announce</button>}
          {can.manageUsers(currentUser)&&<button onClick={()=>{onAdmin();setMenuOpen(false);}} className="nav-btn" style={{background:"transparent",border:"1px solid var(--border)",borderRadius:8,color:"var(--amber)",padding:"10px 14px",cursor:"pointer",fontSize:".88rem",fontFamily:"var(--font-b)",fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:8}}>⚙ Admin{pendingCount>0&&<span style={{background:"var(--red)",color:"#fff",borderRadius:"50%",width:20,height:20,fontSize:".7rem",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{pendingCount}</span>}</button>}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"8px 14px"}}>
            <div onClick={()=>{onProfile();setMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",flex:1,minWidth:0}}><Avatar name={currentUser.username} size={26} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/><span style={{fontSize:".88rem",color:"var(--cream)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser.display_name||currentUser.username}</span><RoleBadge role={currentUser.role}/></div>
            <button onClick={()=>{onLogout();setMenuOpen(false);}} className="nav-logout" style={{background:"transparent",border:"1px solid rgba(224,85,85,.3)",borderRadius:8,color:"var(--red)",padding:"6px 12px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600,transition:"all .18s ease",flexShrink:0,marginLeft:8}}>Uitloggen</button>
          </div>
        </div>
      )}
    </nav>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────────────────────
const AdminPanel = ({users,onUpdateUsers,onDeleteUser,onClose,saraJayUnlocked,onToggleSaraJay,mensGamesUnlocked,onToggleMensGames}) => {
  const [tab,setTab]=useState("pending");
  const pending=users.filter(u=>u.role==="pending");
  const approved=users.filter(u=>u.role!=="pending");
  const setRole=(id,newBaseRole)=>onUpdateUsers(users.map(u=>{
    if(u.id!==id)return u;
    const keepOrg=hasOrg(u);
    let role=newBaseRole;
    if(keepOrg&&newBaseRole==="admin")role="admin+org";
    if(keepOrg&&(newBaseRole==="lad"||newBaseRole==="member"))role="org";
    return{...u,role};
  }));
  const toggleOrg=id=>onUpdateUsers(users.map(u=>{
    if(u.id!==id)return u;
    const wasOrg=hasOrg(u);const isAdm=hasAdmin(u);
    const role=wasOrg?(isAdm?"admin":"lad"):(isAdm?"admin+org":"org");
    return{...u,role};
  }));
  const reject=id=>onDeleteUser(id);
  const remove=id=>{if(window.confirm("Remove this user?"))onDeleteUser(id);};
  const tabBtn=(t,label)=>(
    <TabBtn key={t} active={tab===t} onClick={()=>setTab(t)} style={{padding:"7px 16px",fontSize:".85rem"}}>
      {label}{t==="pending"&&pending.length>0&&<span style={{background:"var(--red)",color:"#fff",borderRadius:10,padding:"1px 6px",fontSize:".68rem",marginLeft:6}}>{pending.length}</span>}
    </TabBtn>
  );
  return(
    <Modal onClose={onClose} maxWidth={600}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem"}}>
        <H style={{marginBottom:0}}>⚙ Admin Panel</H>
        <Btn onClick={onClose} variant="ghost" size="sm">✕ Close</Btn>
      </div>
      {pending.length>0&&<div style={{background:"rgba(232,148,58,.1)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",padding:"10px 14px",marginBottom:"1.2rem",display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:"1.2rem"}}>⏳</span><span style={{color:"var(--amber2)",fontSize:".88rem",fontWeight:600}}>{pending.length} pending approval{pending.length>1?"s":""}</span></div>}
      <div style={{display:"flex",gap:".3rem",borderBottom:"1px solid var(--border)",marginBottom:"1.2rem"}}>
        {tabBtn("pending","Pending")}{tabBtn("users","All Users")}{tabBtn("features","🎮 Features")}
      </div>
      {tab==="pending"&&<div style={{display:"grid",gap:".8rem"}}>
        {pending.length===0&&<div style={{color:"var(--muted)",fontSize:".88rem",textAlign:"center",padding:"2rem"}}>No pending requests 🎉</div>}
        {pending.map(u=>(
          <div key={u.id} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:"1rem 1.1rem",display:"flex",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
            <Avatar name={u.username} size={36} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
            <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".95rem"}}>{u.username}</div><div style={{color:"var(--muted)",fontSize:".75rem"}}>Requested {new Date(u.joined_at).toLocaleDateString("nl-NL")}</div></div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <Btn onClick={()=>setRole(u.id,"lad")} variant="success" size="sm">✓ Lad</Btn>
              <Btn onClick={()=>onUpdateUsers(users.map(u2=>u2.id===u.id?{...u2,role:"org"}:u2))} variant="ghost" size="sm" style={{color:"var(--purple)",borderColor:"rgba(155,127,232,.4)",fontSize:".73rem"}}>★ Org</Btn>
              <Btn onClick={()=>setRole(u.id,"admin")} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"var(--border2)",fontSize:".73rem"}}>★ Admin</Btn>
              <Btn onClick={()=>reject(u.id)} variant="danger" size="sm">✕</Btn>
            </div>
          </div>
        ))}
      </div>}
      {tab==="features"&&<div style={{display:"grid",gap:"1rem"}}>
        <div style={{fontSize:".75rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:".2rem"}}>Mini Games</div>
        <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"1rem 1.2rem",display:"flex",alignItems:"center",gap:"1rem"}}>
          <div style={{fontSize:"2rem"}}>🤖</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:600,fontSize:".95rem",color:"var(--cream)"}}>Sara Jay or Sara JAI</div>
            <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:2}}>Real vs AI guessing game · Streak-based arcade</div>
          </div>
          <button onClick={onToggleSaraJay}
            style={{padding:"8px 18px",borderRadius:50,border:"none",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:700,fontSize:".82rem",transition:"all .18s ease",
              background:saraJayUnlocked?"rgba(76,175,125,.18)":"rgba(232,148,58,.12)",
              color:saraJayUnlocked?"var(--green)":"var(--amber)",
              boxShadow:saraJayUnlocked?"0 0 0 1.5px rgba(76,175,125,.4)":"0 0 0 1.5px rgba(232,148,58,.3)"}}>
            {saraJayUnlocked?"🔓 Live":"🔒 Locked"}
          </button>
        </div>
        <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"1rem 1.2rem",display:"flex",alignItems:"center",gap:"1rem"}}>
          <div style={{fontSize:"2rem"}}>🏆</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:600,fontSize:".95rem",color:"var(--cream)"}}>Mens-Games</div>
            <div style={{fontSize:".75rem",color:"var(--muted)",marginTop:2}}>Toernooien bouwen, live scoren, klassement bijhouden</div>
          </div>
          <button onClick={onToggleMensGames}
            style={{padding:"8px 18px",borderRadius:50,border:"none",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:700,fontSize:".82rem",transition:"all .18s ease",
              background:mensGamesUnlocked?"rgba(76,175,125,.18)":"rgba(232,148,58,.12)",
              color:mensGamesUnlocked?"var(--green)":"var(--amber)",
              boxShadow:mensGamesUnlocked?"0 0 0 1.5px rgba(76,175,125,.4)":"0 0 0 1.5px rgba(232,148,58,.3)"}}>
            {mensGamesUnlocked?"🔓 Live":"🔒 Locked"}
          </button>
        </div>
      </div>}
      {tab==="users"&&<div style={{display:"grid",gap:".7rem"}}>
        {approved.map(u=>(
          <div key={u.id} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",display:"flex",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
            <Avatar name={u.username} size={32} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{fontWeight:600,fontSize:".92rem"}}>{u.username}</span><RoleBadge role={u.role}/></div>
              <div style={{color:"var(--muted)",fontSize:".73rem",marginTop:2}}>Joined {new Date(u.joined_at).toLocaleDateString("nl-NL")}</div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {hasAdmin(u)
                ?<Btn onClick={()=>setRole(u.id,"lad")} variant="ghost" size="sm" style={{fontSize:".73rem"}}>↓ Lad</Btn>
                :<Btn onClick={()=>setRole(u.id,"admin")} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"rgba(232,148,58,.4)",fontSize:".73rem"}}>→ Admin</Btn>}
              <Btn onClick={()=>toggleOrg(u.id)} variant="ghost" size="sm" style={{color:hasOrg(u)?"var(--purple)":"var(--muted2)",borderColor:hasOrg(u)?"rgba(155,127,232,.45)":"var(--border)",fontSize:".73rem"}}>
                {hasOrg(u)?"★ Org":"☆ Org"}
              </Btn>
              <Btn onClick={()=>remove(u.id)} variant="danger" size="sm" style={{fontSize:".73rem"}}>✕</Btn>
            </div>
          </div>
        ))}
      </div>}
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// HALL OF FAME
// ─────────────────────────────────────────────────────────────────────────────
const HallOfFame = ({events,users=[],teamSets=[],teamSetsError=null,onRetryTeamSets,quizResults=[]}) => {
  const allAttendees = {};
  const allWins = {};
  let totalEvents = events.length;

  events.forEach(evt=>{
    evt.attendees.forEach(a=>{
      if(!allAttendees[a.name]) allAttendees[a.name]={name:a.name,attended:0,missed:0,events:[]};
      if(["went","going"].includes(a.status)){allAttendees[a.name].attended++;allAttendees[a.name].events.push(evt.id);}
      else if(["absent","not coming"].includes(a.status)) allAttendees[a.name].missed++;
    });
    (evt.winners||[]).forEach(w=>{
      if(!allWins[w.winner]) allWins[w.winner]={name:w.winner,count:0,awards:[]};
      allWins[w.winner].count++;
      allWins[w.winner].awards.push({...w,eventName:evt.name,eventDate:evt.date});
    });
  });

  const attendance = Object.values(allAttendees).sort((a,b)=>b.attended-a.attended);
  const winners = Object.values(allWins).sort((a,b)=>b.count-a.count);
  const perfect = attendance.filter(a=>a.attended===totalEvents&&totalEvents>0);

  // Quiz leaderboard across all events (docs/quiz-unification-spec.md §6/§8.3
  // item 2: per-person totals now read `memberScores` -- username-keyed for
  // both an individual quiz and a team one, where it's each member's share
  // of their team's final score. Was `scores` (name-keyed; for a team quiz
  // that's the *team's* name, so a lad's own username was never a key and
  // his teammates' win never showed up here at all) -- falls back to
  // `scores` only for a pre-Q6 finished quiz that has no `memberScores` yet,
  // so old data still renders exactly as it always has.
  // `countedQuizIds` also folds in `quizResults` (the `quizzes` table, WP-Q2)
  // without double-counting a quiz finished after WP-Q5's dual write --
  // needed because a standalone quiz (§14 decision 1) has no `events` entry
  // to ever have been scanned from at all.
  const quizScores = {};
  const countedQuizIds = new Set();
  const tallyQuizScores=quiz=>{
    if(quiz&&quiz.id)countedQuizIds.add(quiz.id);
    const ms=quiz.memberScores&&Object.keys(quiz.memberScores).length?quiz.memberScores:(quiz.scores||{});
    Object.entries(ms).forEach(([name,score])=>{
      if(!quizScores[name]) quizScores[name]={name,total:0,quizzes:0};
      quizScores[name].total+=score;
      quizScores[name].quizzes++;
    });
  };
  events.forEach(evt=>{
    (evt.quizzes||[]).filter(q=>q.status==="finished").forEach(tallyQuizScores);
  });
  (quizResults||[]).filter(q=>q&&q.status==="finished"&&!countedQuizIds.has(q.id)).forEach(tallyQuizScores);
  const quizBoard = Object.values(quizScores).sort((a,b)=>b.total-a.total);

  // #16 "other ideas" -- three genuinely fun categories built from data the
  // app already collects but never surfaces as a leaderboard: who's the
  // designated photographer, who's currently on a roll showing up, and the
  // running bar tally everyone already jokes about at KretjesTab. Picked
  // over e.g. poll participation or FAQ answers because these three read as
  // mates' bragging rights, not an analytics dashboard. All three walk
  // `events`/`teamSets` defensively -- both are hand-editable JSONB and
  // must not throw on a malformed row.

  // Lens Legend -- most photos uploaded across every event (photo.uploader,
  // written by PhotosTab's upload flow, never ranked anywhere today).
  const photoCounts = {};
  events.forEach(evt=>{
    (Array.isArray(evt.photos)?evt.photos:[]).forEach(p=>{
      if(!p||typeof p.uploader!=="string"||!p.uploader)return;
      photoCounts[p.uploader]=(photoCounts[p.uploader]||0)+1;
    });
  });
  const photographers=Object.entries(photoCounts).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);

  // All-time kretjes tally -- KretjesTab's per-event counter, summed. Not a
  // per-person leaderboard (kretjes aren't attributed to anyone individually)
  // -- a group bragging-rights number instead, in the same "mates at a bar"
  // register the rest of the app already uses for this feature.
  const totalKretjes=events.reduce((s,e)=>s+(Number.isFinite(e?.kretjes)?e.kretjes:0),0);

  // On a roll -- current *consecutive* attendance streak, walked backwards
  // from the most recent event. Distinct from "Perfect Attendance" above
  // (all-time, every event ever): this rewards showing up lately, so
  // someone who joined the group last year and hasn't missed one since gets
  // bragging rights too, right next to the old guard.
  const streakNames=new Set();
  events.forEach(evt=>(Array.isArray(evt.attendees)?evt.attendees:[]).forEach(a=>{if(a&&typeof a.name==="string"&&a.name)streakNames.add(a.name);}));
  const streaks=[...streakNames].map(name=>{
    let streak=0;
    for(let i=events.length-1;i>=0;i--){
      const att=(Array.isArray(events[i]?.attendees)?events[i].attendees:[]).find(a=>a&&a.name===name);
      if(att&&["went","going"].includes(att.status))streak++;
      else break;
    }
    return{name,streak};
  }).filter(s=>s.streak>=2).sort((a,b)=>b.streak-a.streak);

  // Team trophy cabinet (#16 §6.4) -- team sets carrying at least one
  // TeamAward (written by `finishTournament`, WP-J -- or hand-added later
  // via the library). `awards`/`teams` are both hand-editable JSONB,
  // guarded the same way as everything else here.
  const decoratedSets=(Array.isArray(teamSets)?teamSets:[]).filter(ts=>ts&&Array.isArray(ts.awards)&&ts.awards.filter(a=>a&&typeof a==="object").length>0);

  const podiumColors = ["var(--gold)","var(--muted)","#cd7f32"];
  const podiumEmojis = ["🥇","🥈","🥉"];

  return(
    <div style={{display:"grid",gap:"2rem"}}>
      <div className="fu" style={{textAlign:"center",padding:"1.5rem 0 0"}}>
        <div style={{fontSize:"3rem",marginBottom:".4rem"}}>🏅</div>
        <H size="2.5rem" style={{marginBottom:".3rem"}}>Hall of Fame</H>
        <p style={{color:"var(--muted)",fontSize:".88rem"}}>{totalEvents} editions · The legends live here</p>
      </div>

      {/* Perfect attendance */}
      {perfect.length>0&&(
        <Card className="fu1" style={{background:"linear-gradient(135deg,#1f1609,#2e1e0a)",borderColor:"var(--border2)",textAlign:"center",padding:"2rem"}}>
          <div style={{fontSize:"2rem",marginBottom:".5rem"}}>🐐</div>
          <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--amber2)",marginBottom:".8rem"}}>Perfect Attendance</div>
          <div style={{display:"flex",justifyContent:"center",gap:"1rem",flexWrap:"wrap"}}>
            {perfect.map((p)=>(
              <div key={p.name} style={{display:"flex",alignItems:"center",gap:8}}>
                <Avatar name={p.name} size={38} {...getUA(p.name,users)}/>
                <div>
                  <div style={{fontWeight:600,fontSize:".95rem"}}>{getDisplayName(p.name,users)}</div>
                  <div style={{fontSize:".72rem",color:"var(--amber)"}}>All {totalEvents} events</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Attendance podium */}
      <div className="fu2">
        <H>📅 Attendance Record</H>
        {attendance.slice(0,3).length>0&&(
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:"1rem",marginBottom:"1.5rem"}}>
            {[attendance[1],attendance[0],attendance[2]].filter(Boolean).map((p,i)=>{
              const realIdx=i===0?1:i===1?0:2;
              const h=[120,160,90][realIdx];
              return(
                <div key={p.name} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                  <Avatar name={p.name} size={40} {...getUA(p.name,users)}/>
                  <div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(p.name,users)}</div>
                  <div style={{fontSize:"1.2rem"}}>{podiumEmojis[realIdx]}</div>
                  <div style={{width:80,height:h,background:podiumColors[realIdx]+"33",border:`2px solid ${podiumColors[realIdx]}`,borderRadius:"8px 8px 0 0",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
                    <div style={{fontFamily:"var(--font-h)",fontSize:"1.4rem",color:podiumColors[realIdx],fontWeight:900}}>{p.attended}</div>
                    <div style={{fontSize:".65rem",color:"var(--muted)"}}>events</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{display:"grid",gap:".6rem"}}>
          {attendance.map((a,i)=>(
            <div key={a.name} style={{display:"flex",alignItems:"center",gap:"1rem",background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",border:"1px solid var(--border)"}}>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:i<3?podiumColors[i]:"var(--muted2)",minWidth:28,textAlign:"center"}}>{i+1}</div>
              <Avatar name={a.name} size={32} {...getUA(a.name,users)}/>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(a.name,users)}</div>
                <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>
                  {a.attended} attended · {a.missed} missed
                  {a.attended===totalEvents&&totalEvents>0&&<span style={{color:"var(--amber)",marginLeft:6}}>🐐 Perfect</span>}
                </div>
              </div>
              <div style={{display:"flex",gap:3}}>
                {events.map(evt=>{
                  const att=evt.attendees.find(x=>x.name===a.name);
                  const s=att?.status;
                  const color=["went","going"].includes(s)?"var(--green)":["absent","not coming"].includes(s)?"var(--red)":"var(--muted2)";
                  return<div key={evt.id} title={`${evt.name}: ${s||"?"}`} style={{width:8,height:8,borderRadius:"50%",background:color}}/>;
                })}
              </div>
              <div style={{background:"var(--bg3)",borderRadius:8,padding:"4px 10px",textAlign:"center",minWidth:44}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--amber)",lineHeight:1}}>{Math.round(a.attended/Math.max(totalEvents,1)*100)}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* On a roll -- current consecutive attendance streak (#16 "other ideas") */}
      {streaks.length>0&&(
        <div className="fu2">
          <H>🔥 On a Roll</H>
          <div style={{display:"grid",gap:".6rem"}}>
            {streaks.slice(0,5).map((s,i)=>(
              <div key={s.name} style={{display:"flex",alignItems:"center",gap:"1rem",background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",border:"1px solid var(--border)"}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:i<3?podiumColors[i]:"var(--muted2)",minWidth:28,textAlign:"center"}}>{i+1}</div>
                <Avatar name={s.name} size={32} {...getUA(s.name,users)}/>
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(s.name,users)}</div><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>hasn&apos;t missed one in a while</div></div>
                <div style={{background:"rgba(224,85,85,.15)",border:"1px solid rgba(224,85,85,.3)",borderRadius:8,padding:"4px 12px",fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--red)"}}>🔥 {s.streak}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Awards leaderboard */}
      {winners.length>0&&(
        <div className="fu3">
          <H>🏆 Most Awards Won</H>
          <div style={{display:"grid",gap:".6rem"}}>
            {winners.map((w,i)=>(
              <div key={w.name} style={{background:"var(--bg2)",borderRadius:"var(--radius-sm)",border:"1px solid var(--border)",overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",gap:"1rem",padding:".9rem 1.1rem",cursor:"pointer"}} onClick={e=>{const d=e.currentTarget.nextSibling;d.style.display=d.style.display==="none"?"block":"none";}}>
                  <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:i<3?podiumColors[i]:"var(--muted2)",minWidth:28,textAlign:"center"}}>{i+1}</div>
                  <Avatar name={w.name} size={32} {...getUA(w.name,users)}/>
                  <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(w.name,users)}</div><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{w.count} award{w.count!==1?"s":""}</div></div>
                  <div style={{background:"var(--gold)22",border:"1px solid var(--gold)44",borderRadius:8,padding:"4px 12px",fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--gold)"}}>{w.count}</div>
                </div>
                <div style={{display:"none",padding:"0 1.1rem 1rem",borderTop:"1px solid var(--border)"}}>
                  <div style={{paddingTop:".8rem",display:"grid",gap:".5rem"}}>
                    {w.awards.map((a,ai)=>(
                      <div key={ai} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                        <span style={{fontSize:"1rem"}}>{a.icon||"🏆"}</span>
                        <div><div style={{fontSize:".83rem",color:"var(--cream)",fontWeight:500}}>{a.category}</div><div style={{fontSize:".73rem",color:"var(--muted)"}}>{a.eventName} · {a.detail}</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team trophy cabinet (#16 §6.4) -- team sets decorated by a
          finished tournament (WP-J) or a hand-added award. A failed read
          used to just silently show nothing here, same lie as everywhere
          else teamSets is read: there may well be a cabinet, we simply
          couldn't reach it. */}
      {decoratedSets.length===0&&teamSetsError&&(
        <div className="fu3">
          <H>🏆 Team Trophy Cabinet</H>
          <TeamSetsErrorNotice onRetry={onRetryTeamSets}/>
        </div>
      )}
      {decoratedSets.length>0&&(
        <div className="fu3">
          <H>🏆 Team Trophy Cabinet</H>
          <div style={{display:"grid",gap:"1rem"}}>
            {decoratedSets.map(ts=>{
              const teams=Array.isArray(ts.teams)?ts.teams:[];
              const awards=ts.awards.filter(a=>a&&typeof a==="object");
              const byTeam={};
              awards.forEach(a=>{
                const key=typeof a.teamId==="string"&&a.teamId?a.teamId:"__onbekend__";
                if(!byTeam[key])byTeam[key]=[];
                byTeam[key].push(a);
              });
              const rows=Object.entries(byTeam).map(([teamId,list])=>({teamId,team:teams.find(t=>t&&t.id===teamId)||null,list}));
              return(
                <Card key={ts.id}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:".9rem"}}>
                    <span style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)"}}>{ts.name||"Naamloze teams"}</span>
                    {ts.category&&<span style={{background:"rgba(232,148,58,.15)",border:"1px solid rgba(232,148,58,.3)",borderRadius:20,padding:"2px 9px",fontSize:".7rem",fontFamily:"var(--font-b)",fontWeight:600,color:"var(--amber2)",letterSpacing:".04em"}}>{ts.category}</span>}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:".85rem"}}>
                    {rows.map(({teamId,team,list})=>(
                      <div key={teamId} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".85rem"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:".5rem"}}>
                          <span style={{fontSize:"1.2rem",lineHeight:1}}>{team?.avatar||"🎯"}</span>
                          <span style={{fontFamily:"var(--font-h)",fontSize:".9rem",color:"var(--amber2)"}}>{team?.name||"Onbekend team"}</span>
                        </div>
                        {Array.isArray(team?.members)&&team.members.length>0&&(
                          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:".6rem"}}>
                            {team.members.filter(m=>typeof m==="string"&&m).map((m,mi)=>(
                              <Avatar key={mi} name={m} size={22} {...getUA(m,users)}/>
                            ))}
                          </div>
                        )}
                        <div style={{display:"flex",flexDirection:"column",gap:5}}>
                          {list.map((a,ai)=>(
                            <div key={a.id||ai} style={{fontSize:".76rem",color:"var(--cream)",background:"var(--gold)14",border:"1px solid var(--gold)44",borderRadius:6,padding:"3px 8px"}}>
                              {a.label||"🏆 Award"}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Quiz leaderboard */}
      {quizBoard.length>0&&(
        <div className="fu3">
          <H>🧠 Quiz All-Time Scores</H>
          <div style={{display:"grid",gap:".6rem"}}>
            {quizBoard.map((p,i)=>(
              <div key={p.name} style={{display:"flex",alignItems:"center",gap:"1rem",background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",border:"1px solid var(--border)"}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:i<3?podiumColors[i]:"var(--muted2)",minWidth:28,textAlign:"center"}}>{i+1}</div>
                <Avatar name={p.name} size={32} {...getUA(p.name,users)}/>
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(p.name,users)}</div><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{p.quizzes} quiz{p.quizzes!==1?"zes":""} played</div></div>
                <div style={{background:"rgba(91,155,213,.15)",border:"1px solid rgba(91,155,213,.3)",borderRadius:8,padding:"4px 12px",fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"var(--blue)"}}>{p.total}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lens Legend -- most photos uploaded (#16 "other ideas") */}
      {photographers.length>0&&(
        <div className="fu3">
          <H>📸 Lens Legend</H>
          <div style={{display:"grid",gap:".6rem"}}>
            {photographers.slice(0,10).map((p,i)=>(
              <div key={p.name} style={{display:"flex",alignItems:"center",gap:"1rem",background:"var(--bg2)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",border:"1px solid var(--border)"}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:i<3?podiumColors[i]:"var(--muted2)",minWidth:28,textAlign:"center"}}>{i+1}</div>
                <Avatar name={p.name} size={32} {...getUA(p.name,users)}/>
                <div style={{flex:1}}><div style={{fontWeight:600,fontSize:".9rem"}}>{getDisplayName(p.name,users)}</div><div style={{fontSize:".72rem",color:"var(--muted)",marginTop:2}}>{p.count} photo{p.count!==1?"s":""} uploaded</div></div>
                <div style={{background:"rgba(224,128,80,.15)",border:"1px solid rgba(224,128,80,.3)",borderRadius:8,padding:"4px 12px",fontFamily:"var(--font-h)",fontSize:"1.1rem",color:"#e08050"}}>{p.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All-time kretjes tally -- a group bragging-rights number, not a
          per-person leaderboard (#16 "other ideas") */}
      {totalKretjes>0&&(
        <Card className="fu3" style={{textAlign:"center",padding:"1.8rem",background:"linear-gradient(135deg,#1f1609,#2e1e0a)",borderColor:"var(--border2)"}}>
          <div style={{fontSize:"2rem",marginBottom:".3rem"}}>🍺</div>
          <div style={{fontFamily:"var(--font-h)",fontSize:"2.2rem",color:"var(--amber2)"}}>{totalKretjes}</div>
          <div style={{fontSize:".82rem",color:"var(--muted)",marginTop:4}}>kretjes and counting, across every Mensday</div>
        </Card>
      )}

      {events.length===0&&<Card style={{textAlign:"center",padding:"4rem",color:"var(--muted)"}}>No events yet — the Hall of Fame will fill up as you play!</Card>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────────────────────────────────────────
const MemberCard=({user,events,onClick,isMe,quizResults=[]})=>{
  const stats=computeMemberStats(user.username,events,quizResults);
  const hasPhoto=!!user.photo_url;
  const animal=ANIMALS[(user.animal_avatar??user.avatar??0)%ANIMALS.length];
  return(
    <div onClick={onClick} style={{position:"relative",aspectRatio:"1/1",borderRadius:"var(--radius)",overflow:"hidden",cursor:"pointer",border:"1px solid var(--border)",background:hasPhoto?"var(--bg2)":animal.bg,transition:"transform .2s,border-color .2s",flexShrink:0}}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.borderColor="var(--border2)"}}
      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.borderColor=""}}>
      {hasPhoto
        ?<img src={user.photo_url} alt={user.username} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
        :<div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"clamp(3rem,10vw,5rem)"}}>{animal.emoji}</div>
      }
      <div style={{position:"absolute",bottom:0,left:0,right:0,background:"linear-gradient(transparent,rgba(0,0,0,.88) 60%)",padding:"2rem .75rem .75rem"}}>
        <div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:"#fff",lineHeight:1.2,marginBottom:5}}>{user.display_name||user.username}</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
          <RoleBadge role={user.role}/>
          {stats.total>0&&<span style={{fontSize:".67rem",color:"rgba(255,255,255,.7)"}}>🍺 {stats.total}×</span>}
          {stats.quizWins>0&&<span style={{fontSize:".67rem",color:"rgba(255,255,255,.7)"}}>🧠 {stats.quizWins}×</span>}
          {stats.mentions.length>0&&<span style={{fontSize:".67rem",color:"rgba(255,255,255,.7)"}}>🏆 {stats.mentions.length}</span>}
        </div>
      </div>
      {isMe&&<div style={{position:"absolute",top:8,right:8,background:"var(--amber)",borderRadius:6,padding:"2px 8px",fontSize:".62rem",fontWeight:700,color:"#0f0b07",letterSpacing:".04em"}}>JIJ</div>}
    </div>
  );
};

const MembersPage=({users,events,onOpenMember,currentUser,quizResults=[]})=>{
  const members=users.filter(u=>u.role!=="pending").sort((a,b)=>{
    if(hasAdmin(a)&&!hasAdmin(b))return -1;
    if(hasAdmin(b)&&!hasAdmin(a))return 1;
    return new Date(a.joined_at)-new Date(b.joined_at);
  });
  return(
    <div>
      <H style={{marginBottom:"1.5rem"}}>👥 Lads</H>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:"1rem"}}>
        {members.map(u=><MemberCard key={u.id} user={u} events={events} onClick={()=>onOpenMember(u.id)} isMe={u.id===currentUser.id} quizResults={quizResults}/>)}
      </div>
    </div>
  );
};

const MemberProfile=({user,events,currentUser,onEdit,quizResults=[]})=>{
  const stats=computeMemberStats(user.username,events,quizResults);
  const hasPhoto=!!user.photo_url;
  const animal=ANIMALS[(user.animal_avatar??user.avatar??0)%ANIMALS.length];
  const isMe=user.id===currentUser.id;
  return(
    <div style={{display:"grid",gap:"1.5rem"}}>
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{height:240,position:"relative",background:hasPhoto?"var(--bg2)":animal.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
          {hasPhoto
            ?<img src={user.photo_url} alt={user.username} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            :<div style={{fontSize:"7rem",lineHeight:1}}>{animal.emoji}</div>
          }
          <div style={{position:"absolute",inset:0,background:"linear-gradient(transparent 35%,rgba(0,0,0,.75))"}}/>
          <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"1.2rem 1.5rem"}}>
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div>
                <H size="1.7rem" style={{marginBottom:3,color:"#fff"}}>{user.display_name||user.username}</H>
                {user.display_name&&<div style={{color:"rgba(255,255,255,.55)",fontSize:".82rem"}}>@{user.username}</div>}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <RoleBadge role={user.role}/>
                {user.age&&<Tag color="var(--muted)">{user.age} jaar</Tag>}
                {isMe&&<Btn onClick={onEdit} size="sm" variant="ghost">✎ Bewerken</Btn>}
              </div>
            </div>
          </div>
        </div>
        {user.bio&&<div style={{padding:"1rem 1.5rem",color:"var(--muted)",fontSize:".88rem",fontStyle:"italic",borderTop:"1px solid var(--border)"}}>&ldquo;{user.bio}&rdquo;</div>}
      </Card>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:"1rem"}}>
        {[["🍺",stats.mensdays,"Mensdagen"],["🏕️",stats.weekends,"Weekenden"],["🧠",stats.quizWins,"Quiz gewonnen"],["🏆",stats.mentions.length,"Awards"]].map(([icon,val,label])=>(
          <Card key={label} style={{textAlign:"center",padding:"1.2rem"}}>
            <div style={{fontSize:"1.5rem",marginBottom:4}}>{icon}</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"2rem",color:"var(--amber)",lineHeight:1}}>{val}</div>
            <div style={{fontSize:".73rem",color:"var(--muted)",marginTop:5}}>{label}</div>
          </Card>
        ))}
      </div>

      {stats.mentions.length>0&&(
        <Card>
          <H size="1rem" style={{marginBottom:"1rem"}}>🏆 Awards</H>
          <div style={{display:"grid",gap:".75rem"}}>
            {stats.mentions.map((m,i)=>(
              <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                <span style={{fontSize:"1.4rem"}}>{m.icon||"🏆"}</span>
                <div>
                  <div style={{fontWeight:600,fontSize:".9rem",color:"var(--cream)"}}>{m.category}</div>
                  <div style={{fontSize:".78rem",color:"var(--muted)",marginTop:2}}>{m.eventName}{m.detail&&` · ${m.detail}`}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{fontSize:".75rem",color:"var(--muted2)",textAlign:"center"}}>
        Lid sinds {user.joined_at?new Date(user.joined_at).toLocaleDateString("nl-NL",{day:"numeric",month:"long",year:"numeric"}):"onbekend"}
      </div>
    </div>
  );
};

const EditProfileModal=({user,onSave,onClose})=>{
  const [displayName,setDisplayName]=useState(user.display_name||"");
  const [age,setAge]=useState(user.age||"");
  const [bio,setBio]=useState(user.bio||"");
  const [animalAvatar,setAnimalAvatar]=useState(user.animal_avatar??user.avatar??0);
  const [photoUrl,setPhotoUrl]=useState(user.photo_url||"");
  const [uploading,setUploading]=useState(false);
  const [err,setErr]=useState("");
  const fileRef=useRef();
  const handleUpload=async e=>{
    const file=e.target.files[0];if(!file)return;
    setUploading(true);setErr("");
    const path=`profiles/${user.id}/${Date.now()}`;
    const{data,error}=await supabase.storage.from("profile-photos").upload(path,file,{upsert:true});
    if(error){setErr("Upload mislukt: "+error.message);setUploading(false);return;}
    const{data:{publicUrl}}=supabase.storage.from("profile-photos").getPublicUrl(data.path);
    setPhotoUrl(publicUrl);setUploading(false);
  };
  const save=()=>onSave({display_name:displayName.trim()||null,age:age?parseInt(age):null,bio:bio.trim()||null,animal_avatar:animalAvatar,photo_url:photoUrl||null});
  return(
    <Modal onClose={onClose} onBackdropClose={save} maxWidth={460}>
      <H>Profiel bewerken</H>
      <div style={{display:"grid",gap:"1.1rem"}}>
        <div style={{textAlign:"center"}}>
          <div style={{width:100,height:100,borderRadius:"50%",margin:"0 auto .8rem",background:photoUrl?"var(--bg3)":ANIMALS[animalAvatar%10].bg,overflow:"hidden",border:"3px solid var(--border2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"3rem",cursor:"pointer"}} onClick={()=>fileRef.current.click()}>
            {photoUrl?<img src={photoUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>:ANIMALS[animalAvatar%10].emoji}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleUpload}/>
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            <Btn onClick={()=>fileRef.current.click()} variant="ghost" size="sm" disabled={uploading}>{uploading?"Uploaden…":"📷 Foto uploaden"}</Btn>
            {photoUrl&&<Btn onClick={()=>setPhotoUrl("")} variant="ghost" size="sm" style={{color:"var(--red)"}}>Verwijderen</Btn>}
          </div>
          {err&&<div style={{color:"var(--red)",fontSize:".78rem",marginTop:6}}>{err}</div>}
        </div>
        {!photoUrl&&(
          <div>
            <Lbl>Kies je dier</Lbl>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
              {ANIMALS.map((a,i)=>(
                <div key={i} onClick={()=>setAnimalAvatar(i)} title={a.name} style={{aspectRatio:"1",borderRadius:10,background:a.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",border:animalAvatar===i?"2px solid var(--amber)":"2px solid transparent",fontSize:"1.8rem",transition:"border-color .15s"}}>
                  {a.emoji}
                </div>
              ))}
            </div>
          </div>
        )}
        <div><Lbl>Weergavenaam</Lbl><Inp value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder={user.username}/></div>
        <div><Lbl>Leeftijd</Lbl><Inp value={age} onChange={e=>setAge(e.target.value.replace(/\D/g,""))} placeholder="bijv. 28"/></div>
        <div><Lbl>Bio / tagline</Lbl><Inp value={bio} onChange={e=>setBio(e.target.value)} placeholder="Korte beschrijving…" multiline rows={2}/></div>
        <div style={{display:"flex",gap:8,marginTop:4,alignItems:"center",flexWrap:"wrap"}}>
          <Btn onClick={save}>Opslaan</Btn>
          <Btn onClick={onClose} variant="ghost">Discard changes</Btn>
          <span style={{color:"var(--muted)",fontSize:".7rem"}}>Clicking outside saves automatically</span>
        </div>
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────────────────────────────────────
const Home = ({events,onOpen,onNew,currentUser,users=[],onTeams,onTimer,onQuiz,onMensGames,mensGamesUnlocked,onSaraJay,saraJayUnlocked}) => {
  const isMobile=useIsMobile();
  const isOver=e=>e.archived||new Date(`${e.end_date||e.date}T${e.end_time||"23:59"}:00`)<new Date();
  const upcoming=events.filter(e=>!isOver(e)).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const past=events.filter(e=>isOver(e)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const nextEvt=upcoming[0];
  const goingLads=nextEvt?nextEvt.attendees.filter(a=>a.status==="going"):[];
  const totalEditions=events.length;
  const kretjes=events.reduce((s,e)=>s+(e.kretjes||0),0);
  const hypers=["No excuses. No mercy. Just lads.","The brotherhood doesn't sleep.","Every year. No matter what.","Legends are made here.","It's that time again."];
  const hype=hypers[(new Date().getMonth()+new Date().getDate())%hypers.length];
  return(
    <div style={{display:"grid",gap:"2.5rem"}}>

      {/* ── HERO ── */}
      <div className="fu" style={{textAlign:"center",padding:isMobile?"1.2rem 0 .3rem":"3rem 0 .5rem",position:"relative"}}>
        <div style={{position:"absolute",inset:0,background:"var(--hero-glow)",pointerEvents:"none"}}/>
        <div className="float" style={{fontSize:isMobile?"2.8rem":"4.5rem",marginBottom:isMobile?".2rem":".5rem",display:"inline-block"}}>🍺</div>
        <h1 style={{fontFamily:"var(--font-h)",fontStyle:"italic",fontSize:isMobile?"2.6rem":"clamp(3rem,10vw,6rem)",color:"var(--amber2)",lineHeight:.9,letterSpacing:"-.02em",marginBottom:isMobile?".4rem":".6rem"}}>MENSAPP</h1>
        <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:12,marginBottom:isMobile?".8rem":"1.2rem"}}>
          <div style={{height:1,flex:1,maxWidth:60,background:"linear-gradient(to right,transparent,var(--border2))"}}/>
          <span style={{color:"var(--muted)",fontSize:".72rem",letterSpacing:".25em",textTransform:"uppercase"}}>{hype}</span>
          <div style={{height:1,flex:1,maxWidth:60,background:"linear-gradient(to left,transparent,var(--border2))"}}/>
        </div>
        {totalEditions>0&&(
          <div style={{display:"inline-flex",gap:isMobile?".8rem":"2rem",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:50,padding:isMobile?".45rem 1.2rem":".6rem 2rem",flexWrap:"nowrap",justifyContent:"center"}}>
            {[
              [goingLads.length,"Lads In 🔥"],
              [totalEditions,"Editions 🏆"],
              [past.length,"Legendary 💀"],
              [kretjes,"Kretjes 🍺"],
            ].map(([v,l])=>(
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontFamily:"var(--font-h)",fontSize:isMobile?"1.15rem":"1.6rem",color:"var(--amber)",lineHeight:1}}>{v}</div>
                <div style={{fontSize:isMobile?".55rem":".62rem",color:"var(--muted)",letterSpacing:".1em",textTransform:"uppercase",marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        )}
        {goingLads.length>0&&(
          <div style={{marginTop:"1.2rem",display:"flex",justifyContent:"center",alignItems:"center",gap:8}}>
            <div style={{display:"flex"}}>{goingLads.slice(0,7).map((a,i)=><div key={i} style={{marginLeft:i===0?0:-10,borderRadius:"50%",border:"2px solid var(--bg)"}}><Avatar name={a.name} size={30} {...getUA(a.name,users)}/></div>)}</div>
            <span style={{fontSize:".8rem",color:"var(--muted)"}}>
              {goingLads.slice(0,3).map(a=>a.name).join(", ")}{goingLads.length>3?` +${goingLads.length-3} more`:""} confirmed
            </span>
          </div>
        )}
      </div>

      {/* ── UPCOMING ── */}
      <div className="fu1">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>🔥 Next Mission</H>
          {can.editEvent(currentUser)&&<Btn onClick={onNew} size="sm">+ New Event</Btn>}
        </div>
        {upcoming.length===0&&(
          <Card style={{textAlign:"center",padding:"3.5rem 2rem",background:"linear-gradient(135deg,var(--bg2),var(--bg3))"}}>
            <div style={{fontSize:"3rem",marginBottom:".8rem"}}>👀</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1.3rem",color:"var(--amber2)",marginBottom:".5rem"}}>The next edition is being planned...</div>
            <div style={{color:"var(--muted)",fontSize:".88rem"}}>Admin is cooking something up. Stay on standby, lad.</div>
          </Card>
        )}
        <div style={{display:"grid",gap:"1rem"}}>{upcoming.map(e=><EventCard key={e.id} evt={e} onOpen={onOpen} currentUser={currentUser} users={users}/>)}</div>
      </div>

      {/* ── TOOLS ── */}
      <div className="fu2">
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>🛠 Tools</H>
          <div style={{height:1,flex:1,background:"var(--border)"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"1rem"}}>
          {[
            {icon:"🎲",title:"Team Creator",desc:"Schud willekeurige teams voor je activiteiten",onClick:onTeams,color:"var(--amber)"},
            {icon:"⏱",title:"Timer",desc:"Afteltimer voor spelletjes en activiteiten",onClick:onTimer,color:"var(--blue)"},
            // Quiz (docs/quiz-unification-spec.md §14 decision 1, WP-Q7):
            // unlocked by default, unlike Mens-Games/Sara Jay below -- it's
            // an existing feature going standalone, not a new one behind an
            // admin switch, so it never needed a locked state.
            {icon:"🧠",title:"Quiz",desc:"Bouw of open een quiz -- los, of gekoppeld aan een event",onClick:onQuiz,color:"var(--orange)"},
            // Locked mens-games keeps its real title -- it's just a feature
            // not switched on yet, not a deliberate mystery like Sara Jay
            // (`hideTitleWhenLocked` below stays false only for this one).
            {icon:mensGamesUnlocked?"🏆":"🔒",title:"Mens-Games",desc:mensGamesUnlocked?"Bouw een toernooi, scoor live, houd de stand bij":"Binnenkort beschikbaar... 👀",onClick:mensGamesUnlocked?onMensGames:undefined,color:mensGamesUnlocked?"var(--gold)":"var(--muted)",isLocked:!mensGamesUnlocked,hideTitleWhenLocked:false},
            {icon:saraJayUnlocked?"🤖":"🔒",title:"Sara Jay or JAI",desc:saraJayUnlocked?"Echt of AI? Één fout = game over. Bouw je streak.":"Binnenkort beschikbaar... 👀",onClick:saraJayUnlocked?onSaraJay:undefined,color:saraJayUnlocked?"var(--purple)":"var(--muted)",isLocked:!saraJayUnlocked,hideTitleWhenLocked:true},
          ].map(({icon,title,desc,onClick,color,isLocked,hideTitleWhenLocked})=>(
            <div key={title} onClick={onClick}
              onMouseEnter={e=>{if(!isLocked){e.currentTarget.style.borderColor=color;e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 8px 28px ${color}22`;}}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}
              style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.5rem 1.4rem",cursor:isLocked?"not-allowed":"pointer",transition:"all .2s cubic-bezier(.4,0,.2,1)",display:"flex",flexDirection:"column",gap:".65rem",opacity:isLocked?.65:1}}>
              <div style={{fontSize:"2.2rem",lineHeight:1}}>{icon}</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.1rem",color:color,lineHeight:1.2}}>{isLocked&&hideTitleWhenLocked?"???" : title}</div>
              <div style={{fontSize:".82rem",color:"var(--muted)",lineHeight:1.5}}>{desc}</div>
              <div style={{marginTop:"auto",paddingTop:".5rem",fontSize:".75rem",color:color,opacity:.7,fontWeight:600,letterSpacing:".04em"}}>{isLocked?"Binnenkort beschikbaar":"Openen →"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ARCHIVES ── */}
      {past.length>0&&(
        <div className="fu3">
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1rem"}}>
            <H style={{marginBottom:0}}>📚 The Archives</H>
            <div style={{height:1,flex:1,background:"var(--border)"}}/>
            <span style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".1em"}}>{past.length} editions</span>
          </div>
          <div style={{display:"grid",gap:".7rem"}}>{past.map(e=><EventCard key={e.id} evt={e} onOpen={onOpen} compact currentUser={currentUser} users={users}/>)}</div>
        </div>
      )}
    </div>
  );
};

const EventCard = ({evt,onOpen,compact=false,currentUser,users=[]}) => {
  const going=evt.attendees.filter(a=>["went","going"].includes(a.status)).length;
  const countdown=useCountdown(evt.date,evt.start_time);
  const myStatus=evt.attendees.find(a=>a.name.toLowerCase()===currentUser?.username.toLowerCase())?.status;
  const colorOf=s=>statusMap[s]?.color??"var(--muted)";
  const isMobile=useIsMobile();
  const myStatusColor=myStatus?colorOf(myStatus):"var(--muted)";
  const _now=new Date();
  const _start=new Date(`${evt.date}T${evt.start_time||"00:00"}:00`);
  const _end=new Date(`${evt.end_date||evt.date}T${evt.end_time||"23:59"}:00`);
  const isLive=!evt.archived&&_now>=_start&&_now<=_end;
  const isUpcoming=!evt.archived&&!countdown.past&&!isLive;

  if(compact) return(
    <div className="event-card-upcoming" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".9rem 1.1rem",cursor:"pointer",position:"relative",overflow:"hidden",display:"flex",alignItems:"center",gap:"1rem"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--border2)"}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=""}}
      onClick={()=>onOpen(evt.id)}>
      <div style={{fontFamily:"var(--font-h)",fontSize:"1.5rem",color:"var(--muted2)",opacity:.4,minWidth:44,textAlign:"center"}}>{new Date(evt.date).getFullYear()}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:"var(--amber2)"}}>{evt.name}</div>
        <div style={{color:"var(--muted)",fontSize:".73rem",marginTop:2}}>
          {formatEventDateRange(evt.date,evt.end_date,{weekday:false,year:false})}
          {evt.location&&evt.location!=="TBD"&&` · ${evt.location}`}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        {evt.winners?.length>0&&<span style={{fontSize:".72rem",color:"var(--gold)"}}>🏆 {evt.winners.length}</span>}
        <span style={{fontSize:".73rem",color:"var(--muted)"}}>{going} attended</span>
        <div style={{color:"var(--muted)",fontSize:".8rem",opacity:.4}}>›</div>
      </div>
    </div>
  );

  return(
    <div className={`event-card-upcoming${isLive?" live-pulse":isUpcoming?" glow-pulse":""}`}
      style={{background:isLive?"linear-gradient(135deg,#081a0e,#0f2214,#081a0e)":isUpcoming?"linear-gradient(135deg,#1a1008,#221608,#1a1008)":"var(--bg2)",border:`1px solid ${isLive?"rgba(76,175,125,.45)":isUpcoming?"rgba(232,148,58,.3)":"var(--border)"}`,borderRadius:"var(--radius)",cursor:"pointer",position:"relative",overflow:"hidden"}}
      onClick={()=>onOpen(evt.id)}>

      {/* Top accent bar */}
      {(isUpcoming||isLive)&&<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:isLive?"linear-gradient(90deg,var(--green),#52c41a,var(--green),#52c41a)":"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber))",backgroundSize:"200% 100%",animation:"goldShimmer 3s linear infinite"}}/>}

      {/* Main content */}
      <div style={{padding:"1.4rem"}}>
        <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:"1.2rem",alignItems:"flex-start"}}>
          <div style={{flex:1,minWidth:0,width:"100%"}}>
            {/* Tags */}
            <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
              <Tag color={evt.type==="weekend"?"var(--purple)":"var(--amber)"}>{evt.type==="weekend"?"🏕️ Weekend":"📅 Day Event"}</Tag>
              {evt.theme&&<Tag color="var(--gold)">✨ {evt.theme}</Tag>}
              {isLive&&(
                <span style={{background:"rgba(76,175,125,.18)",color:"var(--green)",border:"1px solid rgba(76,175,125,.45)",borderRadius:6,padding:"3px 10px",fontSize:".72rem",fontWeight:700,display:"flex",alignItems:"center",gap:5}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:"var(--green)",display:"inline-block",animation:"pulse 1.1s ease-in-out infinite"}}/>
                  HAPPENING NOW
                </span>
              )}
              {myStatus&&(
                <span style={{background:myStatusColor+"22",color:myStatusColor,border:`1px solid ${myStatusColor}44`,borderRadius:6,padding:"3px 10px",fontSize:".72rem",fontWeight:700}}>
                  {myStatus==="going"?"🔒 Locked In":myStatus==="maybe"?"🤔 Maybe":myStatus==="not coming"?"❌ Can't Make It":statusMap[myStatus]?.label}
                </span>
              )}
            </div>

            {/* Event name */}
            <div style={{fontFamily:"var(--font-h)",fontSize:"1.5rem",color:"var(--amber2)",marginBottom:5,lineHeight:1.1}}>{evt.name}</div>

            {/* Date / location */}
            <div style={{color:"var(--muted)",fontSize:".82rem",marginBottom:4}}>
              {formatEventDateRange(evt.date,evt.end_date)}
              {evt.start_time&&<span style={{color:"var(--amber)",marginLeft:6}}>⏰ {evt.start_time}{evt.end_time&&`–${evt.end_time}`}</span>}
              {evt.location&&evt.location!=="TBD"&&<span style={{marginLeft:6}}>· 📍 {evt.location}</span>}
            </div>

            {/* Lads going */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
              <div style={{display:"flex"}}>{evt.attendees.filter(a=>["went","going"].includes(a.status)).slice(0,6).map((a,i)=><div key={i} style={{marginLeft:i===0?0:-8,borderRadius:"50%",border:"2px solid var(--bg2)"}}><Avatar name={a.name} size={24} {...getUA(a.name,users)}/></div>)}</div>
              {going>0&&<span style={{fontSize:".75rem",color:"var(--muted)"}}><strong style={{color:"var(--cream)"}}>{going}</strong> lad{going!==1?"s":""} {evt.archived?"attended":"in"}</span>}
            </div>
          </div>

          {/* Right: live / countdown / year */}
          <div style={{flexShrink:0,textAlign:"center",width:isMobile?"100%":"auto"}}>
          {isLive?(
            <div style={{background:"rgba(76,175,125,.08)",border:"1px solid rgba(76,175,125,.3)",borderRadius:12,padding:isMobile?"1rem 1.4rem":".9rem 1.2rem",display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:"var(--green)",display:"inline-block",animation:"pulse 1.1s ease-in-out infinite"}}/>
                <span style={{fontSize:".6rem",color:"var(--green)",letterSpacing:".18em",textTransform:"uppercase",fontWeight:700}}>Live nu</span>
              </div>
              <div style={{fontFamily:"var(--font-h)",fontSize:isMobile?"3rem":"2.2rem",lineHeight:1,color:"var(--green)"}}>⚡</div>
              {evt.end_time&&<div style={{fontSize:".65rem",color:"rgba(76,175,125,.65)",letterSpacing:".08em"}}>tot {evt.end_time}</div>}
            </div>
          ):isUpcoming?(
            <div style={{background:"rgba(232,148,58,.08)",border:"1px solid rgba(232,148,58,.2)",borderRadius:12,padding:isMobile?"1rem 1.2rem":".8rem .9rem"}}>
              <div style={{fontSize:".6rem",color:"var(--amber)",letterSpacing:".15em",textTransform:"uppercase",marginBottom:8}}>Happening in</div>
              <div style={{display:"flex",gap:isMobile?0:4,alignItems:"flex-end",justifyContent:isMobile?"space-around":"flex-start"}}>
                {[["d","days"],["h","hrs"],["m","min"]].map(([k,l])=>(
                  <div key={k} style={{textAlign:"center",flex:isMobile?1:undefined,minWidth:isMobile?0:28}}>
                    <div style={{fontFamily:"var(--font-h)",fontSize:isMobile?"2.4rem":"1.6rem",color:"var(--amber2)",lineHeight:1,fontWeight:900}}>{String(countdown[k]??0).padStart(2,"0")}</div>
                    <div style={{fontSize:isMobile?".7rem":".55rem",color:"var(--muted)",letterSpacing:".08em",marginTop:4}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          ):(
            <div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"2rem",color:"var(--muted2)",opacity:.35,lineHeight:1}}>{new Date(evt.date).getFullYear()}</div>
              {evt.winners?.length>0&&<div style={{fontSize:".7rem",color:"var(--gold)",marginTop:4}}>🏆 {evt.winners.length} awards</div>}
            </div>
          )}
          </div>
        </div>
        {evt.description&&(()=>{const plain=(evt.description).replace(/[*_`#>~]/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/\n+/g," ").trim();const truncated=plain.length>110?plain.slice(0,110).replace(/\s+\S*$/,"")+"…":plain;return(<div style={{color:"var(--cream)",opacity:.6,fontSize:".84rem",lineHeight:1.5,marginTop:".75rem",borderTop:"1px solid rgba(232,148,58,.08)",paddingTop:".7rem"}}>{truncated}<span style={{color:"var(--amber)",fontSize:".79rem",marginLeft:5,fontWeight:600,opacity:.85,whiteSpace:"nowrap"}}>Lees meer →</span></div>);})()}
      </div>

      {/* Activity sneak-peek strip */}
      {evt.schedule&&evt.schedule.length>0&&(()=>{
        const isEditor=can.editSchedule(currentUser);
        const sortedSchedule=[...evt.schedule].sort(scheduleDayTimeOrder);
        const visible=isEditor?sortedSchedule:sortedSchedule.filter(s=>!s.secret);
        const hiddenCount=evt.schedule.filter(s=>s.secret).length;
        if(!isEditor&&visible.length===0)return null;
        return(
          <div style={{padding:"0 1.4rem 1.2rem",borderTop:"1px solid var(--border)"}}>
            <div style={{fontSize:".63rem",color:"var(--muted)",letterSpacing:".15em",textTransform:"uppercase",marginBottom:8,marginTop:10}}>What&apos;s on the menu</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {visible.slice(0,6).map((s,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:5,background:s.secret?"rgba(224,85,85,.08)":"var(--bg3)",border:`1px solid ${s.secret?"rgba(224,85,85,.2)":"var(--border)"}`,borderRadius:8,padding:"5px 10px",fontSize:".76rem",color:s.secret?"rgba(224,85,85,.6)":"var(--cream)",opacity:.85}}>
                  <span style={{fontSize:"1rem"}}>{s.secret?"🔒":s.icon||"📍"}</span>
                  <span>{s.secret?"Geheim":s.activity}</span>
                  {!s.secret&&s.time&&<span style={{color:"var(--amber)",fontSize:".68rem",marginLeft:2}}>{s.time}</span>}
                </div>
              ))}
              {visible.length>6&&<div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"5px 10px",fontSize:".76rem",color:"var(--muted)"}}>+{visible.length-6} more 👀</div>}
              {!isEditor&&hiddenCount>0&&<div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"5px 10px",fontSize:".76rem",color:"var(--muted)"}}>🔒 +{hiddenCount} geheim</div>}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PAGE
// ─────────────────────────────────────────────────────────────────────────────
// Quiz/Teams/Mens-Games 🏆 dropped 2026-08-26 (owner decision): the event
// page stops being a place you *operate* those tools -- each is a
// stand-alone top-level Tool now (Team Creator, Mens-Games, Quiz), reachable
// from Tools/Home, with its own linked-event history. Results still flow
// back to the event, automatically, through Winners & Highlights (see
// `WinnersTab`'s tournament-AUTO-card block below, mirroring the existing
// quiz one) -- nobody types them in here anymore.
const TABS=["Overview","Polls","Photos","Winners & Highlights","FAQ","Kretjes 🍺"];

// Shared read-failure notice for every teamSets read site (TeamCreatorPage's
// library, QuizBuilder's team picker, HallOfFame's trophy cabinet --
// EntrantPicker has its own equivalent in mensgames/ui, wired to the same
// `teamSetsError` string; the event page's own Teams tab used to be a fourth
// site but was removed 2026-08-26). `fetchTeamSets` (teamlib/
// api.js) now reports {ok,error,teamSets} instead of a bare [] on failure,
// specifically so this is distinguishable from "the library is genuinely
// empty" -- rendering that as "Nog geen teams" would be a lie: the data
// exists, it just couldn't be reached.
const TeamSetsErrorNotice=({onRetry})=>(
  <div role="alert" style={{textAlign:"center",padding:"1.4rem 1rem",color:"var(--red)",border:"1px solid rgba(224,85,85,.35)",borderRadius:"var(--radius-sm)",background:"rgba(224,85,85,.06)"}}>
    <div aria-hidden="true" style={{fontSize:"1.4rem",marginBottom:".4rem"}}>⚠️</div>
    <div style={{fontSize:".85rem",marginBottom:onRetry?".7rem":0}}>Kon de teams-bibliotheek niet laden. Er bestaan mogelijk al teams -- probeer het opnieuw.</div>
    {onRetry&&<Btn onClick={onRetry} variant="danger" size="sm">Opnieuw proberen</Btn>}
  </div>
);

const EventPage=({evt,onUpdate,onSyncEvt,onDelete,currentUser,users=[],events=[],initialTab,scrollToId,onSendNotif,autoOpenTrailerId,onAutoTrailerConsumed,quizResults=[],tournamentResults=[]})=>{
  // Quiz/Teams/Mens-Games 🏆 dropped 2026-08-26 (see `TABS`'s own comment
  // above) -- no notification ever deep-links to one of the three removed
  // tabs (grep-verified: `tab:` literals in `diffEvents` only ever name
  // Overview/Polls/FAQ/Photos/Winners & Highlights), but a stale one from
  // before this change, or any other unrecognised value, still falls back
  // to Overview rather than opening on a tab that no longer exists.
  const [tab,setTab]=useState(TABS.includes(initialTab)?initialTab:"Overview");
  useEffect(()=>{
    if(!scrollToId)return;
    const t=setTimeout(()=>{
      const el=document.getElementById(scrollToId);
      if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.style.outline="2px solid var(--amber)";setTimeout(()=>{el.style.outline="";},1800);}
    },250);
    return()=>clearTimeout(t);
  },[scrollToId]);
  const [editing,setEditing]=useState(false);
  const [presenting,setPresenting]=useState(false);
  const [soloOpen,setSoloOpen]=useState(false);
  const [presenterDetected,setPresenterDetected]=useState(false);
  const [viewerDismissed,setViewerDismissed]=useState(false);
  const [schedLive,setSchedLive]=useState(null);
  // The live-quiz rejoin banner + participant overlay that used to live here
  // (`quizDash`/`quizDismissed`/`liveQuizzes`/`localLiveQuiz`/`fetchedLiveQuiz`)
  // moved to the App root (docs/quiz-unification-spec.md §4.5/§8.3 items 3/9-11,
  // WP-Q8) -- a live quiz now has to reach people who aren't sat on this
  // event's page at all (a standalone quiz has no event page), so discovery
  // and the overlay live one level up and auto-open here the same way they
  // used to (App root checks `pageView==="event" && activeEvent.id===
  // liveQuiz.eventId`). `quizDash` (the "Open Quiz Dashboard" modal) moved
  // into `QuizShell.jsx`'s event scope, owned by the standalone Quiz tool
  // page now (§ TABS comment above) rather than by this component.
  const countdown=useCountdown(evt.date,evt.start_time);
  const isPast=evt.archived;
  const isAdmin=can.editEvent(currentUser);
  const isMobile=useIsMobile();
  const [trailerOpen,setTrailerOpen]=useState(false);
  // Gates on the event actually having a real trailer video now (owner
  // direction change, 2026-08-21) -- not on schedule length. Visible to
  // everyone, not just admins.
  const canTrailer=isSafeVideoUrl(evt.trailer_video_url);
  // Gated on `trailerOpen`, not just memoized on identity: cheap as
  // `toTrailerInput` now is, there's no reason to rebuild the view model on
  // every EventPage render regardless of whether anyone ever opens the
  // trailer. `null` while closed; the `<EventTrailer>` mount below is gated
  // on the same flag, so it never sees the `null`. Still memoized on
  // evt/users/events identity so an unrelated realtime sync elsewhere
  // doesn't rebuild the view model while the trailer IS open.
  const trailerInput=useMemo(()=>(trailerOpen?toTrailerInput(evt,users,events):null),[trailerOpen,evt,users,events]);
  // Login teaser's "Watch the trailer" button lands here (via `openEvent` +
  // `autoOpenTrailerId` set together at the App root) and auto-opens the
  // same trailer overlay the page's own button uses -- one code path, so
  // behaviour (RSVP CTA closing back to this page, `markTrailerSeen`, etc.)
  // is identical either way. Guarded on `canTrailer` too: `selectTeaserEvent`
  // already only ever teases events with a valid video, but this stays
  // defensive rather than trusting the caller. Consumed exactly once via
  // the callback, so navigating away and back doesn't reopen it.
  useEffect(()=>{
    if(autoOpenTrailerId===evt.id&&canTrailer){setTrailerOpen(true);onAutoTrailerConsumed?.();}
  },[autoOpenTrailerId,evt.id,canTrailer,onAutoTrailerConsumed]);

  const resetPresenter=useCallback(()=>{setPresenterDetected(false);setViewerDismissed(false);setSchedLive(null);},[]);

  // Realtime: push any DB write on this event to all clients immediately
  const onSyncEvtRef=useRef(onSyncEvt);
  useEffect(()=>{onSyncEvtRef.current=onSyncEvt;},[onSyncEvt]);
  useEffect(()=>{
    const ch=supabase.channel(`event-data-${evt.id}`)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'events',filter:`id=eq.${evt.id}`},
        ({new:updated})=>{if(updated)onSyncEvtRef.current(updated);}
      )
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[evt.id]);

  // Subscribe when: no active viewer PresentationMode (not detected, or detected but dismissed).
  // While dismissed, keeps schedLive current so Rejoin lands on the right slide.
  useEffect(()=>{
    if(presenting||(presenterDetected&&!viewerDismissed))return;
    const ch=supabase.channel(`sched-${evt.id}`);
    let seenPresenter=false; // guard: don't reset on empty initial sync
    ch.on('presence',{event:'sync'},()=>{
        const st=ch.presenceState();
        const p=Object.values(st).flat().find(x=>x.presenting);
        if(p){
          seenPresenter=true;
          // `realIdx` (real schedule-array index, or null for intro) rides
          // alongside the legacy `idx` display position for backwards
          // compat -- a presenter on a build that predates `realIdx` simply
          // won't send it, and PresentationMode's own resolver falls back
          // to `idx` when that's the case. `stopId`/`revealedStopIds` are
          // the same idea one layer more robust: a stop's own stable id
          // (survives a live reorder, not just an add/remove) -- see
          // PresentationMode for the full rationale on all four.
          setSchedLive({idx:p.idx??0,realIdx:p.realIdx,stopId:p.stopId,revealedSecrets:p.revealedSecrets??[],revealedStopIds:p.revealedStopIds});
          setPresenterDetected(true);
        } else if(seenPresenter){
          resetPresenter(); // presenter actually ended (we had confirmed they were there)
        }
      })
      .on('broadcast',{event:'slide'},({payload})=>{
        // Keep schedLive current while dismissed so Rejoin shows the right slide
        seenPresenter=true;
        setSchedLive({idx:payload.idx??0,realIdx:payload.realIdx,stopId:payload.stopId,revealedSecrets:payload.revealedSecrets??[],revealedStopIds:payload.revealedStopIds});
      })
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[presenting,presenterDetected,viewerDismissed,evt.id,resetPresenter]);

  return(
    <div style={{display:"grid",gap:"1.5rem"}}>
      {/* ── Epic event header ── */}
      <div className="fu" style={{position:"relative",overflow:"hidden",borderRadius:"var(--radius)",border:"1px solid var(--border2)",background:"linear-gradient(135deg,#1a1008 0%,#2c1c00 45%,#1a1008 100%)"}}>
        {/* Background glows */}
        <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 70% 90% at 85% 40%,rgba(232,148,58,.13),transparent 65%)",pointerEvents:"none"}}/>
        <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 50% 60% at 10% 70%,rgba(201,146,42,.07),transparent 60%)",pointerEvents:"none"}}/>
        {/* Shimmer top bar */}
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber),var(--orange))",backgroundSize:"300% 100%",animation:"goldShimmer 3s linear infinite"}}/>

        <div style={{padding:"2rem 1.8rem 1.5rem"}}>
          {/* Tags */}
          <div style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap",alignItems:"center"}}>
            <Tag color={evt.type==="weekend"?"var(--purple)":"var(--amber)"}>{evt.type==="weekend"?"🏕️ Weekend":"📅 Day Event"}</Tag>
            {isPast&&<Tag color="var(--muted2)">📦 Archived</Tag>}
            {evt.theme&&<Tag color="var(--gold)">✨ {evt.theme}</Tag>}
            {!isPast&&!countdown.past&&<span style={{background:"rgba(255,107,53,.15)",color:"var(--orange)",border:"1px solid rgba(255,107,53,.4)",borderRadius:6,padding:"3px 10px",fontSize:".72rem",fontWeight:700,letterSpacing:".06em",animation:"borderFire 2s ease-in-out infinite"}}>🔥 INCOMING</span>}
          </div>

          <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:"flex-start",gap:"1.2rem"}}>
            <div style={{flex:1,minWidth:0,width:"100%"}}>
              {/* Big italic event name */}
              <div style={{fontFamily:"var(--font-h)",fontStyle:"italic",fontSize:"clamp(1.8rem,5vw,2.8rem)",color:"var(--amber2)",lineHeight:1.05,marginBottom:".7rem",fontWeight:900,letterSpacing:"-.01em"}}>{evt.name}</div>

              {/* Date + time row */}
              <div style={{display:"flex",flexWrap:"wrap",gap:".5rem",marginBottom:".4rem",alignItems:"center"}}>
                <span style={{color:"var(--cream)",opacity:.75,fontSize:".88rem"}}>📅 {formatEventDateRange(evt.date,evt.end_date)}</span>
                {evt.start_time&&<span style={{color:"var(--amber)",fontSize:".88rem",fontWeight:700}}>⏰ {evt.start_time}{evt.end_time&&` – ${evt.end_time}`}</span>}
              </div>
              {evt.location&&evt.location!=="TBD"&&<div style={{color:"var(--cream)",opacity:.65,fontSize:".86rem",marginBottom:".5rem"}}>📍 {evt.location}</div>}

              {/* Attending lads */}
              {evt.attendees.filter(a=>["went","going"].includes(a.status)).length>0&&(
                <div style={{display:"flex",alignItems:"center",gap:10,marginTop:"1.1rem"}}>
                  <div style={{display:"flex"}}>{evt.attendees.filter(a=>["went","going"].includes(a.status)).slice(0,8).map((a,i)=><div key={i} style={{marginLeft:i===0?0:-10,borderRadius:"50%",border:"2px solid #1a1008"}}><Avatar name={a.name} size={28} {...getUA(a.name,users)}/></div>)}</div>
                  <span style={{fontSize:".82rem",color:"var(--muted)"}}>
                    <strong style={{color:"var(--amber2)"}}>{evt.attendees.filter(a=>["went","going"].includes(a.status)).length}</strong> lad{evt.attendees.filter(a=>["went","going"].includes(a.status)).length!==1?"s":""} {isPast?"attended":"confirmed"}
                  </span>
                </div>
              )}
            </div>

            {/* Right: countdown */}
            {!isPast&&!countdown.past&&(
              <div style={{flexShrink:0,width:isMobile?"100%":"auto"}}>
                <div style={{fontSize:".6rem",color:"var(--orange)",letterSpacing:".18em",textTransform:"uppercase",textAlign:"center",marginBottom:12,fontWeight:700}}>⚡ T-MINUS</div>
                <div style={{display:"flex",gap:".4rem",alignItems:"flex-end",justifyContent:isMobile?"center":"flex-start"}}>
                  {[["d","days"],["h","hrs"],["m","min"],["s","sec"]].map(([k,l],i)=>(
                    <div key={k} style={{display:"flex",alignItems:"flex-end",gap:".4rem"}}>
                      <CU v={countdown[k]} l={l}/>
                      {i<3&&<div style={{color:"var(--gold)",fontSize:"1.4rem",fontWeight:100,marginBottom:8}}>:</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {evt.description&&<div style={{color:"var(--muted)",fontSize:".86rem",lineHeight:1.7,marginTop:"1rem",borderTop:"1px solid rgba(232,148,58,.1)",paddingTop:".9rem"}} dangerouslySetInnerHTML={{__html:renderMd(evt.description)}}/>}
        </div>

        {/* Footer bar */}
        <div style={{borderTop:"1px solid var(--border)",padding:".8rem 1.8rem",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,background:"rgba(0,0,0,.25)"}}>
          {isAdmin?(
            <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
              {evt.schedule.length>0&&<Btn onClick={()=>setPresenting(true)} variant="gold" size="sm">▶ Present</Btn>}
              {/* Own-pace browsing, distinct from ▶ Present: admins can plausibly want either.
                  Hidden while a presentation is actually live — that wins, per the owner's call. */}
              {evt.schedule.length>0&&!presenterDetected&&<Btn onClick={()=>setSoloOpen(true)} variant="ghost" size="sm">🧭 Browse solo</Btn>}
              <Btn onClick={()=>setEditing(true)} variant="ghost" size="sm">✎ Edit</Btn>
              {!isPast&&<Btn onClick={()=>onUpdate({...evt,archived:true})} variant="ghost" size="sm" style={{color:"var(--muted)"}}>Archive</Btn>}
              {isPast&&<Btn onClick={()=>onUpdate({...evt,archived:false})} variant="ghost" size="sm">Reopen</Btn>}
              <Btn onClick={onDelete} variant="danger" size="sm">Delete</Btn>
            </div>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <Avatar name={currentUser.username} size={22} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
              <span style={{fontSize:".74rem",color:"var(--muted)"}}>Viewing as <strong style={{color:"var(--cream)"}}>{currentUser.username}</strong></span>
              {/* Members get their own affordance to walk the schedule at their own pace — never broadcasts.
                  Hidden while a presentation is actually live — that wins, per the owner's call. */}
              {evt.schedule.length>0&&!presenterDetected&&<Btn onClick={()=>setSoloOpen(true)} variant="ghost" size="sm">🧭 Browse solo</Btn>}
            </div>
          )}
          {canTrailer&&<Btn onClick={()=>setTrailerOpen(true)} variant="gold" size="sm">🎬 Watch the trailer</Btn>}
          {evt.schedule&&evt.schedule.length>0&&<span style={{fontSize:".71rem",color:"var(--muted)",letterSpacing:".05em"}}>{evt.schedule.length} activities on the menu 👀</span>}
        </div>
      </div>

      <div className="fu1" style={{display:"flex",gap:".2rem",borderBottom:"1px solid var(--border)",overflowX:"auto"}}>
        {TABS.map(t=>(
          <TabBtn key={t} active={tab===t} onClick={()=>setTab(t)} style={{whiteSpace:"nowrap"}}>{t}</TabBtn>
        ))}
      </div>

      <div className="fu2">
        {tab==="Overview"             &&<OverviewTab evt={evt} onUpdate={onUpdate} isPast={isPast} currentUser={currentUser} users={users} onSendNotif={onSendNotif}/>}
        {tab==="Polls"                &&<PollsTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast} users={users} onSendNotif={onSendNotif}/>}
        {tab==="Photos"               &&<PhotosTab evt={evt} onUpdate={onUpdate} currentUser={currentUser}/>}
        {tab==="Winners & Highlights" &&<WinnersTab evt={evt} onUpdate={onUpdate} currentUser={currentUser} isPast={isPast} quizResults={quizResults} tournamentResults={tournamentResults}/>}
        {tab==="FAQ"                  &&<FAQTab evt={evt} onUpdate={onUpdate} currentUser={currentUser}/>}
        {tab==="Kretjes 🍺"           &&<KretjesTab evt={evt} onUpdate={onUpdate} currentUser={currentUser}/>}
      </div>

      {/* Live presentation banner — fixed at top of screen */}
      {!presenting&&presenterDetected&&viewerDismissed&&(
        <div className="ann-banner" style={{position:"fixed",top:0,left:0,right:0,zIndex:999,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:"linear-gradient(90deg,rgba(15,10,2,.97),rgba(30,18,4,.97))",borderBottom:"1px solid rgba(232,148,58,.45)",padding:".7rem 1.4rem",backdropFilter:"blur(12px)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"var(--red)",flexShrink:0,animation:"pulse 1s ease-in-out infinite",display:"inline-block"}}/>
            <div>
              <div style={{fontWeight:700,color:"var(--amber2)",fontSize:".88rem"}}>🎬 Presentation is live</div>
              <div style={{fontSize:".73rem",color:"var(--muted)"}}>The event schedule is being presented right now</div>
            </div>
          </div>
          <Btn onClick={()=>setViewerDismissed(false)} variant="primary" size="sm">▶ Rejoin</Btn>
        </div>
      )}

      {editing&&<EditEventModal evt={evt} users={users} onSave={u=>{onUpdate(u);setEditing(false)}} onClose={()=>setEditing(false)}/>}
      {presenting&&<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={true} onClose={()=>setPresenting(false)}/>}
      {!presenting&&presenterDetected&&!viewerDismissed&&<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={false} currentLive={schedLive} onHide={()=>setViewerDismissed(true)} onPresenterLeft={resetPresenter} onClose={()=>{}}/>}
      {/* Solo browsing: a live admin presentation still wins -- if one starts
          mid-session (presenterDetected flips true) this unmounts and the
          synced viewer above takes over instead, no rejoin banner or
          join/browse chooser involved, per the owner's explicit call. */}
      {soloOpen&&!presenterDetected&&<PresentationMode evt={evt} onUpdate={onUpdate} isPresenter={false} isSolo={true} onClose={()=>setSoloOpen(false)}/>}
      {trailerOpen&&<Suspense fallback={null}>
        <EventTrailer input={trailerInput} onClose={()=>setTrailerOpen(false)}/>
      </Suspense>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB — Member RSVP + Schedule
// ─────────────────────────────────────────────────────────────────────────────
const OverviewTab=({evt,onUpdate,isPast,currentUser,users=[],onSendNotif})=>{
  const [editSched,setEditSched]=useState(false);
  const [notifyPending,setNotifyPending]=useState(null);
  const statusOpts=isPast?["went","absent"]:["going","maybe","not coming"];
  const colorOf=s=>statusMap[s]?.color??"var(--muted)";
  const isAdmin=can.editEvent(currentUser);
  const isScheduleEditor=can.editSchedule(currentUser);
  const statusEmoji={going:"🔥",maybe:"🤔","not coming":"❌",went:"✅",absent:"😴"};
  const _hasStatus=evt.attendees.find(a=>a.name.toLowerCase()===currentUser.username.toLowerCase())?.status;
  const [rsvpOpen,setRsvpOpen]=useState(!_hasStatus);

  const toggleSecretStop=(i,secret)=>{
    onUpdate({...evt,schedule:evt.schedule.map((s,j)=>j===i?{...s,secret}:s)});
    if(!secret&&onSendNotif){
      const stop=evt.schedule[i];
      setNotifyPending({message:`📍 Stop onthuld: "${stop.activity}"`,type:"schedule",tab:"Overview",targetId:null,eventId:evt.id,event:evt.name});
    }
  };

  const updateStatus=(idx,val)=>{
    if(!can.updateRsvp(currentUser))return;
    onUpdate({...evt,attendees:evt.attendees.map((a,i)=>i===idx?{...a,status:val}:a)});
  };

  // Member self-RSVP — find if current user is in attendees
  const myIdx=evt.attendees.findIndex(a=>a.name.toLowerCase()===currentUser.username.toLowerCase());
  const myEntry=myIdx>=0?evt.attendees[myIdx]:null;

  const selfRsvp=(val)=>{
    if(!can.updateRsvp(currentUser))return;
    let updated;
    if(myIdx>=0){
      updated={...evt,attendees:evt.attendees.map((a,i)=>i===myIdx?{...a,status:val}:a)};
    } else {
      // Not in list yet — add them
      updated={...evt,attendees:[...evt.attendees,{name:currentUser.username,status:val}]};
    }
    onUpdate(updated);
    setRsvpOpen(false);
  };

  const totals=statusOpts.reduce((acc,s)=>{acc[s]=evt.attendees.filter(a=>a.status===s).length;return acc;},{});

  return(
    <div style={{display:"grid",gap:"1.4rem"}}>

      {/* ── RSVP card ── */}
      {!isPast&&can.updateRsvp(currentUser)&&(
        <Card style={{background:"linear-gradient(135deg,#1e1508,#291a08)",borderColor:myEntry?.status?`${colorOf(myEntry.status)}44`:"var(--border2)",position:"relative",overflow:"hidden",transition:"border-color .3s"}}>
          <div style={{position:"absolute",top:-40,right:-40,width:140,height:140,background:"radial-gradient(circle,rgba(232,148,58,.08),transparent 70%)",borderRadius:"50%",pointerEvents:"none"}}/>
          {/* Always-visible compact header */}
          <div onClick={()=>setRsvpOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",userSelect:"none"}}>
            <Avatar name={currentUser.username} size={34} index={currentUser.animal_avatar??currentUser.avatar??0} photoUrl={currentUser.photo_url||""}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)",fontWeight:700,lineHeight:1}}>{currentUser.username}</div>
              <div style={{fontSize:".73rem",color:"var(--muted)",marginTop:3}}>
                {myEntry?.status
                  ? <><span style={{color:colorOf(myEntry.status)}}>{statusEmoji[myEntry.status]} {statusMap[myEntry.status]?.label}</span> · tap to change</>
                  : "Not locked in yet — tap to set status"}
              </div>
            </div>
            {myEntry?.status&&!rsvpOpen&&(
              <div style={{background:`${colorOf(myEntry.status)}18`,border:`1px solid ${colorOf(myEntry.status)}55`,borderRadius:8,padding:"5px 12px",fontSize:".8rem",color:colorOf(myEntry.status),fontWeight:700,flexShrink:0,whiteSpace:"nowrap"}}>
                {statusEmoji[myEntry.status]} {statusMap[myEntry.status]?.label}
              </div>
            )}
            <span style={{color:"var(--muted)",fontSize:"1.1rem",flexShrink:0,transition:"transform .22s cubic-bezier(.4,0,.2,1)",transform:rsvpOpen?"rotate(90deg)":"none",display:"inline-block"}}>›</span>
          </div>
          {/* Animated expandable buttons */}
          <div style={{maxHeight:rsvpOpen?"160px":"0",overflow:"hidden",transition:"max-height .3s cubic-bezier(.4,0,.2,1)"}}>
            <div style={{paddingTop:"1rem",opacity:rsvpOpen?1:0,transform:rsvpOpen?"translateY(0)":"translateY(-6px)",transition:"opacity .22s ease .06s,transform .22s ease .06s"}}>
              <div style={{fontFamily:"var(--font-h)",fontSize:".9rem",color:"var(--cream)",opacity:.7,marginBottom:".7rem",fontStyle:"italic"}}>Are you coming? Make it official.</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                {[{s:"going",emoji:"🔥",label:"I'm In"},{s:"maybe",emoji:"🤔",label:"Maybe"},{s:"not coming",emoji:"❌",label:"Can't Make It"}].map(({s,emoji,label})=>{
                  const sel=myEntry?.status===s;
                  const c=colorOf(s);
                  return(
                    <button key={s} className="rsvp-btn" onClick={e=>{e.stopPropagation();selfRsvp(s);}} style={{
                      background:sel?`${c}22`:"transparent",
                      border:`2px solid ${sel?c:`${c}40`}`,
                      color:sel?c:"var(--muted)",
                      borderRadius:"var(--radius-sm)",padding:"9px 18px",cursor:"pointer",
                      fontFamily:"var(--font-b)",fontWeight:700,fontSize:".85rem",
                      display:"flex",alignItems:"center",gap:7,
                      boxShadow:sel?`0 0 18px ${c}30`:"none",
                    }}>
                      <span style={{fontSize:"1.1rem"}}>{emoji}</span>
                      {label}
                      {sel&&<span style={{fontSize:".62rem",letterSpacing:".08em",opacity:.75,marginLeft:2}}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {notifyPending&&(
        <div style={{background:"rgba(232,148,58,.08)",border:"1px solid rgba(232,148,58,.3)",borderRadius:"var(--radius-sm)",padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{fontSize:".83rem",color:"var(--amber2)"}}>📣 Leden inlichten over deze reveal?</div>
          <div style={{display:"flex",gap:6}}>
            <Btn size="sm" onClick={()=>{onSendNotif(notifyPending);setNotifyPending(null);}}>Verstuur</Btn>
            <Btn size="sm" variant="ghost" onClick={()=>setNotifyPending(null)}>Niet nu</Btn>
          </div>
        </div>
      )}

      {/* ── Schedule — Sneak Peek ── */}
      <Card style={{background:"linear-gradient(135deg,var(--bg2),#1c1408)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1.2rem"}}>
          <div>
            <H style={{marginBottom:3}}>{isPast?"📋 What Went Down":"👀 What's on the Menu"}</H>
            {!isPast&&evt.schedule.length>0&&<div style={{fontSize:".75rem",color:"var(--muted)"}}>The agenda is locked. Here&apos;s a taste of what&apos;s coming.</div>}
          </div>
          {isAdmin&&<Btn onClick={()=>setEditSched(true)} variant="ghost" size="sm">✎ Edit</Btn>}
        </div>

        {evt.schedule.length===0&&(
          <div style={{textAlign:"center",padding:"2.5rem 1rem",color:"var(--muted)"}}>
            <div style={{fontSize:"2.5rem",marginBottom:".6rem"}}>🔒</div>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)",marginBottom:".3rem"}}>Schedule under wraps</div>
            <div style={{fontSize:".8rem"}}>The lads don&apos;t need to know yet.</div>
            {isAdmin&&<div style={{marginTop:".6rem",fontSize:".75rem",color:"var(--amber)"}}>Add activities with Edit ↑</div>}
          </div>
        )}

        {(()=>{
          const sortedSchedule=[...evt.schedule].sort(scheduleDayTimeOrder);
          const visibleStops=isScheduleEditor?sortedSchedule:sortedSchedule.filter(s=>!s.secret);
          const hiddenCount=evt.schedule.filter(s=>s.secret).length;
          // Day separators only appear when the visible stops actually span
          // more than one distinct day -- a true single-day event (or one
          // where every visible stop still sits on day 0) renders identically
          // to before, no separators at all.
          const showDaySeparators=new Set(visibleStops.map(s=>s.day??0)).size>1;
          const stopEls=[];
          visibleStops.forEach((s,i)=>{
                  const globalIdx=evt.schedule.indexOf(s);
                  const isSecret=!!s.secret;
                  const stopDay=s.day??0;
                  if(showDaySeparators&&(i===0||stopDay!==(visibleStops[i-1].day??0))){
                    stopEls.push(
                      <div key={`day-${stopDay}-${i}`} style={{fontSize:".68rem",color:"var(--amber)",letterSpacing:".08em",fontWeight:700,marginTop:i===0?0:".2rem",paddingBottom:5,borderBottom:"1px solid var(--border)"}}>{dayHeadingLabel(evt.date,stopDay)}</div>
                    );
                  }
                  stopEls.push(
                    <div key={i} className="schedule-card" style={{
                      background:isSecret?"rgba(30,10,10,.9)":isPast?"var(--bg3)":"linear-gradient(90deg,rgba(29,20,8,.9),rgba(21,14,4,.7))",
                      border:`1px solid ${isSecret?"rgba(224,85,85,.28)":isPast?"var(--border)":"rgba(232,148,58,.18)"}`,
                      borderRadius:"var(--radius-sm)",padding:".75rem 1rem",
                      position:"relative",overflow:"hidden",
                      animationDelay:`${i*.07}s`,
                    }}>
                      {/* Left accent */}
                      <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:isSecret?"linear-gradient(to bottom,var(--red),rgba(224,85,85,.4))":isPast?"linear-gradient(to bottom,var(--muted2),var(--muted))":"linear-gradient(to bottom,var(--amber),var(--gold))",opacity:isSecret?.7:isPast?.4:.7}}/>

                      {/* Top row: icon + time + activity */}
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                        <div style={{width:28,height:28,borderRadius:7,flexShrink:0,background:isSecret?"rgba(224,85,85,.08)":isPast?"var(--bg4)":"rgba(232,148,58,.1)",border:`1px solid ${isSecret?"rgba(224,85,85,.2)":isPast?"var(--border)":"rgba(232,148,58,.28)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:".95rem"}}>{isSecret?"🔒":s.icon||"📍"}</div>
                        {s.time&&<span style={{fontFamily:"var(--font-h)",fontSize:".82rem",color:isSecret?"rgba(224,85,85,.7)":isPast?"var(--muted)":"var(--amber)",fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>{s.time}</span>}
                        <span style={{fontWeight:600,fontSize:".9rem",color:isSecret?"rgba(224,85,85,.6)":isPast?"var(--cream)":"var(--amber2)",lineHeight:1.3,flex:1,minWidth:0}}>{s.activity}</span>
                        {isPast&&!isSecret&&<span style={{fontSize:".6rem",color:"var(--green)",letterSpacing:".1em",textTransform:"uppercase",opacity:.7,fontWeight:700,flexShrink:0}}>✓ Done</span>}
                        {isScheduleEditor&&(
                          <button onClick={()=>toggleSecretStop(globalIdx,!isSecret)}
                            onMouseEnter={e=>{e.currentTarget.style.opacity="1";}}
                            onMouseLeave={e=>{e.currentTarget.style.opacity=".75";}}
                            style={{background:isSecret?"rgba(76,175,125,.12)":"rgba(224,85,85,.1)",border:`1px solid ${isSecret?"rgba(76,175,125,.3)":"rgba(224,85,85,.3)"}`,borderRadius:6,cursor:"pointer",padding:"2px 8px",fontSize:".66rem",fontWeight:700,color:isSecret?"var(--green)":"var(--red)",opacity:.75,transition:"opacity .15s",flexShrink:0}}>
                            {isSecret?"👁 Reveal":"🔒 Hide"}
                          </button>
                        )}
                      </div>

                      {/* Location / note */}
                      {!isSecret&&(s.location||s.note)&&(
                        <div style={{marginTop:5,display:"flex",flexDirection:"column",gap:2}}>
                          {s.location&&(
                            // A schedule stop's Maps URL is hand-typed, hand-editable JSONB --
                            // React doesn't block a `javascript:` href, so this is stored XSS
                            // on click without the same http(s)-only guard the trailer's URLs
                            // already get (isSafeImageUrl, safeUrl.js).
                            isSafeImageUrl(s.locationUrl)
                              ?<a href={s.locationUrl} target="_blank" rel="noreferrer" style={{fontSize:".74rem",color:"var(--amber)",textDecoration:"none",opacity:.8}}>📍 {s.location} ↗</a>
                              :<span style={{fontSize:".74rem",color:"var(--muted)"}}>📍 {s.location}</span>
                          )}
                          {s.note&&<span style={{fontSize:".72rem",color:"var(--muted)",fontStyle:"italic"}}>💬 {s.note}</span>}
                        </div>
                      )}
                    </div>
                  );
          });
          return(
            <>
              <div style={{display:"grid",gap:".55rem"}}>{stopEls}</div>
              {!isScheduleEditor&&hiddenCount>0&&(
                <div style={{textAlign:"center",padding:".7rem",marginTop:".3rem",background:"var(--bg3)",borderRadius:"var(--radius-sm)",border:"1px solid var(--border)"}}>
                  <span style={{fontSize:".78rem",color:"var(--muted)"}}>🔒 {hiddenCount} stop{hiddenCount!==1?"s":""} nog geheim — wordt later onthuld</span>
                </div>
              )}
            </>
          );
        })()}
        {editSched&&<EditScheduleModal evt={evt} onSave={sched=>{onUpdate({...evt,schedule:sched});setEditSched(false)}} onClose={()=>setEditSched(false)}/>}
      </Card>

      {/* Attendees full list */}
      <Card>
        <H>Who&apos;s {isPast?"Attended":"Coming"}</H>
        <div style={{display:"flex",gap:6,marginBottom:"1rem",flexWrap:"wrap"}}>
          {statusOpts.map(s=><div key={s} style={{background:colorOf(s)+"22",border:`1px solid ${colorOf(s)}44`,borderRadius:7,padding:"3px 10px",fontSize:".72rem",color:colorOf(s),fontWeight:600}}>{totals[s]||0} {statusMap[s]?.label}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:6}}>
          {evt.attendees.map((a,i)=>{
            const isMe=a.name.toLowerCase()===currentUser.username.toLowerCase();
            const canChange=isAdmin;
            return(
              <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--bg3)",borderRadius:10,padding:"9px 12px",border:isMe?"1px solid var(--border2)":"1px solid transparent"}}>
                <div style={{display:"flex",alignItems:"center",gap:9}}>
                  <Avatar name={a.name} size={28} {...getUA(a.name,users)}/>
                  <div><span style={{fontWeight:500,fontSize:".86rem"}}>{getDisplayName(a.name,users)}</span>{isMe&&<span style={{fontSize:".68rem",color:"var(--amber)",marginLeft:6}}>you</span>}</div>
                </div>
                {canChange?(
                  <select value={a.status} onChange={e=>updateStatus(i,e.target.value)} style={{background:colorOf(a.status)+"22",color:colorOf(a.status),border:`1px solid ${colorOf(a.status)}44`,borderRadius:7,padding:"3px 7px",fontSize:".73rem",cursor:"pointer",fontFamily:"var(--font-b)"}}>
                    {statusOpts.map(s=><option key={s} value={s}>{statusMap[s]?.label}</option>)}
                  </select>
                ):<Tag color={colorOf(a.status)}>{statusMap[a.status]?.label||a.status}</Tag>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// POLLS TAB
// ─────────────────────────────────────────────────────────────────────────────
const PollsTab=({evt,onUpdate,currentUser,isPast,users=[],onSendNotif})=>{
  const [creating,setCreating]=useState(false);
  const blankPoll={title:"",emoji:"📊",options:["",""],secret:false,locked:false,allowUserOptions:false,linkUrl:"",linkLabel:""};
  const [newPoll,setNewPoll]=useState(blankPoll);
  const [showLink,setShowLink]=useState(false);
  const [userOptInputs,setUserOptInputs]=useState({});
  const [expanded,setExpanded]=useState({});
  const [editingOpt,setEditingOpt]=useState(null);
  const [notifyPending,setNotifyPending]=useState(null);
  const isOrg=can.closePoll(currentUser);

  const savePolls=p=>onUpdate({...evt,polls:p});

  const saveEditOpt=()=>{
    if(!editingOpt)return;
    const{pollId,idx,value}=editingOpt;
    if(!value.trim())return;
    savePolls((evt.polls||[]).map(p=>p.id!==pollId?p:{...p,options:p.options.map((o,i)=>i===idx?{...o,label:value.trim()}:o)}));
    setEditingOpt(null);
  };

  const movePoll=(pollId,d)=>{
    const arr=[...(evt.polls||[])];
    const p=arr.find(x=>x.id===pollId);
    if(!p)return;
    const grp=arr.filter(x=>!!x.closed===!!p.closed);
    const gi=grp.findIndex(x=>x.id===pollId);
    const ni=gi+d;
    if(ni<0||ni>=grp.length)return;
    const ia=arr.findIndex(x=>x.id===pollId);
    const ja=arr.findIndex(x=>x.id===grp[ni].id);
    [arr[ia],arr[ja]]=[arr[ja],arr[ia]];
    savePolls(arr);
  };

  const vote=(pollId,optIdx)=>{
    if(!can.vote(currentUser))return;
    savePolls((evt.polls||[]).map(p=>{
      if(p.id!==pollId||p.closed)return p;
      return{...p,options:p.options.map((o,i)=>{
        if(i===optIdx)return o.votes.includes(currentUser.username)?{...o,votes:o.votes.filter(v=>v!==currentUser.username)}:{...o,votes:[...o.votes,currentUser.username]};
        return{...o,votes:o.votes.filter(v=>v!==currentUser.username)};
      })};
    }));
  };

  const addUserOption=(pollId)=>{
    const label=(userOptInputs[pollId]||"").trim();
    if(!label)return;
    savePolls((evt.polls||[]).map(p=>{
      if(p.id!==pollId)return p;
      // Remove user's existing vote, add new option with their vote
      const cleared=p.options.map(o=>({...o,votes:o.votes.filter(v=>v!==currentUser.username)}));
      return{...p,options:[...cleared,{label,votes:[currentUser.username],addedBy:currentUser.username}]};
    }));
    setUserOptInputs(s=>({...s,[pollId]:""}));
  };

  const addPoll=()=>{
    const opts=newPoll.options.filter(o=>o.trim());
    if(!newPoll.title.trim())return;
    if(!newPoll.allowUserOptions&&opts.length<2)return;
    const link=(newPoll.linkUrl.trim())?{url:newPoll.linkUrl.trim(),label:newPoll.linkLabel.trim()||newPoll.linkUrl.trim()}:null;
    savePolls([...(evt.polls||[]),{
      id:`p${Date.now()}`,title:newPoll.title,emoji:newPoll.emoji,
      closed:false,secret:!!newPoll.secret,locked:!!newPoll.locked,allowUserOptions:!!newPoll.allowUserOptions,
      link,options:opts.map(o=>({label:o,votes:[]}))
    }]);
    setNewPoll(blankPoll);setShowLink(false);setCreating(false);
  };

  const Toggle=({value,onChange,label})=>(
    <div onClick={onChange} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none"}}>
      <div style={{width:36,height:20,borderRadius:10,background:value?"var(--amber)":"var(--bg3)",border:`1px solid ${value?"var(--amber)":"var(--border)"}`,position:"relative",transition:"background .15s,border-color .15s",flexShrink:0}}>
        <div style={{position:"absolute",top:2,left:value?18:2,width:14,height:14,borderRadius:"50%",background:value?"#1a1008":"var(--muted2)",transition:"left .15s"}}/>
      </div>
      <span style={{fontSize:".83rem",color:"var(--cream)"}}>{label}</span>
    </div>
  );

  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:".8rem"}}>
        <div style={{fontSize:".82rem",color:"var(--muted)"}}>Voting as <strong style={{color:"var(--cream)"}}>{currentUser.username}</strong></div>
        {can.createPoll(currentUser)&&!isPast&&<Btn onClick={()=>setCreating(true)} size="sm">+ New Poll</Btn>}
      </div>
      {notifyPending&&(
        <div style={{background:"rgba(232,148,58,.08)",border:"1px solid rgba(232,148,58,.3)",borderRadius:"var(--radius-sm)",padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{fontSize:".83rem",color:"var(--amber2)"}}>📣 Leden inlichten over deze reveal?</div>
          <div style={{display:"flex",gap:6}}>
            <Btn size="sm" onClick={()=>{onSendNotif(notifyPending);setNotifyPending(null);}}>Verstuur</Btn>
            <Btn size="sm" variant="ghost" onClick={()=>setNotifyPending(null)}>Niet nu</Btn>
          </div>
        </div>
      )}
      {!can.vote(currentUser)&&<div style={{background:"rgba(232,148,58,.07)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"10px 14px",fontSize:".83rem",color:"var(--muted)"}}>🔒 Member access required to vote.</div>}
      {(evt.polls||[]).length===0&&<Card style={{textAlign:"center",padding:"3rem",color:"var(--muted)"}}>No polls yet{!can.createPoll(currentUser)?" — admin will add one soon.":""}.</Card>}
      {(()=>{
        const renderPoll=(poll,grp,gi)=>{
          const isExp=expanded[poll.id]!==false;
          const resultsHidden=!!poll.locked&&!isOrg;
          if(!!poll.secret&&!isOrg){
            return(
              <Card key={poll.id} style={{opacity:.75}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{fontSize:"2rem",opacity:.4}}>🔒</div>
                  <div>
                    <div style={{fontFamily:"var(--font-h)",fontSize:".95rem",color:"var(--muted)"}}>Hidden poll</div>
                    <div style={{fontSize:".75rem",color:"var(--muted2)",marginTop:2}}>The organisation will reveal this at the right moment</div>
                  </div>
                </div>
              </Card>
            );
          }
          const total=poll.options.reduce((s,o)=>s+o.votes.length,0);
          const maxV=Math.max(...poll.options.map(o=>o.votes.length));
          return(
            <Card key={poll.id} id={`poll-${poll.id}`} style={{...(poll.closed?{opacity:.8}:{}),padding:0,overflow:"hidden"}}>
              {/* Header — click anywhere to expand/collapse */}
              <div onClick={()=>setExpanded(s=>({...s,[poll.id]:!isExp}))}
                style={{cursor:"pointer",padding:"1rem 1.2rem",display:"flex",alignItems:"center",gap:12,userSelect:"none"}}>
                <div style={{fontSize:"1.6rem",lineHeight:1,flexShrink:0}}>{poll.emoji}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)",marginBottom:3}}>{poll.title}</div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:".7rem",fontWeight:600,letterSpacing:".05em",padding:"2px 7px",borderRadius:20,background:poll.closed?"rgba(255,255,255,.06)":"rgba(80,200,120,.12)",color:poll.closed?"var(--muted)":"#5dc87a",border:poll.closed?"1px solid rgba(255,255,255,.08)":"1px solid rgba(80,200,120,.2)"}}>{poll.closed?"Closed":"Open"}</span>
                    {!resultsHidden&&<span style={{fontSize:".72rem",color:"var(--muted)"}}>{total} vote{total!==1?"s":""}</span>}
                    {resultsHidden&&<span style={{fontSize:".7rem",color:"var(--orange)",fontWeight:600}}>🔒 Results locked</span>}
                    {isOrg&&!!poll.secret&&<span style={{fontSize:".7rem",color:"rgba(220,80,80,.85)",fontWeight:600}}>🤫 Secret</span>}
                    {poll.link?.url&&<span style={{fontSize:".7rem",color:"var(--amber)",opacity:.7}}>🔗</span>}
                  </div>
                </div>
                <div style={{fontSize:".7rem",color:"var(--muted)",transition:"transform .2s",transform:isExp?"rotate(0deg)":"rotate(-90deg)",flexShrink:0}}>▼</div>
              </div>

              {/* Collapsible body */}
              <div style={{overflow:"hidden",maxHeight:isExp?"800px":"0",transition:"max-height .28s ease"}}>
                <div style={{padding:"0 1.2rem 1.2rem",display:"grid",gap:8}}>

                  {/* Locked results banner */}
                  {resultsHidden&&(
                    <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,140,0,.08)",border:"1px solid rgba(255,140,0,.25)",borderRadius:8,padding:"8px 12px"}}>
                      <span>👁</span>
                      <div>
                        <div style={{fontSize:".8rem",fontWeight:600,color:"var(--orange)"}}>Results are locked</div>
                        <div style={{fontSize:".7rem",color:"var(--muted)"}}>The organisation will reveal results later</div>
                      </div>
                    </div>
                  )}

                  {/* External link -- hand-typed, hand-editable JSONB, same
                      javascript:-href guard as the schedule stop's Maps URL. */}
                  {poll.link?.url&&isSafeImageUrl(poll.link.url)&&(
                    <a href={poll.link.url} target="_blank" rel="noreferrer"
                      style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:10,background:"rgba(232,148,58,.07)",border:"1px solid rgba(232,148,58,.2)",color:"var(--amber2)",textDecoration:"none",fontSize:".85rem",fontWeight:500}}>
                      <span style={{fontSize:"1rem"}}>🔗</span>
                      <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{poll.link.label||poll.link.url}</span>
                      <span style={{opacity:.5,fontSize:".7rem"}}>↗</span>
                    </a>
                  )}

                  {/* Vote options */}
                  {poll.options.map((opt,i)=>{
                    const pct=total?Math.round(opt.votes.length/total*100):0;
                    const myVote=opt.votes.includes(currentUser.username);
                    const isWinner=!resultsHidden&&opt.votes.length===maxV&&opt.votes.length>0;
                    const clickable=can.vote(currentUser)&&!isPast&&!poll.closed;
                    const isMyOpt=opt.addedBy===currentUser.username;
                    const onlyMyVote=opt.votes.length===1&&opt.votes[0]===currentUser.username;
                    const canEditOpt=isMyOpt&&onlyMyVote&&!poll.closed&&!isPast;
                    const canDelOpt=(isOrg||(isMyOpt&&onlyMyVote))&&!poll.closed&&!isPast;
                    const isEditing=editingOpt?.pollId===poll.id&&editingOpt?.idx===i;
                    return(
                      <div key={i} style={{position:"relative",borderRadius:12,overflow:"hidden",border:myVote?"1px solid var(--amber)":"1px solid var(--border)",transition:"border-color .15s"}}>
                        {/* progress bar bg */}
                        {!isEditing&&!resultsHidden&&(
                          <div style={{position:"absolute",inset:0,background:myVote?"rgba(232,148,58,.1)":"rgba(255,255,255,.02)",width:pct+"%",transition:"width .4s ease",pointerEvents:"none"}}/>
                        )}
                        {isEditing?(
                          <div style={{display:"flex",gap:8,padding:"10px 12px",alignItems:"center"}}>
                            <Inp value={editingOpt.value} autoFocus
                              onChange={e=>setEditingOpt(s=>({...s,value:e.target.value}))}
                              onKeyDown={e=>{if(e.key==="Enter")saveEditOpt();if(e.key==="Escape")setEditingOpt(null);}}
                              style={{flex:1,fontSize:".88rem",padding:"6px 10px"}}/>
                            <Btn onClick={saveEditOpt} size="sm" variant="ghost">✓</Btn>
                            <Btn onClick={()=>setEditingOpt(null)} size="sm" variant="ghost">✕</Btn>
                          </div>
                        ):(
                          <div onClick={()=>clickable&&vote(poll.id,i)}
                            style={{position:"relative",display:"flex",alignItems:"center",gap:10,padding:"13px 14px",cursor:clickable?"pointer":"default",minHeight:48}}>
                            {/* Vote indicator */}
                            <div style={{width:20,height:20,borderRadius:"50%",border:myVote?"2px solid var(--amber)":"2px solid var(--border)",background:myVote?"var(--amber)":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
                              {myVote&&<div style={{width:8,height:8,borderRadius:"50%",background:"#1a1008"}}/>}
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                                {isWinner&&<span style={{fontSize:"13px"}}>👑</span>}
                                <span style={{fontWeight:myVote?600:400,color:myVote?"var(--amber2)":"var(--cream)",fontSize:".9rem"}}>{opt.label}</span>
                                {opt.addedBy&&<span style={{fontSize:".68rem",color:"var(--muted)",fontStyle:"italic"}}>by {getDisplayName(opt.addedBy,users)||opt.addedBy}</span>}
                              </div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                              {resultsHidden?(
                                myVote&&<span style={{fontSize:".78rem",color:"var(--amber)",fontWeight:600}}>✓</span>
                              ):(
                                <>
                                  <div style={{display:"flex",alignItems:"center"}}>{opt.votes.slice(0,4).map((v,vi)=><div key={vi} style={{marginLeft:vi===0?0:-6}}><Avatar name={v} size={18} {...getUA(v,users)}/></div>)}{opt.votes.length>4&&<span style={{fontSize:".65rem",color:"var(--muted)",marginLeft:4}}>+{opt.votes.length-4}</span>}</div>
                                  <span style={{color:"var(--amber)",fontWeight:700,fontSize:".82rem",minWidth:28,textAlign:"right"}}>{pct}%</span>
                                </>
                              )}
                              {(canEditOpt||canDelOpt)&&(
                                <div style={{display:"flex",gap:2}} onClick={e=>e.stopPropagation()}>
                                  {canEditOpt&&<button onClick={()=>setEditingOpt({pollId:poll.id,idx:i,value:opt.label})}
                                    style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".8rem",padding:"2px 4px",opacity:.55}}>✎</button>}
                                  {canDelOpt&&<button onClick={()=>savePolls((evt.polls||[]).map(p=>p.id===poll.id?{...p,options:p.options.filter((_,j)=>j!==i)}:p))}
                                    style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".75rem",padding:"2px 4px",opacity:.55}}>✕</button>}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add own option */}
                  {poll.allowUserOptions&&!poll.closed&&can.vote(currentUser)&&!isPast&&(
                    <div style={{display:"flex",gap:8}}>
                      <Inp value={userOptInputs[poll.id]||""} onChange={e=>setUserOptInputs(s=>({...s,[poll.id]:e.target.value}))}
                        onKeyDown={e=>e.key==="Enter"&&addUserOption(poll.id)}
                        placeholder="Voeg je eigen optie toe…" style={{flex:1,fontSize:".85rem",padding:"9px 12px"}}/>
                      <Btn onClick={()=>addUserOption(poll.id)} size="sm" variant="ghost">+</Btn>
                    </div>
                  )}

                  {/* Admin toolbar — always at bottom, never in header */}
                  {isOrg&&!isPast&&(
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",paddingTop:4,borderTop:"1px solid var(--border)",marginTop:4}}>
                      <Btn onClick={()=>movePoll(poll.id,-1)} variant="ghost" size="sm" style={{opacity:gi===0?.3:1,minWidth:32}}>↑</Btn>
                      <Btn onClick={()=>movePoll(poll.id,1)} variant="ghost" size="sm" style={{opacity:gi===grp.length-1?.3:1,minWidth:32}}>↓</Btn>
                      <div style={{width:1,height:16,background:"var(--border)",margin:"0 2px"}}/>
                      <Btn onClick={()=>{savePolls((evt.polls||[]).map(p=>p.id===poll.id?{...p,secret:!p.secret}:p));if(poll.secret&&onSendNotif)setNotifyPending({message:`📊 Poll beschikbaar: "${poll.title}"`,type:"poll",tab:"Polls",targetId:`poll-${poll.id}`,eventId:evt.id,event:evt.name});}} variant="ghost" size="sm">{poll.secret?"👁 Toon":"🤫 Geheim"}</Btn>
                      <Btn onClick={()=>savePolls((evt.polls||[]).map(p=>p.id===poll.id?{...p,locked:!p.locked}:p))} variant="ghost" size="sm">{poll.locked?"🔓 Onthul":"🔒 Vergrendel"}</Btn>
                      <Btn onClick={()=>savePolls((evt.polls||[]).map(p=>p.id===poll.id?{...p,closed:!p.closed}:p))} variant="ghost" size="sm">{poll.closed?"Heropenen":"Sluiten"}</Btn>
                      <Btn onClick={()=>savePolls((evt.polls||[]).filter(p=>p.id!==poll.id))} variant="danger" size="sm">Verwijder</Btn>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        };
        const open=(evt.polls||[]).filter(p=>!p.closed);
        const closed=(evt.polls||[]).filter(p=>p.closed);
        return(<>
          {open.map((p,i)=>renderPoll(p,open,i))}
          {closed.length>0&&<>
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:".4rem"}}>
              <div style={{flex:1,height:1,background:"var(--border)"}}/>
              <span style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase"}}>🔒 Closed Polls</span>
              <div style={{flex:1,height:1,background:"var(--border)"}}/>
            </div>
            {closed.map((p,i)=>renderPoll(p,closed,i))}
          </>}
        </>);
      })()}

      {creating&&(
        <Modal onClose={()=>{setCreating(false);setNewPoll(blankPoll);setShowLink(false);}} onBackdropClose={()=>{}} maxWidth={460}>
          <H>New Poll</H>
          <div style={{display:"grid",gap:"1rem"}}>
            {/* Title + emoji */}
            <div style={{display:"flex",gap:8}}>
              <Inp value={newPoll.emoji} onChange={e=>setNewPoll({...newPoll,emoji:e.target.value})} style={{width:52,textAlign:"center",fontSize:"1.1rem",flexShrink:0}}/>
              <Inp value={newPoll.title} onChange={e=>setNewPoll({...newPoll,title:e.target.value})} placeholder="Poll question…" autoFocus/>
            </div>

            {/* Options */}
            <div>
              <Lbl>Options</Lbl>
              {newPoll.options.map((o,i)=>(
                <div key={i} style={{display:"flex",gap:6,marginBottom:6}}>
                  <Inp value={o} onChange={e=>{const opts=[...newPoll.options];opts[i]=e.target.value;setNewPoll({...newPoll,options:opts})}} placeholder={`Option ${i+1}`}/>
                  {newPoll.options.length>2&&<Btn onClick={()=>setNewPoll({...newPoll,options:newPoll.options.filter((_,j)=>j!==i)})} variant="ghost" size="sm">✕</Btn>}
                </div>
              ))}
              <Btn onClick={()=>setNewPoll({...newPoll,options:[...newPoll.options,""]})} variant="ghost" size="sm">+ Option</Btn>
            </div>

            {/* Toggles */}
            <div style={{display:"grid",gap:".6rem",background:"var(--bg3)",borderRadius:10,padding:".8rem 1rem",border:"1px solid var(--border)"}}>
              <Toggle value={newPoll.secret} onChange={()=>setNewPoll({...newPoll,secret:!newPoll.secret})} label="🤫 Secret poll — hidden from members until you reveal it"/>
              <Toggle value={newPoll.locked} onChange={()=>setNewPoll({...newPoll,locked:!newPoll.locked})} label="🔒 Lock results — members can vote but not see results"/>
              <Toggle value={newPoll.allowUserOptions} onChange={()=>setNewPoll({...newPoll,allowUserOptions:!newPoll.allowUserOptions})} label="✏️ Let members add their own options"/>
            </div>

            {/* External link */}
            {!showLink?(
              <button onClick={()=>setShowLink(true)} style={{background:"none",border:"none",color:"var(--amber)",cursor:"pointer",fontSize:".8rem",textAlign:"left",padding:0,fontFamily:"var(--font-b)"}}>🔗 Add external link (optional)</button>
            ):(
              <div style={{display:"grid",gap:6}}>
                <Lbl>Link</Lbl>
                <Inp value={newPoll.linkUrl} onChange={e=>setNewPoll({...newPoll,linkUrl:e.target.value})} placeholder="https://…"/>
                <Inp value={newPoll.linkLabel} onChange={e=>setNewPoll({...newPoll,linkLabel:e.target.value})} placeholder="Link label (e.g. Food order form)"/>
              </div>
            )}

            <div style={{display:"flex",gap:8}}>
              <Btn onClick={addPoll} disabled={!newPoll.title.trim()||(!newPoll.allowUserOptions&&newPoll.options.filter(o=>o.trim()).length<2)}>Create</Btn>
              <Btn onClick={()=>{setCreating(false);setNewPoll(blankPoll);setShowLink(false);}} variant="ghost">Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PHOTOS TAB
// ─────────────────────────────────────────────────────────────────────────────
const PhotosTab=({evt,onUpdate,currentUser})=>{
  const [lightbox,setLightbox]=useState(null);
  const fileRef=useRef();
  const savePhotos=p=>onUpdate({...evt,photos:p});
  const handleUpload=async e=>{
    if(!can.uploadPhoto(currentUser))return;
    const files=Array.from(e.target.files);
    for(const file of files){
      const path=`${evt.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const{data,error}=await supabase.storage.from("event-photos").upload(path,file);
      if(error){console.error("Upload failed:",error);continue;}
      const{data:{publicUrl}}=supabase.storage.from("event-photos").getPublicUrl(data.path);
      const photo={id:`ph${Date.now()}${Math.random()}`,src:publicUrl,uploader:currentUser.username,caption:"",reactions:{},uploadedAt:new Date().toISOString()};
      onUpdate(prev=>({...prev,photos:[photo,...(prev.photos||[])]}));
    }
    e.target.value="";
  };
  const react=(photoId,emoji)=>{
    if(!can.reactPhoto(currentUser))return;
    const photos=(evt.photos||[]).map(p=>{if(p.id!==photoId)return p;const r={...p.reactions};const list=r[emoji]||[];r[emoji]=list.includes(currentUser.username)?list.filter(u=>u!==currentUser.username):[...list,currentUser.username];return{...p,reactions:r};});
    savePhotos(photos);if(lightbox?.id===photoId)setLightbox(photos.find(p=>p.id===photoId));
  };
  const updateCaption=(photoId,caption)=>{const photos=(evt.photos||[]).map(p=>p.id===photoId?{...p,caption}:p);savePhotos(photos);if(lightbox?.id===photoId)setLightbox({...lightbox,caption});};
  const deletePhoto=(photoId)=>{if(!can.deletePhoto(currentUser))return;savePhotos((evt.photos||[]).filter(p=>p.id!==photoId));setLightbox(null);};
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem"}}>
        <div style={{color:"var(--muted)",fontSize:".84rem"}}>{evt.photos?.length||0} photo{evt.photos?.length!==1?"s":""}</div>
        {can.uploadPhoto(currentUser)&&<Btn onClick={()=>fileRef.current?.click()} size="sm">📷 Upload</Btn>}
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleUpload} style={{display:"none"}}/>
      </div>
      {(!evt.photos||evt.photos.length===0)&&<Card style={{textAlign:"center",padding:"3.5rem 2rem"}}><div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>📷</div><div style={{color:"var(--muted)",fontFamily:"var(--font-h)"}}>No photos yet</div>{can.uploadPhoto(currentUser)&&<Btn onClick={()=>fileRef.current?.click()} style={{marginTop:"1.2rem"}} size="sm">Upload first photo</Btn>}</Card>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))",gap:"1rem"}}>
        {(evt.photos||[]).map(photo=>(
          <div key={photo.id} id={`photo-${photo.id}`} style={{background:"var(--bg2)",borderRadius:"var(--radius)",border:"1px solid var(--border)",overflow:"hidden",cursor:"pointer",transition:"transform .2s"}} onMouseEnter={e=>e.currentTarget.style.transform="translateY(-3px)"} onMouseLeave={e=>e.currentTarget.style.transform=""} onClick={()=>setLightbox(photo)}>
            <div style={{aspectRatio:"4/3",overflow:"hidden"}}><img src={photo.src} alt="" style={{width:"100%",height:"100%",objectFit:"cover",transition:"transform .3s"}} onMouseEnter={e=>e.target.style.transform="scale(1.05)"} onMouseLeave={e=>e.target.style.transform=""}/></div>
            <div style={{padding:"8px 10px"}}>
              {photo.caption&&<div style={{fontSize:".77rem",color:"var(--cream)",opacity:.75,marginBottom:4}}>{photo.caption}</div>}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:".69rem",color:"var(--muted)"}}>{photo.uploader}</div><div style={{display:"flex",gap:3}}>{REACTIONS.map(e=>{const c=(photo.reactions?.[e]||[]).length;return c?<span key={e} style={{fontSize:".7rem",background:"var(--bg3)",borderRadius:5,padding:"2px 5px"}}>{e}{c}</span>:null})}</div></div>
            </div>
          </div>
        ))}
      </div>
      {lightbox&&(
        <div className="ov" onClick={()=>setLightbox(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",zIndex:600,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg2)",borderRadius:"var(--radius)",overflow:"hidden",maxWidth:680,width:"100%",border:"1px solid var(--border2)"}}>
            <img src={lightbox.src} alt="" style={{width:"100%",maxHeight:"58vh",objectFit:"contain",display:"block",background:"#000"}}/>
            <div style={{padding:"1.1rem"}}>
              <input value={lightbox.caption||""} onChange={e=>updateCaption(lightbox.id,e.target.value)} placeholder="Add a caption…" style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"9px 13px",color:"var(--cream)",fontFamily:"var(--font-b)",fontSize:".87rem",width:"100%",outline:"none",marginBottom:"1rem"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{REACTIONS.map(emoji=>{const count=(lightbox.reactions?.[emoji]||[]).length;const mine=(lightbox.reactions?.[emoji]||[]).includes(currentUser.username);return<div key={emoji} onClick={()=>react(lightbox.id,emoji)} style={{background:mine?"rgba(232,148,58,.18)":"var(--bg3)",border:mine?"1px solid var(--amber)":"1px solid var(--border)",borderRadius:8,padding:"6px 11px",cursor:can.reactPhoto(currentUser)?"pointer":"default",fontSize:".87rem",display:"flex",alignItems:"center",gap:4}}>{emoji}{count>0&&<span style={{fontSize:".73rem",color:"var(--muted)"}}>{count}</span>}</div>;})}</div>
                <div style={{display:"flex",gap:6}}>{can.deletePhoto(currentUser)&&<Btn onClick={()=>deletePhoto(lightbox.id)} variant="danger" size="sm">🗑 Delete</Btn>}<Btn onClick={()=>setLightbox(null)} variant="ghost" size="sm">Close</Btn></div>
              </div>
              <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:"1rem"}}>Uploaded by {lightbox.uploader} · {new Date(lightbox.uploadedAt).toLocaleDateString("nl-NL")}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// WINNERS TAB
// ─────────────────────────────────────────────────────────────────────────────
const WinnersTab=({evt,onUpdate,currentUser,quizResults=[],tournamentResults=[]})=>{
  const [addingW,setAddingW]=useState(false);const [addingH,setAddingH]=useState(false);
  const [editW,setEditW]=useState(null);const [editH,setEditH]=useState(null);
  const winners=evt.winners||[];const highlights=evt.highlights||[];
  const saveW=w=>onUpdate({...evt,winners:w});const saveH=h=>onUpdate({...evt,highlights:h});
  const isAdmin=can.addWinner(currentUser);
  // §7.4 (docs/quiz-unification-spec.md): once `finishQuiz` writes a real,
  // editable `Winner` row for a finished quiz, this derived "AUTO" card would
  // double-render next to it -- `isQuizAlreadyPublished` (features/quiz/
  // results.js) is the exact, already-tested dedup this section names,
  // matched on the same `qz-<quiz.id>-` prefix `pushWinnersToEvent` itself
  // dedupes on. Legacy quizzes with no real award row keep their AUTO card.
  // `finishedQuizzesForEvt` also folds in `quizResults` (the `quizzes`
  // table) filtered to this event and not already present in `evt.quizzes`
  // -- a quiz created straight from the standalone page (§14 decision 1) and
  // linked to this event never gets an `evt.quizzes[]` entry at all (no
  // legacy array to dual-write into), so without this it would finish and
  // never show up here.
  const evtQuizIds=new Set((evt.quizzes||[]).map(q=>q&&q.id));
  const finishedQuizzesForEvt=[
    ...(evt.quizzes||[]),
    ...(quizResults||[]).filter(q=>q&&q.eventId===evt.id&&!evtQuizIds.has(q.id)),
  ];
  const quizWinners=finishedQuizzesForEvt
    .filter(q=>q.status==="finished"&&q.scores&&Object.keys(q.scores).length>0)
    .filter(quiz=>!isQuizAlreadyPublished(quiz,winners))
    .map(quiz=>{
      const isTeam=(quiz.teams||[]).length>0;
      const sorted=Object.entries(quiz.scores).sort((a,b)=>b[1]-a[1]);
      if(!sorted.length)return null;
      const [topName,topScore]=sorted[0];
      const team=isTeam?(quiz.teams||[]).find(t=>t.name===topName):null;
      const detail=isTeam&&team?.members?.length?`${topScore} pts · ${team.members.join(", ")}`:`${topScore} pts`;
      return{id:`quiz-winner-${quiz.id}`,icon:isTeam?(team?.avatar||"🎯"):"🧠",category:`🧠 ${quiz.title}`,winner:topName,detail,topScore};
    }).filter(Boolean);
  // Owner decision, 2026-08-26: the event page dropped its Mens-Games 🏆 tab
  // -- tournaments are a stand-alone tool now, and results flow back to this
  // tab automatically instead. Exact mirror of the quiz block above (one
  // pattern, not two): an "AUTO" card per tournament that is linked to this
  // event, finished, and not already covered by a real award row (the same
  // `mg-<tournamentId>-<entrantId>` ids `pushWinnersToEvent` writes,
  // matched via `isTournamentAlreadyPublished` (`features/mensgames/
  // tournamentResults.js`'s own version of `isQuizAlreadyPublished`).
  //
  // **Secret tournaments never reach this line at all** -- two independent
  // checks, deliberately redundant (this invariant has already leaked
  // through two separate channels once on this project): `tournamentResults`
  // itself already excludes `settings.secret===true` rows at the fetch
  // layer (`fetchTournamentResults`), and the `!t.settings?.secret` filter
  // below is the second, so a bug in either one alone still can't leak a
  // secret tournament's result onto a member-visible tab.
  const tournamentWinners=(tournamentResults||[])
    .filter(t=>t&&t.eventId===evt.id&&t.status==="finished"&&!(t.settings&&t.settings.secret))
    .filter(t=>!isTournamentAlreadyPublished(t,winners))
    .map(t=>{
      const placement=tournamentWinnerPlacement(t);
      if(!placement)return null;
      return{id:`mens-winner-${t.id}`,icon:placement.avatar,category:`🏆 ${t.name}`,winner:placement.name,detail:placement.detail};
    }).filter(Boolean);
  const autoWinners=[...quizWinners,...tournamentWinners];
  return(
    <div style={{display:"grid",gap:"1.8rem"}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>🏆 Awards & Winners</H>
          {isAdmin&&<Btn onClick={()=>setAddingW(true)} size="sm">+ Add Award</Btn>}
        </div>
        {winners.length===0&&autoWinners.length===0&&<Card style={{textAlign:"center",padding:"2.5rem",color:"var(--muted)"}}><div style={{fontSize:"2.5rem",marginBottom:".8rem"}}>🏆</div><div style={{fontFamily:"var(--font-h)",marginBottom:".4rem"}}>No awards yet</div></Card>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:"1rem"}}>
          {autoWinners.map(w=>(
            <div key={w.id} style={{background:"var(--bg2)",border:"1px solid rgba(139,92,246,.35)",borderRadius:"var(--radius)",padding:"1.2rem",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#6c63ff,#a78bfa,#6c63ff)"}}/>
              <div style={{position:"absolute",top:8,right:10,fontSize:".6rem",background:"rgba(139,92,246,.18)",color:"#a78bfa",borderRadius:4,padding:"1px 7px",letterSpacing:".07em",fontWeight:700}}>AUTO</div>
              <div style={{fontSize:"1.8rem",marginBottom:".5rem"}}>{w.icon}</div>
              <div style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:3}}>{w.category}</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.25rem",color:"#a78bfa",marginBottom:5}}>{w.winner}</div>
              {w.detail&&<div style={{fontSize:".81rem",color:"var(--cream)",opacity:.7,lineHeight:1.5}}>{w.detail}</div>}
            </div>
          ))}
          {winners.map(w=>(
            <div key={w.id} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.2rem",position:"relative",overflow:"hidden",transition:"border-color .2s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,var(--gold),var(--amber2),var(--gold))"}}/>
              <div style={{fontSize:"1.8rem",marginBottom:".5rem"}}>{w.icon||"🏆"}</div>
              <div style={{fontSize:".72rem",color:"var(--muted)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:3}}>{w.category}</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"1.25rem",color:"var(--amber2)",marginBottom:5}}>{w.winner}</div>
              {w.detail&&<div style={{fontSize:".81rem",color:"var(--cream)",opacity:.7,lineHeight:1.5}}>{w.detail}</div>}
              {isAdmin&&<div style={{display:"flex",gap:6,marginTop:"1rem"}}><Btn onClick={()=>setEditW(w)} variant="ghost" size="sm" style={{padding:"5px 11px",fontSize:".72rem"}}>✎</Btn><Btn onClick={()=>saveW(winners.filter(x=>x.id!==w.id))} variant="danger" size="sm" style={{padding:"5px 11px",fontSize:".72rem"}}>✕</Btn></div>}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
          <H style={{marginBottom:0}}>✨ Highlights & Stories</H>
          {isAdmin&&<Btn onClick={()=>setAddingH(true)} size="sm">+ Add</Btn>}
        </div>
        {highlights.length===0&&<Card style={{textAlign:"center",padding:"2.5rem",color:"var(--muted)"}}><div style={{fontSize:"2.5rem",marginBottom:".8rem"}}>✨</div><div style={{fontFamily:"var(--font-h)"}}>No highlights yet</div></Card>}
        <div style={{display:"grid",gap:".8rem"}}>
          {highlights.map(h=>(
            <div key={h.id} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"1.1rem 1.3rem",display:"flex",gap:"1rem",alignItems:"flex-start",transition:"border-color .2s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
              <div style={{fontSize:"1.5rem",flexShrink:0,marginTop:2}}>{h.emoji||"✨"}</div>
              <div style={{flex:1,fontSize:".89rem",color:"var(--cream)",lineHeight:1.6}}>{h.text}</div>
              {isAdmin&&<div style={{display:"flex",gap:5,flexShrink:0}}><Btn onClick={()=>setEditH(h)} variant="ghost" size="sm" style={{padding:"5px 9px",fontSize:".72rem"}}>✎</Btn><Btn onClick={()=>saveH(highlights.filter(x=>x.id!==h.id))} variant="danger" size="sm" style={{padding:"5px 9px",fontSize:".72rem"}}>✕</Btn></div>}
            </div>
          ))}
        </div>
      </div>
      {(addingW||editW)&&<WinnerForm initial={editW} attendees={evt.attendees.map(a=>a.name)} onSave={w=>{editW?saveW(winners.map(x=>x.id===w.id?w:x)):saveW([...winners,{...w,id:`w${Date.now()}`}]);setAddingW(false);setEditW(null)}} onClose={()=>{setAddingW(false);setEditW(null)}}/>}
      {(addingH||editH)&&<HighlightForm initial={editH} onSave={h=>{editH?saveH(highlights.map(x=>x.id===h.id?h:x)):saveH([...highlights,{...h,id:`h${Date.now()}`}]);setAddingH(false);setEditH(null)}} onClose={()=>{setAddingH(false);setEditH(null)}}/>}
    </div>
  );
};

// WinnerForm/HighlightForm own their `<Modal>` directly (rather than being
// wrapped by one at the call site) specifically so the backdrop-click
// wiring below can reach each form's own local draft state (`d`) -- same
// reason EditScheduleModal owns its Modal inline. Both forms serve dual
// duty (create a new award/highlight, or edit an existing one, selected by
// whether `initial` is passed) -- per the owner's backdrop-click fix
// direction: editing an existing item saves on backdrop click (nothing
// lost, same disabled-Save gate as the button itself), creating a new one
// ignores backdrop clicks entirely (ellipsis onBackdropClose -- a half-
// filled award/highlight would otherwise litter the event with junk).
const WinnerForm=({initial,attendees,onSave,onClose})=>{
  const [d,setD]=useState(initial||{category:"",winner:"",detail:"",icon:"🏆"});
  const [ip,setIp]=useState(false);
  const isEdit=!!initial;
  const canSave=d.category.trim()&&d.winner;
  return(<Modal onClose={onClose} onBackdropClose={isEdit?(()=>{if(canSave)onSave(d);}):(()=>{})} maxWidth={440}><H>{initial?"Edit Award":"New Award"}</H><div style={{display:"grid",gap:".85rem"}}><div><Lbl>Icon</Lbl><div style={{position:"relative",display:"inline-block"}}><button onClick={()=>setIp(!ip)} style={{width:44,height:44,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",cursor:"pointer",fontSize:"22px"}}>{d.icon}</button>{ip&&<div style={{position:"absolute",top:48,left:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:8,display:"flex",flexWrap:"wrap",gap:4,width:228,zIndex:10}}>{TROPHY_ICONS.map(ic=><button key={ic} onClick={()=>{setD({...d,icon:ic});setIp(false)}} style={{background:d.icon===ic?"rgba(232,148,58,.2)":"transparent",border:"none",borderRadius:6,cursor:"pointer",fontSize:"19px",width:34,height:34}}>{ic}</button>)}</div>}</div></div><div><Lbl>Category</Lbl><Inp value={d.category} onChange={e=>setD({...d,category:e.target.value})} placeholder="🏎️ Go-Kart Winner"/></div><div><Lbl>Winner</Lbl><select value={d.winner} onChange={e=>setD({...d,winner:e.target.value})} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:d.winner?"var(--cream)":"var(--muted)",fontSize:".88rem",width:"100%"}}><option value="">Select…</option>{attendees.map(n=><option key={n} value={n}>{n}</option>)}<option value="Everyone">Everyone 🎉</option><option value="Nobody">Nobody 💀</option></select></div><div><Lbl>Story</Lbl><Inp value={d.detail} onChange={e=>setD({...d,detail:e.target.value})} placeholder="What happened?" multiline/></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><Btn onClick={()=>onSave(d)} disabled={!canSave}>Save</Btn><Btn onClick={onClose} variant="ghost">{isEdit?"Discard changes":"Cancel"}</Btn>{isEdit&&<span style={{color:"var(--muted)",fontSize:".7rem"}}>Clicking outside saves automatically</span>}</div></div></Modal>);
};

const HighlightForm=({initial,onSave,onClose})=>{
  const [d,setD]=useState(initial||{text:"",emoji:"✨"});
  const isEdit=!!initial;
  const canSave=d.text.trim();
  return(<Modal onClose={onClose} onBackdropClose={isEdit?(()=>{if(canSave)onSave(d);}):(()=>{})} maxWidth={440}><H>{initial?"Edit":"New Highlight"}</H><div style={{display:"grid",gap:".85rem"}}><div><Lbl>Emoji</Lbl><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{HIGHLIGHT_EMOJIS.map(e=><button key={e} onClick={()=>setD({...d,emoji:e})} style={{width:36,height:36,background:d.emoji===e?"rgba(232,148,58,.25)":"var(--bg3)",border:d.emoji===e?"1px solid var(--amber)":"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:"18px"}}>{e}</button>)}</div></div><div><Lbl>The story</Lbl><Inp value={d.text} onChange={e=>setD({...d,text:e.target.value})} placeholder="What happened?" multiline style={{minHeight:90}}/></div><div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><Btn onClick={()=>onSave(d)} disabled={!canSave}>Save</Btn><Btn onClick={onClose} variant="ghost">{isEdit?"Discard changes":"Cancel"}</Btn>{isEdit&&<span style={{color:"var(--muted)",fontSize:".7rem"}}>Clicking outside saves automatically</span>}</div></div></Modal>);
};

// ─────────────────────────────────────────────────────────────────────────────
// FAQ TAB
// ─────────────────────────────────────────────────────────────────────────────
const FAQTab=({evt,onUpdate,currentUser})=>{
  const isAdmin=can.editEvent(currentUser);
  const faqs=evt.faqs||[];
  const saveFaqs=f=>onUpdate({...evt,faqs:f});

  const [asking,setAsking]=useState(false);
  const [question,setQuestion]=useState("");
  const [answeringId,setAnsweringId]=useState(null);
  const [answerText,setAnswerText]=useState("");
  const [expanded,setExpanded]=useState(()=>new Set());
  const [hoveredFaq,setHoveredFaq]=useState(null);
  const toggle=id=>setExpanded(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});

  const submitQuestion=()=>{
    const q=question.trim();
    if(!q)return;
    saveFaqs([...faqs,{id:`faq-${Date.now()}`,question:q,askedBy:currentUser.username,askedAt:new Date().toISOString(),answer:null,answeredBy:null,answeredAt:null}]);
    setQuestion("");setAsking(false);
  };

  const submitAnswer=(id)=>{
    const a=answerText.trim();
    if(!a)return;
    saveFaqs(faqs.map(f=>f.id===id?{...f,answer:a,answeredBy:currentUser.username,answeredAt:new Date().toISOString()}:f));
    setAnsweringId(null);setAnswerText("");
  };

  const deleteQuestion=(id)=>saveFaqs(faqs.filter(f=>f.id!==id));

  const unanswered=faqs.filter(f=>!f.answer);
  const answered=faqs.filter(f=>f.answer);
  const myPending=unanswered.filter(f=>f.askedBy===currentUser.username);
  const visible=isAdmin?[...unanswered,...answered]:[...myPending,...answered];

  return(
    <div style={{display:"grid",gap:"1.2rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:".8rem"}}>
        <div style={{fontSize:".82rem",color:"var(--muted)"}}>{faqs.length} question{faqs.length!==1?"s":""} · {answered.length} answered</div>
        <Btn onClick={()=>setAsking(true)} size="sm">+ Ask a question</Btn>
      </div>

      {faqs.length===0&&(
        <Card style={{textAlign:"center",padding:"3rem",color:"var(--muted)"}}>
          <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>❓</div>
          <div style={{fontFamily:"var(--font-h)",marginBottom:".4rem"}}>No questions yet</div>
          <div style={{fontSize:".83rem"}}>Be the first to ask something about this event.</div>
        </Card>
      )}

      <div style={{display:"grid",gap:".45rem"}}>
        {visible.map(f=>{
          const isOpen=expanded.has(f.id);
          const hasAnswer=!!f.answer;
          const isOwn=f.askedBy===currentUser.username;
          const isAnswering=answeringId===f.id;
          const borderColor=!hasAnswer&&isAdmin?"rgba(232,148,58,.3)":!hasAnswer&&isOwn?"rgba(90,155,213,.25)":"var(--border)";
          return(
            <div key={f.id} id={`faq-${f.id}`} style={{background:"var(--bg2)",border:`1px solid ${isOpen?( !hasAnswer&&isAdmin?"rgba(232,148,58,.5)":!hasAnswer&&isOwn?"rgba(90,155,213,.45)":"var(--border2)"):borderColor}`,borderRadius:"var(--radius)",overflow:"hidden",transition:"border-color .2s"}}>
              <div
                onClick={()=>toggle(f.id)}
                onMouseEnter={()=>setHoveredFaq(f.id)}
                onMouseLeave={()=>setHoveredFaq(null)}
                style={{display:"flex",alignItems:"center",gap:"1rem",padding:".8rem 1.1rem",cursor:"pointer",userSelect:"none",background:hoveredFaq===f.id&&!isOpen?"rgba(255,255,255,.03)":"transparent",transition:"background .15s"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:".9rem",color:hasAnswer?"var(--amber2)":"var(--cream)"}}>{f.question}</div>
                  <div style={{fontSize:".7rem",color:"var(--muted)",marginTop:2}}>
                    {hasAnswer?`✓ ${f.answeredBy}`:isOwn?"⏳ Waiting for an answer…":`Asked by ${f.askedBy}`}
                  </div>
                </div>
                {!hasAnswer&&isAdmin&&<Tag color="var(--amber)" style={{flexShrink:0,fontSize:".65rem"}}>Unanswered</Tag>}
                {!hasAnswer&&!isAdmin&&isOwn&&<Tag color="var(--blue)" style={{flexShrink:0,fontSize:".65rem"}}>Pending</Tag>}
                <span style={{color:"var(--muted)",fontSize:"1.1rem",flexShrink:0,transition:"transform .22s cubic-bezier(.4,0,.2,1)",transform:isOpen?"rotate(90deg)":"none",display:"inline-block"}}>›</span>
              </div>
              <div style={{maxHeight:isOpen?"600px":"0",overflow:"hidden",transition:"max-height .3s cubic-bezier(.4,0,.2,1)"}}>
                <div style={{borderTop:"1px solid var(--border)",padding:".8rem 1.1rem",opacity:isOpen?1:0,transform:isOpen?"translateY(0)":"translateY(-6px)",transition:"opacity .22s ease .05s, transform .22s ease .05s"}}>
                  {hasAnswer?(
                    <div>
                      <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                        <div style={{width:3,borderRadius:2,background:"var(--amber)",flexShrink:0,alignSelf:"stretch",minHeight:16}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:".88rem",color:"var(--cream)",lineHeight:1.65}}>{f.answer}</div>
                          <div style={{fontSize:".71rem",color:"var(--muted)",marginTop:5}}>
                            Answered by <strong style={{color:"var(--amber)"}}>{f.answeredBy}</strong>
                            {" · "}{new Date(f.answeredAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"})}
                            {" · Asked by "}{f.askedBy}
                          </div>
                        </div>
                      </div>
                      {isAdmin&&<div style={{marginTop:".7rem"}}><Btn onClick={()=>deleteQuestion(f.id)} variant="danger" size="sm">✕ Delete</Btn></div>}
                    </div>
                  ):isAdmin?(
                    <div style={{display:"grid",gap:".6rem"}}>
                      <div style={{fontSize:".72rem",color:"var(--muted)"}}>Asked by <strong style={{color:"var(--cream)"}}>{f.askedBy}</strong> · {new Date(f.askedAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"})}</div>
                      {isAnswering?(
                        <>
                          <Inp value={answerText} onChange={e=>setAnswerText(e.target.value)} placeholder="Type your answer…" multiline rows={3} autoFocus/>
                          <div style={{display:"flex",gap:6}}>
                            <Btn onClick={()=>submitAnswer(f.id)} disabled={!answerText.trim()} size="sm">Post Answer</Btn>
                            <Btn onClick={()=>{setAnsweringId(null);setAnswerText("");}} variant="ghost" size="sm">Cancel</Btn>
                          </div>
                        </>
                      ):(
                        <div style={{display:"flex",gap:6}}>
                          <Btn onClick={()=>{setAnsweringId(f.id);setAnswerText("");}} variant="subtle" size="sm">Answer</Btn>
                          <Btn onClick={()=>deleteQuestion(f.id)} variant="danger" size="sm">✕</Btn>
                        </div>
                      )}
                    </div>
                  ):(
                    <div style={{fontSize:".83rem",color:"var(--muted)"}}>The admin will answer this soon.</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {asking&&(
        <Modal onClose={()=>setAsking(false)} onBackdropClose={()=>{}} maxWidth={480}>
          <H>Ask a question</H>
          <div style={{display:"grid",gap:".9rem"}}>
            <div>
              <Lbl>Your question</Lbl>
              <Inp value={question} onChange={e=>setQuestion(e.target.value)} placeholder="e.g. Do we need to bring cash?" multiline rows={3} autoFocus onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&submitQuestion()}/>
            </div>
            <div style={{fontSize:".78rem",color:"var(--muted)"}}>The admin/host will answer your question and it&apos;ll show up here for everyone to see.</div>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={submitQuestion} disabled={!question.trim()}>Submit</Btn>
              <Btn onClick={()=>{setAsking(false);setQuestion("")}} variant="ghost">Cancel</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ANNOUNCEMENTS
// ─────────────────────────────────────────────────────────────────────────────
const KretjesTab=({evt,onUpdate,currentUser})=>{
  const count=evt.kretjes||0;
  const canEdit=ACTIVE_ROLES.includes(currentUser?.role);
  const change=delta=>{
    if(!canEdit)return;
    const next=Math.max(0,count+delta);
    onUpdate({...evt,kretjes:next});
  };
  const btnStyle=(disabled)=>({
    width:64,height:64,borderRadius:"50%",border:"2px solid rgba(232,148,58,.4)",
    background:disabled?"var(--bg3)":"rgba(232,148,58,.1)",
    color:disabled?"var(--muted)":"var(--amber2)",cursor:disabled?"default":"pointer",
    fontSize:"2rem",fontWeight:300,lineHeight:1,
    display:"flex",alignItems:"center",justifyContent:"center",
    transition:"all .15s",fontFamily:"var(--font-b)",flexShrink:0,
  });
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"3rem 1rem",gap:"2rem"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:"3rem",marginBottom:".4rem"}}>🍺</div>
        <div style={{fontFamily:"var(--font-h)",fontSize:".75rem",color:"var(--muted)",letterSpacing:".18em",textTransform:"uppercase"}}>Kretjes deze editie</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:"2rem"}}>
        <button
          style={btnStyle(!canEdit||count===0)}
          disabled={!canEdit||count===0}
          onMouseEnter={e=>{if(canEdit&&count>0){e.currentTarget.style.background="rgba(232,148,58,.2)";e.currentTarget.style.borderColor="var(--amber)";}}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(232,148,58,.1)";e.currentTarget.style.borderColor="rgba(232,148,58,.4)";}}
          onClick={()=>change(-1)}>−</button>
        <div style={{textAlign:"center",minWidth:120}}>
          <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(4rem,12vw,7rem)",color:"var(--amber2)",lineHeight:1,fontWeight:900,letterSpacing:"-.02em"}}>{count}</div>
        </div>
        <button
          style={btnStyle(!canEdit)}
          disabled={!canEdit}
          onMouseEnter={e=>{if(canEdit){e.currentTarget.style.background="rgba(232,148,58,.2)";e.currentTarget.style.borderColor="var(--amber)";}}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(232,148,58,.1)";e.currentTarget.style.borderColor="rgba(232,148,58,.4)";}}
          onClick={()=>change(1)}>+</button>
      </div>
      <div style={{fontSize:".78rem",color:"var(--muted)",textAlign:"center",maxWidth:260,lineHeight:1.6}}>
        {canEdit?"Tap + of − om het aantal bij te werken. Telt mee in de totaaltelling op de homepage.":"Alleen actieve lads kunnen het aantal aanpassen."}
      </div>
    </div>
  );
};

const renderMd=text=>{
  if(!text)return"";
  const inline=s=>s
    .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,"<em>$1</em>")
    .replace(/~~(.+?)~~/g,"<del>$1</del>")
    .replace(/`(.+?)`/g,"<code style='background:rgba(255,255,255,.1);padding:1px 6px;border-radius:4px;font-family:monospace;font-size:.9em'>$1</code>");
  const safe=text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const lines=safe.split("\n");
  let html="",listItems=[],lastWasList=false;
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/^[-*]\s+(.*)/);
    if(m){listItems.push(`<li>${inline(m[1])}</li>`);}
    else{
      if(listItems.length){html+=`<ul style='margin:.25em 0 .35em 1.3em;padding:0'>${listItems.join("")}</ul>`;listItems=[];lastWasList=true;}
      else lastWasList=false;
      if(html&&!lastWasList)html+="<br/>";
      html+=inline(lines[i]);lastWasList=false;
    }
  }
  if(listItems.length)html+=`<ul style='margin:.25em 0 .35em 1.3em;padding:0'>${listItems.join("")}</ul>`;
  return html;
};

const RichTextInput=({value,onChange,placeholder,rows=4})=>{
  const ta=useRef();
  const wrap=(a,b)=>{
    const el=ta.current;if(!el)return;
    const s=el.selectionStart,e=el.selectionEnd;
    const sel=value.slice(s,e)||"tekst";
    onChange(value.slice(0,s)+a+sel+b+value.slice(e));
    setTimeout(()=>{el.selectionStart=s+a.length;el.selectionEnd=s+a.length+sel.length;el.focus();},0);
  };
  const insertList=()=>{
    const el=ta.current;if(!el)return;
    const pos=el.selectionStart,before=value.slice(0,pos);
    const atLineStart=pos===0||before.endsWith("\n");
    const prefix=atLineStart?"- ":"\n- ";
    const next=before+prefix+value.slice(pos);
    onChange(next);
    setTimeout(()=>{el.selectionStart=el.selectionEnd=pos+prefix.length;el.focus();},0);
  };
  const btnStyle={background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:6,color:"var(--cream)",padding:"4px 10px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",transition:"all .15s"};
  const hover={onMouseEnter:e=>{e.currentTarget.style.background="var(--bg4)";e.currentTarget.style.borderColor="var(--border2)";},onMouseLeave:e=>{e.currentTarget.style.background="var(--bg3)";e.currentTarget.style.borderColor="var(--border)";}};
  const tools=[["B","**","**",{fontWeight:700}],["I","*","*",{fontStyle:"italic"}],["S̶","~~","~~",{textDecoration:"line-through"}],["</>","`","`",{fontFamily:"monospace",fontSize:".82rem"}]];
  return(
    <div>
      <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap"}}>
        {tools.map(([icon,a,b,s])=>(
          <button key={icon} type="button" onClick={()=>wrap(a,b)} {...hover} style={{...btnStyle,...s}}>{icon}</button>
        ))}
        <button type="button" onClick={insertList} {...hover} style={btnStyle}>• Lijst</button>
        <span style={{fontSize:".7rem",color:"var(--muted)",alignSelf:"center",marginLeft:4}}>Selecteer + stijl</span>
      </div>
      <textarea ref={ta} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows}
        style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%",outline:"none",resize:"vertical",fontFamily:"var(--font-b)",lineHeight:1.6}}/>
    </div>
  );
};

const AnnouncementModal=({onSave,onClose,existing=null,currentUser})=>{
  const [title,setTitle]=useState(existing?.title||"");
  const [body,setBody]=useState(existing?.body||"");
  const save=()=>{
    if(!title.trim())return;
    onSave({
      id:existing?.id||`ann-${Date.now()}`,
      title:title.trim(),body,
      createdBy:currentUser.username,
      createdAt:existing?.createdAt||new Date().toISOString(),
    });
  };
  return(
    <Modal onClose={onClose} onBackdropClose={existing?save:()=>{}} maxWidth={560}>
      <H>📢 {existing?"Edit":"New"} Announcement</H>
      <div style={{display:"grid",gap:".9rem"}}>
        <div><Lbl>Title</Lbl><Inp value={title} onChange={e=>setTitle(e.target.value)} placeholder="What's the news?" autoFocus/></div>
        <div>
          <Lbl>Message</Lbl>
          <RichTextInput value={body} onChange={setBody} placeholder={"Schrijf je bericht… Gebruik **bold**, *italic*, ~~doorhalen~~, `code`"}/>
        </div>
        {body&&(
          <div>
            <Lbl>Preview</Lbl>
            <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"12px 14px",fontSize:".88rem",color:"var(--cream)",lineHeight:1.65}} dangerouslySetInnerHTML={{__html:renderMd(body)}}/>
          </div>
        )}
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><Btn onClick={save} disabled={!title.trim()}>📢 Publiceren</Btn><Btn onClick={onClose} variant="ghost">{existing?"Discard changes":"Annuleren"}</Btn>{existing&&<span style={{color:"var(--muted)",fontSize:".7rem"}}>Clicking outside saves automatically</span>}</div>
      </div>
    </Modal>
  );
};

const AnnouncementBanner=({announcements,currentUser,onArchive,onHardDelete,onReactivate,onEdit,onNew})=>{
  const canAnnounce=can.announce(currentUser);
  const [dismissed,setDismissed]=useState(()=>{try{return JSON.parse(localStorage.getItem("ann-dismissed")||"[]");}catch{return[];}});
  const [showArchive,setShowArchive]=useState(false);
  const dismiss=id=>{const n=[...dismissed,id];setDismissed(n);localStorage.setItem("ann-dismissed",JSON.stringify(n));};
  const active=announcements.filter(a=>a.active!==false);
  const archived=announcements.filter(a=>a.active===false);
  const visible=active.filter(a=>!dismissed.includes(a.id));
  if(visible.length===0&&!canAnnounce)return null;
  return(
    <div style={{marginBottom:"1.4rem"}}>
      {canAnnounce&&<div style={{display:"flex",justifyContent:"flex-end",gap:6,marginBottom:visible.length>0?".6rem":"0"}}>
        {archived.length>0&&<Btn onClick={()=>setShowArchive(v=>!v)} variant="ghost" size="sm" style={{color:"var(--muted)",borderColor:"var(--border)",fontSize:".78rem"}}>📁 Archief ({archived.length})</Btn>}
        <Btn onClick={onNew} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"var(--border2)",fontSize:".78rem"}}>📢 Aankondiging</Btn>
      </div>}
      {visible.map(ann=>(
        <div key={ann.id} className="ann-banner" style={{
          position:"relative",overflow:"hidden",marginBottom:".75rem",
          background:"linear-gradient(135deg,#1c1100 0%,#2e1900 50%,#1c1100 100%)",
          border:"1px solid rgba(232,148,58,.45)",borderLeft:"4px solid var(--amber)",
          borderRadius:"var(--radius)",padding:"1.1rem 1.4rem",
        }}>
          <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 55% 90% at 5% 50%,rgba(232,148,58,.1),transparent 55%)",pointerEvents:"none"}}/>
          <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,var(--amber),var(--gold),var(--amber2),transparent 70%)",opacity:.65,pointerEvents:"none"}}/>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:".45rem",flexWrap:"wrap"}}>
                <span style={{fontSize:"1.05rem",filter:"drop-shadow(0 0 6px rgba(232,148,58,.6))"}}>📢</span>
                <span style={{fontFamily:"var(--font-h)",fontSize:"1.05rem",color:"var(--amber2)",fontWeight:700,lineHeight:1.2}}>{ann.title}</span>
              </div>
              {ann.body&&<div style={{fontSize:".88rem",color:"var(--cream)",lineHeight:1.68,opacity:.92}} dangerouslySetInnerHTML={{__html:renderMd(ann.body)}}/>}
              <div style={{fontSize:".68rem",color:"var(--muted)",marginTop:".55rem",letterSpacing:".04em"}}>
                {ann.createdBy} · {new Date(ann.createdAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}
              </div>
            </div>
            <div style={{display:"flex",gap:5,flexShrink:0}}>
              {canAnnounce&&<Btn onClick={()=>onEdit(ann)} variant="ghost" size="sm" style={{padding:"5px 9px",fontSize:".72rem"}}>✎</Btn>}
              {canAnnounce&&<Btn onClick={()=>onArchive(ann.id)} variant="danger" size="sm" style={{padding:"5px 9px",fontSize:".72rem"}}>↓</Btn>}
              {!canAnnounce&&<button onClick={()=>dismiss(ann.id)} onMouseEnter={e=>{e.currentTarget.style.color="var(--cream)";}} onMouseLeave={e=>{e.currentTarget.style.color="var(--muted)";}} style={{background:"transparent",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:"1rem",padding:"2px 6px",lineHeight:1,transition:"color .15s"}}>✕</button>}
            </div>
          </div>
        </div>
      ))}
      {canAnnounce&&showArchive&&archived.length>0&&(
        <div style={{border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",overflow:"hidden",marginTop:".4rem"}}>
          <div style={{padding:".6rem 1rem",background:"var(--bg2)",fontSize:".72rem",color:"var(--muted)",letterSpacing:".1em",textTransform:"uppercase"}}>Gearchiveerde aankondigingen</div>
          {archived.map(ann=>(
            <div key={ann.id} style={{display:"flex",alignItems:"center",gap:10,padding:".65rem 1rem",borderTop:"1px solid var(--border)",background:"var(--bg)"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:".84rem",color:"var(--cream)",opacity:.7,fontWeight:600}}>{ann.title}</div>
                <div style={{fontSize:".68rem",color:"var(--muted)",marginTop:2}}>{ann.createdBy} · {new Date(ann.createdAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short",year:"numeric"})}</div>
              </div>
              <Btn onClick={()=>onReactivate(ann.id)} variant="ghost" size="sm" style={{fontSize:".72rem",color:"var(--amber)",borderColor:"rgba(232,148,58,.3)"}}>↑ Activeren</Btn>
              <Btn onClick={()=>onHardDelete(ann.id)} variant="danger" size="sm" style={{fontSize:".72rem",padding:"4px 8px"}}>✕</Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PRESENTATION MODE
// ─────────────────────────────────────────────────────────────────────────────
// `isSolo` is a third, additive mode (not folded into `isPresenter`, to avoid
// touching the ~15 existing isPresenter checks below that presenter/viewer
// already depend on): a solo browser navigates freely like a presenter, but
// never creates/joins/broadcasts on the sched-<id> channel and never reveals
// secrets or writes to the event, like a viewer. Every render/behaviour
// branch below that needs to change for solo says so explicitly with
// `||isSolo`; anything unlisted (secret ??? treatment, no reveal button, no
// "X secret" counts, no LIVE badge wording) already falls out of isPresenter
// being false, same as it does for a real viewer.
const PresentationMode=({evt,onUpdate,isPresenter=true,onClose,currentLive=null,onPresenterLeft,onHide,isSolo=false})=>{
  // Every stop needs a stable identity that survives being REORDERED, not
  // just added or removed (see the docblock a few lines up + the QA repro
  // this whole pass exists to close): `order`/`realIdx` alone only key off
  // a stop's position in `evt.schedule`, which a retimed stop or the
  // schedule editor's own moveInDay control can silently change out from
  // under a live presentation with no navigation and no indicator. Stops
  // saved before this existed have no `id`; `withStopIds` gives every stop
  // one, preferring a real, persisted `id` when present and falling back to
  // a position-keyed one (`_localstop-N`) when not. The fallback is stable
  // within a render, and across an ordinary retime (a time/day edit never
  // touches physical array order), but NOT across moveInDay's own swap
  // (which moves the stop object bodily -- a *real* id travels with it, a
  // position-keyed fallback doesn't, since it's recomputed from array
  // position on every call). That gap is closed for good, not just
  // narrowed, by the presenter-only backfill-and-persist effect further
  // down, which writes real ids back onto `evt.schedule` the first time it
  // sees any stop missing one -- from then on every client (this one, and
  // every viewer via the existing `postgres_changes` subscription) works
  // off the same real ids instead of each separately inventing a fallback.
  const withStopIds=stops=>stops.map((s,i)=>s.id?s:{...s,id:`_localstop-${i}`});
  const allStops=withStopIds(evt.schedule||[]);
  const total=allStops.length+1;
  // Display order only, by (day,time) -- everything below that addresses a
  // stop by index (revealedSecrets, toggleReveal's mutation, the broadcast
  // payload) still uses its real index in `allStops`/evt.schedule via
  // `order[n]`, so sync/secret-reveal/keyboard/fullscreen behaviour is
  // unchanged; only which index is shown at slide position n+1 changes.
  const order=allStops.map((_,i)=>i).sort((a,b)=>scheduleDayTimeOrder(allStops[a],allStops[b]));
  // Converts a set of stop ids back into the legacy real-index shape (for
  // the wire, so a build that predates ids still understands
  // `revealedSecrets`) -- a stop whose id isn't found in `stops` (e.g. it
  // was removed) is simply dropped, same "diverged, drop it" tolerance the
  // rest of this component already applies elsewhere.
  const toLegacyRevealed=(stops,ids)=>ids.map(id=>stops.findIndex(s=>s.id===id)).filter(i=>i!==-1);
  // Resolves an incoming live payload (a presence track or a broadcast) to
  // a real schedule-array index (or `null` for the intro slide), against
  // whichever (stops, order) pair the caller passes in -- `resolveLiveIdx`
  // below uses this render's own `allStops`/`order`; `applySlide` inside
  // the channel effect further down recomputes its own fresh pair from
  // `evtRef.current` each time it runs (see that effect for why) and passes
  // those instead. Preference order, each falling through to the next only
  // when it can't resolve: `stopId` (this stop's own stable identity --
  // survives a reorder, not just an add/remove) -> legacy `realIdx` (a real
  // array index -- survives add/remove but not a reorder) -> legacy `idx`
  // (a raw display position, the original pre-`realIdx` behaviour). A build
  // that predates this fix never sends `stopId`, so this degrades exactly
  // to its historical realIdx/idx behaviour for that sender.
  const resolvePayloadRealIdx=(payload,stops,ord)=>{
    if(!payload)return{found:false};
    if(payload.stopId!==undefined&&payload.stopId!==null){
      const ri=stops.findIndex(s=>s.id===payload.stopId);
      if(ri!==-1)return{found:true,realIdx:ri};
    }
    if(payload.stopId===null)return{found:true,realIdx:null};
    if(payload.realIdx!==undefined){
      if(payload.realIdx===null)return{found:true,realIdx:null};
      if(ord.includes(payload.realIdx))return{found:true,realIdx:payload.realIdx};
    }
    return{found:false};
  };
  // A presence/broadcast snapshot (`currentLive`, and the live payloads
  // handled inside the channel effect below) can be stale or describe a
  // schedule this client's own `evt.schedule` doesn't match yet -- a late
  // joiner's own event data resolving after presence, a stop added/removed
  // elsewhere before this client re-synced, flaky venue wifi, etc. Resolve
  // any incoming slide reference through THIS client's own `order`, and
  // always clamp into THIS client's own valid range, so a divergent or
  // out-of-range snapshot can never seed (or later set) an out-of-bounds
  // slide index -- a viewer that's briefly behind lands on the nearest
  // valid slide instead of a dead screen.
  const resolveLiveIdx=live=>{
    if(!live)return 0;
    const r=resolvePayloadRealIdx(live,allStops,order);
    let ni;
    if(r.found)ni=r.realIdx===null?0:order.indexOf(r.realIdx)+1;
    else ni=live.idx??0;
    return Math.max(0,Math.min(total-1,ni));
  };
  const isMultiDay=eventDayCount(evt.date,evt.end_date)>1;
  const isMobile=useIsMobile();
  const initialIdx=isPresenter?0:resolveLiveIdx(currentLive);
  // Translates whatever shape an initial presence snapshot's revealed set
  // arrives in (an older build's real-index numbers, or this build's own
  // stop ids) into stop ids -- this render's own `allStops` is the frame of
  // reference, same preference (ids, then legacy indices) `applySlide`
  // inside the channel effect below uses for every later update, so a late
  // joiner's very first paint already agrees with everything after it.
  const initialRevealed=(()=>{
    if(!currentLive)return[];
    if(Array.isArray(currentLive.revealedStopIds))return currentLive.revealedStopIds;
    return(currentLive.revealedSecrets??[]).map(n=>allStops[n]?.id).filter(Boolean);
  })();
  const [idx,setIdx]=useState(initialIdx);
  const [revealedSecrets,setRevealedSecrets]=useState(initialRevealed);
  const [fading,setFading]=useState(false);
  const [locallyDismissed,setLocallyDismissed]=useState(false);
  const idxRef=useRef(initialIdx);
  const revealedRef=useRef(initialRevealed);
  const evtRef=useRef(evt);
  const chRef=useRef(null);
  const onPresenterLeftRef=useRef(onPresenterLeft);
  // The id of the stop `idx` currently points at (`null` on the intro) --
  // the anchor the self-heal effect below re-derives `idx` from whenever
  // the running order reshuffles under it (a retimed stop, or moveInDay,
  // saved live) so this client's own `idx` stays pointed at the SAME stop
  // instead of silently drifting to whatever now sorts into that numeric
  // slide position. Set at every intentional navigation (`goTo`) and every
  // resolved incoming slide (`applySlide`) below, always in lockstep with
  // `idx` itself (same fade-timing) so it's never briefly out of sync with
  // what's actually on screen.
  const pinnedStopIdRef=useRef(initialIdx===0?null:(allStops[order[initialIdx-1]]?.id??null));
  useEffect(()=>{onPresenterLeftRef.current=onPresenterLeft;},[onPresenterLeft]);
  useEffect(()=>{evtRef.current=evt;},[evt]);
  useEffect(()=>{idxRef.current=idx;},[idx]);
  useEffect(()=>{revealedRef.current=revealedSecrets;},[revealedSecrets]);
  // Belt-and-suspenders, independent of anything arriving over the channel:
  // if THIS client's own schedule shrinks (a stop removed, a stale prop
  // still mid-sync, etc.) such that `idx` now points past this client's own
  // valid range, pull it back in range rather than letting the stop
  // dereference below run on a since-removed index.
  useEffect(()=>{
    if(idx>total-1)setIdx(total-1);
  },[idx,total]);
  // The actual fix for the reorder desync: re-derive `idx` from the pinned
  // stop's own identity against THIS render's `order` every time either
  // changes. A stop's real (day,time)-sorted position can change with no
  // navigation at all -- a retimed stop, or moveInDay, landing purely via a
  // fresh `evt` prop, same as any other live schedule edit. When the pinned
  // stop is still present this either finds it already at `idx` (no-op) or
  // moves `idx` to wherever it sorts now -- content stays pinned to the
  // SAME stop either way; only its slide *number* (and which dot is lit)
  // can change. `idx` changing here also re-fires the presenter's own
  // outgoing-broadcast effect below (it depends on `idx`), so a correction
  // reaches the room with no click needed. When the pinned stop is no
  // longer present at all (actually removed), this intentionally does
  // nothing and leaves the shrink-clamp effect above to pull `idx` back
  // into range. Deps are `order`/`allStops`/`idx` -- `order`/`allStops` are
  // freshly recomputed every render (new array references each time), so
  // in practice this still re-checks every render, same cost as a
  // low-render-frequency, full-screen presentation UI can easily absorb;
  // the body only ever calls `setIdx` when the resolved position actually
  // differs from the current one, so it can't loop.
  useEffect(()=>{
    if(pinnedStopIdRef.current==null)return;
    const pos=order.findIndex(ri=>allStops[ri]?.id===pinnedStopIdRef.current);
    if(pos!==-1&&pos+1!==idx)setIdx(pos+1);
  },[order,allStops,idx]);
  // Presenter-only: the first time this presenter's own schedule has ANY
  // stop missing a real `id`, write real ids back onto `evt.schedule` (see
  // `withStopIds` above for the full rationale). Solo/viewer never write to
  // the event (see this component's own docblock), so this is gated on
  // `isPresenter` the same way `toggleReveal`'s write already is.
  // Naturally idempotent, no ref flag needed: `onUpdate` (see
  // App/EventPage's `updateEvent`) applies its update to local state
  // optimistically, so the very next render's `evt.schedule` already has
  // ids and this effect's own `hasMissingIds` check goes false.
  useEffect(()=>{
    if(!isPresenter)return;
    const raw=evt.schedule||[];
    if(raw.length===0||!raw.some(s=>!s.id))return;
    const withIds=raw.map((s,i)=>s.id?s:{...s,id:`sid-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2,8)}`});
    onUpdate({...evt,schedule:withIds});
  },[isPresenter,evt,onUpdate]);

  // Channel setup: Presence for detection/initial-state, Broadcast for real-time slide sync.
  // Solo never runs any of this -- no channel is created at all (not
  // created-and-unused: the `supabase.channel(...)` call itself is skipped),
  // so a solo browser can never join, subscribe to, or broadcast on the live
  // presentation channel.
  useEffect(()=>{
    if(isSolo)return;
    const ch=supabase.channel(`sched-${evtRef.current.id}`);
    chRef.current=ch;
    if(isPresenter){
      // Presence lets late-joining viewers get the current slide on
      // subscribe. `realIdx:null`/`stopId:null` because a presenter always
      // starts at `idx===0` (the intro) on mount -- see the idx-driven
      // broadcast effect below for how they're computed once the presenter
      // navigates.
      ch.subscribe(async status=>{
        if(status==='SUBSCRIBED'){
          const legacyRevealed=toLegacyRevealed(withStopIds(evtRef.current.schedule||[]),revealedRef.current);
          ch.track({presenting:true,idx:idxRef.current,realIdx:null,stopId:null,revealedSecrets:legacyRevealed,revealedStopIds:revealedRef.current});
        }
      });
    } else {
      let seenPresenter=false;
      // Resolves a presence/broadcast payload against THIS client's own,
      // current `evt.schedule` (via `evtRef`, not a possibly-stale `order`
      // closed over whenever this effect itself last ran -- deps are
      // `[isPresenter,isSolo]`, not `evt`, on purpose, so this effect
      // doesn't tear down and recreate the channel on every schedule edit)
      // -- see the `resolveLiveIdx`/`resolvePayloadRealIdx` comments above
      // for the full rationale, and for the `stopId`-preferred /
      // `realIdx`-then-`idx`-fallback shape. Never trusts the raw incoming
      // number: always clamps into THIS client's own valid range.
      const applySlide=payload=>{
        seenPresenter=true;
        const mySchedule=withStopIds(evtRef.current.schedule||[]);
        const myTotal=mySchedule.length+1;
        const myOrder=mySchedule.map((_,i)=>i).sort((a,b)=>scheduleDayTimeOrder(mySchedule[a],mySchedule[b]));
        const r=resolvePayloadRealIdx(payload,mySchedule,myOrder);
        let ni;
        if(r.found)ni=r.realIdx===null?0:myOrder.indexOf(r.realIdx)+1;
        else ni=payload.idx??0;
        ni=Math.max(0,Math.min(myTotal-1,ni));
        const resolvedId=ni===0?null:(mySchedule[myOrder[ni-1]]?.id??null);
        if(ni!==idxRef.current){
          setFading(true);
          setTimeout(()=>{pinnedStopIdRef.current=resolvedId;setIdx(ni);setFading(false);},230);
        } else {
          pinnedStopIdRef.current=resolvedId;
        }
        // Prefers the new, id-based reveal set when the sender has it;
        // otherwise translates the legacy real-index-shaped set into THIS
        // client's own stop ids so `isRevealed`/dot colours (both id-keyed
        // now, see render below) still resolve correctly against an
        // older-build presenter's payload.
        const revealedIds=Array.isArray(payload.revealedStopIds)
          ?payload.revealedStopIds
          :(payload.revealedSecrets??[]).map(n=>mySchedule[n]?.id).filter(Boolean);
        setRevealedSecrets(revealedIds);
      };
      ch
        // Presence: initial state for late joiners + detect presenter left
        .on('presence',{event:'sync'},()=>{
          const st=ch.presenceState();
          const p=Object.values(st).flat().find(x=>x.presenting);
          if(!p){
            if(seenPresenter){onPresenterLeftRef.current?.();setLocallyDismissed(true);}
            return;
          }
          if(!seenPresenter) applySlide(p);
        })
        // Broadcast: real-time slide changes (fires reliably for every track update)
        .on('broadcast',{event:'slide'},({payload})=>{
          applySlide(payload);
        })
        .subscribe();
    }
    return()=>{if(chRef.current){supabase.removeChannel(chRef.current);chRef.current=null;}};
  },[isPresenter,isSolo]);

  // Presenter: broadcast slide change + update presence for late joiners.
  // `realIdx` (the actual schedule-array index the slide at `idx` displays,
  // or null for the intro) identifies the stop itself, rather than its
  // display position, so a viewer whose own schedule differs at all no
  // longer resolves the same broadcast number to a different stop --
  // computed fresh from `evtRef.current` (not the render-scope
  // `order`/`allStops`) so it stays correct even though this effect's own
  // deps include `evt` (see below), not just `[idx,isPresenter]`. `stopId`
  // rides alongside it, one layer more robust (survives a reorder too, not
  // just an add/remove) -- both sent next to the legacy `idx` display
  // position so a viewer on a build that predates either still works
  // unchanged (falls back to them inside `applySlide` above /
  // `resolveLiveIdx` above that). `evt` is in the dep list on top of
  // `idx`/`isPresenter` -- not just so a reorder that happens to leave the
  // pinned stop's slide *number* unchanged still reaches the room (the
  // self-heal effect above already re-fires this whenever `idx` itself
  // moves), but as the explicit belt-and-suspenders the schedule-desync
  // audit asked for: any live schedule edit while presenting re-confirms
  // to the room what's actually on screen, not just navigation.
  useEffect(()=>{
    if(!isPresenter||!chRef.current)return;
    const mySchedule=withStopIds(evtRef.current.schedule||[]);
    const myOrder=mySchedule.map((_,i)=>i).sort((a,b)=>scheduleDayTimeOrder(mySchedule[a],mySchedule[b]));
    const realIdx=idx===0?null:myOrder[idx-1];
    const stopId=idx===0?null:(mySchedule[myOrder[idx-1]]?.id??null);
    const revealedStopIds=revealedRef.current;
    const revealedSecrets=toLegacyRevealed(mySchedule,revealedStopIds);
    chRef.current.track({presenting:true,idx,realIdx,stopId,revealedSecrets,revealedStopIds});
    chRef.current.send({type:'broadcast',event:'slide',payload:{idx,realIdx,stopId,revealedSecrets,revealedStopIds}});
  },[idx,isPresenter,evt]);

  const toggleReveal=useCallback((stopIdx,stopId)=>{
    const cur=revealedRef.current; // stop ids
    const revealing=!cur.includes(stopId);
    const next=revealing?[...cur,stopId]:cur.filter(id=>id!==stopId);
    setRevealedSecrets(next);
    if(chRef.current){
      // `stopIdx` here IS the real schedule index already (the caller
      // passes `order[idx-1]`, not the display position) -- reuse it
      // directly as `realIdx` rather than recomputing it. `stopId` is the
      // same stop's own stable id, passed by the caller alongside it.
      const mySchedule=withStopIds(evtRef.current.schedule||[]);
      const revealedSecrets=toLegacyRevealed(mySchedule,next);
      chRef.current.track({presenting:true,idx:idxRef.current,realIdx:stopIdx,stopId,revealedSecrets,revealedStopIds:next});
      chRef.current.send({type:'broadcast',event:'slide',payload:{idx:idxRef.current,realIdx:stopIdx,stopId,revealedSecrets,revealedStopIds:next}});
    }
    const e=evtRef.current;
    const updatedSchedule=(e.schedule||[]).map((s,i)=>(s.id?s.id===stopId:i===stopIdx)?{...s,secret:!revealing}:s);
    onUpdate({...e,schedule:updatedSchedule});
  },[onUpdate]);

  const handleClose=useCallback(()=>{
    if(isPresenter||isSolo){
      if(chRef.current)chRef.current.untrack();
      onClose();
    } else {
      onHide?.(); // tell EventPage to set viewerDismissed — it unmounts us and shows the banner
    }
  },[isPresenter,isSolo,onClose,onHide]);

  const goTo=useCallback(n=>{
    if(!isPresenter&&!isSolo)return;
    if(n<0||n>=total)return;
    setFading(true);
    setTimeout(()=>{
      // Resolved against THIS moment's own schedule (via `evtRef`, not a
      // value the `[total,isPresenter,isSolo]`-memoized callback closed
      // over back when it was created) -- same reasoning as everywhere
      // else in this component that reads `evtRef.current` fresh rather
      // than trusting a stale closure.
      const freshStops=withStopIds(evtRef.current.schedule||[]);
      const freshOrder=freshStops.map((_,i)=>i).sort((a,b)=>scheduleDayTimeOrder(freshStops[a],freshStops[b]));
      pinnedStopIdRef.current=n===0?null:(freshStops[freshOrder[n-1]]?.id??null);
      setIdx(n);
      setFading(false);
    },230);
  },[total,isPresenter,isSolo]);

  useEffect(()=>{
    if(!isPresenter&&!isSolo)return;
    const h=e=>{
      if(e.key==="ArrowRight"||e.key==="ArrowDown")goTo(idxRef.current+1);
      else if(e.key==="ArrowLeft"||e.key==="ArrowUp")goTo(idxRef.current-1);
      else if(e.key==="Escape")handleClose();
    };
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[goTo,handleClose,isPresenter,isSolo]);

  useEffect(()=>{
    if(!isPresenter&&!isSolo)return; // viewers don't need fullscreen API — position:fixed already covers screen
    const el=document.documentElement;
    if(el.requestFullscreen)el.requestFullscreen().catch(()=>{});
    return()=>{if(document.exitFullscreen&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});};
  },[isPresenter,isSolo]);

  if(locallyDismissed)return null;

  const isIntro=idx===0;
  const stopIdx=isIntro?-1:order[idx-1];
  const stop=isIntro?null:allStops[stopIdx];
  const isSecret=!!stop?.secret;
  const isRevealed=!!stop&&revealedSecrets.includes(stop.id);
  const isHidden=isSecret&&!isRevealed; // secret and not yet revealed
  // Only show background media when stop is visible (not hidden to viewers)
  const media=stop&&(!isHidden||isPresenter)?(stop.image||""):"";
  const isVideo=media&&/\.(mp4|webm|mov|ogg)(\?|$)/i.test(media);
  const publicCount=allStops.filter(s=>!s.secret).length;

  return(
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"#1a1408",overflow:"hidden",fontFamily:"var(--font-b)"}}>
      {/* Gold shimmer top bar */}
      <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,var(--orange),var(--amber),var(--gold),var(--amber),var(--orange))",backgroundSize:"300% 100%",animation:"goldShimmer 3s linear infinite",zIndex:20}}/>
      {/* Background media */}
      {media&&(
        <div style={{position:"absolute",inset:0}}>
          {isVideo
            ?<video src={media} autoPlay muted loop playsInline style={{width:"100%",height:"100%",objectFit:"cover",opacity:.75}}/>
            :<img src={media} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:.78}}/>
          }
          <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(6,4,0,.82) 0%,rgba(6,4,0,.42) 45%,rgba(6,4,0,.22) 100%)"}}/>
        </div>
      )}
      {!media&&!isIntro&&<div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 70% 60% at 25% 60%,rgba(201,146,42,.18),transparent 65%)"}}/>}
      {isIntro&&<div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 80% 70% at 50% 45%,rgba(232,148,58,.22),transparent 65%)"}}/>}

      {/* Top bar */}
      <div style={{position:"absolute",top:0,left:0,right:0,padding:"1.4rem 2rem",display:"flex",alignItems:"center",justifyContent:"space-between",zIndex:15}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.75)",letterSpacing:".14em",textTransform:"uppercase",fontWeight:600}}>{evt.name}</div>
          {!isPresenter&&!isSolo&&<div style={{background:"rgba(232,148,58,.18)",border:"1px solid rgba(232,148,58,.45)",borderRadius:20,padding:"3px 10px",fontSize:".65rem",color:"var(--amber)",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",display:"flex",alignItems:"center",gap:5}}><span style={{width:6,height:6,borderRadius:"50%",background:"var(--amber)",display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>LIVE</div>}
          {isPresenter&&isSecret&&!isIntro&&<div style={{background:isRevealed?"rgba(76,175,125,.18)":"rgba(224,85,85,.18)",border:`1px solid ${isRevealed?"rgba(76,175,125,.4)":"rgba(224,85,85,.4)"}`,borderRadius:20,padding:"3px 10px",fontSize:".65rem",color:isRevealed?"var(--green)":"var(--red)",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase"}}>{isRevealed?"✓ Revealed":"🔒 Secret"}</div>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:".72rem",color:"rgba(255,255,255,.75)",padding:"4px 11px",border:"1px solid rgba(255,255,255,.25)",borderRadius:20,backdropFilter:"blur(6px)"}}>{idx+1} / {total}</div>
          <button onClick={handleClose} onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.18)";}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.09)";}} style={{background:"rgba(255,255,255,.09)",border:"1px solid rgba(255,255,255,.18)",borderRadius:8,color:"rgba(255,255,255,.8)",padding:"7px 15px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:600,backdropFilter:"blur(8px)",transition:"background .15s"}}>{(isPresenter||isSolo)?"✕ Exit":"✕ Hide"}</button>
        </div>
      </div>

      {/* Main content */}
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:isIntro?"center":"flex-end",justifyContent:"center",padding:isIntro?"2rem":isMobile?"3rem 1.2rem 5.5rem":"3rem 5rem 5.5rem",opacity:fading?0:1,transition:"opacity .2s ease",zIndex:10}}>
        {isIntro?(
          <div style={{textAlign:"center",maxWidth:780}}>
            {(evt.type||evt.theme)&&<div style={{fontSize:".82rem",color:"var(--amber)",letterSpacing:".22em",textTransform:"uppercase",fontWeight:700,marginBottom:"1.4rem",opacity:.9}}>
              {evt.type==="weekend"?"🏕️ Weekend":"📅 Mensday"}{evt.theme&&` · ${evt.theme}`}
            </div>}
            <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(2.8rem,8vw,6rem)",color:"#fff",lineHeight:1.05,marginBottom:"1.4rem",textShadow:"0 0 60px rgba(232,148,58,.22)"}}>{evt.name}</div>
            {evt.date&&<div style={{fontSize:"1.05rem",color:"rgba(255,255,255,.8)",marginBottom:"1.1rem",letterSpacing:".02em"}}>{formatEventDateRange(evt.date,evt.end_date)}</div>}
            {evt.location&&<div style={{fontSize:"1rem",color:"var(--amber2)",opacity:.8,marginBottom:"2.8rem"}}>📍 {evt.location}</div>}
            {allStops.length>0&&<div style={{display:"flex",alignItems:"center",gap:"1rem",justifyContent:"center",color:"rgba(255,255,255,.26)",fontSize:".78rem",letterSpacing:".09em"}}>
              <div style={{height:1,width:36,background:"rgba(255,255,255,.14)"}}/>
              {publicCount} stop{publicCount!==1?"s":""} on the menu{allStops.length>publicCount&&isPresenter?` · ${allStops.length-publicCount} secret`:""}
              <div style={{height:1,width:36,background:"rgba(255,255,255,.14)"}}/>
            </div>}
          </div>
        ):(
          /* ── Viewer sees a mystery slide for unrevealed secret stops ── */
          (isHidden&&!isPresenter)?(
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:"clamp(3rem,8vw,6rem)",marginBottom:"1.2rem",filter:"blur(2px)"}}>🔒</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.6rem,5vw,3rem)",color:"rgba(255,255,255,.25)",lineHeight:1.1}}>???</div>
              <div style={{color:"rgba(255,255,255,.2)",fontSize:".88rem",marginTop:".8rem"}}>The organisation is keeping this one a surprise…</div>
            </div>
          ):!stop?(
            /* ── Defensive holding state: `idx`/`stopIdx` resolved to a slot
               this client has no actual stop for (should be unreachable now
               that idx is clamped everywhere above, but never dereference an
               undefined `stop` regardless -- a viewer who's briefly behind
               sees this, never a dead screen). ── */
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:"clamp(3rem,8vw,6rem)",marginBottom:"1.2rem",filter:"blur(2px)"}}>⏳</div>
              <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.6rem,5vw,3rem)",color:"rgba(255,255,255,.25)",lineHeight:1.1}}>Catching up…</div>
              <div style={{color:"rgba(255,255,255,.2)",fontSize:".88rem",marginTop:".8rem"}}>Syncing with the presenter…</div>
            </div>
          ):(
            /* ── Normal stop content (visible or presenter-only view of secret) ── */
            <div style={{width:"100%",maxWidth:900}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.1rem",flexWrap:"wrap"}}>
                <span style={{background:"rgba(232,148,58,.2)",border:"1px solid rgba(232,148,58,.4)",borderRadius:20,padding:"4px 14px",fontSize:".7rem",color:"var(--amber)",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase"}}>Stop {idx} / {allStops.length}</span>
                {isMultiDay&&<span style={{background:"rgba(255,255,255,.1)",border:"1px solid rgba(255,255,255,.22)",borderRadius:20,padding:"4px 14px",fontSize:".7rem",color:"rgba(255,255,255,.85)",fontWeight:700,letterSpacing:".08em",textTransform:"uppercase"}}>{dayHeadingLabel(evt.date,stop?.day??0)}</span>}
                {stop?.time&&<span style={{fontSize:".95rem",color:"rgba(255,255,255,.8)",fontWeight:600,letterSpacing:".04em"}}>{stop.time}</span>}
                {/* Reveal/hide toggle — presenter only, for secret stops */}
                {isPresenter&&isSecret&&(
                  <button onClick={()=>toggleReveal(stopIdx,stop.id)}
                    style={{marginLeft:"auto",background:isRevealed?"rgba(224,85,85,.18)":"rgba(76,175,125,.18)",border:`1px solid ${isRevealed?"rgba(224,85,85,.45)":"rgba(76,175,125,.45)"}`,borderRadius:10,color:isRevealed?"var(--red)":"var(--green)",padding:"7px 18px",cursor:"pointer",fontSize:".78rem",fontFamily:"var(--font-b)",fontWeight:700,backdropFilter:"blur(8px)",display:"flex",alignItems:"center",gap:6,transition:"all .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.opacity=".8"}
                    onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                    {isRevealed?"🔒 Hide from viewers":"👁 Reveal to viewers"}
                  </button>
                )}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"1.3rem",marginBottom:"1rem",flexWrap:"wrap"}}>
                {stop?.icon&&<span style={{fontSize:"clamp(2rem,5vw,3.5rem)",lineHeight:1,filter:"drop-shadow(0 4px 24px rgba(232,148,58,.35))"}}>{stop.icon}</span>}
                <div style={{fontFamily:"var(--font-h)",fontSize:"clamp(1.9rem,5.5vw,4rem)",color:"#fff",lineHeight:1.08,textShadow:"0 2px 30px rgba(0,0,0,.55)"}}>{stop?.activity}</div>
              </div>
              {stop?.location&&<div style={{fontSize:"1rem",color:"rgba(255,255,255,.82)",marginBottom:".5rem",display:"flex",alignItems:"center",gap:7}}>
                <span>📍</span>
                {isSafeImageUrl(stop.locationUrl)?<a href={stop.locationUrl} target="_blank" rel="noreferrer" style={{color:"var(--amber2)",textDecoration:"none"}}>{stop.location}</a>:<span>{stop.location}</span>}
              </div>}
              {stop?.note&&<div style={{fontSize:".95rem",color:"rgba(255,255,255,.72)",fontStyle:"italic",lineHeight:1.6,maxWidth:640,marginTop:4}}>{stop.note}</div>}
            </div>
          )
        )}
      </div>

      {/* Prev button — presenter and solo (free navigation) */}
      {(isPresenter||isSolo)&&idx>0&&<button onClick={()=>goTo(idx-1)}
        onMouseEnter={e=>{e.currentTarget.style.background=isMobile?"rgba(255,255,255,.1)":"rgba(255,255,255,.15)";}}
        onMouseLeave={e=>{e.currentTarget.style.background=isMobile?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)";}}
        style={{position:"absolute",left:0,top:"50%",transform:"translateY(-50%)",background:isMobile?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)",border:isMobile?"none":"1px solid rgba(255,255,255,.14)",borderRadius:isMobile?"0 10px 10px 0":12,color:isMobile?"rgba(255,255,255,.5)":"#fff",width:isMobile?36:52,height:isMobile?72:52,cursor:"pointer",fontSize:isMobile?"1rem":"1.3rem",display:"flex",alignItems:"center",justifyContent:"center",zIndex:15,transition:"background .15s",backdropFilter:"blur(8px)"}}>←</button>}
      {/* Next button — presenter and solo (free navigation) */}
      {(isPresenter||isSolo)&&idx<total-1&&<button onClick={()=>goTo(idx+1)}
        onMouseEnter={e=>{e.currentTarget.style.background=isMobile?"rgba(255,255,255,.1)":"rgba(255,255,255,.15)";}}
        onMouseLeave={e=>{e.currentTarget.style.background=isMobile?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)";}}
        style={{position:"absolute",right:0,top:"50%",transform:"translateY(-50%)",background:isMobile?"rgba(255,255,255,.03)":"rgba(255,255,255,.07)",border:isMobile?"none":"1px solid rgba(255,255,255,.14)",borderRadius:isMobile?"10px 0 0 10px":12,color:isMobile?"rgba(255,255,255,.5)":"#fff",width:isMobile?36:52,height:isMobile?72:52,cursor:"pointer",fontSize:isMobile?"1rem":"1.3rem",display:"flex",alignItems:"center",justifyContent:"center",zIndex:15,transition:"background .15s",backdropFilter:"blur(8px)"}}>→</button>}

      {/* Dot navigation — clickable for presenter/solo; secret=red dot, revealed=green dot (presenter only, see below) */}
      <div style={{position:"absolute",bottom:"1.2rem",left:0,right:0,display:"flex",justifyContent:"center",gap:7,zIndex:15}}>
        {Array.from({length:total}).map((_,i)=>{
          const si=i>0?order[i-1]:null;
          const dotStop=i>0?allStops[si]:null;
          // Secret/revealed colouring is presenter-only intel -- a viewer
          // or solo browser must not be able to tell which running-order
          // positions hold a surprise (with neighbouring stop times visible
          // in the schedule, that's enough to guess roughly when, defeating
          // the whole point of a secret stop) just by glancing at the dot
          // strip. Matches the intro slide's own withholding of the secret
          // *count* from non-presenters a few hundred lines up.
          const dotSecret=isPresenter&&dotStop?.secret;
          const dotRevealed=dotSecret&&revealedSecrets.includes(dotStop?.id);
          const dotColor=i===idx?"var(--amber)":dotSecret?(dotRevealed?"rgba(76,175,125,.6)":"rgba(224,85,85,.5)"):"rgba(255,255,255,.2)";
          return(
            <button key={i} onClick={()=>(isPresenter||isSolo)&&goTo(i)}
              style={{width:i===idx?22:7,height:7,borderRadius:4,background:dotColor,border:"none",cursor:(isPresenter||isSolo)?"pointer":"default",padding:0,transition:"all .25s cubic-bezier(.4,0,.2,1)"}}/>
          );
        })}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EDIT MODALS
// ─────────────────────────────────────────────────────────────────────────────
const blankStop={time:"",activity:"",location:"",locationUrl:"",icon:"📍",note:"",image:"",secret:false,day:0};
// A stable id per new stop (PresentationMode keys slide identity off this
// now, not array position -- see its own docblock) -- generated fresh at
// each call site below rather than baked into `blankStop` itself, since
// `blankStop` is spread into more than one new stop per session and a
// static id on the shared template would make every new stop share it.
const makeStopId=()=>`sid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const EditScheduleModal=({evt,onSave,onClose})=>{
  const [sched,setSched]=useState(evt.schedule.map(s=>({...blankStop,...s})));
  const [iconPicker,setIconPicker]=useState(null);
  const upd=(i,f,v)=>setSched(s=>s.map((r,j)=>j===i?{...r,[f]:v}:r));
  const stopDay=s=>s.day??0;
  const dayCount=Math.max(1,eventDayCount(evt.date,evt.end_date));
  const inRange=d=>d>=0&&d<dayCount;
  // Move a stop up/down *within its own day group* -- find its same-day
  // neighbour in `sched` (stops from other days may be interleaved in the
  // flat array) and swap with that, rather than with the flat neighbour.
  const moveInDay=(i,d)=>{
    const day=stopDay(sched[i]);
    const groupIdxs=sched.reduce((acc,r,j)=>{if(stopDay(r)===day)acc.push(j);return acc;},[]);
    const pos=groupIdxs.indexOf(i);
    const j=groupIdxs[pos+d];
    if(j===undefined)return;
    setSched(s=>{const next=[...s];[next[i],next[j]]=[next[j],next[i]];return next;});
  };
  const addStopOnDay=day=>setSched(s=>[...s,{...blankStop,id:makeStopId(),day}]);
  // Group stops by day for headings; anything outside the event's current
  // [0,dayCount) range (e.g. the event's date range shrank after stops were
  // scheduled further out) is surfaced in its own group instead of being
  // silently dropped -- see `overflowIdxs` below.
  const groups=Array.from({length:dayCount},(_,day)=>({day,idxs:sched.reduce((acc,r,j)=>{if(stopDay(r)===day)acc.push(j);return acc;},[])}));
  const overflowIdxs=sched.reduce((acc,r,j)=>{if(!inRange(stopDay(r)))acc.push(j);return acc;},[]);
  const isMultiDay=dayCount>1;
  const showDayPicker=isMultiDay||overflowIdxs.length>0;
  const renderStop=i=>{
    const s=sched[i];
    const group=inRange(stopDay(s))?groups[stopDay(s)].idxs:overflowIdxs;
    const pos=group.indexOf(i);
    return(
    <div key={i} style={{background:"var(--bg3)",borderRadius:"var(--radius-sm)",padding:"1rem",border:`1px solid ${s.secret?"rgba(224,85,85,.35)":"var(--border)"}`,position:"relative",overflow:"hidden"}}>
      {s.secret&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,var(--red),rgba(224,85,85,.4))"}}/>}
      <div style={{display:"flex",gap:7,marginBottom:".7rem",alignItems:"center"}}>
        <div style={{position:"relative"}}><button onClick={()=>setIconPicker(iconPicker===i?null:i)} style={{width:38,height:38,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:"17px"}}>{s.icon||"📍"}</button>{iconPicker===i&&<div style={{position:"absolute",top:42,left:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:8,display:"flex",flexWrap:"wrap",gap:4,width:214,zIndex:10}}>{ICONS.map(ic=><button key={ic} onClick={()=>{upd(i,"icon",ic);setIconPicker(null)}} style={{background:s.icon===ic?"rgba(232,148,58,.2)":"transparent",border:"none",borderRadius:6,cursor:"pointer",fontSize:"17px",width:30,height:30}}>{ic}</button>)}</div>}</div>
        <Inp value={s.time} onChange={e=>upd(i,"time",e.target.value)} placeholder="12:00" style={{width:70,flexShrink:0}}/>
        <Inp value={s.activity} onChange={e=>upd(i,"activity",e.target.value)} placeholder="Activity"/>
        <div style={{display:"flex",gap:4,flexShrink:0}}>
          <button onClick={()=>upd(i,"secret",!s.secret)} title={s.secret?"Secret — klik om te openbaren":"Publiek — klik om te verbergen"} style={{width:32,height:32,background:s.secret?"rgba(224,85,85,.12)":"rgba(76,175,125,.1)",border:`1px solid ${s.secret?"rgba(224,85,85,.4)":"rgba(76,175,125,.3)"}`,borderRadius:7,cursor:"pointer",fontSize:"15px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s"}}>{s.secret?"🔒":"👁"}</button>
          <Btn onClick={()=>moveInDay(i,-1)} variant="ghost" size="sm" disabled={pos===0} style={{padding:"6px 9px"}}>↑</Btn>
          <Btn onClick={()=>moveInDay(i,1)} variant="ghost" size="sm" disabled={pos===group.length-1} style={{padding:"6px 9px"}}>↓</Btn>
          <Btn onClick={()=>setSched(s=>s.filter((_,j)=>j!==i))} variant="danger" size="sm" style={{padding:"6px 9px"}}>✕</Btn>
        </div>
      </div>
      {s.secret&&<div style={{fontSize:".72rem",color:"var(--red)",marginBottom:".6rem",display:"flex",alignItems:"center",gap:5,opacity:.85}}><span>🔒</span>Geheim — verborgen voor gewone leden</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}><div><Lbl>Location</Lbl><Inp value={s.location} onChange={e=>upd(i,"location",e.target.value)} placeholder="Café de Kroeg"/></div><div><Lbl>Maps URL</Lbl><Inp value={s.locationUrl} onChange={e=>upd(i,"locationUrl",e.target.value)} placeholder="https://maps.google.com/…"/></div></div>
      <Lbl>Note</Lbl><Inp value={s.note} onChange={e=>upd(i,"note",e.target.value)} placeholder="e.g. reservation under Joris"/>
      <div style={{marginTop:7}}><Lbl>Slide Image / Video URL</Lbl><Inp value={s.image||""} onChange={e=>upd(i,"image",e.target.value)} placeholder="https://… (background in presentation mode)"/></div>
      {showDayPicker&&<div style={{marginTop:7}}><Lbl>Dag</Lbl><select value={stopDay(s)} onChange={e=>upd(i,"day",Number(e.target.value))} style={{width:"100%",background:"var(--bg2)",color:"var(--cream)",border:"1px solid var(--border)",borderRadius:7,padding:"7px 9px",fontSize:".8rem",cursor:"pointer",fontFamily:"var(--font-b)"}}>
        {groups.map(g=><option key={g.day} value={g.day}>{dayHeadingLabel(evt.date,g.day)}</option>)}
        {!inRange(stopDay(s))&&<option value={stopDay(s)}>Dag {stopDay(s)+1} (buiten bereik)</option>}
      </select></div>}
    </div>
    );
  };
  return(<Modal onClose={onClose} onBackdropClose={()=>onSave(sched)} maxWidth={640}><H>Edit Schedule</H><div style={{display:"grid",gap:".9rem"}}>
    {!isMultiDay&&overflowIdxs.length===0
      ? <>{sched.map((s,i)=>renderStop(i))}<Btn onClick={()=>setSched(s=>[...s,{...blankStop,id:makeStopId()}])} variant="subtle" size="sm">+ Add Stop</Btn></>
      : <>
        {groups.map(g=>(
          <div key={g.day} style={{display:"grid",gap:".9rem",paddingBottom:6,borderBottom:"1px solid var(--border)"}}>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--amber2)",fontWeight:700}}>{dayHeadingLabel(evt.date,g.day)}</div>
            {g.idxs.map(i=>renderStop(i))}
            <Btn onClick={()=>addStopOnDay(g.day)} variant="subtle" size="sm">+ Add Stop — Dag {g.day+1}</Btn>
          </div>
        ))}
        {overflowIdxs.length>0&&(
          <div style={{display:"grid",gap:".9rem"}}>
            <div style={{fontFamily:"var(--font-h)",fontSize:"1rem",color:"var(--red)",fontWeight:700}}>⚠️ Overige / niet ingepland</div>
            <div style={{fontSize:".76rem",color:"var(--muted)",marginTop:-6}}>Deze stops vallen buiten de huidige datums van dit event. Kies bij een stop een dag om ‘m weer in te plannen — ze worden nooit automatisch verwijderd.</div>
            {overflowIdxs.map(i=>renderStop(i))}
          </div>
        )}
      </>
    }
    <div style={{display:"flex",gap:8,alignItems:"center"}}><Btn onClick={()=>onSave(sched)}>Save</Btn><Btn onClick={onClose} variant="ghost">Discard changes</Btn><span style={{color:"var(--muted)",fontSize:".7rem"}}>Clicking outside saves automatically</span></div>
  </div></Modal>);
};

const AttendeeInput=({attendees,setAttendees,users=[]})=>{
  const [an,setAn]=useState("");
  const suggestions=an.length>0?users.filter(u=>u.role!=="pending"&&u.username.toLowerCase().includes(an.toLowerCase())&&!attendees.some(a=>a.name.toLowerCase()===u.username.toLowerCase())):[];
  const add=name=>{if(!name.trim())return;setAttendees([...attendees,{name:name.trim(),status:"going"}]);setAn("");};
  return(
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
        {attendees.map((a,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:"var(--bg3)",borderRadius:8,padding:"5px 10px",fontSize:".8rem"}}>
            {a.name}<span onClick={()=>setAttendees(attendees.filter((_,j)=>j!==i))} style={{cursor:"pointer",color:"var(--muted)",marginLeft:2}}>✕</span>
          </div>
        ))}
      </div>
      <div style={{position:"relative"}}>
        <div style={{display:"flex",gap:6}}>
          <Inp value={an} onChange={e=>setAn(e.target.value)} placeholder="Naam toevoegen…" onKeyDown={e=>{if(e.key==="Enter"&&an.trim())add(an);}}/>
          <Btn onClick={()=>add(an)} variant="subtle" size="sm" style={{flexShrink:0}}>Add</Btn>
        </div>
        {suggestions.length>0&&(
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:50,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:"var(--radius-sm)",zIndex:10,overflow:"hidden"}}>
            {suggestions.map(u=>(
              <div key={u.id} onMouseDown={e=>{e.preventDefault();add(u.username);}} style={{padding:"8px 12px",cursor:"pointer",fontSize:".85rem",display:"flex",alignItems:"center",gap:8}} onMouseEnter={e=>e.currentTarget.style.background="var(--bg3)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                <Avatar name={u.username} size={22} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
                {u.username}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Trailer video field, shared by EditEventModal/NewEventModal: a pasted
// link OR an upload, either populating `trailer_video_url`. Follows the
// existing upload pattern (profile-photos at EditProfileModal, "Quiz
// images", event-photos at PhotosTab) -- storage bucket "event-videos".
// URL validation reuses `isSafeVideoUrl` (safeUrl.js): http(s) only, and
// must look like a video file (.mp4/.webm/.mov/.ogg) -- the same extension
// set `PresentationMode` already treats as a video at its own
// video-vs-image branch.
// Accepted MIME types mirror the `<input accept>` below (that attribute is
// only a picker *hint* -- some OS file dialogs let a lad pick "All files"
// regardless, so it isn't itself a guard). Size cap is a generous few
// minutes of trailer footage, not a hard technical limit -- picked to catch
// the "accidentally selected a wrong, huge file" case before it burns a
// full upload round trip.
const TRAILER_VIDEO_MAX_BYTES=200*1024*1024;
const TRAILER_VIDEO_TYPES=["video/mp4","video/webm","video/quicktime","video/ogg"];
const TrailerVideoField=({value,onChange,error})=>{
  const [uploading,setUploading]=useState(false);
  const [uploadErr,setUploadErr]=useState("");
  const fileRef=useRef();
  const handleUpload=async e=>{
    const file=e.target.files[0];if(!file)return;
    // Guard before the network round trip fires -- catches a bad pick for
    // free, and (more importantly) prevents a file that WOULD upload fine
    // but then fail this field's own `isSafeVideoUrl` extension check from
    // ever reaching the bucket in the first place: nothing in this app ever
    // deletes an object, so a file that got that far would sit there
    // orphaned forever.
    if(!TRAILER_VIDEO_TYPES.includes(file.type)){setUploadErr("Ongeldig bestandstype -- kies een .mp4, .webm, .mov of .ogg video.");e.target.value="";return;}
    if(file.size>TRAILER_VIDEO_MAX_BYTES){setUploadErr(`Bestand is te groot (max ${Math.round(TRAILER_VIDEO_MAX_BYTES/1024/1024)}MB).`);e.target.value="";return;}
    setUploading(true);setUploadErr("");
    const path=`${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const{data,error:upErr}=await supabase.storage.from("event-videos").upload(path,file);
    // Generic, fixed message -- matches the write-error banner's convention
    // (raw Supabase error text, e.g. an RLS policy string, goes to
    // console.error only, never straight to the screen).
    if(upErr){console.error("Trailer video upload failed:",upErr);setUploadErr("Upload mislukt -- probeer opnieuw.");setUploading(false);e.target.value="";return;}
    const{data:{publicUrl}}=supabase.storage.from("event-videos").getPublicUrl(data.path);
    onChange(publicUrl);setUploading(false);e.target.value="";
  };
  return(
    <div>
      <Lbl>Trailer video</Lbl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Inp value={value||""} onChange={e=>onChange(e.target.value)} placeholder="https://…video.mp4 (of upload)" style={{flex:1,minWidth:180}}/>
        <Btn onClick={()=>fileRef.current.click()} variant="ghost" size="sm" disabled={uploading}>{uploading?"Uploaden…":"📹 Upload"}</Btn>
        {value&&<Btn onClick={()=>onChange("")} variant="ghost" size="sm" style={{color:"var(--red)"}}>Verwijderen</Btn>}
      </div>
      <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/ogg" style={{display:"none"}} onChange={handleUpload}/>
      {error&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:4}}>⚠ {error}</div>}
      {uploadErr&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:4}}>{uploadErr}</div>}
      <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:4}}>Plak een link of upload een bestand (.mp4, .webm, .mov, .ogg).</div>
    </div>
  );
};

const EditEventModal=({evt,onSave,onClose,users=[]})=>{
  const [d,setD]=useState({...evt});
  // If this event already arrives with an end_date, its saved `type` is by
  // definition a deliberate decision (possibly correcting an earlier
  // auto-suggestion) -- start "touched" so re-editing end_date this session
  // never silently overwrites it. A fresh event (no end_date yet) still
  // gets the auto-suggest on its first range.
  const typeTouched=useRef(!!evt.end_date);
  const dateErr=d.end_date&&d.date&&d.end_date<d.date?"Einddatum ligt vóór de startdatum":"";
  const videoUrlErr=d.trailer_video_url&&!isSafeVideoUrl(d.trailer_video_url)?"Ongeldige video-link (moet http(s) zijn en eindigen op .mp4, .webm, .mov of .ogg)":"";
  // Admin-facing preview of the login teaser (docs: the owner's spec calls
  // this out explicitly -- without it, the only way to see your own live
  // teaser is to dismiss it, which permanently hides it on that device).
  // Renders the REAL `TeaserModal`, so it's exactly what a user would see
  // (same fallback copy included) -- but with `onWatch`/`onSkip` both wired
  // to just closing the preview, never to `dismissTeaser`/navigation, so
  // trying it costs nothing.
  const [previewTeaser,setPreviewTeaser]=useState(false);
  const setEndDate=v=>{
    const next={...d,end_date:v};
    if(v&&v!==d.date&&!typeTouched.current)next.type="weekend";
    setD(next);
  };
  return(
    <>
    <Modal onClose={onClose} onBackdropClose={()=>{if(!dateErr&&!videoUrlErr)onSave(d);}} maxWidth={500}><H>Edit Event</H>
    <div style={{display:"grid",gap:".9rem"}}>
      <div><Lbl>Event Name</Lbl><Inp value={d.name||""} onChange={e=>setD({...d,name:e.target.value})} placeholder="Event Name"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Startdatum</Lbl><Inp type="date" value={d.date||""} onChange={e=>setD({...d,date:e.target.value})}/></div>
        <div><Lbl>Starttijd</Lbl><Inp type="time" value={d.start_time||""} onChange={e=>setD({...d,start_time:e.target.value})}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Einddatum (optioneel)</Lbl><Inp type="date" value={d.end_date||""} onChange={e=>setEndDate(e.target.value)}/></div>
        <div><Lbl>Eindtijd</Lbl><Inp type="time" value={d.end_time||""} onChange={e=>setD({...d,end_time:e.target.value})}/></div>
      </div>
      {dateErr&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:-6}}>⚠ {dateErr}</div>}
      {[["location","Locatie"],["theme","Thema"]].map(([k,l])=><div key={k}><Lbl>{l}</Lbl><Inp value={d[k]||""} onChange={e=>setD({...d,[k]:e.target.value})} placeholder={l}/></div>)}
      <div><Lbl>Type</Lbl><select value={d.type} onChange={e=>{typeTouched.current=true;setD({...d,type:e.target.value});}} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%"}}><option value="day">Day Event</option><option value="weekend">Weekend</option></select></div>
      <TrailerVideoField value={d.trailer_video_url} onChange={v=>setD({...d,trailer_video_url:v})} error={videoUrlErr}/>
      <div style={{border:"1px dashed var(--border2)",borderRadius:"var(--radius-sm)",padding:"1rem",display:"grid",gap:".7rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <Lbl>🎬 Login teaser</Lbl>
          <Btn onClick={()=>setPreviewTeaser(true)} variant="ghost" size="sm">👀 Preview</Btn>
        </div>
        <Switch checked={!!d.teaser_active} onChange={v=>setD({...d,teaser_active:v})} label="Show this teaser on login" id="teaser-active-edit"/>
        {d.teaser_active&&<>
          <div><Lbl>Teaser title</Lbl><Inp value={d.teaser_title||""} onChange={e=>setD({...d,teaser_title:e.target.value})} placeholder="🎬 A new trailer just dropped"/></div>
          <div><Lbl>Teaser text</Lbl><Inp value={d.teaser_text||""} onChange={e=>setD({...d,teaser_text:e.target.value})} placeholder="Get hyped -- the trailer is ready." multiline rows={2}/></div>
          <div><Lbl>Button label</Lbl><Inp value={d.teaser_button_label||""} onChange={e=>setD({...d,teaser_button_label:e.target.value})} placeholder="🎬 Watch the trailer"/></div>
          {!isSafeVideoUrl(d.trailer_video_url)&&<div style={{fontSize:".72rem",color:"var(--red)"}}>⚠ No trailer video set above yet -- this teaser will not show to anyone until one is added.</div>}
        </>}
      </div>
      <div><Lbl>Description</Lbl><RichTextInput value={d.description||""} onChange={v=>setD({...d,description:v})} placeholder="Beschrijving… **bold**, *italic*, - lijstje" rows={3}/></div>
      <div><Lbl>Attendees</Lbl><AttendeeInput attendees={d.attendees} setAttendees={v=>setD({...d,attendees:v})} users={users}/></div>
      <div style={{display:"flex",gap:8,marginTop:4,alignItems:"center",flexWrap:"wrap"}}><Btn onClick={()=>onSave(d)} disabled={!!dateErr||!!videoUrlErr}>Save</Btn><Btn onClick={onClose} variant="ghost">Discard changes</Btn><span style={{color:"var(--muted)",fontSize:".7rem"}}>Clicking outside saves automatically</span></div>
    </div></Modal>
    {previewTeaser&&<TeaserModal evt={d} onWatch={()=>setPreviewTeaser(false)} onSkip={()=>setPreviewTeaser(false)}/>}
    </>
  );
};

const NewEventModal=({onSave,onClose,users=[]})=>{
  const yr=new Date().getFullYear();
  const [d,setD]=useState({name:"Mens",type:"day",date:`${yr}-09-13`,end_date:"",start_time:"12:00",end_time:"",location:"TBD",description:"",theme:"",trailer_video_url:"",teaser_active:false,teaser_title:"",teaser_text:"",teaser_button_label:"",attendees:[],schedule:[],polls:[],photos:[],quizzes:[],winners:[],highlights:[],faqs:[],archived:false,kretjes:0});
  const typeTouched=useRef(false);
  const dateErr=d.end_date&&d.date&&d.end_date<d.date?"Einddatum ligt vóór de startdatum":"";
  const videoUrlErr=d.trailer_video_url&&!isSafeVideoUrl(d.trailer_video_url)?"Ongeldige video-link (moet http(s) zijn en eindigen op .mp4, .webm, .mov of .ogg)":"";
  // See EditEventModal's identical comment above -- same preview affordance,
  // same reasoning.
  const [previewTeaser,setPreviewTeaser]=useState(false);
  const setEndDate=v=>{
    const next={...d,end_date:v};
    if(v&&v!==d.date&&!typeTouched.current)next.type="weekend";
    setD(next);
  };
  return(
    <>
    <Modal onClose={onClose} onBackdropClose={()=>{}} maxWidth={500}><H>New Event</H>
    <div style={{display:"grid",gap:".85rem"}}>
      <div><Lbl>Event Name</Lbl><Inp value={d.name||""} onChange={e=>setD({...d,name:e.target.value})} placeholder="Event Name"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Startdatum</Lbl><Inp type="date" value={d.date||""} onChange={e=>setD({...d,date:e.target.value})}/></div>
        <div><Lbl>Starttijd</Lbl><Inp type="time" value={d.start_time||""} onChange={e=>setD({...d,start_time:e.target.value})}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><Lbl>Einddatum (optioneel)</Lbl><Inp type="date" value={d.end_date||""} onChange={e=>setEndDate(e.target.value)}/></div>
        <div><Lbl>Eindtijd</Lbl><Inp type="time" value={d.end_time||""} onChange={e=>setD({...d,end_time:e.target.value})}/></div>
      </div>
      {dateErr&&<div style={{fontSize:".72rem",color:"var(--red)",marginTop:-6}}>⚠ {dateErr}</div>}
      {[["location","Locatie"],["theme","Thema"]].map(([k,l])=><div key={k}><Lbl>{l}</Lbl><Inp value={d[k]||""} onChange={e=>setD({...d,[k]:e.target.value})} placeholder={l}/></div>)}
      <div><Lbl>Type</Lbl><select value={d.type} onChange={e=>{typeTouched.current=true;setD({...d,type:e.target.value});}} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"11px 14px",color:"var(--cream)",fontSize:".88rem",width:"100%"}}><option value="day">Day Event</option><option value="weekend">Weekend</option></select></div>
      <TrailerVideoField value={d.trailer_video_url} onChange={v=>setD({...d,trailer_video_url:v})} error={videoUrlErr}/>
      <div style={{border:"1px dashed var(--border2)",borderRadius:"var(--radius-sm)",padding:"1rem",display:"grid",gap:".7rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <Lbl>🎬 Login teaser</Lbl>
          <Btn onClick={()=>setPreviewTeaser(true)} variant="ghost" size="sm">👀 Preview</Btn>
        </div>
        <Switch checked={!!d.teaser_active} onChange={v=>setD({...d,teaser_active:v})} label="Show this teaser on login" id="teaser-active-new"/>
        {d.teaser_active&&<>
          <div><Lbl>Teaser title</Lbl><Inp value={d.teaser_title||""} onChange={e=>setD({...d,teaser_title:e.target.value})} placeholder="🎬 A new trailer just dropped"/></div>
          <div><Lbl>Teaser text</Lbl><Inp value={d.teaser_text||""} onChange={e=>setD({...d,teaser_text:e.target.value})} placeholder="Get hyped -- the trailer is ready." multiline rows={2}/></div>
          <div><Lbl>Button label</Lbl><Inp value={d.teaser_button_label||""} onChange={e=>setD({...d,teaser_button_label:e.target.value})} placeholder="🎬 Watch the trailer"/></div>
          {!isSafeVideoUrl(d.trailer_video_url)&&<div style={{fontSize:".72rem",color:"var(--red)"}}>⚠ No trailer video set above yet -- this teaser will not show to anyone until one is added.</div>}
        </>}
      </div>
      <div><Lbl>Description</Lbl><RichTextInput value={d.description||""} onChange={v=>setD({...d,description:v})} placeholder="Beschrijving… **bold**, *italic*, - lijstje" rows={3}/></div>
      <div><Lbl>Attendees</Lbl><AttendeeInput attendees={d.attendees} setAttendees={v=>setD({...d,attendees:v})} users={users}/></div>
      <div style={{display:"flex",gap:8,marginTop:4}}><Btn onClick={()=>onSave({...d,id:`evt-${Date.now()}`})} disabled={!!dateErr||!!videoUrlErr}>Create</Btn><Btn onClick={onClose} variant="ghost">Cancel</Btn></div>
    </div></Modal>
    {previewTeaser&&<TeaserModal evt={d} onWatch={()=>setPreviewTeaser(false)} onSkip={()=>setPreviewTeaser(false)}/>}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY DIFF
// ─────────────────────────────────────────────────────────────────────────────
const diffEvents=(prev,next)=>{
  const acts=[];
  const now=new Date().toISOString();
  next.forEach(evt=>{
    const old=prev.find(e=>e.id===evt.id);
    if(!old)return;
    const eid=evt.id,en=evt.name;
    // FAQs
    (evt.faqs||[]).forEach(faq=>{
      if(!(old.faqs||[]).find(f=>f.id===faq.id))
        acts.push({id:faq.id,type:"faq",message:`${faq.askedBy} stelde een vraag`,event:en,eventId:eid,timestamp:faq.askedAt,tab:"FAQ",targetId:`faq-${faq.id}`});
    });
    (evt.faqs||[]).forEach(faq=>{
      const of=(old.faqs||[]).find(f=>f.id===faq.id);
      if(of&&!of.answer&&faq.answer)
        acts.push({id:`ans-${faq.id}`,type:"answer",message:`Vraag beantwoord door ${faq.answeredBy}`,event:en,eventId:eid,timestamp:faq.answeredAt,tab:"FAQ",targetId:`faq-${faq.id}`});
    });
    // RSVP
    (evt.attendees||[]).forEach(att=>{
      const oa=(old.attendees||[]).find(a=>a.name===att.name);
      if(oa&&oa.status!==att.status)
        acts.push({id:`rsvp-${att.name}-${eid}-${att.status}`,type:"rsvp",message:`${att.name}: ${statusMap[att.status]?.label||att.status}`,event:en,eventId:eid,timestamp:now,tab:"Overview"});
    });
    // Photos
    const oldPhotoIds=new Set((old.photos||[]).map(p=>p.id));
    (evt.photos||[]).forEach(photo=>{
      if(!oldPhotoIds.has(photo.id))
        acts.push({id:photo.id,type:"photo",message:`${photo.uploader} uploadde een foto`,event:en,eventId:eid,timestamp:photo.uploadedAt,tab:"Photos",targetId:`photo-${photo.id}`});
    });
    // Polls — new poll (skip secret ones)
    (evt.polls||[]).forEach(poll=>{
      if(!poll.secret&&!(old.polls||[]).find(p=>p.id===poll.id))
        acts.push({id:`poll-new-${poll.id}`,type:"poll",message:`Nieuwe poll: "${poll.title}"`,event:en,eventId:eid,timestamp:now,tab:"Polls",targetId:`poll-${poll.id}`});
    });
    // Polls — poll closed (skip secret ones)
    (evt.polls||[]).forEach(poll=>{
      const op=(old.polls||[]).find(p=>p.id===poll.id);
      if(op&&!op.closed&&poll.closed&&!poll.secret)
        acts.push({id:`poll-close-${poll.id}`,type:"poll",message:`Poll resultaten: "${poll.title}"`,event:en,eventId:eid,timestamp:now,tab:"Polls",targetId:`poll-${poll.id}`});
    });
    // Schedule — only notify for genuinely new stops, not reveals of existing secret stops
    const oldActivities=new Set((old.schedule||[]).map(s=>s.activity));
    const trulyNew=(evt.schedule||[]).filter(s=>!s.secret&&!oldActivities.has(s.activity));
    if(trulyNew.length>0)
      acts.push({id:`sched-${eid}-${trulyNew.map(s=>s.activity).join("")}`,type:"schedule",message:`${trulyNew.length} activiteit${trulyNew.length>1?"en":""} toegevoegd aan het programma`,event:en,eventId:eid,timestamp:now,tab:"Overview"});
    // Location changed
    if(old.location&&evt.location&&old.location!==evt.location)
      acts.push({id:`loc-${eid}-${evt.location}`,type:"schedule",message:`Locatie gewijzigd: ${evt.location}`,event:en,eventId:eid,timestamp:now,tab:"Overview"});
    // Start time changed
    if(old.start_time&&evt.start_time&&old.start_time!==evt.start_time)
      acts.push({id:`time-${eid}-${evt.start_time}`,type:"schedule",message:`Starttijd gewijzigd: ${evt.start_time}`,event:en,eventId:eid,timestamp:now,tab:"Overview"});
    // Quizzes: no longer diffed here (docs/quiz-unification-spec.md §8.3
    // item 8, WP-Q8). A new quiz can now be created with no `events` write
    // at all (a standalone quiz, §14 decision 1) -- this block would never
    // fire for one -- and `QuizDashboard.jsx`/`QuizShell.jsx` now call
    // `onSendNotif` directly the moment a quiz is actually created instead.
    // Tradeoff, same one `docs/mensgames-spec.md`-style features already
    // accept: fires once, from the creator's own client, rather than every
    // connected client independently re-deriving the same notification off
    // this `events` diff -- which stops today's duplicate-notification
    // shape for the quiz specifically (every other activity type below
    // keeps the old per-client-diff behaviour; out of scope here).
    // Winners announced
    const ow=(old.winners||[]).length,nw=(evt.winners||[]).length;
    if(nw>ow)
      acts.push({id:`win-${eid}-${nw}`,type:"winners",message:`Winnaars bekendgemaakt!`,event:en,eventId:eid,timestamp:now,tab:"Winners & Highlights"});
  });
  return acts;
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATES PAGE
// ─────────────────────────────────────────────────────────────────────────────
const UpdatesPage=({notifications,notifLastRead,onMarkAllRead,onOpenEvent,currentUser,onClearUpdates,onClearSelf,onDeleteNotif,onDeleteSelf})=>{
  const typeIcon={rsvp:"📅",faq:"❓",answer:"💬",photo:"📷",poll:"📊",schedule:"🗓",quiz:"🧠",winners:"🏆",tournament:"🏆"};
  const typeLabel={rsvp:"RSVP",faq:"Nieuwe vraag",answer:"Vraag beantwoord",photo:"Foto",poll:"Poll",schedule:"Programma",quiz:"Quiz",winners:"Winnaars",tournament:"Toernooi"};
  const typeColor={rsvp:"var(--amber)",faq:"#7c6cfc",answer:"#56b4a0",photo:"#e08050",poll:"var(--amber2)",schedule:"var(--gold)",quiz:"#c46eff",winners:"var(--gold)",tournament:"var(--gold)"};
  const timeAgo=ts=>{const d=Date.now()-new Date(ts);if(d<60000)return"zojuist";if(d<3600000)return`${Math.floor(d/60000)}m geleden`;if(d<86400000)return`${Math.floor(d/3600000)}u geleden`;return`${Math.floor(d/86400000)}d geleden`;};
  const unread=notifications.filter(n=>n.timestamp>notifLastRead);
  const read=notifications.filter(n=>n.timestamp<=notifLastRead);
  const isAdmin=can.closePoll(currentUser);
  const Item=({n,isNew})=>(
    <div style={{display:"flex",gap:"1rem",alignItems:"flex-start",padding:".9rem 1.1rem",borderRadius:"var(--radius-sm)",border:`1px solid ${isNew?"rgba(232,148,58,.2)":"var(--border)"}`,background:isNew?"rgba(232,148,58,.04)":"var(--bg2)",transition:"background .15s,border-color .15s",marginBottom:".5rem",position:"relative"}}
      onMouseEnter={e=>{e.currentTarget.style.background="var(--bg3)";e.currentTarget.style.borderColor="var(--border2)";}}
      onMouseLeave={e=>{e.currentTarget.style.background=isNew?"rgba(232,148,58,.04)":"var(--bg2)";e.currentTarget.style.borderColor=isNew?"rgba(232,148,58,.2)":"var(--border)";}}>
      <div onClick={()=>n.eventId&&onOpenEvent(n.eventId,n.tab,n.targetId)} style={{display:"flex",gap:"1rem",alignItems:"flex-start",flex:1,minWidth:0,cursor:n.eventId?"pointer":"default"}}>
        <div style={{flexShrink:0,width:36,height:36,borderRadius:"50%",background:`${typeColor[n.type]||"var(--muted)"}22`,border:`1px solid ${typeColor[n.type]||"var(--muted)"}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem",marginTop:1}}>
          {typeIcon[n.type]||"•"}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
            <span style={{fontSize:".68rem",fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:typeColor[n.type]||"var(--muted)"}}>{typeLabel[n.type]||n.type}</span>
            {isNew&&<span style={{width:6,height:6,borderRadius:"50%",background:"var(--amber)",display:"inline-block",flexShrink:0}}/>}
          </div>
          <div style={{fontSize:".88rem",color:"var(--cream)",lineHeight:1.4}}>{n.message}</div>
          <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:3}}>{n.event} · {timeAgo(n.timestamp)}</div>
        </div>
        {n.eventId&&<div style={{color:"var(--muted)",fontSize:".8rem",alignSelf:"center",flexShrink:0,opacity:.5}}>›</div>}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0,alignSelf:"flex-start",marginTop:1}} onClick={e=>e.stopPropagation()}>
        <button onClick={()=>onDeleteSelf(n.id)}
          style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:".72rem",padding:"2px 5px",opacity:.45,lineHeight:1,transition:"opacity .15s",whiteSpace:"nowrap"}}
          onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=".45"}
          title="Delete for me">✕</button>
        {isAdmin&&<button onClick={()=>onDeleteNotif(n.id)}
          style={{background:"none",border:"1px solid rgba(255,100,100,.25)",borderRadius:4,color:"rgba(255,120,120,.7)",cursor:"pointer",fontSize:".62rem",padding:"2px 5px",opacity:.6,lineHeight:1,transition:"opacity .15s",whiteSpace:"nowrap"}}
          onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=".6"}
          title="Delete for everyone">✕ all</button>}
      </div>
    </div>
  );
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:8}}>
        <div>
          <H style={{marginBottom:2}}>📬 Updates</H>
          <div style={{fontSize:".78rem",color:"var(--muted)"}}>{unread.length>0?`${unread.length} nieuw`:"Alles bijgewerkt"}</div>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          {unread.length>0&&<Btn onClick={onMarkAllRead} variant="ghost" size="sm" style={{color:"var(--amber)",borderColor:"rgba(232,148,58,.3)"}}>✓ Alles gelezen</Btn>}
          {notifications.length>0&&<Btn onClick={onClearSelf} variant="ghost" size="sm" style={{color:"var(--muted)",borderColor:"var(--border)"}}>🗑 Wis voor mij</Btn>}
        </div>
      </div>
      {isAdmin&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(255,100,100,.06)",border:"1px solid rgba(255,100,100,.18)",borderRadius:10,padding:"10px 14px",marginBottom:"1.2rem"}}>
          <div>
            <div style={{fontSize:".78rem",fontWeight:600,color:"rgba(255,120,120,.9)"}}>Admin</div>
            <div style={{fontSize:".72rem",color:"var(--muted)",marginTop:1}}>Wis alle meldingen voor iedereen</div>
          </div>
          <Btn onClick={onClearUpdates} variant="ghost" size="sm" style={{color:"rgba(255,120,120,.85)",borderColor:"rgba(255,100,100,.3)"}}>🗑 Wis voor iedereen</Btn>
        </div>
      )}
      {notifications.length===0&&(
        <div style={{textAlign:"center",padding:"4rem 1rem",color:"var(--muted)"}}>
          <div style={{fontSize:"2.5rem",marginBottom:"1rem"}}>📭</div>
          <div style={{fontSize:".9rem"}}>Nog geen updates</div>
          <div style={{fontSize:".78rem",marginTop:6,opacity:.6}}>Nieuwe polls, schema-wijzigingen, vragen — alles verschijnt hier</div>
        </div>
      )}
      {unread.length>0&&(
        <div style={{marginBottom:"1.5rem"}}>
          <div style={{fontSize:".68rem",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:"var(--amber)",marginBottom:".65rem"}}>Nieuw · {unread.length}</div>
          {unread.map(n=><Item key={n.id} n={n} isNew={true}/>)}
        </div>
      )}
      {read.length>0&&(
        <div>
          {unread.length>0&&<div style={{fontSize:".68rem",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:"var(--muted)",marginBottom:".65rem",marginTop:"1.2rem"}}>Eerder</div>}
          {read.map(n=><Item key={n.id} n={n} isNew={false}/>)}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SARA JAY OR JAI — MINI GAME
// ─────────────────────────────────────────────────────────────────────────────
const SARA_JAY_IMAGES = [
  // Replace each url with a real image URL. isReal=true → real Sara Jay photo.
  { id:"sj1",  url:"https://tinyurl.com/23sk3frt",  isReal:true,  difficulty:"easy"   },
  { id:"sj2",  url:"https://tinyurl.com/23sk3frt",  isReal:false, difficulty:"hard"   },
  { id:"sj3",  url:"https://tinyurl.com/23sk3frt",  isReal:true,  difficulty:"medium" },
];
const SJ_CORRECT = [
  "Goed zo lad! 🔥","Je hebt een scherp oog 👁","Boom! Raak! 💥","Ken je haar al? 👀","Too easy 😎","Je bent een pro","Niemand fokt met jou 🎯",
];
const SJ_WRONG = [
  "AI had je te pakken 💀","Nope, helemaal fout 😂","JAI got you 🤖","Game over, lad 👋","Zonde van de streak 🍿","Volgende keer beter joh","Ouch 😬",
];

const SaraJayOrJAI = () => {
  const [phase, setPhase] = useState("idle");
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [imgKey, setImgKey] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lastCorrect, setLastCorrect] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState("");
  const [newRecord, setNewRecord] = useState(false);
  const timerRef = useRef(null);

  const [bestStreak, setBestStreak] = useState(() => {
    try { return JSON.parse(localStorage.getItem("md-sarajay") || "{}").bestStreak ?? 0; } catch { return 0; }
  });
  const [totalScore, setTotalScore] = useState(() => {
    try { return JSON.parse(localStorage.getItem("md-sarajay") || "{}").totalScore ?? 0; } catch { return 0; }
  });

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const startGame = () => {
    clearTimeout(timerRef.current);
    setQueue(shuffle(SARA_JAY_IMAGES));
    setIdx(0);
    setImgKey(k => k + 1);
    setScore(0);
    setStreak(0);
    setLastCorrect(null);
    setNewRecord(false);
    setPhase("playing");
  };

  const saveStats = (finalStreak, finalScore) => {
    const nb = Math.max(bestStreak, finalStreak);
    const nt = totalScore + finalScore;
    setBestStreak(nb);
    setTotalScore(nt);
    localStorage.setItem("md-sarajay", JSON.stringify({ bestStreak: nb, totalScore: nt }));
    return nb > bestStreak;
  };

  const handleGuess = guessedReal => {
    if (phase !== "playing") return;
    const img = queue[idx];
    const correct = guessedReal === img.isReal;
    const msg = correct
      ? SJ_CORRECT[Math.floor(Math.random() * SJ_CORRECT.length)]
      : SJ_WRONG[Math.floor(Math.random() * SJ_WRONG.length)];
    setLastCorrect(correct);
    setFeedbackMsg(msg);
    setPhase("feedback");

    timerRef.current = setTimeout(() => {
      if (correct) {
        const ns = score + 1;
        const nk = streak + 1;
        setScore(ns);
        setStreak(nk);
        const nextIdx = (idx + 1) % queue.length;
        if (nextIdx === 0) setQueue(q => shuffle(q));
        setIdx(nextIdx);
        setImgKey(k => k + 1);
        setPhase("playing");
      } else {
        const isNew = saveStats(streak, score);
        setNewRecord(isNew);
        setPhase("dead");
      }
    }, 1500);
  };

  const img = queue[idx];
  const diffColor = { easy: "var(--green)", medium: "var(--amber)", hard: "var(--red)" };

  if (phase === "idle") {
    return (
      <div className="fu" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", paddingTop: "1.5rem" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "3.5rem", marginBottom: ".4rem" }}>🤖</div>
          <H style={{ fontStyle: "italic", fontSize: "clamp(1.6rem,6vw,2.4rem)", lineHeight: 1.1 }}>Sara Jay or Sara JAI?</H>
          <p style={{ color: "var(--muted)", marginTop: ".6rem", fontSize: ".9rem" }}>Echt persoon of AI? Één fout = game over.</p>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".5rem 1.2rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-h)" }}>{bestStreak}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Best streak</div>
          </div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".5rem 1.2rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-h)" }}>{totalScore}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Total score</div>
          </div>
        </div>
        <Btn variant="gold" size="lg" onClick={startGame} style={{ fontSize: "1.1rem", padding: "14px 40px" }}>Spelen 🎮</Btn>
        <div style={{ color: "var(--muted2)", fontSize: ".75rem", textAlign: "center", maxWidth: 280 }}>
          Raad of elke foto echt of AI is. Streak = opeenvolgende goede antwoorden. Één fout en je bent klaar.
        </div>
      </div>
    );
  }

  if (phase === "dead") {
    return (
      <div className="fu" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", paddingTop: "1.5rem" }}>
        <div className="sj-wrong" style={{ fontSize: "4rem" }}>💀</div>
        <div style={{ textAlign: "center" }}>
          <H style={{ fontSize: "2rem" }}>Game Over</H>
          <p style={{ color: "var(--muted)", marginTop: ".3rem" }}>{feedbackMsg}</p>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".6rem 1.4rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-h)" }}>{score}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Score</div>
          </div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".6rem 1.4rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--amber)", fontFamily: "var(--font-h)" }}>{streak}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Streak</div>
          </div>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: ".6rem 1.4rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--gold)", fontFamily: "var(--font-h)" }}>{bestStreak}</div>
            <div style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>Best</div>
          </div>
        </div>
        {newRecord && (
          <div className="pop" style={{ background: "linear-gradient(135deg,var(--gold),var(--amber))", color: "var(--bg)", borderRadius: 50, padding: ".4rem 1.4rem", fontSize: ".9rem", fontWeight: 700 }}>
            🏆 Nieuw record!
          </div>
        )}
        <Btn variant="gold" size="lg" onClick={startGame}>🔄 Opnieuw</Btn>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", paddingTop: ".5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", maxWidth: 420, padding: "0 .2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "1.3rem" }}>🔥</span>
          <span style={{ fontFamily: "var(--font-h)", fontSize: "1.8rem", color: "var(--amber)", lineHeight: 1 }}>{streak}</span>
          <span style={{ fontSize: ".7rem", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>streak</span>
        </div>
        <div style={{ fontSize: ".75rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
          <span>🏆 Best:</span>
          <span style={{ color: "var(--gold)", fontWeight: 700 }}>{bestStreak}</span>
        </div>
        <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Score: <span style={{ color: "var(--cream)", fontWeight: 600 }}>{score}</span></div>
      </div>

      <div style={{ position: "relative", width: "100%", maxWidth: 420, aspectRatio: "3/4", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--bg2)", border: "1px solid var(--border)" }}>
        {img && (
          <img
            key={imgKey}
            src={img.url}
            alt="Guess this"
            className="sj-img"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
        {img && (
          <div style={{ position: "absolute", bottom: 10, left: 10, background: diffColor[img.difficulty] || "var(--muted)", color: "var(--bg)", borderRadius: 50, padding: "2px 10px", fontSize: ".68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>
            {img.difficulty}
          </div>
        )}
        {phase === "feedback" && (
          <div className="pop" style={{ position: "absolute", inset: 0, background: lastCorrect ? "rgba(34,197,94,.88)" : "rgba(239,68,68,.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ".6rem", padding: "1rem" }}>
            <div style={{ fontSize: "4rem", lineHeight: 1 }}>{lastCorrect ? "✓" : "✗"}</div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "1.1rem", textAlign: "center" }}>{feedbackMsg}</div>
            <div style={{ color: "rgba(255,255,255,.8)", fontSize: ".8rem" }}>
              Correct: <strong>{img?.isReal ? "Echt 👤" : "AI 🤖"}</strong>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: ".8rem", width: "100%", maxWidth: 420 }}>
        <button
          className="sj-btn"
          disabled={phase === "feedback"}
          onClick={() => handleGuess(true)}
          style={{ flex: 1, padding: "16px 0", fontSize: "1.05rem", fontWeight: 700, fontFamily: "var(--font-b)", borderRadius: "var(--radius-sm)", border: "2px solid rgba(76,175,125,.5)", background: "rgba(76,175,125,.12)", color: "var(--green)", cursor: "pointer", opacity: phase === "feedback" ? .5 : 1 }}
        >
          👤 Echt
        </button>
        <button
          className="sj-btn"
          disabled={phase === "feedback"}
          onClick={() => handleGuess(false)}
          style={{ flex: 1, padding: "16px 0", fontSize: "1.05rem", fontWeight: 700, fontFamily: "var(--font-b)", borderRadius: "var(--radius-sm)", border: "2px solid rgba(224,85,85,.5)", background: "rgba(224,85,85,.12)", color: "var(--red)", cursor: "pointer", opacity: phase === "feedback" ? .5 : 1 }}
        >
          🤖 JAI
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TEAM CREATOR PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TEAM_COLORS=["var(--amber)","var(--blue)","var(--green)","var(--purple)","var(--orange)","var(--red)","#56b4a0","#e08050","#9b7fe8","#5b9bd5"];
const TeamCreatorPage=({users,events=[],currentUser=null,teamSets=[],teamSetsError=null,onRetryTeamSets,onTeamSetsChanged})=>{
  // Team Creator rebuild (2026-08-25 -- "brackets first, then fill"): picking
  // a team count creates that many empty brackets on screen immediately;
  // people get dropped into whichever bracket by hand, and Genereer only
  // ever fills whatever's still empty. This replaces the old flow (flat
  // pool -> Genereer -> teams appear -> retrofit placement via a pin icon)
  // and retires the pin concept along with it: once someone is a member of
  // a bracket -- manually placed or auto-filled, doesn't matter which --
  // that IS "pinned" now, with no separate toggle needed, because
  // `generateTeams` (teamlib/model.js) never moves anyone already seated.
  // `resizeTeams` (also teamlib/model.js) is what makes the count/size
  // stepper create/remove brackets live.
  const [teamMode,setTeamMode]=useState("count");
  const [teamCount,setTeamCount]=useState(4);
  const [teamSize,setTeamSize]=useState(3);
  const [participants,setParticipants]=useState([]);
  const [input,setInput]=useState("");
  const [teams,setTeams]=useState(()=>resizeTeams([],4,TEAM_AVATARS));
  const [generating,setGenerating]=useState(false);
  const [showPicker,setShowPicker]=useState(false);
  const [avatarPicker,setAvatarPicker]=useState(null);
  const [attendeeEvtId,setAttendeeEvtId]=useState("");
  const [setName,setSetName]=useState("");
  const [setCategory,setSetCategory]=useState("");
  const [linkEvtIds,setLinkEvtIds]=useState([]);
  const [editingSetId,setEditingSetId]=useState(null);
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const [saved,setSaved]=useState(false);
  const [libFilter,setLibFilter]=useState("active");
  const appUsers=users.filter(u=>ACTIVE_ROLES.includes(u.role));
  const allAppNames=namesFromUsers(appUsers);
  const activeEvents=events.filter(e=>!e.archived).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const attendeeNames=evt=>(evt.attendees||[]).filter(a=>["going","went"].includes(a.status)).map(a=>a.name).filter(Boolean);
  const eventsWithAttendees=activeEvents.filter(e=>attendeeNames(e).length>0);

  // How many brackets should exist right now. "Count" mode (the primary,
  // owner-requested control) drives it directly and independently of
  // roster size -- setting it to 4 makes 4 brackets exist even with nobody
  // added yet. "Size" mode derives it from the roster instead, same number
  // its preview line always showed.
  const effectiveTeamCount=teamMode==="count"
    ?Math.max(1,teamCount)
    :(participants.length>0?Math.ceil(participants.length/Math.max(1,teamSize)):0);

  // Brackets track live with the count/size control -- growing appends
  // fresh empty ones (via `resizeTeams`), shrinking drops from the end.
  // Shrinking never deletes a person: they simply stop being anyone's
  // member and resurface in the unassigned pool below (`unassignedNames`
  // is derived from participants minus who's still seated, not tracked
  // separately), which is what makes it safe.
  useEffect(()=>{
    setTeams(prev=>resizeTeams(prev,effectiveTeamCount,TEAM_AVATARS));
  },[effectiveTeamCount]);

  // Bulk-remove: drops each name from the roster and (if seated anywhere)
  // from that bracket -- via `removeMember`, which is also what clears
  // captaincy when the removed name was captain.
  const dropParticipants=names=>{
    const dropSet=new Set(names);
    if(dropSet.size===0)return;
    setParticipants(p=>p.filter(x=>!dropSet.has(x)));
    setTeams(prev=>prev.map(t=>{let nt=t;names.forEach(n=>{nt=removeMember(nt,n);});return nt;}));
    setSaved(false);
  };
  const add=name=>{const t=name.trim();if(!t||participants.includes(t))return;setParticipants(p=>[...p,t]);setSaved(false);};
  const addInput=()=>{input.split(",").map(s=>s.trim()).filter(Boolean).forEach(add);setInput("");};
  const remove=name=>dropParticipants([name]);
  const selectAllAppUsers=()=>{setParticipants(p=>mergeNames(p,allAppNames));setSaved(false);};
  const deselectAllAppUsers=()=>dropParticipants(allAppNames.filter(n=>participants.includes(n)));
  const addEventAttendees=()=>{
    const evt=events.find(e=>e.id===attendeeEvtId);
    if(!evt)return;
    setParticipants(p=>mergeNames(p,attendeeNames(evt)));
    setAttendeeEvtId("");
    setSaved(false);
  };

  // Genereer only ever fills whatever's still empty -- anyone already
  // seated (manually placed, or left there by an earlier generate) is
  // untouched, on every call. See teamlib/model.js `generateTeams` for why
  // that's true by construction rather than by tracking a pinned/unpinned
  // split.
  const generate=()=>{
    if(unassignedNames.length===0)return;
    setGenerating(true);setSaved(false);
    setTimeout(()=>{
      setTeams(prev=>generateTeams(
        teamMode==="count"
          ?{participants,teamCount,existingTeams:prev}
          :{participants,teamSize,existingTeams:prev}
      ));
      setGenerating(false);
    },700);
  };
  // "Start over" -- empties every bracket back into the pool without
  // deleting the brackets themselves or the roster. There was no "empty
  // bracket" state to return to before this rebuild, so this replaces the
  // old ♻️ Opnieuw beginnen's "null out `teams` entirely" behaviour.
  const resetPlacements=()=>{
    setTeams(prev=>prev.map(t=>({...t,members:[],captain:null})));
    setEditingSetId(null);
    setSaved(false);
  };
  const renameTeam=(idx,name)=>setTeams(ts=>ts.map((t,i)=>i===idx?{...t,name}:t));
  const setAvatar=(idx,av)=>{setTeams(ts=>ts.map((t,i)=>i===idx?{...t,avatar:av}:t));setAvatarPicker(null);};
  // #8 -- captains. Reuses QuizBuilder's 👑-toggle visual language (opacity
  // active/inactive, gold when active) so the interaction feels identical
  // wherever a lad meets it.
  const toggleCaptain=(teamId,name)=>{setTeams(prev=>prev.map(t=>t.id===teamId?setCaptain(t,name):t));setSaved(false);};
  // Adds someone from the unassigned pool onto a specific bracket -- the
  // "obvious way to add someone" the ticket asks for, same interaction
  // language as QuizBuilder's per-team "+ Add member…" select.
  const addToTeam=(teamId,name)=>{
    if(!name)return;
    setTeams(prev=>prev.map(t=>t.id===teamId&&!(t.members||[]).includes(name)?{...t,members:[...(t.members||[]),name]}:t));
    setSaved(false);
  };
  // Removes someone from *this* bracket only -- they stay on the roster and
  // simply fall back into the unassigned pool, ready to be placed again.
  const removeFromTeam=(teamId,name)=>{
    setTeams(prev=>prev.map(t=>t.id===teamId?removeMember(t,name):t));
    setSaved(false);
  };

  const toggleLinkEvt=id=>setLinkEvtIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);

  // #9 -- "save to library" replaces "save to event"; linking an event is
  // now an optional multi-select rather than a required single one.
  const saveToLibrary=async()=>{
    const name=setName.trim();
    if(!name||totalPlaced===0)return;
    setSaving(true);setSaveError(false);
    const existing=editingSetId?teamSets.find(ts=>ts.id===editingSetId):null;
    const payload=existing
      ?{...existing,name,category:setCategory.trim(),teams,eventIds:linkEvtIds}
      :{...blankTeamSet(),name,category:setCategory.trim(),teams,eventIds:linkEvtIds,createdBy:currentUser?.display_name||currentUser?.username||""};
    const result=await saveTeamSet(payload);
    setSaving(false);
    if(!result.ok){setSaveError(true);return;}
    onTeamSetsChanged?.(prev=>{
      const exists=prev.some(ts=>ts.id===result.teamSet.id);
      return exists?prev.map(ts=>ts.id===result.teamSet.id?result.teamSet:ts):[result.teamSet,...prev];
    });
    setEditingSetId(result.teamSet.id);
    setSaved(true);
  };
  const loadForEdit=ts=>{
    const loadedTeams=(Array.isArray(ts.teams)?ts.teams:[]).map(t=>({id:t.id,name:t.name||"",avatar:t.avatar||"🎯",captain:t.captain||null,members:Array.isArray(t.members)?[...t.members]:[]}));
    setEditingSetId(ts.id);
    setSetName(ts.name||"");
    setSetCategory(ts.category||"");
    setLinkEvtIds(Array.isArray(ts.eventIds)?[...ts.eventIds]:[]);
    // Force "count" mode to exactly the loaded bracket count, so the live
    // resize effect above lands on the same number and leaves what was
    // just loaded alone.
    setTeamMode("count");
    setTeamCount(Math.max(1,loadedTeams.length));
    setTeams(loadedTeams);
    setParticipants(loadedTeams.flatMap(t=>t.members));
    setSaved(false);setSaveError(false);
  };
  const cancelEdit=()=>{setEditingSetId(null);setSaved(false);};
  // On failure, each of these used to do nothing at all -- no banner, no
  // state change, the button just looked dead. Same bug class as
  // `updateEvent`'s pre-fix write path; `saveToLibrary` above already got
  // it right (`saveError`), this brings archive/unarchive/delete in line
  // with one shared banner rather than three near-identical ones.
  const [libraryActionError,setLibraryActionError]=useState(false);
  const doDelete=async ts=>{
    if(!window.confirm(`"${ts.name}" definitief verwijderen uit de bibliotheek? Dit kan niet ongedaan gemaakt worden.`))return;
    setLibraryActionError(false);
    const result=await deleteTeamSet(ts.id);
    if(result.ok){
      onTeamSetsChanged?.(prev=>prev.filter(x=>x.id!==ts.id));
      if(editingSetId===ts.id)setEditingSetId(null);
    } else setLibraryActionError(true);
  };
  const doArchive=async ts=>{
    setLibraryActionError(false);
    const result=await archiveTeamSet(ts);
    if(result.ok)onTeamSetsChanged?.(prev=>prev.map(x=>x.id===ts.id?result.teamSet:x));
    else setLibraryActionError(true);
  };
  const doUnarchive=async ts=>{
    setLibraryActionError(false);
    const result=await unarchiveTeamSet(ts);
    if(result.ok)onTeamSetsChanged?.(prev=>prev.map(x=>x.id===ts.id?result.teamSet:x));
    else setLibraryActionError(true);
  };

  const pickedNames=new Set(participants);
  // "The UI should say what will happen before he commits" -- honest
  // preview of how an even split across `teamCount` teams would look, next
  // to the stepper. Still informational-only: once people are placed by
  // hand the actual brackets can end up a different shape than this.
  const countSizes=participants.length>0?splitPreview(participants.length,teamCount):[];
  const countEmptyTeams=countSizes.filter(s=>s===0).length;
  const allAppSelected=allAppNames.length>0&&allAppNames.every(n=>pickedNames.has(n));
  const seatedNames=new Set(teams.flatMap(t=>t.members||[]));
  const unassignedNames=participants.filter(p=>!seatedNames.has(p));
  const totalPlaced=teams.reduce((sum,t)=>sum+(t.members||[]).length,0);
  const visibleSets=teamSets.filter(ts=>libFilter==="archived"?ts.status==="archived":ts.status!=="archived");
  // Contrast audit (2026-08-25), updated 2026-08-26 (docs/ux-plan.md
  // §2.3/§5.7): this used to be a locally-scoped fix -- `var(--muted)`
  // measured 3.86-4.33:1 on this screen's card backgrounds, under the
  // 4.5:1 body text minimum, so this component alone switched its
  // secondary text to translucent cream instead. That fix has now been
  // promoted into `--muted` itself (GS block, App.jsx ~line 43) so every
  // call site in the app gets it, not just this one -- kept as a local
  // alias so the ~20 usages below don't all need editing. `--muted2` is
  // still unfixed app-wide (tracked separately, not this pass).
  const AA_MUTED="var(--muted)";
  // 44x44 minimum tap target (was 24x24) -- this is the row a slightly
  // drunk man needs to hit one-handed in a bar. Bumping the box without
  // shrinking the row required moving these off the name line -- see the
  // two-line member row below.
  const iconBtn=(active,color)=>({background:"none",border:"none",cursor:"pointer",fontSize:".95rem",padding:4,minWidth:44,minHeight:44,display:"flex",alignItems:"center",justifyContent:"center",opacity:active?1:.68,color:color||"var(--cream)",lineHeight:1,transition:"opacity .15s",borderRadius:8});

  return(
    <div className="fu">
      <H size="1.7rem" style={{marginBottom:"1.5rem"}}>🎲 Team Creator</H>

      <Card style={{marginBottom:"1.2rem"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:".8rem"}}>
          <H size="1rem" style={{marginBottom:0}}>{teamMode==="count"?"Aantal teams":"Personen per team"}</H>
          {/* Team count is the primary control (2026-08-24 -- "let me pick
              the amount of teams... fill up the open spots randomly");
              people-per-team stays reachable behind this toggle instead of
              a second permanent stepper, so the one-handed-use layout
              doesn't regress. */}
          <button type="button" onClick={()=>setTeamMode(m=>m==="count"?"size":"count")}
            style={{background:"none",border:"1px solid var(--border)",borderRadius:20,padding:"6px 12px",fontSize:".74rem",color:AA_MUTED,cursor:"pointer",fontFamily:"var(--font-b)",minHeight:32}}>
            {teamMode==="count"?"⇄ liever personen per team instellen":"⇄ liever aantal teams instellen"}
          </button>
        </div>
        {teamMode==="count"?(
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <button onClick={()=>setTeamCount(t=>Math.max(1,t-1))} style={{width:38,height:38,borderRadius:8,background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--cream)",fontSize:"1.3rem",cursor:"pointer",fontFamily:"var(--font-b)",lineHeight:1}}>−</button>
            <span style={{fontFamily:"var(--font-h)",fontSize:"2.2rem",color:"var(--amber)",minWidth:44,textAlign:"center",lineHeight:1}}>{teamCount}</span>
            <button onClick={()=>setTeamCount(t=>Math.min(20,t+1))} style={{width:38,height:38,borderRadius:8,background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--cream)",fontSize:"1.3rem",cursor:"pointer",fontFamily:"var(--font-b)",lineHeight:1}}>+</button>
            {participants.length>0&&<div style={{color:AA_MUTED,fontSize:".83rem",marginLeft:6}}>
              → {participants.length} {participants.length===1?"persoon":"personen"}: <strong style={{color:"var(--cream)"}}>{countSizes.join(", ")}</strong>
              {countEmptyTeams>0&&<span style={{marginLeft:4}}>({countEmptyTeams} team{countEmptyTeams===1?"":"s"} {countEmptyTeams===1?"blijft":"blijven"} leeg)</span>}
            </div>}
          </div>
        ):(
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <button onClick={()=>setTeamSize(t=>Math.max(1,t-1))} style={{width:38,height:38,borderRadius:8,background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--cream)",fontSize:"1.3rem",cursor:"pointer",fontFamily:"var(--font-b)",lineHeight:1}}>−</button>
            <span style={{fontFamily:"var(--font-h)",fontSize:"2.2rem",color:"var(--amber)",minWidth:44,textAlign:"center",lineHeight:1}}>{teamSize}</span>
            <button onClick={()=>setTeamSize(t=>Math.min(20,t+1))} style={{width:38,height:38,borderRadius:8,background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--cream)",fontSize:"1.3rem",cursor:"pointer",fontFamily:"var(--font-b)",lineHeight:1}}>+</button>
            {participants.length>0&&<div style={{color:AA_MUTED,fontSize:".83rem",marginLeft:6}}>
              → <strong style={{color:"var(--cream)"}}>{effectiveTeamCount}</strong> {effectiveTeamCount===1?"team":"teams"}
              {participants.length%teamSize!==0&&<span style={{marginLeft:4}}>(1 team met {participants.length%teamSize})</span>}
            </div>}
          </div>
        )}
      </Card>

      <Card style={{marginBottom:"1.2rem"}}>
        <H size="1rem" style={{marginBottom:".8rem"}}>
          Deelnemers{participants.length>0&&<span style={{color:AA_MUTED,fontFamily:"var(--font-b)",fontSize:".78rem",fontWeight:400,marginLeft:6}}>({participants.length})</span>}
        </H>
        <div style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:180,display:"flex",gap:8}}>
            <Inp value={input} onChange={e=>setInput(e.target.value)} placeholder="Naam (komma voor meerdere)" onKeyDown={e=>{if(e.key==="Enter")addInput();}} style={{flex:1}}/>
            <Btn onClick={addInput} variant="subtle" size="sm" style={{flexShrink:0}}>+ Voeg toe</Btn>
          </div>
          <Btn onClick={()=>setShowPicker(p=>!p)} variant={showPicker?"primary":"ghost"} size="sm">👥 Uit app</Btn>
        </div>

        {showPicker&&(
          <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".75rem",marginBottom:"1rem"}}>
            {/* #6 -- select all / deselect all, instead of clicking every tile */}
            <div style={{display:"flex",justifyContent:"flex-end",gap:6,marginBottom:8,flexWrap:"wrap"}}>
              <Btn onClick={selectAllAppUsers} variant="ghost" size="sm" disabled={allAppSelected||allAppNames.length===0}>✓ Selecteer alles</Btn>
              <Btn onClick={deselectAllAppUsers} variant="ghost" size="sm" disabled={!allAppNames.some(n=>pickedNames.has(n))}>✕ Deselecteer alles</Btn>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:6}}>
              {appUsers.map(u=>{
                const name=u.display_name||u.username;
                const picked=pickedNames.has(name);
                return(
                  <div key={u.id} onClick={()=>picked?remove(name):add(name)}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber2)";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=picked?"var(--amber)":"var(--border)";}}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:8,border:`1px solid ${picked?"var(--amber)":"var(--border)"}`,background:picked?"rgba(232,148,58,.12)":"var(--bg2)",cursor:"pointer",transition:"border-color .15s"}}>
                    <Avatar name={u.username} size={24} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>
                    <span style={{fontSize:".82rem",color:picked?"var(--amber2)":"var(--cream)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{name}</span>
                    {picked&&<span style={{color:"var(--amber)",fontSize:".75rem",flexShrink:0}}>✓</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* #6 -- "everyone attending event X", since attendee lists already exist */}
        {eventsWithAttendees.length>0&&(
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:"1rem"}}>
            <select value={attendeeEvtId} onChange={e=>setAttendeeEvtId(e.target.value)}
              style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"8px 10px",color:attendeeEvtId?"var(--cream)":AA_MUTED,fontFamily:"var(--font-b)",fontSize:".82rem",outline:"none",flex:1,minWidth:200}}>
              <option value="">— Iedereen van event… —</option>
              {eventsWithAttendees.map(e=>(
                <option key={e.id} value={e.id}>{e.name} ({attendeeNames(e).length})</option>
              ))}
            </select>
            <Btn onClick={addEventAttendees} variant="subtle" size="sm" disabled={!attendeeEvtId}>+ Voeg toe</Btn>
          </div>
        )}

        {participants.length>0?(
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {participants.map(name=>(
              <span key={name} style={{display:"flex",alignItems:"center",gap:5,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:20,padding:"4px 10px 4px 13px",fontSize:".83rem",color:"var(--cream)"}}>
                {name}
                <button onClick={()=>remove(name)} aria-label={`Verwijder ${name}`} style={{background:"none",border:"none",color:AA_MUTED,cursor:"pointer",fontSize:".95rem",lineHeight:1,padding:"0 0 0 4px",display:"flex",alignItems:"center",minHeight:24}}>×</button>
              </span>
            ))}
          </div>
        ):(
          <div style={{color:AA_MUTED,fontSize:".83rem"}}>Voeg deelnemers toe via de app of typ ze handmatig.</div>
        )}
      </Card>

      {/* Team Creator rebuild (#brackets-first) -- the unassigned pool gets
          its own card, right above the brackets it feeds: who's still
          waiting, and the one button that seats them. */}
      <Card style={{marginBottom:"1.2rem"}}>
        <H size="1rem" style={{marginBottom:".8rem"}}>
          🧍 Niet ingedeeld{unassignedNames.length>0&&<span style={{color:AA_MUTED,fontFamily:"var(--font-b)",fontSize:".78rem",fontWeight:400,marginLeft:6}}>({unassignedNames.length})</span>}
        </H>
        {unassignedNames.length>0?(
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"1rem"}}>
            {unassignedNames.map(name=>(
              <span key={name} style={{background:"rgba(232,148,58,.08)",border:"1px solid rgba(232,148,58,.25)",borderRadius:20,padding:"4px 12px",fontSize:".83rem",color:"var(--amber2)"}}>{name}</span>
            ))}
          </div>
        ):(
          <div style={{color:participants.length>0?"var(--green)":AA_MUTED,fontSize:".83rem",marginBottom:"1rem"}}>
            {participants.length>0?"✓ Iedereen is ingedeeld.":"Voeg hierboven deelnemers toe om ze te kunnen indelen."}
          </div>
        )}
        <div style={{textAlign:"center"}}>
          <Btn onClick={generate} variant="gold" size="lg" disabled={unassignedNames.length===0||generating} style={{minWidth:220}}>
            {generating?"🎲 Loten...":"🎲 Genereer Teams"}
          </Btn>
          {unassignedNames.length>0&&!generating&&<div style={{color:AA_MUTED,fontSize:".78rem",marginTop:6}}>
            Vult automatisch {unassignedNames.length===1?"de laatste open plek":`de resterende ${unassignedNames.length} plekken`}.
          </div>}
          {generating&&<div style={{color:AA_MUTED,fontSize:".78rem",marginTop:6}}>Schud… schud… schud…</div>}
        </div>
      </Card>

      <div style={{marginBottom:"1.5rem"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
          <H size="1.1rem" style={{marginBottom:0}}>🏁 Teams ({teams.length})</H>
          <Btn onClick={resetPlacements} variant="ghost" size="sm" disabled={totalPlaced===0}>♻️ Opnieuw beginnen</Btn>
        </div>
        {teams.length===0?(
          <div style={{textAlign:"center",padding:"2rem 1rem",color:AA_MUTED,fontSize:".85rem"}}>Voeg deelnemers toe om teams te zien.</div>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:"1rem"}}>
            {teams.map((team,i)=>{
              const col=TEAM_COLORS[i%TEAM_COLORS.length];
              const members=Array.isArray(team.members)?team.members:[];
              return(
                <div key={team.id} style={{background:"var(--bg2)",border:`1px solid ${col}44`,borderRadius:"var(--radius)",padding:"1.1rem",animation:"teamReveal .4s ease both",animationDelay:`${i*70}ms`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:".75rem"}}>
                    <button type="button" onClick={()=>setAvatarPicker(avatarPicker===i?null:i)} aria-label="Kies team-icoon" aria-expanded={avatarPicker===i}
                      style={{width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.4rem",cursor:"pointer",lineHeight:1,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg3)",userSelect:"none",flexShrink:0}}>
                      {team.avatar}
                    </button>
                    <input value={team.name} onChange={e=>renameTeam(i,e.target.value)}
                      style={{flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${col}66`,color:col,fontFamily:"var(--font-h)",fontSize:".95rem",outline:"none",padding:"2px 0",minWidth:0}}/>
                  </div>
                  {avatarPicker===i&&(
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:".6rem",padding:".4rem",background:"var(--bg)",borderRadius:8,border:"1px solid var(--border)"}}>
                      {TEAM_AVATARS.map(av=>(
                        <button key={av} type="button" onClick={()=>setAvatar(i,av)} aria-pressed={team.avatar===av} aria-label={`Kies icoon ${av}`}
                          style={{width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.2rem",cursor:"pointer",borderRadius:8,background:team.avatar===av?"rgba(232,148,58,.18)":"var(--bg3)",border:team.avatar===av?"1px solid var(--amber)":"1px solid var(--border)",userSelect:"none"}}>
                          {av}
                        </button>
                      ))}
                    </div>
                  )}
                  {team.captain&&<div style={{fontSize:".72rem",color:"var(--gold)",marginBottom:".4rem"}}>👑 Aanvoerder: <strong>{team.captain}</strong></div>}
                  <div style={{display:"flex",flexDirection:"column",gap:0}}>
                    {members.map((name,j)=>{
                      const u=users.find(x=>(x.display_name||x.username)===name);
                      const isCap=team.captain===name;
                      return(
                        // Two-line row (name gets its own full-width line so
                        // it stops truncating, controls drop to a second
                        // line) so the 44px tap targets below have room to
                        // breathe instead of forcing the card wider.
                        <div key={j} style={{display:"flex",flexDirection:"column",gap:2,padding:"6px 0",borderTop:j>0?"1px solid var(--border)":"none"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
                            {u?<Avatar name={u.username} size={22} index={u.animal_avatar??u.avatar??0} photoUrl={u.photo_url||""}/>:<div style={{width:22,height:22,borderRadius:"50%",background:"var(--bg4)",border:"1px solid var(--border)",flexShrink:0}}/>}
                            <span style={{fontSize:".88rem",color:isCap?"var(--gold)":"var(--cream)",fontWeight:isCap?700:400,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:4}}>
                            <button onClick={()=>toggleCaptain(team.id,name)} aria-label={isCap?`${name} is aanvoerder — klik om te verwijderen`:`Maak ${name} aanvoerder`} title={isCap?"Aanvoerder verwijderen":"Maak aanvoerder"} style={iconBtn(isCap,"var(--gold)")}>👑</button>
                            <button onClick={()=>removeFromTeam(team.id,name)} aria-label={`${name} terug naar de pool`} title="Terug naar de pool" style={iconBtn(true,"var(--cream)")}>✕</button>
                          </div>
                        </div>
                      );
                    })}
                    {members.length===0&&unassignedNames.length===0&&(
                      <div style={{fontSize:".78rem",color:AA_MUTED,fontStyle:"italic",padding:"4px 0"}}>
                        {participants.length===0?"Nog geen deelnemers.":"Nog niemand ingedeeld."}
                      </div>
                    )}
                  </div>
                  {unassignedNames.length>0&&(
                    <select defaultValue="" onChange={e=>{if(!e.target.value)return;addToTeam(team.id,e.target.value);e.target.value="";}}
                      aria-label={`Voeg lid toe aan ${team.name||`team ${i+1}`}`}
                      style={{width:"100%",marginTop:members.length>0?8:0,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,color:"var(--cream)",fontSize:".82rem",padding:"0 10px",minHeight:44}}>
                      <option value="" disabled>+ Voeg lid toe…</option>
                      {unassignedNames.map(n=><option key={n} value={n}>{n}</option>)}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* #9 -- save to library (was: save to event) */}
      <Card style={{border:"1px solid var(--border2)",marginBottom:"2rem"}}>
        <H size=".95rem" style={{marginBottom:".8rem"}}>💾 {editingSetId?"Wijzigingen opslaan in bibliotheek":"Opslaan in bibliotheek"}</H>
        <div style={{display:"grid",gap:".75rem"}}>
          <Inp value={setName} onChange={e=>{setSetName(e.target.value);setSaved(false);}} placeholder="Naam voor deze teaminvulling… (bv. Groep A)"/>
          <Inp value={setCategory} onChange={e=>{setSetCategory(e.target.value);setSaved(false);}} placeholder="Categorie / doel… (bv. Quiz ronde 1, Go-kart, Bowlen)"/>
          <div>
            <Lbl style={{color:AA_MUTED}}>Koppel aan event (optioneel)</Lbl>
            {activeEvents.length===0?(
              <div style={{color:AA_MUTED,fontSize:".8rem"}}>Nog geen (actieve) events om aan te koppelen.</div>
            ):(
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {activeEvents.map(e=>{
                  const linked=linkEvtIds.includes(e.id);
                  return(
                    <button key={e.id} type="button" onClick={()=>{toggleLinkEvt(e.id);setSaved(false);}} aria-pressed={linked}
                      style={{background:linked?"rgba(232,148,58,.16)":"var(--bg3)",border:`1px solid ${linked?"var(--amber)":"var(--border)"}`,borderRadius:20,color:linked?"var(--amber2)":"var(--cream)",padding:"5px 12px",fontSize:".78rem",cursor:"pointer",fontFamily:"var(--font-b)",fontWeight:linked?600:400}}>
                      {linked?"✓ ":""}{e.name} · {formatEventDateRange(e.date,e.end_date,{weekday:false,month:"short"})}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <Btn onClick={saveToLibrary} variant="gold" disabled={!setName.trim()||saving||totalPlaced===0}>
              {saving?"Opslaan…":"💾 Opslaan"}
            </Btn>
            {editingSetId&&<Btn onClick={cancelEdit} variant="ghost" size="sm">Annuleer bewerken</Btn>}
            {saved&&<span className="pop" style={{color:"var(--green)",fontSize:".85rem",fontWeight:600}}>✓ Opgeslagen!</span>}
            {saveError&&<span role="alert" style={{color:"var(--red)",fontSize:".85rem",fontWeight:600}}>Opslaan mislukt — probeer opnieuw.</span>}
            {totalPlaced===0&&!saving&&<span style={{color:AA_MUTED,fontSize:".78rem"}}>Plaats eerst iemand in een team.</span>}
          </div>
        </div>
      </Card>

      {/* #9/#10 -- the team library: every saved set, active or archived */}
      <div style={{marginTop:"2rem"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:"1rem"}}>
          <H size="1.1rem" style={{marginBottom:0}}>📂 Teambibliotheek</H>
          <div style={{display:"flex",gap:6}}>
            <Btn onClick={()=>setLibFilter("active")} variant={libFilter==="active"?"primary":"ghost"} size="sm">Actief</Btn>
            <Btn onClick={()=>setLibFilter("archived")} variant={libFilter==="archived"?"primary":"ghost"} size="sm">Gearchiveerd</Btn>
          </div>
        </div>

        {libraryActionError&&<div role="alert" style={{color:"var(--red)",fontSize:".85rem",fontWeight:600,marginBottom:".7rem"}}>Actie mislukt — probeer opnieuw.</div>}

        {visibleSets.length===0?(
          teamSetsError?<TeamSetsErrorNotice onRetry={onRetryTeamSets}/>:
          <div style={{textAlign:"center",padding:"2rem 1rem",color:AA_MUTED,fontSize:".85rem"}}>
            {libFilter==="archived"?"Nog geen gearchiveerde teamsets.":"Nog geen teamsets opgeslagen. Genereer teams hierboven en sla ze op."}
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:".6rem"}}>
            {visibleSets.map(ts=>{
              const summary=teamSetSummary(ts);
              const linkedEvents=(ts.eventIds||[]).map(id=>events.find(e=>e.id===id)).filter(Boolean);
              const archived=ts.status==="archived";
              return(
                <div key={ts.id} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:".75rem 1rem",opacity:archived?.8:1}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:180}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap",marginBottom:2}}>
                        <span style={{fontFamily:"var(--font-b)",fontWeight:600,color:"var(--cream)",fontSize:".9rem"}}>{ts.name||"Naamloze teams"}</span>
                        {ts.category&&<span style={{background:"rgba(232,148,58,.15)",border:"1px solid rgba(232,148,58,.3)",borderRadius:20,padding:"1px 8px",fontSize:".68rem",fontFamily:"var(--font-b)",fontWeight:600,color:"var(--amber2)",letterSpacing:".04em"}}>{ts.category}</span>}
                        {archived&&<span style={{background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:20,padding:"1px 8px",fontSize:".65rem",color:AA_MUTED,letterSpacing:".04em"}}>GEARCHIVEERD</span>}
                      </div>
                      <div style={{color:AA_MUTED,fontSize:".78rem"}}>
                        {summary.teamCount} teams · {summary.memberCount} personen
                        {ts.createdAt&&<span style={{marginLeft:8,color:AA_MUTED}}>{new Date(ts.createdAt).toLocaleDateString("nl-NL",{day:"numeric",month:"short"})}</span>}
                      </div>
                      {linkedEvents.length>0&&(
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                          {linkedEvents.map(e=>(
                            <span key={e.id} style={{fontSize:".68rem",color:AA_MUTED,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:20,padding:"1px 8px"}}>{e.name}</span>
                          ))}
                        </div>
                      )}
                      {(ts.awards||[]).length>0&&(
                        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                          {ts.awards.map(a=>(
                            <span key={a.id} style={{fontSize:".7rem",color:"var(--gold)",background:"rgba(201,146,42,.14)",border:"1px solid rgba(201,146,42,.4)",borderRadius:20,padding:"2px 9px"}}>{a.label||"🏆"}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap",flexShrink:0}}>
                      <Btn onClick={()=>loadForEdit(ts)} variant="ghost" size="sm">✏️ Bewerken</Btn>
                      {archived
                        ?<Btn onClick={()=>doUnarchive(ts)} variant="ghost" size="sm">♻️ Herstellen</Btn>
                        :<Btn onClick={()=>doArchive(ts)} variant="ghost" size="sm">🗄️ Archiveren</Btn>}
                      <Btn onClick={()=>doDelete(ts)} variant="ghost" size="sm" style={{color:"var(--red)",borderColor:"transparent"}} aria-label={`${ts.name||"Teamset"} verwijderen`}>🗑</Btn>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TIMER PAGE
// ─────────────────────────────────────────────────────────────────────────────
const TIMER_PRESETS=[[30,"30s"],[60,"1m"],[120,"2m"],[300,"5m"],[600,"10m"],[900,"15m"],[1800,"30m"],[3600,"1u"]];
const TimerPage=()=>{
  const [totalSec,setTotalSec]=useState(60);
  const [remaining,setRemaining]=useState(60);
  const [running,setRunning]=useState(false);
  const [finished,setFinished]=useState(false);
  const [cMin,setCMin]=useState("1");
  const [cSec,setCsec]=useState("00");
  const intervalRef=useRef(null);

  useEffect(()=>{
    if(running){
      intervalRef.current=setInterval(()=>{
        setRemaining(r=>{
          if(r<=1){clearInterval(intervalRef.current);setRunning(false);setFinished(true);return 0;}
          return r-1;
        });
      },1000);
    } else clearInterval(intervalRef.current);
    return()=>clearInterval(intervalRef.current);
  },[running]);

  const applyPreset=s=>{
    clearInterval(intervalRef.current);setRunning(false);setFinished(false);
    setTotalSec(s);setRemaining(s);
    setCMin(String(Math.floor(s/60)));setCsec(String(s%60).padStart(2,"0"));
  };
  const applyCustom=()=>{
    const t=(parseInt(cMin)||0)*60+(parseInt(cSec)||0);
    if(t>0)applyPreset(t);
  };
  const start=()=>{if(remaining>0){setFinished(false);setRunning(true);}};
  const pause=()=>setRunning(false);
  const reset=()=>{clearInterval(intervalRef.current);setRunning(false);setFinished(false);setRemaining(totalSec);};

  const m=Math.floor(remaining/60);
  const s=remaining%60;
  const progress=totalSec>0?remaining/totalSec:0;
  const R=80;const circ=2*Math.PI*R;const dashOff=circ*(1-progress);
  const atStart=remaining===totalSec&&!running&&!finished;

  return(
    <div className="fu">
      <H size="1.7rem" style={{marginBottom:"1.5rem"}}>⏱ Timer</H>

      <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:"2rem"}}>
        <div style={{position:"relative",width:200,height:200}}>
          <svg width="200" height="200" style={{transform:"rotate(-90deg)"}}>
            <circle cx="100" cy="100" r={R} fill="none" stroke="var(--bg3)" strokeWidth="9"/>
            <circle cx="100" cy="100" r={R} fill="none"
              stroke={finished?"var(--red)":running?"var(--amber)":"var(--muted2)"}
              strokeWidth="9" strokeDasharray={circ} strokeDashoffset={dashOff} strokeLinecap="round"
              style={{transition:running?"stroke-dashoffset 1s linear":"stroke-dashoffset .35s ease",filter:(running||finished)?`drop-shadow(0 0 8px ${finished?"var(--red)":"rgba(232,148,58,.7)"})`:"none"}}/>
          </svg>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <div className={finished?"qp-timer-warn":""} style={{fontFamily:"var(--font-h)",fontSize:finished?"2.8rem":"2.5rem",color:finished?"var(--red)":running?"var(--amber2)":"var(--cream)",lineHeight:1,letterSpacing:"-.02em"}}>
              {finished?"TIJD!": `${m}:${String(s).padStart(2,"0")}`}
            </div>
            {!finished&&<div style={{color:"var(--muted)",fontSize:".75rem",marginTop:5}}>
              {!atStart?`${Math.round((1-progress)*100)}% voorbij`:"klaar om te starten"}
            </div>}
          </div>
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:"1.8rem",flexWrap:"wrap"}}>
        {!running&&!finished&&remaining===totalSec&&<Btn onClick={start} variant="primary" size="lg" disabled={totalSec===0}>▶ Start</Btn>}
        {!running&&!finished&&remaining<totalSec&&<Btn onClick={start} variant="primary" size="lg">▶ Hervat</Btn>}
        {running&&<Btn onClick={pause} variant="subtle" size="lg">⏸ Pauze</Btn>}
        {finished&&<Btn onClick={applyPreset.bind(null,totalSec)} variant="primary" size="lg">▶ Opnieuw</Btn>}
        {(!atStart||finished)&&<Btn onClick={reset} variant="ghost" size="lg">↺ Reset</Btn>}
      </div>

      <Card style={{marginBottom:"1.2rem"}}>
        <H size="1rem" style={{marginBottom:".75rem"}}>Snelle instellingen</H>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          {TIMER_PRESETS.map(([sec,label])=>{
            const active=totalSec===sec;
            return(
              <button key={sec} onClick={()=>applyPreset(sec)}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber)";e.currentTarget.style.color="var(--amber2)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=active?"var(--amber)":"var(--border)";e.currentTarget.style.color=active?"var(--amber2)":"var(--cream)";}}
                style={{background:active?"rgba(232,148,58,.12)":"var(--bg3)",border:`1px solid ${active?"var(--amber)":"var(--border)"}`,borderRadius:8,color:active?"var(--amber2)":"var(--cream)",padding:"8px 16px",cursor:"pointer",fontSize:".87rem",fontFamily:"var(--font-b)",fontWeight:active?600:400,transition:"all .15s"}}>
                {label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <H size="1rem" style={{marginBottom:".75rem"}}>Eigen tijd</H>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <Inp value={cMin} onChange={e=>setCMin(e.target.value.replace(/\D/g,""))} style={{width:72,textAlign:"center"}} placeholder="min" onKeyDown={e=>{if(e.key==="Enter")applyCustom();}}/>
            <span style={{color:"var(--muted)",fontWeight:700}}>:</span>
            <Inp value={cSec} onChange={e=>setCsec(e.target.value.replace(/\D/g,""))} style={{width:72,textAlign:"center"}} placeholder="sec" onKeyDown={e=>{if(e.key==="Enter")applyCustom();}}/>
          </div>
          <Btn onClick={applyCustom} variant="subtle">Instellen</Btn>
        </div>
        <div style={{color:"var(--muted)",fontSize:".75rem",marginTop:6}}>Minuten : Seconden</div>
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App(){
  const [events,setEvents]=useState(SEED_EVENTS);
  const [users,setUsers]=useState(SEED_USERS);
  // Team library (docs/mensgames-spec.md §2.3): eager, tiny, lives at the
  // App root because it has non-lazy consumers (QuizDashboard/QuizBuilder,
  // TeamCreatorPage, HallOfFame's trophy cabinet) -- same reasoning as
  // `events`/`users` above, unlike mens-games' own lazy-loaded state.
  // (EventPage's own Teams tab used to be a fourth consumer; removed
  // 2026-08-26 -- Team Creator is the sole home for team sets now.)
  const [teamSets,setTeamSets]=useState([]);
  // Distinguishes "the library is genuinely empty" from "we couldn't reach
  // it" (fetchTeamSets now reports {ok,error,teamSets} instead of a bare
  // [] on failure -- teamlib/api.js). A short, fixed Dutch string when the
  // last read failed, null once a read succeeds again. Threaded down to
  // every read site (TeamCreatorPage's library, QuizBuilder's team picker,
  // EntrantPicker, HallOfFame's trophy cabinet) so none of them can show a
  // false "nothing here yet" for a read that actually failed.
  const [teamSetsError,setTeamSetsError]=useState(null);
  // Finished-quiz archive (docs/quiz-unification-spec.md §8.1/§8.3 item 9,
  // WP-Q8) -- eager, tiny, same reasoning as `teamSets` above:
  // `computeMemberStats`/`HallOfFame`/`WinnersTab` all need it and none of
  // them are behind the quiz's own lazy chunk. `fetchQuizResults()` never
  // rejects (features/quiz/results.js) -- a failed read just leaves this at
  // `[]`, same "degrade to legacy `evt.quizzes[]` data, don't block boot"
  // posture `teamSetsError` has for the team library. No dedicated error
  // banner: unlike the team library, nothing in this app is quiz-results-or-
  // nothing -- the legacy per-event data these three consumers already read
  // keeps working even if this fetch is down.
  const [quizResults,setQuizResults]=useState([]);
  // Finished-tournament archive -- exact mirror of `quizResults` above, for
  // `WinnersTab`'s tournament-AUTO-card (2026-08-26, part of the same tab
  // removal that dropped Mens-Games 🏆 from the event page). Same never-
  // reject contract as `fetchQuizResults` (`features/mensgames/
  // tournamentResults.js`): a failed read just leaves this at `[]`, and the
  // real award rows `finishTournament` already writes to `events.winners`
  // keep rendering regardless.
  const [tournamentResults,setTournamentResults]=useState([]);
  const [currentUser,setCurrentUser]=useState(null);
  const [authView,setAuthView]=useState("login");
  const [activeId,setActiveId]=useState(null);
  const [pageView,setPageView]=useState("home"); // home | event | hof | members | member | updates | teams | timer | quiz | mensgames
  const [showAdmin,setShowAdmin]=useState(false);
  const [newEvent,setNewEvent]=useState(false);
  const [loaded,setLoaded]=useState(false);
  // Set only if the boot `Promise.all` (below) genuinely *rejects* -- a hard
  // offline `fetch` throw, not a resolved `{error}` (those are handled per
  // read and never block `loaded`). Pre-existing gap: without this, a
  // rejection left `setLoaded(true)` uncalled forever and the app sat on
  // the loading screen with no feedback and no way out.
  const [bootError,setBootError]=useState(null);
  const [activeMemberId,setActiveMemberId]=useState(null);
  const [editingProfile,setEditingProfile]=useState(false);
  const [notifications,setNotifications]=useState([]);
  const [notifLastRead,setNotifLastRead]=useState(()=>localStorage.getItem("notif-read")||"");
  const [deletedNotifIds,setDeletedNotifIds]=useState(new Set());
  const [clearedBefore,setClearedBefore]=useState("");
  // Surfaced whenever a write this app treats as "must not silently lose
  // user work" (event create/update, the schedule editor's save) comes back
  // with a Supabase error -- see `updateEvent` below. A single global,
  // manually-dismissed banner rather than a per-field message: the write
  // that failed can originate from many different places deep in the tree
  // (any tab, any modal), so there's no one local spot to put it that's
  // guaranteed visible regardless of which one triggered it.
  const [writeError,setWriteError]=useState(null);
  useEffect(()=>{
    if(!currentUser)return;
    try{const s=JSON.parse(localStorage.getItem(`md-notifs-${currentUser.id}`)||"[]");setNotifications(s);}catch{/* ignore malformed localStorage JSON */}
    // Deliberately keyed on currentUser?.id, not the whole object: this should only
    // reload stored notifications when a *different* user logs in, not on every
    // profile-field refresh (bio/photo/role poll updates) which would otherwise
    // stomp on notification state that's since moved on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[currentUser?.id]);
  const [announcements,setAnnouncements]=useState(()=>{try{return JSON.parse(localStorage.getItem("md-announcements")||"[]");}catch{return[];}});
  const [saraJayUnlocked,setSaraJayUnlocked]=useState(()=>{try{return JSON.parse(localStorage.getItem("md-sj-unlocked")||"false");}catch{return false;}});
  // Mens-games admin on/off switch -- exact mirror of saraJayUnlocked above
  // (system row `__mens_games__` in `announcements`, no dedicated table/
  // migration). Defaults false: the tournaments/team_sets tables this
  // feature needs don't exist until the owner runs that migration, so a
  // fresh install must start locked.
  const [mensGamesUnlocked,setMensGamesUnlocked]=useState(()=>{try{return JSON.parse(localStorage.getItem("md-mg-unlocked")||"false");}catch{return false;}});
  // If mens-games gets locked while a lad is already sat on that page (admin
  // toggles it off in another tab, or the 30s poll above lands an "off" row
  // from elsewhere), bounce back home rather than leaving the lazy chunk
  // mounted -- "locked" has to mean the chunk never loads, not just that the
  // entry points into it are hidden.
  useEffect(()=>{
    if(!mensGamesUnlocked&&pageView==="mensgames")setPageView("home");
  },[mensGamesUnlocked,pageView]);
  const [showAnnounce,setShowAnnounce]=useState(false);
  const [editingAnn,setEditingAnn]=useState(null);
  // Login teaser (src/features/teaser/dismissed.js + `selectTeaserEvent`/
  // `TeaserModal` above): `teaserEvent` is the currently-shown teaser, or
  // null. `teaserEvalRef` makes the "show on every app entry" check fire
  // exactly once per entry -- not on every unrelated re-render, and not on
  // the 30s events poll re-running `selectTeaserEvent` against a fresh
  // array identity. Reset on `logout` below so a different lad logging in
  // on the same device/tab (or the same one logging back in) is a fresh
  // "entry" too, not silently skipped because this tab happened to show it
  // to someone else earlier.
  const [teaserEvent,setTeaserEvent]=useState(null);
  const teaserEvalRef=useRef(false);
  // Id of the event whose trailer the teaser's primary button should
  // auto-open, once `openEvent` has navigated there -- consumed (reset to
  // null) by EventPage the instant it acts on it, so it never re-fires.
  const [autoTrailerId,setAutoTrailerId]=useState(null);
  const eventsRef=useRef([]);
  useEffect(()=>{eventsRef.current=events;},[events]);
  const diffBaseRef=useRef([]);
  const currentUserRef=useRef(null);
  useEffect(()=>{currentUserRef.current=currentUser;},[currentUser]);

  const boot=()=>{
    setBootError(null);
    Promise.all([
      supabase.from("events").select("*").order("date"),
      supabase.from("users").select("*"),
      supabase.from("announcements").select("*").order("created_at",{ascending:false}),
      fetchTeamSets(),
      fetchQuizResults(),
      fetchTournamentResults(),
    ]).then(async([{data:evts},{data:usrs},{data:anns},teamSetsRes,quizResultsRes,tournamentResultsRes])=>{
      setTeamSets(teamSetsRes.ok?teamSetsRes.teamSets:[]);
      setTeamSetsError(teamSetsRes.ok?null:"Kon de teams-bibliotheek niet laden. Controleer je verbinding.");
      // Never blocks boot and has no dedicated error banner -- see this
      // state's own declaration above for why. `quizResultsRes` always
      // resolves ({ok,error,quizResults}, never a rejection), same contract
      // `fetchTeamSets` has.
      setQuizResults(quizResultsRes.ok?quizResultsRes.quizResults:[]);
      // Same never-reject contract, same "no dedicated error banner" call --
      // see `tournamentResults`' own declaration above.
      setTournamentResults(tournamentResultsRes.ok?tournamentResultsRes.tournamentResults:[]);
      const fromDbAnn=r=>({id:r.id,title:r.title,body:r.body||"",createdBy:r.created_by||r.createdBy||"",createdAt:r.created_at||r.createdAt||"",active:r.active!==false});
      if(anns&&anns.length){
        const sjRow=anns.find(r=>r.id==="__sara_jay__");
        if(sjRow){const v=sjRow.active!==false;setSaraJayUnlocked(v);localStorage.setItem("md-sj-unlocked",JSON.stringify(v));}
        const mgRow=anns.find(r=>r.id==="__mens_games__");
        if(mgRow){const v=mgRow.active!==false;setMensGamesUnlocked(v);localStorage.setItem("md-mg-unlocked",JSON.stringify(v));}
        const delRow=anns.find(r=>r.id==="__deleted_notifs__");
        if(delRow){try{const raw=JSON.parse(delRow.body||"null");if(raw){const ids=Array.isArray(raw)?raw:(raw.ids||[]);const cb=Array.isArray(raw)?"":( raw.cleared_before||"");setDeletedNotifIds(new Set(ids));if(cb)setClearedBefore(cb);}}catch{/* ignore malformed announcement JSON from Supabase */}}
        const SYSTEM_IDS=new Set(["__sara_jay__","__mens_games__","__deleted_notifs__"]);
        const mapped=anns.filter(r=>!SYSTEM_IDS.has(r.id)).map(fromDbAnn);
        setAnnouncements(mapped);localStorage.setItem("md-announcements",JSON.stringify(mapped));
      }
      // Seed DB on first run if empty
      let allEvents=evts?.length?evts:SEED_EVENTS;
      let allUsers=usrs?.length?usrs:[];
      if(!evts?.length){
        await supabase.from("events").insert(SEED_EVENTS);
      }
      if(!usrs?.length){
        const seeded=await Promise.all(SEED_USERS.map(async u=>({id:u.id,username:u.username,pin_hash:await hashPin(u.pin),role:u.role,joined_at:u.joined_at,avatar:u.avatar||0})));
        await supabase.from("users").insert(seeded);
        allUsers=seeded;
      }
      diffBaseRef.current=allEvents;
      setEvents(allEvents);
      setUsers(allUsers);
      const sessId=localStorage.getItem("md-session");
      if(sessId){const u=allUsers.find(u=>u.id===sessId);if(u)setCurrentUser(u);}
      setLoaded(true);
    }).catch(err=>{
      // A genuine rejection (hard offline `fetch` throw), not one of the
      // four calls' own resolved {error} -- those are handled per read
      // above and never reach here. Without this, `setLoaded(true)` never
      // fires and the app sits on the loading screen forever with no
      // feedback and no way to recover short of a hard refresh.
      console.error("App boot failed:",err);
      setBootError("Kon de app niet laden. Controleer je internetverbinding en probeer opnieuw.");
    });
  };

  // Manual retry for every teamSets read site's error state (TeamCreatorPage's
  // library, QuizBuilder's team picker, EntrantPicker, HallOfFame's trophy
  // cabinet) -- same body the 30s poll below uses, so a lad who hits
  // "Opnieuw proberen" doesn't have to wait out the interval.
  const reloadTeamSets=()=>{
    fetchTeamSets().then(res=>{
      if(res.ok){setTeamSets(res.teamSets);setTeamSetsError(null);}
      else setTeamSetsError("Kon de teams-bibliotheek niet laden. Controleer je verbinding.");
    });
  };

  // Same never-reject contract as `reloadTeamSets` -- a failed poll just
  // leaves the last-known `quizResults` in place rather than clearing it.
  const reloadQuizResults=()=>{
    fetchQuizResults().then(res=>{if(res.ok)setQuizResults(res.quizResults);});
  };

  // Exact mirror of `reloadQuizResults` above, for `tournamentResults`.
  const reloadTournamentResults=()=>{
    fetchTournamentResults().then(res=>{if(res.ok)setTournamentResults(res.tournamentResults);});
  };

  useEffect(()=>{
    boot();

    const poll=setInterval(()=>{
      reloadTeamSets();
      reloadQuizResults();
      reloadTournamentResults();
      supabase.from("announcements").select("*").order("created_at",{ascending:false}).then(({data})=>{if(data&&data.length){const fromDbAnn=r=>({id:r.id,title:r.title,body:r.body||"",createdBy:r.created_by||r.createdBy||"",createdAt:r.created_at||r.createdAt||"",active:r.active!==false});const sjRow=data.find(r=>r.id==="__sara_jay__");if(sjRow){const v=sjRow.active!==false;setSaraJayUnlocked(v);localStorage.setItem("md-sj-unlocked",JSON.stringify(v));}const mgRow=data.find(r=>r.id==="__mens_games__");if(mgRow){const v=mgRow.active!==false;setMensGamesUnlocked(v);localStorage.setItem("md-mg-unlocked",JSON.stringify(v));}const delRow=data.find(r=>r.id==="__deleted_notifs__");if(delRow){try{const raw=JSON.parse(delRow.body||"null");if(raw){const ids=new Set(Array.isArray(raw)?raw:(raw.ids||[]));const cb=Array.isArray(raw)?"": (raw.cleared_before||"");setDeletedNotifIds(ids);if(cb)setClearedBefore(cb);setNotifications(prev=>{const next=prev.filter(n=>!ids.has(n.id)&&(!cb||n.timestamp>cb));const cu=currentUserRef.current;if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));return next;});}}catch{/* ignore malformed announcement JSON from Supabase */}}const SYSTEM_IDS=new Set(["__sara_jay__","__mens_games__","__deleted_notifs__"]);const mapped=data.filter(r=>!SYSTEM_IDS.has(r.id)).map(fromDbAnn);setAnnouncements(mapped);localStorage.setItem("md-announcements",JSON.stringify(mapped));}});
      supabase.from("users").select("*").then(({data})=>{
        if(data){
          setUsers(data);
          const cu=currentUserRef.current;
          if(cu){
            const fresh=data.find(u=>u.id===cu.id);
            if(fresh){
              const changed=["role","display_name","photo_url","animal_avatar","bio","age"].some(k=>fresh[k]!==cu[k]);
              if(changed)setCurrentUser(fresh);
            }
          }
        }
      });
      supabase.from("events").select("*").order("date").then(({data})=>{
        if(data){
          const newActs=diffEvents(diffBaseRef.current,data);
          diffBaseRef.current=data;
          if(newActs.length){
            setNotifications(prev=>{
              const ids=new Set(prev.map(n=>n.id));
              const fresh=newActs.filter(n=>!ids.has(n.id));
              if(!fresh.length)return prev;
              const next=[...fresh,...prev].slice(0,100);
              const cu=currentUserRef.current;
              if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
              return next;
            });
          }
          setEvents(prev=>{
              const byId=new Map(data.map(e=>[e.id,e]));
              prev.forEach(e=>{if(!byId.has(e.id))byId.set(e.id,e);});
              return [...byId.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
            });
        }
      });
    },30000);

    // Real-time notification deletion broadcast
    const notifCtrl=supabase.channel("notif-ctrl")
      .on("broadcast",{event:"del-notif"},({payload})=>{
        if(!payload?.id)return;
        setDeletedNotifIds(s=>new Set([...s,payload.id]));
        setNotifications(prev=>{
          const next=prev.filter(n=>n.id!==payload.id);
          const cu=currentUserRef.current;
          if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
          return next;
        });
      })
      .on("broadcast",{event:"clear-notifs"},({payload})=>{
        const ids=new Set(payload?.ids||[]);
        const cb=payload?.cleared_before||"";
        setDeletedNotifIds(s=>new Set([...s,...ids]));
        if(cb)setClearedBefore(cb);
        setNotifications(prev=>{
          const next=prev.filter(n=>!ids.has(n.id)&&(!cb||n.timestamp>cb));
          const cu=currentUserRef.current;
          if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
          return next;
        });
      })
      .on("broadcast",{event:"push-notif"},({payload})=>{
        if(!payload?.notif)return;
        const n=payload.notif;
        setNotifications(prev=>{
          const ids=new Set(prev.map(x=>x.id));
          if(ids.has(n.id))return prev;
          const next=[n,...prev].slice(0,100);
          const cu=currentUserRef.current;
          if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
          return next;
        });
      })
      .subscribe();

    // Realtime notification generation for all event changes
    const evtNotifCh=supabase.channel("evt-notif-realtime")
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"events"},({new:updated})=>{
        if(!updated)return;
        const old=diffBaseRef.current.find(e=>e.id===updated.id);
        if(old){
          const acts=diffEvents([old],[updated]);
          if(acts.length){
            setNotifications(prev=>{
              const ids=new Set(prev.map(n=>n.id));
              const fresh=acts.filter(a=>!ids.has(a.id));
              if(!fresh.length)return prev;
              const next=[...fresh,...prev].slice(0,100);
              const cu=currentUserRef.current;
              if(cu)localStorage.setItem(`md-notifs-${cu.id}`,JSON.stringify(next));
              return next;
            });
          }
        }
        diffBaseRef.current=diffBaseRef.current.map(e=>e.id===updated.id?updated:e);
      })
      .subscribe();

    return()=>{clearInterval(poll);supabase.removeChannel(notifCtrl);supabase.removeChannel(evtNotifCh);};
  },[]);

  // Decide once per "app entry" (loaded + a resolved, active `currentUser`
  // -- covers both a fresh credential login AND the `md-session` resume
  // shortcut, deliberately not just the literal login flow, since sessions
  // persist and almost nobody would ever see it otherwise) whether the
  // login teaser should show. `ACTIVE_ROLES` check is redundant with the
  // `role==="pending"` early return below (this effect never runs before
  // that render happens, since `loaded`+`currentUser` are the same gate) --
  // kept explicit anyway per the spec's own call-out, and as a defensive
  // guard against any future role that isn't "pending" but also isn't meant
  // to be a full member.
  useEffect(()=>{
    if(teaserEvalRef.current)return;
    if(!loaded||!currentUser)return;
    if(!ACTIVE_ROLES.includes(currentUser.role))return;
    teaserEvalRef.current=true;
    const candidate=selectTeaserEvent(events);
    if(!candidate)return;
    if(hasDismissedTeaser(candidate.id)||hasSeenTrailer(candidate.id))return;
    setTeaserEvent(candidate);
  },[loaded,currentUser,events]);

  const deleteNotifForAll=async(notifId)=>{
    const newSet=new Set([...deletedNotifIds,notifId]);
    setDeletedNotifIds(newSet);
    setNotifications(prev=>{
      const next=prev.filter(n=>n.id!==notifId);
      if(currentUser)localStorage.setItem(`md-notifs-${currentUser.id}`,JSON.stringify(next));
      return next;
    });
    const body=JSON.stringify({ids:[...newSet],cleared_before:clearedBefore});
    await supabase.from("announcements").upsert({id:"__deleted_notifs__",title:"__deleted_notifs__",body,created_by:"system",created_at:new Date().toISOString(),active:false});
    supabase.channel("notif-ctrl").send({type:"broadcast",event:"del-notif",payload:{id:notifId}});
  };

  const sendNotifToAll=(notif)=>{
    const n={id:`manual-${Date.now()}`,timestamp:new Date().toISOString(),...notif};
    setNotifications(prev=>{
      const ids=new Set(prev.map(x=>x.id));
      if(ids.has(n.id))return prev;
      const next=[n,...prev].slice(0,100);
      if(currentUser)localStorage.setItem(`md-notifs-${currentUser.id}`,JSON.stringify(next));
      return next;
    });
    supabase.channel("notif-ctrl").send({type:"broadcast",event:"push-notif",payload:{notif:n}});
  };

  const saveUsers=async u=>{
    setUsers(u);
    await supabase.from("users").upsert(u);
  };
  const login=u=>{setCurrentUser(u);localStorage.setItem("md-session",u.id);};
  const logout=()=>{setCurrentUser(null);localStorage.removeItem("md-session");setActiveId(null);setPageView("home");teaserEvalRef.current=false;setTeaserEvent(null);};
  const register=async u=>{
    const {error}=await supabase.from("users").insert([u]);
    if(error){console.error("Register error:",error);return error.message||"Onbekende fout";}
    setUsers(prev=>[...prev,u]);
    return null;
  };
  const updateUsers=async u=>{await saveUsers(u);if(currentUser){const r=u.find(x=>x.id===currentUser.id);if(r)setCurrentUser(r);}};
  const deleteUser=async id=>{
    setUsers(u=>u.filter(x=>x.id!==id));
    await supabase.from("users").delete().eq("id",id);
  };
  // The one write path virtually every event mutation in this app funnels
  // through as `onUpdate` -- event edit, the schedule editor's save
  // (including its backdrop-click save), kretjes, polls, quizzes, teams,
  // photos, winners, FAQs, presentation-mode secret reveals. Applies
  // optimistically (as before), but now actually checks the write's result:
  // on a Supabase error, rolls the local state back to what it was before
  // this call (never leaves the UI showing a change that isn't really
  // saved) and surfaces `writeError` so it's impossible to miss.
  const updateEvent=async updated=>{
    if(typeof updated==="function"){
      let before=null,changed=null;
      setEvents(prev=>{
        before=prev.find(e=>e.id===activeId)||null;
        const next=prev.map(e=>e.id===activeId?updated(e):e);
        changed=next.find(e=>e.id===activeId)||null;
        return next;
      });
      if(!changed)return;
      const{error}=await supabase.from("events").upsert([changed]);
      if(error){
        console.error("Event update failed:",error);
        setEvents(prev=>prev.map(e=>e.id===activeId?(before??e):e));
        setWriteError("Save failed — your change wasn't saved. Please try again.");
        return;
      }
      setWriteError(null);
    } else {
      let before=null;
      setEvents(prev=>{
        before=prev.find(e=>e.id===updated.id)||null;
        return prev.map(e=>e.id===updated.id?updated:e);
      });
      const{error}=await supabase.from("events").upsert([updated]);
      if(error){
        console.error("Event update failed:",error);
        setEvents(prev=>prev.map(e=>e.id===updated.id?(before??e):e));
        setWriteError("Save failed — your change wasn't saved. Please try again.");
        return;
      }
      setWriteError(null);
    }
  };
  const deleteEvent=async id=>{
    setEvents(prev=>prev.filter(e=>e.id!==id));
    await supabase.from("events").delete().eq("id",id);
    goHome();
  };
  const saveAnnouncement=async ann=>{
    const full={...ann,active:ann.active!==false};
    setAnnouncements(prev=>{
      const next=prev.findIndex(a=>a.id===full.id)>=0?prev.map(a=>a.id===full.id?full:a):[full,...prev];
      localStorage.setItem("md-announcements",JSON.stringify(next));
      return next;
    });
    // Use snake_case for Supabase; omit 'active' so old schemas without the column still work
    const dbRow={id:full.id,title:full.title,body:full.body||"",created_by:full.createdBy,created_at:full.createdAt};
    await supabase.from("announcements").upsert([dbRow]);
    setShowAnnounce(false);setEditingAnn(null);
  };
  const archiveAnnouncement=async id=>{
    setAnnouncements(prev=>{
      const next=prev.map(a=>a.id===id?{...a,active:false}:a);
      localStorage.setItem("md-announcements",JSON.stringify(next));
      return next;
    });
    await supabase.from("announcements").update({active:false}).eq("id",id);
  };
  const reactivateAnnouncement=async id=>{
    setAnnouncements(prev=>{
      const next=prev.map(a=>a.id===id?{...a,active:true}:a);
      localStorage.setItem("md-announcements",JSON.stringify(next));
      return next;
    });
    await supabase.from("announcements").update({active:true}).eq("id",id);
  };
  const hardDeleteAnnouncement=async id=>{
    setAnnouncements(prev=>{
      const next=prev.filter(a=>a.id!==id);
      localStorage.setItem("md-announcements",JSON.stringify(next));
      return next;
    });
    await supabase.from("announcements").delete().eq("id",id);
  };
  const [notifNav,setNotifNav]=useState(null);
  const openEvent=(id,tab,targetId)=>{setActiveId(id);setNotifNav(tab?{tab,targetId:targetId||null}:null);setPageView("event");};
  const goHome=()=>{setPageView("home");setActiveId(null);setActiveMemberId(null);};
  const goBack=()=>{
    if(pageView==="member")setPageView("members");
    else goHome();
  };
  const openMember=id=>{setActiveMemberId(id);setPageView("member");};
  const openTeams=()=>setPageView("teams");
  const openTimer=()=>setPageView("timer");
  const openQuiz=()=>setPageView("quiz");
  // Locked means the lazy chunk never loads, not merely that the buttons
  // are hidden -- guards anyone with the URL or stale state (e.g. a tab
  // left open across an admin toggling it off) from slipping through.
  const openMensGames=()=>{if(mensGamesUnlocked)setPageView("mensgames");};
  const openSaraJay=()=>setPageView("sarajay");
  const toggleSaraJay=async()=>{
    const newVal=!saraJayUnlocked;
    setSaraJayUnlocked(newVal);
    localStorage.setItem("md-sj-unlocked",JSON.stringify(newVal));
    await supabase.from("announcements").upsert({id:"__sara_jay__",title:"__sara_jay__",body:"",created_by:"system",created_at:new Date().toISOString(),active:newVal});
  };
  const toggleMensGames=async()=>{
    const newVal=!mensGamesUnlocked;
    setMensGamesUnlocked(newVal);
    localStorage.setItem("md-mg-unlocked",JSON.stringify(newVal));
    await supabase.from("announcements").upsert({id:"__mens_games__",title:"__mens_games__",body:"",created_by:"system",created_at:new Date().toISOString(),active:newVal});
  };
  const saveProfile=async updates=>{
    const{error}=await supabase.from("users").update(updates).eq("id",currentUser.id);
    if(!error){
      const updated={...currentUser,...updates};
      setCurrentUser(updated);
      setUsers(prev=>prev.map(u=>u.id===currentUser.id?updated:u));
    }
  };
  // Primary button: navigate to that event's page (same destination the
  // page's own "🎬 Watch the trailer" button lives on) and flag its trailer
  // to auto-open there -- see EventPage's `autoOpenTrailerId` effect above.
  // Deliberately does NOT call `dismissTeaser` -- "watched" is earned by
  // actually finishing the video (`markTrailerSeen`, inside EventTrailer's
  // `onEnded`), not by merely tapping this button. Closing the overlay here
  // is enough either way: re-showing on the *next* app entry is gated on
  // hasDismissedTeaser/hasSeenTrailer, not on whether this modal is mounted.
  const teaserWatch=()=>{
    if(!teaserEvent)return;
    setAutoTrailerId(teaserEvent.id);
    openEvent(teaserEvent.id);
    setTeaserEvent(null);
  };
  // Secondary button: an explicit, deliberate choice (never the backdrop --
  // see TeaserModal's `onBackdropClose={()=>{}}`) -- never shows again for
  // this event on this device.
  const teaserSkip=()=>{
    if(teaserEvent)dismissTeaser(teaserEvent.id);
    setTeaserEvent(null);
  };
  const activeEvent=events.find(e=>e.id===activeId);
  const activeMember=users.find(u=>u.id===activeMemberId);

  // Live-quiz discovery + the app-wide banner/overlay (docs/
  // quiz-unification-spec.md §4.5, §8.3 items 9-11, §14 decision 2 default:
  // "a dismissible app-wide banner, auto-opening only on the linked event
  // page"). Hoisted here from `EventPage` (which used to own an identical,
  // per-event-only version) because a live quiz now has to be able to reach
  // someone who isn't sat on that event's page at all -- a standalone quiz
  // has no event page to be on. `useLiveQuizWatch` is eager (imported at the
  // top of this file, not part of the quiz's lazy chunk) for exactly that
  // reason: discovery has to run for a lad who never opens the quiz feature.
  const {liveQuizzes}=useLiveQuizWatch();
  // Prefers a live quiz linked to whatever event the lad is currently on
  // (matches the old per-`EventPage` resolution exactly, so being on that
  // event's page is never second-guessed by an unrelated quiz going live
  // elsewhere) and only falls back to "any live quiz, anywhere" for the
  // app-wide discovery banner when that's not the case.
  const liveHere=(activeEvent&&liveQuizzes.find(q=>q.eventId===activeEvent.id))||liveQuizzes[0]||null;
  const liveHereId=liveHere?liveHere.id:null;
  // From `quiz_live.event_id` (via `liveQuizzes`), not the quiz *definition*
  // object resolved below -- a quiz still living only in `evt.quizzes[]`
  // (the "unmigrated"/legacy case) doesn't necessarily carry its own
  // `eventId` field at all, since it's the surrounding event that nests it,
  // not the object itself. The live row is always the authority on which
  // event a live quiz belongs to.
  const liveHereEventId=liveHere?liveHere.eventId:null;
  // The definition resolves locally first -- scanning every event's
  // `evt.quizzes[]` (not just the active one, since the banner can appear
  // on any page) means the 33 kB of rounds is already in hand for any quiz
  // still going through the legacy dual write, and refetching it would be
  // the exact waste this refactor exists to remove. The fetch below is the
  // fallback for a quiz that lives only as a `quizzes` row -- what a
  // standalone quiz always is, and what an event-linked one becomes once
  // its `events.quizzes[]` copy is gone (§10.4, a release away).
  const localLiveQuiz=liveHereId?(events.flatMap(e=>e.quizzes||[]).find(q=>q.id===liveHereId)||null):null;
  const [fetchedLiveQuiz,setFetchedLiveQuiz]=useState(null);
  const needsLiveQuizFetch=!!liveHereId&&!localLiveQuiz;
  useEffect(()=>{
    if(!needsLiveQuizFetch){setFetchedLiveQuiz(null);return;}
    let alive=true;
    fetchQuiz(liveHereId).then(res=>{if(alive&&res.ok)setFetchedLiveQuiz(res.quiz);});
    return()=>{alive=false;};
  },[needsLiveQuizFetch,liveHereId]);
  const liveQuiz=localLiveQuiz||(fetchedLiveQuiz&&fetchedLiveQuiz.id===liveHereId?fetchedLiveQuiz:null);
  const liveQuizId=liveQuiz?liveQuiz.id:null;
  // Per-live-quiz, not global: dismissing (or joining) one quiz's banner/
  // overlay must not silently carry over to the next one that goes live.
  const [quizDismissed,setQuizDismissed]=useState(false);
  const [quizJoined,setQuizJoined]=useState(false);
  useEffect(()=>{setQuizDismissed(false);setQuizJoined(false);},[liveQuizId]);
  // "auto-opens only on the linked event page" -- today's exact EventPage
  // behaviour, reproduced here instead of regressed: someone already on the
  // event a quiz is running for still just sees it, no extra tap. Anyone
  // else gets the banner and has to choose to join.
  const onLiveQuizEventPage=pageView==="event"&&!!activeEvent&&!!liveQuiz&&activeEvent.id===liveHereEventId;
  const quizOverlayOpen=!!liveQuiz&&!quizDismissed&&(onLiveQuizEventPage||quizJoined);
  const showQuizBanner=!!liveQuiz&&!quizOverlayOpen;

  if(!loaded){
    // `bootError` only ever gets set by the boot Promise.all's `.catch` --
    // a genuine rejection, not one of its four calls' own resolved
    // {error} (each of those degrades gracefully on its own and still lets
    // `loaded` flip true). Without this branch a hard-offline boot left the
    // lad staring at "Loading…" forever with nothing to do about it.
    if(bootError)return(
      <div role="alert" style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,height:"100vh",padding:"2rem",textAlign:"center",color:"var(--cream)",fontFamily:"'DM Sans',sans-serif",background:"var(--bg)"}}>
        <GS/>
        <span aria-hidden="true" style={{fontSize:"2rem"}}>⚠️</span>
        <div style={{fontSize:".95rem",maxWidth:360,lineHeight:1.5}}>{bootError}</div>
        <Btn onClick={boot}>Opnieuw proberen</Btn>
      </div>
    );
    return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",color:"var(--muted)",fontFamily:"'DM Sans',sans-serif",background:"var(--bg)"}}><GS/>Loading…</div>;
  }
  if(!currentUser){
    if(authView==="register")return<RegisterScreen users={users} onRegister={register} onGoLogin={()=>setAuthView("login")}/>;
    return<LoginScreen users={users} onLogin={login} onGoRegister={()=>setAuthView("register")}/>;
  }
  if(currentUser.role==="pending")return<PendingScreen user={currentUser} onLogout={logout}/>;

  return(
    <div style={{minHeight:"100vh",background:"var(--bg)"}}>
      <GS/>
      {/* Write-failure banner: a hard-to-miss, manually-dismissed alert for
          any event write this app treats as "must not silently lose user
          work" (see `updateEvent`/NewEventModal's onSave). `top:58` (not 0)
          deliberately sits it flush below Nav's fixed bar instead of on top
          of it -- Nav is 58px tall and the banner is taller, so top:0 used
          to blank out the logo/Lads/Hall of Fame/Teams/Mens-Games/
          notifications/logout for as long as the banner was up, trapping
          whoever hit the failed save with no way to navigate away. z-index
          stays above every other overlay (Nav is 200, PresentationMode --
          untouched here -- is the highest normal overlay at 1000) so it's
          still visible no matter which modal was open when the write
          failed; it just no longer competes with Nav for the same strip of
          screen. */}
      {writeError&&(
        <div role="alert" aria-live="assertive" style={{position:"fixed",top:58,left:0,right:0,zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",gap:12,flexWrap:"wrap",background:"linear-gradient(90deg,rgba(45,10,10,.97),rgba(64,14,14,.97))",borderBottom:"1px solid rgba(224,85,85,.55)",padding:".7rem 1.4rem",backdropFilter:"blur(12px)"}}>
          <span aria-hidden="true" style={{fontSize:"1rem"}}>⚠️</span>
          <span style={{color:"#fff",fontSize:".85rem",fontWeight:600}}>{writeError}</span>
          <button onClick={()=>setWriteError(null)} style={{background:"rgba(255,255,255,.14)",border:"1px solid rgba(255,255,255,.3)",borderRadius:8,color:"#fff",padding:"6px 14px",cursor:"pointer",fontSize:".75rem",fontWeight:700,fontFamily:"var(--font-b)",minHeight:44,display:"flex",alignItems:"center"}}>Dismiss</button>
        </div>
      )}
      <Nav view={pageView} eventName={pageView==="member"?(activeMember?.display_name||activeMember?.username||"Lid"):activeEvent?.name} onBack={goBack} currentUser={currentUser} onLogout={logout} onAdmin={()=>setShowAdmin(true)} onAnnounce={()=>setShowAnnounce(true)} onHof={()=>setPageView("hof")} onHome={goHome} onMembers={()=>setPageView("members")} pendingCount={users.filter(u=>u.role==="pending").length} notifications={notifications} notifLastRead={notifLastRead} onUpdates={()=>setPageView("updates")} onProfile={()=>openMember(currentUser.id)} onTeams={openTeams} onTimer={openTimer} onQuiz={openQuiz} onMensGames={openMensGames} mensGamesUnlocked={mensGamesUnlocked} onSaraJay={openSaraJay} saraJayUnlocked={saraJayUnlocked}/>
      <main style={{maxWidth:880,margin:"0 auto",padding:"78px 1.2rem 4rem"}}>
        <AnnouncementBanner announcements={announcements} currentUser={currentUser} onArchive={archiveAnnouncement} onHardDelete={hardDeleteAnnouncement} onReactivate={reactivateAnnouncement} onEdit={ann=>{setEditingAnn(ann);setShowAnnounce(true);}} onNew={()=>{setEditingAnn(null);setShowAnnounce(true);}}/>
        {pageView==="home"&&<Home events={events} onOpen={openEvent} onNew={()=>setNewEvent(true)} currentUser={currentUser} users={users} onTeams={openTeams} onTimer={openTimer} onQuiz={openQuiz} onMensGames={openMensGames} mensGamesUnlocked={mensGamesUnlocked} onSaraJay={openSaraJay} saraJayUnlocked={saraJayUnlocked}/>}
        {pageView==="hof"&&<HallOfFame events={events} users={users} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={reloadTeamSets} quizResults={quizResults}/>}
        {pageView==="members"&&<MembersPage users={users} events={events} onOpenMember={openMember} currentUser={currentUser} quizResults={quizResults}/>}
        {pageView==="member"&&activeMember&&<MemberProfile user={activeMember} events={events} currentUser={currentUser} onEdit={()=>setEditingProfile(true)} quizResults={quizResults}/>}
        {pageView==="event"&&activeEvent&&<EventPage key={activeId+(notifNav?.tab||"")} evt={activeEvent} onUpdate={updateEvent} onSyncEvt={data=>setEvents(prev=>prev.map(e=>e.id===data.id?data:e))} onDelete={()=>deleteEvent(activeId)} currentUser={currentUser} users={users} events={events} initialTab={notifNav?.tab} scrollToId={notifNav?.targetId} onSendNotif={sendNotifToAll} autoOpenTrailerId={autoTrailerId} onAutoTrailerConsumed={()=>setAutoTrailerId(null)} quizResults={quizResults} tournamentResults={tournamentResults}/>}
        {pageView==="updates"&&<UpdatesPage notifications={notifications.filter(n=>!deletedNotifIds.has(n.id)&&(!clearedBefore||n.timestamp>clearedBefore))} notifLastRead={notifLastRead} currentUser={currentUser} onMarkAllRead={()=>{const t=new Date().toISOString();setNotifLastRead(t);localStorage.setItem("notif-read",t);}} onOpenEvent={openEvent} onClearSelf={()=>{setNotifications([]);if(currentUser)localStorage.removeItem(`md-notifs-${currentUser.id}`);}} onDeleteSelf={id=>{setNotifications(prev=>{const next=prev.filter(n=>n.id!==id);if(currentUser)localStorage.setItem(`md-notifs-${currentUser.id}`,JSON.stringify(next));return next;});}} onClearUpdates={async()=>{const cb=new Date().toISOString();const allIds=[...new Set([...deletedNotifIds,...notifications.map(n=>n.id)])];const newSet=new Set(allIds);setDeletedNotifIds(newSet);setClearedBefore(cb);setNotifications([]);if(currentUser)localStorage.removeItem(`md-notifs-${currentUser.id}`);const body=JSON.stringify({ids:allIds,cleared_before:cb});await supabase.from("announcements").upsert({id:"__deleted_notifs__",title:"__deleted_notifs__",body,created_by:"system",created_at:new Date().toISOString(),active:false});supabase.channel("notif-ctrl").send({type:"broadcast",event:"clear-notifs",payload:{ids:allIds,cleared_before:cb}});}} onDeleteNotif={deleteNotifForAll}/>}
        {pageView==="teams"&&<TeamCreatorPage users={users} events={events} currentUser={currentUser} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={reloadTeamSets} onTeamSetsChanged={setTeamSets}/>}
        {pageView==="timer"&&<TimerPage/>}
        {pageView==="quiz"&&<Suspense fallback={<div style={{padding:"3rem 0",textAlign:"center",color:"var(--muted)",fontSize:".85rem"}}>Laden…</div>}><QuizPage events={events} users={users} currentUser={currentUser} can={can} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={reloadTeamSets} onUpdateEvent={updateEvent} onSendNotif={sendNotifToAll}/></Suspense>}
        {pageView==="mensgames"&&mensGamesUnlocked&&<Suspense fallback={<div style={{padding:"3rem 0",textAlign:"center",color:"var(--muted)",fontSize:".85rem"}}>Laden…</div>}><MensGamesPage events={events} teamSets={teamSets} teamSetsError={teamSetsError} onRetryTeamSets={reloadTeamSets} currentUser={currentUser} canManage={can.runTournament(currentUser)} onUpdateEvent={updateEvent} onTeamSetsChanged={setTeamSets} onSendNotif={sendNotifToAll}/></Suspense>}
        {pageView==="sarajay"&&<SaraJayOrJAI/>}
      </main>
      <div style={{textAlign:"center",padding:"1.5rem",color:"var(--muted2)",fontSize:".72rem",borderTop:"1px solid var(--border)",letterSpacing:".1em"}}>🍺 MensApp · Built for the lads</div>
      {showAdmin&&<AdminPanel users={users} onUpdateUsers={updateUsers} onDeleteUser={deleteUser} onClose={()=>setShowAdmin(false)} saraJayUnlocked={saraJayUnlocked} onToggleSaraJay={toggleSaraJay} mensGamesUnlocked={mensGamesUnlocked} onToggleMensGames={toggleMensGames}/>}
      {showAnnounce&&can.announce(currentUser)&&<AnnouncementModal onSave={saveAnnouncement} onClose={()=>{setShowAnnounce(false);setEditingAnn(null);}} existing={editingAnn} currentUser={currentUser}/>}
      {newEvent&&can.editEvent(currentUser)&&<NewEventModal users={users} onSave={async evt=>{
        // Unlike updateEvent's optimistic-then-rollback pattern, a brand
        // new event has no "before" state to roll back TO -- so this waits
        // for the write to actually succeed before touching local state or
        // navigating away, rather than showing (and then un-showing) a
        // phantom event. On failure the modal stays open with the form's
        // data intact so the lad doesn't have to redo it.
        const{error}=await supabase.from("events").upsert([evt]);
        if(error){
          console.error("Event create failed:",error);
          setWriteError("Could not create the event — nothing was saved. Please try again.");
          return;
        }
        setWriteError(null);
        setEvents(prev=>[...prev,evt]);
        setNewEvent(false);
        openEvent(evt.id);
      }} onClose={()=>setNewEvent(false)}/>}
      {editingProfile&&<EditProfileModal user={currentUser} onSave={async u=>{await saveProfile(u);setEditingProfile(false);}} onClose={()=>setEditingProfile(false)}/>}
      {teaserEvent&&<TeaserModal evt={teaserEvent} onWatch={teaserWatch} onSkip={teaserSkip}/>}

      {/* App-wide live-quiz banner (docs/quiz-unification-spec.md §14
          decision 2 default) -- reaches a lad who isn't on the linked
          event's page at all (or a standalone quiz, which has no event page
          to be on). Shown whenever the overlay below isn't already up: that
          covers both today's exact "▶ Rejoin" case (closed the overlay
          after joining) and the new discovery case (never joined, and not
          on the linked event's page), which is why the label switches on
          `quizDismissed` -- "join" and "rejoin" are the same action here. */}
      {showQuizBanner&&(
        <div className="ann-banner" style={{position:"fixed",top:0,left:0,right:0,zIndex:999,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:"linear-gradient(90deg,rgba(15,10,2,.97),rgba(30,18,4,.97))",borderBottom:"1px solid rgba(232,148,58,.45)",padding:".7rem 1.4rem",backdropFilter:"blur(12px)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"var(--red)",flexShrink:0,animation:"pulse 1s ease-in-out infinite",display:"inline-block"}}/>
            <div>
              <div style={{fontWeight:700,color:"var(--amber2)",fontSize:".88rem"}}>🔴 Quiz bezig — meedoen</div>
              <div style={{fontSize:".73rem",color:"var(--muted)"}}>{liveQuiz.title||"Een quiz"} is nu bezig{liveHereEventId&&events.find(e=>e.id===liveHereEventId)?` · ${events.find(e=>e.id===liveHereEventId).name}`:""}</div>
            </div>
          </div>
          <Btn onClick={()=>{setQuizDismissed(false);setQuizJoined(true);}} variant="primary" size="sm">{quizDismissed?"▶ Rejoin":"▶ Meedoen"}</Btn>
        </div>
      )}
      {/* Live quiz participant view -- app-wide now (moved from `EventPage`,
          §8.3 items 9-11): auto-opens only while on the linked event's page
          (`onLiveQuizEventPage`, computed above), reproducing today's exact
          behaviour there; everywhere else it opens only once the banner's
          been tapped. */}
      {quizOverlayOpen&&<Suspense fallback={null}><QuizParticipantView liveQ={liveQuiz} currentUser={currentUser} users={users} can={can} onHide={()=>setQuizDismissed(true)}/></Suspense>}
    </div>
  );
}
