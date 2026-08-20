// Mutation/regression test for the memoisation guard described in the trailer
// report: EventTrailer.jsx derives an `inputKey` via `JSON.stringify(input)`
// and uses it (not the raw `input` object reference) as the dependency for
// the `buildBeats`/`buildTimeline` memos. This exists because App.jsx's
// adapter can hand EventTrailer a fresh `input` object identity on every
// unrelated realtime sync of the event row (see EventTrailer.jsx's own
// docblock) -- a naive `[input]` dependency would rebuild the beat timeline
// (and could shift beat boundaries) purely from that object-identity churn,
// which is exactly the "live RSVP arrives mid-playback" bug this guards
// against.
//
// This spies on the real `buildBeats` export (via `importOriginal`, so the
// underlying pure logic is untouched and every other test in the suite that
// imports buildBeats.js keeps exercising the real implementation) purely to
// count invocations across re-renders with different `input` prop identities.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { installMediaEnv } from '../mocks/mediaEnv.js'

const buildBeatsSpy = vi.fn()
vi.mock('../../features/trailer/buildBeats.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    buildBeats: (...args) => {
      buildBeatsSpy(...args)
      return actual.buildBeats(...args)
    },
  }
})

// Imported AFTER the mock is registered (vi.mock is hoisted by Vitest, so
// this ordering in source doesn't actually matter, but it documents intent).
const { default: EventTrailer } = await import('../../features/trailer/EventTrailer.jsx')

const baseInput = (overrides = {}) => ({
  eventId: 'evt-1',
  name: 'Mensdag XL',
  type: 'day',
  theme: '',
  location: 'Amsterdam',
  dateLabel: '12 september 2026',
  startsAtIso: '2026-09-12T12:00:00',
  dayCount: 1,
  stops: [],
  secretCount: 0,
  goingCount: 8,
  going: Array.from({ length: 8 }, (_, i) => ({ name: `Lad ${i}`, photoUrl: '', avatarIndex: i % 4 })),
  ...overrides,
})

let env
afterEach(() => {
  cleanup()
  env?.restore()
  env = null
  buildBeatsSpy.mockClear()
})

describe('EventTrailer memoisation (guards against mid-playback timeline rebuilds)', () => {
  it('does NOT rebuild beats when a new input object arrives with identical content', () => {
    env = installMediaEnv()
    const inputA = baseInput()
    const { rerender } = render(<EventTrailer input={inputA} onClose={() => {}} />)

    expect(buildBeatsSpy).toHaveBeenCalledTimes(1)

    // A fresh object, deep-equal to inputA but a different reference and with
    // freshly-allocated nested arrays too -- simulating exactly what
    // `toTrailerInput(evt, users, events)` would produce if called again on
    // an EventPage re-render triggered by something unrelated (e.g. a
    // Supabase realtime row replacement with unchanged content, or a parent
    // re-render that doesn't actually change evt/users/events values).
    const inputB = baseInput()
    expect(inputB).not.toBe(inputA)
    expect(inputB.going).not.toBe(inputA.going)

    rerender(<EventTrailer input={inputB} onClose={() => {}} />)

    expect(buildBeatsSpy).toHaveBeenCalledTimes(1)
  })

  it('DOES rebuild beats when the input content genuinely changes', () => {
    env = installMediaEnv()
    const inputA = baseInput()
    render(<EventTrailer input={inputA} onClose={() => {}} />)

    expect(buildBeatsSpy).toHaveBeenCalledTimes(1)
  })

  it('DOES rebuild beats on a genuine content change via rerender', () => {
    env = installMediaEnv()
    const inputA = baseInput()
    const { rerender } = render(<EventTrailer input={inputA} onClose={() => {}} />)
    expect(buildBeatsSpy).toHaveBeenCalledTimes(1)

    // A real RSVP arriving mid-playback: goingCount/roster genuinely changed.
    const inputC = baseInput({
      goingCount: 9,
      going: Array.from({ length: 9 }, (_, i) => ({ name: `Lad ${i}`, photoUrl: '', avatarIndex: i % 4 })),
    })
    rerender(<EventTrailer input={inputC} onClose={() => {}} />)

    expect(buildBeatsSpy).toHaveBeenCalledTimes(2)
  })
})
