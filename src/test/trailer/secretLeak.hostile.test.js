// QA pass: adversarial secret-leak tests beyond what buildBeats.test.js
// already covers. See docs/trailer-technical-spec.md §5.5 / §8 / §11 and the
// task brief's "attack it properly" list.
//
// HISTORY: the first four cases below ("secret-leak -- non-strict-boolean
// 'secret' flag") originally caught a real defect -- buildBeats.js gated
// secrecy on `s.secret === true` / `s.secret !== true` (strict equality
// against the boolean literal), so a stop whose `secret` field was truthy
// but not literally `=== true` (`1`, `"true"`, a boxed `Boolean`) satisfied
// neither guard: not excluded from the eligible (non-secret) STOP path, and
// not picked up by the secret-only path either. Its full activity/location/
// note/image leaked into a STOP beat -- and its image could become the
// shared hero image on META/OUTRO -- while `secretCount` (sourced from the
// adapter) still reported the stop as secret. Worst-case outcome: the
// trailer announces a secret and then shows it.
//
// They were originally marked as expected-failure cases -- the assertion
// inside encoded the SECURE behaviour, so the suite reported green
// precisely because that behaviour didn't hold yet; a real fix would flip
// the result and force this file to be revisited rather than silently
// going stale. buildBeats.js now uses `!!s.secret` (a coercing check, not
// strict equality) at all three sites, so these are ordinary `it(...)`
// assertions -- kept, not deleted, as the regression guard against this
// exact class of bug coming back.
import { describe, it, expect } from 'vitest'
import { buildBeats, BEAT_KINDS } from '../../features/trailer/buildBeats.js'
import { useMediaPreloader } from '../../features/trailer/useMediaPreloader.js'
import { installMediaEnv } from '../mocks/mediaEnv.js'
import { renderHook, act } from '@testing-library/react'

const baseInput = (overrides = {}) => ({
  eventId: 'evt-1',
  name: 'Mensdag XL',
  type: 'day',
  theme: '',
  location: 'Amsterdam',
  dateLabel: '12 september 2026',
  startsAtIso: '',
  dayCount: 1,
  stops: [],
  secretCount: 0,
  goingCount: 0,
  going: [],
  ...overrides,
})

function allMedia(beats) {
  return beats.filter((b) => 'media' in b).map((b) => b.media)
}

describe('secret-leak -- non-strict-boolean `secret` flag (fixed; regression guard)', () => {
  // buildBeats.js now filters with `!s.secret` (eligible/hero-image) and
  // `!!s.secret` (secret-stop reads) -- coercing checks, not strict equality
  // against the boolean literal `true`. A stop whose `secret` field is
  // truthy but not literally `=== true` (1, "true", "yes", new Boolean(true))
  // is correctly excluded from the eligible (non-secret) STOP path and
  // correctly picked up by the secret-only path.
  //
  // Still worth guarding explicitly: `schedule` is hand-editable JSONB, and
  // the App.jsx adapter that's supposed to normalise `secret` to a real
  // boolean before this feature ever sees it doesn't exist yet (out of this
  // pass's scope). buildBeats.js's own docblock claims to defend "even
  // given a hostile/un-redacted input" -- this is what makes that claim true.
  it('secret: 1 (truthy, non-strict-boolean) never leaks activity/location/note into a STOP beat', () => {
    const input = baseInput({
      stops: [{
        key: 'secret-0', secret: 1, day: 0, dayLabel: 'Dag 1', time: '22:00',
        icon: '🎉', activity: 'TOP SECRET STRIPPER PARTY', location: 'Undisclosed venue', note: 'shh, tell no one',
        image: 'https://cdn.example.com/secret-strip.jpg',
      }],
      secretCount: 1,
    })
    const beats = buildBeats(input)
    expect(beats.some((b) => b.kind === BEAT_KINDS.STOP)).toBe(false)
  })

  it('secret: "true" (string, truthy, non-strict-boolean) is also correctly excluded', () => {
    const input = baseInput({
      stops: [{
        key: 'secret-0', secret: 'true', day: 0, dayLabel: 'Dag 1', time: '22:00',
        icon: '🎉', activity: 'TOP SECRET STRIPPER PARTY', location: 'Undisclosed venue', note: '',
        image: '',
      }],
      secretCount: 1,
    })
    const beats = buildBeats(input)
    expect(beats.some((b) => b.kind === BEAT_KINDS.STOP)).toBe(false)
  })

  it('secret: 1 never lets the secret stop\'s own image become the shared hero image on META/OUTRO', () => {
    const input = baseInput({
      stops: [{
        key: 'secret-0', secret: 1, day: 0, dayLabel: 'Dag 1', time: '22:00',
        icon: '🎉', activity: 'Reveal', location: '', note: '',
        image: 'https://cdn.example.com/secret-hero.jpg',
      }],
      secretCount: 1,
    })
    const beats = buildBeats(input)
    expect(allMedia(beats)).not.toContain('https://cdn.example.com/secret-hero.jpg')
  })

  it('a real-world consequence: with secret:1, the output correctly claims "1 secret" without also spoiling it', () => {
    const input = baseInput({
      stops: [{
        key: 'secret-0', secret: 1, day: 0, dayLabel: 'Dag 1', time: '22:00',
        icon: '🎉', activity: 'Reveal', location: '', note: '',
        image: '',
      }],
      secretCount: 1,
    })
    const beats = buildBeats(input)
    const hasSecretBeat = beats.some((b) => b.kind === BEAT_KINDS.SECRET)
    const hasStopBeat = beats.some((b) => b.kind === BEAT_KINDS.STOP)
    // Secure behaviour: never both at once for the same underlying stop.
    expect(hasSecretBeat && hasStopBeat).toBe(false)
  })
})

