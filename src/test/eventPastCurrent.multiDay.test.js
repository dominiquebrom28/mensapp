// QA verification: past/current classification for multi-day events
// (Home.isOver, src/App.jsx:993; EventCard._end/isLive/isUpcoming,
// src/App.jsx:1103-1107).
//
// These are single-line consts scoped inside their component functions
// (not module-scope), so the shared extractFromAppSource.js /
// extractComponentFromAppSource.js utilities (which only handle top-level
// `const NAME = ...` declarations) don't reach them. This file uses the
// same "slice the real current source text, eval it" idea, scoped to the
// one line each helper lives on, so a regression to the actual formula in
// App.jsx fails these tests -- not a hand-copied reimplementation that
// could drift from the real code.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

function extractLine(marker) {
  const line = source.split('\n').find((l) => l.trim().startsWith(marker))
  if (!line) throw new Error(`Could not find a line starting with "${marker}" in App.jsx`)
  return line.trim()
}

// `const isOver=e=>e.archived||new Date(...)<new Date();`
function buildIsOver() {
  const line = extractLine('const isOver=')
  return new Function(`${line}\nreturn isOver;`)()
}

// `const _start=...; const _end=...; const isLive=...; const isUpcoming=...;`
// isUpcoming depends on `countdown.past` and `evt`, so we build a small
// function that takes (evt, countdown, now) and returns {isLive, isUpcoming}
// using the *actual* extracted expressions for _start/_end/isLive/isUpcoming.
function buildEventCardFlags() {
  const startLine = extractLine('const _start=')
  const endLine = extractLine('const _end=')
  const isLiveLine = extractLine('const isLive=')
  const isUpcomingLine = extractLine('const isUpcoming=')
  const body = `
    const _now=now;
    ${startLine}
    ${endLine}
    ${isLiveLine}
    ${isUpcomingLine}
    return {isLive,isUpcoming,_start,_end};
  `
  return new Function('evt', 'countdown', 'now', body)
}

const isOver = buildIsOver()
const evalFlags = buildEventCardFlags()

describe('Home.isOver -- multi-day events (real App.jsx source)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T18:00:00')) // Sunday, mid-afternoon
  })
  afterEach(() => vi.useRealTimers())

  it('a Fri-Sun weekend event is NOT over on the Saturday in the middle', () => {
    vi.setSystemTime(new Date('2026-09-12T12:00:00')) // the Saturday
    const evt = { date: '2026-09-11', end_date: '2026-09-13', end_time: '18:00' }
    expect(isOver(evt)).toBe(false)
  })

  it('a Fri-Sun weekend event is NOT over until end_time on the end_date passes', () => {
    const evt = { date: '2026-09-11', end_date: '2026-09-13', end_time: '18:00' }
    vi.setSystemTime(new Date('2026-09-13T17:59:00'))
    expect(isOver(evt)).toBe(false)
    vi.setSystemTime(new Date('2026-09-13T18:01:00'))
    expect(isOver(evt)).toBe(true)
  })

  it('a single-day event (no end_date) still uses evt.date as before', () => {
    const evt = { date: '2026-09-13', end_time: '18:00' }
    vi.setSystemTime(new Date('2026-09-13T17:59:00'))
    expect(isOver(evt)).toBe(false)
    vi.setSystemTime(new Date('2026-09-13T18:01:00'))
    expect(isOver(evt)).toBe(true)
  })

  it('null, "", and undefined end_date are all treated identically to no end_date at all', () => {
    vi.setSystemTime(new Date('2026-09-13T19:00:00'))
    const base = { date: '2026-09-13', end_time: '18:00' }
    expect(isOver({ ...base, end_date: null })).toBe(true)
    expect(isOver({ ...base, end_date: '' })).toBe(true)
    expect(isOver({ ...base, end_date: undefined })).toBe(true)
    expect(isOver(base)).toBe(true)
  })

  it('archived always wins regardless of dates', () => {
    vi.setSystemTime(new Date('2020-01-01T00:00:00'))
    expect(isOver({ date: '2030-01-01', end_date: '2030-01-05', archived: true })).toBe(true)
  })

  it('defaults end_time to 23:59 when absent, even on a multi-day event', () => {
    const evt = { date: '2026-09-11', end_date: '2026-09-13' } // no end_time
    vi.setSystemTime(new Date('2026-09-13T23:58:00'))
    expect(isOver(evt)).toBe(false)
    vi.setSystemTime(new Date('2026-09-14T00:00:00'))
    expect(isOver(evt)).toBe(true)
  })
})

describe('EventCard isLive / isUpcoming -- multi-day events (real App.jsx source)', () => {
  it('is live for the entire Fri-Sun span, not just the start day', () => {
    const evt = { date: '2026-09-11', end_date: '2026-09-13', start_time: '18:00', end_time: '18:00' }
    const countdownPast = { past: true } // already started

    const beforeStart = evalFlags(evt, { past: false }, new Date('2026-09-11T17:00:00'))
    expect(beforeStart.isLive).toBe(false)
    expect(beforeStart.isUpcoming).toBe(true)

    const fridayEvening = evalFlags(evt, countdownPast, new Date('2026-09-11T19:00:00'))
    expect(fridayEvening.isLive).toBe(true)
    expect(fridayEvening.isUpcoming).toBe(false)

    const saturdayMidday = evalFlags(evt, countdownPast, new Date('2026-09-12T12:00:00'))
    expect(saturdayMidday.isLive).toBe(true)
    expect(saturdayMidday.isUpcoming).toBe(false)

    const sundayBeforeEnd = evalFlags(evt, countdownPast, new Date('2026-09-13T17:59:00'))
    expect(sundayBeforeEnd.isLive).toBe(true)
    expect(sundayBeforeEnd.isUpcoming).toBe(false)

    const sundayAfterEnd = evalFlags(evt, countdownPast, new Date('2026-09-13T18:01:00'))
    expect(sundayAfterEnd.isLive).toBe(false)
    expect(sundayAfterEnd.isUpcoming).toBe(false) // neither live nor upcoming: correctly falls into "past"
  })

  it('countdown.past (start-anchored) is the right signal for isUpcoming: it only needs to answer "has it started", not "has it ended"', () => {
    // Regression guard for the exact concern raised in the QA brief: is
    // useCountdown being driven by evt.date/start_time (not end_date) a
    // latent bug? No -- isLive already independently covers "currently
    // live" using _end (which IS end_date aware), so isUpcoming only ever
    // needs "not started yet", which is exactly what countdown.past means.
    const evt = { date: '2026-09-11', end_date: '2026-09-13', start_time: '18:00', end_time: '18:00' }
    const midSpan = evalFlags(evt, { past: true }, new Date('2026-09-12T12:00:00'))
    expect(midSpan.isUpcoming).toBe(false) // NOT "upcoming" mid-event, even though countdown.past says "started" (correct)
    expect(midSpan.isLive).toBe(true)
  })
})
