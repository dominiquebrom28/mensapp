# MensApp — project context

Private social app for Dom's Dutch "mensdag" friend group: events, a large quiz
subsystem, teams, members, a Kretjes beer counter, hall of fame, a "SaraJay"
easter egg. Live at **mensapp.vercel.app**.

- Folder is `mensdag-app`; the GitHub repo is `dominiquebrom28/mensapp`, and it
  is **public**. Treat anything written into this repo as published.
- Stack: Vite 5 + React 18, **plain JavaScript — no TypeScript**, Supabase.
- Supabase has only three tables: `events`, `announcements`, `users`.
  `.env.local` is correctly gitignored.

## Shape of the code

`src/App.jsx` is **~6,180 lines — the entire app**, with 96 top-level
declarations.

- The quiz is ~2,515 lines (**41%**): QuizPresenter ~869, QuizBuilder ~554,
  QuizParticipantView ~468.
- `export default function App()` (~line 5854) is ~328 lines holding **20
  useState + 4 useEffect** — all fetching, realtime channels and mutations.
- `Nav` takes 19 props.

## Agreed split plan (architect never reviewed it — treat as a draft)

1. Design system → `src/ui/`
2. Pure helpers → `src/lib/` (this also removes the fragile
   `src/test/extractFromAppSource.js` source-eval hack)
3. **Quiz** → the big win, 41% of the file
4. Remaining features, parallelisable
5. App's state + data layer **last, sequenced with the auth rework** — auth
   rewrites the same session boundary, so doing them independently means
   refactoring it twice.

## Known critical issue: authentication

Auth is **client-side only** and must be rebuilt on Supabase Auth + RLS before
this app is shared any wider. There is no server-side enforcement anywhere: no
`.rpc()`, no edge function, and roles are decided in the client. The `users`
table also accepts client-side insert/upsert/update/delete.

Proportionality: this is a friend-group app, so the practical risk is **PIN
reuse by members across other services**, not vandalism of the app. That still
makes it the highest-value fix on the list. Full detail — including the exact
exposure path and what has already been ruled out — is in the Project Lead's
memory and the Notion backlog rather than here, because this repo is public.

Checked and **fine**: the three `dangerouslySetInnerHTML` sites are safe —
`renderMd` escapes `&`, `<`, `>` *before* applying markdown. Don't re-flag these.

## Tooling (added 2026-08-18, currently UNCOMMITTED)

- Vitest 3.2.7 + React Testing Library + jsdom — **53/53 passing** (52 helper,
  1 render smoke). Pinned to 3.x deliberately: 4.x requires Vite ^6+.
- ESLint 9 flat config — **30 real problems** (13 errors, 17 warnings), all in
  `App.jsx`. `react/prop-types` is disabled on purpose: it produced 589 of an
  initial 642 problems and this codebase has no PropTypes convention.
- Preview server `mensapp` on **port 5210**.
- Build unchanged: ~668 kB, no code splitting yet.

Scripts: `npm run dev` · `build` · `preview` · `test` · `test:run` · `lint`.

## Working agreements

- **The team cannot push this repo.** `~/.claude/settings.json` scopes push
  permission to `studio-site` only, and that cannot be self-granted — Dom has to
  add a rule for `mensdag-app`. Until then all work stays local; commit to
  `team/*` branches so nothing is lost, but expect no PRs.
- This repo was `main`-only with no PR convention and its last real commit was
  2026-07-16. The studio's normal `team/*` branch → PR → Dom merges flow should
  apply here once push works.
- Backlog lives in **Notion, "MensApp — Backlog"** (12 seeded items), not in this
  repo. It carries a "Public-version prereq" checkbox.

## Direction, not committed

Dom, 2026-08-18: *"i might eventually work towards a version for the public. so
other friendgroups can use the app for their mens-events."* Recorded as FUTURE.
It raises the value of doing auth properly now, since multi-tenancy needs exactly
`auth.uid()` + RLS.
