# Hall of Fame — the trophy room

**Status:** spec, not yet built. Written 2026-08-26.

## The ask

The owner, verbatim:

> "The hall of fame should be an overall grouping/showcase of all the 'Winners & Highlights' (mensgames winners, quizz winners, stuff like that) from the events + some general highlight stats like attendance, amount of kretjes. Please organize this in a way you dont have to scroll endlessly. it is fine if we add in tiles (with the top 1 on it) and then you can click to see the whole list for example."

## Why now

Events stopped being control panels this morning. Quiz, Teams and Mens-Games all left the event page for the top level, and results flow *back* to an event through its Winners & Highlights tab. Hall of Fame is where that adds up across every event — the one place you go to see who has actually won things.

## What is wrong with it today

`HallOfFame` is 336 lines rendering **seven full-width sections stacked vertically**:

1. Perfect Attendance banner
2. 📅 Attendance Record — a podium, then **every member × every event as a dot grid**
3. 🔥 On a Roll — current streaks
4. 🏆 Most Awards Won — expandable per-person rows
5. 🏆 Team Trophy Cabinet
6. 🧠 Quiz All-Time Scores
7. 📸 Lens Legend

Two problems.

**It is one long scroll with no overview.** Nothing is visible at a glance; every category costs a scroll to reach, and section 2 alone is the height of several screens once the group has a few more editions. There is no answer to "who's winning, overall" without reading the whole page.

**It aggregates people, not awards.** Every section ranks *members by a count*. The actual awards — the mens-games champions, the quiz winners, the hand-added ones — exist only as a number next to someone's name. The thing the owner is asking to showcase is the one thing the page never shows.

## The shape

**A stat strip, a tile grid, and drill-in on demand.** Nothing below the fold on first load except the tiles themselves.

### 1. Stat strip

One row, four numbers, no interaction. The context everything else sits in.

| | source |
|---|---|
| Edities | `events.length` |
| Lads | distinct attendees across all events |
| Kretjes | `totalKretjes` — already computed, currently barely surfaced |
| Awards | total winner rows across all events + team awards |

### 2. Tile grid

Responsive: 3 across on desktop, 2 on tablet, 1 on phone. **Every tile has the same anatomy** — this is the point, and the thing most likely to be got wrong:

```
  icon + category name
  ─────────────────────
  🥇  avatar   NAME            ← the #1, big
                the number      ← what they won it with
  ─────────────────────
  runners-up: two names, small
  "Bekijk alle 13 →"           ← opens the full list
```

Tiles, and what #1 means on each:

| tile | #1 is | number |
|---|---|---|
| 🏅 Roll of Honour | most recent award | who won it, at which event |
| 📅 Attendance | most events attended | `12 van 14` |
| 🔥 On a Roll | longest current streak | `5 op rij` |
| 🏆 Most Awards | most awards won | `7 awards` |
| 🧠 Quiz All-Time | highest total quiz score | `340 pts` |
| 🏆 Team Trophy Cabinet | team with most awards | `4 awards` |
| 📸 Lens Legend | most photos uploaded | `31 foto's` |
| 🐐 Perfect Attendance | only if non-empty | the names |

**Roll of Honour is new and is the centrepiece.** Every award from every event in one place: mens-games champions, quiz winners, hand-added awards, team awards. It is what the owner actually asked for and the only tile that shows *awards* rather than a ranking of people. Give it the first slot and let it span two columns on desktop.

### 3. Drill-in

Clicking a tile opens the full list in the existing `Modal`. Not a new page, not an accordion, not an inline expand that pushes everything down — a modal keeps the grid as the stable home you return to.

Each modal is the section that exists today, moved wholesale. **The attendance dot grid keeps every one of its dots** — it is genuinely useful, it is just not a landing-page element. Moving it behind a click is the entire fix.

## Decisions already made, so nobody re-litigates them

- **A tile with no data does not render.** No "Nog geen awards" cards padding out the grid. An empty Hall of Fame shows the stat strip and one honest empty state.
- **Secret tournaments and unpublished quizzes never appear.** That invariant has been broken twice on this project, both times member-visible. It applies here exactly as it does in `WinnersTab`.
- **No new colour, type scale or component.** Use `Card`, `Modal`, `H`, `Avatar`, `Btn` as they are. This is an information-architecture change, not a restyle.
- **The tile is one component used eight times.** Eight hand-rolled tiles is how the design system forked in the first place (`docs/ux-plan.md` §2.1).

## Constraints

- `HallOfFame` lives in `src/App.jsx` and **must not gain an `export`** — around eight test files parse that file as raw text.
- Tiles are interactive: real `<button>`s, 44px minimum, visible focus. The existing sections use `<div onClick>` in places; do not copy that.
- Do not regress `src/test/hallOfFame.integration.test.jsx`. Its assertions describe behaviour that must survive the reorganisation — a tournament champion written by `finishTournament` still has to be findable, and the trophy cabinet still has to render. If an assertion now needs to click a tile first, change *how* it reaches the thing, never *what* it asserts.

## How to know it worked

The measure is not "the tests pass." It is: **on a phone, without scrolling, can you tell who is winning what?** Check it in the browser at 375px before calling it done.
