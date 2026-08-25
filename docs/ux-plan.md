# MensApp — UX Simplification & Integration Plan

> Author: designer (studio) · Date: 2026-08-26 · Status: proposal, needs Dom's decisions in §10
> Scope: structural UX. Read alongside `docs/mensgames-spec.md` and `docs/quiz-unification-spec.md` — this plan is written to be compatible with both, and §3 argues one of them should be extended rather than followed literally.
> Baseline measured against `main` @ `src/App.jsx` = **7,872 lines**, 2026-08-26.

---

## 0. The argument, in one page

Dom's diagnosis is right, and it is more specific than "the UX could be better". The app grew by accretion, and the accretion left a signature you can point at in the code:

**Every new feature had to re-answer questions the app had never answered once.** Where do I live — inside an event or beside it? What do my buttons look like? What does my empty state say? What language am I in? How big is a tap target? Who owns the top of the screen? Because there was no shared answer, each feature invented its own, and each answer was reasonable in isolation. Nine such answers now sit next to each other, and that is what "bolted on" feels like from the outside.

Three findings carry the rest of this document:

**1. The design system has already forked, and a test harness is the reason.**
`src/features/mensgames/ui/Kit.jsx:37` defines a `Btn` with the same name, same variants and same size names as `src/App.jsx:111` — with different values. App.jsx's `Btn` has **no `minHeight` at any size** (`sm` renders ≈27px tall, and 97 of the app's 133 `<Btn>` uses are `sm`). Mensgames' `Btn` sets `minHeight: 36/44/48`. Mensgames also has focus rings, `prefers-reduced-motion` gates, `touch-action:manipulation` and a 48px stepper explicitly justified as *"scored at a bar, on a phone, one-handed"* (`ui/styles.jsx:41-46`). App.jsx has none of those.

The fork was not an accident of taste. `docs/mensgames-spec.md` §5.4 rule 1 states: *"Never add `export` to an existing `const` in App.jsx"* — because `src/test/extractFromAppSource.js` reads App.jsx **as text** and would break. So a test hack is currently the binding constraint on the app's design system, and every new feature dir will keep forking until it is removed. **The newest feature already contains the design system the rest of the app needs.** The work is not to design one; it is to promote one and delete the thing blocking it.

**2. The event-centric model has already been abandoned in the specs, but not in the UI.**
`docs/quiz-unification-spec.md` §3.1 gives `quizzes.event_id` as **nullable**, and §1 says a quiz becomes *"reachable from the Home tile row and from an event, exactly like Mens-Games."* `docs/mensgames-spec.md` §4.6 already did that for tournaments; `team_sets` already did it for teams. So by the time the quiz spec ships, **three** features will exist both standalone and inside an event — with three separately-invented presentations of that duality, and no shared pattern for "the same thing seen from two places". §3 proposes the pattern.

**3. The nav rework fixed the desktop and left the phone alone.**
Below 768px (`NAV_MOBILE_BP`, `App.jsx:794`) the Tools/Account grouping does not exist. The hamburger opens a flat vertical list of **eight** items plus a profile row (`App.jsx:934-951`) — the exact ten-item flat nav the rework was meant to retire. On the primary canvas, nothing has changed yet. There is also no bottom navigation and no swipe gesture anywhere in the codebase (**zero** touch handlers, grep-verified), so on a phone every navigation action is a reach to the top 58px of the screen.

The prioritised path in §9 follows from these: **unfork the UI layer → give the phone a real nav → define the one pattern for each recurring surface → then subtract.** Almost everything of value here is subtraction and consolidation, not new screens.

### One thing that should be fixed this week, ahead of all of it

**`QuizParticipantView` is a fullscreen trap for every non-organiser.** It mounts *automatically* — not by any user action — whenever any quiz on the event has a `_liveState` (`App.jsx:2155`), covering the phone at `position:fixed; inset:0; zIndex:999`. Its entire 467 lines contain exactly **one** exit control: the `✕ End Session` button at `App.jsx:4374`, wrapped in `can.hostQuiz(currentUser)`. There is no `onClose` prop (the mount site passes none), no Escape handler, no back affordance.

A regular member is locked in that overlay — re-polling `select *` every 2 seconds — until an org/admin ends the session or they kill the browser tab. If the presenter's browser crashes or they close the tab without pressing Escape, `_liveState` is never cleared and **every phone in the room stays trapped**. There is no `beforeunload` handler.

Two aggravating details: a member on a team with a captain sees the whole quiz and can interact with none of it (`App.jsx:4233`, message at `4631`) with no copy explaining why or offering an out; and the button that frees fifteen trapped phones is `padding:"4px 10px"` at `fontSize:".65rem"` — roughly 10px tall.

This costs about six lines (a member-visible "✕ Sluiten" that sets local dismissal, plus a `beforeunload` clearing `_liveState`). Neither spec mentions it. There is a real event coming.

---

## 1. Method, and what is verified vs inferred

**Verified** means I read the code and can cite the line. Every line number below was checked with `grep -n` against `main` on 2026-08-26. Contrast ratios were computed from the hex values in the `GS` block (`App.jsx:26-33`) with the WCAG relative-luminance formula.

**Inferred** is flagged inline. Chiefly: I have not run the app in a browser or on a device, so statements about what falls below the fold are computed from declared padding/font sizes, not measured on a handset. I have not watched anyone use it. Where I say "at a bar this will hurt", that is a judgement from the measured target sizes plus Dom's own stated constraint, not observed behaviour.

I have **not** read: `SaraJayOrJAI` in detail, the trailer's internals, or most of `PresentationMode`'s slide bodies. Nothing in this plan depends on them.

I did not modify any source file. The only write is this document.

**One caveat on state of play.** Other work is in flight on `src/features/awards/`, `src/features/mensgames/finishTournament.js` and new files under `src/features/quiz/` — the first steps of the quiz unification. Everything here is measured against `main` as it stands, so a few line numbers in the quiz region will drift as that lands. None of the arguments depend on the exact numbers; where a claim is load-bearing I have quoted the code, not just the line.

---

## 2. Diagnosis — where the accretion actually shows

### 2.1 Two design systems, one app

| | `App.jsx:111` `Btn` | `features/mensgames/ui/Kit.jsx:37` `Btn` |
|---|---|---|
| `sm` | `padding:6px 14px`, `.78rem`, **no minHeight** → ≈27px | `padding:6px 12px`, `.78rem`, `minHeight:36` |
| `md` | `10px 22px`, `.88rem`, **no minHeight** → ≈37px | `10px 18px`, `.86rem`, `minHeight:44` |
| `lg` | `13px 30px`, `1rem`, **no minHeight** → ≈42px | `13px 26px`, `.96rem`, `minHeight:48` |
| variants | 6 (has `gold`) | 5 (no `gold`) |
| hover | ~50 lines of imperative DOM writes + 40 lines of bug commentary | CSS class |
| focus ring | none | `outline:3px solid var(--amber2)` (`ui/styles.jsx:33-38`) |
| aria props | none | `ariaLabel`, `ariaPressed`, `title` |

Same divergence in `Card` (padding `1.4rem` vs `1.2rem`) and `H` (default size `1.35rem` vs `1.2rem`).

The imperative hover handling is not a style choice with no consequences — it has already produced two documented bug classes, both narrated in the comments at `App.jsx:130-176`: buttons rendering "completely white" on WebKit, and a tab left "half-active, half-disabled" after a touch. Both are direct costs of having no CSS class layer. `TabBtn` (`App.jsx:201`) was extracted on **2026-08-26** — today — for exactly the same bug. This will keep happening.

Beyond the two `Btn`s: **115 raw `<button>` elements** in App.jsx bypass `Btn` entirely, and **14 raw `<select>`**. Only **7** occurrences of `minHeight:44` exist in the entire 7,872-line file — all added by the recent nav rework.

Three components use `Btn` **zero times** and hand-roll every control: `Nav` (23 raw buttons), `QuizPresenter` (20), `PresentationMode` (5). `QuizPresenter` alone recreates the amber-primary treatment four times (`3722, 4009, 4078, 4171`) and the ghost treatment three times (`3693, 4004, 4167`).

There are **nine separate conventions for "small icon button"**: `Btn size="sm"`, `ICON_BTN` (`2725`), `iconBtn(active,color)` (`6894`), `btnStyle(disabled)` (`5315`), a second `btnStyle` (`5395`), `menuItemStyle()` (Nav), `SbBtn` (`2483`), bare `background:"none",border:"none"` (`3008, 5484, 6993, 7080`), and mensgames' CSS classes.

And two shared primitives are **shadowed by worse local copies**:

