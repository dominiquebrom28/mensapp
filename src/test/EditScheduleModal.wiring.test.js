// EditScheduleModal itself is a very large single-JSX-expression component
// (icon picker, per-stop reorder/delete controls, several nested Inp/Btn/Lbl
// dependencies with their own hover-state side effects) that isn't a good
// fit for the render-the-real-component technique used in Modal.test.jsx --
// the payoff of fully mounting it doesn't justify the fragility of chaining
// that many more source extractions together.
//
// Modal.test.jsx already gives strong behavioral coverage of the actual
// fix (the onBackdropClose/onClose fallback + the 350ms grace period).
// What's specific to EditScheduleModal is just its *wiring* into that prop
// -- so this file asserts that wiring directly against App.jsx's current
// source text with targeted regexes, as a lighter-weight (but still
// real-source, not reimplemented) regression guard. If any of these lines
// are ever restructured, these tests fail loudly rather than silently
// passing on stale assumptions.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

function getEditScheduleModalBody() {
  const start = source.indexOf('const EditScheduleModal=')
  expect(start, 'EditScheduleModal declaration not found in App.jsx').toBeGreaterThan(-1)
  const end = source.indexOf('\n};', start)
  expect(end, 'EditScheduleModal closing "};" not found').toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('EditScheduleModal -> Modal wiring (source-level regression guard)', () => {
  it('passes onBackdropClose that saves the in-progress schedule (does not silently discard on backdrop click)', () => {
    const body = getEditScheduleModalBody()
    expect(body).toMatch(/<Modal\s+onClose=\{onClose\}\s+onBackdropClose=\{\(\)\s*=>\s*onSave\(sched\)\}/)
  })

  it('keeps "Discard changes" wired to plain onClose, not onSave -- discard must still discard', () => {
    const body = getEditScheduleModalBody()
    // The Save button explicitly calls onSave(sched)...
    expect(body).toMatch(/<Btn onClick=\{\(\)=>onSave\(sched\)\}>Save<\/Btn>/)
    // ...while the discard button calls onClose directly, with nothing
    // save-shaped anywhere in its onClick.
    const discardBtnMatch = body.match(/<Btn onClick=\{([^}]*)\} variant="ghost">Discard changes<\/Btn>/)
    expect(discardBtnMatch, 'Discard changes button not found with the expected shape').not.toBeNull()
    expect(discardBtnMatch[1]).toBe('onClose')
    expect(discardBtnMatch[1]).not.toMatch(/onSave/)
  })

  it('the single call site wires onSave to persist (onUpdate) and close, and onClose to close only (no persistence)', () => {
    const callSite = source
      .split('\n')
      .find((line) => line.includes('<EditScheduleModal') && line.includes('onSave='))
    expect(callSite, 'EditScheduleModal call site not found').toBeTruthy()

    // onSave: must call onUpdate(...) (persist) AND close the modal.
    expect(callSite).toMatch(/onSave=\{sched=>\{onUpdate\(\{\.\.\.evt,schedule:sched\}\);setEditSched\(false\)\}\}/)

    // onClose: must ONLY close -- no onUpdate call in its body, i.e. no
    // persistence happens on a plain discard.
    const onCloseMatch = callSite.match(/onClose=\{([^}]*)\}/)
    expect(onCloseMatch, 'onClose prop not found at the call site').not.toBeNull()
    expect(onCloseMatch[1]).not.toMatch(/onUpdate/)
    expect(onCloseMatch[1]).toMatch(/setEditSched\(false\)/)
  })
})
