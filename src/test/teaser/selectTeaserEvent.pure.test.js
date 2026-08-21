// Extracts and evaluates the REAL, current `selectTeaserEvent` source from
// App.jsx, the same targeted-extraction technique
// extractFromAppSource.js/extractComponentFromAppSource.js use for other
// module-scope helpers -- except `selectTeaserEvent` calls `isSafeVideoUrl`,
// which is a real `import` in App.jsx (not a module-scope const), so it
// isn't reachable via the generic `extractFromApp` helper (no dependency-
// injection hook) the way a self-contained pure helper would be. Same
// situation EventModals.typeTouched.test.jsx documents for `isSafeVideoUrl`
// inside EditEventModal/NewEventModal -- injected here as the REAL
// implementation (imported straight from its actual module, not
// reimplemented) rather than a permissive stub, since the no-video edge
// case is exactly what several tests below are checking.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSafeVideoUrl } from '../../features/trailer/safeUrl.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_JSX_PATH = path.join(__dirname, '..', '..', 'App.jsx')
const source = fs.readFileSync(APP_JSX_PATH, 'utf-8')

function extractSelectTeaserEvent() {
  const marker = 'const selectTeaserEvent='
  const start = source.indexOf(marker)
  expect(start, `"${marker}" not found in App.jsx`).toBeGreaterThan(-1)
  const end = source.indexOf('\n};', start)
  expect(end, 'closing "};" for selectTeaserEvent not found').toBeGreaterThan(start)
  const raw = source.slice(start, end + 3)
  const fn = new Function('isSafeVideoUrl', `${raw}\nreturn selectTeaserEvent;`)
  return fn(isSafeVideoUrl)
}

const selectTeaserEvent = extractSelectTeaserEvent()

const VIDEO = 'https://example.com/trailer.mp4'

function evt(overrides = {}) {
  return {
    id: 'evt-x',
    name: 'Mensdag',
    date: '2026-09-13',
    archived: false,
    teaser_active: true,
    trailer_video_url: VIDEO,
    ...overrides,
  }
}

describe('selectTeaserEvent (extracted from App.jsx source)', () => {
  it('returns null when there are no events', () => {
    expect(selectTeaserEvent([])).toBeNull()
  })

  it('returns null when no event has teaser_active', () => {
    expect(selectTeaserEvent([evt({ teaser_active: false })])).toBeNull()
  })

  it('returns null when teaser_active is set but falsy-ish (0/undefined)', () => {
    expect(selectTeaserEvent([evt({ teaser_active: undefined })])).toBeNull()
  })

  it('excludes archived events even with teaser_active and a valid video', () => {
    expect(selectTeaserEvent([evt({ archived: true })])).toBeNull()
  })

  it('excludes events with no trailer_video_url at all', () => {
    expect(selectTeaserEvent([evt({ trailer_video_url: '' })])).toBeNull()
  })

  it('excludes events with an unsafe/invalid trailer_video_url (no-video edge case)', () => {
    expect(selectTeaserEvent([evt({ trailer_video_url: 'javascript:alert(1)' })])).toBeNull()
    expect(selectTeaserEvent([evt({ trailer_video_url: 'https://example.com/not-a-video.txt' })])).toBeNull()
  })

  it('REGRESSION GUARD: a PAST-dated event still qualifies -- selection is deliberately not date-gated', () => {
    const past = evt({ id: 'evt-past', date: '2020-01-01' })
    expect(selectTeaserEvent([past])).toEqual(past)
  })

  it('picks the soonest date among multiple qualifying events', () => {
    const later = evt({ id: 'evt-later', date: '2026-12-01' })
    const soonest = evt({ id: 'evt-soonest', date: '2026-09-01' })
    const middle = evt({ id: 'evt-middle', date: '2026-10-15' })
    expect(selectTeaserEvent([later, soonest, middle])?.id).toBe('evt-soonest')
  })

  it('a no-video qualifying-otherwise event does not block a different event that DOES have a valid video', () => {
    const noVideo = evt({ id: 'evt-no-video', date: '2026-01-01', trailer_video_url: '' })
    const hasVideo = evt({ id: 'evt-has-video', date: '2026-06-01' })
    expect(selectTeaserEvent([noVideo, hasVideo])?.id).toBe('evt-has-video')
  })

  it('non-teaser events in the mix are ignored entirely, the active one still wins', () => {
    const plain = evt({ teaser_active: false, id: 'evt-plain', date: '2020-01-01' })
    const active = evt({ id: 'evt-active', date: '2027-01-01' })
    expect(selectTeaserEvent([plain, active])?.id).toBe('evt-active')
  })
})