- `TabBtn` (`App.jsx:201`, carrying the hover-restore fix documented at `190-200`) is shadowed inside `QuizBuilder` by a *different* `const TabBtn` at **`App.jsx:2833`** — different props, raw `<button>`, no hover-restore. Within `QuizBuilder`'s scope the fixed one is unreachable, so it carries the exact bug that was just fixed everywhere else.
- `Switch` (`App.jsx:219`, a real `<button role="switch" aria-checked>`) is shadowed inside `PollsTab` by `const Toggle` at **`App.jsx:4755`** — a `<div onClick>` with no role, no `aria-checked`, not keyboard-reachable, used for the three poll settings at `4975-4977`. The comment at `App.jsx:216` already names this divergence and it was never closed.

### 2.2 Everything is styled inline, so nothing is a decision

- **1,546** inline `style={{…}}` objects.
- **759** `fontSize` declarations across roughly 50 distinct values. The most common single value is `.72rem` = **11.5px**, used 63 times — for leaderboard subtitles, event metadata, timestamps, status captions.
- **143** distinct `padding` values.
- Two radius tokens exist (`--radius:14px`, `--radius-sm:9px`) and are bypassed by **12 distinct hardcoded numeric radii** across ~200 uses (`8` × 61, `6` × 30, `20` × 29, `10` × 27, `12` × 17, …).
- **15 distinct z-index values** with no scale: `2, 3, 10, 15, 20, 30, 200, 210, 500, 600, 998, 999, 1000, 2000`.

The `GS` token block (`App.jsx:22-103`) defines colour, two fonts and two radii. It defines **no type scale and no spacing scale**. That is why there are 50 font sizes: there was nothing to pick from.

**The z-index numbers contain two real collisions, not just untidiness:**

| z | Owner |
|---|---|
| 999 | EventPage "Presentation is live" rejoin banner (`App.jsx:2130`) |
| 999 | `QuizParticipantView` fullscreen overlay (`App.jsx:4326`) |
| 1000 | `PresentationMode` (`App.jsx:5874`) |
| 1000 | `QuizPresenter` (`App.jsx:3676`) |

Both pairs can co-occur — a quiz is a scheduled stop, so a live quiz and a live schedule presentation are exactly the situation the app is built for. At a tie, DOM order decides, which is not a decision anyone made. Separately, `PhotosTab`'s lightbox is **600**, above the shared `Modal` at **500** — so the lightbox escapes any modal it is opened from, which is probably intended and definitely not written down anywhere.

### 2.3 Colour tokens that fail their own job

Computed against the declared backgrounds:

| Token | on `--bg` | on `--bg2` | on `--bg3` | on `--bg4` |
|---|---|---|---|---|
| `--cream` #f0e6d3 | 16.1 | 15.5 | 14.7 | 13.8 |
| `--muted` #8a7460 | **4.50** | **4.33** ✗ | **4.11** ✗ | **3.86** ✗ |
| `--muted2` #6a5848 | **2.94** ✗ | **2.83** ✗ | **2.68** ✗ | **2.52** ✗ |
| `--amber2` #f5b866 | 11.3 | 10.9 | 10.3 | 9.7 |

`--muted` is the app's default secondary text colour and it fails AA (4.5:1) against every surface except the bare page background — and almost all secondary text sits inside a `Card`, which is `--bg2`. `--muted2` fails everywhere, including the 3:1 large-text bar.

Worse, two structural tokens:

- `--border` = `rgba(232,148,58,.12)` → **1.19:1** on `--bg2`. This is the border on every `Card`, every `Inp`, every `ghost` button. WCAG 1.4.11 wants 3:1 for UI component boundaries. In a dark bar at reduced screen brightness this is not a subtle border, it is no border.
- The global focus indicator (`App.jsx:87`) removes the UA outline (`outline:none!important`) and replaces it with `box-shadow:0 0 0 3px rgba(232,148,58,.13)` → **1.24:1**. That is strictly worse than leaving the browser's own ring alone.

**The fix already exists in the codebase and was never generalised.** `TeamCreatorPage` defines `AA_MUTED="rgba(240,230,211,.68)"` (`App.jsx:6889`) with a comment explaining the contrast maths — it computes to **7.49:1** on `--bg2`. One component solved the app's global colour problem locally. That is the accretion pattern in a single constant.

### 2.4 There is no router, so there is no back, no link, and no state worth sharing

Navigation is a single `useState` string: `pageView` ∈ `home | event | hof | members | member | updates | teams | timer | mensgames | sarajay` (`App.jsx:7343`). Consequences, all verified:

- **The browser back button exits the app.** From an event's Quiz tab, back does not return to Overview, to Home, or anywhere.
- **Nothing is linkable.** You cannot send a mate a link to the event, the schedule, the Hall of Fame, or the poll you want him to vote in. In a group whose primary coordination channel is a WhatsApp group, this is the single largest missing affordance.
- **The in-app back button is not hierarchical.** `goBack` (`App.jsx:7730`) returns to `members` from a member profile and **to Home from everywhere else** — including from a tab six levels into an event.
- **Tab state is component-local** (`App.jsx:1921`) and keyed on `activeId + notifNav.tab`, so it resets on every navigation.
- Reloading the page always lands on Home.
- The only route to Home is the wordmark — a bare `<div onClick>` (`App.jsx:876`), not a button, not focusable, no accessible name.

This is also what makes the notification system feel thin: `openEvent(id, tab, targetId)` (`App.jsx:7728`) already implements real deep-linking *internally*, complete with scroll-to-target and a highlight flash (`App.jsx:1933-1941`). The capability exists; it just has no URL to hang on.

### 2.5 Nobody owns the top of the screen

Four things independently claim the top strip, and a fifth is about to:

| Surface | Position | z |
|---|---|---|
| `Nav` | `fixed top:0`, 58px | 200 |
| Write-failure banner | `fixed top:58` | 2000 |
| "Presentation is live" rejoin banner | `fixed top:0` | 999 |
| `AnnouncementBanner` | in-flow, first child of `<main>`, on **every** page | — |
| *(planned)* "🔴 Quiz bezig — meedoen" | App root, per `quiz-unification-spec.md` §4.5 | ? |

The write-failure banner's comment (`App.jsx:7813-7825`) documents a bug where it sat at `top:0` and blanked the entire nav, trapping the user. The fix was to move it to `top:58`. But the presentation banner is *still* at `top:0` with z-index 999 — so during a live presentation it covers the nav for anyone who dismissed the viewer, and if a write fails at the same moment, the 2000-banner stacks on top of it. Nobody has designed the stack; each banner solved its own case.

`AnnouncementBanner` is a separate problem: it renders above the page content on every single view (`App.jsx:7838`), so an active announcement permanently steals the top of Home, the event page, the Hall of Fame and everything else.

### 2.6 The same idea, under several names

| Concept | Names in user-facing copy |
|---|---|
| A person in the group | **Lads** (nav, `App.jsx:891`) · **Members** (`MembersPage`, `App.jsx:1414`) · **Lid** (nav title fallback, `App.jsx:7836`) · **deelnemers** (`App.jsx:1875`, `App.jsx:6938`) · **attendees** · **entrants** (mensgames) · **participants** (quiz) |
| A group of people | **Teams** (event tab) · **Team Creator** (tool) · **team library / bibliotheek** (`App.jsx:1878`) · **team sets** (data) · **brackets** (`App.jsx:6677` comments and UI) |
| Recognition | **Winners & Highlights** (tab) · **Most Awards Won** (HoF, `App.jsx:1268`) · **Team Trophy Cabinet** (HoF, `App.jsx:1295`) · **awards** (`TeamAward`) · **Hall of Fame** |
| Something to read | **📬 Updates** (`App.jsx:6417`) · **📢 Announce** (`App.jsx:920`) · **notifications** (state) · **meldingen** (`App.jsx:6423`) |
| Walking the schedule | **▶ Present** · **🧭 Browse solo** · **🎬 Presentation is live** · **▶ Rejoin** · **✕ Exit** / **✕ Hide** — one component surfaced under six names depending on which of its three modes you are in (`App.jsx:2087, 2090, 2134, 2138, 5899`) |

Two words do more damage than the rest combined:

**"Live" means five unrelated things** in user-facing copy: a presentation is broadcasting (`App.jsx:5894`), an event is happening today (`1752`, "Live nu"), a feature flag is switched on (`1019, 1033`, "🔓 Live"), a quiz is in progress (`2693`), and a tournament round is in progress — rendered in Dutch as "Bezig" (`MensGamesShell.jsx:16`).

**"Round" means two unrelated things in two languages**: a quiz round (`App.jsx:2437`, "Round 1", English) and a tournament round (`RoundCard.jsx`, "Ronde 1", Dutch). A user can meet both in one evening.

And the sharpest one — **five RSVP statuses have three different label sets**, all live at once:

