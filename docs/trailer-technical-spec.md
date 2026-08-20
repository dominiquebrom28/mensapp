# Event Trailer — Technical Spec

> Owner: architect · Date: 2026-08-20 · Backlog ticket #4
> Companion document: `trailer-creative-spec.md` (creative direction, beat list)
> **Status:** ready to build

## Headline answers

**Where the code lives:** `src/features/trailer/` — a real ES-module directory, lazy-loaded via `React.lazy`. **App.jsx grows by ~30 lines and no existing line moves.** This is possible because of the key finding: `PresentationMode` uses *zero* shared primitives (`Card`/`Btn`/`H`/`Inp`/`Avatar`) — a fullscreen cinematic takeover has its own visual language. The trailer is the same, so nothing needs extracting. The five date helpers are called by a small adapter *inside App.jsx* that hands the trailer pre-formatted, pre-sorted, pre-redacted plain data. **All 8 test files that parse App.jsx as text survive untouched**, because every extractor matches by declaration name and we move nothing.

**Animation library: no.** Zero new dependencies. rAF for *sequencing* (one loop, `setState` only on beat change — ~10 times, never per frame), CSS `@keyframes` for *motion within a beat* (already the house idiom in `GS`). Rejected framer-motion/GSAP on bundle size (668 kB single chunk) and on fit — a linear non-interactive sequence needs no springs, gestures or layout animation. Rejected WAAPI on testability: jsdom implements no `Element.prototype.animate`.

**Blocker to flag:** the audio track is unlicensed and nobody has sourced one. That is a launch blocker requiring a decision from Dom, not a dev task.

**Scope:** technical shape only. Creative treatment and the beat-by-beat shot list are the designer's deliverable, consumed here as *data + CSS*, not as structure.

**Prior art studied:** `PresentationMode` (`src/App.jsx:4871-5114`), `EventPage` (`src/App.jsx:1337-1520`), the source-extraction test helpers.

---

## 1. Summary

A ~35–55 second auto-playing cinematic trailer announcing an upcoming event. Launched by tapping **🎬 Watch the trailer** on the event page — that tap starts playback and unlocks audio — then plays itself through a fixed timeline with no navigation, replayable any number of times.

It is a **read-only, client-only feature**: no tables, no columns, no queries, no realtime channels, no writes. It renders data the client already holds.

---

## 2. Data model

### 2.1 Schema changes: none

Everything comes from the `events` row already loaded by App.jsx's mount fetch and kept fresh by `EventPage`'s existing `postgres_changes` subscription (`src/App.jsx:1363-1370`).

**Rejected:** a `trailer_tagline` / `trailer_config` column for bespoke authored copy. It's a v2 problem — prove the trailer earns its maintenance first. If the designer needs an authored tagline, use `events.theme` (exists, already editable). **Do not add the column in this scope.**

### 2.2 Authorization intent

Unchanged, deliberately. Zero new read or write paths means zero new policy surface.

| Path | Who | Enforcement |
|---|---|---|
| `events` row read | Anyone with the anon key (existing) | Existing RLS on `events` — untouched |
| Trailer render | Any logged-in user on the event page | Client-side only. Not a security boundary. |
| Any write | — | **None. No `onUpdate`, no `supabase.from(...)`, no `channel.send`.** |

### 2.3 In-memory data model

The trailer never touches an `evt` row. It consumes a plain, serialisable, **pre-redacted** view model built by an adapter in App.jsx. This is the most important structural decision here: secret data is *removed* at the boundary, so it cannot leak from inside the feature.

```js
/**
 * @typedef {Object} TrailerStop
 * @property {string}  key       stable id, `stop-${realScheduleIndex}`
 * @property {boolean} secret
 * @property {number}  day       0-based, as stored
 * @property {string}  dayLabel  dayHeadingLabel(evt.date, day)
 * @property {string}  time      "20:30" | ""
 * @property {string}  [icon]     present only when !secret
 * @property {string}  [activity] present only when !secret
 * @property {string}  [location] present only when !secret
 * @property {string}  [note]     present only when !secret
 * @property {string}  [image]    present only when !secret AND isSafeImageUrl(image)
 */

/**
 * @typedef {Object} TrailerInput
 * @property {string} eventId
 * @property {string} name
 * @property {string} type            "day" | "weekend"
 * @property {string} theme           "" when unset
 * @property {string} location        "" when unset or "TBD"
 * @property {string} dateLabel       formatEventDateRange(evt.date, evt.end_date)
 * @property {string} startsAtIso     `${evt.date}T${evt.start_time||"12:00"}:00`
 * @property {number} dayCount        eventDayCount(evt.date, evt.end_date)
 * @property {TrailerStop[]} stops    sorted by scheduleDayTimeOrder, secrets redacted
 * @property {number} secretCount
 * @property {number} goingCount
 * @property {{name:string, photoUrl:string, avatarIndex:number}[]} going  max 12
 */
```

Adapter, added at App.jsx module scope immediately after `scheduleDayTimeOrder`:

