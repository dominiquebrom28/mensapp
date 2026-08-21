#!/usr/bin/env node
// Lint ratchet for CI (ticket #27).
//
// App.jsx currently carries 13 pre-existing ESLint errors and 17 warnings
// (30 total) that have never been fixed. Making lint a hard "zero findings"
// gate would make CI red from its very first run and train everyone to
// ignore it -- worse than no CI. Dropping lint from CI entirely would let
// that debt grow silently.
//
// Instead this is a ratchet: CI fails only if the *current* total findings
// exceed this recorded baseline, i.e. only on *new* problems anywhere in the
// repo (not just changed files -- a stray new violation in an untouched
// file would also be caught). Existing debt is tolerated and tracked
// separately in ticket #28.
//
// When #28 (or any other cleanup) reduces the real count, lower these
// numbers to match -- deliberately, in the same PR as the fix -- so the
// ratchet keeps tightening instead of just sitting at 30 forever. If a
// dependency/rule bump legitimately raises the count, raise these numbers
// with a comment explaining why.
const BASELINE_ERRORS = 13
const BASELINE_WARNINGS = 17
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
console.log('OK -- within baseline. (Pre-existing debt is tracked in ticket #28, not blocked here.)')
