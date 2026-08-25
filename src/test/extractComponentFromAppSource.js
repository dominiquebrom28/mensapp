// Sibling to extractFromAppSource.js, for the same reason (App.jsx exports
// nothing but the default `App`, and per task scope we don't add exports or
// otherwise edit App.jsx) -- but extended to handle JSX-bearing component
// declarations, which extractFromAppSource.js's plain `new Function` eval
// can't parse.
//
// Approach:
//  1. Slice the named `const NAME = ...` declaration(s) out of App.jsx's
//     current source text, the same way extractFromAppSource.js does, but
//     supporting the `);`-closed (implicit-return arrow) shape as well as
//     the `};`-closed shape, since both appear among App.jsx's components
//     (e.g. `Card` closes with `);`, `Modal` closes with `};`).
//  2. Strip the JSX down to plain `React.createElement(...)` calls with
//     esbuild's JSX transform, so the extracted source can be evaluated
//     with plain `new Function` -- no JSX parser available at eval time
//     otherwise.
//  3. Run that esbuild transform in a *separate* `node` child process,
//     not in-process. Reason: this project's vitest config runs component
//     tests under `environment: 'jsdom'`, and jsdom's polyfilled
//     TextEncoder fails esbuild's `new TextEncoder().encode("") instanceof
//     Uint8Array` sanity check the moment esbuild's JS API is touched
//     in-process ("Invariant violation" at esbuild startup) -- a documented
//     jsdom/esbuild interaction, not a bug in either. Shelling out to a
//     plain `node -e` subprocess sidesteps it entirely: that process never
//     loads jsdom, so it has a real, unpatched TextEncoder.
//  4. Evaluate the transformed code with `new Function`, injecting `React`
//     (for the `React.createElement` calls esbuild emitted) and whichever
//     hooks the component needs as explicit function parameters -- the
//     same dependency-injection idea extractFromAppSource.js uses for
//     TEAM_AVATARS + normalizeQuiz, just extended to cover React APIs.
//
// Same documented limitation as extractFromAppSource.js: only works for
// module-scope `const NAME = ...` declarations whose closing line is,
// trimmed, exactly `};` or `);`. Good enough for Card/Modal today; if
// App.jsx reformats these, this (like its sibling) will fail loudly rather
// than silently testing stale code.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')

function extractDeclarationSource(sourceLines, name) {
  const startIdx = sourceLines.findIndex((line) => line.trimStart().startsWith(`const ${name} =`))
  if (startIdx === -1) {
    throw new Error(
      `extractComponentFromAppSource: could not find "const ${name} =" as a top-level ` +
        `declaration in App.jsx. It may have been renamed, moved, or reformatted -- update ` +
        `the extraction helper.`,
    )
  }
  const firstLine = sourceLines[startIdx]
  const trimmedFirst = firstLine.trim()
  if (trimmedFirst.endsWith(';')) {
    return firstLine
  }
  // The declaration's closer depends on whether it's a block-bodied arrow
  // (`=> {`, must close with a lone `};`) or an implicit-return arrow
  // wrapping parenthesized JSX (`=> (`, must close with a lone `);`).
  // Block bodies commonly contain their own inner `return (...)` (with its
  // own `);`) before the real end, so we must match on the *specific*
  // closer implied by the opener, not "whichever closer line comes first".
  let closer
  if (trimmedFirst.endsWith('{')) {
    closer = '};'
  } else if (trimmedFirst.endsWith('(')) {
    closer = ');'
  } else {
    throw new Error(
      `extractComponentFromAppSource: "const ${name} =" declaration doesn't end its first ` +
        `line with "{" or "(" -- this declaration doesn't fit the extraction heuristic's ` +
        `assumptions.`,
    )
  }
  // Match the closer at the *same indentation as the opening line*, not
  // "the first line anywhere that trims down to it" -- a declaration whose
  // body contains its own multi-line object literal (e.g. Btn's `vr={...}`)
  // closes that inner literal with an indented lone `};` too, which the old
  // trim-and-compare check matched prematurely, truncating the extracted
  // source mid-declaration.
  const indent = firstLine.slice(0, firstLine.length - firstLine.trimStart().length)
  const indentedCloser = indent + closer
  for (let i = startIdx + 1; i < sourceLines.length; i++) {
    if (sourceLines[i] === indentedCloser) {
      return sourceLines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error(
    `extractComponentFromAppSource: found "const ${name} =" but no closing "${closer}" line ` +
      `after it -- this declaration doesn't fit the extraction heuristic's assumptions.`,
  )
}

let cachedLines = null
function getLines() {
  if (!cachedLines) {
    cachedLines = fs.readFileSync(APP_JSX_PATH, 'utf-8').split('\n')
  }
  return cachedLines
}

// Runs in a plain `node` subprocess -- see docblock above for why.
function transformJsxInSubprocess(source) {
  const script = `
    const esbuild = require(${JSON.stringify(path.join(__dirname, '..', '..', 'node_modules', 'esbuild'))});
    const out = esbuild.transformSync(process.argv[1], {
      loader: 'jsx',
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
    });
    process.stdout.write(out.code);
  `
  return execFileSync(process.execPath, ['-e', script, source], { encoding: 'utf-8' })
}

/**
 * Extracts one or more module-scope JSX component `const` declarations from
 * App.jsx's current source text, transforms away the JSX, and evaluates the
 * result, returning the last-named declaration's value.
 *
 * @param {object} deps - values to make available inside the extracted
 *   source, e.g. `{ React, useRef, useEffect }`. Always include `React` if
 *   any extracted component renders JSX.
 * @param {...string} names - component names, in dependency order (a
 *   component that references another named component must be listed
 *   after it, same convention as extractFromAppSource's TEAM_AVATARS +
 *   normalizeQuiz pairing).
 * @returns {any} the value of the last named declaration
 */
export function extractComponentFromApp(deps, ...names) {
  const lines = getLines()
  const rawSnippets = names.map((name) => extractDeclarationSource(lines, name))
  const transformed = transformJsxInSubprocess(rawSnippets.join('\n'))
  const returnName = names[names.length - 1]
  const depNames = Object.keys(deps)
  const fn = new Function(...depNames, `${transformed}\nreturn ${returnName};`)
  return fn(...depNames.map((k) => deps[k]))
}
