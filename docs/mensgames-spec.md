# Mens-Games & Team Library — Technical Spec

> Owner: architect · Date: 2026-08-21 · Backlog #8, #9, #10, #11–#15, #16
> **Status:** ready to build. §13 lists open questions for Dom — defaults are proposed for all of them.

**Stack reality:** Vite + React 18, **plain JS**, no Tailwind (inline styles + CSS custom properties from `GS`), Supabase anon-key-only, `src/App.jsx` ≈ 6,668 lines, vitest (272 tests), eslint. Main chunk 678 kB.

---

## 1. Summary

Two coupled features. **The team library** promotes team sets from a JSONB blob on an `events` row into first-class records with their own purpose, captains, reusability across events, deletion, and an *archive* state that keeps decorated teams out of the working list while preserving their trophies. **Mens-games** is a tournament builder on top of it: an admin creates a tournament, adds freely-editable rounds (table football, pool, a quiz, or anything typed by hand), picks which team set plays each round, chooses a scoring type from a pluggable registry, scores matches live with a timer and scoreboard, and every round awards configurable points that roll up into one standings table. Finishing a tournament decorates the winning teams and drops an award onto the event, where the existing Winners tab and Hall of Fame already display it.

---

## 2. Storage decisions — read before anything else

### 2.1 Team library → **new `team_sets` table.** Rejected: JSONB + `global` flag.

A JSONB array on `events` cannot express "not owned by any event". A `global: true` flag still needs an arbitrary host row to live on — delete that event and the library dies; every reader still scans all events; and two features writing team sets race on the same fat `events` row (`updateEvent` upserts the **entire** row). The requirement is literally "exists independently, referenced from anywhere". That is a table.

**Link direction is `team_sets.event_ids text[]`, not `events.team_set_ids`.** A set can be used at several events (reuse is the point); linking is then a one-row write to a small table instead of a full-row upsert of a 100 kB event; and one `select *` loads the whole library.

### 2.2 Tournaments → **new `tournaments` table, one row each, round/match tree in JSONB.** Rejected: JSONB on `events`; rejected: normalised tables.

- **Not on `events`:** live scoring writes every few seconds, and each write re-upserts the whole event row — a scorekeeper at the pool table would silently clobber an RSVP or a photo posted five seconds earlier. A tournament also need not belong to an event.
- **Not normalised:** nothing ever queries a single match; every screen loads the whole tournament; the app's entire idiom is "edit an object in state, upsert the row". Three tables buy nothing and cost joins, ordering columns and cascades. One row also means Postgres realtime gives every viewer a live scoreboard free — the pattern `EventPage` already uses.
- `event_id` is **nullable with no FK** (events.id is app-generated text). Orphans are tolerated and filtered client-side.

### 2.3 Code location → **`src/features/mensgames/` (lazy) + `src/features/teamlib/` (eager, tiny)**

Follows the `src/features/trailer/` precedent, which proved it: App.jsx gained ~30 lines, no existing line moved, and the feature carried its own styles. Mens-games is lazy — it must not add to the 678 kB main chunk. `teamlib` is ~150 lines of pure data functions imported eagerly, exactly like `safeUrl.js`/`seen.js` today.

---

## 3. Data model

### 3.1 `team_sets` (new table)

