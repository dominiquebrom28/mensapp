// Generic renderer for a scoring plugin's `configFields`/`entryFields`
// (docs/mensgames-spec.md §4.3, §5's "the load-bearing piece"). This is the
// one file that has to be right for adding a new sport to stay a one-file
// job: every plugin describes its fields as plain data
// (`{key,label,type,min,max,default}`), and this component turns that into
// controls -- nothing here knows what "sets" or "goals" mean.
//
// Hard requirement (spec §7 / task brief): numeric input parses, clamps to
// the field's min/max, and rejects NaN before ever calling `onChange` --
// `parseAndClamp` below is the one place that happens, so every caller
// (MatchRow's two sides, the freeform entry row) gets it for free and can't
// forget it.
import { Inp, Lbl, Stepper } from './ui/Kit.jsx';
import { parseAndClamp } from './numberInput.js';

function FieldRow({ field, value, onChange, disabled, idPrefix }) {
  const current = Number.isFinite(value) ? value : (typeof field.default === 'number' ? field.default : (field.min ?? 0));
  // Prefixed so two `ConfigFields` instances on screen at once (MatchRow
  // renders one per side, same field keys) never collide on DOM id, which
  // would silently break every `<label htmlFor>` association -- an a11y
  // regression that's invisible unless you go looking for it.
  const id = `mg-field-${idPrefix ? `${idPrefix}-` : ''}${field.key}`;
  if (field.type === 'stepper') {
    return (
      <div>
        <Lbl htmlFor={id}>{field.label}</Lbl>
        <Stepper id={id} value={current} min={field.min ?? 0} max={field.max ?? 999} label={field.label} disabled={disabled} onChange={(v) => onChange(field.key, v)} />
      </div>
    );
  }
  // 'number' -- a plugin opts into this deliberately for values a stepper
  // would make painful to reach (race-time's seconds field can run into the
  // hundreds; best-of/first-to's own *config* -- "best of how many sets" --
  // is a one-time setup value, not an in-the-moment score). Still never a
  // bare `<input type=number>`: a ±1 stepper pair rides alongside it so tap
  // entry stays the primary path, typing is the fallback for a big jump.
  return (
    <div>
      <Lbl htmlFor={id}>{field.label}</Lbl>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Inp
          id={id}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? String(value) : ''}
          min={field.min}
          max={field.max}
          disabled={disabled}
          style={{ width: 110, textAlign: 'center', fontSize: '1.15rem', fontFamily: 'var(--font-h)' }}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') { onChange(field.key, null); return; }
            const clamped = parseAndClamp(raw, field);
            if (clamped !== null) onChange(field.key, clamped);
          }}
        />
        <Stepper value={current} min={field.min ?? 0} max={field.max ?? 999999} step={1} label={field.label} disabled={disabled} onChange={(v) => onChange(field.key, v)} />
      </div>
    </div>
  );
}

/**
 * `fields`: a plugin's `configFields` or `entryFields(config)` array.
 * `value`: the current `{[key]:number}` object (a match's `entry.a`, a
 * round's `scoring.config`, a freeform entry, ...).
 * `onChange(nextValue)`: called with a **new, whole** object every time any
 * one field changes -- callers never have to merge partial updates
 * themselves.
 */
export default function ConfigFields({ fields, value, onChange, disabled = false, idPrefix }) {
  const list = Array.isArray(fields) ? fields : [];
  if (list.length === 0) return null;
  const setField = (key, v) => onChange({ ...value, [key]: v });
  return (
    <div style={{ display: 'grid', gap: '.8rem', gridTemplateColumns: list.length > 1 ? 'repeat(auto-fit,minmax(140px,1fr))' : '1fr' }}>
      {list.map((field) => (
        <FieldRow key={field.key} field={field} value={value?.[field.key]} onChange={setField} disabled={disabled} idPrefix={idPrefix} />
      ))}
    </div>
  );
}