```js
// Boundary adapter for the trailer feature (src/features/trailer/). Produces a
// plain, serialisable view model with every `secret` stop's content REMOVED --
// not flagged, removed -- so the trailer subsystem cannot leak it even by
// accident. Keep the `const NAME=(...)=>{ ... };` shape: the source-extraction
// test helpers in src/test/ match on it.
const toTrailerInput=(evt,users=[])=>{
  const stops=(evt.schedule||[]).map((s,i)=>({s,i}))
    .sort((a,b)=>scheduleDayTimeOrder(a.s,b.s))
    .map(({s,i})=>{
      const base={key:`stop-${i}`,secret:!!s.secret,day:s.day??0,dayLabel:dayHeadingLabel(evt.date,s.day??0),time:s.time||""};
      if(s.secret)return base;
      return{...base,icon:s.icon||"",activity:s.activity||"",location:s.location||"",note:s.note||"",image:isSafeImageUrl(s.image)?s.image:""};
    });
  const going=(evt.attendees||[]).filter(a=>a.status==="going")
    .slice(0,12).map(a=>({name:getDisplayName(a.name,users),...getUA(a.name,users)}));
  return{
    eventId:evt.id,name:evt.name||"",type:evt.type||"day",theme:evt.theme||"",
    location:(evt.location&&evt.location!=="TBD")?evt.location:"",
    dateLabel:formatEventDateRange(evt.date,evt.end_date),
    startsAtIso:`${evt.date}T${evt.start_time||"12:00"}:00`,
    dayCount:eventDayCount(evt.date,evt.end_date),
    stops,secretCount:stops.filter(s=>s.secret).length,
    goingCount:(evt.attendees||[]).filter(a=>a.status==="going").length,
    going:going.map(g=>({name:g.name,photoUrl:g.photoUrl||"",avatarIndex:g.index??0})),
  };
};
```

`isSafeImageUrl` is imported from `src/features/trailer/safeUrl.js` (§11).

---

## 3. Where the code lives

### Decision: `src/features/trailer/`, real ES modules, lazy-loaded. App.jsx grows ~30 lines; **no existing line moves.**

App.jsx is ~6,300 lines and tickets 21–25 are a stalled split plan. Adding a ~900-line trailer subsystem inline makes that plan strictly harder and buys nothing. But the reason the split stalled is real: four test files read App.jsx as text and slice declarations out by name. The design below makes the trailer the first properly-modularised part of the codebase **without touching a single existing declaration**.

### File layout

```
public/trailer/theme-v1.mp3          NEW (public/ does not exist yet — create it)

src/features/trailer/
  EventTrailer.jsx        default export. Fullscreen shell, start poster, controls, close.
  TrailerStage.jsx        renders the active beat + the outgoing beat's crossfade layer.
  TrailerStyles.jsx       one static <style> block of @keyframes, same idiom as GS.
  beats/
    BeatTitle.jsx  BeatMeta.jsx  BeatStop.jsx  BeatSecret.jsx
    BeatRoster.jsx BeatCountdown.jsx BeatOutro.jsx
  buildBeats.js           pure. (TrailerInput, opts) -> Beat[]
  timeline.js             pure. buildTimeline / beatIndexAt / progressAt
  useTrailerClock.js      rAF clock, injectable now/raf
  useMediaPreloader.js    preload + decode + timeout + concurrency cap
  useTrailerAudio.js      <audio> lifecycle, gesture start, drift correction, mute
  seen.js                 localStorage read/write
  safeUrl.js              isSafeImageUrl
  constants.js            TRAILER_VERSION, durations, caps, AUDIO_SRC

src/test/trailer/
  buildBeats.test.js  timeline.test.js  useTrailerClock.test.js  EventTrailer.render.test.jsx
src/test/mocks/mediaEnv.js   NEW shared mock: matchMedia, HTMLMediaElement.play, Image.decode
```

### Shared primitives: the trailer needs none of them

Not a guess — `PresentationMode` already proves it. It uses **zero** of `Card`/`Btn`/`H`/`Inp`/`Avatar`; it renders raw `div`/`button` with inline styles.

- `Card`, `H`, `Inp`, `Tag`, `Modal`, `Lbl` — **not used.** Nothing to extract.
- `Btn` — used only by the *launcher button*, which stays inside `EventPage` in App.jsx. Nothing crosses the boundary.
- `Avatar` — the roster beat wants avatars. **Do not import it.** The adapter flattens each attendee to `{name, photoUrl, avatarIndex}`, and the trailer renders a ~25-line `TrailerAvatar` inside `BeatRoster.jsx` with its own oversized cinematic styling. *Honest downside:* if `ANIMALS` gains an eleventh animal the trailer won't know — accepted, because the trailer uses `photoUrl` when present and a monogram otherwise.
- The five date helpers — **not imported.** Called by `toTrailerInput` *inside App.jsx*; the trailer receives formatted strings. Zero coupling.
- `useIsMobile` — **not used.** A resize listener that `setState`s mid-playback is a re-render we don't want. All trailer sizing is `clamp()`/`vw`/`dvh`.

Dependency edge runs one way only: `App.jsx → src/features/trailer/`. No circular imports.

### What breaks in the existing tests: nothing

