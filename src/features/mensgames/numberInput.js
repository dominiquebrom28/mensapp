// Pure numeric parse/clamp helper, split out of ConfigFields.jsx into its
// own module so that file can stay component-only (eslint's
// `react-refresh/only-export-components`, active project-wide via
// `eslint-plugin-react-refresh`'s vite config, flags a file that exports
// both a component and a plain function).
//
// Hard requirement (docs/mensgames-spec.md §7 / task brief): numeric input
// parses, clamps to the field's declared min/max, and rejects `NaN` before
// anything is ever written -- this is the one place that happens, so every
// caller (ConfigFields' own field rows, anything else that touches a
// plugin-declared numeric field) gets it for free and can't forget it.
export function parseAndClamp(raw, field) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  let v = Math.round(n);
  if (typeof field?.min === 'number' && v < field.min) v = field.min;
  if (typeof field?.max === 'number' && v > field.max) v = field.max;
  return v;
}
