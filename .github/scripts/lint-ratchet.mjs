#!/usr/bin/env node
// Lint ratchet for CI (ticket #27).
//
// Ticket #28 (2026-08-21) cleaned up the 30 pre-existing findings (13 errors,
// 17 warnings) that used to live here, all in App.jsx: unescaped JSX
// apostrophes, dead/never-wired code (an unfinished quiz-image bucket
// picker, an unused legacy `saveEvents` write path, unused params/vars),
// two stale `eslint-disable` directives, three silently-swallowed
// `catch{}` blocks (now documented instead of empty), one genuine
// stale-closure fix (`useCountdown` wasn't re-arming its interval when
// `startTime` changed), and a handful of `react-hooks/exhaustive-deps`
// findings that were legitimately dependency-free (the "missing" deps are
// derived every render from a non-memoized `normalizeQuiz(rawQuiz)` call,
// so including them would restart in-progress quiz timers on unrelated
// re-renders) -- those got scoped, reasoned `eslint-disable-next-line`s.
//
// The repo is lint-clean now, so the ratchet is tightened to zero: CI fails
// on *any* new finding anywhere in the repo. If a dependency/rule bump
// legitimately raises the count, raise these numbers with a comment
// explaining why -- don't silently let debt back in.
const BASELINE_ERRORS = 0
const BASELINE_WARNINGS = 0
const BASELINE_TOTAL = BASELINE_ERRORS + BASELINE_WARNINGS

import { readFileSync } from 'node:fs'

const reportPath = process.argv[2]
if (!reportPath) {
  console.error('Usage: node lint-ratchet.mjs <eslint-json-report-path>')
  process.exit(2)
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (err) {
  console.error(`Could not read/parse ESLint report at ${reportPath}: ${err.message}`)
  process.exit(2)
}

let errors = 0
let warnings = 0
for (const file of report) {
  errors += file.errorCount
  warnings += file.warningCount
}
const total = errors + warnings

console.log(`ESLint: ${errors} errors, ${warnings} warnings (${total} total problems).`)
console.log(`Baseline: ${BASELINE_ERRORS} errors + ${BASELINE_WARNINGS} warnings = ${BASELINE_TOTAL} total.`)

if (total > BASELINE_TOTAL) {
  console.error('')
  console.error(`FAIL -- lint findings (${total}) exceed the baseline (${BASELINE_TOTAL}).`)
  console.error('New lint problems were introduced. Fix them before merging, or if the')
  console.error('baseline itself needs to move deliberately, update BASELINE_ERRORS /')
  console.error('BASELINE_WARNINGS in .github/scripts/lint-ratchet.mjs with a reason.')
  process.exit(1)
}

console.log('')
console.log('OK -- within baseline. (Baseline is 0 since ticket #28; any finding here is new.)')