| File | Extracts from App.jsx text | Affected? |
|---|---|---|
| `helpers.pure.test.js` | 12 helpers incl. `formatEventDateRange` | **No** |
| `formatEventDateRange.qa.test.js` | `formatEventDateRange` | **No** |
| `scheduleDays.test.js` | the 4 day helpers | **No** |
| `presentationModeOrder.test.jsx` | date helpers + `useIsMobile` + `PresentationMode` body | **No** |
| `editScheduleModal.dayGrouping.test.js` | inner lines of `EditScheduleModal` | **No** |
| `eventPastCurrent.multiDay.test.js` | inner lines of `Home` / `EventCard` | **No** |
| `Modal.test.jsx` | `Card`, `Modal` | **No** |
| `App.smoke.test.jsx` | mounts `App` with mocked supabase | **No** — trailer is lazy, never loaded on the login screen |

All safe **because every extractor matches by declaration name, not line number, and we move nothing.** Constraints the implementer must respect:

1. Do not move, rename or reformat any existing `const NAME=` declaration in App.jsx.
2. Do not reflow `PresentationMode` — `presentationModeOrder.test.jsx` brace-matches its body. Leave it byte-identical.
3. New App.jsx declarations must close with a lone `};` on its own line.
4. Adding `lazy, Suspense` to the line-1 React import is safe.

### The alternative rejected

Move the five date helpers to `src/lib/eventDates.js` with named exports. That is the architecturally correct end state and where tickets 21–25 should go. It costs updating four test files — maybe two hours, and it makes those tests *better*. But it's a refactor with its own regression risk, isn't required by this feature, and bundling it into a ship-fast ticket is how both end up late. **File it as ticket 21a.** When it lands, `toTrailerInput` moves to `src/lib/` and the trailer changes not at all — that is the point of the adapter.

### Lazy loading

```js
// App.jsx line 1
import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
// module scope
const EventTrailer = lazy(() => import("./features/trailer/EventTrailer.jsx"));
```

The app's **first code split**, and free here. Keeps its weight out of the 668 kB main chunk and gives ticket 29 a working precedent. Suspense fallback is `null`.

### App.jsx delta (complete list)

1. Line 1 import: add `useMemo, lazy, Suspense`.
2. `const EventTrailer = lazy(...)` at module scope.
3. `const toTrailerInput=(evt,users=[])=>{...};` after `scheduleDayTimeOrder` (§2.3).
4. In `EventPage`: `const [trailerOpen,setTrailerOpen]=useState(false);` and `const canTrailer=!isPast&&(evt.schedule?.length||0)>0;`
5. In the footer bar (`src/App.jsx:1459-1475`), **between** the `isAdmin` ternary and the "N activities on the menu 👀" span — so it renders for admins and non-admins alike:
   ```jsx
   {canTrailer&&<Btn onClick={()=>setTrailerOpen(true)} variant="gold" size="sm">🎬 Watch the trailer</Btn>}
   ```
   Do **not** put it inside the `isAdmin` branch next to `▶ Present`; that branch is admin-only and the trailer is for everyone.
6. At the bottom of `EventPage`'s return, next to the existing `PresentationMode` mounts:
   ```jsx
   {trailerOpen&&<Suspense fallback={null}>
     <EventTrailer input={toTrailerInput(evt,users)} onClose={()=>setTrailerOpen(false)}/>
   </Suspense>}
   ```

---

## 4. Reuse vs rebuild against `PresentationMode`

`PresentationMode` stays **untouched**. It is the manually-driven morning-of walkthrough with a live presenter, presence sync and destructive reveal writes. Generalising it into "a thing that shows schedule stops fullscreen" couples a live, high-stakes tool to a marketing toy, and the first bug in the shared abstraction lands during the actual event.

| From PresentationMode | Verdict |
|---|---|
| `position:fixed; inset:0; zIndex:1000` takeover shell | **Reuse the pattern.** Works on iOS where `requestFullscreen` doesn't. Trailer uses `zIndex:1100`. |
| Background media layer + gradient scrim | **Reuse the pattern**, rebuilt as a two-layer crossfade (§6.4). |
| Gold shimmer top bar | **Reuse** — one div, keyframe already in `GS`. |
| Secret "mystery slide" concept | **Reuse the idea.** `BeatSecret` is its descendant, but teases rather than states. |
| `scheduleDayTimeOrder` ordering | **Reuse** — applied in `toTrailerInput`, not in the trailer. |
| `useIsMobile` | **Rebuild as CSS.** No resize-driven re-render mid-playback. |
| Supabase presence + broadcast | **Do not carry over.** Zero channels. |
| Arrow/dot/keyboard nav, `goTo`, `fading` | **Do not carry over.** Replaced by the clock (§5). |
| `toggleReveal` + `onUpdate` DB mutation | **Do not carry over.** The trailer never writes. |
| `requestFullscreen()` as a requirement | **Downgrade to best-effort.** Attempted once on the start tap, `.catch(()=>{})`. iOS Safari refuses on non-`<video>`. |
| Body scroll lock | **Add** (PresentationMode lacks it): `document.body.style.overflow="hidden"` on mount, restore exact previous value on unmount. |

---

## 5. The timeline / sequencing engine

