// One static <style> block of classes for the event trailer, same idiom as
// the `GS` block at the top of App.jsx (technical spec §3 file layout).
// Rendered once by EventTrailer.jsx.
//
// Pruned 2026-08-21 (owner direction change: a real, owner-produced video
// replaces the generated beat sequence -- see docs/trailer-technical-spec.md
// and docs/trailer-creative-spec.md, both now largely superseded by the
// trailer report). Everything that only ever served the beat engine --
// Ken Burns, the hard-cut wipe bar, ember drift, per-letter wordmark
// ignition, the Stories-style segmented progress bar, tap zones, the
// separate tap-to-start poster screen, the secret-tease lock glyph, day/
// location/theme chips -- is gone along with the engine. What's left: the
// fullscreen shell, the video player wrapper, the end-card layout (kept:
// the avatar stamp-in, `.tr-slam` for a little punch on the headline/count),
// and focus/reduced-motion handling.
//
// SECURITY (technical spec §11, unchanged): this template literal contains
// NO interpolation of event data -- a fully static string, full stop. Every
// value that legitimately varies per event is applied by the *consuming
// components* via inline `style`/CSS custom properties on individual DOM
// nodes -- never by building this string dynamically.
//
// Performance budget (technical spec §5.3, unchanged in spirit): the
// remaining animations here (`tr-slam`, `tr-stamp`, `tr-fade`) animate only
// `transform`/`opacity`. No `backdrop-filter` on anything that animates.
export default function TrailerStyles() {
  return (
    <style>{`
      .tr-root{position:fixed;inset:0;z-index:1100;background:var(--bg);color:var(--cream);font-family:var(--font-b);overflow:hidden;-webkit-tap-highlight-color:transparent}
      .tr-root *{box-sizing:border-box}
      .tr-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

      /* ── Video player ─────────────────────────────────────────────────── */
      .tr-video-wrap{position:absolute;inset:0;background:#000;display:flex;align-items:center;justify-content:center}
      .tr-video-wrap video{width:100%;height:100%;object-fit:contain;display:block;background:#000}

      /* ── Manual-play fallback (autoplay refused post-countdown): a big,
         obvious, centred button -- never a muted-autoplay workaround. Sits
         over the video but doesn't cover it edge-to-edge, so native
         controls stay reachable around it. ───────────────────────────────  */
      .tr-playfallback-wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:45}
      .tr-playfallback{pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:128px;height:128px;border-radius:50%;border:3px solid var(--amber);background:rgba(20,14,4,.78);color:var(--amber2);font-family:var(--font-b);font-weight:700;font-size:.78rem;letter-spacing:.04em;cursor:pointer;box-shadow:0 0 44px rgba(232,148,58,.4)}
      .tr-playfallback-icon{font-size:2.2rem;line-height:1}
      .tr-playfallback:hover{filter:brightness(1.1)}

      /* ── Countdown (2026-08-21b: 3-2-1 then autoplay, replacing
         tap-to-start) -- full-bleed, skippable overlay over the (already
         unlocking) video underneath. ───────────────────────────────────── */
      .tr-countdown{position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:transparent;border:none;padding:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
      .tr-countdown-bg{position:absolute;inset:0;background:radial-gradient(ellipse 70% 60% at 50% 40%,rgba(232,148,58,.28),transparent 62%),linear-gradient(160deg,var(--bg4),var(--bg2) 55%,var(--bg))}
      .tr-countdown-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:1rem;padding:1.4rem;text-align:center}
      .tr-countdown-num{font-family:var(--font-h);font-style:italic;font-weight:900;line-height:.9;font-size:clamp(6rem,32vw,11rem);background:linear-gradient(135deg,var(--gold),var(--amber2));-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 2px 60px rgba(232,148,58,.45)}
      .tr-countdown-hint{font-family:var(--font-b);font-weight:600;font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55)}

      /* ── End card: background texture (no photography here -- a plain
         gradient, so it gets the "cinema, not app-screen" texture layer to
         still feel like part of the trailer, not a bare settings screen) ── */
      .tr-endcard-bg{position:absolute;inset:0;background:radial-gradient(ellipse 70% 60% at 30% 20%,rgba(232,148,58,.28),transparent 60%),linear-gradient(160deg,var(--bg4),var(--bg2) 55%,var(--bg))}
      .tr-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 78% 70% at 50% 50%,transparent 52%,rgba(0,0,0,.55) 100%)}
      .tr-grain{position:absolute;inset:0;pointer-events:none;opacity:.045;mix-blend-mode:overlay;background-image:radial-gradient(rgba(255,255,255,.9) 1px,transparent 1.4px);background-size:3px 3px}

      .tr-endcard{position:absolute;inset:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
      .tr-endcard-inner{position:relative;z-index:1;min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.9rem;padding:calc(3.6rem + env(safe-area-inset-top,0px)) 1.4rem 3rem;text-align:center}
      @media(min-width:768px){.tr-endcard-inner{padding:5rem 2rem 3.5rem}}

      .tr-error-banner{display:flex;align-items:center;gap:8px;background:rgba(224,85,85,.12);border:1px solid rgba(224,85,85,.35);border-radius:var(--radius-sm);padding:10px 16px;color:#ffb3b3;font-size:.82rem;max-width:520px}

      /* ── Type ─────────────────────────────────────────────────────────── */
      .tr-slam{animation:tr-slam .42s cubic-bezier(.16,1,.3,1) both}
      @keyframes tr-slam{0%{opacity:0;transform:scale(1.15) translateY(10px)}100%{opacity:1;transform:scale(1) translateY(0)}}
      .tr-fade{animation:tr-fade .3s ease both}
      @keyframes tr-fade{from{opacity:0}to{opacity:1}}

      .tr-wordmark{font-family:var(--font-h);font-style:italic;font-weight:900;text-transform:uppercase;color:var(--amber2);line-height:.92;letter-spacing:-.02em;text-shadow:0 2px 40px rgba(232,148,58,.35),0 2px 30px rgba(0,0,0,.6);font-size:clamp(3.2rem,14vw,7rem)}
      .tr-wordmark-settled{font-size:clamp(2rem,8vw,3.6rem)}
      .tr-title{font-family:var(--font-h);font-weight:900;text-transform:uppercase;line-height:1.03;color:#fff;text-shadow:0 2px 30px rgba(0,0,0,.6);font-size:clamp(2rem,8vw,4.2rem)}
      .tr-kicker{font-family:var(--font-b);font-weight:700;font-size:.76rem;letter-spacing:.24em;text-transform:uppercase;color:var(--amber)}
      .tr-note{font-family:var(--font-b);font-weight:400;font-style:italic;font-size:.92rem;color:rgba(255,255,255,.72);line-height:1.6}
      .tr-name{font-family:var(--font-h);font-weight:700;font-size:1.12rem;color:#fff}

      /* ── Kretjes callout ──────────────────────────────────────────────── */
      .tr-kretjes{display:flex;flex-direction:column;align-items:center;gap:.5rem;max-width:440px}
      /* A real headline (2026-08-21c, Dom: "too small... it's a headline,
         not a caption") -- same italic Playfair/amber language as the
         wordmark, deliberately close to .tr-wordmark-settled's scale so
         it reads as this screen's second hero moment, not a label sitting
         above the number. NOTE: no backticks in this comment block -- this
         whole style sheet is itself one JS template literal (see the
         module docblock's SECURITY note); a literal backtick here would
         close it early and start interpreting the rest as JS. */
      .tr-kretjes-title{font-family:var(--font-h);font-weight:900;font-style:italic;text-transform:uppercase;line-height:.98;letter-spacing:-.01em;color:var(--amber2);text-shadow:0 2px 40px rgba(232,148,58,.4),0 2px 30px rgba(0,0,0,.6);font-size:clamp(2.2rem,9vw,4rem)}
      .tr-kretjes-count{font-family:var(--font-h);font-weight:900;font-size:clamp(3.4rem,13vw,5.6rem);line-height:1;color:var(--amber2);text-shadow:0 2px 30px rgba(232,148,58,.35)}
      .tr-kretjes-copy{font-size:.92rem;line-height:1.65;color:rgba(255,255,255,.82)}

      /* ── Avatar stamp-in (roster) ────────────────────────────────────── */
      .tr-stamp{animation:tr-stamp .32s cubic-bezier(.34,1.56,.64,1) both}
      @keyframes tr-stamp{0%{opacity:0;transform:scale(.6) rotate(-6deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
      .tr-avatar{border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.18);background:linear-gradient(135deg,var(--gold),var(--amber))}
      .tr-avatar img{width:100%;height:100%;object-fit:cover;display:block}
      .tr-avatar-mono{font-family:var(--font-h);font-weight:900;color:#1a1008}

      .tr-roster-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:1.1rem 1rem;width:100%;max-width:760px}
      .tr-roster-person{display:flex;flex-direction:column;align-items:center;gap:.5rem;text-align:center}
      .tr-roster-more{display:flex;flex-direction:column;align-items:center;gap:.5rem;text-align:center;color:rgba(255,255,255,.7)}

      /* ── Chrome: exit control only (native <video controls> owns
         play/pause/mute/seek/fullscreen -- nothing to hand-roll here) ──── */
      .tr-icon-btn{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.2);border-radius:9px;color:rgba(255,255,255,.88);cursor:pointer;font-size:1.05rem;font-family:var(--font-b);transition:background .15s;padding:0}
      .tr-icon-btn:hover{background:rgba(255,255,255,.18)}

      .tr-cta{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--radius-sm);padding:12px 24px;font-family:var(--font-b);font-weight:700;font-size:.9rem;cursor:pointer;border:none;transition:filter .15s,transform .15s}
      .tr-cta-gold{background:linear-gradient(135deg,var(--gold),var(--amber));color:#1a1008}
      .tr-cta-ghost{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.28)}
      .tr-cta:hover{filter:brightness(1.1)}
      .tr-cta:active{transform:scale(.97)}

      /* ── Focus visibility (WCAG 2.2, ≥3:1 contrast ring) ─────────────── */
      .tr-root button:focus-visible,.tr-root a:focus-visible{outline:3px solid var(--amber);outline-offset:3px}

      /* ── Reduced motion (technical spec §7, verbatim rule): the video
         itself is the user's own content -- never suppressed here, it isn't
         targeted by this selector at all. Only the end card's motion
         (avatar stamp-in, slam) and the countdown's per-digit slam are
         affected -- content/timing unchanged, just the punch removed. ──── */
      [data-tr-rm="1"] .tr-endcard *,[data-tr-rm="1"] .tr-endcard *::before,[data-tr-rm="1"] .tr-endcard *::after,
      [data-tr-rm="1"] .tr-countdown *,[data-tr-rm="1"] .tr-countdown *::before,[data-tr-rm="1"] .tr-countdown *::after{
        animation:none!important;
        transition-property:opacity!important;
        transition-duration:200ms!important;
        transform:none!important;
      }
    `}</style>
  );
}