| status | `statusMap` (`App.jsx:337`) | RSVP buttons (`App.jsx:2236`) | EventCard chip (`App.jsx:1745`) |
|---|---|---|---|
| `going` | "Going" | "I'm In" | "🔒 Locked In" |
| `maybe` | "Maybe" | "Maybe" | "🤔 Maybe" |
| `not coming` | "Out" | "Can't Make It" | "❌ Can't Make It" |

A member sets their status to "I'm In", the card says "🔒 Locked In", the attendee list says "Going", and the count says "confirmed". Four words for one fact on two adjacent screens.

`isAdmin` is also not one thing: the identifier is bound to **six different predicates** depending on the component — `can.manageUsers` (842), `can.editEvent` (1837, 1948, 2168, 5167), `can.hostQuiz` (2653), `can.addWinner` (5075), `can.closePoll` (6376). That produces at least one live incoherence: the schedule's "✎ Edit" button is gated on `can.editEvent` = `hasAdmin` (`App.jsx:2278`) while the per-stop secret reveal toggle is gated on `can.editSchedule` = `hasOrg` (`App.jsx:2169`). **A plain `admin` can open the schedule editor but cannot reveal a secret stop; a plain `org` can reveal stops but cannot open the editor.** Neither is intentional as far as I can tell.

### 2.7 Confirmation is inverted

There are **two** `window.confirm` calls in all of App.jsx (`975`, `6846`) and **24 destructive actions with no confirmation at all**. There is no in-app confirm pattern in App.jsx whatsoever — the codebase's only real confirmation dialog is `FinishTournamentModal` (`TournamentEditor.jsx:380-408`), in the newest feature.

The severity ordering is exactly backwards. Deleting a **whole event** is unconfirmed; deleting a single **quiz round** gets a "cannot be undone" dialog (`RoundCard.jsx:49`).

| Action | Consequence | Confirmation |
|---|---|---|
| Remove an approved user (`App.jsx:975`) | deletes a user | `window.confirm("Remove this user?")` |
| Reject a pending user (`App.jsx:974`) | **the same `onDeleteUser`** | **none** |
| **Delete an event** (`App.jsx:2094`) | deletes the event and all its schedule, polls, photos, quizzes, FAQ | **none** |
| Clear all notifications **for everyone, forever** (`App.jsx:6425`) | irreversible, group-wide | **none** |
| Delete one notification for everyone (`App.jsx:6392`) | irreversible, group-wide | **none** |

`Delete` on the event page is a `size="sm"` (≈27px) button sitting in the same wrapped row as `Archive`, `Edit`, `Present` and `Browse solo` — five to six small buttons that wrap to three rows on a phone. The one that destroys the event has no more friction than the one that opens the editor. It also does not check whether the delete succeeded (`App.jsx:7688-7692`): the event vanishes from the UI, the app navigates home, and if the write failed it is still in the database and reappears on the next boot.

Two more that deserve naming because they are group-wide and irreversible: `🗑 Wis voor iedereen` (`App.jsx:6425`) clears every user's notifications and writes a tombstone row, and the admin `✕ all` (`App.jsx:6400`) deletes one notification for everyone. Both are styled as ghost buttons, neither confirms.

### 2.8 The app is bilingual inside single screens

Not "Dutch features and English features" — mixed within one component, one card, sometimes one button row.

The sharpest cases, all verified:

- **The first-run path is EN → NL → EN.** `LoginScreen` is English ("Welcome back", "Wrong username or PIN.", `App.jsx:700`). Clicking "Request access" lands on `RegisterScreen`, which is entirely Dutch ("Toegang aanvragen", "Gebruikersnaam moet minimaal 2 tekens zijn.", `App.jsx:731`). Success returns you to `PendingScreen`, English again ("Pending Approval… Nag the group chat", `App.jsx:777`). This is the only screen a new person ever sees.
- **The boot sequence itself is bilingual**: the loading state says `Loading…`, the boot-failure message says `"Kon de app niet laden…"` with a button reading `Opnieuw proberen`, and the write-failure banner says `"Save failed — your change wasn't saved."` (`App.jsx:7669`).
- **One button row, two languages**: `EditProfileModal` (`App.jsx:1545-1547`) renders `Opslaan` next to `Discard changes` next to `Clicking outside saves automatically`.
- **Two languages inside a single string.** `EditScheduleModal:6054` sets `title={s.secret ? "Secret — klik om te openbaren" : "Publiek — klik om te verbergen"}`, and `6079` renders a button labelled `+ Add Stop — Dag {n}`. That modal is the sharpest case in the file: `Activity` / `Location` / `Note` / `Slide Image` / `Edit Schedule` / `Save` in English (`6052, 6061-6063, 6071, 6091`) interleaved with `Dag` / `Geheim — verborgen` / `Overige — niet ingepland` in Dutch (`6060, 6064, 6084-6085`).
- **Adjacent chips, two languages**: `EventCard`'s schedule strip renders `+3 more 👀` beside `🔒 +2 geheim` (`App.jsx:1804-1805`), and `Lees meer →` closes an otherwise-English card (`App.jsx:1777`).
- **`OverviewTab`** is largely English ("Are you coming? Make it official.", "What's on the Menu") but the reveal prompt inside it is Dutch ("📣 Leden inlichten over deze reveal? / Verstuur / Niet nu", `App.jsx:2263`) and so is the secret-stop footer.
- **`TeamsTab`** is entirely Dutch inside an otherwise-English event page.
- **`UpdatesPage`** is entirely Dutch, and its notifications deep-link to tabs named `Overview`, `Photos`, `Polls`, `FAQ`, `Winners & Highlights`.
- **`AdminPanel`**'s Features tab describes Sara Jay in English and Mens-Games in Dutch, in two adjacent cards (`App.jsx:1014`, `App.jsx:1027`). Dates throughout use `toLocaleDateString("nl-NL")`.
- Two Dutch words leak into the fully-English Hall of Fame: `"Naamloze teams"` and `"Onbekend team"` (`App.jsx:1302`, `App.jsx:1309`).

A keyword-frequency pass over each component (heuristic, **not** exact — treat as a shape, not a measurement) puts `EditProfileModal`, `RegisterScreen` and `UpdatesPage` at ~90-100% Dutch; `PresentationMode`, `QuizPresenter`, `FAQTab`, `HallOfFame` at under 20%; and `Home`, `EventCard`, `TeamCreatorPage`, `EditScheduleModal` at roughly 50/50 **within the component**. The last group is the real problem: it is not a feature boundary, it is per-string drift.

### 2.9 The 44px rule exists in one component

Dom's brief says 44px targets have already driven real decisions. That is true — in `Nav` (7 uses of `minHeight:44`), in `features/mensgames` (48px steppers), and in `Switch` (`App.jsx:219`, which cites WCAG 2.2's *24×24* minimum — a third, lower bar). Everywhere else:

| Control | Size | Where |
|---|---|---|
| Quiz presenter score −/+ | **26 × 26** | `App.jsx:3869, 3874, 3935, 3940` |
| Presentation mode slide dots | **7px tall** | `App.jsx:5988` |
| Presentation mode prev/next (mobile) | **36 × 72**, `rgba(255,255,255,.03)` background, no border | `App.jsx:5970, 5977` |
| Schedule secret reveal/hide toggle | `padding:2px 8px`, `.66rem` → ≈18px | `App.jsx:2349` |
| Attendee status `<select>` (admin) | `padding:3px 7px`, `.73rem` → ≈20px | `App.jsx:2392` |
| "✕ all" delete-for-everyone | `padding:2px 5px`, `.62rem` | `App.jsx:6392` |
| Team Creator count/size steppers | **38 × 38** | `App.jsx:6915, 6917, 6925, 6927` |
| Schedule stop secret toggle | **32 × 32** | `App.jsx:6054` |
| Emoji/icon picker cells | **30 × 30** / **34 × 34** / **36 × 36** | `App.jsx:6050, 5153, 5160` |
| Remove-image ✕ | **20 × 20** | `App.jsx:3008` |
| Default `Btn size="sm"` (97 of 133 buttons) | ≈27px tall | `App.jsx:112` |

The three controls at the top of that table — the quiz score buttons, the presentation dots, and the presentation arrows — are the three controls most likely to be used standing up, in a dark room, one-handed, by someone who has been drinking. They are the smallest in the app.

And there are **zero touch handlers in the entire codebase** (grep-verified: no `onTouchStart`/`onTouchMove`/`onTouchEnd`). Both fullscreen "drive the room" modes implement **arrow-key** navigation (`App.jsx:5845`, `App.jsx:3449`) and nothing else. There is no swipe.

There is also **no `inputMode` anywhere in App.jsx** (grep-verified). So the PIN fields (`App.jsx:745, 752`), the age field (`1541`), the timer's minutes/seconds (`7308, 7310`) and the quiz pause duration (`4151`) all raise the full QWERTY keyboard on a phone for digit-only entry. `features/mensgames/ui/Kit.jsx:65` accepts `inputMode` and `RoundEditor.jsx:62` uses `inputMode="decimal"` — the feature layer got this right and the main app never did.

