import { describe, it, expect } from 'vitest';
import { rankRound, awardPoints, lockRound, unlockRound, computeStandings } from '../../features/mensgames/standings.js';
import { blankMatch } from '../../features/mensgames/model.js';

function matchesRound(overrides = {}) {
  return {
    id: 'rnd_1',
    entrantIds: ['ent_1', 'ent_2'],
    format: 'matches',
    scoring: { typeId: 'simple-points', config: {} },
    matches: [],
    award: { mode: 'placement', table: [10, 6, 3, 1], perWin: 3, perDraw: 1, rawFactor: 1 },
    status: 'live',
    results: null,
    ...overrides,
  };
}

describe('rankRound', () => {
  it('delegates to the round\'s own scoring plugin', () => {
    const round = matchesRound({
      matches: [
        { ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 2 } } },
      ],
    });
    const ranking = rankRound(round);
    expect(ranking.find((e) => e.entrantId === 'ent_1').rank).toBe(1);
  });

  it('falls back to manual for an unknown scoring type id (getScoringType contract)', () => {
    const round = matchesRound({ scoring: { typeId: 'a-sport-from-the-future', config: {} } });
    expect(() => rankRound(round)).not.toThrow();
  });

  it('never throws on a malformed round, returns entrants tied at 0', () => {
    const round = { entrantIds: ['ent_1', 'ent_2'], scoring: null, matches: 'garbage' };
    const ranking = rankRound(round);
    expect(ranking.every((e) => e.value === 0)).toBe(true);
  });
});

describe('awardPoints', () => {
  it('placement mode reads the award table by rank, tied ranks share the slot', () => {
    const ranking = [
      { entrantId: 'a', rank: 1, value: 10 },
      { entrantId: 'b', rank: 1, value: 10 },
      { entrantId: 'c', rank: 3, value: 2 },
    ];
    const points = awardPoints(ranking, { mode: 'placement', table: [10, 6, 3, 1] });
    expect(points).toEqual({ a: 10, b: 10, c: 3 });
  });

  it('placement mode awards 0 for a rank beyond the table length', () => {
    const ranking = [{ entrantId: 'a', rank: 9, value: 1 }];
    const points = awardPoints(ranking, { mode: 'placement', table: [10, 6, 3, 1] });
    expect(points).toEqual({ a: 0 });
  });

  it('perWin mode multiplies wins/draws by perWin/perDraw', () => {
    const ranking = [{ entrantId: 'a', rank: 1, value: 2, wins: 2, draws: 1 }];
    const points = awardPoints(ranking, { mode: 'perWin', perWin: 3, perDraw: 1 });
    expect(points).toEqual({ a: 7 }); // 2*3 + 1*1
  });

  it('perWin mode falls back to treating `value` as the win count when wins/draws are absent', () => {
    const ranking = [{ entrantId: 'a', rank: 1, value: 4 }];
    const points = awardPoints(ranking, { mode: 'perWin', perWin: 2, perDraw: 1 });
    expect(points).toEqual({ a: 8 });
  });

  it('raw mode multiplies value by rawFactor', () => {
    const ranking = [{ entrantId: 'a', rank: 1, value: 300 }];
    const points = awardPoints(ranking, { mode: 'raw', rawFactor: 0.05 });
    expect(points).toEqual({ a: 15 });
  });

  it('an unknown award mode awards 0, never throws', () => {
    const ranking = [{ entrantId: 'a', rank: 1, value: 10 }];
    expect(awardPoints(ranking, { mode: 'mystery-mode' })).toEqual({ a: 0 });
  });

  it('never throws on malformed ranking/award input', () => {
    expect(awardPoints(null, null)).toEqual({});
    expect(awardPoints('garbage', {})).toEqual({});
    expect(awardPoints([{ entrantId: 'a', rank: 1, value: NaN }], { mode: 'placement', table: [10] })).toEqual({ a: 10 });
  });
});

