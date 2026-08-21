// Mens-games' own presentation primitives (docs/mensgames-spec.md §5.1):
// re-implements ~90 lines of Card/H/Btn/Inp/Lbl-equivalents against the same
// global CSS custom properties `GS` (App.jsx) already injects, so this reads
// as visually identical to the rest of the app by construction, without
// adding `export` to any of App.jsx's own `const Card =`/`const Modal =`/...
// declarations -- which would break the source-parsing tests (§5.4).
//
// Every control here defaults toward the mobile/bar constraint (§11 risk 7):
// `Stepper` is the primary numeric-entry primitive (48px tap targets, no
// on-screen keyboard), `Btn`'s `lg` size clears the 44px primary-touch
// minimum, and everything gets a visible focus ring from ui/styles.jsx.
import { useEffect, useRef } from 'react';

export const Card = ({ children, style = {}, className = '', id }) => (
  <div id={id} className={className} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius, 14px)', padding: '1.2rem', ...style }}>
    {children}
  </div>
);

export const H = ({ children, size = '1.2rem', style = {}, id }) => (
  <h2 id={id} style={{ fontFamily: 'var(--font-h)', fontSize: size, color: 'var(--amber2)', marginBottom: '.75rem', lineHeight: 1.2, ...style }}>{children}</h2>
);

const BTN_SIZES = {
  sm: { padding: '6px 12px', fontSize: '.78rem', minHeight: 36 },
  md: { padding: '10px 18px', fontSize: '.86rem', minHeight: 44 },
  lg: { padding: '13px 26px', fontSize: '.96rem', minHeight: 48 },
};
const BTN_VARIANTS = {
  primary: { background: 'var(--amber)', color: 'var(--bg)', border: 'none' },
  ghost: { background: 'transparent', color: 'var(--cream)', border: '1px solid var(--border)' },
  danger: { background: 'transparent', color: 'var(--red)', border: '1px solid rgba(224,85,85,.35)' },
  subtle: { background: 'var(--bg3)', color: 'var(--cream)', border: '1px solid var(--border)' },
  success: { background: 'transparent', color: 'var(--green)', border: '1px solid rgba(76,175,125,.35)' },
};

export const Btn = ({ children, onClick, variant = 'primary', size = 'md', style = {}, disabled = false, type = 'button', title, ariaLabel, ariaPressed }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel}
    aria-pressed={ariaPressed}
    className="mg-card-hover"
    style={{
      borderRadius: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-b)',
      fontWeight: 600,
      opacity: disabled ? 0.5 : 1,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      ...BTN_SIZES[size],
      ...BTN_VARIANTS[variant],
      ...style,
    }}
  >
    {children}
  </button>
);

export const Inp = ({ value, onChange, placeholder, style = {}, type = 'text', multiline = false, onKeyDown, autoFocus = false, rows = 3, id, inputMode, min, max, disabled }) => {
  const base = { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', color: 'var(--cream)', fontSize: '.9rem', width: '100%', outline: 'none', minHeight: 44, fontFamily: 'var(--font-b)' };
  return multiline ? (
    <textarea id={id} value={value} onChange={onChange} placeholder={placeholder} rows={rows} disabled={disabled} style={{ ...base, resize: 'vertical', minHeight: 'auto', ...style }} />
  ) : (
    <input id={id} type={type} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown} autoFocus={autoFocus} inputMode={inputMode} min={min} max={max} disabled={disabled} style={{ ...base, ...style }} />
  );
};

export const Lbl = ({ children, htmlFor }) => (
  <label htmlFor={htmlFor} style={{ display: 'block', fontSize: '.72rem', color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 5 }}>{children}</label>
);

export const Tag = ({ children, color = 'var(--amber)' }) => (
  <span style={{ background: `${color}22`, color, border: `1px solid ${color}44`, borderRadius: 6, padding: '3px 9px', fontSize: '.72rem', fontWeight: 600, display: 'inline-block' }}>{children}</span>
);

export const Divider = ({ label }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '.5rem 0' }}>
    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    {label && <span style={{ color: 'var(--muted)', fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</span>}
    <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
  </div>
);

// Accessible on/off toggle -- a real `<button role="switch">` (native
// Enter/Space activation + the shared focus ring), same shape as App.jsx's
// own `Switch` (not imported -- §5.1) so the interaction feels identical.
export const Switch = ({ checked, onChange, label, id }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <button type="button" id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)} style={{ width: 42, height: 26, borderRadius: 13, border: `1px solid ${checked ? 'var(--amber)' : 'var(--border)'}`, background: checked ? 'var(--amber)' : 'var(--bg3)', position: 'relative', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
      <span aria-hidden="true" style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 20, height: 20, borderRadius: '50%', background: checked ? '#1a1008' : 'var(--muted2)', transition: 'left .15s' }} />
    </button>
    {label && <label htmlFor={id} style={{ fontSize: '.83rem', color: 'var(--cream)', cursor: 'pointer' }}>{label}</label>}
  </div>
);