describe('secret-leak -- deep-scan against unusual-but-well-typed hostile input', () => {
  it('unicode / homoglyph content in secret-only fields never reaches the output (strict-boolean secret:true)', () => {
    // Cyrillic/Greek homoglyphs mixed into the marker so a naive substring
    // strip or encoding-normalising bug would be caught, not just plain ASCII.
    const marker = 'ѕeсreт_мarker_Δ1г' // mixed Cyrillic 'ѕ','е','с' + Greek 'Δ' + Cyrillic 'г'
    const secretStop = {
      key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '22:00',
      activity: marker, location: marker, note: marker,
      image: `https://cdn.example.com/${encodeURIComponent(marker)}.jpg`,
    }
    const input = baseInput({ stops: [secretStop], secretCount: 1 })
    const json = JSON.stringify(buildBeats(input))
    expect(json.includes(marker)).toBe(false)
    expect(json.includes(encodeURIComponent(marker))).toBe(false)
  })

  it('deeply nested / unexpected extra fields on a secret stop never surface (only time/day/dayLabel are read)', () => {
    const secretStop = {
      key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '22:00',
      // Content stuffed into fields buildBeats has no reason to read at all.
      whoKnows: { deeply: { nested: { marker: 'DEEP_NESTED_LEAK_MARKER' } } },
      arr: [{ marker: 'ARRAY_NESTED_LEAK_MARKER' }],
      toString() { return 'TOSTRING_LEAK_MARKER' },
      valueOf() { return 'VALUEOF_LEAK_MARKER' },
    }
    const input = baseInput({ stops: [secretStop], secretCount: 1 })
    const json = JSON.stringify(buildBeats(input))
    for (const m of ['DEEP_NESTED_LEAK_MARKER', 'ARRAY_NESTED_LEAK_MARKER', 'TOSTRING_LEAK_MARKER', 'VALUEOF_LEAK_MARKER']) {
      expect(json.includes(m)).toBe(false)
    }
  })

  it('a secret stop whose activity string is IDENTICAL to a real non-secret stop\'s activity: the non-secret copy legitimately survives, the secret one never contributes it', () => {
    const sharedText = 'Kroegentocht Centrum'
    const secretStop = {
      key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '10:00',
      activity: sharedText, // hostile: secret stop also carries this text
      note: 'SECRET_ONLY_NOTE_MARKER',
    }
    const nonSecretStop = {
      key: 'stop-1', secret: false, day: 0, dayLabel: 'Dag 1', time: '20:00',
      icon: '🍺', activity: sharedText, location: 'Centrum', note: '', image: '',
    }
    const input = baseInput({ stops: [secretStop, nonSecretStop], secretCount: 1 })
    const beats = buildBeats(input)

    const stopBeats = beats.filter((b) => b.kind === BEAT_KINDS.STOP)
    expect(stopBeats).toHaveLength(1) // only the genuinely non-secret one
    expect(stopBeats[0].id).toBe('stop-1')
    expect(stopBeats[0].data.activity).toBe(sharedText) // legitimate content intact

    const json = JSON.stringify(beats)
    expect(json.includes('SECRET_ONLY_NOTE_MARKER')).toBe(false) // the secret-only marker never leaks
  })

  it('prototype pollution on Object.prototype does not defeat the strict `secret === true` check', () => {
    // Deliberate, reverted in `finally` below.
    Object.prototype.activity = 'POLLUTED_PROTOTYPE_ACTIVITY_MARKER'
    try {
      const secretStop = { key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '22:00' }
      const input = baseInput({ stops: [secretStop], secretCount: 1 })
      const beats = buildBeats(input)
      const json = JSON.stringify(beats)
      // The strictly-secret stop must still never produce a STOP beat, even
      // though every plain object in the process now inherits `.activity`.
      expect(beats.some((b) => b.kind === BEAT_KINDS.STOP)).toBe(false)
      expect(json.includes('POLLUTED_PROTOTYPE_ACTIVITY_MARKER')).toBe(false)
    } finally {
      delete Object.prototype.activity
    }
  })

  it('a null-prototype secret stop object (no inherited Object.prototype at all) is still handled without throwing and without leaking', () => {
    const secretStop = Object.assign(Object.create(null), {
      key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '22:00',
      activity: 'NULL_PROTO_LEAK_MARKER',
    })
    const input = baseInput({ stops: [secretStop], secretCount: 1 })
    expect(() => buildBeats(input)).not.toThrow()
    const json = JSON.stringify(buildBeats(input))
    expect(json.includes('NULL_PROTO_LEAK_MARKER')).toBe(false)
  })
})

describe('secret-leak -- no Image() is ever constructed for a secret stop\'s URL, end to end', () => {
  it('feeding buildBeats\' own media output into useMediaPreloader never constructs an Image for the secret stop\'s URL', () => {
    const env = installMediaEnv()
    try {
      const secretImageUrl = 'https://cdn.example.com/secret-reveal-photo.jpg'
      const input = baseInput({
        stops: [
          { key: 'secret-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '22:00', image: secretImageUrl, activity: 'x' },
          { key: 'stop-1', secret: false, day: 0, dayLabel: 'Dag 1', time: '10:00', icon: '🍺', activity: 'Public stop', location: '', note: '', image: 'https://cdn.example.com/public.jpg' },
        ],
        secretCount: 1,
      })
      const beats = buildBeats(input)
      const mediaList = allMedia(beats)
      expect(mediaList).not.toContain(secretImageUrl)

      const { result } = renderHook(() => useMediaPreloader(mediaList))
      act(() => { mediaList.forEach((_, i) => result.current.ensureFrom(i - 1)) })

      expect(env.getImage(secretImageUrl)).toBeNull()
    } finally {
      env.restore()
    }
  })
})
