import { describe, it, expect } from 'vitest'
import { isSafeImageUrl } from '../../features/trailer/safeUrl.js'

describe('isSafeImageUrl', () => {
  it('accepts https URLs', () => {
    expect(isSafeImageUrl('https://cdn.example.com/a.jpg')).toBe(true)
  })

  it('accepts http URLs', () => {
    expect(isSafeImageUrl('http://cdn.example.com/a.jpg')).toBe(true)
  })

  it('rejects data: URLs', () => {
    expect(isSafeImageUrl('data:image/png;base64,AAAA')).toBe(false)
  })

  it('rejects blob: URLs', () => {
    expect(isSafeImageUrl('blob:https://example.com/uuid')).toBe(false)
  })

  it('rejects javascript: URLs', () => {
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects unparsable strings without throwing', () => {
    expect(isSafeImageUrl('not a url')).toBe(false)
  })

  it('rejects non-string / empty / nullish input', () => {
    expect(isSafeImageUrl('')).toBe(false)
    expect(isSafeImageUrl(null)).toBe(false)
    expect(isSafeImageUrl(undefined)).toBe(false)
    expect(isSafeImageUrl(123)).toBe(false)
    expect(isSafeImageUrl({})).toBe(false)
  })
})
