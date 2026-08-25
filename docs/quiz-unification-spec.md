# Quiz Standalone & Team Unification — Technical Spec

> Owner: architect · Date: 2026-08-25 · Extends `docs/mensgames-spec.md`
> **Status:** ready to build. §14 lists decisions needing Dom; every one has a proposed default so nothing blocks.
> **Read first:** `docs/mensgames-spec.md` §2.1/§3.1 (`team_sets`), §3.2 (`tournaments`), §5.4 (source-parsing test rules).

**Stack reality (measured 2026-08-25):** Vite + React 18, plain JS, no Tailwind, Supabase anon-key-only. `src/App.jsx` = **7,772 lines**. Main chunk ≈713 kB. Quiz code = lines 2340–4620, **≈2,250 lines = 29% of App.jsx**.

---

## 1. Summary

The quiz stops being a JSONB blob inside an event and becomes a first-class tool with its own tables — reachable from the Home tile row *and* from an event, exactly like Mens-Games. It stops building its own teams and takes them from the team library like every other feature, so a quiz win lands as a `TeamAward` on the team's permanent record next to its tournament medals. And the live-quiz write path is rebuilt so a participant tapping an answer writes ~0.2 kB instead of rewriting a 39 kB event row.

**That last part is not a cleanup. It is a production bug fix.** At the last event the presenter worked and the participants' phones did not — "laggy, buggy, or didn't keep up at all" — and the group fell back to paper answer sheets. §2 shows why, with numbers.

---

## 2. Why this is urgent: the write path, measured

### 2.1 What happens today

The live event row is **39.3 kB, of which 33.4 kB is the `quizzes` field**. Every participant answer (`writeAnswer`, App.jsx:4210–4222) does:

```js
const {data:fresh} = await supabase.from("events").select("*").eq("id",…).single();  // 39.3 kB down
…merge…
await supabase.from("events").upsert([updated]);                                      // 39.3 kB up
onUpdate(updated);                                                                    // new identity → re-render
```

Each upsert fires `postgres_changes` on `events`. **Supabase realtime sends the entire new row**, not a column delta — so all ~16 connected clients receive all 39.3 kB, including the 33.4 kB of quiz content they already have. On top of that, both sides poll:

- `QuizParticipantView` (App.jsx:4188–4196): `select *` on the event **every 2 s, per phone**
- `QuizPresenter` (App.jsx:3490–3500): `select quizzes` **every 2 s** (33.4 kB)

### 2.2 The arithmetic (15 participants + 1 presenter, 40 questions, ~40 min)

| Traffic source | Today |
|---|---|
| Participant polling | 15 × 0.5/s × 39.3 kB = **295 kB/s sustained** ≈ 700 MB/night |
| Presenter polling | 0.5/s × 33.4 kB ≈ 40 MB/night |
| Answer round trips | 600 answers × 78.6 kB ≈ **47 MB** |
| Realtime fan-out of those writes | 600 × 39.3 kB × 16 subscribers ≈ **380 MB** |
| **Total** | **≈1 GB over one quiz, on bar wifi / 4G** |

…for what is semantically a few kilobytes of shared state. And every one of those payloads calls `onUpdate(data)` at App root, giving each phone a full `EventPage` re-render **every 2 seconds**. That is the observed failure exactly: not "sometimes wrong", but "didn't keep up".

It is also **self-worsening**: `quizzes` is the biggest field in the row, so a richer quiz makes every individual answer heavier.

### 2.3 What "move it to its own row" does and does not fix

Moving the quiz to a `quizzes` table shrinks the payload ~1.2× — the quiz *is* 85% of the row. **Not sufficient.** If an answer still rewrites the whole quiz row you have the identical shape at 33 kB, still broadcast in full, still read-modify-write.

| Problem | Fix |
|---|---|
| Broadcast carries 33 kB of static questions on every navigation | Live state lives in **its own narrow row**, no questions in it |
| 15 concurrent writers read-modify-write one blob (silent lost answers) | Answers get **one row each**, composite-PK upsert, **no read before write** |
| Every client polls the whole thing every 2 s | Realtime on two small tables + a slow safety poll |

### 2.4 What it becomes

| | Today | After |
|---|---|---|
| One answer: read | 39.3 kB | **0** |
| One answer: write | 39.3 kB | **≈0.2 kB** |
| Fan-out of that answer | 630 kB | ≈0.25 kB (presenter only) |
| Presenter navigation, fan-out | 630 kB | **16 kB** |
| Participant safety poll | 39.3 kB / 2 s | ≈1 kB / 5 s |
| Quiz definition transfer | 33.4 kB every 2 s | 33.4 kB **once**, re-fetched only on `rev` bump |
| **Night total** | **≈1 GB** | **≈9 MB** |

Roughly **100× less traffic, >99% less realtime fan-out.** Per-answer numbers are exact by construction; totals extrapolate from the two measured figures.