### 5.1 Beats are data, not JSX

```js
/**
 * @typedef {Object} Beat
 * @property {string}  id            stable: "title" | "stop-3" | "secret-2" | "outro"
 * @property {string}  kind          one of BEAT_KINDS
 * @property {number}  durationMs    on-screen time
 * @property {Object}  data          plain, already-resolved props for the beat component
 * @property {string}  [media]       image URL this beat wants preloaded (absent = typographic)
 * @property {boolean} [flash]       designer flag: rapid-cut/strobe. Dropped under reduced motion.
 */
export const BEAT_KINDS = {
  TITLE:'title', META:'meta', STOP:'stop', SECRET:'secret',
  ROSTER:'roster', COUNTDOWN:'countdown', OUTRO:'outro',
};
```

```js
// buildBeats.js — Pure. No React, no Date.now(), no DOM. Deterministic.
export function buildBeats(input, opts = {})   // opts: {reducedMotion, saveData, maxStopBeats, nowMs}

// timeline.js
export function buildTimeline(beats)   // -> {segments:[{beat,startMs,endMs}], totalMs}
export function beatIndexAt(timeline, tMs)   // clamped 0..n-1; -1 when tMs >= totalMs
export function progressAt(timeline, tMs)    // -> {index, localMs, localPct, globalPct}
```

Hardcoding the sequence would be faster to write and wrong: the shot list will change, the sequence must adapt from 0 to 25 stops, and only the data version is unit-testable without mounting anything. It also hands a future exporter an edit decision list for free.

### 5.2 Substrate: one rAF clock for *sequencing*, CSS for *motion*. No library.

**Sequencing** — a single `requestAnimationFrame` loop over `performance.now()`. Rejected:

- *Chained `setTimeout`* — drifts, can't pause mid-beat, can't seek, can't test deterministically.
- *Web Animations API as master timeline* — technically the best scrubbing substrate. Rejected on testability: jsdom implements no `Element.prototype.animate`, so every component test needs a polyfill, in a suite whose entire character is "test the real thing cheaply." A rAF loop with an injected clock is testable with a 10-line fake.

**Motion within a beat** — CSS `@keyframes` + `transition` in one static `<style>` block, exactly the idiom already in `GS`. Animations key off beat mount: an element animates because it exists, not because JS tells it to every frame. Off the main thread, correct by construction.

**No animation library.** framer-motion ≈35–50 kB gz, GSAP ≈25 kB gz. What they buy — spring physics, gesture-driven interruption, layout animation — is irrelevant to a linear, non-interruptible sequence. It would be a second animation system beside the CSS one.

### 5.3 Performance rule: React renders once per beat, not once per frame

Driving `setState` from rAF at 60 Hz is the classic way to make this stutter on mid-range Android.

- The loop writes elapsed time to a **ref** (`tRef.current`).
- It calls `setState` **only when `beatIndexAt()` returns a different index** — 8–12 times total.
- Continuous values (progress bar) go straight to the DOM: `rootRef.current.style.setProperty("--tr-progress", pct)`, with `transform: scaleX(var(--tr-progress))`. No React.
- Everything else is pure CSS keyed off mount.

Non-negotiable budget:

- Animate **only `transform` and `opacity`.** Never `width`/`height`/`top`/`background-position`/`box-shadow`/`filter: blur()`.
- **Zero `backdrop-filter` on any animating element.** `PresentationMode` uses several — fine for a static slideshow, not during a continuous ken-burns pan.
- At most **two** `<img>` mounted at once (outgoing + incoming).
- `will-change: transform, opacity` on those two layers only; removed when inactive.
- Target 8–12 beats, 32–45 s, hard cap 60 s.

### 5.4 The clock hook

```js
export function useTrailerClock({ totalMs, onBeatChange, onEnd, now, raf, caf })
// -> { state:'idle'|'playing'|'paused'|'ended', index, tRef,
//      play, pause, toggle, seek, restart, nudgeTo }
```

Semantics that must be right:

- **Pause** captures `tRef.current` and cancels the frame; **resume** re-bases the epoch so no time is lost or gained.
- **Frame delta clamped to 100 ms.** A backgrounded tab or GC pause must not teleport three beats forward.
- `onBeatChange` fires **exactly once per boundary crossing**, even if one frame spans two short beats.
- **StrictMode-safe.** `main.jsx` renders under `<StrictMode>`; every effect mounts, unmounts, remounts in dev. Start the loop in an effect whose cleanup cancels the frame and nulls the handle — two live loops means a double-speed trailer. Covered by a mount/unmount test.
- `state:'ended'` holds on the final beat's last frame rather than unmounting.

User controls (deliberately minimal):

| Control | Behaviour |
|---|---|
| Tap/click the stage | `toggle()` pause/resume, with a brief ⏸/▶ glyph |
| `Space` | `toggle()` |
| `Escape`, ✕ | close |
| **Skip** (always visible) | close immediately |
| **Replay** (end card) | `restart()` + audio `currentTime = 0` |
| Mute toggle | audio only; persists to `localStorage` |

No scrubbing, no next/prev — that's `PresentationMode`'s job.

### 5.5 Beat-to-data binding and degradation

