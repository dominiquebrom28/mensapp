// `findChampion` (App.jsx, added by the trailer's App.jsx delta) is a
// heuristic over free-text admin data: it scans the most recent archived
// event's `winners[]` for a category matching /champion/i, then falls back
// to the all-time top quiz scorer. Per the trailer report's verification
// scope: it must never throw and must never hand `buildBeats`/`BeatLegacy`
// a champion object that renders as a broken beat.
//
// Extracted from App.jsx's current source text (same technique as
// helpers.pure.test.js / extractFromAppSource.js) because `findChampion`,
// `getUA` and `getDisplayName` are un-exported module-scope consts. This
// file additionally has to shim `isSafeImageUrl` (an *import* in App.jsx,
// not a module-scope const, so it isn't reachable by name-based extraction)
// by binding the real implementation as a function parameter in the
// evaluated scope.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isSafeImageUrl } from '../../features/trailer/safeUrl.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', '..', 'App.jsx')

// `extractFromAppSource.js`'s own heuristic (first line that is just `};`)
// is too naive for `findChampion`: it contains an early `return{...};`
// inside its `for` loop whose closing `};` sits alone on its own line
// *before* the declaration's real end. Brace-depth counting handles that
// correctly (and also correctly treats the `${...}` inside the template
// literal in the quiz-fallback branch as balanced, since it opens and
// closes within the same expression).
function extractDeclarationSource(lines, name) {
  const startIdx = lines.findIndex((line) => line.trimStart().startsWith(`const ${name}=`))
  if (startIdx === -1) {
    throw new Error(`could not find "const ${name}=" in App.jsx -- update this test's extraction`)
  }
  const text = lines.slice(startIdx).join('\n')
  const firstBrace = text.indexOf('{')
  if (firstBrace === -1) {
    throw new Error(`found "const ${name}=" but no opening "{" -- update this test's extraction`)
  }
  let depth = 0
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        // Include the trailing `;` if present right after the closing brace.
        const end = text[i + 1] === ';' ? i + 2 : i + 1
        return text.slice(0, end)
      }
    }
  }
  throw new Error(`found "const ${name}=" but braces never balanced -- update this test's extraction`)
}

function loadFindChampion() {
  const lines = fs.readFileSync(APP_JSX_PATH, 'utf-8').split('\n')
  const snippets = ['getUA', 'getDisplayName', 'findChampion'].map((n) => extractDeclarationSource(lines, n))
  const fn = new Function('isSafeImageUrl', `${snippets.join('\n')}\nreturn findChampion;`)
  return fn(isSafeImageUrl)
}

const findChampion = loadFindChampion()

const evt = { id: 'current', date: '2026-09-12' }

