// Quiz presentation primitives (docs/quiz-unification-spec.md §8.1, §8.3
// "Shared primitives" -- App.jsx's own `Card`/`Btn`/`Inp`/`Lbl`/`Avatar`/
// `Tag`/`TeamSetsErrorNotice` are `const`s, never `export`ed (breaking that
// would fail the source-parsing tests, docs/mensgames-spec.md §5.4). Q3 is a
// **pure move, zero behaviour change** -- so unlike `mensgames/ui/Kit.jsx`
// (which redesigned its own primitives from scratch), everything below that
// the moved quiz components actually render is copied **byte-for-byte**
// from App.jsx rather than approximated, because even a padding/font-size
// rounding difference is a behaviour change. `ANIMALS` is `Avatar`'s own
// private colour table, copied alongside it for the same reason.
//
// Anything the moved code does *not* currently render (`H`, `Modal`,
// `Divider`, `Switch`, and friends) is re-exported from the mensgames Kit
// instead of duplicated again -- "whatever else is needed" per the spec,
// available to later quiz work packages (Q4+) without a third copy of
// primitives this package never exercises.
import { useEffect, useRef } from 'react';

export {
  H,
  Modal,
  Divider,
  Switch,
  LiveDot,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Stepper,
} from '../../mensgames/ui/Kit.jsx';

// ── Copied verbatim from App.jsx (`const Card =`, line ~105) ───────────────
export const Card = ({ children, style = {}, className = "", id }) => (
  <div id={id} className={className} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1.4rem", ...style }}>{children}</div>
);

// ── Copied verbatim from App.jsx (`const Btn =`, line ~111) ────────────────
export const Btn = ({ children, onClick, variant = "primary", size = "md", style = {}, disabled = false, type = "button" }) => {
  const sz = { sm: { padding: "6px 14px", fontSize: ".78rem" }, md: { padding: "10px 22px", fontSize: ".88rem" }, lg: { padding: "13px 30px", fontSize: "1rem" } };
  const vr = {
    primary: { background: "var(--amber)", color: "var(--bg)", border: "none" },
    ghost: { background: "transparent", color: "var(--cream)", border: "1px solid var(--border)" },
    danger: { background: "transparent", color: "var(--red)", border: "1px solid rgba(224,85,85,.3)" },
    subtle: { background: "var(--bg3)", color: "var(--cream)", border: "1px solid var(--border)" },
    success: { background: "transparent", color: "var(--green)", border: "1px solid rgba(76,175,125,.3)" },
    gold: { background: "linear-gradient(135deg,var(--gold),var(--amber))", color: "var(--bg)", border: "none" },
  };
  const btnRef = useRef(null);
  const computed = { ...sz[size], ...vr[variant], ...style };
  const onEnter = e => { if (disabled) return; const el = e.currentTarget;
    if (variant === "primary") { el.style.background = "var(--amber2)"; el.style.transform = "translateY(-1px)"; el.style.boxShadow = "0 4px 16px rgba(232,148,58,.35)"; }
    else if (variant === "ghost") { el.style.background = "rgba(232,148,58,.09)"; el.style.borderColor = "var(--border2)"; }
    else if (variant === "danger") { el.style.background = "rgba(224,85,85,.12)"; el.style.borderColor = "rgba(224,85,85,.55)"; }
    else if (variant === "subtle") { el.style.background = "var(--bg4)"; el.style.borderColor = "var(--border2)"; }
    else if (variant === "success") { el.style.background = "rgba(76,175,125,.12)"; el.style.borderColor = "rgba(76,175,125,.55)"; }
    else if (variant === "gold") { el.style.filter = "brightness(1.12)"; el.style.transform = "translateY(-1px)"; el.style.boxShadow = "0 4px 18px rgba(201,146,42,.35)"; }
  };
  const rest = el => {
    el.style.background = computed.background ?? "";
    el.style.border = computed.border ?? "";
    if ("borderColor" in style) el.style.borderColor = style.borderColor;
    el.style.transform = computed.transform ?? ""; el.style.boxShadow = computed.boxShadow ?? ""; el.style.filter = computed.filter ?? "";
  };
  const onLeave = e => rest(e.currentTarget);
  useEffect(() => {
    if (disabled && btnRef.current) rest(btnRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, variant]);
  const onDown = e => { if (!disabled) { const el = e.currentTarget; el._preTr = el.style.transform; el.style.transform = "scale(.96)"; } };
  const onUp = e => { if (!disabled) { const el = e.currentTarget; el.style.transform = el._preTr ?? ""; } }
  return <button ref={btnRef} type={type} onClick={onClick} disabled={disabled} onMouseEnter={onEnter} onMouseLeave={onLeave} onMouseDown={onDown} onMouseUp={onUp} style={{ borderRadius: "var(--radius-sm)", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "var(--font-b)", fontWeight: 600, transition: "all .18s", opacity: disabled ? .5 : 1, ...computed }}>{children}</button>;
};

// ── Copied verbatim from App.jsx (`const Inp =`, line ~207) ────────────────
export const Inp = ({ value, onChange, placeholder, style = {}, type = "text", multiline = false, onKeyDown, autoFocus = false, rows = 3 }) => {
  const base = { background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "11px 14px", color: "var(--cream)", fontSize: ".88rem", width: "100%", outline: "none" };
  return multiline
    ? <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={{ ...base, resize: "vertical", ...style }} />
    : <input type={type} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown} autoFocus={autoFocus} style={{ ...base, ...style }} />;
};

