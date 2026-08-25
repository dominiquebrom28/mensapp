// Regression coverage for the three contrast failures fixed in this pass
// (docs/ux-plan.md §2.3/§5.7, 2026-08-26 accessibility audit):
//   1. `--border` measured 1.19:1 on --bg2 -- effectively invisible, and
//      it's the border on every Card/Inp/ghost Btn.
//   2. The global input/select/textarea focus ring measured 1.24:1 (a
//      translucent box-shadow that was *worse* than the UA default it
//      replaced).
//   3. `--muted` measured 4.33/4.11/3.86:1 on --bg2/--bg3/--bg4 -- under
//      the 4.5:1 AA text minimum on every card, which is where secondary
//      text actually lives.
//
// This reads the GS `<style>` block's *raw CSS text* straight out of
// App.jsx's current source (same "read the file as text" idiom as
// extractFromAppSource.js/extractComponentFromAppSource.js -- App.jsx
// can't gain an `export`, see docs/mensgames-spec.md §5.4), then computes
// WCAG contrast with the alpha-compositing-aware helper below. Per the
// task brief: a prior contrast pass on this project produced false
// positives by reading `background-color` and missing translucent/gradient
// values, so every colour here is alpha-composited over the *actual*
// background it renders on before computing luminance -- never a bare
// hex-vs-hex comparison for anything with an alpha channel.
//
// No layout assertions anywhere in this file: jsdom has no layout engine
// (`getBoundingClientRect` always returns zeros), so contrast can only be
// verified against the declared colour *values*, not anything rendered.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')

// ── WCAG 2.x relative luminance / contrast ratio, from the spec formula ──
function srgbToLinear(c) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
function relativeLuminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}
function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA)
  const lB = relativeLuminance(rgbB)
  const lighter = Math.max(lA, lB)
  const darker = Math.min(lA, lB)
  return (lighter + 0.05) / (darker + 0.05)
}
// Alpha-composite `fg` (with `alpha` in [0,1]) over an opaque `bg`, per
// channel -- this is what a browser actually paints for a translucent
// border/box-shadow/text colour, and it's the step a naive "read
// background-color" contrast script skips.
function compositeOver(fg, alpha, bg) {
  return fg.map((c, i) => alpha * c + (1 - alpha) * bg[i])
}
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function parseRgba(str) {
  const m = str.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (!m) throw new Error(`parseRgba: could not parse "${str}"`)
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]) }
}

// ── Extract the GS component's raw <style> CSS text out of App.jsx's
// current source, the same way the App.jsx-source-as-text test helpers do
// elsewhere in this suite (never a hand-copied re-implementation, so a
// regression to the actual token values fails this test). ──
function extractGsStyleText() {
  const src = fs.readFileSync(APP_JSX_PATH, 'utf-8')
  const gsDeclIdx = src.indexOf('const GS = () => (')
  if (gsDeclIdx === -1) throw new Error('gsTokens.contrast.test: could not find "const GS = () => (" in App.jsx')
  const openIdx = src.indexOf('<style>{`', gsDeclIdx)
  if (openIdx === -1) throw new Error('gsTokens.contrast.test: could not find GS\'s "<style>{`" opener in App.jsx')
  const textStart = openIdx + '<style>{`'.length
  const closeIdx = src.indexOf('`}</style>', textStart)
  if (closeIdx === -1) throw new Error('gsTokens.contrast.test: could not find GS\'s "`}</style>" closer in App.jsx')
  return src.slice(textStart, closeIdx)
}

function extractCssVar(cssText, varName) {
  // Matches `--name:value;` where value has no semicolons of its own
  // (true of every token in the :root block -- hex codes and rgba(...)).
  const re = new RegExp(`--${varName}:([^;]+);`)
  const m = cssText.match(re)
  if (!m) throw new Error(`extractCssVar: could not find "--${varName}:" in the GS block`)
  return m[1].trim()
}

function colorToRgbAlpha(value) {
  if (value.startsWith('#')) return { rgb: hexToRgb(value), alpha: 1 }
  return parseRgba(value)
}

const gsText = extractGsStyleText()

const SURFACES = {
  bg: hexToRgb(extractCssVar(gsText, 'bg')),
  bg2: hexToRgb(extractCssVar(gsText, 'bg2')),
  bg3: hexToRgb(extractCssVar(gsText, 'bg3')),
  bg4: hexToRgb(extractCssVar(gsText, 'bg4')),
}