| column | type | notes |
|---|---|---|
| `id` | text PK | client-generated, existing `ts_<epoch>` format |
| `name` | text not null | "Groep A" |
| `category` | text default `''` | the "purpose" field. **Keeping the name `category`** — the UI placeholder already reads "Categorie / doel" |
| `teams` | jsonb not null default `'[]'` | `Team[]` |
| `event_ids` | text[] not null default `'{}'` | events this set is attached to |
| `status` | text not null default `'active'` | `'active'` \| `'archived'` |
| `awards` | jsonb not null default `'[]'` | `TeamAward[]` — the awards archive (#10) |
| `created_by` | text default `''` | |
| `created_at` | timestamptz not null default `now()` | |
| `archived_at` | timestamptz null | |

```js
// Team — today's shape plus `captain` (#8), which the quiz already READS
// (App.jsx:2737-2757, 3757) but the Team Creator never writes.
{ id:'tm_1724…_0', name:'Team 1', avatar:'🦁', members:['Doom','Bram'], captain:'Doom'|null }

// TeamAward — one decoration earned by one team inside a set
{ id:'aw_1724…', teamId:'tm_…', label:'🏆 Mens-Games 2026 — winnaar',
  placement:1, tournamentId:'trn_…', eventId:'evt-2026'|null,
  note:'', awardedAt:'2026-09-12T20:11:00Z' }
```

**Authorization intent:** RLS **enabled**, single permissive `anon` policy (read + write), identical to `events`/`users` today. This is not "secure" — it is *consistent with the accepted, documented gap* (§7). A stricter policy would break the app without adding real protection, because there is no server-side identity.

### 3.2 `tournaments` (new table)

| column | type | notes |
|---|---|---|
| `id` | text PK | `trn_<epoch>` |
| `name` | text not null | |
| `event_id` | text null | no FK, see §2.2 |
| `status` | text not null default `'draft'` | `'draft'` \| `'live'` \| `'finished'` |
| `entrants` | jsonb not null default `'[]'` | `Entrant[]` |
| `rounds` | jsonb not null default `'[]'` | `Round[]` |
| `settings` | jsonb not null default `'{}'` | `{ showLivePreview, tieBreak }` |
| `team_set_id` | text null | default entrant source |
| `created_by` | text default `''` | |
| `created_at` / `updated_at` | timestamptz not null default `now()` | |

```js
Entrant = {
  id:'ent_1', kind:'team'|'player',
  name:'De Kraaien', avatar:'🦅',
  memberNames:['Doom','Tim'],       // [] for kind:'player'
  teamSetId:'ts_…'|null,            // provenance, for the awards archive
  sourceTeamId:'tm_…'|null,
}

Round = {
  id:'rnd_1', name:'Ronde 1 — Tafelvoetbal', icon:'⚽', notes:'',
  entrantIds:['ent_1','ent_2'],     // subset playing this round
  teamSetId:'ts_…'|null,            // OPTIONAL per-round override (§4.2)
  scoring:{ typeId:'best-of', config:{ sets:3 } },
  format:'matches'|'freeform'|'quiz',
  matches:Match[],                  // [] when format !== 'matches'
  freeform:{ entries:{ [entrantId]:{ value:0, note:'' } } },
  source:null|{                     // format:'quiz' (§4.4)
    type:'quiz', eventId:'evt-2026', quizId:'q1',
    nameMap:{ 'Team Alfa':'ent_1' },
    pulledAt:'…', raw:{ 'Doom':300 }   // FROZEN snapshot of quiz.scores
  },
  timer:{ seconds:600, perMatch:true },
  award:{ mode:'placement'|'perWin'|'raw',
          table:[10,6,3,1],         // placement — index 0 = 1st
          perWin:3, perDraw:1,
          rawFactor:1 },
  status:'pending'|'live'|'done',
  results:null|{                    // written by "Lock round", never recomputed
    ranking:[{ entrantId, rank, value, label }],
    points:{ [entrantId]:10 },
    lockedAt:'…'
  }
}

Match = {
  id:'mt_1', aId:'ent_1', bId:'ent_2'|null,   // null bId = bye
  entry:{ a:{…}, b:{…} },           // shape owned by the scoring plugin
  winnerId:null|'ent_1'|'draw',
  status:'pending'|'live'|'done',
  startedAt:null, endedAt:null, note:'',
  bracket:null|{ depth:0, slot:0, feedsMatchId:'mt_9', feedsSlot:'a' }  // phase 2
}
```

**Why `results` is persisted, not derived:** standings must not silently change when someone edits an old round's config six months later, and the Hall of Fame needs a stable record. Locking freezes ranking and points. Unlocking is explicit and confirmed.

---

## 4. Mens-games design decisions

### 4.1 Format: **flexible rounds first, bracket second**

Dom asked for both "a bracket or visual overview" *and* "let me edit it flexibly". Those conflict: a bracket imposes seeding, advancement, byes and a fixed entrant count; flexibility means "add a round called Bierpong with three teams and a scoring rule I made up".

**Ship first:** a tournament is an ordered list of rounds; each round holds matches. Matches can be **hand-added**, **auto round-robin** (`generateRoundRobin`, ~15 lines), or **random pairs**. The "visual overview" for v1 is the standings table + per-round match grid + per-round scoreboard. That covers 100% of "table football, pool, a quiz round, or manually provided" with no format constraints.

**Ship second (phase 2):** `BracketView.jsx` — single elimination is *the same match list* plus the `bracket` field and one advancement rule. A visualisation and an auto-fill, not a different data model.

**Not building:** double elimination, group→knockout, seeding algorithms, swiss.

### 4.2 How a round references a team set

The tournament has one default source: `team_set_id` → `entrantsFromTeamSet()` materialises `entrants` **by copy, once**. Snapshotted deliberately: renaming a team in the library next month must not rewrite the history of a finished tournament. Provenance (`teamSetId`, `sourceTeamId`) is kept so awards find their way home.

A round may override with its own `teamSetId`. Selecting it appends any *new* teams to `tournament.entrants` (deduped by `sourceTeamId`). Standings therefore handle entrants who played some rounds and not others — `played` is tracked per entrant; unplayed rounds contribute 0.

A round can also use individual players (`kind:'player'`, seeded from `evt.attendees`) — needed for pool and darts.

### 4.3 Scoring types are a **registry**, not an enum

`src/features/mensgames/scoring/index.js` exports an object keyed by id. Adding a type = one file and one line.

```js
{
  id:'best-of', label:'Best of X', icon:'🏓',
  appliesTo:['matches'],
  configFields:[{ key:'sets', label:'Best of', type:'number', default:3, min:1, max:15 }],
  blankEntry:(config)=>({ sets:0 }),
  entryFields:(config)=>[{ key:'sets', label:'Sets', type:'stepper', min:0, max:config.sets }],
  validate:(entry,config)=> null|'Meer sets dan mogelijk',
  resolve:(match,config)=>({ winnerId, complete, label:'2–1' }),
  rank:(round,config)=>[{ entrantId, rank, value, label }],
}
```

**Ship with seven:** `manual` (admin picks the winner; also the **fallback for unknown ids**), `simple-points`, `best-of`, `first-to`, `race-time` (lower wins), `goal-diff`, `quiz-linked`.

**Forward compatibility is a hard requirement:** `getScoringType` falling back to `manual` means a tournament saved with a future scoring type still opens on an older client — degrading to "pick the winner by hand" with an amber "Onbekend scoretype" chip, rather than a white screen.

**The pluggability that matters most is `award`, not `scoring`.** Plugins produce a *ranking within a round*; `round.award` converts that ranking into tournament points. That decoupling is what lets Dom invent a scoring system without touching standings code — and what stops a 300-point quiz swamping a best-of-3 pool round.

### 4.4 The quiz plugs in as a round type — consumed, never rebuilt

`format:'quiz'` renders no match editor: an event+quiz picker (reading `evt.quizzes` where `status==='finished'`), a "Haal resultaten op" button, and the ranking.

Matching is case-insensitive exact match of the quiz's score key against `entrant.name`. Unmatched names get a dropdown persisted in `source.nameMap` — **nothing is guessed**. The pull **snapshots** into `source.raw`, so later quiz edits can't retroactively change standings.

**No change to any quiz code.** The only quiz-adjacent edit in this entire spec is one prop value (§5.2 row 4).

### 4.5 Round timers — **do not touch `TimerPage`**

Extracting it would move ~100 lines of App.jsx for no functional gain and risk a working feature mid-sprint. Instead: `useRoundTimer.js` (~30 lines, same interval+ref pattern) and `RoundTimer.jsx` (SVG ring adapted from TimerPage's markup). The round timer differs anyway — per-match, stamps `startedAt`/`endedAt`, compact, needs an expired state that doesn't hijack the screen.

This duplicates ~40 lines of dial markup. **Deliberate and accepted.** Follow-up ticket: once mens-games is stable, extract a shared `TimerDial` with tests already green on both sides.

### 4.6 UI placement — **both a top-level page and an event tab**

1. **Top-level page** `pageView==="mensgames"`, reached from `Nav` and the `Home` tile row next to Team Creator and Timer. Required because a tournament can exist without an event.
2. **Event tab** `"Mens-Games 🏆"` appended to `TABS`, listing tournaments where `event_id===evt.id`. Appending is safe — no test asserts on `TABS` contents (verified).

Both mount the **same** lazy component with a different `scope` prop.

---

## 5. Work packages

**[P]** parallelisable · **[D:x]** depends on x

- **WP-A — DB + team-library data layer [P]** *(blocks B, C, E)* — Dom runs §9 SQL. `teamlib/api.js`: `fetchTeamSets`, `saveTeamSet`, `deleteTeamSet`, `archiveTeamSet`, `unarchiveTeamSet`, `linkTeamSetToEvent`, `unlinkTeamSetFromEvent`, `addTeamAward`. `teamlib/model.js`: `blankTeamSet`, `blankTeam`, `setCaptain`, `teamSetSummary`.
- **WP-B — App.jsx team-library rewiring [D:A]** — every read-site change, §5.2. ~40 changed lines, no declaration moved.
- **WP-C — Team Creator: purpose, captains, archive [D:A,B]** — captain toggle per member (reuse the 👑 interaction already in `QuizBuilder`), "save to library" replacing "save to event", Active/Archived filter, Archive/Restore/Delete.
- **WP-D — Scoring registry, model, standings [P]** *(pure JS, zero UI, start immediately)* — `model.js` (`blankTournament`, `blankRound`, `blankMatch`, `entrantsFromTeamSet`, `entrantsFromAttendees`, `generateRoundRobin`, `generateRandomPairs`, `generateSingleElim` phase 2), `scoring/*.js`, `standings.js` (`rankRound`, `awardPoints`, `lockRound`, `unlockRound`, `computeStandings`). Fully unit-testable, no jsdom, no source parsing. **Should have the most tests in the feature.**
- **WP-E — Tournament data layer + realtime [D:A(SQL)]** — `api.js`: `fetchTournaments`, `fetchTournament`, `saveTournament`, `deleteTournament`, `subscribeTournament`. Writes debounced 400 ms so a stepper click doesn't fire six upserts.
- **WP-F — Mens-games UI [D:D,E]** — `MensGamesPage`, `MensGamesTab`, `TournamentEditor`, `RoundCard`, `RoundEditor`, `MatchRow`, `ConfigFields`, `ScoreboardPanel`, `StandingsTable`, `EntrantPicker`, `BracketView` (phase 2), `ui/Kit.jsx`, `ui/styles.jsx`.
- **WP-G — Quiz round adapter [D:D]**
- **WP-H — Round timer [P]**
- **WP-I — App.jsx mens-games wiring [D:F]** — ~10 lines, §5.3.
- **WP-J — Awards archive + Hall of Fame [D:B,E]**

### 5.1 Why the feature dir gets its own `Kit.jsx`

Adding `export` to `const Card =`, `const Btn =` etc. **breaks the source-parsing tests immediately** — both extractors match `line.trimStart().startsWith('const Card =')`, and `export const Card =` fails that. Moving them to a shared module breaks it harder.

The trailer solved this by owning its presentation. Mens-games does the same: `ui/Kit.jsx` re-implements ~6 primitives (~90 lines) against the **same global CSS custom properties** `GS` already injects, so it's visually identical by construction. Rejected alternative: passing components down as a `ui={{…}}` prop — zero duplication, but makes every component untestable in isolation and unreadable.

### 5.2 Every team-library read site that changes (exhaustive)

| # | Site | Today | Change |
|---|---|---|---|
| 1 | `TeamsTab` (1391-1394) | `evt.team_sets` | New `teamSets` prop; filter by `status==='active' && event_ids.includes(evt.id)`. "Verwijder" becomes **"Loskoppelen"** → `unlinkTeamSetFromEvent` (destroying a reusable library set from an event tab is a footgun). Add a captain 👑 line. |
| 2 | `EventPage` signature (1446) + TeamsTab render (1632) | — | Thread `teamSets` + `onTeamSetsChanged`. |
| 3 | `EventPage` → `QuizDashboard` (1664) | — | Pass `teamSets`. |
| 4 | `QuizDashboard` → `QuizBuilder` (2137) | `team_sets={evt.team_sets||[]}` | `team_sets={teamSets.filter(ts=>ts.status==='active')}` — **prop name and shape stay identical**, so `QuizBuilder` needs **no edit at all**. |
| 5 | `TeamCreatorPage.saveToEvent` (5972-5978) | pushes into `evt.team_sets` | `saveTeamSet()` + optional `linkTeamSetToEvent()`. Renamed `saveToLibrary`. |
| 6 | Saved-sets list (6129-6166) | scans all events | renders `teamSets`, grouped by status; shows linked-event chips. |
| 7 | Delete (6156) | rewrites the event | `deleteTeamSet(id)` with confirm; plus Archive/Restore. |
| 8 | `App` root (6284, 6653, 6655) | — | `useState([])`; add `fetchTeamSets()` to the boot `Promise.all` and the 30 s poll; pass down. |
| 9 | `HallOfFame` (798) | — | Phase 3: trophy cabinet from archived sets. |

Nothing else reads `team_sets` (grep-verified).

### 5.3 Exact App.jsx additions for mens-games (≈10 lines)

```js
const MensGamesPage = lazy(() => import("./features/mensgames/MensGamesPage.jsx"));
const MensGamesTab  = lazy(() => import("./features/mensgames/MensGamesTab.jsx"));
```
Plus: append to `TABS`; one tab render line; `can.runTournament`; `openMensGames`; one page render line; one `Nav` + one `Home` entry copying the existing `onTeams`/`onTimer` wiring.

**Mens-games owns its own Supabase I/O** rather than lifting tournament state into `App` — it's lazy, so App must not fetch for it on boot. The team library is the opposite (eager, three non-lazy consumers), which is why *its* state lives in `App`.

### 5.4 What breaks in the source-parsing tests

Nothing, **if these rules hold**:

1. **Never add `export` to an existing `const` in App.jsx.**
2. **Never move, rename or reformat** the extracted declarations: `Card`, `Modal`, `H`, `Lbl`, `Inp`, `getYouTubeId`, `getSpotifyTrackId`, `isSpotifyUrl`, `isYouTubeUrl`, `hasAdmin`, `hasOrg`, `getUA`, `getDisplayName`, `computeMemberStats`, `formatEventDateRange`, `TEAM_AVATARS`, `normalizeQuiz`, `eventDayCount`, `dateForEventDay`, `dayHeadingLabel`, `scheduleDayTimeOrder`.
3. **Never introduce a line that is exactly `};` inside one of those declarations** — extractors slice to the *first* such line.
4. Adding *new* module-scope declarations is safe.
5. `App.smoke.test.jsx`'s supabase mock returns `{data:[],error:null}` for any unknown table, so `from('team_sets')`/`from('tournaments')` resolve harmlessly with no mock changes.

---

## 6. API surface

All access is via the anon key from the browser; there is no server.

Team library and tournaments both use full-row upserts matching the app's idiom. `subscribeTournament` mirrors the existing `postgres_changes` pattern in `EventPage`.

**Event awards write-back** reuses the existing path: `finishTournament()` sets status, pushes winner rows into `event.winners`, and adds `TeamAward`s to the originating team sets. Because `HallOfFame` already aggregates `evt.winners` and `WinnersTab` already renders them, **#16 basic coverage needs no changes to either**.

---

## 7. Security & trust model

**Auth (unchanged, deliberately not fixed here):** username + SHA-256 PIN compared client-side; session in `localStorage`; all DB access via the browser's anon key. **There is no server-side authorization anywhere in this app.** Any user of the deployed site can read and write any row. This is a known, owner-accepted gap for a private friends' app, explicitly out of scope, and this spec neither worsens nor fixes it — but it must not be described as secure.

| Category | Status |
|---|---|
| **Broken access control** | **KNOWN GAP, PRE-EXISTING.** New tables get RLS enabled with a permissive anon policy, matching `events`/`users`. `can.*` gating is UX, not security. Not regressed; not fixed. |
| **Injection / untrusted input** | **ADDRESSED.** All writes via the parameterised query builder. **No `dangerouslySetInnerHTML` anywhere** in mensgames or teamlib — team names, round names, notes and quiz-derived names render as text nodes. `renderMd` deliberately not reused. Numeric inputs parse, clamp to plugin min/max, reject `NaN`. Timer seconds clamped 1–7200. |
| **Don't trust the client** | N/A in effect — no server to re-check against, nothing touching money or entitlements. |
| **Secrets** | N/A — no new keys, env vars or third-party calls. |
| **Supply chain** | **ADDRESSED by adding zero dependencies.** |
| **Abuse resistance** | N/A — private app, no new public endpoints. |
| **Observability** | Deletes get a typed confirm; `updated_at` stamped on every write so a bad overwrite is dateable. No audit log — disproportionate. |

**Trust boundary:** the only externally-shaped data is `quiz.scores`, whose keys are user-typed names. Treated as **data, never identity** — names are matched, never trusted to select an entrant implicitly; anything unmatched is surfaced rather than silently dropped. The frozen snapshot means a later quiz edit can't mutate a locked result.

**One real data-integrity risk:** concurrent scoring. Two admins on two phones both hold the whole tournament; last write wins. Mitigation in v1: realtime means the second device sees the change within ~1 s, plus a "someone else is editing" banner. Full conflict resolution is a cut line and, honestly, unnecessary for one scorekeeper at a bar.

---

## 8. Key tradeoffs

| Decision | Rejected | Why | Honest downside |
|---|---|---|---|
| `team_sets` table | JSONB + `global` flag | A set must outlive any event | Two data sources at App root; a migration to run |
| Link on `team_sets.event_ids` | `events.team_set_ids` | Avoids full-row upserts of the fat event row | Event realtime doesn't fire on link changes — Teams tab can lag 30 s |
| One tournament row, tree in JSONB | Normalised tables | Matches the app's idiom; realtime-on-row gives a live scoreboard free | Last-write-wins; rows ~20–60 kB |
| Flexible rounds first | Bracket-first | Dom's stated priority is flexible editing | No knockout visual in v1 — most likely day-one request |
| Scoring registry with `manual` fallback | Enum + switch | Dom will invent scoring types; unknown ids must degrade not crash | Generic field rendering is less pretty than bespoke per-sport UI |
| `award` separate from `scoring` | Points straight from the plugin | Lets a 300-point quiz and a best-of-3 both be worth 10 | One more concept to learn |
| Persist `round.results` | Always recompute | Standings must be stable and auditable | Editing a locked round needs explicit unlock |
| Snapshot entrants | Live reference by id | A rename must not rewrite finished history | Renaming doesn't update a running tournament — needs a "refresh names" button (phase 2) |
| Local `ui/Kit.jsx` | `export` App.jsx primitives | Exporting breaks the source-parsing extractors | ~90 duplicated lines; visual drift risk |
| New `useRoundTimer` | Extract `TimerPage` | Zero risk to a working page; behaviour genuinely differs | ~40 duplicated lines; follow-up to converge |
| Zero new dependencies | dnd-kit, a bracket lib, zod | Main chunk already 678 kB | Round reordering is ↑/↓ not drag-and-drop (mobile-friendlier anyway) |

**Bundle impact:** main +~2 kB; mens-games chunk ~40–55 kB, loaded on demand.

---

## 9. Migration SQL — Dom runs this

### 9.1 Create tables

```sql
create table if not exists public.team_sets (
  id text primary key,
  name text not null,
  category text not null default '',
  teams jsonb not null default '[]'::jsonb,
  event_ids text[] not null default '{}',
  status text not null default 'active',
  awards jsonb not null default '[]'::jsonb,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists team_sets_status_idx on public.team_sets (status);
create index if not exists team_sets_event_ids_idx on public.team_sets using gin (event_ids);
alter table public.team_sets enable row level security;
create policy "team_sets anon full access" on public.team_sets
  for all to anon using (true) with check (true);

create table if not exists public.tournaments (
  id text primary key,
  name text not null,
  event_id text,
  status text not null default 'draft',
  entrants jsonb not null default '[]'::jsonb,
  rounds jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  team_set_id text,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tournaments_event_idx on public.tournaments (event_id);
alter table public.tournaments enable row level security;
create policy "tournaments anon full access" on public.tournaments
  for all to anon using (true) with check (true);

alter publication supabase_realtime add table public.tournaments;
```

### 9.2 Migrate existing `events.team_sets` → rows *(run once, after 9.1, before deploying)*

```sql
insert into public.team_sets (id, name, category, teams, event_ids, created_at)
select ts->>'id',
       coalesce(nullif(ts->>'name',''), 'Naamloze teams'),
       coalesce(ts->>'category',''),
       coalesce(ts->'teams','[]'::jsonb),
       array[e.id],
       coalesce((ts->>'createdAt')::timestamptz, now())
from public.events e,
     lateral jsonb_array_elements(coalesce(e.team_sets,'[]'::jsonb)) ts
where ts->>'id' is not null
on conflict (id) do update
  set event_ids = (select array_agg(distinct x)
                   from unnest(team_sets.event_ids || excluded.event_ids) x);
```

Verify (both must match):

```sql
select count(*) as migrated from public.team_sets;
select sum(jsonb_array_length(coalesce(team_sets,'[]'::jsonb))) as legacy from public.events;
```

### 9.3 Drop the legacy column — **one release later, not now**

```sql
alter table public.events drop column team_sets;
```

---

## 10. Cut lines (drop in this order)

1. **Hall of Fame trophy cabinet** — the event award write-back already surfaces winners in Winners tab and the existing HoF.
2. **`BracketView.jsx`** — already phase 2.
3. **Archive/restore for team sets** — ship delete only. **Do not cut the `status` column** — cutting it means a second migration.
4. **`race-time` and `goal-diff` scoring** — the other five cover the stated cases; the registry makes these a 40-line add.
5. **Per-round team-set override.**
6. **Concurrent-edit banner.**
7. **Round timer** — `TimerPage` already exists, one nav click away.
8. **The event tab** — ship the top-level page only. Halves the App.jsx diff.
9. **`freeform` round format.**

**Never cut:** the SQL + migration, the scoring-registry indirection (retrofitting a plugin system onto a hardcoded enum costs 3× what building it costs), and `round.results` persistence (standings that change under Dom's feet is the bug that destroys trust in the whole feature).

---

## 11. Risks

1. **Scope explosion via scoring types.** Dom will want a sport we haven't modelled *during* the build. The `manual` fallback means "score it by hand tonight, plugin next week" is always valid. Hold at seven for v1.
2. **App.jsx merge surface.** WP-B and WP-I both edit it. Sequence them; neither may move a declaration.
3. **The migration runs while the old build is live.** If someone on the old build saves a team set after migrating, it lands in `events.team_sets` and is orphaned. Run 9.1+9.2 and deploy in the same sitting; re-run 9.2 if in doubt (idempotent).
4. **Last-write-wins on tournaments.** Realistic mitigation is social ("one phone scores"), reinforced by the banner. Do not attempt CRDTs.
5. **Quiz name matching.** Quiz team names are typed free-hand; entrants come from the library. They will not always match. The unmatched-names UI is **not optional polish** — without it a quiz round silently scores zero for half the field.
6. **Bundle creep.** No new dependencies without written justification against the 678 kB baseline.
7. **Mobile.** This is scored at a bar, on phones, one-handed, possibly slightly drunk. Score entry must be steppers and big tap targets, not number inputs with a keyboard. Worth a designer pass before WP-F.

---

## 12. Out of scope

Server-side auth; Supabase Auth migration; RLS hardening; TypeScript/Tailwind; App.jsx decomposition beyond the two feature dirs; double elimination, group→knockout, seeding, swiss; live participant score submission from members' phones; cross-device shared round timer; any change to quiz creation/presentation/scoring; media attachments on rounds; exporting brackets; push notifications for tournaments; i18n.

---

## 13. Open questions for Dom — do not guess

1. **Default points per round.** Proposed: placement `[10, 6, 3, 1]`, editable per round. Confirm the table.
2. **Do tournaments always belong to an event?** The model allows standalone. If one always sits on a Mensday, we can drop the top-level page (cut line 8).
3. **Draws.** Allowed generally, or per scoring type? Currently `simple-points` allows, `best-of`/`first-to` don't.
4. **Overall tie-break** on equal points: head-to-head, most round wins, or decided on the night? Proposed: most round wins → head-to-head → joint placing.
5. **What gets archived after a tournament** (#10) — only the winning team, the whole set, or nothing automatic? Proposed: manual tick, default off.
6. **Can non-admins score?** Currently `org`/`admin` only. Is a designated non-admin scorekeeper needed?
7. **Captains** (#8): purely informational, or do they get powers outside the quiz?
8. **Language for the mens-games UI** — Dutch (like Team Creator, Timer) or English (like Quiz Dashboard, Winners)? Assumed Dutch.
9. **Preserve old team-set → event links** in the migration? Currently yes. Starting the library clean is a two-line change.
10. **Is the bracket a must-have for the next Mensday**, or is standings + match grid enough? This decides whether phase 2 is nice-to-have or a hard deadline.