**Residual races (not zero):**
1. Two devices as the same team both answer → last write wins on that row. Correct anyway.
2. Presenter navigation vs presenter score-write — same writer, sequential.
3. Two admins presenting the same quiz → both write `quiz_live`. Mitigated by a `presenter_id` claim + banner (§4.4), not locking. Social problem, social fix.
4. **Nothing a participant does can damage an event row any more.**

---

## 3. Data model

Three new tables. The mensgames precedent (§2.2 there: "nothing ever queries a single match") **does not transfer** — it was written for one scorekeeper on one phone. The quiz has sixteen concurrent clients, and §2 is what happened when we treated it like a tournament.

### 3.1 `quizzes` — definition and archived result

| column | type | notes |
|---|---|---|
| `id` | text PK | existing `qz<epoch>`; migration preserves ids |
| `title` | text not null | |
| `event_id` | text null | **no FK**, same as `tournaments` |
| `status` | text not null default `'ready'` | `ready` \| `live` \| `finished` |
| `rounds` | jsonb not null default `'[]'` | the bulk. **Never read in the live loop.** |
| `default_time` | int not null default 30 | |
| `intro_text` / `intro_bg` | text not null default `''` | |
| `team_set_id` | text null | provenance → the library |
| `teams` | jsonb not null default `'[]'` | **snapshot** from the set (§5.2) |
| `participants` | jsonb not null default `'[]'` | `string[]` for individual quizzes (§6) |
| `scores` | jsonb not null default `'{}'` | **name-keyed**, as today |
| `member_scores` | jsonb not null default `'{}'` | **username-keyed**, as today |
| `settings` | jsonb not null default `'{}'` | `{ secret, published }` |
| `rev` | int not null default 1 | bumped on every definition save (§4.3) |
| `created_by` | text not null default `''` | |
| `created_at` / `updated_at` | timestamptz not null default `now()` | |
| `finished_at` | timestamptz null | |

`Round`/`Question` JSON shapes are **unchanged** from what `normalizeQuiz` produces. This is a relocation, not a redesign.

**Authorization intent:** RLS enabled, permissive `anon` policy — identical to every other table. Consistent with the accepted gap (§12); not security.

### 3.2 `quiz_live` — the hot, narrow, broadcast row

Exists **only while a quiz is live**. Deleted on End Session. **No questions, no answers.**

| column | type |
|---|---|
| `quiz_id` | text PK |
| `quiz_rev` | int not null |
| `event_id` | text null |
| `phase` | text not null (`intro`\|`round-intro`\|`question`\|`pause`\|`round-summary`\|`round-scores`\|`final`) |
| `round_idx` / `q_idx` | int not null default 0 |
| `slide_phase` | text not null default `'question'` |
| `scores` | jsonb not null default `'{}'` |
| `summary_revealed` | jsonb not null default `'[]'` |
| `pause_config` | jsonb not null default `'{}'` |
| `timer_started_at` | bigint null |
| `timer_limit` | int null |
| `is_team_quiz` | boolean not null default false |
| `presenter_id` | text not null default `''` |
| `updated_at` | timestamptz not null default `now()` |

**Row size ≈0.5–1 kB on the wire.** That is the point of this table.

### 3.3 `quiz_answers` — one row per answer

| column | type |
|---|---|
| `quiz_id` | text not null |
| `round_idx` / `q_idx` | int not null |
| `answer_key` | text not null — **stable id**, `t:<sourceTeamId>` or `p:<username lowercased>` |
| `value` | jsonb not null default `'[]'` |
| `updated_at` | timestamptz not null default `now()` |
| | **PK `(quiz_id, round_idx, q_idx, answer_key)`** — pure upsert, **no read-before-write, no lost updates** |

**Key change:** today the answer key is the *team name* — user-typed, mutable, non-unique. With library snapshots we have a stable `sourceTeamId`; use it in the hot path. Names remain the archive format in `quizzes.scores`, because `HallOfFame`, `WinnersTab` and `quizRound.js` all match on them. **Stable ids live, names in the archive.** The team-set picker must reject a set with duplicate team names (§5.2).

### 3.4 `TeamAward`, extended (additive, no migration)

```js
{ id:'aw_qz1724…_tm_3', teamId:'tm_…',
  label:'🥇 Pubquiz Editie 12 — 1e plaats', placement:1,
  sourceKind:'quiz'|'tournament',   // NEW
  sourceId:'qz1724…'|'trn_…',       // NEW
  tournamentId:'trn_…'|null,        // kept
  quizId:'qz1724…'|null,            // NEW
  eventId:'evt-2026'|null, note:'', awardedAt:'…' }
```

`HallOfFame`'s trophy cabinet renders any `TeamAward` by `label`, so **quiz medals appear with zero changes to that component.**

---

## 4. The live-quiz protocol

### 4.1 Who writes what

