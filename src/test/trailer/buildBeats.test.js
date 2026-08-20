// Unit tests for src/features/trailer/buildBeats.js -- a pure function, so
// every case here is a plain input/output assertion, no mounting, no mocks.
import { describe, it, expect } from 'vitest'
import { buildBeats, BEAT_KINDS, dropFlashBeatsForReducedMotion } from '../../features/trailer/buildBeats.js'
import { buildTimeline } from '../../features/trailer/timeline.js'
import { MAX_TOTAL_MS } from '../../features/trailer/constants.js'

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
  goingCount: 0,
  going: [],
  ...overrides,
})

const stop = ({
  key, day = 0, time = '20:00', secret = false,
  icon = '🍺', activity = 'Kroegentocht', location = 'Centrum', note = '', image = '',
} = {}) => (secret
  ? { key, secret: true, day, dayLabel: `Dag ${day + 1}`, time }
  : { key, secret: false, day, dayLabel: `Dag ${day + 1}`, time, icon, activity, location, note, image })

const kinds = (beats) => beats.map((b) => b.kind)
const ids = (beats) => beats.map((b) => b.id)

describe('buildBeats -- floor and empty-data behaviour', () => {
  it('empty schedule, no upcoming countdown -> floor sequence [title, meta, outro]', () => {
    const beats = buildBeats(baseInput())
    expect(ids(beats)).toEqual(['title', 'meta', 'outro'])
    expect(kinds(beats)).toEqual([BEAT_KINDS.TITLE, BEAT_KINDS.META, BEAT_KINDS.OUTRO])
  })

  it('missing dateLabel drops META, but TITLE still carries an (empty) dateLabel field to absorb it', () => {
    const beats = buildBeats(baseInput({ dateLabel: '' }))
    expect(ids(beats)).toEqual(['title', 'outro'])
    const title = beats.find((b) => b.id === 'title')
    expect(title.data).toHaveProperty('dateLabel', '')
  })

  it('missing location leaves META in (only dateLabel gates it) with an empty location field', () => {
    const beats = buildBeats(baseInput({ location: '' }))
    const meta = beats.find((b) => b.id === 'meta')
    expect(meta).toBeTruthy()
    expect(meta.data.location).toBe('')
  })

  // COUNTDOWN was originally its own beat kind; a visual-QA pass (see
  // buildBeats.js's own comment on the META beat) folded it onto META's
  // `data` instead -- creative spec §3 Beat 2 always described the date
  // reveal and the "X DAGEN TE GAAN" chip as ONE beat, and emitting them as
  // two consecutive beats added an uncalled-for hard wipe-cut in the first
  // ten seconds. `BEAT_KINDS.COUNTDOWN`/`DURATIONS.COUNTDOWN` stay defined
  // in constants.js for an easy revert, but `buildBeats` itself never emits
  // a standalone `id:'countdown'` beat any more -- re-proving the gate
  // here rather than assuming it moved over intact, since the gate itself
  // (not just where the data lands) changed files.
  it('a past startsAtIso: no standalone countdown beat, and META (still emitted) carries no daysToGo field', () => {
    const beats = buildBeats(baseInput(), { nowMs: Date.parse('2026-09-13T00:00:00') })
    expect(ids(beats)).not.toContain('countdown')
    expect(kinds(beats)).not.toContain(BEAT_KINDS.COUNTDOWN)
    const meta = beats.find((b) => b.id === 'meta')
    expect(meta).toBeTruthy()
    expect(meta.data).not.toHaveProperty('daysToGo')
    expect(meta.data).not.toHaveProperty('startsAtIso')
  })

  it('an unparseable startsAtIso: no countdown data on META, without throwing', () => {
    expect(() => buildBeats(baseInput({ startsAtIso: 'not-a-date' }), { nowMs: 0 })).not.toThrow()
    const beats = buildBeats(baseInput({ startsAtIso: 'not-a-date' }), { nowMs: 0 })
    expect(ids(beats)).not.toContain('countdown')
    const meta = beats.find((b) => b.id === 'meta')
    expect(meta.data).not.toHaveProperty('daysToGo')
  })

  it('no countdown data by default when no nowMs is supplied at all (buildBeats never reaches for a real clock)', () => {
    const beats = buildBeats(baseInput({ startsAtIso: '2999-01-01T12:00:00' }))
    expect(ids(beats)).not.toContain('countdown')
    const meta = beats.find((b) => b.id === 'meta')
    expect(meta.data).not.toHaveProperty('daysToGo')
  })

  it('a future startsAtIso: no standalone countdown beat, but META carries a correct daysToGo/startsAtIso, when nowMs is supplied', () => {
    const nowMs = Date.parse('2026-09-10T12:00:00')
    const beats = buildBeats(baseInput({ startsAtIso: '2026-09-12T12:00:00' }), { nowMs })
    // The gate moved, not just the data: re-prove there's genuinely no
    // separate beat any more, not merely that a `countdown` id happens to
    // be absent by coincidence.
    expect(ids(beats)).not.toContain('countdown')
    expect(kinds(beats)).not.toContain(BEAT_KINDS.COUNTDOWN)
    const meta = beats.find((b) => b.id === 'meta')
    expect(meta).toBeTruthy()
    expect(meta.data.daysToGo).toBe(2)
    expect(meta.data.startsAtIso).toBe('2026-09-12T12:00:00')
    // META's own duration is unchanged by carrying the extra field --
    // buildBeats.js's own comment is explicit this beat doesn't get more
    // time on screen just because it now also shows a countdown.
    expect(meta.durationMs).toBe(6000)
  })
})