### 2.10 Accessibility gaps that are really usability gaps

- `Modal` (`App.jsx:249`) has **no** `role="dialog"`, no `aria-modal`, no focus trap, no focus restore, no body-scroll lock, and **no Escape handler**. It also carries a 350ms `ready` timer to suppress accidental backdrop closes — a symptom, not a fix. Meanwhile five components each rolled their own Escape key handler (`App.jsx:562, 827, 2457, 3437, 5847`). Escape works in the teaser, the nav dropdowns, the quiz dashboard, the quiz presenter and present mode; it does not work in any of the ~15 modals built on the shared primitive.
- **The backdrop click means three different things.** In most modals it discards. In `EditProfileModal` (`App.jsx:1514`), `WinnerForm` (`App.jsx:5153`) and `HighlightForm` (`App.jsx:5160`) it **saves** — the UI even explains this with a caption reading "Clicking outside saves automatically". In `TeaserModal` it does nothing. Same gesture, three outcomes, no way to tell which you are in until after.
- `Lbl` (`App.jsx:213`) is a `<div>`, not a `<label>`, and takes no `htmlFor`. No form field in the app is programmatically labelled.
- `Tooltip` (`App.jsx:237`) is hover-only, and `title=` attributes are used for meaningful help in several places (`App.jsx:1872`, `App.jsx:6390`) — **both are invisible on the primary canvas**. `TeamsTab` noticed this and added a visible caption with a comment saying so (`App.jsx:1873`); the lesson was not generalised.
- `GS` declares **24 `@keyframes`** and applies them via always-on classes (`.float`, `.glow-pulse`, `.fire-border`, `.ann-banner`, `.event-card-upcoming`, …) with **no `prefers-reduced-motion` gate**. The only reduced-motion query in App.jsx is inside `TeaserModal`'s own scoped block (`App.jsx:577`).
- The awards accordion in the Hall of Fame expands by writing `nextSibling.style.display` directly (`App.jsx:1272`) — no `aria-expanded`, no keyboard, and a different expand pattern from the RSVP card's `max-height` transition and the nav dropdowns' conditional render. Three disclosure patterns.
- Clickable `<div>`s where a button belongs: the wordmark (876), every event card (1683, 1702), every tool tile (1638), the RSVP card header (2213), the awards row (1272).

---

## 3. Information architecture — the central question

### 3.1 What the model is today

Everything hangs off an **Event**. `EventPage` owns nine tabs (`App.jsx:1811`):

```
Overview · Polls · Quiz · Teams · Photos · Winners & Highlights · FAQ · Kretjes 🍺 · Mens-Games 🏆
```

Beside that sit five things that are *not* events: Hall of Fame, Lads, Updates, and the Tools (Team Creator, Timer, Mens-Games, Sara Jay). Admin is a modal, which puts it at no level of the hierarchy at all.

### 3.2 The model is already breaking, in the code and in the specs

Three capabilities have escaped the event, each independently:

1. **Teams.** `team_sets` is its own table (`mensgames-spec.md` §2.1). A set can be linked to many events or none. The event's Teams tab is now a *filtered view* of the library (`App.jsx:1834`), and destroying a set from inside an event was correctly demoted to "Loskoppelen" because it belongs to something bigger.
2. **Tournaments.** `mensgames-spec.md` §4.6: *"both a top-level page and an event tab… Both mount the same lazy component with a different `scope` prop."* This is the right instinct and it is the only place the duality is handled deliberately.
3. **Quizzes.** `quiz-unification-spec.md` §3.1 makes `event_id` nullable and §1 states the quiz becomes *"reachable from the Home tile row and from an event, exactly like Mens-Games."*

So the answer to Dom's question is: **the event-centric model is no longer right, and the code has already conceded it.** What is missing is not the decision — it is a *shared pattern* for the duality. Right now:

- Mens-Games gets a top-level page **and** an event tab, same component, `scope` prop.
- Teams gets a Tools page (`Team Creator`) **and** an event tab, but they are **two different components** (`TeamCreatorPage` at 6676 vs `TeamsTab` at 1832) with different languages and different capabilities.
- Quiz currently has an event tab, a dashboard **modal**, a fullscreen presenter and a fullscreen participant view — and after the spec ships, a Home tile too.

Three features, three shapes. A fourth will arrive with the same question.

### 3.3 The proposed model

Four top-level concepts, and one orthogonal mode.

```
┌─ EVENTS ────────── the calendar: what's next, what happened
│                     an Event is a CONTAINER, not an owner
├─ TOOLS ─────────── things that run: Quiz · Tournaments · Teams · Timer
│                     each exists on its own; each can be attached to an event
├─ THE GROUP ─────── Lads, profiles, Hall of Fame, records
└─ INBOX ─────────── Updates + Announcements, one stream

   LIVE ─────────── not a place. A mode any Tool or Event can enter,
                     reachable from anywhere in the app while it is running.
```

**The one rule that makes this work:** a Tool is defined by its own record; an Event *references* Tools. An event page does not own a quiz, it lists the quizzes attached to it. This is exactly what both specs already do in the database — the UI just has to agree.

**What an Event page becomes.** Nine tabs collapse to three, plus an attachments rail:

| Today | Becomes |
|---|---|
| Overview | **Overview** — RSVP, schedule, who's coming. The one tab that is genuinely event-specific. |
| Polls, FAQ, Kretjes 🍺 | **Talk** — the three lightweight social surfaces, one tab. Polls and FAQ are both "the group answers a question"; Kretjes is a single counter that does not deserve a tab of nine. |
| Photos, Winners & Highlights | **Memories** — both are "what happened", both are only used after the event. |
| Quiz, Teams, Mens-Games 🏆 | **Attached** — a rail of tool cards ("2 quizzes · 1 tournament · 1 team set"), each opening the tool in event scope. Not tabs. |

Three tabs fit on a 375px screen without scrolling. Nine do not — today tabs 4-9 (**Teams onward, including Photos and Winners**) are off-screen with no scroll affordance, no fade, no arrows (`App.jsx:2118`, `overflowX:"auto"` and nothing else). *(Inferred from declared padding/font-size; not measured on a device — worth a 60-second check on a real phone before acting.)*

**What Home becomes.** Today Home is: a hero (🍺 + wordmark + hype line + 4 stats + avatar row), then Next Mission, then a Tools grid, then Archives. The hero repeats the wordmark that is already in the nav 40px above it, and consumes most of the first screen. Home should open on **the next event** — the thing 95% of sessions are about — with the group stats demoted to a single line and the Tools grid moved into the Tools destination where it belongs (it is currently duplicated: `Home` tiles at `App.jsx:1626-1651` and the nav Tools dropdown at `App.jsx:900-908`, with Dutch descriptions on one and English labels on the other).

**Where Admin goes.** Out of the modal, into a page under The Group. It is the only part of the app with no place in the hierarchy, which is why nothing links to it and it links to nothing.

### 3.4 Compatibility with the two specs

This model **does not fight either spec** — it is what both are already implying.

- `mensgames-spec.md` §4.6's `scope` prop is exactly the mechanism. Generalise it: every Tool component takes `scope: {type:'standalone'|'event', eventId?}`.
- `quiz-unification-spec.md` §4.5 plans a `useLiveQuizWatch()` hook at the App root plus a "🔴 Quiz bezig — meedoen" banner. That is the **LIVE mode** in §3.3, arriving feature-by-feature. **This is the moment to define it once**, because there will otherwise be a live-quiz banner, a live-presentation banner and (eventually) a live-tournament banner, all at different z-indexes, all claiming `top:0`. See §10 D3.
- The one thing I would **add** to the quiz spec: its `TeamSetPicker` (§5.2) and mensgames' `EntrantPicker` are the same component with different names. Build the quiz one *as* a generalisation of `EntrantPicker`, not "modelled on" it.

**Two things in the specs actively work against this model, and both are decisions rather than oversights:**

**(a) The two specs list opposite halves of the dual mount as cut lines.** `mensgames-spec.md` §10 cut line 8 would drop the **event tab** ("ship the top-level page only"). `quiz-unification-spec.md` §15 cut line 6 would drop the **top-level page** ("Cutting it halves the App.jsx diff"), and its §14 decision 1 hedges the same question. If both cuts land under schedule pressure, mens-games becomes page-only and the quiz becomes tab-only — two features that look identical to a user, living in different places, which is precisely the accretion this plan exists to stop. **Pick one shape and hold it, and write the cut line as "cut the feature, not half the pattern".**