| Actor | Writes | Frequency | Payload |
|---|---|---|---|
| Builder | `quizzes` (full row, `rev`++) | on save | full |
| Presenter | `quiz_live` (narrow update) | ~120×/night | ≈1 kB |
| Presenter | `quizzes.scores`/`member_scores`/`status` | round end + finish | ≈1 kB |
| Presenter | `delete from quiz_answers where quiz_id=…` | End Session / reset | — |
| **Participant** | **`quiz_answers` — one row, upsert, no read** | per answer | **≈0.2 kB** |
| Participant | *nothing else, ever* | | |

That last line is the acceptance criterion for WP-Q4.

### 4.2 Who subscribes to what

| Client | Subscription | Safety poll |
|---|---|---|
| Participant | `quiz_live` UPDATE/DELETE, `filter: quiz_id=eq.<id>` | that row every **5 s** (≈1 kB) |
| Participant | own answer only, on question change | one shot + 3 s while unsubmitted |
| Presenter | `quiz_answers` INSERT/UPDATE, `filter: quiz_id=eq.<id>` | current slide's answers every **3 s** |
| App root | `quiz_live` INSERT/DELETE (no filter) | `select id,title,event_id from quizzes where status='live'` on the 30 s poll |

**Participants deliberately do not subscribe to `quiz_answers`.** Keeps inbound at ~1 kB/5 s *and* closes a real hole — today `_liveState.answers` ships **everyone's answers to every phone before the reveal**. Open devtools, read the network tab, win the quiz. That leak disappears as a side effect.

### 4.3 The `rev` counter

`quiz_live.quiz_rev` carries the `quizzes.rev` the presenter loaded. A participant fetches the definition once and refetches **only** when `quiz_rev` changes. Cost: one integer. Benefit: a mid-quiz typo fix doesn't leave fifteen phones on stale text, and nothing else re-transfers 33 kB.

### 4.4 Presenter claim

Upsert `quiz_live` with `presenter_id = <session id>`. A different `presenter_id` arriving shows a non-blocking amber *"Iemand anders presenteert deze quiz nu."* No locking, no takeover.

### 4.5 Discovery

Today `EventPage` finds a live quiz via `(evt.quizzes||[]).find(q=>q._liveState)` (App.jsx:2093). That dies with the column, and a standalone quiz has no event page.

`src/features/quiz/liveWatch.js`, **eager, ~60 lines**:

```js
export function useLiveQuizWatch()  // → { liveQuizzes: [{id,title,eventId}], error }
```

App root then renders a dismissible **"🔴 Quiz bezig — meedoen"** banner, and auto-opens the overlay when the user is already on the linked event's page (today's behaviour). The 470-line overlay itself stays **lazy**.

---

## 5. Teams: one concept, from the library

### 5.1 What gets deleted

| App.jsx | What |
|---|---|
| 2681–2682 | `teams`/`newTeamName` state |
| 2751–2757 | `addTeam()` |
| 3096–3101 | "Create Team" input + button |
| 3110–3173 | team cards: rename, avatar, add/remove member, captain toggle |

Captains are already writable in the Team Creator — the quiz's 👑 toggle is the *second* write site for one concept, which is the duplication this work removes.

### 5.2 What replaces it

`src/features/quiz/TeamSetPicker.jsx` (~80 lines), modelled on `mensgames/EntrantPicker.jsx`:

- lists `teamSets.filter(s => s.status === 'active')` — the `teamSets` prop **already reaches** `QuizDashboard` (App.jsx:2091) and `QuizBuilder` (2567), no new plumbing
- selecting one calls `teamsFromTeamSet(set)` → snapshot into `quiz.teams`, sets `quiz.teamSetId`
- read-only preview with a link to the Team Creator
- **"↻ Ververs uit bibliotheek"**, enabled only while `status === 'ready'`
- "Niet ingedeeld" strip for attendees in no team
- **rejects a set with non-unique team names** (`scores` is name-keyed) with an inline message

### 5.3 Snapshot, not live reference

1. **`scores` is keyed by team name.** A live reference means renaming "Team Alfa" silently orphans `scores["Team Alfa"]` in a finished quiz and the Hall of Fame quietly loses a result. Stronger than the tournament case, where standings are entrant-id-keyed.
2. Consistency with `entrantsFromTeamSet` — one rule for both features.
3. A finished quiz is a historical record.

**Downside:** a team renamed after build shows the stale name on the night. Mitigated by "Ververs", restricted to `status==='ready'` so it can never rewrite a live or finished quiz's keys. That restriction is what lets us skip score-remapping entirely.

---

## 6. Individual players

- **Mode is derived**, as today: `isTeamQuiz = teams.length > 0`. No new column to keep in sync.
- **Team quiz:** `scores` by team name; `member_scores` by username, distributed on finish — existing logic at App.jsx:2408–2412, moved verbatim.
- **Individual quiz:** `scores` by username; `member_scores = scores`.
- **Roster** comes from the new `participants` column. Default seed: linked event's attendees with `went`/`going`; standalone → active-role users. This also fixes a live bug — today the presenter seeds from *all* attendees including no-shows (App.jsx:3292).