describe('buildBeats -- secret stops', () => {
  it('an all-secret schedule -> exactly one secret beat, zero stop beats', () => {
    const input = baseInput({
      stops: [stop({ key: 'stop-0', secret: true, day: 0, time: '21:00' }), stop({ key: 'stop-1', secret: true, day: 0, time: '23:00' })],
      secretCount: 2,
    })
    const beats = buildBeats(input)
    expect(kinds(beats).filter((k) => k === BEAT_KINDS.STOP)).toHaveLength(0)
    const secretBeats = beats.filter((b) => b.kind === BEAT_KINDS.SECRET)
    expect(secretBeats).toHaveLength(1)
    expect(secretBeats[0].data.count).toBe(2)
    expect(secretBeats[0].data.times).toEqual(['21:00', '23:00'])
  })

  it('no secret stops -> the secret beat is skipped outright, never faked', () => {
    const input = baseInput({ stops: [stop({ key: 'stop-0' })], secretCount: 0 })
    expect(ids(buildBeats(input))).not.toContain('secret')
  })

  it('invariant: a secret beat never carries activity/note/location/media, even given a hostile un-redacted stop', () => {
    const hostileSecretStop = {
      key: 'stop-0',
      secret: true,
      day: 0,
      dayLabel: 'Dag 1',
      time: '22:00',
      // A properly-redacted adapter output never includes these fields on a
      // secret stop -- this simulates an upstream bug where it does anyway.
      activity: 'LEAK_ACTIVITY_MARKER',
      location: 'LEAK_LOCATION_MARKER',
      note: 'LEAK_NOTE_MARKER',
      image: 'https://example.com/LEAK_IMAGE_MARKER.jpg',
    }
    const beats = buildBeats(baseInput({ stops: [hostileSecretStop], secretCount: 1 }))
    const secretBeat = beats.find((b) => b.kind === BEAT_KINDS.SECRET)
    expect(secretBeat).toBeTruthy()
    expect(secretBeat.data).not.toHaveProperty('activity')
    expect(secretBeat.data).not.toHaveProperty('note')
    expect(secretBeat.data).not.toHaveProperty('location')
    expect(secretBeat).not.toHaveProperty('media')
  })

  it('leak-invariant deep scan: none of a secret stop\'s marker strings appear anywhere in the JSON output, run against BOTH a properly redacted input and a deliberately un-redacted hostile one', () => {
    const marker = (s) => `LEAK_MARKER_${s}`
    const redactedStop = { key: 'stop-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '22:00' }
    const hostileStop = {
      ...redactedStop,
      activity: marker('ACTIVITY'),
      location: marker('LOCATION'),
      note: marker('NOTE'),
      image: `https://example.com/${marker('IMAGE')}.jpg`,
    }
    const markers = ['ACTIVITY', 'LOCATION', 'NOTE', 'IMAGE'].map(marker)

    for (const secretStop of [redactedStop, hostileStop]) {
      const input = baseInput({ stops: [secretStop, stop({ key: 'stop-1' })], secretCount: 1 })
      const json = JSON.stringify(buildBeats(input))
      for (const m of markers) {
        expect(json.includes(m)).toBe(false)
      }
    }
  })

  it('a secret stop is never eligible for a STOP beat even if it carries an activity field', () => {
    const input = baseInput({
      stops: [{ key: 'stop-0', secret: true, day: 0, dayLabel: 'Dag 1', time: '20:00', activity: 'should not become a stop beat' }],
      secretCount: 1,
    })
    const beats = buildBeats(input)
    expect(kinds(beats)).not.toContain(BEAT_KINDS.STOP)
  })
})

describe('buildBeats -- stop montage', () => {
  it('a single eligible stop gets the extended "spotlight" duration, not the standard per-stop one', () => {
    const input = baseInput({ stops: [stop({ key: 'stop-0', activity: 'Go-karten' })] })
    const beats = buildBeats(input)
    const stopBeat = beats.find((b) => b.kind === BEAT_KINDS.STOP)
    expect(stopBeat).toBeTruthy()
    expect(stopBeat.durationMs).toBeGreaterThan(6000)
  })

  it('a stop missing/with an unsafe image degrades to typographic (no `media` key), a safe one gets one', () => {
    const input = baseInput({
      stops: [
        stop({ key: 'stop-0', day: 0, time: '10:00', activity: 'A', image: '' }),
        stop({ key: 'stop-1', day: 0, time: '12:00', activity: 'B', image: 'javascript:alert(1)' }),
        stop({ key: 'stop-2', day: 0, time: '14:00', activity: 'C', image: 'https://cdn.example.com/c.jpg' }),
      ],
    })
    const beats = buildBeats(input).filter((b) => b.kind === BEAT_KINDS.STOP)
    expect(beats[0]).not.toHaveProperty('media')
    expect(beats[1]).not.toHaveProperty('media')
    expect(beats[2].media).toBe('https://cdn.example.com/c.jpg')
  })

  it('25-stop, 3-day weekend -> capped at maxStopBeats (default 6), one-per-day-first, re-sorted by (day,time), and the whole timeline stays under MAX_TOTAL_MS', () => {
    const stops = []
    let key = 0
    const perDay = [9, 8, 8]
    perDay.forEach((count, day) => {
      for (let i = 0; i < count; i++) {
        const hour = String(9 + i).padStart(2, '0')
        stops.push(stop({ key: `stop-${key++}`, day, time: `${hour}:00`, activity: `Stop D${day}#${i}` }))
      }
    })
    expect(stops).toHaveLength(25)

    const input = baseInput({ stops, dayCount: 3, type: 'weekend' })
    const beats = buildBeats(input)
    const stopBeats = beats.filter((b) => b.kind === BEAT_KINDS.STOP)

    expect(stopBeats.length).toBeLessThanOrEqual(6)

    // First (earliest-time) eligible stop of each of the 3 days must be represented.
    for (const day of [0, 1, 2]) {
      expect(stopBeats.some((b) => b.data.day === day && b.data.time === '09:00')).toBe(true)
    }

    // Re-sorted by (day, time): non-decreasing throughout the selection.
    for (let i = 1; i < stopBeats.length; i++) {
      const prev = stopBeats[i - 1].data
      const cur = stopBeats[i].data
      const prevKey = `${prev.day}-${prev.time}`
      const curKey = `${cur.day}-${cur.time}`
      expect(prevKey <= curKey).toBe(true)
    }

    // The last selected stop beat carries the truncation count.
    const last = stopBeats[stopBeats.length - 1]
    expect(last.data.moreCount).toBe(25 - stopBeats.length)

    const totalMs = beats.reduce((sum, b) => sum + b.durationMs, 0)
    expect(totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
  })

  it('the deterministic selector is stable across repeated calls on the same input (replays are identical)', () => {
    const stops = Array.from({ length: 10 }, (_, i) => stop({ key: `stop-${i}`, day: i % 3, time: `${String(9 + i).padStart(2, '0')}:00`, activity: `S${i}` }))
    const input = baseInput({ stops })
    const a = buildBeats(input).filter((b) => b.kind === BEAT_KINDS.STOP).map((b) => b.id)
    const b = buildBeats(input).filter((b) => b.kind === BEAT_KINDS.STOP).map((b) => b.id)
    expect(a).toEqual(b)
  })
})

describe('buildBeats -- total duration invariant', () => {
  // MAX_TOTAL_MS is enforced inside buildBeats itself (STOP beats are
  // trimmed from the end of the montage backwards until the timeline
  // fits) -- these tests check that as a real invariant across a spread of
  // deliberately extreme inputs, not as one assertion on one input shape.
  const manyStops = (count, days) => Array.from({ length: count }, (_, i) => {
    const day = i % days
    const hour = String(6 + Math.floor(i / days)).padStart(2, '0')
    return stop({ key: `stop-${i}`, day, time: `${hour}:${String(i % 60).padStart(2, '0')}`, activity: `Stop ${i}` })
  })
  const manyGoing = (n) => Array.from({ length: n }, (_, i) => ({ name: `Lad ${i}`, photoUrl: '', avatarIndex: i % 8 }))
  const aChampion = { name: 'Kevin', photoUrl: '', avatarIndex: 1, title: 'Overall Champion', detail: '142 pts · Mensday 2026' }
  const nowMs = Date.parse('2026-01-01T00:00:00')
  const futureIso = '2026-06-01T12:00:00'

  const extremeInputs = [
    {
      label: 'max stops (25, 3-day) x max attendees x champion x secrets x countdown, default caps',
      input: baseInput({
        stops: [...manyStops(25, 3), stop({ key: 'secret-0', secret: true, day: 0, time: '23:00' }), stop({ key: 'secret-1', secret: true, day: 1, time: '23:30' })],
        secretCount: 2,
        goingCount: 50,
        going: manyGoing(50),
        champion: aChampion,
        startsAtIso: futureIso,
      }),
      opts: { nowMs },
    },
    {
      label: 'a 7-day event, one-ish stop per day, plus everything else maxed',
      input: baseInput({
        stops: [...manyStops(14, 7), stop({ key: 'secret-0', secret: true, day: 3, time: '23:00' })],
        secretCount: 1,
        goingCount: 30,
        going: manyGoing(30),
        champion: aChampion,
        dayCount: 7,
        type: 'weekend',
        startsAtIso: futureIso,
      }),
      opts: { nowMs },
    },
    {
      label: 'a single-stop (spotlight) event with everything else maxed',
      input: baseInput({
        stops: [stop({ key: 'stop-0', activity: 'Go-karten' }), stop({ key: 'secret-0', secret: true, day: 0, time: '23:00' })],
        secretCount: 1,
        goingCount: 40,
        going: manyGoing(40),
        champion: aChampion,
        startsAtIso: futureIso,
      }),
      opts: { nowMs },
    },
    {
      label: 'a fully empty event (the floor)',
      input: baseInput(),
      opts: {},
    },
    {
      label: 'a caller-supplied maxStopBeats far above the default, still with everything else maxed',
      input: baseInput({
        stops: [...manyStops(25, 3), stop({ key: 'secret-0', secret: true, day: 0, time: '23:00' })],
        secretCount: 1,
        goingCount: 50,
        going: manyGoing(50),
        champion: aChampion,
        startsAtIso: futureIso,
      }),
      opts: { nowMs, maxStopBeats: 25 },
    },
  ]

  for (const { label, input, opts } of extremeInputs) {
    it(`stays within MAX_TOTAL_MS: ${label}`, () => {
      const beats = buildBeats(input, opts)
      const { totalMs } = buildTimeline(beats)
      expect(totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)
    })
  }

  it('trimming actually engages when the assembled timeline would exceed the cap: fewer STOP beats survive, moreCount stays accurate, and every other kind is untouched', () => {
    const input = baseInput({
      stops: [...manyStops(25, 3), stop({ key: 'secret-0', secret: true, day: 0, time: '23:00' })],
      secretCount: 1,
      goingCount: 50,
      going: manyGoing(50),
      champion: aChampion,
      startsAtIso: futureIso,
    })
    // maxStopBeats: 20 alone would demand roughly 20 x 2.6s = 52s of montage
    // on top of title/meta/countdown/secret/legacy/roster/outro -- comfortably
    // over MAX_TOTAL_MS, so the total-duration trim (not the montage-cap
    // selector) is what has to do the trimming here.
    const beats = buildBeats(input, { nowMs, maxStopBeats: 20 })
    const { totalMs } = buildTimeline(beats)
    expect(totalMs).toBeLessThanOrEqual(MAX_TOTAL_MS)

    const stopBeats = beats.filter((b) => b.kind === BEAT_KINDS.STOP)
    expect(stopBeats.length).toBeGreaterThan(0)
    expect(stopBeats.length).toBeLessThan(20) // trimming actually removed some

    const last = stopBeats[stopBeats.length - 1]
    expect(last.data.moreCount).toBe(25 - stopBeats.length)
    // No earlier stop beat carries a stale moreCount.
    for (const b of stopBeats.slice(0, -1)) {
      expect(b.data).not.toHaveProperty('moreCount')
    }

    // Every non-STOP kind survives the trim untouched. COUNTDOWN is
    // intentionally excluded from this list: it's no longer a standalone
    // beat kind (folded onto META's `data`, see buildBeats.js) so it would
    // never appear here regardless of trimming -- asserting its absence
    // would be a tautology, not a real invariant check. The countdown data
    // itself surviving on META is asserted separately below.
    for (const kind of [BEAT_KINDS.TITLE, BEAT_KINDS.META, BEAT_KINDS.SECRET, BEAT_KINDS.LEGACY, BEAT_KINDS.ROSTER, BEAT_KINDS.OUTRO]) {
      expect(beats.some((b) => b.kind === kind)).toBe(true)
    }
    expect(kinds(beats)).not.toContain(BEAT_KINDS.COUNTDOWN)
    const meta = beats.find((b) => b.kind === BEAT_KINDS.META)
    expect(meta.data).toHaveProperty('daysToGo')
  })

  it('trimming never throws or infinite-loops even in a pathological case, and returns whatever survives', () => {
    const input = baseInput({
      stops: manyStops(25, 3),
      goingCount: 50,
      going: manyGoing(50),
      champion: aChampion,
    })
    expect(() => buildBeats(input, { maxStopBeats: 25 })).not.toThrow()
  })
})

describe('buildBeats -- roster', () => {
  const goingOf = (n) => Array.from({ length: n }, (_, i) => ({ name: `Lad ${i}`, photoUrl: '', avatarIndex: i }))

  it('fewer than 3 going -> ROSTER dropped', () => {
    const beats = buildBeats(baseInput({ goingCount: 2, going: goingOf(2) }))
    expect(ids(beats)).not.toContain('roster')
  })

  it('3+ going -> ROSTER emitted, capped at 10 named, moreCount for the rest', () => {
    const beats = buildBeats(baseInput({ goingCount: 14, going: goingOf(14) }))
    const roster = beats.find((b) => b.id === 'roster')
    expect(roster).toBeTruthy()
    expect(roster.data.going).toHaveLength(10)
    expect(roster.data.moreCount).toBe(4)
    expect(roster.durationMs).toBeLessThanOrEqual(16000)
  })

  it('roster duration grows with headcount up to the cap', () => {
    const small = buildBeats(baseInput({ goingCount: 3, going: goingOf(3) })).find((b) => b.id === 'roster')
    const big = buildBeats(baseInput({ goingCount: 10, going: goingOf(10) })).find((b) => b.id === 'roster')
    expect(big.durationMs).toBeGreaterThan(small.durationMs)
  })

  it('an unsafe photoUrl on a going attendee degrades to no photoUrl (never an invalid src)', () => {
    const going = [{ name: 'A', photoUrl: 'javascript:alert(1)', avatarIndex: 0 }, ...goingOf(2)]
    const roster = buildBeats(baseInput({ goingCount: 3, going })).find((b) => b.id === 'roster')
    expect(roster.data.going[0].photoUrl).toBe('')
  })
})

describe('buildBeats -- legacy (last year\'s champion)', () => {
  const champion = (overrides = {}) => ({
    name: 'Kevin',
    photoUrl: 'https://cdn.example.com/kevin.jpg',
    avatarIndex: 3,
    title: 'Overall Champion',
    detail: '142 pts · Mensday 2026',
    ...overrides,
  })

  it('no champion on the input -> no legacy beat, never a placeholder', () => {
    const beats = buildBeats(baseInput())
    expect(ids(beats)).not.toContain('legacy')
    expect(kinds(beats)).not.toContain(BEAT_KINDS.LEGACY)
  })

  it('a champion on the input -> exactly one legacy beat with the full shape', () => {
    const beats = buildBeats(baseInput({ champion: champion() }))
    const legacy = beats.filter((b) => b.kind === BEAT_KINDS.LEGACY)
    expect(legacy).toHaveLength(1)
    expect(legacy[0].id).toBe('legacy')
    expect(legacy[0].data).toEqual({
      name: 'Kevin',
      photoUrl: 'https://cdn.example.com/kevin.jpg',
      avatarIndex: 3,
      title: 'Overall Champion',
      detail: '142 pts · Mensday 2026',
    })
  })

  it('sits between SECRET and ROSTER in beat order, per the creative shot list', () => {
    const beats = buildBeats(baseInput({
      stops: [stop({ key: 'stop-0', secret: true, day: 0, time: '22:00' })],
      secretCount: 1,
      champion: champion(),
      goingCount: 5,
      going: goingOfHelper(5),
    }))
    expect(ids(beats)).toEqual(['title', 'meta', 'secret', 'legacy', 'roster', 'outro'])
  })

  it('an unsafe champion photoUrl degrades to no photoUrl, never an invalid src', () => {
    const beats = buildBeats(baseInput({ champion: champion({ photoUrl: 'javascript:alert(1)' }) }))
    const legacy = beats.find((b) => b.kind === BEAT_KINDS.LEGACY)
    expect(legacy.data.photoUrl).toBe('')
  })

  it('a malformed champion (wrong field types) never throws and degrades field-by-field', () => {
    const beats = buildBeats(baseInput({ champion: { name: 123, title: null } }))
    const legacy = beats.find((b) => b.kind === BEAT_KINDS.LEGACY)
    expect(legacy).toBeTruthy()
    expect(legacy.data).toEqual({ name: '', photoUrl: '', avatarIndex: 0, title: '', detail: '' })
  })

  it('a non-object champion (e.g. a stray boolean/string) is treated as absent', () => {
    expect(ids(buildBeats(baseInput({ champion: true })))).not.toContain('legacy')
    expect(ids(buildBeats(baseInput({ champion: 'Kevin' })))).not.toContain('legacy')
  })
})

describe('buildBeats -- reduced motion / save-data', () => {
  it('dropFlashBeatsForReducedMotion (the underlying mechanism) drops only beats marked flash, given a synthetic fixture -- coverage independent of whether any real beat sets the flag', () => {
    const synthetic = [
      { id: 'a', kind: 'title', durationMs: 100, data: {} },
      { id: 'b', kind: 'stop', durationMs: 100, data: {}, flash: true },
      { id: 'c', kind: 'outro', durationMs: 100, data: {} },
      { id: 'd', kind: 'stop', durationMs: 100, data: {}, flash: true },
    ]
    expect(dropFlashBeatsForReducedMotion(synthetic).map((b) => b.id)).toEqual(['a', 'c'])
  })

  it('no beat in the current shot list is marked flash: reducedMotion currently changes nothing (this pins the product decision that a type-on wordmark is not a vestibular hazard, and would fail loudly the moment someone adds a flash flag back without meaning to)', () => {
    const input = baseInput({
      stops: [stop({ key: 'stop-0' })],
      secretCount: 0,
      goingCount: 5,
      going: goingOfHelper(5),
      champion: { name: 'Champ', photoUrl: '', avatarIndex: 0, title: 'Overall Champion', detail: '142 pts' },
    })
    const full = buildBeats(input)
    const reduced = buildBeats(input, { reducedMotion: true })
    expect(full.some((b) => b.flash)).toBe(false)
    expect(ids(reduced)).toEqual(ids(full))
  })

  it('saveData: true strips every `media` key from every beat, keeps everything else', () => {
    const input = baseInput({ stops: [stop({ key: 'stop-0', image: 'https://cdn.example.com/a.jpg' })] })
    const normal = buildBeats(input)
    const lite = buildBeats(input, { saveData: true })
    expect(normal.some((b) => 'media' in b)).toBe(true)
    expect(lite.some((b) => 'media' in b)).toBe(false)
    expect(ids(lite)).toEqual(ids(normal))
  })
})

describe('buildBeats -- determinism & robustness', () => {
  it('two calls on the same input deep-equal', () => {
    const input = baseInput({
      stops: [stop({ key: 'stop-0' }), stop({ key: 'stop-1', secret: true, day: 0, time: '23:30' })],
      secretCount: 1,
      goingCount: 5,
      going: goingOfHelper(5),
    })
    const a = buildBeats(input, { nowMs: 0 })
    const b = buildBeats(input, { nowMs: 0 })
    expect(a).toEqual(b)
  })

  it('never throws on a maximally-empty/malformed input', () => {
    expect(() => buildBeats({})).not.toThrow()
    expect(() => buildBeats(null)).not.toThrow()
    expect(() => buildBeats(undefined)).not.toThrow()
  })

  it('OUTRO is always present regardless of how sparse the input is', () => {
    expect(ids(buildBeats({}))).toContain('outro')
  })
})

function goingOfHelper(n) {
  return Array.from({ length: n }, (_, i) => ({ name: `Lad ${i}`, photoUrl: '', avatarIndex: i }))
}