/**
 * The primary score-entry control (§11 risk 7): two 48px tap targets around
 * a large tabular-nums value -- never a bare `<input type="number">` for a
 * live score. `min`/`max` disable the relevant button rather than allowing
 * an out-of-range tap; the value passed to `onChange` is always already
 * clamped, so a caller never has to re-validate a Stepper's own output.
 */
export const Stepper = ({ value, onChange, min = 0, max = 999, step = 1, label, disabled = false, id }) => {
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const dec = () => !disabled && onChange(clamp((Number.isFinite(value) ? value : min) - step));
  const inc = () => !disabled && onChange(clamp((Number.isFinite(value) ? value : min) + step));
  return (
    <div className="mg-stepper" role="group" aria-label={label}>
      <button type="button" className="mg-stepper-btn" onClick={dec} disabled={disabled || value <= min} aria-label={label ? `${label} verlagen` : 'Verlagen'}>−</button>
      <span id={id} className="mg-stepper-val" aria-live="polite">{Number.isFinite(value) ? value : min}</span>
      <button type="button" className="mg-stepper-btn" onClick={inc} disabled={disabled || value >= max} aria-label={label ? `${label} verhogen` : 'Verhogen'}>+</button>
    </div>
  );
};

export const EmptyState = ({ icon = '🎮', title, hint }) => (
  <div style={{ textAlign: 'center', padding: '2.4rem 1.2rem', color: 'var(--muted)' }}>
    <div style={{ fontSize: '2.4rem', marginBottom: '.6rem' }} aria-hidden="true">{icon}</div>
    <div style={{ fontFamily: 'var(--font-h)', fontSize: '1.05rem', color: 'var(--amber2)', marginBottom: '.3rem' }}>{title}</div>
    {hint && <div style={{ fontSize: '.82rem', lineHeight: 1.5 }}>{hint}</div>}
  </div>
);

export const ErrorState = ({ message, onRetry }) => (
  <div role="alert" style={{ textAlign: 'center', padding: '1.6rem 1.2rem', color: 'var(--red)', border: '1px solid rgba(224,85,85,.35)', borderRadius: 12, background: 'rgba(224,85,85,.06)' }}>
    <div style={{ fontSize: '1.6rem', marginBottom: '.4rem' }} aria-hidden="true">⚠️</div>
    <div style={{ fontSize: '.88rem', marginBottom: onRetry ? '.8rem' : 0 }}>{message}</div>
    {onRetry && <Btn onClick={onRetry} variant="danger" size="sm">Opnieuw proberen</Btn>}
  </div>
);

export const LoadingBlock = ({ label = 'Laden…' }) => (
  <div role="status" style={{ display: 'grid', gap: 10, padding: '.4rem 0' }}>
    <span className="mg-sr-only">{label}</span>
    <div className="mg-skeleton" style={{ height: 64 }} aria-hidden="true" />
    <div className="mg-skeleton" style={{ height: 64 }} aria-hidden="true" />
  </div>
);

/**
 * A dialog anchored at the top of the small-viewport bar, matching App.jsx's
 * own `Modal` (backdrop click closes after a 350ms guard against the click
 * that opened it; focus is moved in on mount and returned on unmount for
 * WCAG 2.2 focus-management). Reimplemented locally per §5.1.
 */
export const Modal = ({ children, onClose, maxWidth = 480, labelledBy }) => {
  const ready = useRef(false);
  const panelRef = useRef(null);
  const prevFocus = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { ready.current = true; }, 350);
    prevFocus.current = document.activeElement;
    panelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      if (prevFocus.current && typeof prevFocus.current.focus === 'function') prevFocus.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="mg-fu"
      onClick={() => { if (ready.current) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div ref={panelRef} tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth, maxHeight: '92vh', overflowY: 'auto', outline: 'none' }}>
        <Card style={{ padding: '1.5rem' }}>{children}</Card>
      </div>
    </div>
  );
};

export const LiveDot = ({ label = 'Live' }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--red)', fontSize: '.72rem', fontWeight: 700 }}>
    <span className="mg-live-dot" aria-hidden="true" />
    {label}
  </span>
);