**(b) The app already has four live-sync mechanisms, and the best one is invisible to both specs.** `PresentationMode` (`App.jsx:1991-2020`, `5686-5817`) does presenter→viewer sync over Supabase **broadcast + presence** — `ch.track({presenting:true, idx, stopId, revealedSecrets})` plus `ch.send({type:'broadcast', event:'slide'})`, with late-joiner recovery from presence state and **zero database writes for slide navigation**. Meanwhile the quiz writes live state into the event row and polls it every 2s (the thing that failed at the last event), mens-games uses a single-row `postgres_changes` subscription with a 400ms debounced full-row upsert, and the notification system uses yet another broadcast channel. The quiz spec's fix is to write live state to a *smaller* row. Broadcast/presence would give `quiz_live` semantics with no rows written at all, at the cost of no persistence across a presenter refresh. That may well be the wrong trade for a quiz — but neither spec evaluates it, and the app should not end up with five sync engines because nobody compared them.

---

## 4. Navigation and wayfinding

### 4.1 The phone needs a bottom bar

Everything navigational is currently in the top 58px. On a phone held one-handed, that is the hardest region to reach and the easiest to mis-tap. Four destinations, thumb-reachable:

```
┌──────────────────────────────────────────┐
│                                          │
│              content                     │
│                                          │
├────────┬────────┬────────┬───────────────┤
│  🍺    │  🧰    │  👥    │   📬          │
│ Events │ Tools  │ Group  │  Inbox  (•)   │
└────────┴────────┴────────┴───────────────┘
```

The top bar keeps only: contextual back, the current page title, and the avatar menu. That halves the nav code (desktop and mobile currently render **two separate hand-styled copies** of every nav item — `App.jsx:884-931` vs `App.jsx:934-951` — which is why the mobile copy already drifted: `fontSize .78rem` vs `.88rem`, and Sara Jay is labelled "🤖 Sara Jay" on desktop and "🤖 Sara Jay or JAI" on mobile).

A live-mode strip replaces the ad-hoc banners: when anything is live, a single persistent bar appears above the bottom nav — *"🔴 Quiz bezig · Meedoen"* / *"🎬 Presentatie loopt · Kijk mee"*. One slot, one owner, one z-index.

### 4.2 Add routing

Even the smallest change here pays for itself: hash routing (`#/event/e-2026/overview`) requires no server config on Vercel and no library beyond ~80 lines mapping `pageView` + `activeId` + `tab` to and from `location.hash`. It buys: working back button, shareable links into WhatsApp, reload-safe state, and — not incidentally — it makes the deep-link machinery that already exists in `openEvent` (`App.jsx:7728`) actually reachable from outside the app.

This should happen **before** the App-state refactor (backlog "Split step 5"), not after, because the route shape is the seam that refactor needs.

### 4.3 Dead ends inventory

| Where | What happens | Fix |
|---|---|---|
| `TeamsTab` empty state (`App.jsx:1856`) | *"Genereer teams via de Team Creator en koppel ze aan dit event."* — names the destination, links to nothing | Empty state gets a primary action button that navigates there **and returns** |
| `OverviewTab` empty schedule (`App.jsx:2288`) | *"Add activities with Edit ↑"* — an arrow pointing at a button that has scrolled off-screen | Put the action in the empty state |
| Hall of Fame rows | Names are text. Tapping a leaderboard row does nothing | Every name links to that member's profile |
| Member profile | No way to reach the events they attended | Attendance dots link to events |
| `AdminPanel` | Modal; links to nothing, nothing links to it | Make it a page under The Group |
| Quiz / Tournament results | Land in the Hall of Fame, but the Hall of Fame does not link back to the quiz or tournament that produced them | Result rows link to the source |
| **A live quiz** (`App.jsx:4216`) | **A non-organiser has no exit at all.** Mounts automatically, covers the screen, only close control is admin-gated (`4374`) | §0 — fix first |
| `QuizDashboard` (`App.jsx:2443`) | Escape works only while `panel==="welcome"` (`2457`). Once you open the builder you must find "Cancel" inside it before Escape does anything again — a two-step exit with no signposting | One Escape behaviour per overlay |
| `QuizBuilder` (`App.jsx:2734`) | **No unsaved-changes guard.** Cancel discards silently, and clicking a different quiz in the sidebar (`2546`) also discards silently. On a 40-question quiz that is a real loss vector — and note the app has already been through this exact bug once, in the schedule editor (backlog: *"Schedule editor — never lose work when the modal closes"*, Done) | Apply the schedule editor's fix here |
| A pending user | Sees `PendingScreen` and can only log out. No status, no ETA, no nudge | See §7 |
| Forgotten PIN | **No recovery path exists anywhere** — `pin_hash` appears only at login (`App.jsx:699`), register (`App.jsx:737`) and seed (`App.jsx:7444`). Admin has no reset. A member who forgets their PIN is locked out permanently | See §7 |

---

## 5. Consistency — the divergences and the one pattern for each

### 5.1 Empty states

**23 hand-rolled empty states in App.jsx, in 6 distinct visual treatments, using 10 different padding values, and exactly one of them offers an action** (`PhotosTab:5036`, "Upload first photo"). Container: `<Card>` 7×, bare `<div>` 14×, inline italic span 2×. Icon: `3rem` 1×, `2.5rem` 7×, `2rem` 1×, none 11×. Colour: `--muted` mostly, `--muted2` twice, and the component-local `AA_MUTED` five times.

On top of those, **11 places render nothing at all** — no message, no explanation. Seven of them are Hall of Fame sections that simply vanish (`App.jsx:1160, 1229, 1246, 1285, 1337, 1354`), and `MembersPage` (`App.jsx:1414`) has no empty state whatsoever: it renders the `👥 Lads` heading above an empty grid.

The most-diverged examples:

| Where | Treatment | Copy |
|---|---|---|
| `Home` no upcoming (`App.jsx:1614`) | `Card`, gradient bg, `3.5rem` padding, 3rem emoji, serif headline + muted line | "The next edition is being planned… / Admin is cooking something up. Stay on standby, lad." (EN) |
| `TeamsTab` (`App.jsx:1854`) | bare `div`, `3rem` padding, 2.5rem emoji, serif headline + muted line, **no card** | "Geen teams gekoppeld / Genereer teams via de Team Creator…" (NL) |
| `OverviewTab` schedule (`App.jsx:2284`) | bare `div` **inside** a Card, 2.5rem emoji, headline + line + a conditional admin hint | "Schedule under wraps / The lads don't need to know yet." (EN) |
| `UpdatesPage` (`App.jsx:6429`) | bare `div`, `4rem` padding, 2.5rem emoji, two muted lines, no headline | "Nog geen updates / Nieuwe polls, schema-wijzigingen…" (NL) |
| `AdminPanel` pending (`App.jsx:993`) | one line of muted text, `2rem` padding, no emoji | "No pending requests 🎉" (EN) |
| `HallOfFame` (`App.jsx:1384`) | `Card`, `4rem` padding, one line | "No events yet — the Hall of Fame will fill up as you play!" (EN) |
| `TeamCreatorPage` (×3: 6998, 7037, 7156) | one line of `AA_MUTED` text, `2rem` padding | "Voeg deelnemers toe…" (NL) |
| Every Hall of Fame section | **silently disappears** | — |

**The one pattern.** `<EmptyState icon title body action? />` — always inside the surface it belongs to (never a bare div next to cards), always with a *primary action when one exists*, always in the same language, and never a bare disappearing section.

**It already exists**: `features/mensgames/ui/Kit.jsx:122`. Promote it and convert the 23 call sites. Worth noting honestly that even mensgames only uses its own `EmptyState` at **4 of 8** sites — the other four render a `<Tag>` pill or a plain div (`TournamentEditor.jsx:334, 453`, `RoundEditor.jsx:268`, `EntrantPicker.jsx:87`). Having the component is not the same as using it, which is an argument for converting all 31 sites in one pass rather than opportunistically.

### 5.2 Errors

Four unrelated shapes:

| Shape | Example |
|---|---|
| Global fixed banner, manual dismiss, z-2000 | write failures (`App.jsx:7828`) |
| Full-screen takeover with retry | boot failure (`App.jsx:7794`) |
| Inline `role="alert"` card with retry | `TeamSetsErrorNotice` (`App.jsx:1821`) |
| Bare red text, no retry, no icon | unlink failure (`App.jsx:1860`), profile upload (`App.jsx:1533`), register (`App.jsx:762`) |

**`updateEvent` (`App.jsx:7664-7686`) is the only write in App.jsx that rolls back and reports.** Roughly fifteen others are fire-and-forget with no error check at all, so the optimistic UI never un-does itself:

| Line | Handler | What the user believes vs what happened |
|---|---|---|
| 7690 | `deleteEvent` | Event vanishes and app navigates home; on failure it is still in the DB and returns at next boot |
| 7757 | `saveProfile` | `if(!error){…}` — on failure the modal **still closes**, so the profile looks saved |
| 7631 / 7644 | `updateUsers` / `deleteUser` | Role change / deletion appears applied, isn't persisted |
| 7702, 7711, 7719, 7727 | announcement save / archive / reactivate / hard-delete | All four fail silently |
| 7748, 7754 | `toggleSaraJay` / `toggleMensGames` | Feature flag flips locally only |
| 7613 | clear-all-notifications | Tombstone never written; notifications reappear |
| 4282, 4307, 4371 | live-quiz state writes | **Presenter and participants silently desync mid-quiz** |
| 5015 | `PhotosTab` multi-file upload | `console.error(...); continue;` — a failed photo is skipped with no indication which |
| 2805 | `QuizBuilder` round background upload | `if(!error){…}` — failure is a complete no-op |

**The one pattern.** Two shapes only: *(a)* **inline**, next to the thing that failed, with a retry, for anything scoped to one surface; *(b)* **global banner**, for anything that could have originated anywhere. Nothing silent — every mutation reports. `TeamSetsErrorNotice` (`App.jsx:1821`, reused at 4 sites) and mensgames' `ErrorState` (`Kit.jsx:130`, used at 6/6 sites, with a distinct message and retry per failure mode) are both good models; `ErrorState` is the one to promote.

### 5.3 Confirmation

**The one pattern.** A shared `useConfirm()` returning an in-app modal (not `window.confirm`, which is unstyled, blocking, and on iOS names the domain), applied by a single rule:

> Confirm if it destroys data other people can see, or data that cannot be recreated in under a minute. Do not confirm anything else.

Under that rule: **confirm** delete event, delete user (both paths), clear-for-everyone, delete-for-everyone, delete team set, delete quiz/tournament. **Do not confirm** archive, unlink, delete-for-me, remove a photo you just uploaded. Today the app does roughly the opposite.

Destructive buttons should also stop being `size="sm"` ghosts in a row of five. On the event page, `Delete` belongs behind an overflow menu, not beside `Edit`.

### 5.4 Loading

Five variants, plus nothing:

- **Text swap on a button** — 9 sites (`712, 762, 1524, 6173, 7021, 7131`, …), the de-facto standard.
- **Bare word on a page** — `Laden…` from two `Suspense` fallbacks (`2125, 7852`) and `Loading…` on the boot screen (`7802`). Note those two are in different languages.
- **Emoji swap inside a button** — `{imgUploading ? "⏳" : "⬆"}` (`2941`), with no disable and no label.
- **A second animated hint line** — `Schud… schud… schud…` (`7027`), unique to Team Creator.
- **`<Suspense fallback={null}>`** — the trailer loads with no indicator at all (`2150`).
- **Nothing** — the multi-file photo upload (`5014-5015`) has no loading state of any kind.

And a `.skeleton` shimmer class is **defined in `GS:72` and used nowhere in the codebase.** There are **zero spinners** anywhere.

**The one pattern.** Skeletons for content with a known shape (lists, cards); buttons always disable and swap label during their own async work; never a bare word floating on a page. `Kit.jsx:138`'s `LoadingBlock` (`role="status"` + an sr-only label + two shimmer bars) is the one to promote — and the dead `.skeleton` class in `GS` is what it should be built on.

### 5.5 Modals

Ten modals are built on the shared `Modal` (`982, 1515, 4952, 5153, 5160, 5285, 5426, 6071, 6209, 6262`), and **the backdrop click means three different things across them**: it **saves** (`1515` `EditProfileModal`, `6071` `EditScheduleModal`), it does **nothing** (`4952`, `5285`, `6262`), or it saves-if-editing / no-ops-if-creating (`5153`, `5160`, `5426`, `6209`). Only two of the ten disclose the behaviour, both in English inside otherwise-Dutch dialogs (`1547`, `6091`).

The fixed version already exists **twice** in the codebase: `Kit.jsx:152` (focus-in on mount, focus-restore on unmount, `aria-modal`, `labelledBy`) and `TeaserModal` (`App.jsx:550`, which has `role="dialog"`, `aria-modal`, focus-on-mount, an Escape handler *and* a `body.overflow` lock — every single thing the shared primitive lacks). Two components independently rebuilt the accessible modal rather than fixing the one everything else uses.

`Modal` (`App.jsx:249`) needs, in one edit: `role="dialog"` + `aria-modal`, focus trap and restore, Escape, body-scroll lock, and — most importantly — **one backdrop semantic**. My recommendation: backdrop always **saves** for edit-in-place forms and always **cancels** for create forms, decided by a `mode` prop rather than per-caller, and the 350ms `ready` hack deleted in favour of `mousedown`-target checking. The three components currently explaining the behaviour in a caption ("Clicking outside saves automatically") should not need to.

Additionally: the fullscreen overlays (`PresentationMode`, `QuizPresenter`, `QuizParticipantView`, `QuizDashboard`, `PhotosTab` lightbox, `EventTrailer`) are **not** modals and should not pretend to be — they are *modes*. Give them a shared `<Overlay>` with a defined z-scale (see §5.7) and a single close affordance in a single position.

### 5.6 Language

**Recommendation: go Dutch, entirely.** Not because Dutch is better, but because:
- The group is Dutch. The Dutch strings are the ones with personality ("Schud… schud… schud…", "Geheim", "kretjes"). The English strings are mostly the older, more generic ones.
- Dates already render `nl-NL`.
- The alternative — go English — means rewriting the copy that is actually good.
- It is the smaller diff: the English surfaces are more mechanical.

**But this is Dom's call (D1 in §10)**, and there is a real argument the other way if the public version in backlog #31 is ever taken seriously.

Either way, the mechanism matters more than the choice: strings must stop being written inline at 1,546 style objects' worth of call sites. A flat `strings.js` module keyed by surface (~250 entries) is enough — no i18n library, no runtime switching, just one file where the language is visible and reviewable. That also makes a future second language a data problem rather than a rewrite, which is what backlog #31 would need.

**Do the first-run path first** (Login → Register → Pending → boot messages). It is six screens and it is the only sequence a stranger sees.

### 5.7 Design tokens the `GS` block is missing

```
--space-1..8    4 8 12 16 24 32 48 64      (replaces 143 padding values)
--text-xs..3xl  0.75 0.875 1 1.125 1.375 1.75 2.5rem   (replaces ~50 sizes)
--radius-sm/md/lg/pill  8 12 16 999        (replaces 12 hardcoded radii)
--z-base 0 · --z-sticky 100 · --z-nav 200 · --z-dropdown 300
  · --z-overlay 400 · --z-modal 500 · --z-toast 600
--tap-min 44px
```

And three corrections to existing tokens:
- `--muted` → `rgba(240,230,211,.68)` (the existing `AA_MUTED`, 7.49:1). Retire `--muted2` or redefine it as the *disabled* colour only, never body text.
- `--border` → `rgba(232,148,58,.30)` minimum, ideally `.35`, for a real 3:1 boundary.
- Replace the `outline:none` focus rule with a genuine ≥3:1 ring — mensgames already has one worth copying verbatim (`ui/styles.jsx:33-38`).

Note that raising `--text-xs` to 12px means the 63 uses of `.72rem` (11.5px) all get slightly larger. That is a feature, not a regression, on the primary canvas.

---

## 6. Efficient use of space — mobile first, bar at night

### 6.1 The first screen is spent on identity, not content

On Home, before any content: nav 58px + `main` padding-top 78px + `AnnouncementBanner` (when active) + hero (🍺 emoji at `2.8rem` + "MENSAPP" at `2.6rem` + hype line + stat pill + avatar row) + the "🔥 Next Mission" heading. *(Inferred from declared sizes; roughly 380-440px of hero on a 375×812 viewport before the event card starts.)* The wordmark appears **twice** — once in the nav bar 40px above, once in the hero.

The event page repeats the pattern: tags row, event name at `clamp(1.8rem,5vw,2.8rem)`, date row, location, avatar stack, a four-unit `T-MINUS` countdown, the description, then a footer bar with up to six buttons that wrap to three rows on a phone, *then* the tab strip, *then* content.

**Recommendation.** Both pages get a compact header: title + the one number that matters + one primary action. The stats, hype line and secondary metadata move into a collapsed strip. The countdown drops from `d:h:m:s` to `d:h:m` on mobile (the seconds digit re-renders every second for no informational value and costs a full countdown row of width).

### 6.2 The bar-at-night control audit

The table in §2.9 is the actionable list. The minimum bar:

