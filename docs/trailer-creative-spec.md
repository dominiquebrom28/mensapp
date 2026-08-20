# MensApp — Event-Reveal Trailer: Creative Spec

> Owner: designer · Date: 2026-08-20 · Backlog ticket #4
> Companion document: `trailer-technical-spec.md` (architecture)

## 1. Creative direction

**The feeling:** a beer-commercial movie trailer, not a slideshow. Cold open, hard cuts, a wordmark that ignites, a montage that sells the day like a heist crew assembling, and a roll-call that lands like the cast card at the end of a trailer — except the cast is real, and that's the whole point. Cocky, warm, a little self-mythologising. The app already calls past editions "legendary" and gives out "Perfect Attendance 🐐" awards — the trailer is that same ceremonial voice turned up to full volume for sixty seconds.

**Name it:** *The Amber Reel.* Full-bleed, letterboxed, near-black cinema frame with the app's amber/gold as the only hot colour in the room. Grain, vignette, hard cuts on a wipe — not glassmorphism, not soft pastel gradients, not a generic AI-hype-video look (no whooshing lens flares, no stock-footage sheen, no cool-blue "tech" palette).

**Reference points:** Heineken/Guinness "brotherhood" ad campaigns for tone and pacing; A24 poster-drop trailers for the typographic slam and hard cuts; Instagram/Snapchat Stories for the progress-bar chrome convention (culturally legible "this auto-advances, tap to skip").

**How it relates to `PresentationMode`:** same DNA — gold shimmer bar, full-bleed background media, dark gradient overlay, secret-stop handling, `isMultiDay` day chips, the mobile/desktop padding pattern. The trailer borrows that vocabulary and pushes it harder: crushier blacks, a real vignette + grain layer, bigger and bolder type, hard-cut wipes instead of a 200ms crossfade, and a Stories-style segmented progress bar instead of clickable dots — because the trailer auto-plays and isn't presenter-driven.

**Deliberate departure:** `PresentationMode` is a wayfinding tool (info-dense, paused on demand, synced live between presenter/viewers). The trailer is a persuasion tool (autoplay from a single gesture, no sync, tight and disposable, rewatchable). Do not give it dot-navigation, live presence, or manual per-stop editing controls — none of that belongs here.

---

## 2. Entry & playback shell