| Surface | Source | Change |
|---|---|---|
| Quiz leaderboard (per person) | `member_scores`, summed | **Was `scores` (App.jsx:1025) — a bug: a team quiz puts "Team Alfa" on the individual leaderboard as if it were a lad.** Switching fixes it. |
| Team trophy cabinet | `team_sets[].awards` | **None** — quiz medals render free |
| Winners tab | `events.winners` from `finishQuiz` | §7.4 |

A team wins → the *team* gets the medal, each *member* still banks his points. Both, from one write.

---

## 7. Results become achievements

### 7.1 Extract the shared core

`finishTournament.js` is 250 lines of reviewed, tested write-back logic. **Generalise, don't copy.**

New `src/features/awards/publishResults.js`:

```js
/** @typedef {{ rank:number, name:string, kind:'team'|'player',
 *   memberNames:string[], teamSetId:string|null, sourceTeamId:string|null,
 *   detail:string }} Placement */

export function winnerRowsFromPlacements(source, placements)  // prefix 'mg'|'qz'
export function buildTeamAwards(source, placements, teamSets, { now })
export async function publishResults({ source, placements, event, onUpdateEvent,
                                       teamSets, archiveWinningSets, now })
```

Everything carries over unchanged: the fresh-read-before-write in `pushWinnersToEvent`, the sequential `latestById` chaining so two medals from one set don't clobber each other, deterministic award ids, per-write error collection.

`finishTournament.js` keeps **its exact signature** and becomes a thin adapter.

**Acceptance criterion for this package: `finishTournament.test.js` and `TournamentEditor.secret.test.jsx` pass with zero edits.** If they need edits, the extraction wasn't behaviour-preserving.

### 7.2 The quiz adapter

`src/features/quiz/finishQuiz.js`:

```js
export function quizPlacements(quiz)   // team → kind:'team' w/ provenance; individual → kind:'player'
                                       // ties share a rank; top 3
export async function finishQuiz({ quiz, event, onUpdateEvent, teamSets,
                                   archiveWinningSets = false, now = Date.now() })
// 1. compute final scores + member_scores
// 2. quizzes: status='finished', scores, member_scores, finished_at
// 3. delete quiz_live row + all quiz_answers
// 4. secret → { deferred:true }, publish nothing; else publishResults(…)
```

### 7.3 Secret quizzes

Tournaments recently learned to defer publishing when secret, because `events.winners` and `team_sets.awards` are both member-visible and spoil the reveal the instant "Afronden" is clicked. **Identical for a quiz.** Same two-step, same separate `revealError`, same optional notification.

Not to be confused with the quiz's **existing** per-round `secret` flag (App.jsx:2849–2853), which only hides a round title. Keep both; label the new one *"🤫 Geheime quiz — resultaten pas zichtbaar na onthullen"*.

### 7.4 The derived quiz-winner card

`WinnersTab` derives an "AUTO" card per finished quiz (App.jsx:5014–5022). Once `finishQuiz` writes real `qz-…` rows, that double-renders.

**Don't delete it, don't migrate old quizzes.** Filter it with `isQuizAlreadyPublished(quiz, winners)` from `features/quiz/results.js` — a prefix match on `qz-<quiz.id>-`, the same prefix `pushWinnersToEvent` already dedupes on.

*Corrected 2026-08-26.* This section originally proposed:

```js
/^qz-(.+?)-\d+$/          // wrong
```

That assumes the id's trailing segment is digits. It isn't: `winnerRowsFromPlacements` puts the `slot` there, which is a team's `sourceTeamId` (`tm_3`) or a slugified player name (`solo-sven`). The regex silently fails to match the common real cases, which defeats the dedup it exists for — the double-rendered card this section is about would have kept double-rendering. Caught by a test written against both versions.

Legacy quizzes keep their auto card; new ones get a real, editable award row.

---

## 8. Where the code lives

### 8.1 `src/features/quiz/` — lazy

```
QuizPage.jsx / QuizTabMount.jsx / QuizLiveOverlay.jsx   lazy entries
QuizShell.jsx        scope="page"|"event"  ← mirrors MensGamesShell
QuizDashboard.jsx    from App.jsx 2378-2585
QuizBuilder.jsx      2661-3196, minus §5.1
TeamSetPicker.jsx    new, §5.2
QuizPresenter.jsx    3277-4151
MusicPlayer.jsx      3199-3275
QuizParticipantView.jsx  4153-4620
model.js   normalizeQuiz, TEAM_AVATARS, teamsFromTeamSet, ALPHA, TYPE_META…
urls.js    getYouTubeId, getSpotifyTrackId, isYouTubeUrl, isSpotifyUrl
api.js / live.js / answers.js / finishQuiz.js / users.js
ui/Kit.jsx      re-exports ../mensgames/ui/Kit.jsx + Avatar, Divider
ui/styles.jsx
```