- **44px** for anything a member taps.
- **48px** for anything an *organiser* taps **while the event is running** — score entry, slide navigation, reveal toggles, timer controls. Mensgames already set this precedent and wrote down why (`ui/styles.jsx:41-46`).
- **Swipe** in `PresentationMode` and `QuizPresenter`. Currently the only mobile affordances are a 36px-wide, 3%-opacity side rail and a 7px dot.
- **Bottom-anchored primary actions** in the live modes, not top-anchored — a presenter holding a phone cannot comfortably reach a top-right "✕ Exit".

### 6.3 The Hall of Fame is one 3,000px scroll

Eight sections render unconditionally, in a fixed order, with no tabs and no filter: Perfect Attendance, Attendance Record (podium + a full row per member), On a Roll, Most Awards Won, Team Trophy Cabinet, Quiz All-Time Scores, Lens Legend, All-time Kretjes.

The **same row markup** — rank number, avatar, name, subtitle, coloured pill — appears five times with only the pill colour changing: `App.jsx:1210` (attendance), `1240` (on a roll), `1275` (awards), `1345` (quiz), `1365` (photos).

**Recommendation.** One `<LeaderboardRow>` component, plus a segmented control: `Opkomst · Awards · Quiz · Teams`. Perfect Attendance and On a Roll are both "who shows up" and belong inside the Attendance view as badges, not as their own sections. That takes the page from eight sections to four views of one to two sections each — and makes it usable on a phone, which today it is not.

### 6.4 Density

A "compact" mode is not needed. What is needed is: fewer sections per screen, one clear primary action per screen, and consistent spacing so the eye can predict where things are. The current spacing (`display:grid; gap:"2.5rem"` on Home, `1.5rem` on EventPage, `2rem` on Hall of Fame, `1.4rem` on OverviewTab) means every page breathes differently.

---

## 7. What public use would demand

Backlog #31 is explicitly *"NORTH STAR, NOT SCHEDULED WORK."* I have taken that at face value: nothing below is a proposal to build multi-tenancy. These are the things that are **broken for the current friend group too**, and which happen to also be public-version prerequisites — i.e. they earn their keep now.

**1. PIN recovery (real gap, real risk, today).** There is no reset path anywhere. Not for the user, not for an admin. One forgotten PIN = one permanently locked-out mate. Minimum viable fix: an admin action in the Admin panel that sets a one-time PIN, shown once. This does not require the auth rework — but note backlog #20: PINs are currently recoverable by anyone who loads the app, so treat any PIN feature as temporary scaffolding, not a design commitment.

**2. The first-run path has to explain itself.** Today a stranger at the URL sees `🍺 MensApp / THE ANNUAL GATHERING / Welcome back / Username / PIN`. Nothing says what this is, who it is for, or that access is by approval. One line under the wordmark fixes 80% of it. "THE ANNUAL GATHERING" is jargon that is not even accurate — the app holds multiple events.

**3. Pending users need a state, not a wall.** `PendingScreen` (`App.jsx:772`) says "Nag the group chat" — which assumes a group chat, assumes you know who is in it, and gives the user nothing to do. It should show who approves, when they were asked, and offer to re-ping.

**4. Unexplained jargon.** *Kretjes* (a whole tab, a Home stat, a Hall of Fame card, and never once defined), *Mensdag* / *Mens-Games* / *Lads* / *"Legendary"* (a Home stat that is just the count of past events) / *"Org"* vs *"Admin"* (the role difference is nowhere explained, and §2.6 shows even the code is confused about it) / *Sara Jay or JAI* / *"🔒 ???"*. Insider language is a feature of this app's character and should mostly stay — but each term needs one first-use explanation. A locked "🔒 ???" tile with no explanation is charming to the fifteen people in on it and baffling to anyone else.

**5. Empty first-run.** A brand-new group sees: an empty Home, an empty Hall of Fame that hides all eight of its sections, an empty Lads page, and four Tools that mostly need an event. Every empty state needs to become a next step (see §5.1) before anyone but Dom's mates ever installs this.

**6. Six role strings for three concepts.** `admin`, `admin+org`, `org`, `organisation`, `lad`, `member` (`App.jsx:281-283`). `lad`/`member` and `org`/`organisation` are synonyms carried for backwards compatibility. Any public version needs three roles with names that mean something outside this group. Not urgent; note it before the auth rework locks it in.

**What I would explicitly NOT build for a hypothetical public version yet:** group creation/joining, invites, per-group theming, onboarding tours, a settings screen, or a language switcher. Backlog #31 is right that these should not be designed until Dom decides it is real. The six items above are worth doing regardless.

---

## 8. What I would remove or merge

Ordered by value. This is the most important section in the document.