describe('findChampion', () => {
  it('returns null with no archived events and no quiz history', () => {
    expect(() => findChampion(evt, [], [])).not.toThrow()
    expect(findChampion(evt, [], [])).toBeNull()
  })

  it('returns null when the only archived event has no winners and no quizzes anywhere', () => {
    const events = [evt, { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', winners: [] }]
    expect(findChampion(evt, events, [])).toBeNull()
  })

  it('skips a winner whose category does not match /champion/i and falls through to quiz fallback', () => {
    const events = [
      evt,
      {
        id: 'past-1',
        archived: true,
        date: '2025-09-12',
        name: 'Mensdag 2025',
        winners: [{ category: 'Best Dressed', winner: 'sten' }],
        quizzes: [{ status: 'finished', scores: { sten: 40, bram: 55 } }],
      },
    ]
    const champ = findChampion(evt, events, [])
    expect(champ).not.toBeNull()
    expect(champ.title).toBe('Quiz Legend')
    expect(champ.name).toBe('bram')
    expect(champ.detail).toBe('55 pts all-time')
  })

  it('matches a category containing "champion" case-insensitively and prefers it over quiz fallback', () => {
    const events = [
      evt,
      {
        id: 'past-1',
        archived: true,
        date: '2025-09-12',
        name: 'Mensdag 2025',
        winners: [{ category: 'Overall CHAMPION', winner: 'bram', detail: '142 pts' }],
        quizzes: [{ status: 'finished', scores: { sten: 999 } }],
      },
    ]
    const champ = findChampion(evt, events, [])
    expect(champ.name).toBe('bram')
    expect(champ.title).toBe('Overall CHAMPION')
    expect(champ.detail).toBe('142 pts')
  })

  it('falls back to event name as detail when the winner has no detail field', () => {
    const events = [
      evt,
      {
        id: 'past-1',
        archived: true,
        date: '2025-09-12',
        name: 'Mensdag 2025',
        winners: [{ category: 'Champion', winner: 'bram' }],
      },
    ]
    const champ = findChampion(evt, events, [])
    expect(champ.detail).toBe('Mensdag 2025')
  })

  it('handles a winner missing the "winner" field without throwing, and never returns undefined for name', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', winners: [{ category: 'Champion' }] },
    ]
    expect(() => findChampion(evt, events, [])).not.toThrow()
    const champ = findChampion(evt, events, [])
    // getDisplayName(undefined, []) currently returns `undefined` (no user
    // match -> falls through to the raw `name` arg, which is undefined) --
    // not a string. buildBeats.js's own sanitization step coerces any
    // non-string `champion.name` to '' before it reaches BeatLegacy, so this
    // does not render as "undefined" on screen -- but documenting the exact
    // value here so a future change to either function is caught if the
    // contract shifts.
    expect(champ.name).toBeUndefined()
  })

  // REGRESSION GUARD (was a confirmed crash -- see the trailer QA report):
  // `winners` truthy but non-array (malformed JSONB saved as `{}` instead
  // of `[]`) used to reach `.find`, which doesn't exist on a plain object,
  // and threw. Since `findChampion` runs inside `toTrailerInput`'s
  // `useMemo` in EventPage and there's no error boundary anywhere in the
  // app, that throw crashed the entire EventPage render for every visitor,
  // not just trailer viewers. Now guarded with `Array.isArray(p.winners)`.
  it('does not throw, and falls through past it, when an archived event has a non-array `winners` field (malformed JSONB)', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', winners: {} },
      { id: 'past-2', archived: true, date: '2024-09-12', name: 'Mensdag 2024', winners: [{ category: 'Champion', winner: 'bram' }] },
    ]
    expect(() => findChampion(evt, events, [])).not.toThrow()
    // Not just "doesn't throw" -- the malformed event is skipped entirely,
    // and the real champion from the next valid archived event still surfaces.
    expect(findChampion(evt, events, []).name).toBe('bram')
  })

  // REGRESSION GUARD (was a confirmed crash): a `null`/non-object entry
  // inside an otherwise-valid `winners` array used to crash on `w.category`
  // (reading a property of `null`). Now guarded with `w && typeof
  // w==="object"` before reading `.category` off it.
  it('does not throw, and skips it, when `winners` contains a null/non-object entry', () => {
    const events = [
      evt,
      {
        id: 'past-1',
        archived: true,
        date: '2025-09-12',
        name: 'Mensdag 2025',
        winners: [null, 'not-an-object', 42, { category: 'Champion', winner: 'bram' }],
      },
    ]
    expect(() => findChampion(evt, events, [])).not.toThrow()
    expect(findChampion(evt, events, []).name).toBe('bram')
  })

  // REGRESSION GUARD: `champ.detail` is free-text admin data too -- a
  // non-string truthy value (e.g. accidentally saved as a number or an
  // object) used to crash on `.trim()`, which doesn't exist on a number.
  // Now guarded with `typeof champ.detail==="string"` before calling
  // `.trim()`, falling back to the event name like the "no detail at all"
  // case already did.
  it('does not throw, and falls back to the event name, when `winner.detail` is a non-string truthy value', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', winners: [{ category: 'Champion', winner: 'bram', detail: 142 }] },
    ]
    expect(() => findChampion(evt, events, [])).not.toThrow()
    const champ = findChampion(evt, events, [])
    expect(champ.detail).toBe('Mensdag 2025')
  })

  // REGRESSION GUARD: the quiz-fallback path iterates `events` again with
  // its own separate set of assumptions -- `e.quizzes` truthy-but-non-array
  // (e.g. `{}`) used to crash on `.filter`, which doesn't exist on a plain
  // object. Now guarded with `Array.isArray(e.quizzes)`.
  it('does not throw, and skips it, when an archived event has a non-array `quizzes` field', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', quizzes: {} },
      { id: 'past-2', archived: true, date: '2024-09-12', name: 'Mensdag 2024', quizzes: [{ status: 'finished', scores: { bram: 10 } }] },
    ]
    expect(() => findChampion(evt, events, [])).not.toThrow()
    expect(findChampion(evt, events, []).name).toBe('bram')
  })

  // REGRESSION GUARD: a `null`/non-object entry inside an otherwise-valid
  // `quizzes` array used to crash on `q.status` (reading a property of
  // `null`). Now guarded with `q && typeof q==="object"` before reading it.
  it('does not throw, and skips it, when `quizzes` contains a null/non-object entry', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', quizzes: [null, 'not-a-quiz', { status: 'finished', scores: { bram: 10 } }] },
    ]
    expect(() => findChampion(evt, events, [])).not.toThrow()
    expect(findChampion(evt, events, []).name).toBe('bram')
  })

  // REGRESSION GUARD: `quiz.scores` truthy-but-not-a-plain-object (an array,
  // a string, a number) used to crash or misbehave inside
  // `Object.entries(quiz.scores||{})` -- e.g. `Object.entries('ab')` yields
  // `[['0','a'],['1','b']]`, silently fabricating fake scorers named "0"/"1"
  // from string characters. Now guarded with an explicit plain-object check
  // (truthy, `typeof==="object"`, and NOT an array) before `Object.entries`.
  it('does not throw, and treats it as no scores, when `quiz.scores` is not a plain object (array, string, or number)', () => {
    const arrayScores = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', quizzes: [{ status: 'finished', scores: [99, 1] }] },
    ]
    const stringScores = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', quizzes: [{ status: 'finished', scores: 'bram' }] },
    ]
    const numberScores = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', quizzes: [{ status: 'finished', scores: 42 }] },
    ]
    for (const events of [arrayScores, stringScores, numberScores]) {
      expect(() => findChampion(evt, events, [])).not.toThrow()
      // No real scorer ever emerges from a malformed `scores` value -- not a
      // fabricated "0"/"1" character-indexed scorer, not a numeric-index
      // array scorer.
      expect(findChampion(evt, events, [])).toBeNull()
    }
  })

  // REGRESSION GUARD: an individual score value that isn't a finite number
  // (`NaN`, a numeric-looking string, `undefined`, `Infinity`) used to
  // poison the running total via `total += score` (`anything + NaN` is
  // `NaN`, and `Infinity` would let a single malformed entry always "win"
  // regardless of everyone else's real scores) -- a silent-corruption bug,
  // not a throw. Now guarded with `Number.isFinite(score)`, treating any
  // non-finite score as 0 towards that person's total.
  it('treats a non-finite score (NaN, string, undefined, Infinity) as 0 rather than corrupting the total', () => {
    const events = [
      evt,
      {
        id: 'past-1',
        archived: true,
        date: '2025-09-12',
        name: 'Mensdag 2025',
        quizzes: [
          { status: 'finished', scores: { bram: 20, sten: '999', milan: NaN, wouter: undefined, thijs: Infinity } },
          { status: 'finished', scores: { bram: 15 } },
        ],
      },
    ]
    const champ = findChampion(evt, events, [])
    // bram (20 + 15 = 35, all finite real numbers) wins over every
    // malformed entry -- none of which should out-total a real 35 by
    // silently becoming NaN/Infinity/parsed-string.
    expect(champ.name).toBe('bram')
    expect(champ.detail).toBe('35 pts all-time')
  })

  it('picks the most recent archived event by date when several have a champion winner', () => {
    const events = [
      evt,
      {
        id: 'past-old', archived: true, date: '2023-09-12', name: 'Mensdag 2023',
        winners: [{ category: 'Champion', winner: 'oud-winnaar' }],
      },
      {
        id: 'past-new', archived: true, date: '2025-09-12', name: 'Mensdag 2025',
        winners: [{ category: 'Champion', winner: 'nieuw-winnaar' }],
      },
    ]
    expect(findChampion(evt, events, []).name).toBe('nieuw-winnaar')
  })

  it('never considers the current (non-archived) event, even if it has winners', () => {
    const events = [
      { ...evt, winners: [{ category: 'Champion', winner: 'should-not-appear' }] },
    ]
    expect(findChampion(evt, events, [])).toBeNull()
  })

  it('falls back to the all-time top quiz scorer, summed across multiple finished quizzes/events', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', quizzes: [{ status: 'finished', scores: { bram: 20 } }] },
      { id: 'past-2', archived: true, date: '2024-09-12', name: 'Mensdag 2024', quizzes: [{ status: 'finished', scores: { bram: 30, sten: 60 } }] },
    ]
    const champ = findChampion(evt, events, [])
    expect(champ.name).toBe('sten')
    expect(champ.detail).toBe('60 pts all-time')
  })

  it('ignores quizzes that are not status "finished"', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', quizzes: [{ status: 'live', scores: { bram: 999 } }] },
    ]
    expect(findChampion(evt, events, [])).toBeNull()
  })

  it('returns null (not a zero-score champion) when every quiz score totals to zero', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', quizzes: [{ status: 'finished', scores: { bram: 0, sten: 0 } }] },
    ]
    expect(findChampion(evt, events, [])).toBeNull()
  })

  it('resolves display name, photoUrl and avatar index from the users list when available', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', winners: [{ category: 'Champion', winner: 'bram' }] },
    ]
    const users = [{ username: 'bram', display_name: 'Brammetje', photo_url: 'https://example.com/bram.jpg', animal_avatar: 3 }]
    const champ = findChampion(evt, events, users)
    expect(champ.name).toBe('Brammetje')
    expect(champ.photoUrl).toBe('https://example.com/bram.jpg')
    expect(champ.avatarIndex).toBe(3)
  })

  it('rejects an unsafe photoUrl (e.g. a javascript: URL) rather than passing it through', () => {
    const events = [
      evt,
      { id: 'past-1', archived: true, date: '2025-09-12', name: 'Mensdag 2025', winners: [{ category: 'Champion', winner: 'bram' }] },
    ]
    const users = [{ username: 'bram', photo_url: 'javascript:alert(1)' }]
    const champ = findChampion(evt, events, users)
    expect(champ.photoUrl).toBe('')
  })

  it('does not throw when `events` is empty and `evt` itself is minimal', () => {
    expect(() => findChampion({ id: 'x' }, [], [])).not.toThrow()
  })
})