**Eager, tiny** (the `teamlib` reasoning — non-lazy consumers):

```
results.js    fetchQuizResults()  — column projection, NO rounds
liveWatch.js  useLiveQuizWatch()  — §4.5
```

`fetchQuizResults()` must project columns, never `select *`: ~1 kB per quiz instead of ~33 kB.

### 8.2 Bundle

The single biggest lazy-loading opportunity left: ~2,250 lines ≈ 90–110 kB raw. Main chunk **713 kB → ~610 kB (−14%)**, plus ~3 kB eager. **Zero new dependencies.**

### 8.3 App.jsx changes

**Deleted (moved out):** ≈2,250 lines. App.jsx ends at ≈5,540.

**Moved out and re-exported (changes the §5.4 protected list):** `getYouTubeId`, `getSpotifyTrackId`, `isSpotifyUrl`, `isYouTubeUrl`, `TEAM_AVATARS`, `normalizeQuiz`. `SEL_STYLE`/`ICON_BTN` are quiz-only too (grep-verified).

| # | Site | Change |
|---|---|---|
| 1 | `computeMemberStats` (285) | → `(username, events, quizResults=[])`. **Protected — change the body, don't move it.** |
| 2 | `HallOfFame` (999) | new `quizResults` prop; leaderboard reads `member_scores` (§6) |
| 3 | `EventPage` (1850) | thread props; drop `quizDash` state |
| 4 | Quiz tab (~2050) | `<Suspense><QuizTabMount …/></Suspense>` |
| 5–6 | 2091, 2093 | delete inline dashboard mount and live-quiz finder |
| 7 | `WinnersTab` (5008) | new prop; §7.4 filter |
| 8 | `diffEvents` (6291–6295) | delete quiz-notification block; feature calls `onSendNotif` on create. **Tradeoff:** fires from the creator's client only — but stops today's duplicate notifications |
| 9 | App root | `quizResults` state, boot + poll fetch, `useLiveQuizWatch()`, `openQuiz()`, Nav + Home entries |
| 10–11 | render | `pageView==="quiz"`; live banner + overlay |

**Additions ≈35 lines. `TABS` unchanged.**

### 8.4 One cross-feature change

`mensgames/RoundEditor.jsx:102` reads `selectedEvent.quizzes` → repoint to a `quizResults` prop. `quizRound.js:63` `pullQuizResults(round, event)` → `(round, quiz)`. `matchQuizNames` untouched.

---

## 9. What breaks in the tests

`mensgames-spec` §5.4 rules **1, 3, 4, 5 hold unchanged**. The smoke mock returns `{data:[],error:null}` for unknown tables and `makeChannel()` already covers the new subscriptions — **no mock changes**.

**Rule 2 changes.** Six protected declarations leave App.jsx — deliberately, and it's an improvement: they become real exports on a real module, and tests import them instead of eval'ing sliced source. The extractor fails loudly, never silently.

**Protected list becomes:** `Card`, `Modal`, `H`, `Lbl`, `Inp`, `hasAdmin`, `hasOrg`, `getUA`, `getDisplayName`, `computeMemberStats`, `formatEventDateRange`, `eventDayCount`, `dateForEventDay`, `dayHeadingLabel`, `scheduleDayTimeOrder`, `padTimeForSort`. **Update `mensgames-spec` §5.4 in the same PR.**

| File | Action |
|---|---|
| `helpers.pure.test.js` | **Must change.** URL helpers and `normalizeQuiz` → real imports; `computeMemberStats` fixtures pass a third arg. Keep every assertion identical. |
| `mensgames/quizRound.test.js` | **Must change.** 7 `pullQuizResults` cases pass a quiz object. |
| `mensgames/finishTournament.test.js` | **Must NOT change** — acceptance criterion for Q1. |
| `mensgames/TournamentEditor.secret.test.jsx` | **Must NOT change.** |
| `hallOfFame.integration.test.jsx` | Verify no assertion depends on the quiz board; if one does, feed via the mock. |
| `App.bootFailure.test.jsx`, `App.teamSetsError.test.jsx` | `fetchQuizResults()` **must never reject** — return `{ok:false,error,quizResults:[]}` like `fetchTeamSets`. Add `App.quizResultsError.test.jsx`. |
| 12 other files | **No change** — all slice by marker text, markers live outside 2340–4620 (grep-verified). |

**New tests** (pure JS, no source parsing): `quiz/model.test.js`, `urls.test.js`, `api/live/answers.test.js`, `finishQuiz.test.js`, `awards/publishResults.test.js`, plus one jsdom test asserting **the participant view issues no write other than `quiz_answers`** — the guard rail for §2's whole thesis.

---

## 10. Migration SQL

Idempotent. Safe to run **before** deploying; the old build keeps working because `events.quizzes` isn't touched.

### 10.1 Tables