Each beat kind has a **build-time guard**: `buildBeats` does not emit a beat whose data is absent. There are no runtime `if (!data) return null` branches inside beat components — a mounted beat is guaranteed to have what it needs.

| Beat | Emitted when | Degrades to |
|---|---|---|
| `TITLE` | always | — |
| `META` | `dateLabel` non-empty | dropped; `TITLE` absorbs the date line |
| `STOP` | `!secret && activity` non-empty | image missing/unsafe/failed → typographic variant |
| `SECRET` | `secretCount > 0` | one beat for the whole event, never one per secret |
| `ROSTER` | `goingCount >= 3` | dropped |
| `COUNTDOWN` | `startsAtIso` parses **and** is in the future | dropped |
| `OUTRO` | always | — |

**Floor sequence** (empty schedule, no location, no RSVPs): `TITLE → META → OUTRO`, ~9 s. Coherent and shippable. Assert it in a test.

**Ceiling** (25-stop weekend): stop beats capped at `maxStopBeats` (default **6**) by a deterministic selector — first stop of each day in day order, then fill remaining slots with the earliest unselected stops, then re-sort by `(day, time)`. Deterministic means testable and means replays are identical.

**Secret handling.** Secret stops reach `buildBeats` already stripped by the adapter. `BeatSecret` renders only `{count, times[], dayLabels[]}`. Invariants, each with a test:

1. No `kind === 'secret'` beat carries an `activity`, `note`, `location` or `media` key.
2. Deep-JSON-scan of `buildBeats(...)` output contains none of the secret stops' strings — run against both a redacted and a deliberately un-redacted hostile input.
3. No secret stop's `image` URL is ever handed to the preloader. A request to a recognisably-named Supabase object is a leak in the network panel even if nothing renders.

---

## 6. Media

### 6.1 Loading

**The timeline is authoritative, media is opportunistic. Media never blocks a beat transition.**

```js
export function useMediaPreloader(urls, { lookahead, concurrency, timeoutMs, enabled })
// -> { statusOf(url), ensureFrom(beatIndex), preflight(count) }
```

- **Preflight**, while the tap-to-start poster is up: load the first **2** URLs, `timeoutMs: 4000`, raced against a **3 s** overall budget. Playback starts when preflight settles or the budget expires.
- **Rolling**, during playback: on each `onBeatChange`, `ensureFrom(index)` loads `index+1` and `index+2`. Concurrency capped at **3**.
- **Decode before show:** `img.decode?.() ?? onload`. Treat a `decode()` rejection as failure, fall back to `onload` once, then give up. Decoding a 4 MB JPEG on the main thread at the moment of a crossfade is the single most likely cause of a visible hitch.
- **Timeout / error / unsafe URL** → status `failed` → typographic variant. Silently. No broken-image icon.
- The detached `Image` warms the HTTP cache; the real `<img>` paints from cache. Supabase Storage sends `cache-control: max-age=3600`.
- Do **not** set `crossOrigin` — we never read pixels, and setting it turns a CORS misconfiguration into a hard failure.
- `<img decoding="async" loading="eager" fetchpriority="high">` on the active layer.

### 6.2 Save-data / slow connection

```js
const lite = navigator.connection?.saveData === true
  || ['slow-2g','2g'].includes(navigator.connection?.effectiveType);
```

When `lite`, `buildBeats` emits every beat without `media`. The trailer becomes a fully typographic cut — a legitimate cinematic register, not a broken state. Three lines; removes the entire failure mode for the users most likely to hit it.

### 6.3 Audio

- **One asset:** `public/trailer/theme-v1.mp3`, referenced as `/trailer/theme-v1.mp3`. Create `public/`. Budget **≤ 1.5 MB**, ~45 s, 96–128 kbps. Versioned filename so immutable caching is safe — bump to `theme-v2.mp3`, never replace bytes.
- **Gesture gate.** `audio.play()` is called *synchronously* inside the tap handler — anything async before it loses the gesture. `<audio preload="auto">` created on mount so bytes arrive before the tap.
- **Audio is NOT the clock.** The rAF clock is. Audio must be droppable and the trailer must run anyway.
- **One-way soft correction.** On each `onBeatChange`, if audio is playing and `|audio.currentTime*1000 - tRef.current| > 250`, call `nudgeTo(...)`, clamped to **±400 ms per correction**. Never set `audio.currentTime` from the clock — that causes audible seeking artefacts.
- **Failure:** if neither `canplaythrough` nor `error` fires within **5 s**, or `play()` rejects, mark audio unavailable, hide the mute toggle, play on in silence.
- **Silent switch (iOS):** not reliably detectable. Do not try. Mitigation is editorial — every beat must carry its message typographically. Also render a persistent 🔇/🔊 toggle so someone hearing nothing has something to press.
- **Mute preference** persists to `localStorage["md-trailer-muted"]`.
- **Volume ramp:** 400 ms fade in, 600 ms fade out on outro and close, via a small rAF `audio.volume` ramp. **No Web Audio API.**
- **Visibility:** on `visibilitychange → hidden`, pause clock and audio. On return, **do not auto-resume** — show the paused overlay with a ▶ affordance.

