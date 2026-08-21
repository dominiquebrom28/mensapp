import { describe, it, expect, beforeEach } from 'vitest'
import { hasSeenTrailer, markTrailerSeen, clearSeenTrailer } from '../../features/trailer/seen.js'
import { SEEN_KEY, TRAILER_VERSION } from '../../features/trailer/constants.js'

beforeEach(() => {
  localStorage.clear()
})

describe('seen.js', () => {
  it('hasSeenTrailer is false for an event never marked', () => {
    expect(hasSeenTrailer('evt-1')).toBe(false)
  })

  it('markTrailerSeen then hasSeenTrailer round-trips true', () => {
    markTrailerSeen('evt-1', { nowMs: 1000 })
    expect(hasSeenTrailer('evt-1')).toBe(true)
  })

  it('stores { v, at } per event under the documented key', () => {
    markTrailerSeen('evt-1', { nowMs: 5000 })
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY))
    expect(raw['evt-1']).toEqual({ v: TRAILER_VERSION, at: 5000 })
  })

  it('a version bump makes a previously-seen event report unseen again', () => {
    markTrailerSeen('evt-1', { version: 1, nowMs: 0 })
    expect(hasSeenTrailer('evt-1', { version: 2 })).toBe(false)
    expect(hasSeenTrailer('evt-1', { version: 1 })).toBe(true)
  })

  it('tracks multiple events independently', () => {
    markTrailerSeen('evt-1', { nowMs: 0 })
    expect(hasSeenTrailer('evt-1')).toBe(true)
    expect(hasSeenTrailer('evt-2')).toBe(false)
  })

  it('clearSeenTrailer removes just that event', () => {
    markTrailerSeen('evt-1', { nowMs: 0 })
    markTrailerSeen('evt-2', { nowMs: 0 })
    clearSeenTrailer('evt-1')
    expect(hasSeenTrailer('evt-1')).toBe(false)
    expect(hasSeenTrailer('evt-2')).toBe(true)
  })

  it('never throws given a missing/falsy eventId', () => {
    expect(() => hasSeenTrailer(undefined)).not.toThrow()
    expect(() => markTrailerSeen('')).not.toThrow()
    expect(() => clearSeenTrailer(null)).not.toThrow()
    expect(hasSeenTrailer(undefined)).toBe(false)
  })

  it('survives corrupted JSON in localStorage rather than throwing', () => {
    localStorage.setItem(SEEN_KEY, '{not json')
    expect(() => hasSeenTrailer('evt-1')).not.toThrow()
    expect(hasSeenTrailer('evt-1')).toBe(false)
    expect(() => markTrailerSeen('evt-1', { nowMs: 0 })).not.toThrow()
    expect(hasSeenTrailer('evt-1')).toBe(true)
  })
})