1. **The `extractFromAppSource.js` source-parsing test hack.** Backlog "Split step 2" already proposes this. It is not a test-quality issue — it is the constraint (`mensgames-spec.md` §5.4 rule 1) that forced the design system to fork and will keep forcing it. **Delete this and everything else in §9 gets cheaper.** 52 helper tests convert from source-eval to real imports; adding `export` to a `const` changes nothing at runtime.
2. **One of the two `Btn`/`Card`/`H` implementations.** Keep mensgames'. Delete App.jsx's. (§2.1)
3. **Six of the nine event tabs**, merged into three plus an attachments rail. (§3.3)
4. **`TeamsTab` as a separate component.** It is `TeamCreatorPage`'s library list filtered by event, re-implemented in a different language with fewer capabilities. It should be the same component in event scope, like mens-games already does.
5. **Four of the eight Hall of Fame sections**, merged into four tabbed views. Perfect Attendance and On a Roll become badges on the attendance view. (§6.3)
6. **The Home Tools grid.** It duplicates the nav Tools menu with different copy in a different language. Tools should have one home.
7. **The Home hero's stat pill.** "Editions" and "Legendary" both count events (total and past). "Lads In" duplicates the number on the event card directly below it.
8. **`window.confirm`.** One in-app pattern. (§5.3)
9. **The separate desktop and mobile nav renders.** One data-driven nav; they have already drifted. (§4.1)
10. **`--muted2` as a text colour.** It fails contrast against every surface in the app.
11. **`Tooltip` and every load-bearing `title=`.** Invisible on the primary canvas. Replace with visible captions, as `TeamsTab` already does at `App.jsx:1873`.
12. **The 350ms `Modal` `ready` timer.** A workaround for a problem a proper `mousedown`-target check solves. (§5.5)
13. **Four of the six timers.** There are **six** timer implementations and **three** different dial renderings: `TimerPage` (`7215`, SVG ring r=80), `useRoundTimer.js` (no ring at all), the quiz question timer (`3500`), the music timer (`3518` → `MusicPlayer`'s ring at r=62), the pause timer (`3532`), and the participant timer (`4260`). Only the last one derives from `Date.now() - timerStartedAt`, so it is **the only one that does not drift across devices** — and it is the one nobody would think to keep. `mensgames-spec.md` §4.5 already accepted this debt and filed the follow-up; cash it in after the shared UI layer lands, and make the wall-clock-derived version the shared one.
14. **The quiz's own team builder** (`App.jsx:3138-3255`) — the third of four team-building implementations, and the only one with no generation algorithm. `quiz-unification-spec.md` §5.1 already deletes it. Related: the `TEAM_AVATARS` emoji-grid picker exists three times (`3188, 4380, 7053`).
15. **Nine leaderboard renderings.** `2588, 2704, 4018, 4052, 4477, 4508, 1337`, plus `StandingsTable.jsx` and `ScoreboardPanel.jsx`. Two components would cover all nine.

**What I would keep that you might expect me to cut:** Sara Jay, the trailer, the login teaser, kretjes, the hype lines, the animal avatars. These are the app's personality and they are exactly why fifteen people use it. The problem was never that there is too much character; it is that the character is inconsistently applied.

---

## 9. The prioritised plan

Effort is rough dev-days for one focused implementer. Risk is the chance of breaking something live.

### Phase 0 — Unblock (do first, ~3.5 days, low risk)

| # | Item | Effort | Risk | Notes |
|---|---|---|---|---|
| **0.0** | **Give members an exit from `QuizParticipantView`; clear `_liveState` on `beforeunload`** | **0.5d** | **Low** | Ships independently of everything else. There is a real event coming and today one crashed presenter tab strands every phone in the room. See §0. |
| 0.1 | Delete the source-parsing test hack; export helpers properly | 1d | **Low** | Backlog "Split step 2". 52 tests are the safety net. Adding `export` is a no-op at runtime. |
| 0.2 | Extract `src/ui/` from `features/mensgames/ui/` — tokens, `Btn`, `Card`, `H`, `Inp`, `Lbl`, focus ring, reduced-motion, `.mg-*` classes renamed | 1.5d | **Low** | Backlog "Split step 1", but sourced from the *good* implementation rather than the old one. Pure move + rename. |
| 0.3 | Fix the three token values: `--muted`, `--border`, the focus ring | 0.5d | **Low** | Three lines in `GS`. Immediately raises the whole app above AA. Highest ratio of impact to effort in the document. |

**Do not skip 0.1.** Everything after it is 2-3× cheaper.

### Phase 1 — The phone (≈5 days, medium risk)

| # | Item | Effort | Risk |
|---|---|---|---|
| 1.1 | Bottom nav for <768px; one data-driven nav for both tiers; retire the hamburger list | 2d | Medium — Nav has 19 props and a passing test suite (`navRework.test.jsx`) |
| 1.2 | Hash routing: `pageView`+`activeId`+`tab` ↔ `location.hash`; back button; shareable links | 1.5d | Medium — touches App root, but additive |
| 1.3 | Tap-target sweep to 44/48px, driven by the §2.9 table | 1d | **Low** — mechanical |
| 1.4 | Swipe in `PresentationMode` + `QuizPresenter`; enlarge the dots and rails | 0.5d | Low |

**1.2 must land before the App-state refactor** (backlog "Split step 5"), because the route shape defines that refactor's seam.

### Phase 2 — The one pattern for each (≈6.5 days, low risk)

| # | Item | Effort | Risk |
|---|---|---|---|
| 2.1 | Promote `EmptyState`/`ErrorState`/`LoadingBlock` from `Kit.jsx`; convert **31** call sites (23 App.jsx + 8 mensgames), each with a real action | 1.5d | Low |
| 2.2 | `useConfirm()` + apply the §5.3 rule across the **24** unconfirmed destructive actions | 0.5d | Low |
| 2.3 | Fix the ~15 fire-and-forget writes so failures surface | 1d | Low |
| 2.4 | `Modal`: dialog role, focus trap, Escape, scroll lock, **one** backdrop semantic | 1d | Medium — 10 call sites, and 6 currently rely on backdrop-saves |
| 2.5 | `strings.js`; convert the first-run path (Login/Register/Pending/boot) first, then the rest | 1.5d | Low, but tedious |
| 2.6 | Terminology: one word per concept — start with the three RSVP label sets, then "Live" (five meanings) and "Round" (two) | 0.5d | Low |
| 2.7 | Delete the two shadowing copies (`TabBtn` at 2833, `Toggle` at 4755) and collapse the nine icon-button conventions | 0.5d | Low |

### Phase 3 — The IA (≈7 days, higher risk — schedule around the event)

| # | Item | Effort | Risk |
|---|---|---|---|
| 3.1 | Event page: 9 tabs → 3 + attachments rail | 2d | **High** — this is the change people will notice most |
| 3.2 | Home: compact header, next event first, Tools grid removed | 1d | Medium |
| 3.3 | Hall of Fame: `<LeaderboardRow>` + 4 tabbed views | 1.5d | Low |
| 3.4 | Generalise `scope` across Tools; `TeamsTab` becomes `TeamCreator` in event scope | 2d | Medium — coordinate with the quiz spec's §5.2 `TeamSetPicker` |
| 3.5 | Admin: modal → page | 0.5d | Low |

**Do not run Phase 3 in the fortnight before a live event.** Phases 0-2 are safe to ship continuously; Phase 3 changes where things are.

### Phase 4 — Public-use hygiene (≈3 days, low risk)

Admin PIN reset (0.5d) · first-run explainer line (0.5d) · pending-user state (0.5d) · jargon first-use explanations (0.5d) · empty first-run states with next steps (1d, mostly done by 2.1).

### What NOT to bother with

- **A CSS-in-JS library, Tailwind, or a component library.** The constraint is real and the codebase does not need it. Tokens + a small CSS class layer + the existing `Kit.jsx` is enough, and it is what mensgames already proved.
- **TypeScript.** Out of scope, and it is not what is wrong.
- **An i18n library.** A flat `strings.js` is sufficient and reviewable.
- **A settings screen.** Nothing needs to be configurable yet.
- **Dark/light theming.** The app is one dark theme with real character. Leave it.
- **Onboarding tours, tooltips, coach marks.** For fifteen people who already know the app, this is pure cost. Fix the labels instead.
- **Extracting a shared `TimerDial` right now.** `mensgames-spec.md` §4.5 accepted the duplication deliberately. Cash it in after Phase 0, not during.
- **Redesigning `SaraJayOrJAI`.** It is an easter egg and works as one.
- **The bundle size** (713 kB) as a UX item. It is a real issue but it is downstream of the file split, which the backlog already sequences.
- **Chasing every one of the 1,546 inline styles.** Convert what a component touches when it is touched for another reason. A dedicated conversion sprint would be weeks of high-risk, low-visibility churn.

---

## 10. Decisions I need from Dom

| # | Decision | My recommendation | Why it can't wait |
|---|---|---|---|
| **D1** | **Dutch or English?** | Dutch. The good copy is already Dutch; dates are `nl-NL`; the diff is smaller. | §5.6 and Phase 2.5 both stall on it, and every new string written before the decision adds to the cleanup. |
| **D2** | **Nine event tabs → three + attachments.** Is this the right split? | Yes, as proposed in §3.3. | It is the most visible change in the plan and the most expensive to reverse. |
| **D3** | **Who owns the top strip when something is live?** | One live-mode bar, bottom-anchored above the nav, one z-index. | `quiz-unification-spec.md` §4.5 adds a third banner. If that ships before this is decided, there will be three competing ones — and two overlays already tie at z-999 and two more at z-1000. |
| **D3b** | **Should `quiz_live` be a table at all, or broadcast + presence like `PresentationMode` already does?** | Genuinely open — but it must be *decided*, not defaulted into. The app is at four sync engines. | `quiz-unification-spec.md` §15 lists `quiz_live` under "Never cut", so this closes the moment that spec is built. If the table is right, the reason belongs in the spec. |
| **D3c** | **The two specs would cut opposite halves of the dual-mount pattern.** Which half is non-negotiable? | The pattern is. Cut the whole feature before cutting half the pattern. | Both cut lines are live right now (§3.4a). |
| **D4** | **Should the event page still be the centre of gravity?** | No — Events becomes one of four peers. The specs already assume it. | Phase 3 depends on it; so does how the quiz's Home tile is designed. |
| **D5** | **Admin PIN reset now, or wait for the auth rework (backlog #20)?** | Ship a temporary admin reset now. Someone will forget a PIN before the auth rework lands. | It is scaffolding either way; the question is whether to accept that. |
| **D6** | **Is backlog #31 (public multi-group) real?** | Treat as "not yet", per the backlog. Do the six §7 items because they help the friend group too — nothing more. | If it *is* real, the role model (§7.6) and the auth rework should be designed together, and D1 changes. |

---

## Appendix — the numbers

| Measure | Value |
|---|---|
| `src/App.jsx` | 7,872 lines |
| Inline `style={{…}}` objects | 1,546 |
| `fontSize` declarations / distinct values | 759 / ~50 |
| Most common font size | `.72rem` = 11.5px (63 uses) |
| Distinct `padding` values | 143 |
| Hardcoded numeric radii (vs 2 tokens) | 12 distinct, ~200 uses |
| Distinct z-index values | 15, incl. two exact collisions |
| `<Btn>` uses / of which `size="sm"` (≈27px) | 133 / 97 |
| Raw `<button>` bypassing `Btn` | 115 (Nav 23, QuizPresenter 20, QuizBuilder 17 — all three use `Btn` zero times or nearly) |
| Conventions for "small icon button" | 9 |
| Shared primitives shadowed by worse local copies | 2 (`TabBtn` @2833, `Switch`→`Toggle` @4755) |
| Raw `<select>` / `<div onClick>` / `<span onClick>` | 14 / 32 / 3 |
| `minHeight:44` in the whole file | 7 |
| Touch handlers in the whole codebase | 0 |
| `inputMode` declarations in App.jsx | 0 |
| Hand-rolled empty states / distinct treatments / with a CTA | 23 / 6 / **1** |
| Places that render an empty section silently | 11 (7 in Hall of Fame) |
| Destructive actions with no confirmation | 24 |
| `window.confirm` calls in App.jsx | 2 |
| Writes that check their error and roll back | **1** (`updateEvent`) |
| Fire-and-forget writes that fail silently | ~15 |
| Modals on the shared `Modal` / backdrop semantics among them | 10 / **3** |
| Accessible-modal implementations that aren't the shared one | 2 (`TeaserModal`, `Kit.jsx`) |
| Spinners anywhere | 0 |
| Live presenter→viewer sync engines | 4 |
| `@keyframes` in `GS` / gated by `prefers-reduced-motion` | 24 / 0 |
| `--muted` contrast on `--bg2` | 4.33:1 (fails AA) |
| `--border` contrast on `--bg2` | 1.19:1 (fails 1.4.11) |
| Global focus-ring contrast | 1.24:1 (fails 2.4.11) |
| Existing `AA_MUTED` contrast on `--bg2` | 7.49:1 (passes) — used in one component |