### 6.4 Crossfade

`TrailerStage` keeps exactly two absolutely-positioned layers, alternating which is "front" per beat change. Outgoing gets `opacity: 0` with `transition: opacity 500ms`; incoming gets `opacity: 1`. Unmount the outgoing `<img>` on `transitionend`, with a `setTimeout` backstop.

---

## 7. Reduced motion

**The trailer still plays and still auto-advances.** A motion preference is not a request for no content.

1. `buildBeats(input, { reducedMotion: true })` **drops every beat with `flash: true`.** The designer must mark any rapid-cut, strobe or hard-zoom beat with this flag. Vestibular-safety requirement, not a preference.
2. All transform-based motion off:
   ```css
   [data-tr-rm="1"] *, [data-tr-rm="1"] *::before, [data-tr-rm="1"] *::after {
     animation: none !important;
     transition-property: opacity !important;
     transition-duration: 200ms !important;
     transform: none !important;
   }
   ```
3. Crossfades survive as **opacity-only, 200 ms.** Removing them entirely produces hard cuts, which are *more* jarring.
4. Beat durations **not** shortened. Reading time matters more when nothing moves.
5. Images still show, statically.
6. Because `transform: none !important` kills the progress bar's `scaleX`, the reduced-motion indicator is a discrete "3 / 9" text counter — handled in the component, not the CSS.

---

## 8. Testability

The trailer is the first part of this codebase with normal ES-module exports, so **none of the source-text extraction machinery is needed.**

**`buildBeats.test.js`** — pure:
- empty schedule → floor sequence `['title','meta','outro']`
- all-secret schedule → exactly one `secret` beat, zero `stop` beats
- 25-stop, 3-day weekend → ≤ 6 stop beats, one per day first, re-sorted by `(day,time)`, total ≤ `MAX_TOTAL_MS`
- missing `dateLabel` / `location` / past `startsAtIso` → correct beats dropped
- `reducedMotion: true` → all `flash` beats gone; `saveData: true` → no beat has `media`
- **secret-leak invariant:** deep JSON scan contains none of the secret stops' strings, run against both redacted and deliberately un-redacted input
- determinism: two calls deep-equal

**`timeline.test.js`** — `beatIndexAt` at `t = -1`, `0`, exact segment starts, `end - 1`, `end`, `totalMs`, `totalMs + 1`. Zero-duration beat guard.

**`useTrailerClock.test.js`** — via **dependency injection, not fake timers**:

```js
function makeFakeClock() {
  let t = 0, queue = [], id = 0;
  return {
    now: () => t,
    raf: (cb) => { queue.push({ id: ++id, cb }); return id },
    caf: (x) => { queue = queue.filter(q => q.id !== x) },
    advance(dtMs) { t += dtMs; const q = queue; queue = []; q.forEach(e => e.cb(t)) },
    pending: () => queue.length,
  }
}
```

Asserts: no drift over 500 frames; pause/resume conserves elapsed time exactly; `seek`/`restart`; `onBeatChange` fires once per boundary even when a frame spans two beats; the 100 ms delta clamp; `onEnd` fires once; and **on unmount `caf` is called and `pending()` is 0** (the StrictMode double-loop guard).

**`EventTrailer.render.test.jsx`** — RTL. Needs `src/test/mocks/mediaEnv.js`, stubbed per-file rather than in the shared `setup.js`, so there is **zero risk to the existing 159 tests**: `window.matchMedia`, `HTMLMediaElement.prototype.play/pause/currentTime`, `Image.prototype.decode`, optional `navigator.connection`.

Cases: renders the start poster and does *not* call `play()` before the tap; calls `play()` once on tap; a rejected `play()` still starts the visual trailer; Escape and Skip both call `onClose`; `matchMedia` matching puts `data-tr-rm="1"` on the root; unmount restores `document.body.style.overflow`.

**Not tested:** the visual output. No snapshot testing of animated cinematic UI — a maintenance tax that catches nothing. Visual verification is a manual QA pass on a real mid-range phone.

---

## 9. Work packages

| WP | Contents | Depends on | Parallel? |
|---|---|---|---|
| **A** | `buildBeats.js`, `timeline.js`, `constants.js`, `safeUrl.js` + tests | §2.3 + §5.1 shapes only | ✅ start now |
| **B** | `useTrailerClock.js` + test | §5.4 signature only | ✅ start now |
| **C** | `TrailerStyles.jsx`, `beats/*.jsx`, `TrailerStage.jsx` | **designer's shot list** + A's shapes | ⚠️ blocked on design |
| **D** | `useMediaPreloader.js`, `useTrailerAudio.js`, `seen.js`, `mediaEnv.js` | §6 signatures only | ✅ start now |
| **E** | `EventTrailer.jsx` shell, controls, start poster, App.jsx wiring | A + B + C + D | ❌ integration, last |

One dev: A → B → D → C → E, ~3–4 days plus design turnaround.