```sql
create table if not exists public.quizzes (
  id text primary key,
  title text not null,
  event_id text,
  status text not null default 'ready',
  rounds jsonb not null default '[]'::jsonb,
  default_time int not null default 30,
  intro_text text not null default '',
  intro_bg text not null default '',
  team_set_id text,
  teams jsonb not null default '[]'::jsonb,
  participants jsonb not null default '[]'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  member_scores jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  rev int not null default 1,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists quizzes_event_idx  on public.quizzes (event_id);
create index if not exists quizzes_status_idx on public.quizzes (status);

create table if not exists public.quiz_live (
  quiz_id text primary key,
  quiz_rev int not null default 1,
  event_id text,
  phase text not null default 'intro',
  round_idx int not null default 0,
  q_idx int not null default 0,
  slide_phase text not null default 'question',
  scores jsonb not null default '{}'::jsonb,
  summary_revealed jsonb not null default '[]'::jsonb,
  pause_config jsonb not null default '{}'::jsonb,
  timer_started_at bigint,
  timer_limit int,
  is_team_quiz boolean not null default false,
  presenter_id text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_answers (
  quiz_id text not null,
  round_idx int not null,
  q_idx int not null,
  answer_key text not null,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (quiz_id, round_idx, q_idx, answer_key)
);
create index if not exists quiz_answers_slide_idx
  on public.quiz_answers (quiz_id, round_idx, q_idx);

alter table public.quizzes      enable row level security;
alter table public.quiz_live    enable row level security;
alter table public.quiz_answers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quizzes' and policyname='quizzes anon full access')
  then create policy "quizzes anon full access" on public.quizzes for all to anon using (true) with check (true); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quiz_live' and policyname='quiz_live anon full access')
  then create policy "quiz_live anon full access" on public.quiz_live for all to anon using (true) with check (true); end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='quiz_answers' and policyname='quiz_answers anon full access')
  then create policy "quiz_answers anon full access" on public.quiz_answers for all to anon using (true) with check (true); end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['quiz_live','quiz_answers','quizzes'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname='supabase_realtime' and schemaname='public' and tablename=t)
    then execute format('alter publication supabase_realtime add table public.%I', t); end if;
  end loop;
end $$;
```

### 10.2 Migrate `events.quizzes` → rows

```sql
insert into public.quizzes
  (id, title, event_id, status, rounds, default_time, intro_text, intro_bg,
   teams, scores, member_scores, settings, rev, created_at, finished_at)
select
  q->>'id',
  coalesce(nullif(q->>'title',''), 'Naamloze quiz'),
  e.id,
  case when q->>'status' in ('ready','live','finished') then q->>'status' else 'ready' end,
  case when q ? 'rounds' and jsonb_typeof(q->'rounds')='array' then q->'rounds'
       else jsonb_build_array(jsonb_build_object(
              'id','r0','title','Round 1','theme','','icon','🎯',
              'description','','bgImage',null,'secret',false,
              'questions', coalesce(q->'questions','[]'::jsonb)))
  end,
  coalesce(nullif(q->>'defaultTime','')::int, 30),
  coalesce(q->>'introText',''),
  coalesce(q->>'introBg',''),
  coalesce(q->'teams','[]'::jsonb),
  coalesce(q->'scores','{}'::jsonb),
  coalesce(q->'memberScores','{}'::jsonb),
  '{}'::jsonb, 1,
  coalesce(e.created_at, now()),
  case when q->>'status'='finished' then coalesce(e.created_at, now()) else null end
from public.events e,
     lateral jsonb_array_elements(coalesce(e.quizzes,'[]'::jsonb)) q
where q->>'id' is not null
on conflict (id) do nothing;
```

Deliberately **not** migrated: `_liveState` (a stale live state must not resurrect) and `team_set_id` (legacy quizzes have no library provenance; reverse-matching names would be guessing).

### 10.3 Verification — run all four

```sql
select (select count(*) from public.quizzes) as migrated,
       (select coalesce(sum(jsonb_array_length(coalesce(quizzes,'[]'::jsonb))),0) from public.events) as legacy;

select e.id, q->>'id', q->>'title'
from public.events e, lateral jsonb_array_elements(coalesce(e.quizzes,'[]'::jsonb)) q
where q->>'id' is not null and not exists (select 1 from public.quizzes z where z.id = q->>'id');

select z.id, z.title, z.status, jsonb_array_length(z.rounds) as rounds,
       (select coalesce(sum(jsonb_array_length(coalesce(r->'questions','[]'::jsonb))),0)
          from jsonb_array_elements(z.rounds) r) as questions,
       jsonb_array_length(z.teams) as teams
from public.quizzes z order by z.created_at;

select id, title from public.quizzes where status = 'live';
```

Queries 2 and 4 must return **zero rows**. If 4 returns rows: `update public.quizzes set status='ready' where status='live';`

### 10.4 Drop the legacy column — **one release later, not before the next event**

```sql
alter table public.events drop column quizzes;
```

Keeping it is what makes a Vercel rollback a real rollback (§13).

