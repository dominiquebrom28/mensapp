// Source-level regression guard (security review, additive to the fix
// pass): React does not block a `javascript:` href, so a hand-typed,
// hand-editable schedule-stop Maps URL or poll external link rendered
// straight into `<a href=...>` is stored XSS on click. `isSafeImageUrl`
// (features/trailer/safeUrl.js, already unit-tested in
// trailer/safeUrl.test.js) is the existing http(s)-only guard reused here.
//
// Same wiring-only-verification approach as teamCreatorPage.wiring.test.js
// -- OverviewTab/PollsTab pull in a large dependency graph not worth
// re-injecting for a one-line conditional guard around an already-tested
// pure function. Does NOT cover the schedule-stop link inside
// PresentationMode (App.jsx ~5563) -- out of scope for this pass, per the
// explicit "do not touch PresentationMode" constraint.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

describe('href safety wiring', () => {
  it('the schedule stop location link (OverviewTab) is gated on isSafeImageUrl', () => {
    expect(source).toMatch(/isSafeImageUrl\(s\.locationUrl\)\s*\n\s*\?<a href=\{s\.locationUrl\}/)
  })

  it('the poll external link (PollsTab) is gated on isSafeImageUrl', () => {
    expect(source).toMatch(/\{poll\.link\?\.url&&isSafeImageUrl\(poll\.link\.url\)&&\(/)
  })
})