**Constraints owed to the designer before they finalise the shot list:**
- Motion is `transform` + `opacity` only. No animated blur, no animated shadows, no `backdrop-filter` on moving elements.
- Max two full-bleed media layers on screen at once.
- Every beat must read without audio. Audio is atmosphere, never information.
- Mark any strobe/rapid-cut/hard-zoom beat `flash: true`.
- 8–12 beats, 32–45 s, hard cap 60 s. Per-beat duration delivered as `durationMs`.
- Deliver a typographic-only variant of every beat.
- Mobile portrait is the primary canvas.

---

## 10. API surface

**There isn't one.** No endpoints, no Supabase queries, no RPCs, no realtime channels, no writes.

| Surface | Shape | Auth check |
|---|---|---|
| `<EventTrailer input={TrailerInput} onClose={fn} />` | React props, in-memory | None needed. Launcher gated by `!isPast && schedule.length > 0`, not by role. |
| `GET /trailer/theme-v1.mp3` | Static asset, first-party | Public by design |
| `localStorage["md-trailer-seen"]` | `{ [eventId]: { v, at } }` | Per-device, non-authoritative |
| `localStorage["md-trailer-muted"]` | `"true" \| "false"` | Per-device |

Seen-tracking is `localStorage` only, matching `ann-dismissed` and `md-sj-unlocked`. Deliberately **not** server-side: with no server-side auth enforcement, a DB-backed seen flag would be trivially spoofable *and* pointless, and would add a write path to a feature that currently has none.

---

## 11. Security & trust model

**Trusted:** nothing from the network. **Semi-trusted:** `events` row content, authored by admins via the existing editors — not attacker-supplied in the normal case, but user-supplied and reaching the DOM, so treated as untrusted at the render boundary.

- **A03 Injection / XSS.** All trailer text renders as **plain text React children**. `renderMd` and `dangerouslySetInnerHTML` are **forbidden anywhere in `src/features/trailer/`.** Add an eslint override for the directory (`react/no-danger: 'error'`) so it's enforced, not remembered. Separately: `TrailerStyles.jsx`'s `<style>` template literal must contain **no interpolation of event data** — an interpolated CSS string is a live injection vector via `evt.theme`. Static string, full stop.
- **A03 / URL handling.** `safeUrl.js`:
  ```js
  export function isSafeImageUrl(u) {
    if (typeof u !== 'string' || !u) return false;
    try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; }
    catch { return false; }
  }
  ```
  Applied in `toTrailerInput`, so an unsafe URL never enters the feature. `data:` and `blob:` rejected — not script-executable in `<img src>`, but rejecting removes a class of surprise for zero cost.
- **Outbound links.** The trailer renders **no links at all** — `stop.locationUrl` is dropped by the adapter. Removes reverse-tabnabbing entirely.
- **A01 Broken access control.** No new access path. Stated plainly and *not* oversold: `secret` stops are already in the client's memory (the whole `events` row is fetched), so the trailer's redaction is a **spoiler control, not a security control.** It stops the app showing a surprise; it does not stop a determined user with devtools. Do not let anyone describe it as security in a PR. The genuine gap (no server-side auth enforcement) is pre-existing, out of scope, and unaffected.
- **A04 Insecure design.** The control that matters is the boundary adapter: secret content is *removed*, not flagged. A `secret: true` flag that every beat component must remember to honour would fail eventually. Removal fails closed.
- **A05 Misconfiguration.** No new env vars, no new secrets, no new third-party origin.
- **A08 Data integrity.** Nothing is written. New dependency count **zero** — no new supply-chain surface.
- **AI trust boundaries — N/A.** No model calls, no tool use.
- **Rate limiting — N/A.** No server calls originate here.
- **PII.** The roster beat shows display names, avatars and photos of "going" RSVPs — all already displayed on the event page to the same audience. No new exposure, nothing logged.

---

## 12. Key decisions & tradeoffs

| Decision | Rejected | Why, and the honest downside |
|---|---|---|
| `src/features/trailer/`, lazy-loaded | Inline in App.jsx | Inline is faster for one hour and worse forever. **Downside:** two conventions coexist until 21–25 land. |
| Adapter stays in App.jsx | Move date helpers to `src/lib/` | Moving breaks 4 test files. Correct refactor, but as **ticket 21a**. **Downside:** the adapter is temporarily in the wrong place. |
| No animation library | framer-motion / GSAP | Already one 668 kB chunk. A linear non-interactive sequence needs no springs or gestures. **Downside:** complex choreography is hand-rolled; if the designer wants physics we say no. |
| rAF clock | WAAPI master timeline | WAAPI is the better scrubbing substrate; jsdom implements none of it. **Downside:** we hand-roll ~60 lines of pause/resume/seek arithmetic. |
| rAF clock | Chained `setTimeout` | Drifts, can't pause cleanly, can't seek, can't test. No upside. |
| Data-driven `Beat[]` | Hardcoded JSX | Shot list will change; data varies 0–25 stops. **Downside:** one more indirection between storyboard and JSX. |
| Audio not the clock | Audio as master clock | Audio must be droppable. **Downside:** backgrounded tabs diverge; ±400 ms nudge is a mitigation, not a cure. |
| Single `<audio>` | Web Audio API | Handles a single music bed. **Downside:** no per-beat stings or precise scheduling. If the shot list demands those, revisit. |
| Best-effort fullscreen | Requiring it | iOS Safari refuses on non-`<video>`. **Downside:** browser chrome stays visible on iOS. Use `100dvh`. |
| Duplicate a 25-line `TrailerAvatar` | Extract shared `Avatar` | Extracting means touching App.jsx declarations and their tests to share four lines of markup. **Downside:** genuine, bounded duplication. |
| `localStorage` seen-tracking | A `trailer_views` table | Would add the feature's only write path for a cosmetic nudge. **Downside:** clearing site data re-nudges. |
| Launcher visible to everyone | Admin-only | The trailer's purpose is hype for the group. **Downside:** none identified. |

