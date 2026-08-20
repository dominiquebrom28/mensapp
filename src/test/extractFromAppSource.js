// App.jsx has several genuinely pure, testable helper functions (URL
// parsers, small predicates, a stats reducer) declared as module-scope
// `const`s -- but none of them are exported, and per the task constraints on
// this pass we do not edit App.jsx to add exports.
//
// This module reaches them anyway: it reads App.jsx's source text at test
// time, slices out one specific top-level `const NAME = ...` statement (by
// name), and evaluates that slice in isolation with `new Function`. The
// tests then exercise the *actual current source text* of the helper, not a
// hand-copied re-implementation -- so they will catch a real regression to
// the regex/logic in App.jsx, and (as a bonus) will fail loudly with a clear
// "could not find declaration" error if App.jsx is refactored enough that
// the extraction heuristic no longer matches, rather than silently testing
// stale code.
//
// This is a deliberate, documented workaround for "can't export, can't
// edit the file." It is NOT a substitute for real exports -- see
// src/test/helpers.pure.test.js for the follow-up recommendation.
//
// Limitation: only works for module-scope `const NAME = ...` declarations
// that are either (a) fully self-contained on one line ending in `;`, or
// (b) span multiple lines and close with a lone `};` on its own line
// (which is how every multi-line helper in this file happens to be
// formatted). It will not work for declarations that don't fit that shape.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')

function extractDeclarationSource(sourceLines, name) {
  const startIdx = sourceLines.findIndex((line) => line.trimStart().startsWith(`const ${name}=`))
  if (startIdx === -1) {
    throw new Error(
      `extractFromAppSource: could not find "const ${name}=" as a top-level declaration in App.jsx. ` +
        `It may have been renamed, moved, or reformatted -- update the extraction helper.`,
    )
  }
  const firstLine = sourceLines[startIdx]
  if (firstLine.trim().endsWith(';')) {
    // Whole thing fits on one line already.
    return firstLine
  }
  // Multi-line: scan forward for a line that is just the closing `};`.
  for (let i = startIdx + 1; i < sourceLines.length; i++) {
    if (sourceLines[i].trim() === '};') {
      return sourceLines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error(
    `extractFromAppSource: found "const ${name}=" but no closing "};" line after it -- ` +
      `this declaration doesn't fit the extraction heuristic's assumptions.`,
  )
}

let cachedLines = null
function getLines() {
  if (!cachedLines) {
    cachedLines = fs.readFileSync(APP_JSX_PATH, 'utf-8').split('\n')
  }
  return cachedLines
}

/**
 * Extracts and evaluates one or more module-scope `const` declarations from
 * App.jsx's current source text, returning the last-named one. Pass extra
 * dependency names first when the target helper references another
 * module-scope const (e.g. normalizeQuiz references TEAM_AVATARS).
 *
 * @param  {...string} names
 * @returns {any} the value of the last named declaration
 */
export function extractFromApp(...names) {
  const lines = getLines()
  const snippets = names.map((name) => extractDeclarationSource(lines, name))
  const returnName = names[names.length - 1]
  const fn = new Function(`${snippets.join('\n')}\nreturn ${returnName};`)
  return fn()
}