// ── Copied verbatim from App.jsx (`const Lbl =`, line ~213) ────────────────
export const Lbl = ({ children, style = {} }) => <div style={{ fontSize: ".75rem", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 5, ...style }}>{children}</div>;

// ── Copied verbatim from App.jsx (`const Tag =`, line ~227) ────────────────
export const Tag = ({ children, color = "var(--amber)" }) => (
  <span style={{ background: color + "22", color, border: `1px solid ${color}33`, borderRadius: 6, padding: "3px 10px", fontSize: ".73rem", fontWeight: 600 }}>{children}</span>
);

// ── Copied verbatim from App.jsx (`const ANIMALS =`, line ~341 -- `Avatar`'s
// private colour table) and `const Avatar =` (line ~230) ───────────────────
const ANIMALS = [
  { name: "Beer", emoji: "🐻", bg: "linear-gradient(135deg,#8B4513,#D2691E)" },
  { name: "Vos", emoji: "🦊", bg: "linear-gradient(135deg,#c0392b,#e8943a)" },
  { name: "Kikker", emoji: "🐸", bg: "linear-gradient(135deg,#27ae60,#52c41a)" },
  { name: "Pinguïn", emoji: "🐧", bg: "linear-gradient(135deg,#2c3e50,#4a6278)" },
  { name: "Uil", emoji: "🦉", bg: "linear-gradient(135deg,#6B3FA0,#9B59B6)" },
  { name: "Leeuw", emoji: "🦁", bg: "linear-gradient(135deg,#c9922a,#f5b866)" },
  { name: "Wolf", emoji: "🐺", bg: "linear-gradient(135deg,#485460,#808e9b)" },
  { name: "Konijn", emoji: "🐰", bg: "linear-gradient(135deg,#a55eea,#d980fa)" },
  { name: "Koala", emoji: "🐨", bg: "linear-gradient(135deg,#0984e3,#74b9ff)" },
  { name: "Panda", emoji: "🐼", bg: "linear-gradient(135deg,#2d3436,#636e72)" },
];
export const Avatar = ({ name, size = 32, index = 0, photoUrl = "", style = {} }) => {
  if (photoUrl) return <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, overflow: "hidden", border: "2px solid var(--bg2)", ...style }}><img src={photoUrl} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>;
  const animal = ANIMALS[index % ANIMALS.length];
  return <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, background: animal.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * .5, border: "2px solid var(--bg2)", ...style }}>{animal.emoji}</div>;
};

// ── Copied verbatim from App.jsx (`const TeamSetsErrorNotice =`, line
// ~1821) ────────────────────────────────────────────────────────────────
export const TeamSetsErrorNotice = ({ onRetry }) => (
  <div role="alert" style={{ textAlign: "center", padding: "1.4rem 1rem", color: "var(--red)", border: "1px solid rgba(224,85,85,.35)", borderRadius: "var(--radius-sm)", background: "rgba(224,85,85,.06)" }}>
    <div aria-hidden="true" style={{ fontSize: "1.4rem", marginBottom: ".4rem" }}>⚠️</div>
    <div style={{ fontSize: ".85rem", marginBottom: onRetry ? ".7rem" : 0 }}>Kon de teams-bibliotheek niet laden. Er bestaan mogelijk al teams -- probeer het opnieuw.</div>
    {onRetry && <Btn onClick={onRetry} variant="danger" size="sm">Opnieuw proberen</Btn>}
  </div>
);

// Filter/sub-tab button. Exists because `QuizShell` originally reached for
// mens-games' `.mg-subtab` CSS class, which is only injected by
// `MensGamesShell` -- so inside the quiz feature the class matched nothing
// and every tab fell back to the user-agent button default: a #efefef grey
// background under cream text (unreadable), roughly 24px tall, no pointer
// cursor. Same shape of bug the owner reported twice in August, from the
// same cause each time: a control whose visible state depends on styling
// that isn't actually there.
//
// Values are `.mg-subtab`'s own, inlined so this cannot happen again by
// forgetting to import a stylesheet. App.jsx has a near-identical `TabBtn`
// that can't be shared -- see the fork note there and docs/ux-plan.md.
export const SubTab = ({ active, onClick, children, style = {} }) => (
  <button
    onClick={onClick}
    style={{
      background: "none",
      border: "none",
      borderBottom: active ? "2px solid var(--amber)" : "2px solid transparent",
      color: active ? "var(--amber2)" : "var(--muted)",
      fontWeight: active ? 600 : 400,
      cursor: "pointer",
      padding: "8px 14px",
      whiteSpace: "nowrap",
      fontFamily: "var(--font-b)",
      fontSize: ".83rem",
      transition: "color .15s,background .15s",
      borderRadius: "8px 8px 0 0",
      minHeight: 44,
      marginBottom: -1,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      ...style,
    }}>
    {children}
  </button>
);
