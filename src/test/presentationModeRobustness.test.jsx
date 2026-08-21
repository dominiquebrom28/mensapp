// Regression coverage for ticket 3.5a/3.5b (PresentationMode viewer
// robustness): before this fix, `applySlide` took the slide index straight
// off a broadcast/presence payload with no bounds check against the
// viewer's OWN schedule length, and the broadcast payload carried a
// *display position* (`idx`) rather than the stop's own identity -- so any
// divergence between presenter and viewer schedules (a stop added and one
// phone hasn't synced, flaky wifi, a late joiner whose own event data
// resolves after presence) could either throw (dead screen, no error
// boundary anywhere in this app) or silently show the WRONG stop.
//
// This mounts the actual, current PresentationMode component via the same
// source-extraction technique as presentationModeOrder.test.jsx (not a
// hand-copied reimplementation), and drives it with fake presence/broadcast
// payloads that describe a schedule different from the mounted viewer's own
// `evt`, to exercise the clamp and the realIdx-vs-legacy-idx resolution
// directly.
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', 'App.jsx')
const ESBUILD_PATH = path.join(__dirname, '..', '..', 'node_modules', 'esbuild')

// Same extraction machinery as presentationModeOrder.test.jsx -- see that
// file's docblock for the full rationale of each piece.
function extractNoSpaceDecl(sourceLines, name) {
  const startIdx = sourceLines.findIndex((line) => {
    const t = line.trimStart()
    return t.startsWith(`const ${name}=`) || t.startsWith(`const ${name} =`)
  })
  if (startIdx === -1) {
    throw new Error(`presentationModeRobustness.test.jsx: could not find "const ${name}=" (or "const ${name} =") in App.jsx.`)
  }
  const firstLine = sourceLines[startIdx]
  const trimmedFirst = firstLine.trim()
  if (trimmedFirst.endsWith(';')) return firstLine
  const closer = trimmedFirst.endsWith('{') ? '};' : trimmedFirst.endsWith('(') ? ');' : null
  if (!closer) {
    throw new Error(`presentationModeRobustness.test.jsx: "const ${name}=" doesn't end in "{" or "(".`)
  }
  for (let i = startIdx + 1; i < sourceLines.length; i++) {
    if (sourceLines[i].trim() === closer) {
      return sourceLines.slice(startIdx, i + 1).join('\n')
    }
  }
  throw new Error(`presentationModeRobustness.test.jsx: no closing "${closer}" found for "const ${name}=".`)
}