---

## 11. Work packages

| WP | Scope | Deps |
|---|---|---|
| **Q0** | Dom runs §10.1 + §10.2 + §10.3 | blocks Q2, Q4, Q7 |
| **Q1** | `awards/publishResults.js` extraction + adapter. Pure JS. **Start now.** | **[P]** |
| **Q2** | `quiz/api.js`, `live.js`, `answers.js`, `results.js`, `liveWatch.js`, `model.js`, `urls.js` | **[P]** |
| **Q3** | **The mechanical move.** 2,250 lines out, still reading `evt.quizzes` via a shim. **Zero behaviour change. Own commit. Nothing else in it.** | **[P]** |
| **Q4** | Rewire presenter + participant onto `quiz_live`/`quiz_answers`. **Highest risk. One developer.** | [D:Q2,Q3] |
| **Q5** | `TeamSetPicker`; delete inline builder | [D:Q3] |
| **Q6** | `finishQuiz.js` + secret reveal | [D:Q1,Q2] |
| **Q7** | `QuizShell` dual mount; Nav + Home | [D:Q3] |
| **Q8** | App.jsx rewiring (§8.3) | [D:Q3,Q7] |
| **Q9** | HallOfFame / WinnersTab / computeMemberStats | [D:Q2,Q8] |
| **Q10** | mensgames repoint (§8.4) | [D:Q2] |
| **Q11** | Test updates + new tests (§9) | [D:Q3,Q4,Q8] |
| **Q12** | Dress rehearsal (§13) | [D: all] |

Q1, Q2, Q3 are independent and are most of the work. **Q3 and Q8 both touch App.jsx — sequence them.**

---

## 12. Security & trust model

**Auth unchanged and not addressed.** No server-side authorization anywhere; any visitor can read and write any row. Known, owner-accepted, out of scope. This spec neither worsens nor fixes it.

| Category | Status |
|---|---|
| Secrets | **N/A** — no new keys, env vars, third-party calls |
| Broken access control | **KNOWN GAP.** RLS enabled with permissive anon policy, matching every other table. `can.hostQuiz` is UX, not security. **One genuine improvement:** answers are no longer broadcast to every participant before the reveal (§4.2) |
| Authentication | `answer_key` moves from a mutable name to a stable id, removing a name-collision impersonation path |
| Injection | **ADDRESSED + one gap closed.** No `dangerouslySetInnerHTML`; all text renders as nodes. **New requirement:** `round.bgImage`, `question.image`, `pauseConfig.image` are user-typed URLs rendered into `<img src>` **with no validation today** — wrap all three in `isSafeImageUrl` during the move. Indices/points parse to finite ints and clamp |
| Don't trust the client | N/A in effect — no server to re-check against |
| Misconfiguration | RLS enabled on all three, realtime added idempotently, migration additive until §10.4 |
| Supply chain | **Zero new dependencies** |
| Observability | `updated_at` on all three; `rev` versions definitions; deletes get typed confirms |

**Trust boundary:** score keys, team names, image/music URLs and `quiz_answers.value` are all **data, never identity or markup**. Answer values are parsed as an int array and clamped to the current question's option count — a hand-crafted `[999]` must score zero, not throw. Answers for a slide that isn't the presenter's current one are ignored, so a client cannot pre-answer.

---

## 13. Shipping this before the event

The feature currently **does not work**, so the downside case is "it still doesn't work and we use paper", which is where we already are. But sequencing must be deliberate.

1. **Run §10.1–§10.3 today.** Purely additive; the current build is unaffected.
2. **Q1 + Q2 + Q3 first, merged separately.** Q3 must be a pure move verified by click-through: build a quiz, present it, answer from a second device, finish it.
3. **Freeze 5 days before the event.** Anything unmerged becomes a cut line. No exceptions.
4. **Dress rehearsal is not optional (Q12).** One laptop presenting plus **four real phones on mobile data, not the house wifi**, through a 10-question quiz with a music round and a pause. Watch Supabase's realtime and egress panels. This is the only test that reproduces what broke it, and it is the acceptance gate.
5. **Rollback is a Vercel instant rollback**, and it works completely *because `events.quizzes` still exists*. Don't drop it until a release after a successful event.
6. **Keep the paper fallback printed.** Not pessimism — having it in the bag is what lets you actually try the new thing.

---

## 14. Decisions needing Dom — with defaults

1. **Top-level quiz page, or event tab only?** *Default: both, like Mens-Games.* Cutting it halves the App.jsx diff.
2. **Should a live quiz reach people not on the event page?** *Default: a dismissible app-wide banner, auto-opening only on the linked event page.*
3. **Team-avatar picker for participants — keep or drop?** *Default: drop.* The library sets avatars now, and dropping it removes the last non-answer participant write.
4. **Secret quizzes wanted?** ~20 lines once §7.1 is done. *Default: implement.*
5. **Individual-quiz roster.** *Default: seeded from `went`/`going` attendees, editable.*
6. **Who may present?** *Default: unchanged (org/admin).* Mens-games has the same open question — answer both at once.
7. **Retroactively link old quizzes to team sets?** *Default: no.*
8. **Language.** *Default: existing quiz copy stays English, new strings Dutch.* Mixed and slightly ugly — flag if it bothers him.
9. **Archive the winning team set on finish?** *Default: manual tick, off — same as tournaments.*

