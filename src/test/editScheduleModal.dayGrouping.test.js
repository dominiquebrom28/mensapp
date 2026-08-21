// QA verification for EditScheduleModal's day-grouping / overflow-rescue /
// in-day-reorder logic (priority areas #4 and #6 of the per-day-scheduling
// review): `groups`, `overflowIdxs`, `moveInDay`, `inRange`, `dayCount` are
// all local consts scoped inside the EditScheduleModal component function,
// not module-scope exports -- so the shared extractFromAppSource.js /
// extractComponentFromAppSource.js utilities (which only handle top-level
// `const NAME = ...` declarations) don't reach them, and EditScheduleModal
// itself is a large single-JSX-expression component that (per
// EditScheduleModal.wiring.test.js's existing docblock) isn't a good fit
// for full-mount extraction. This file uses the same "slice the real,
// current source text, eval it" technique as
// eventPastCurrent.multiDay.test.js, scoped to exactly the handful of
// lines that implement the grouping/rescue/reorder logic -- so a
// regression to the actual formulas in App.jsx fails these tests, not a
// hand-copied reimplementation that could silently drift from the real
// code.
//
// What this does NOT cover: the actual React rendering (JSX, the Dag
// <select>, per-day "+ Add Stop" buttons) -- see
// presentationModeOrder.test.jsx's docblock for why a full component mount
// was judged worth the extra engineering cost for PresentationMode (the
// highest-risk change) but is not attempted here.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const sourceLines = fs.readFileSync(APP_JSX_PATH, 'utf-8').split('\n')

// EditScheduleModal's declaration line -- markers below are searched for
// only *after* this point, because at least one marker (`const stopDay=`)
// also matches an unrelated same-named local inside OverviewTab's render
// loop (src/App.jsx:1666, a per-stop `const stopDay=s.day??0;`, not the
// `s=>s.day??0` arrow function this file actually wants) earlier in the
// file -- an unscoped search would silently grab the wrong one.
const editScheduleModalStart = sourceLines.findIndex((l) => l.trim().startsWith('const EditScheduleModal=('))
if (editScheduleModalStart === -1) {
  throw new Error('editScheduleModal.dayGrouping.test.js: could not find "const EditScheduleModal=(" in App.jsx.')
}
const scopedLines = sourceLines.slice(editScheduleModalStart)

function extractLine(marker) {
  const line = scopedLines.find((l) => l.trim().startsWith(marker))
  if (!line) throw new Error(`editScheduleModal.dayGrouping.test.js: could not find a line starting with "${marker}" in App.jsx (searched from EditScheduleModal's declaration onward).`)
  return line.trim()
}