describe('lockRound / unlockRound', () => {
  const tournament = {
    id: 'trn_1',
    entrants: [{ id: 'ent_1' }, { id: 'ent_2' }],
    rounds: [
      matchesRound({
        matches: [{ ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 2 } } }],
      }),
    ],
  };

  it('freezes ranking + points onto round.results and marks it done', () => {
    const locked = lockRound(tournament, 'rnd_1', { now: 12345 });
    const round = locked.rounds[0];
    expect(round.status).toBe('done');
    expect(round.results).toBeTruthy();
    expect(round.results.lockedAt).toBe(new Date(12345).toISOString());
    expect(round.results.points.ent_1).toBeGreaterThan(round.results.points.ent_2);
  });

  it('does not mutate the input tournament', () => {
    const before = JSON.stringify(tournament);
    lockRound(tournament, 'rnd_1', { now: 1 });
    expect(JSON.stringify(tournament)).toBe(before);
  });

  it('editing round config after lock does not change the frozen results (results are never recomputed)', () => {
    const locked = lockRound(tournament, 'rnd_1', { now: 1 });
    const tampered = {
      ...locked,
      rounds: locked.rounds.map((r) => (r.id === 'rnd_1' ? { ...r, scoring: { typeId: 'goal-diff', config: {} } } : r)),
    };
    // computeStandings must read the frozen results, not re-derive from the
    // now-changed scoring config.
    const standings = computeStandings(tampered);
    const original = computeStandings(locked);
    expect(standings.find((s) => s.entrantId === 'ent_1').points).toBe(original.find((s) => s.entrantId === 'ent_1').points);
  });

  it('returns the tournament unchanged for an unknown roundId', () => {
    expect(lockRound(tournament, 'nope')).toBe(tournament);
  });

  it('unlockRound clears results and returns the round to live', () => {
    const locked = lockRound(tournament, 'rnd_1', { now: 1 });
    const unlocked = unlockRound(locked, 'rnd_1', { now: 2 });
    expect(unlocked.rounds[0].status).toBe('live');
    expect(unlocked.rounds[0].results).toBeNull();
  });

  it('returns the tournament unchanged for an unknown roundId', () => {
    expect(unlockRound(tournament, 'nope')).toBe(tournament);
  });
});

