// One static <style> block for the mens-games feature -- same idiom as
// App.jsx's `GS` block and the trailer's `TrailerStyles.jsx` (§5.1 of
// docs/mensgames-spec.md: "own its own Kit" also means owning its own CSS,
// not reaching back into App.jsx's <style>).
//
// Reuses the SAME global CSS custom properties (--bg, --amber, --cream,
// etc.) `GS` already injects at the App root -- so this is visually
// identical to the rest of the app "by construction", per §5.1 -- but
// defines its own keyframes/classes rather than assuming any of App.jsx's
// (`.fu`, `.pop`, `pulse`, ...) will keep existing under those exact names.
//
// SECURITY: this template literal contains NO interpolation of any kind --
// a fully static string. Every value that varies (team names, round names,
// scores, quiz-derived names) is applied by the consuming components as
// plain React children / attribute values on individual DOM nodes, never by
// building this string dynamically. No `dangerouslySetInnerHTML` anywhere
// in this feature (docs/mensgames-spec.md §7).
//
// Every animated rule only touches `transform`/`opacity`/`box-shadow`, and
// every animation here is gated `@media (prefers-reduced-motion: no-preference)`
// -- WCAG 2.2 hard gate, motion off by default for anyone who's asked for it.
export default function MensGamesStyles() {
  return (
    <style>{`
      .mg-root{color:var(--cream);font-family:var(--font-b)}
      .mg-root *{box-sizing:border-box}
      .mg-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

      /* ── Focus ring: ≥3:1 contrast against --bg2/--bg3, visible on every
         interactive element in this feature (buttons, steppers, selects,
         tabs) -- WCAG 2.2 hard gate. Never suppressed. ─────────────────── */
      .mg-root button:focus-visible,
      .mg-root [tabindex]:focus-visible,
      .mg-root select:focus-visible,
      .mg-root input:focus-visible,
      .mg-root a:focus-visible{
        outline:3px solid var(--amber2);outline-offset:2px;border-radius:6px;
      }

      /* ── Stepper: the primary score-entry control (docs/mensgames-spec.md
         §11 risk 7 -- "scored at a bar, on a phone, one-handed"). Buttons are
         48px square (clears the 44px primary-touch-target minimum with room
         for a fat thumb), the value between them is huge and legible across
         a table. ────────────────────────────────────────────────────────── */
      .mg-stepper{display:inline-flex;align-items:center;gap:10px}
      .mg-stepper-btn{
        width:48px;height:48px;flex-shrink:0;border-radius:12px;
        background:var(--bg3);border:1px solid var(--border);color:var(--cream);
        font-size:1.5rem;font-weight:700;line-height:1;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        font-family:var(--font-b);transition:background .15s,border-color .15s,transform .1s;
        -webkit-tap-highlight-color:transparent;touch-action:manipulation;
      }
      .mg-stepper-btn:hover:not(:disabled){background:rgba(232,148,58,.14);border-color:var(--border2);color:var(--amber2)}
      .mg-stepper-btn:active:not(:disabled){transform:scale(.93)}
      .mg-stepper-btn:disabled{opacity:.35;cursor:not-allowed}
      .mg-stepper-val{
        min-width:56px;text-align:center;font-family:var(--font-h);font-size:1.9rem;
        color:var(--amber2);line-height:1;font-variant-numeric:tabular-nums;
      }

      /* ── Live pulse dot -- a round/tournament that's currently live. Off
         entirely under reduced motion; the amber colour + "Live" text label
         (always rendered alongside, never colour-only) carry the meaning. ── */
      .mg-live-dot{width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;flex-shrink:0}
      @media (prefers-reduced-motion: no-preference){
        @keyframes mg-pulse{0%,100%{opacity:1}50%{opacity:.45}}
        .mg-live-dot{animation:mg-pulse 1.2s ease-in-out infinite}
      }

      @media (prefers-reduced-motion: no-preference){
        @keyframes mg-fade-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .mg-fu{animation:mg-fade-up .3s ease both}
      }

      /* ── Round card / list row hover + active states -- pointer-only, so
         nothing shifts under a touch tap (which fires hover on some mobile
         browsers and would otherwise cause a jarring flash). ─────────────── */
      @media (hover:hover){
        .mg-card-hover:hover{border-color:var(--border2);background:var(--bg4)}
      }
      .mg-card-hover{transition:border-color .15s,background .15s}

      /* ── Winning side highlight in a match row -- colour + a ✓ glyph
         together, never colour alone (WCAG 1.4.1). ─────────────────────── */
      .mg-side-win{border-color:rgba(76,175,125,.55)!important;background:rgba(76,175,125,.08)!important}

      /* ── Scoreboard (cast-to-a-room) mode: big, high-contrast, minimal
         chrome. Type scales up sharply from the normal editor UI. ───────── */
      .mg-scoreboard{background:var(--bg);min-height:100%}
      .mg-scoreboard-rank{font-family:var(--font-h);font-size:2.4rem;color:var(--amber);line-height:1;font-variant-numeric:tabular-nums}
      .mg-scoreboard-name{font-family:var(--font-h);font-size:1.5rem;color:var(--cream);line-height:1.15}
      .mg-scoreboard-pts{font-family:var(--font-h);font-size:2.1rem;color:var(--amber2);line-height:1;font-variant-numeric:tabular-nums}

      /* ── Tab strip (mirrors App.jsx's EventPage tab styling, standalone
         copy per §5.1) for the page-level "draft/live/finished" filter. ──── */
      .mg-subtab{background:none;border:none;cursor:pointer;padding:8px 14px;white-space:nowrap;font-family:var(--font-b);font-size:.83rem;transition:color .15s,background .15s;border-radius:8px 8px 0 0;min-height:44px}

      .mg-skeleton{background:linear-gradient(90deg,var(--bg3) 25%,var(--bg4) 50%,var(--bg3) 75%);border-radius:8px}
      @media (prefers-reduced-motion: no-preference){
        @keyframes mg-shimmer{0%{background-position:-500px 0}100%{background-position:500px 0}}
        .mg-skeleton{background-size:500px 100%;animation:mg-shimmer 1.4s infinite}
      }
    `}</style>
  );
}