- **Entry point:** a poster card on the event page, near where "▶ Present" already lives for admins — but visible to everyone. Poster = the event's own hero moment: first schedule-stop image (or gradient fallback) + event name + date, with a single `▶ Play Trailer` button (min 44×44px tap target, `--amber` fill, matches `Btn variant="gold"`). This is the required user gesture that unlocks audio autoplay — nothing plays before this tap.
- **Playback:** fullscreen overlay (`position:fixed;inset:0`, same pattern as `PresentationMode`), auto-advances beat to beat on a timer. No presenter, no viewer sync, no Supabase channel needed.
- **Chrome** (always present, low-opacity, fades on 2s idle then reappears on tap/move):
  - Top: tiny uppercase event-name eyebrow (top-left, mirrors `PresentationMode`'s label) + mute/unmute toggle + exit `✕` (top-right), both ≥44px hit area.
  - Bottom: a **segmented progress bar** (Stories-style), one segment per beat, filling left-to-right over that beat's duration — replaces `PresentationMode`'s dot nav, signals "this is playing itself."
- **Controls:** tap right half = skip to next beat; tap left half = replay current/previous beat; spacebar pauses (desktop); `←`/`→` skip; `Esc` exits. Nothing requires precision — big invisible tap zones (full left/right 50% of viewport).
- **End state:** the closing beat holds as a static **poster frame** (not a loop) with `↻ Watch again` and `RSVP now →` side by side — never auto-loops into infinity, that reads as broken, not epic.
- **Replay:** same entry button on the event page, always available, no "already watched" gating.

---

## 3. Beat-by-beat shot list

Runtimes are for a **typical event**: 4 public schedule stops, 1 secret stop, 8 confirmed attendees, one prior edition with Hall of Fame data. **Total: ~55 seconds.** Formula and hard caps for other cases are in §7; the design never exceeds **~65s** and never drops below **~35s**.

### Beat 1 — Cold open (0:00–0:05, 5s)
Black frame, letterbox bars snap in first (no content yet — a held black beat, like a studio logo card). Faint drifting ember particles (2–3 tiny soft-glow dots, slow upward drift, pure CSS). The `MENSDAY` wordmark ignites letter-by-letter (see §4 type-on), then a one-line kicker beneath it in small-caps tracking, pulled from the same hype-line pool `Home` already uses (`"No excuses. No mercy. Just lads."` etc.) — reusing existing copy so it's on-brand, not new marketing copy invented for this feature. Hard cut out.
**Data:** static wordmark + rotating hype line (same array as `Home`).

### Beat 2 — The hook (0:05–0:11, 6s)
Full-bleed background: event's hero image if any schedule stop has one, else a gradient (`--hero-glow`-derived). Big date reveal slams in — `formatEventDateRange(evt.date, evt.end_date)` — with location beneath, and if there's still time to go, a live "X DAGEN TE GAAN" countdown chip (reusing the `useCountdown` hook already in the codebase) rather than static date-only copy — this is the one place the trailer can feel *urgent* rather than just retrospective.
**Data:** `evt.name`, `evt.date`/`end_date`, `evt.location`, `evt.theme` (small tag if present), countdown.

### Beat 3 — The montage (0:11–0:23ish, ~12s, scales — see §7)
The beer-commercial heart. Up to the first **4** public (non-secret) schedule stops, in day/time order, each gets its own quick beat (~2.6s): full-bleed image with Ken Burns drift, icon (from `stop.icon`) + activity name slam in bottom-left, location line beneath it in the app's normal sentence case (not shouty — keeps it feeling like *our* data, not a movie poster template), day chip if `isMultiDay` (reusing `dayHeadingLabel`). Hard wipe-cut between each. If there are more than 4 public stops, close the montage with a 1.5s "+N more stops on the day 👀" card instead of enumerating everything.
**Data:** `evt.schedule` filtered `!secret`, sorted via existing `scheduleDayTimeOrder`, `stop.icon/activity/location/image/day`.

### Beat 4 — The secret tease (skips if no secret stops, else 6s)
See §6 for full treatment. One dedicated beat — never folded into the montage — because a tease needs its own held breath.

### Beat 5 — Legacy flash (skips if no prior-edition data, else 4s)
A quick nod to history for continuity across editions: last edition's `🏆 Overall Champion` or top quiz scorer (pulled the same way `HallOfFame`/`computeMemberStats` already compute it), framed as "Reigning Champion" with their avatar and name, small print of what they won. Builds "cinematic universe" — this year's trailer references last year's legend.
**Data:** most recent archived event's `winners[]`, or top `quizBoard` entry if no winners recorded.

### Beat 6 — The roll call (0:29–0:45ish, ~14–16s, scales — see §7)
The emotional payload. Real avatars, real names, stamped in one by one (see §4 motion, §7 degradation).

### Beat 7 — Closing card / poster frame (final ~7s, holds)
`MENSDAY` wordmark returns (smaller, settled — not re-igniting, this is the "credits" beat), event name, date, location stacked underneath in a tight ceremonial block, `evt.theme` if set. Background: best hero image again (bookends beat 2) at a slow static zoom, no further cuts. Playback **stops and holds** here — chrome becomes permanent (not idle-fading) — with the two CTAs from §2.
**Data:** same as beat 2, plus RSVP status for the CTA copy (hasn't RSVP'd → "Lock it in →"; already going → "See you there →").

**Transition rule between every beat:** hard cut via a 180ms gold wipe bar (§4) — never a soft crossfade. This is the trailer's signature transition and the one thing that should feel distinct from every fade/slide already in the app.

---

## 4. Motion language

**Ken Burns** (background images, all beats with photography):
- Scale `1.00 → 1.08` over the full beat duration, `linear` (constant drift reads more cinematic than eased for continuous motion — eases are reserved for foreground type).
- Pan: alternate beats between zoom-only and zoom+diagonal pan (`translate(0,0) → translate(-2%,-1.5%)`), so consecutive beats don't feel identical.
- Never pan/zoom on the secret-tease image beyond the barest drift (§6) — it needs to feel held/withheld, not lively.

**Type-on ("slam")** — headline text (beat titles, wordmark letters, activity names) enters via a new variant beyond the existing `pop`/`fadeUp` keyframes:
- `slam`: `opacity 0→1`, `filter: blur(6px)→blur(0)`, `transform: scale(1.15) translateY(10px) → scale(1) translateY(0)`, **420ms**, `cubic-bezier(.16,1,.3,1)` (expo-out — hits hard then settles, no bounce).
- Secondary text (subheads, location lines, kickers) follows **120ms later** using the app's *existing* `fadeUp`/stagger convention (`fu1`/`fu2` classes) — reuse, don't reinvent; this is the one place old and new vocabulary should visibly share DNA.
- Wordmark ignition (beat 1 only): each letter gets `slam` staggered 40ms apart, left to right.

**Cut rhythm — the wipe:** 180ms hard transition between beats. A 6–8px vertical bar with the same gradient as the existing `goldShimmer` keyframe (`orange→amber→gold→amber→orange`) and a soft outer glow sweeps `translateX(-10% → 110%)`, `cubic-bezier(.65,0,.35,1)`. The next beat's content mounts the instant the bar passes centre — feels like a reel change, not a dissolve. Directly reuses the brand's existing shimmer-bar language (already the signature of `PresentationMode`'s top strip and live/upcoming `EventCard`s) rather than importing a foreign wipe style.

**Avatar "stamp-in"** (roll call only): `scale(0.6) rotate(-6deg) opacity:0 → scale(1) rotate(0) opacity:1`, **320ms**, `cubic-bezier(.34,1.56,.64,1)` (back-out, slight overshoot) — a deliberate small bounce, the one place in the whole trailer motion is allowed to overshoot, because it's the "stamped medallion" ceremonial beat. Staggered 70ms per avatar.

**Audio sync:** the trailer must work with **or without** an audio file. If Dom supplies a track, beat cut timestamps should land loosely on strong beats/downbeats (the playback engine should expose beat-duration constants for this); if no track is supplied, the visual pacing above stands alone and must not feel like it's "waiting" for a beat that never lands. Audio only ever starts on the `▶ Play Trailer` tap — never on mount, never on scroll-into-view.

**`prefers-reduced-motion: reduce`:**
- Ken Burns disabled entirely (image static at `scale(1)`).
- `slam`/stamp-in become simple `opacity 0→1`, 200ms, no scale/blur/rotate/overshoot.
- Wipe becomes an instant hard cut (bar may show as a static flash-frame for ~1 frame max, no sweep).
- Ember/grain drift disabled (grain can stay as a static texture, just not animated).
- Beat *durations* and *content* are unchanged — reduced motion removes movement, not information or pacing.

---

## 5. Typography and colour

Works entirely from the existing `:root` tokens in `GS` — no new fonts (`Playfair Display` 700/900 upright+italic and `DM Sans` 300–700 already cover everything).

| Role | Font | Size (clamp) | Weight/style | Case |
|---|---|---|---|---|
| Wordmark (beats 1 & 7) | `var(--font-h)` | `clamp(3.2rem,14vw,7rem)` | 900 italic | UPPER (matches `Home` h1) |
| Beat title (date, activity name, roll-call headline) | `var(--font-h)` | `clamp(2rem,8vw,4.2rem)` | 900 upright | UPPER — trailer-only convention |
| Kicker/eyebrow (hype line, secret kicker, day chip) | `var(--font-b)` | `.72–.8rem` | 700 | UPPER, letter-spacing `.2–.25em` |
| Location/note/subhead | `var(--font-b)` | `.95–1.05rem` | 500 | Sentence case — **stays app-normal** |
| Attendee name (roll call) | `var(--font-h)` | `1.05–1.3rem` | 700 upright | Sentence case (real names shouldn't shout) |

Deviation reasoning: activity/location text deliberately stays in the app's existing sentence-case voice — everything else (kickers, titles, wordmark) goes uppercase/oversized in a way nothing else in the app does, because this is the one screen that gets to be a poster.

**Colour:**
- Background crush: overlay gradient pushed darker than `PresentationMode`'s (`rgba(6,4,0,.82)→.42→.22`) to `rgba(0,0,0,.92)` at top/bottom edges, easing to `rgba(0,0,0,.55)` centre — text always sits on a near-black field regardless of source image brightness. This is also the non-negotiable contrast guarantee.
- New: subtle vignette (radial-gradient darkening the corners, the `--hero-glow` idea inverted) + a static low-opacity procedural grain (tiny repeating radial-gradient dot pattern, ~4% opacity, not animated) over every beat — the one deliberate "cinema, not app-screen" texture. Pure CSS, no images or libraries.
- `--amber`/`--amber2`/`--gold` remain the only warm accent — wipe bar, wordmark ignite glow, kicker text, RSVP CTA.
- `--red` stays reserved for the secret-stop lock motif (consistent with `EditScheduleModal`'s existing 🔒 red treatment — don't invent a new "secret" colour).
- `--green` reused for "confirmed going" rings in the roll call (consistent with `statusMap.going.color`).
- `--purple` reused only if `evt.type==="weekend"` needs a tag echo (consistent with `EventCard`'s weekend tag).

**Radii / elevation:** the trailer frame is edge-to-edge, radius 0 (film, not a card). Reserve `var(--radius-sm)` pill shapes only for small chips (day chip, "+N more", RSVP status pill) so it still visibly belongs to MensApp despite being fullscreen. No box-shadow elevation anywhere — legibility comes from the overlay gradient plus `text-shadow: 0 2px 30px rgba(0,0,0,.6)` (the value `PresentationMode` already uses).

**Letterbox bars:** thin bars top and bottom in every beat, near-black `--bg` (`#0c0901`) with a 1px `--border2` hairline facing inward. Mobile `3.2vh` each; desktop `5vh` each (more room to spare, so the crop can be more pronounced).

---

## 6. The secret-stop tease

**Goal:** the audience should lean in, not shrug at a gap. Never render an empty slot, a "TBD," or a literal blank.

- Only renders if at least one `stop.secret===true` exists. If none, the beat is skipped outright — never fabricate mystery from nothing.
- Visual: the secret stop's own still (if `stop.image` set) at **very heavy blur** (`filter: blur(28px) brightness(.5)`) plus the standard dark overlay — the *mood* (colour, light quality) leaks through with no legible detail. With no image, fall back to a rich amber-black gradient, never a grey placeholder.
- A padlock glyph (🔒 — the exact icon already used in `PresentationMode`'s badge and `EditScheduleModal`'s toggle; reuse, don't invent) sits centre, very slightly breathing (`opacity .85↔1`, 2.4s ease-in-out; freezes at `.9` under reduced motion).
- Copy: kicker `SOMETHING WE'RE NOT TELLING YOU` (uppercase, `var(--red)` per the app's existing secret convention) + one line teasing scale without content: *"One stop on the schedule stays under lock until the day."* Never hint at the activity type, location, or time. Singular copy for one secret stop; *"A few stops are staying under lock…"* for more.
- No Ken Burns here (§4) — everything else moves, this holds still, which is itself the signal that something's different.
- Duration: 6s flat regardless of how many secret stops exist — it's a tease, not an act.

---

## 7. Graceful degradation

Every beat has a defined floor. The trailer must never look broken, empty, or thin.

| Condition | Behaviour |
|---|---|
| No images anywhere | Every beat falls back to a rich gradient from `--hero-glow`/`--amber`/`--bg` tokens + the stop's own `icon` emoji rendered large and centred. Ken Burns still applies to the gradient so nothing feels static. Never a grey box or broken-image icon. |
| One schedule stop only | Montage becomes a single **extended spotlight** — that stop gets the full montage budget (~12–14s) with slower Ken Burns and a fuller note/location reveal, rather than a rushed 2.6s beat built for four. |
| Zero schedule stops | Montage *and* secret-tease skipped; their budget folds into a longer roll call. Never show "0 stops on the menu." |
| Zero confirmed attendees | Roll call replaced by a CTA beat: `BE THE FIRST TO LOCK IN`, using the existing `glow-pulse` treatment on a big RSVP button. Never an empty avatar grid. |
| Few attendees (2–3) | Roll call drops the grid and gives each person a full individual hero moment (bigger avatar, longer hold) — same total duration, fewer and bigger, so it reads intimate rather than sparse. |
| Many attendees (12+) | Cap named call-outs at the first 8–10 confirmed "going" (RSVP order, ties alphabetical), then a `+N more legends` tile with the overlapping avatar cluster `EventCard`'s "lads going" strip already uses. Roll call capped at 16s regardless of headcount. |
| No secret stops | Secret beat skipped, never faked. |
| No prior-edition data (first event) | Legacy-flash beat skipped. |
| Single-day event | No day chips anywhere (matches `PresentationMode`'s existing `isMultiDay` gate). |
| Multi-day, many stops | Montage selection is day-aware: up to one highlight stop per day (within the 4-stop cap) rather than the first four chronologically, so a weekend trailer doesn't show four stops all from Friday. |
| Many stops (10+) | Montage caps at 4–5 with a "+N more" closing chip, never enumerates. |

**Runtime formula** (so total never balloons or feels thin):

```
5 (open)
+ 6 (hook)
+ montage( 0 | single-spotlight ~13 | min(stops,4) × 2.6 + chip )
+ secret( 0 | 6 )
+ legacy( 0 | 4 )
+ rollcall( 6 CTA | 8 + 0.7 × min(n,10), capped 16 )
+ 7 (close)
```

Typical ≈ **55s** · sparse floor ≈ **35s** · hard ceiling ≈ **60–65s**, never enumerated further no matter how much data exists.

---

## 8. Image-generation brief for Dom

One still per schedule stop, generated to feel like *one coherent shoot*, not a random AI grab-bag. The unifying device is **light quality**, not literal accuracy to time-of-day — a 2pm go-karting stop and an 11pm bar stop should still look like they belong to the same reel.

**Style:** cinematic, moody, editorial photography — A24 poster stills crossed with a craft-beer ad campaign. Photoreal, not illustrated. Explicitly avoid the smooth plastic AI-skin look, generic corporate stock symmetry, and cartoon/clipart/3D-render styles.

**Consistent throughline** (use in every prompt regardless of subject): *one dominant warm light source per frame* (a lamp, string lights, a sunset, a neon sign, headlights) plus a light haze in the air. This single repeated device is what makes four unrelated activities read as one trailer.

**Palette:** warm amber/gold highlights (`#e8943a` rim/key light) against near-black or deep brown-teal shadow (`#0c0901` / `#150e04`) — reference those hex values literally in the prompt. No cool blues, no flat bright daylight, no oversaturated primaries.

**Framing:** wide establishing/environmental shots, low "hero" camera angle. Landscape, minimum 1600px wide, roughly **16:9**, key subject centred in the middle third so it survives both a tall mobile portrait `object-fit:cover` crop and a wide desktop crop.

**People:** avoid recognisable faces entirely. Silhouettes, backs of heads, hands, gear, and empty-but-charged environments only. These stills sit *next to* real photos of the actual lads in the roll-call and legacy beats — an AI face would read as uncanny next to a real one; an AI *mood* does not.

**Prompt template** (fill from the stop's own `activity`/`location`/`icon`):

> *"Cinematic atmospheric photo of [activity/location — e.g. 'a go-kart track at dusk' / 'a packed pub quiz corner in a dim bar']. Golden-hour or warm tungsten lighting, one dominant warm light source, thin haze in the air, deep near-black shadows, amber rim light (#e8943a) against near-black background (#0c0901). Shot on 35mm anamorphic lens, shallow depth of field, wide establishing angle, low camera height. No visible faces — silhouettes, backs, or hands only. No text, no logos, no watermark. Moody editorial beer-commercial aesthetic. --ar 16:9"*

**Avoid list** (append to every prompt): cartoon, illustration, 3D render, plastic/AI skin texture, oversharpened, visible text or logos, watermark, symmetrical stock posing, bright flat daylight, cool/blue grading, cluttered composition.

**Secret stops:** generate the still the same way, at **full clarity** — do not pre-blur. The heavy blur is applied at runtime by CSS; a pre-blurred source will look muddy and low-res when the stop is eventually unlocked in `PresentationMode`. Keep the source crisp.

**Real photos** (from the Photos tab): no generation needed, but they get the *same* runtime CSS treatment (dark overlay, vignette, grain) as the AI stills — that uniform layer is what makes the two sources sit together as one visual piece. No pre-editing required.

---

## 9. Accessibility (non-negotiable)

- **Contrast:** the `.92`→`.55` black overlay gradient (§5) is a hard requirement, not a style preference — it guarantees ≥4.5:1 for `--cream`/white text over any source image, checked against the darkest expected image content, not the average.
- **Motion:** full `prefers-reduced-motion: reduce` behaviour in §4 — the trailer remains fully watchable as a fast static-image slideshow with identical content and pacing.
- **Targets:** play/replay/RSVP CTAs ≥44×44px. Mute and exit ≥44×44px (may render smaller visually with generous invisible padding). Tap-to-skip zones are the full left/right half of the viewport — no precision required.
- **Keyboard:** `Space` pause/resume, `←`/`→` skip, `Esc` exit, `Enter`/`Space` activates focused CTA. Visible focus ring on all interactive chrome (`3px var(--amber)` outline offset — reuse the `input:focus` token already in `GS`).
- **Screen readers:** the sequence is decorative/experiential by nature. Provide a skip-straight-through affordance (`aria-label="Skip trailer"`, reachable immediately on focus) rather than forcing sequential beat-by-beat consumption, plus an `aria-live="polite"` region announcing only each beat's core text (not ambient copy), so non-visual users aren't stuck through 55 seconds of unannounced motion to reach the RSVP action.
- **Audio-optional:** audio may not exist and starts muted by default until unmuted, so all information must be conveyed by on-screen type alone — never encode meaning (e.g. "this one's a surprise") in music cues without an on-screen equivalent.