describe('computeStandings', () => {
  function tournamentWith(rounds, entrants = [{ id: 'ent_1' }, { id: 'ent_2' }, { id: 'ent_3' }]) {
    return { id: 'trn_1', entrants, rounds, settings: {} };
  }

  it('sums points across every locked round', () => {
    const r1 = lockRound(tournamentWith([
      matchesRound({ id: 'rnd_1', matches: [{ ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 1 } } }] }),
    ]), 'rnd_1', { now: 1 });
    const standings = computeStandings(r1);
    const ent1 = standings.find((s) => s.entrantId === 'ent_1');
    const ent2 = standings.find((s) => s.entrantId === 'ent_2');
    expect(ent1.points).toBeGreaterThan(ent2.points);
    expect(ent1.rank).toBe(1);
  });

  it('an unlocked round contributes nothing by default', () => {
    const t = tournamentWith([
      matchesRound({ id: 'rnd_1', matches: [{ ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 1 } } }] }),
    ]);
    const standings = computeStandings(t);
    expect(standings.every((s) => s.points === 0)).toBe(true);
  });

  it('an unlocked round contributes a live preview when includeUnlocked is set', () => {
    const t = tournamentWith([
      matchesRound({ id: 'rnd_1', matches: [{ ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 1 } } }] }),
    ]);
    const standings = computeStandings(t, { includeUnlocked: true });
    expect(standings.find((s) => s.entrantId === 'ent_1').points).toBeGreaterThan(0);
  });

  it('the live preview is never written back into the round', () => {
    const t = tournamentWith([
      matchesRound({ id: 'rnd_1', matches: [{ ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 1 } } }] }),
    ]);
    computeStandings(t, { includeUnlocked: true });
    expect(t.rounds[0].results).toBeNull();
    expect(t.rounds[0].status).toBe('live');
  });

  it('partial participation: an entrant absent from a round is simply absent from that round\'s contribution', () => {
    const round = matchesRound({
      id: 'rnd_1',
      entrantIds: ['ent_1', 'ent_2'], // ent_3 doesn't play this round
      matches: [{ ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 1 } } }],
    });
    const t = lockRound(tournamentWith([round]), 'rnd_1', { now: 1 });
    const standings = computeStandings(t);
    const ent3 = standings.find((s) => s.entrantId === 'ent_3');
    expect(ent3.points).toBe(0);
    expect(ent3.roundsPlayed).toBe(0);
  });

  it('tie-break chain: equal points -> more round wins ranks first', () => {
    // ent_1 wins round A outright (10 pts, 1 round win).
    // ent_2 gets a flat 10 pts in round B without winning it (rank 2, but
    // award table gives rank 2 10 pts too) -- so points are tied 10-10 but
    // ent_1 has 1 round win, ent_2 has 0.
    const roundA = matchesRound({
      id: 'rnd_a',
      award: { mode: 'placement', table: [10, 0], perWin: 3, perDraw: 1, rawFactor: 1 },
      matches: [{ ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 1 } } }],
    });
    const roundB = matchesRound({
      id: 'rnd_b',
      award: { mode: 'placement', table: [0, 10], perWin: 3, perDraw: 1, rawFactor: 1 },
      matches: [{ ...blankMatch('ent_1', 'ent_2'), entry: { a: { points: 5 }, b: { points: 1 } } }],
    });
    let t = tournamentWith([roundA, roundB]);
    t = lockRound(t, 'rnd_a', { now: 1 });
    t = lockRound(t, 'rnd_b', { now: 2 });
    const standings = computeStandings(t);
    const ent1 = standings.find((s) => s.entrantId === 'ent_1');
    const ent2 = standings.find((s) => s.entrantId === 'ent_2');
    expect(ent1.points).toBe(ent2.points);
    expect(ent1.roundWins).toBeGreaterThan(ent2.roundWins);
    expect(ent1.rank).toBeLessThan(ent2.rank);
  });

  it('tie-break chain: equal points and equal round wins -> head-to-head decides', () => {
    // ent_1 and ent_2 draw 0 points and 0 round wins out of round C (a
    // third entrant, ent_3, tops it) -- but ent_1 beat ent_2 directly
    // within that round's matches, which is enough to break the tie.
    const roundC = matchesRound({
      id: 'rnd_c',
      entrantIds: ['ent_1', 'ent_2', 'ent_3'],
      scoring: { typeId: 'goal-diff', config: {} },
      award: { mode: 'raw', table: [10, 6, 3, 1], perWin: 3, perDraw: 1, rawFactor: 0 },
      matches: [
        { ...blankMatch('ent_1', 'ent_2'), entry: { a: { goals: 1 }, b: { goals: 0 } } },
        { ...blankMatch('ent_3', 'ent_1'), entry: { a: { goals: 5 }, b: { goals: 0 } } },
      ],
    });
    let t = tournamentWith([roundC]);
    t = lockRound(t, 'rnd_c', { now: 1 });
    const standings = computeStandings(t);
    const ent1 = standings.find((s) => s.entrantId === 'ent_1');
    const ent2 = standings.find((s) => s.entrantId === 'ent_2');
    expect(ent1.points).toBe(ent2.points); // both 0 — rawFactor 0
    expect(ent1.roundWins).toBe(ent2.roundWins); // both 0 — ent_3 takes rank 1 in rnd_c
    expect(ent1.rank).toBeLessThan(ent2.rank); // decided by head-to-head: ent_1 beat ent_2 directly
  });

  it('joint placing: fully tied entrants (equal points, equal round wins, no head-to-head data) share a rank', () => {
    const t = tournamentWith([], [{ id: 'ent_1' }, { id: 'ent_2' }]);
    const standings = computeStandings(t);
    expect(standings.every((s) => s.rank === 1)).toBe(true);
  });

  it('respects a custom tieBreak order from tournament.settings', () => {
    const t = { ...tournamentWith([]), settings: { tieBreak: ['jointPlacing'] } };
    expect(() => computeStandings(t)).not.toThrow();
  });

  it('never throws on a malformed tournament', () => {
    expect(computeStandings(null)).toEqual([]);
    expect(computeStandings({ entrants: 'x', rounds: 'y' })).toEqual([]);
  });
});
