// Package C -- one static <style> block of @keyframes/classes for the event
// trailer, same idiom as the `GS` block at the top of App.jsx (technical spec
// §3 file layout). Rendered once by EventTrailer.jsx.
//
// SECURITY (technical spec §11): this template literal contains NO
// interpolation of event data -- a fully static string, full stop. An
// interpolated CSS string would be a live injection vector via `evt.theme`.
// Every value that legitimately varies per event (Ken Burns duration, wipe
// stagger, progress fill %) is applied by the *consuming components* via
// inline `style`/CSS custom properties on individual DOM nodes -- never by
// building this string dynamically.
//
// Performance budget (technical spec §5.3, non-negotiable): every @keyframes
// below animates ONLY `transform` and/or `opacity`. No `width`/`height`/
// `top`/`background-position`/`box-shadow`/animated `filter: blur()`, and no
// `backdrop-filter` on anything that animates.
//
// DEVIATION FROM THE CREATIVE SPEC, flagged explicitly (creative spec §4
// "slam"): the brief asks for `filter: blur(6px) -> blur(0)` as part of the
// text "slam" entrance. That's an animated filter, which §5.3 forbids
// outright ("never... animated filter:blur()"). `tr-slam` below keeps the
// scale+translateY+opacity punch-in (the "hits hard then settles" timing
// and easing are unchanged) and drops only the blur defocus. See the report
// for the full callout -- this is the one place the CSS substrate genuinely
// can't do what the shot list asked for without breaking the budget.
export default function TrailerStyles() {
  return (
    <style>{`
      .tr-root{position:fixed;inset:0;z-index:1100;background:var(--bg);color:var(--cream);font-family:var(--font-b);overflow:hidden;-webkit-tap-highlight-color:transparent}
      .tr-root *{box-sizing:border-box}
      .tr-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

      /* ── Stage: media layers ─────────────────────────────────────────── */
      .tr-stage{position:absolute;inset:0}
      .tr-stage-media{position:absolute;inset:0;background:var(--bg)}
      .tr-media-layer{position:absolute;inset:0;opacity:0;transition:opacity .5s ease;overflow:hidden}
      .tr-media-layer.tr-media-front{opacity:1}
      .tr-media-layer img{position:absolute;inset:-4% -4% -4% -4%;width:108%;height:108%;object-fit:cover;display:block}
      .tr-media-fallback{position:absolute;inset:-4%;width:108%;height:108%;background:radial-gradient(ellipse 70% 60% at 30% 30%,rgba(232,148,58,.35),transparent 60%),linear-gradient(135deg,var(--bg4),var(--bg2) 55%,var(--bg))}
      .tr-kenburns-zoom{animation-name:tr-kenburns-zoom;animation-timing-function:linear;animation-fill-mode:both}
      .tr-kenburns-pan{animation-name:tr-kenburns-pan;animation-timing-function:linear;animation-fill-mode:both}
      @keyframes tr-kenburns-zoom{from{transform:scale(1)}to{transform:scale(1.08)}}
      @keyframes tr-kenburns-pan{from{transform:scale(1) translate(0,0)}to{transform:scale(1.08) translate(-2%,-1.5%)}}

      .tr-scrim{position:absolute;inset:0;pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,.92) 0%,rgba(0,0,0,.55) 32%,rgba(0,0,0,.55) 68%,rgba(0,0,0,.92) 100%)}
      .tr-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 78% 70% at 50% 50%,transparent 52%,rgba(0,0,0,.55) 100%)}
      .tr-grain{position:absolute;inset:0;pointer-events:none;opacity:.045;mix-blend-mode:overlay;background-image:radial-gradient(rgba(255,255,255,.9) 1px,transparent 1.4px);background-size:3px 3px}

      /* ── Letterbox frame ─────────────────────────────────────────────── */
      .tr-letterbox{position:absolute;left:0;right:0;background:var(--bg);z-index:40;pointer-events:none}
      .tr-letterbox-top{top:0;height:3.2vh;border-bottom:1px solid var(--border2)}
      .tr-letterbox-bottom{bottom:0;height:3.2vh;border-top:1px solid var(--border2)}
      @media(min-width:768px){
        .tr-letterbox-top{height:5vh}
        .tr-letterbox-bottom{height:5vh}
      }

      /* ── Ember drift (cold open) ─────────────────────────────────────── */
      .tr-embers{position:absolute;inset:0;pointer-events:none;overflow:hidden}
      .tr-ember{position:absolute;bottom:18%;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,rgba(245,184,102,.95),rgba(232,148,58,.15) 70%);animation:tr-ember 6.5s ease-in infinite}
      .tr-ember:nth-child(1){left:28%;animation-delay:0s;animation-duration:7.2s}
      .tr-ember:nth-child(2){left:52%;animation-delay:1.8s;animation-duration:6.1s}
      .tr-ember:nth-child(3){left:71%;animation-delay:3.4s;animation-duration:8s}
      @keyframes tr-ember{0%{transform:translateY(0) scale(.8);opacity:0}12%{opacity:.7}80%{opacity:.25}100%{transform:translateY(-46vh) scale(1.1);opacity:0}}

      /* ── Wipe (hard-cut transition) ──────────────────────────────────── */
      .tr-wipe{position:absolute;top:0;bottom:0;width:7px;z-index:60;pointer-events:none;background:linear-gradient(180deg,var(--orange),var(--amber),var(--gold),var(--amber),var(--orange));box-shadow:0 0 26px 6px rgba(232,148,58,.55);animation:tr-wipe .18s cubic-bezier(.65,0,.35,1) both}
      @keyframes tr-wipe{0%{transform:translateX(-10vw)}100%{transform:translateX(110vw)}}
      /* Reduced motion: the universal [data-tr-rm="1"] override below already
         forces animation:none + transform:none on this element -- there is
         no separate "flash" keyframe variant, because one would never run
         under that !important rule anyway. The "single flash-frame" effect
         instead comes from EventTrailer.jsx keeping the bar mounted for a
         much shorter JS-controlled window when reducedMotion is true. */

      /* ── Type-on ("slam") ─────────────────────────────────────────────
         See the module docblock: blur is intentionally dropped from the
         CSS-substrate implementation (perf budget §5.3). */
      .tr-slam{animation:tr-slam .42s cubic-bezier(.16,1,.3,1) both}
      @keyframes tr-slam{0%{opacity:0;transform:scale(1.15) translateY(10px)}100%{opacity:1;transform:scale(1) translateY(0)}}
      .tr-fade{animation:tr-fade .3s ease both}
      @keyframes tr-fade{from{opacity:0}to{opacity:1}}

      .tr-wordmark{font-family:var(--font-h);font-style:italic;font-weight:900;text-transform:uppercase;color:var(--amber2);line-height:.92;letter-spacing:-.02em;text-shadow:0 2px 40px rgba(232,148,58,.35),0 2px 30px rgba(0,0,0,.6);font-size:clamp(3.2rem,14vw,7rem)}
      .tr-wordmark-settled{font-size:clamp(2rem,8vw,3.6rem)}
      .tr-wordmark span{display:inline-block;animation:tr-slam .42s cubic-bezier(.16,1,.3,1) both}
      .tr-wordmark span:nth-child(1){animation-delay:0ms}
      .tr-wordmark span:nth-child(2){animation-delay:40ms}
      .tr-wordmark span:nth-child(3){animation-delay:80ms}
      .tr-wordmark span:nth-child(4){animation-delay:120ms}
      .tr-wordmark span:nth-child(5){animation-delay:160ms}
      .tr-wordmark span:nth-child(6){animation-delay:200ms}
      .tr-wordmark span:nth-child(7){animation-delay:240ms}
      .tr-wordmark span:nth-child(8){animation-delay:280ms}
      .tr-wordmark span:nth-child(9){animation-delay:320ms}
      .tr-wordmark span:nth-child(10){animation-delay:360ms}

      .tr-title{font-family:var(--font-h);font-weight:900;text-transform:uppercase;line-height:1.03;color:#fff;text-shadow:0 2px 30px rgba(0,0,0,.6);font-size:clamp(2rem,8vw,4.2rem)}
      .tr-kicker{font-family:var(--font-b);font-weight:700;font-size:.76rem;letter-spacing:.24em;text-transform:uppercase;color:var(--amber)}
      .tr-kicker-red{color:var(--red)}
      .tr-sub{font-family:var(--font-b);font-weight:500;font-size:1rem;color:rgba(255,255,255,.86);text-shadow:0 2px 20px rgba(0,0,0,.55)}
      .tr-note{font-family:var(--font-b);font-weight:400;font-style:italic;font-size:.92rem;color:rgba(255,255,255,.72);line-height:1.6}
      .tr-name{font-family:var(--font-h);font-weight:700;font-size:1.12rem;color:#fff}

      .tr-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.24);border-radius:var(--radius-sm);padding:4px 13px;font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.86);white-space:nowrap}
      .tr-chip-amber{background:rgba(232,148,58,.2);border-color:rgba(232,148,58,.45);color:var(--amber)}
      .tr-chip-purple{background:rgba(155,127,232,.2);border-color:rgba(155,127,232,.45);color:var(--purple)}
      .tr-chip-green{background:rgba(76,175,125,.16);border-color:rgba(76,175,125,.4);color:var(--green)}

      /* ── Secret tease ─────────────────────────────────────────────────── */
      .tr-secret-bg{position:absolute;inset:0;background:radial-gradient(ellipse 70% 60% at 50% 40%,rgba(232,148,58,.18),transparent 62%),linear-gradient(160deg,#1d1408,var(--bg) 65%)}
      .tr-lock{font-size:clamp(2.6rem,8vw,4.4rem);filter:drop-shadow(0 4px 24px rgba(224,85,85,.3));animation:tr-lock-breathe 2.4s ease-in-out infinite}
      @keyframes tr-lock-breathe{0%,100%{opacity:.85}50%{opacity:1}}

      /* ── Avatar stamp-in (roster + legacy) ───────────────────────────── */
      .tr-stamp{animation:tr-stamp .32s cubic-bezier(.34,1.56,.64,1) both}
      @keyframes tr-stamp{0%{opacity:0;transform:scale(.6) rotate(-6deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
      .tr-avatar{border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.18);background:linear-gradient(135deg,var(--gold),var(--amber))}
      .tr-avatar img{width:100%;height:100%;object-fit:cover;display:block}
      .tr-avatar-mono{font-family:var(--font-h);font-weight:900;color:#1a1008}

      .tr-roster-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:1.1rem 1rem;width:100%;max-width:760px}
      .tr-roster-person{display:flex;flex-direction:column;align-items:center;gap:.5rem;text-align:center}
      .tr-roster-more{display:flex;flex-direction:column;align-items:center;gap:.5rem;text-align:center;color:rgba(255,255,255,.7)}

      /* ── Chrome / controls ────────────────────────────────────────────── */
      .tr-chrome-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:calc(3.2vh + .9rem) calc(1.1rem + 54px) .9rem 1.1rem;z-index:50}
      @media(min-width:768px){.tr-chrome-top{padding:calc(5vh + 1rem) calc(1.6rem + 54px) 1rem 1.6rem}}
      .tr-eyebrow{font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:rgba(255,255,255,.78);padding-top:11px;transition:opacity .3s ease}
      .tr-chrome-fade{transition:opacity .3s ease}
      .tr-chrome-hidden{opacity:0;pointer-events:none}
      .tr-icon-btn{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.2);border-radius:9px;color:rgba(255,255,255,.88);cursor:pointer;font-size:1.05rem;font-family:var(--font-b);transition:background .15s;padding:0}
      .tr-icon-btn:hover{background:rgba(255,255,255,.18)}

      .tr-chrome-bottom{position:absolute;left:0;right:0;bottom:calc(3.2vh + .8rem);display:flex;gap:5px;padding:0 1.1rem;z-index:50}
      @media(min-width:768px){.tr-chrome-bottom{bottom:calc(5vh + .9rem);padding:0 1.6rem}}
      .tr-seg-track{flex:1;height:3px;background:rgba(255,255,255,.22);border-radius:2px;overflow:hidden}
      .tr-seg-fill{height:100%;width:100%;transform-origin:left center;transform:scaleX(var(--tr-progress,0));background:linear-gradient(90deg,var(--amber),var(--gold));border-radius:2px}
      .tr-seg-counter{position:absolute;left:0;right:0;bottom:calc(3.2vh + .8rem);display:flex;justify-content:center;z-index:50;font-size:.72rem;letter-spacing:.1em;color:rgba(255,255,255,.7);font-weight:700}
      @media(min-width:768px){.tr-seg-counter{bottom:calc(5vh + .9rem)}}

      .tr-tapzone{position:absolute;top:0;bottom:0;width:50%;background:transparent;border:none;padding:0;margin:0;cursor:pointer;z-index:30}
      .tr-tapzone-left{left:0}
      .tr-tapzone-right{right:0}

      .tr-poster{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:70}
      .tr-poster-card{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;text-align:center;gap:1rem;padding:2.4rem 1.4rem;width:100%;height:100%}

      .tr-cta{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--radius-sm);padding:12px 24px;font-family:var(--font-b);font-weight:700;font-size:.9rem;cursor:pointer;border:none;transition:filter .15s,transform .15s}
      .tr-cta-gold{background:linear-gradient(135deg,var(--gold),var(--amber));color:#1a1008}
      .tr-cta-ghost{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.28)}
      .tr-cta:hover{filter:brightness(1.1)}
      .tr-cta:active{transform:scale(.97)}

      .tr-content{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:8vh 1.4rem calc(3.2vh + 3.4rem);z-index:20}
      @media(min-width:768px){.tr-content{padding:10vh 4rem calc(5vh + 3.6rem)}}
      .tr-content-center{justify-content:center;text-align:center;align-items:center}

      /* ── Focus visibility (WCAG 2.2, ≥3:1 contrast ring) ─────────────── */
      .tr-root button:focus-visible,.tr-root a:focus-visible{outline:3px solid var(--amber);outline-offset:3px}

      /* ── Reduced motion (technical spec §7, verbatim rule) ───────────── */
      [data-tr-rm="1"] *,[data-tr-rm="1"] *::before,[data-tr-rm="1"] *::after{
        animation:none!important;
        transition-property:opacity!important;
        transition-duration:200ms!important;
        transform:none!important;
      }
      [data-tr-rm="1"] .tr-lock{opacity:.9}
    `}</style>
  );
}