---

## 15. Cut lines

1. Secret quizzes
2. `rev`-based definition refresh (keep the column)
3. Presenter claim banner
4. "↻ Ververs uit bibliotheek"
5. `participants` roster picker
6. The top-level quiz page
7. `HallOfFame` `member_scores` fix (pre-existing bug, can wait)
8. App-wide live-quiz banner

**Never cut, in priority order:**

1. **`quiz_answers` as its own table with no read-before-write.** This is the fix; everything else is scaffolding.
2. **`quiz_live` separate from `quizzes`.** Without it, realtime still broadcasts 33 kB per slide and you've shipped a cosmetic refactor of a broken feature.
3. The §10 SQL and its verification.
4. The `publishResults` extraction — duplicating 250 lines gives two award systems to keep in sync forever.
5. The dress rehearsal.

---

## 16. Key tradeoffs

| Decision | Rejected | Why | Downside |
|---|---|---|---|
| Three tables | One row with `live_state` + `answers` JSONB | Realtime broadcasts the whole row; questions beside live state = 33 kB per slide to every phone | Three tables, two more mapping boundaries, reads as over-built until you know §2 |
| Composite-PK upsert | Read-modify-write | Eliminates lost updates structurally | No single object to read "the answers"; presenter aggregates ~15 rows |
| Stable ids live, names archived | Names everywhere | Names are user-typed, mutable, non-unique | Two identifier spaces |
| Snapshot teams | Live reference | `scores` is name-keyed — a rename orphans results | Stale name on the night; needs "Ververs" |
| Extract `publishResults` | Parallel `finishQuiz` write-back | One award system, one set of rules | Refactoring live code before an event — gated by "existing tests unedited" |
| Move the six declarations | Leave or duplicate | Leaving makes them unused; duplicating makes two sources of truth | Two test files change |
| Keep + filter the derived card | Delete, or migrate | Three lines, zero migration | Two similar-looking card paths for a while |
| Participants don't subscribe to answers | Subscribe with a filter | ~1 kB/5 s inbound, and closes the pre-reveal leak | Teammate answers appear via poll, not instantly |
| Quiz keeps its visual language | Restyle onto the mensgames Kit | This is a move of 2,250 working lines; restyling loses the ability to say "nothing changed" | Two design idioms |
| Eager `results.js` projection | Full rows at boot | `select *` is ~33 kB each | Two representations of a quiz |
| Zero dependencies | zod, a state library | 713 kB already; hand-rolled guards work | Hand-written defensive parsing |

**Bundle:** main **−~100 kB**, quiz chunk ~90–110 kB on demand. Largest single win in the codebase.

---

## 17. Risks

1. **Highest-stakes subsystem, runs live, once.** Mitigations that matter: Q3 as a pure move in its own commit; Q4 owned by one developer; the rehearsal on real phones on mobile data; printed paper fallback; Vercel rollback staying real until `events.quizzes` is dropped.
2. **Q3 is 2,250 lines and diffs are useless at that size.** Make it a *literal* move — no reformatting, no renames, no drive-by fixes. Verify by behaviour, not by reading.
3. **Realtime may not deliver the predicted win.** If it silently fails, the safety polls carry everything at 1 kB/5 s — still 300× lighter, degrading to "slightly slow" rather than "dead". Verify at the rehearsal that a phone with realtime blocked still follows.
4. **The extraction touches live tournament code** three weeks after it shipped. Two tests passing unedited is a real gate but not proof — run one throwaway tournament end to end.
5. **Two features now write `team_sets.awards`.** Protected within one publish, not across a quiz finish and a tournament finish in the same second. Rare enough that the fix is "don't do that".
6. **Answer-key drift** if a set is edited between snapshot and the night. The `ready`-only refresh restriction is what makes this safe — don't relax it.
7. **The migration runs while the old build is live.** Re-run §10.2 (idempotent) immediately before deploying and check query 2 returns zero.
8. **Scope creep.** This spec fixes exactly three rough edges because they're one-liners on the path: image URL validation, no-shows in the roster, team names on the individual leaderboard. Everything else waits.

---

## 18. Out of scope

Server-side auth; Supabase Auth; RLS hardening; TypeScript/Tailwind; App.jsx decomposition beyond `src/features/quiz/`; any change to question types, scoring rules, slide design, music, or the pause screen; results export; per-question analytics; auto-grading open answers; cross-device presenter handover; a knockout view; retroactively linking legacy quizzes; dropping `events.quizzes`; i18n.