function extractBraceMatchedDecl(fullSource, name) {
  const declRe = new RegExp(`const ${name}=\\(([\\s\\S]*?)\\)=>\\{`)
  const m = declRe.exec(fullSource)
  if (!m) {
    throw new Error(`presentationModeRobustness.test.jsx: could not find "const ${name}=(...)=>{" in App.jsx.`)
  }
  let i = m.index + m[0].length - 1
  const end = fullSource.length
  let depth = 0
  const frames = [{ type: 'code' }]
  while (i < end) {
    const top = frames[frames.length - 1]
    if (top.type === 'template') {
      const c = fullSource[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '`') {
        frames.pop()
        i++
        continue
      }
      if (c === '$' && fullSource[i + 1] === '{') {
        depth++
        frames.push({ type: 'code-from-template', matchDepth: depth })
        i += 2
        continue
      }
      i++
      continue
    }
    const c = fullSource[i]
    const c2 = c + (fullSource[i + 1] || '')
    if (c2 === '//') {
      const nl = fullSource.indexOf('\n', i)
      i = nl === -1 ? end : nl + 1
      continue
    }
    if (c2 === '/*') {
      const close = fullSource.indexOf('*/', i + 2)
      i = close === -1 ? end : close + 2
      continue
    }
    if (c === "'" || c === '"') {
      const quote = c
      i++
      while (i < end) {
        if (fullSource[i] === '\\') {
          i += 2
          continue
        }
        if (fullSource[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === '`') {
      frames.push({ type: 'template' })
      i++
      continue
    }
    if (c === '{') {
      depth++
      i++
      continue
    }
    if (c === '}') {
      depth--
      i++
      const cur = frames[frames.length - 1]
      if (cur.type === 'code-from-template' && depth === cur.matchDepth - 1) {
        frames.pop()
        continue
      }
      if (depth === 0 && frames.length === 1) {
        return fullSource.slice(m.index, i) + ';'
      }
      continue
    }
    i++
  }
  throw new Error(`presentationModeRobustness.test.jsx: brace matching for "const ${name}=" never returned to depth 0.`)
}

function transformJsxInSubprocess(source) {
  const script = `
    const esbuild = require(${JSON.stringify(ESBUILD_PATH)});
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

function extractPresentationMode() {
  const fullSource = fs.readFileSync(APP_JSX_PATH, 'utf-8')
  const lines = fullSource.split('\n')
  const flatNames = [
    'formatEventDateRange',
    'eventDayCount',
    'dateForEventDay',
    'dayHeadingLabel',
    'padTimeForSort',
    'scheduleDayTimeOrder',
    'useIsMobile',
  ]
  const raw =
    flatNames.map((n) => extractNoSpaceDecl(lines, n)).join('\n') +
    '\n' +
    extractBraceMatchedDecl(fullSource, 'PresentationMode')
  const transformed = transformJsxInSubprocess(raw)
  const fn = new Function(
    'React',
    'useState',
    'useEffect',
    'useRef',
    'useCallback',
    'supabase',
    `${transformed}\nreturn PresentationMode;`,
  )
  return fn
}

// Fake realtime channel that also records its `.on()` handlers (keyed
// `${type}:${event}`) so a test can simulate an incoming presence sync or
// broadcast directly, and exposes track/send as spies so outgoing payload
// shape can be asserted too.
function makeFakeChannel() {
  const handlers = {}
  const channel = {
    on: (type, opts, cb) => {
      handlers[`${type}:${opts.event}`] = cb
      return channel
    },
    subscribe: (cb) => {
      cb?.('SUBSCRIBED')
      return channel
    },
    track: vi.fn(),
    send: vi.fn(),
    untrack: vi.fn(),
    presenceState: () => ({}),
    _handlers: handlers,
  }
  return channel
}

function makeFakeSupabase() {
  let lastChannel = null
  return {
    channel: () => {
      lastChannel = makeFakeChannel()
      return lastChannel
    },
    removeChannel: () => {},
    get lastChannel() {
      return lastChannel
    },
  }
}

let PresentationMode
let fakeSupabase

beforeEach(() => {
  vi.useFakeTimers()
  fakeSupabase = makeFakeSupabase()
  PresentationMode = extractPresentationMode()(React, useState, useEffect, useRef, useCallback, fakeSupabase)
})

afterEach(() => {
  vi.useRealTimers()
})

function advanceFade() {
  act(() => {
    vi.advanceTimersByTime(250)
  })
}

describe('PresentationMode viewer robustness: out-of-range clamp (3.5a)', () => {
  it('a broadcast idx far beyond this viewer\'s own schedule length clamps to the last valid slide instead of crashing', () => {
    const evt = {
      id: 'evt-clamp-1',
      name: 'Clamp Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Only Stop', day: 0, time: '09:00', secret: false },
      ],
    }
    expect(() =>
      render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />),
    ).not.toThrow()

    // Presenter (on a much longer schedule) broadcasts display position 9 --
    // this viewer only has 1 stop (total = 2: intro + 1 stop). No realIdx
    // field, so this exercises the legacy-idx clamp path too.
    act(() => {
      fakeSupabase.lastChannel._handlers['broadcast:slide']({ payload: { idx: 9, revealedSecrets: [] } })
    })
    expect(() => advanceFade()).not.toThrow()

    // Clamped to the last valid slide (this viewer's only real stop), not a
    // crash and not stuck on the intro.
    expect(screen.getByText('Only Stop')).toBeInTheDocument()
    expect(screen.getByText('Stop 1 / 1')).toBeInTheDocument()
  })

  it('a negative/undefined idx never goes below the intro slide', () => {
    const evt = {
      id: 'evt-clamp-2',
      name: 'Clamp Test 2',
      date: '2026-09-11',
      schedule: [{ activity: 'Stop A', day: 0, time: '09:00', secret: false }],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    act(() => {
      fakeSupabase.lastChannel._handlers['broadcast:slide']({ payload: { idx: -5, revealedSecrets: [] } })
    })
    expect(() => advanceFade()).not.toThrow()
    // Back on/still on the intro -- the event name renders, the stop's
    // activity text does not.
    expect(screen.getAllByText('Clamp Test 2').length).toBeGreaterThan(0)
    expect(screen.queryByText('Stop A')).not.toBeInTheDocument()
  })

  it('a late joiner\'s initial `currentLive.idx` (from presence, resolved before this render) that is out of range clamps on mount rather than throwing', () => {
    const evt = {
      id: 'evt-clamp-3',
      name: 'Late Joiner Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'First', day: 0, time: '09:00', secret: false },
        { activity: 'Second', day: 0, time: '12:00', secret: false },
      ],
    }
    // currentLive says slide 40 -- e.g. a stale/divergent presence snapshot.
    expect(() =>
      render(
        <PresentationMode
          evt={evt}
          onUpdate={() => {}}
          isPresenter={false}
          currentLive={{ idx: 40, revealedSecrets: [] }}
          onClose={() => {}}
        />,
      ),
    ).not.toThrow()
    // Clamped to the last valid slide (Second), never a dead screen.
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('this viewer\'s OWN schedule shrinking after mount (independent of any broadcast) re-clamps idx instead of dereferencing a removed stop', () => {
    const evt = {
      id: 'evt-clamp-4',
      name: 'Shrink Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'A', day: 0, time: '09:00', secret: false },
        { activity: 'B', day: 0, time: '12:00', secret: false },
        { activity: 'C', day: 0, time: '15:00', secret: false },
      ],
    }
    const { rerender } = render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    // Land this viewer on the last slide ("C") via a normal broadcast first.
    act(() => {
      fakeSupabase.lastChannel._handlers['broadcast:slide']({ payload: { idx: 3, realIdx: 2, revealedSecrets: [] } })
    })
    advanceFade()
    expect(screen.getByText('C')).toBeInTheDocument()

    // Now the underlying event syncs down to just 1 stop (B and C removed) --
    // no broadcast involved, just a prop change.
    const shrunk = { ...evt, schedule: [{ activity: 'A', day: 0, time: '09:00', secret: false }] }
    expect(() => rerender(<PresentationMode evt={shrunk} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)).not.toThrow()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByText('C')).not.toBeInTheDocument()
  })
})

describe('PresentationMode viewer robustness: identity-based broadcast, not display position (3.5b)', () => {
  it('resolves the CORRECT stop via realIdx even when this viewer\'s own schedule has diverged (would show the wrong stop under the old position-only scheme)', () => {
    // Presenter's schedule (by real array index, not rendered here -- only
    // its resulting `order`/`realIdx` matter for this test): a stop was
    // appended LAST (real index 3) but sorts EARLIEST-but-one by time,
    // shifting every display position after it.
    //   real0 Alpha   09:00
    //   real1 Bravo   12:00
    //   real2 Charlie 15:00
    //   real3 NewEarly 10:00  <- appended last
    // Presenter's display order (by day,time): Alpha(0), NewEarly(3), Bravo(1), Charlie(2)
    // -> order = [0,3,1,2]. Presenter navigates to display slide 3 (1-indexed
    // among stops) = order[2] = real index 1 = "Bravo".
    const presenterOrder = [0, 3, 1, 2]
    const presenterDisplayIdx = 3
    const realIdx = presenterOrder[presenterDisplayIdx - 1]
    expect(realIdx).toBe(1) // sanity: presenter is showing "Bravo"

    // This viewer hasn't synced the append yet -- same first 3 real indices,
    // NewEarly missing entirely.
    const viewerEvt = {
      id: 'evt-diverge-1',
      name: 'Diverge Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Alpha', day: 0, time: '09:00', secret: false }, // real 0
        { activity: 'Bravo', day: 0, time: '12:00', secret: false }, // real 1
        { activity: 'Charlie', day: 0, time: '15:00', secret: false }, // real 2
      ],
    }
    render(<PresentationMode evt={viewerEvt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    act(() => {
      fakeSupabase.lastChannel._handlers['broadcast:slide']({
        payload: { idx: presenterDisplayIdx, realIdx, revealedSecrets: [] },
      })
    })
    advanceFade()

    // Correct: the stop the presenter is actually showing.
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    // Wrong (what the OLD position-only scheme would show: this viewer's own
    // order is [0,1,2] since nothing reordered locally, so display position 3
    // -> order[2] -> real index 2 -> "Charlie").
    expect(screen.queryByText('Charlie')).not.toBeInTheDocument()
  })

  it('backwards compatible: a payload with NO `realIdx` field at all (older-build presenter) does not crash, and falls back to the legacy idx-as-display-position behavior', () => {
    const viewerEvt = {
      id: 'evt-compat-1',
      name: 'Compat Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Alpha', day: 0, time: '09:00', secret: false },
        { activity: 'Bravo', day: 0, time: '12:00', secret: false },
        { activity: 'Charlie', day: 0, time: '15:00', secret: false },
      ],
    }
    render(<PresentationMode evt={viewerEvt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    // Old-format payload: `idx` only, `realIdx` key entirely absent.
    expect(() => {
      act(() => {
        fakeSupabase.lastChannel._handlers['broadcast:slide']({ payload: { idx: 2, revealedSecrets: [] } })
      })
    }).not.toThrow()
    advanceFade()
    // Legacy behavior: display position 2 -> this viewer's own order[1] -> "Bravo".
    expect(screen.getByText('Bravo')).toBeInTheDocument()
  })

  it('a `realIdx` that does not exist in this viewer\'s own schedule (still falls back to the legacy idx, clamped) rather than crashing', () => {
    const viewerEvt = {
      id: 'evt-missing-real-1',
      name: 'Missing RealIdx Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Alpha', day: 0, time: '09:00', secret: false },
        { activity: 'Bravo', day: 0, time: '12:00', secret: false },
      ],
    }
    render(<PresentationMode evt={viewerEvt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    expect(() => {
      act(() => {
        // realIdx 99 doesn't exist in this viewer's 2-stop schedule.
        fakeSupabase.lastChannel._handlers['broadcast:slide']({ payload: { idx: 1, realIdx: 99, revealedSecrets: [] } })
      })
    }).not.toThrow()
    advanceFade()
    // Falls back to the legacy idx (1) clamped into range -> "Alpha".
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('the intro slide (realIdx: null) is resolved correctly, not treated as "not found"', () => {
    const viewerEvt = {
      id: 'evt-intro-1',
      name: 'Intro Resolution Test',
      date: '2026-09-11',
      schedule: [{ activity: 'Only Stop', day: 0, time: '09:00', secret: false }],
    }
    render(<PresentationMode evt={viewerEvt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    // First move off the intro...
    act(() => {
      fakeSupabase.lastChannel._handlers['broadcast:slide']({ payload: { idx: 1, realIdx: 0, revealedSecrets: [] } })
    })
    advanceFade()
    expect(screen.getByText('Only Stop')).toBeInTheDocument()
    // ...then the presenter goes back to the intro.
    act(() => {
      fakeSupabase.lastChannel._handlers['broadcast:slide']({ payload: { idx: 0, realIdx: null, revealedSecrets: [] } })
    })
    advanceFade()
    expect(screen.queryByText('Only Stop')).not.toBeInTheDocument()
    expect(screen.getAllByText('Intro Resolution Test').length).toBeGreaterThan(0)
  })
})

describe('PresentationMode presenter: outgoing broadcast carries realIdx alongside legacy idx (3.5b, sender side)', () => {
  it('navigating to a stop sends both `idx` (legacy display position) and `realIdx` (the stop\'s real schedule index)', () => {
    const evt = {
      id: 'evt-sender-1',
      name: 'Sender Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Alpha', day: 0, time: '09:00', secret: false }, // real 0
        { activity: 'Bravo', day: 0, time: '12:00', secret: false }, // real 1
      ],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    const nextBtn = screen.getByText('→')
    fireEvent.click(nextBtn) // slide 1 = display order[0] = real index 0 = Alpha
    advanceFade()

    const ch = fakeSupabase.lastChannel
    const lastSend = ch.send.mock.calls.at(-1)[0]
    expect(lastSend.payload.idx).toBe(1)
    expect(lastSend.payload.realIdx).toBe(0)

    fireEvent.click(screen.getByText('→')) // slide 2 = real index 1 = Bravo
    advanceFade()
    const lastSend2 = ch.send.mock.calls.at(-1)[0]
    expect(lastSend2.payload.idx).toBe(2)
    expect(lastSend2.payload.realIdx).toBe(1)
  })

  it('the intro slide sends realIdx: null, not 0 or undefined', () => {
    const evt = {
      id: 'evt-sender-2',
      name: 'Sender Intro Test',
      date: '2026-09-11',
      schedule: [{ activity: 'Alpha', day: 0, time: '09:00', secret: false }],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    const ch = fakeSupabase.lastChannel
    // Initial subscribe-time track (still on the intro).
    const lastTrack = ch.track.mock.calls.at(-1)[0]
    expect(lastTrack.realIdx).toBeNull()
  })

  // The reorder-desync fix (ticket: stable stop identity) adds a `stopId`
  // field alongside the legacy `idx`/`realIdx` -- additive, so an
  // older-build viewer (who has never heard of `stopId`) still works off
  // `realIdx`/`idx` exactly as before. Confirms the new field actually
  // rides along, not just the old ones.
  it('also sends a `stopId` identifying the stop by its own stable id, alongside the legacy idx/realIdx', () => {
    const evt = {
      id: 'evt-sender-3',
      name: 'Sender StopId Test',
      date: '2026-09-11',
      schedule: [
        { id: 'stop-alpha', activity: 'Alpha', day: 0, time: '09:00', secret: false },
        { id: 'stop-bravo', activity: 'Bravo', day: 0, time: '12:00', secret: false },
      ],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('→'))
    advanceFade()
    fireEvent.click(screen.getByText('→'))
    advanceFade()
    const ch = fakeSupabase.lastChannel
    const lastSend = ch.send.mock.calls.at(-1)[0]
    expect(lastSend.payload.stopId).toBe('stop-bravo')
    expect(lastSend.payload.realIdx).toBe(1)
  })
})

describe('PresentationMode dot navigation: secret/revealed colouring never leaks to a non-presenter (item 2, dots)', () => {
  // src/App.jsx's dot strip coloured secret-stop dots red/green with no
  // `isPresenter` guard, so a viewer or solo browser could see exactly
  // which running-order positions hold a surprise (and, with neighbouring
  // dots' times visible once visited, roughly when) just by looking at the
  // strip -- contradicting the intro slide's own withholding of the secret
  // *count* from non-presenters. Confirmed pre-existing on main.
  it('a viewer never sees secret/revealed dot colouring, even though the schedule has a secret stop', () => {
    const evt = {
      id: 'evt-dotleak-1',
      name: 'Dot Leak Test',
      date: '2026-09-11',
      schedule: [
        { activity: 'Public One', day: 0, time: '09:00', secret: false },
        { activity: 'Secret Two', day: 0, time: '12:00', secret: true },
        { activity: 'Public Three', day: 0, time: '15:00', secret: false },
      ],
    }
    render(<PresentationMode evt={evt} onUpdate={() => {}} isPresenter={false} onClose={() => {}} />)
    const dots = document.querySelectorAll('div[style*="justify-content: center"][style*="bottom"] > button')
    expect(dots.length).toBe(4) // intro + 3 stops
    dots.forEach((dot) => {
      expect(dot.style.background).not.toBe('rgba(224, 85, 85, 0.5)')
      expect(dot.style.background).not.toBe('rgba(76, 175, 125, 0.6)')
    })
  })
})
