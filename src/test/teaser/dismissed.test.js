import { describe, it, expect, beforeEach } from 'vitest'
import { hasDismissedTeaser, dismissTeaser, clearDismissedTeaser } from '../../features/teaser/dismissed.js'

const DISMISSED_KEY = 'md-teaser-dismissed'

beforeEach(() => {
  localStorage.clear()
})

describe('teaser/dismissed.js', () => {
  it('hasDismissedTeaser is false for an event never dismissed', () => {
    expect(hasDismissedTeaser('evt-1')).toBe(false)
  })

  it('dismissTeaser then hasDismissedTeaser round-trips true', () => {
    dismissTeaser('evt-1')
    expect(hasDismissedTeaser('evt-1')).toBe(true)
  })

  it('stores an array of ids under the documented key', () => {
    dismissTeaser('evt-1')
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY))
    expect(raw).toEqual(['evt-1'])
  })

  it('tracks multiple events independently and does not duplicate on repeat dismissal', () => {
    dismissTeaser('evt-1')
    dismissTeaser('evt-1')
    dismissTeaser('evt-2')
    expect(JSON.parse(localStorage.getItem(DISMISSED_KEY))).toEqual(['evt-1', 'evt-2'])
    expect(hasDismissedTeaser('evt-1')).toBe(true)
    expect(hasDismissedTeaser('evt-2')).toBe(true)
    expect(hasDismissedTeaser('evt-3')).toBe(false)
  })

  it('clearDismissedTeaser removes just that event', () => {
    dismissTeaser('evt-1')
    dismissTeaser('evt-2')
    clearDismissedTeaser('evt-1')
    expect(hasDismissedTeaser('evt-1')).toBe(false)
    expect(hasDismissedTeaser('evt-2')).toBe(true)
  })

  it('never throws given a missing/falsy eventId', () => {
    expect(() => hasDismissedTeaser(undefined)).not.toThrow()
    expect(() => dismissTeaser('')).not.toThrow()
    expect(() => clearDismissedTeaser(null)).not.toThrow()
    expect(hasDismissedTeaser(undefined)).toBe(false)
  })

  it('survives corrupted JSON in localStorage rather than throwing', () => {
    localStorage.setItem(DISMISSED_KEY, '{not json')
    expect(() => hasDismissedTeaser('evt-1')).not.toThrow()
    expect(hasDismissedTeaser('evt-1')).toBe(false)
    expect(() => dismissTeaser('evt-1')).not.toThrow()
    expect(hasDismissedTeaser('evt-1')).toBe(true)
  })

  it('survives a non-array JSON value (e.g. legacy/corrupt shape) rather than throwing', () => {
    localStorage.setItem(DISMISSED_KEY, '{"not":"an array"}')
    expect(hasDismissedTeaser('evt-1')).toBe(false)
    expect(() => dismissTeaser('evt-1')).not.toThrow()
    expect(hasDismissedTeaser('evt-1')).toBe(true)
  })
})
