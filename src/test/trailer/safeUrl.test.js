import { describe, it, expect } from 'vitest'
import { isSafeImageUrl, isSafeVideoUrl } from '../../features/trailer/safeUrl.js'

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

// isSafeVideoUrl: the trailer's own video-source guard (added when the
// generated beat trailer was replaced by a real, owner-produced video).
// Same protocol guard as isSafeImageUrl, plus the exact video-extension
// regex PresentationMode already uses at its own video-vs-image branch.
describe('isSafeVideoUrl', () => {
  it('accepts https URLs with a recognised video extension', () => {
    expect(isSafeVideoUrl('https://cdn.example.com/trailer.mp4')).toBe(true)
    expect(isSafeVideoUrl('https://cdn.example.com/trailer.webm')).toBe(true)
    expect(isSafeVideoUrl('https://cdn.example.com/trailer.mov')).toBe(true)
    expect(isSafeVideoUrl('https://cdn.example.com/trailer.ogg')).toBe(true)
  })

  it('accepts http URLs with a recognised video extension', () => {
    expect(isSafeVideoUrl('http://cdn.example.com/trailer.mp4')).toBe(true)
  })

  it('is case-insensitive on the extension', () => {
    expect(isSafeVideoUrl('https://cdn.example.com/trailer.MP4')).toBe(true)
  })

  it('accepts a query string after the extension', () => {
    expect(isSafeVideoUrl('https://cdn.example.com/trailer.mp4?v=2')).toBe(true)
  })

  it('rejects a safe http(s) URL with no recognised video extension', () => {
    expect(isSafeVideoUrl('https://cdn.example.com/trailer.jpg')).toBe(false)
    expect(isSafeVideoUrl('https://cdn.example.com/trailer')).toBe(false)
    expect(isSafeVideoUrl('https://cdn.example.com/trailer.mp4x')).toBe(false)
  })

  it('rejects data:/blob:/javascript: URLs even with a video-looking path', () => {
    expect(isSafeVideoUrl('data:video/mp4;base64,AAAA')).toBe(false)
    expect(isSafeVideoUrl('blob:https://example.com/uuid.mp4')).toBe(false)
    expect(isSafeVideoUrl('javascript:alert(1)//x.mp4')).toBe(false)
  })

  it('rejects non-string / empty / nullish input', () => {
    expect(isSafeVideoUrl('')).toBe(false)
    expect(isSafeVideoUrl(null)).toBe(false)
    expect(isSafeVideoUrl(undefined)).toBe(false)
    expect(isSafeVideoUrl(123)).toBe(false)
    expect(isSafeVideoUrl({})).toBe(false)
  })
})