describe('GS design tokens meet their WCAG contrast targets (docs/ux-plan.md §2.3/§5.7)', () => {
  it('--border composites to >=3:1 (WCAG 1.4.11 non-text/UI-boundary minimum) against every card surface', () => {
    const { rgb, alpha } = colorToRgbAlpha(extractCssVar(gsText, 'border'))
    expect(alpha).toBeLessThan(1) // still a translucent amber tint, not a solid colour swap
    for (const [name, surface] of Object.entries(SURFACES)) {
      const composited = compositeOver(rgb, alpha, surface)
      const ratio = contrastRatio(composited, surface)
      expect(ratio, `--border vs ${name}`).toBeGreaterThanOrEqual(3.0)
    }
  })

  it('--border regression guard: is no longer the old, near-invisible 1.19:1 value', () => {
    const { rgb, alpha } = colorToRgbAlpha(extractCssVar(gsText, 'border'))
    const composited = compositeOver(rgb, alpha, SURFACES.bg2)
    const ratio = contrastRatio(composited, SURFACES.bg2)
    expect(ratio).toBeGreaterThan(2.5) // old value measured ~1.19
  })

  it('--muted composites/reads at >=4.5:1 (WCAG AA body-text minimum) against every card surface', () => {
    const { rgb, alpha } = colorToRgbAlpha(extractCssVar(gsText, 'muted'))
    for (const [name, surface] of Object.entries(SURFACES)) {
      const composited = alpha < 1 ? compositeOver(rgb, alpha, surface) : rgb
      const ratio = contrastRatio(composited, surface)
      expect(ratio, `--muted vs ${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('--muted regression guard: is the promoted AA_MUTED value (translucent cream), not the old opaque brown-grey', () => {
    const value = extractCssVar(gsText, 'muted')
    // The old value was the flat hex #8a7460 (no alpha channel at all) --
    // assert the token is now translucent (has an alpha component), which
    // is the actual mechanism that clears 4.5:1 on every surface at once.
    expect(value.startsWith('#')).toBe(false)
    const { alpha } = colorToRgbAlpha(value)
    expect(alpha).toBeLessThan(1)
  })

  it('the global input/select/textarea focus ring is a solid, high-contrast outline, not the old translucent box-shadow', () => {
    const m = gsText.match(/input:focus,textarea:focus,select:focus\{([^}]+)\}/)
    expect(m, 'could not find the input:focus,textarea:focus,select:focus rule in the GS block').toBeTruthy()
    const rule = m[1]
    // Regression guard: the old rule's box-shadow (rgba(232,148,58,.13),
    // alpha-composited over the input's --bg3 background) measured 1.24:1.
    expect(rule).not.toMatch(/box-shadow:0 0 0 3px rgba\(232,148,58,\.13\)/)
    expect(rule).toMatch(/outline:(?:3px )?solid/)
  })

  it('the focus ring outline colour clears 3:1 against every surface it can appear on', () => {
    const m = gsText.match(/input:focus,textarea:focus,select:focus\{([^}]+)\}/)
    const rule = m[1]
    const outlineMatch = rule.match(/outline:(?:3px )?solid (var\(--\w+\)|#[0-9a-f]{3,6}|rgba?\([^)]+\))/i)
    expect(outlineMatch, `expected a solid outline declaration, got: ${rule}`).toBeTruthy()
    let outlineColorToken = outlineMatch[1]
    let outlineRgb
    if (outlineColorToken.startsWith('var(--')) {
      const varName = outlineColorToken.slice(6, -1)
      outlineRgb = hexToRgb(extractCssVar(gsText, varName))
    } else if (outlineColorToken.startsWith('#')) {
      outlineRgb = hexToRgb(outlineColorToken)
    } else {
      outlineRgb = parseRgba(outlineColorToken).rgb
    }
    for (const [name, surface] of Object.entries(SURFACES)) {
      const ratio = contrastRatio(outlineRgb, surface)
      expect(ratio, `focus outline vs ${name}`).toBeGreaterThanOrEqual(3.0)
    }
  })

  it('outline:none is no longer forced on focus (an outline is not being drawn and then hidden)', () => {
    const m = gsText.match(/input:focus,textarea:focus,select:focus\{([^}]+)\}/)
    const rule = m[1]
    expect(rule).not.toMatch(/outline:none/)
  })
})