// For the one multi-line block (moveInDay): find the start line, then scan
// forward for the first line that trims to exactly "};" -- moveInDay's body
// has no nested arrow function that itself closes on its own "};" line (its
// one nested callback closes as "});", not "};"), so this is unambiguous
// for this specific block. (Contrast with PresentationMode, where this
// naive heuristic breaks -- see presentationModeOrder.test.jsx.)
function extractBlock(marker) {
  const startIdx = scopedLines.findIndex((l) => l.trim().startsWith(marker))
  if (startIdx === -1) {
    throw new Error(`editScheduleModal.dayGrouping.test.js: could not find a line starting with "${marker}" in App.jsx.`)
  }
  for (let i = startIdx + 1; i < scopedLines.length; i++) {
    if (scopedLines[i].trim() === '};') {
      return scopedLines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error(`editScheduleModal.dayGrouping.test.js: no closing "};" found for "${marker}".`)
}

const stopDayLine = extractLine('const stopDay=')
const dayCountLine = extractLine('const dayCount=')
const inRangeLine = extractLine('const inRange=')
const groupsLine = extractLine('const groups=')
const overflowIdxsLine = extractLine('const overflowIdxs=')
const moveInDayBlock = extractBlock('const moveInDay=(i,d)=>{')

// Builds { dayCount, groups, overflowIdxs } for a given (evt, sched), using
// App.jsx's real, current expressions -- this is EditScheduleModal's exact
// grouping logic, just evaluated outside of React.
function computeGrouping(evt, sched) {
  const body = `
    ${stopDayLine}
    ${dayCountLine}
    ${inRangeLine}
    ${groupsLine}
    ${overflowIdxsLine}
    return {dayCount,groups,overflowIdxs};
  `
  // eventDayCount is a free variable inside dayCountLine -- inject it.
  return new Function('evt', 'sched', 'eventDayCount', body)(evt, sched, eventDayCount)
}

// eventDayCount reimplemented identically to App.jsx (src/App.jsx:297-303)
// for this file's own use as a dependency of the extracted dayCount line --
// its own correctness is already covered by scheduleDays.test.js against
// the real extracted source, so re-deriving it by hand here (rather than
// re-extracting it) doesn't weaken this file's guarantees.
function eventDayCount(dateStr, endDateStr) {
  if (!dateStr || !endDateStr || endDateStr === dateStr) return 1
  const start = new Date(dateStr + 'T12:00:00')
  const end = new Date(endDateStr + 'T12:00:00')
  const days = Math.round(Math.abs(end - start) / 86400000)
  return days + 1
}

// Builds a callable moveInDay(sched, i, d) -> newSched, using the real
// extracted moveInDay body, wired to a fake setSched that just captures
// whatever the real updater function computes.
function buildMoveInDay(sched) {
  let result = null
  const setSched = (updater) => {
    result = typeof updater === 'function' ? updater(sched) : updater
  }
  const fn = new Function(
    'sched',
    'setSched',
    `
    ${stopDayLine}
    ${moveInDayBlock}
    return moveInDay;
  `,
  )
  const moveInDay = fn(sched, setSched)
  return (i, d) => {
    result = null
    moveInDay(i, d)
    return result // null if the move was a no-op (out of bounds within the group)
  }
}

describe('EditScheduleModal day grouping (real App.jsx source)', () => {
  it('a true single-day event (no end_date) groups every stop under day 0, no overflow', () => {
    const evt = { date: '2026-09-12', end_date: undefined }
    const sched = [{ day: 0, activity: 'A' }, { day: 0, activity: 'B' }]
    const { dayCount, groups, overflowIdxs } = computeGrouping(evt, sched)
    expect(dayCount).toBe(1)
    expect(groups).toHaveLength(1)
    expect(groups[0].idxs).toEqual([0, 1])
    expect(overflowIdxs).toEqual([])
  })

  it('a stop with no `day` field at all is treated as day 0 (legacy pre-multi-day data)', () => {
    const evt = { date: '2026-09-12', end_date: undefined }
    const sched = [{ activity: 'legacy, no day field' }]
    const { groups, overflowIdxs } = computeGrouping(evt, sched)
    expect(groups[0].idxs).toEqual([0])
    expect(overflowIdxs).toEqual([])
  })

  it('a 3-day event groups stops into 3 day-buckets, including empty ones', () => {
    const evt = { date: '2026-09-11', end_date: '2026-09-13' }
    const sched = [{ day: 0, activity: 'Fri' }, { day: 2, activity: 'Sun' }] // nothing on day 1
    const { dayCount, groups } = computeGrouping(evt, sched)
    expect(dayCount).toBe(3)
    expect(groups.map((g) => g.idxs)).toEqual([[0], [], [1]])
  })

  describe('overflow rescue -- data loss is the worst-case failure here', () => {
    it('a stop with day beyond the event range is NEVER dropped from `sched` -- it appears in overflowIdxs, not nowhere', () => {
      const evt = { date: '2026-09-11', end_date: '2026-09-12' } // 2-day event, valid days 0-1
      const sched = [
        { day: 0, activity: 'in range' },
        { day: 5, activity: 'way out of range' },
      ]
      const { groups, overflowIdxs } = computeGrouping(evt, sched)
      // the array itself is untouched -- both entries are still present at
      // their original indices; grouping logic only classifies them.
      expect(sched).toHaveLength(2)
      expect(overflowIdxs).toEqual([1])
      expect(groups.flatMap((g) => g.idxs)).toEqual([0]) // only the in-range one is in a day-group
    })

    it('the shrink path: event goes from 3 days to 1 day, stops on days 1-2 become overflow but stay addressable, never filtered out of `sched`', () => {
      const shrunkEvt = { date: '2026-09-11', end_date: undefined } // now single-day
      const sched = [
        { day: 0, activity: 'day0-stays-fine' },
        { day: 1, activity: 'day1-now-orphaned' },
        { day: 2, activity: 'day2-now-orphaned' },
      ]
      const { dayCount, groups, overflowIdxs } = computeGrouping(shrunkEvt, sched)
      expect(dayCount).toBe(1)
      expect(groups).toHaveLength(1)
      expect(groups[0].idxs).toEqual([0])
      expect(overflowIdxs).toEqual([1, 2]) // both orphaned stops are reachable via the overflow group
      expect(sched).toHaveLength(3) // nothing removed from the underlying array
    })

    it('a negative day (defensive / hand-edited data) is also treated as overflow, not silently coerced into day 0', () => {
      const evt = { date: '2026-09-11', end_date: '2026-09-12' }
      const sched = [{ day: -1, activity: 'negative day' }]
      const { overflowIdxs, groups } = computeGrouping(evt, sched)
      expect(overflowIdxs).toEqual([0])
      expect(groups.flatMap((g) => g.idxs)).toEqual([])
    })
  })

  describe('moveInDay -- reorders within a day group only, real extracted algorithm', () => {
    it('moving a stop up/down only swaps with its same-day neighbour, skipping interleaved other-day stops', () => {
      // Flat array interleaves day 0 and day 1 stops.
      const sched = [
        { day: 0, activity: 'd0-first' }, // idx 0
        { day: 1, activity: 'd1-first' }, // idx 1
        { day: 0, activity: 'd0-second' }, // idx 2
        { day: 1, activity: 'd1-second' }, // idx 3
      ]
      const move = buildMoveInDay(sched)
      // Move idx 2 ("d0-second") up within its day-0 group -- its same-day
      // neighbour is idx 0 ("d0-first"), NOT idx 1 (which is day 1).
      const next = move(2, -1)
      expect(next.map((s) => s.activity)).toEqual(['d0-second', 'd1-first', 'd0-first', 'd1-second'])
      // day-1 entries (idx 1, idx 3) are completely untouched by this move
      expect(next[1]).toBe(sched[1])
      expect(next[3]).toBe(sched[3])
    })

    it('is a no-op at the top/bottom edge of a day group (does not spill into an adjacent day)', () => {
      const sched = [
        { day: 0, activity: 'd0-only' }, // idx 0, alone in its group
        { day: 1, activity: 'd1-a' },
      ]
      const move = buildMoveInDay(sched)
      expect(move(0, -1)).toBeNull() // no earlier same-day neighbour
      expect(move(0, 1)).toBeNull() // no later same-day neighbour either
    })
  })
})

describe('Editor manual order vs (day,time) display order -- consequence characterization (priority area #6)', () => {
  // scheduleDayTimeOrder is already unit-tested directly in
  // scheduleDays.test.js; this describes its *consequence* for the editor
  // workflow specifically, using the same extracted comparator, so the
  // characterization stays pinned to real source behavior.
  const marker = 'const scheduleDayTimeOrder='
  const line = sourceLines.find((l) => l.trim().startsWith(marker))
  const scheduleDayTimeOrder = new Function(`${line}\nreturn scheduleDayTimeOrder;`)()
  const displayOrder = (sched) => [...sched].sort(scheduleDayTimeOrder).map((s) => s.activity)

  it('moving a stop ABOVE an earlier-timed stop in the editor array has NO effect on display order -- (day,time) always wins', () => {
    // Editor array order: "later" stop physically placed first (as if
    // someone dragged it above "earlier" with the ↑ button).
    const editorOrder = [
      { day: 0, time: '20:00', activity: 'later' },
      { day: 0, time: '09:00', activity: 'earlier' },
    ]
    // Display still shows the earlier-time stop first, i.e. the OPPOSITE
    // of the editor's manual array order -- this is the exact consequence
    // to flag to the product owner.
    expect(displayOrder(editorOrder)).toEqual(['earlier', 'later'])
  })

  it('the ONLY way manual reordering in the editor actually changes display order is among stops that tie on (day,time) -- equal or both-blank times', () => {
    // Two stops sharing the exact same time: the stable sort keeps
    // whichever is first in the editor's manual array order first on
    // screen -- so ↑/↓ DOES matter here, unlike the differing-time case.
    const tiedEditorOrderA = [
      { day: 0, time: '12:00', activity: 'X' },
      { day: 0, time: '12:00', activity: 'Y' },
    ]
    expect(displayOrder(tiedEditorOrderA)).toEqual(['X', 'Y'])

    const tiedEditorOrderB = [
      { day: 0, time: '12:00', activity: 'Y' },
      { day: 0, time: '12:00', activity: 'X' },
    ]
    expect(displayOrder(tiedEditorOrderB)).toEqual(['Y', 'X']) // manual order now visibly flipped the display
  })

  it('two stops with blank times on the same day also tie -- manual order controls display among them', () => {
    const editorOrder = [
      { day: 0, time: '', activity: 'first-blank' },
      { day: 0, time: '', activity: 'second-blank' },
    ]
    expect(displayOrder(editorOrder)).toEqual(['first-blank', 'second-blank'])
  })
})