### Future hooks — honest assessment

- **Synced premiere: nearly free.** The clock is `seek(tMs)`-driven and `PresentationMode` already proves the channel + presence + broadcast pattern. Broadcast `{startedAtEpochMs}` once; every client calls `seek(Date.now() - startedAtEpochMs)` on join and reconnect. ~40 lines, no redesign.
- **Per-beat analytics: free.** `onBeatChange` already exists.
- **Video export: NOT nearly free — do not let anyone believe otherwise.** A DOM-rendered trailer cannot be recorded client-side. `MediaRecorder` needs a `captureStream()` source, meaning a `<canvas>`, meaning re-implementing every beat as canvas drawing — a rewrite, not a hook. The realistic path is server-side (Puppeteer + ffmpeg on a worker), a project of its own. The *only* free part is that `buildBeats()` output is already a machine-readable edit decision list that any future exporter — including a human in a video editor — can consume.

---

## 13. Risks

1. **The shot list demands something the CSS substrate can't do** (particle fields, per-glyph 3D, motion paths, physics). Highest-probability schedule risk. **Mitigation: send the designer §9's constraint list before they finish, not after.** If it happens anyway, the choice is "simplify the beat" — not "add framer-motion at the end of the sprint."
2. **No audio track is cleared.** Shipping a public app with an unlicensed track is a real legal problem. **Dom decision; blocks launch, not development** — build against a royalty-free placeholder, flag it in the PR, and do not merge to `main` with a placeholder still in `public/trailer/`.
3. **StrictMode double-mounting → two rAF loops** → a double-speed trailer reproducing in only one environment. **Mitigation: the explicit unmount test in §8.**
4. **iOS Safari specifics** — `100vh` vs `100dvh`, audio unlock inside the tap handler, the silent switch. **Mitigation: a real-device pass on an actual iPhone before merge. Simulator is not sufficient for audio.**
5. **Mid-range Android jank.** The gap between "smooth on a MacBook" and "smooth on a 3-year-old Android" is exactly where trailers die. **Mitigation: §5.3's budget is a code-review checklist item; QA on a real device or 4× CPU throttling.**
6. **Scope creep into synced premiere / video export.** Both will be requested the moment people see it. Both explicitly out of scope.
7. **A large stop image blocks the first crossfade.** Mitigated by decode-before-show and timeouts — but the deeper fix is that nobody compresses schedule images on upload. Worth a backlog ticket.
8. **Spoiler leak via an unredacted path.** **Mitigation: boundary redaction (§2.3) plus the deep-scan invariant test (§8).**

---

## 14. Cut lines, in drop order

Each cut is independent and leaves a coherent product.

1. **Roster + countdown beats.** Purely additive. ~half a day.
2. **All media, everywhere.** Ship the typographic-only variant already required for save-data. Deletes `useMediaPreloader.js` and the whole slow-network risk class. ~1 day, removes risk 7 outright.
3. **The static reduced-motion storyboard variant.** §7's opacity-only playback already satisfies the requirement. ~half a day.
4. **Seen-tracking and the nudge.** ~2 hours.
5. **Audio.** Ship silent. The tap-to-start poster stays. Deletes `useTrailerAudio.js` and unblocks risk 2 entirely. ~1 day.
6. **Mute-preference persistence.** ~1 hour.

**Absolute floor that still ships something worth shipping:** `EventTrailer.jsx` + `buildBeats.js` + `timeline.js` + `useTrailerClock.js` + typographic beat components + Skip/Close/Replay. Roughly **2 days**, plus the designer's typography direction.

---

## 15. Out of scope

- The visual/creative treatment, shot list, copy, typography, colour and per-beat durations — the designer's deliverable.
- Sourcing, licensing or producing the audio track.
- Synced/simultaneous premiere across devices (cheap to add later; §12).
- Video / GIF export or share-card generation (expensive; §12).
- Any change to `PresentationMode`, or any shared abstraction between the two.
- The App.jsx split (tickets 21–25). Ticket **21a** (extract date helpers to `src/lib/eventDates.js` + update 4 test files) is recommended but separate.
- Global code splitting (ticket 29). The trailer's `React.lazy` is the first split and a working precedent.
- Image compression / resizing on schedule-image upload.
- Any server-side auth work. Pre-existing, acknowledged (§11), neither addressed nor worsened.
- Trailers for archived/past events (a "recap" reel is a different product).
- Any new Supabase table, column, RPC, policy or migration.
- Analytics, telemetry, view counting.
- Internationalisation.
