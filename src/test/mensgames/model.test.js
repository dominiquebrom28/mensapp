import { describe, it, expect } from 'vitest';
import {
  blankTournament,
  blankRound,
  blankMatch,
  entrantsFromTeamSet,
  entrantsFromAttendees,
} from '../../features/mensgames/model.js';

describe('blankTournament', () => {
  it('builds a draft tournament with the given fields', () => {
    const t = blankTournament({ name: 'Mens-Games 2026', eventId: 'evt-2026', createdBy: 'Doom', now: 1000 });
    expect(t).toMatchObject({
      id: 'trn_1000',
      name: 'Mens-Games 2026',
      eventId: 'evt-2026',
      status: 'draft',
      entrants: [],
      rounds: [],
      teamSetId: null,
      createdBy: 'Doom',
    });
    expect(t.settings.tieBreak).toEqual(['roundWins', 'headToHead', 'jointPlacing']);
    expect(t.createdAt).toBe(new Date(1000).toISOString());
  });

  it('is deterministic for the same input', () => {
    const a = blankTournament({ name: 'X', now: 42 });
    const b = blankTournament({ name: 'X', now: 42 });
    expect(a).toEqual(b);
  });

  it('never mutates the settings.tieBreak default array across calls', () => {
    const a = blankTournament({ now: 1 });
    a.settings.tieBreak.push('extra');
    const b = blankTournament({ now: 1 });
    expect(b.settings.tieBreak).toEqual(['roundWins', 'headToHead', 'jointPlacing']);
  });

  it('defaults name/eventId/createdBy when omitted or blank', () => {
    const t = blankTournament({ now: 5 });
    expect(t.name).toBe('Naamloos toernooi');
    expect(t.eventId).toBeNull();
    expect(t.createdBy).toBe('');
  });
});

describe('blankRound', () => {
  it('seeds scoring.config from the chosen type\'s configFields defaults', () => {
    const r = blankRound({ name: 'Pool', scoringTypeId: 'best-of', format: 'matches', now: 1000 });
    expect(r.scoring).toEqual({ typeId: 'best-of', config: { sets: 3 } });
    expect(r.id).toBe('rnd_1000');
    expect(r.matches).toEqual([]);
    expect(r.status).toBe('pending');
    expect(r.results).toBeNull();
  });

  it('falls back to manual for an unknown scoring type id, per the registry contract', () => {
    const r = blankRound({ scoringTypeId: 'some-future-sport', now: 1 });
    expect(r.scoring.typeId).toBe('manual');
  });

  it('gives a quiz-format round a populated source stub, and other formats null', () => {
    const quizRound = blankRound({ format: 'quiz', now: 1 });
    expect(quizRound.source).toEqual({ type: 'quiz', eventId: null, quizId: null, nameMap: {}, pulledAt: null, raw: {} });
    const matchRound = blankRound({ format: 'matches', now: 1 });
    expect(matchRound.source).toBeNull();
  });

  it('falls back to "matches" for a malformed format value', () => {
    const r = blankRound({ format: 'not-a-real-format', now: 1 });
    expect(r.format).toBe('matches');
  });

  it('seeds the default placement award table', () => {
    const r = blankRound({ now: 1 });
    expect(r.award).toEqual({ mode: 'placement', table: [10, 6, 3, 1], perWin: 3, perDraw: 1, rawFactor: 1 });
  });
});

describe('blankMatch', () => {
  it('builds a pending match with the given entrants', () => {
    const m = blankMatch('ent_1', 'ent_2', { now: 500 });
    expect(m).toMatchObject({
      id: 'mt_500',
      aId: 'ent_1',
      bId: 'ent_2',
      winnerId: null,
      status: 'pending',
      startedAt: null,
      endedAt: null,
      bracket: null,
    });
    expect(m.entry).toEqual({ a: {}, b: {} });
  });

  it('a null bId means a bye', () => {
    const m = blankMatch('ent_1', null, { now: 1 });
    expect(m.bId).toBeNull();
  });

  it('an explicit id overrides the now-derived default', () => {
    const m = blankMatch('a', 'b', { now: 1, id: 'mt_custom' });
    expect(m.id).toBe('mt_custom');
  });

  it('bId defaults to null (a bye) when omitted entirely', () => {
    const m = blankMatch('ent_1');
    expect(m.bId).toBeNull();
  });
});

describe('entrantsFromTeamSet', () => {
  it('snapshots teams into team-kind entrants with provenance', () => {
    const teamSet = {
      id: 'ts_1',
      teams: [
        { id: 'tm_1', name: 'De Kraaien', avatar: '🦅', members: ['Doom', 'Tim'], captain: 'Doom' },
        { id: 'tm_2', name: 'De Wolven', avatar: '🐺', members: ['Bram'] },
      ],
    };
    const entrants = entrantsFromTeamSet(teamSet);
    expect(entrants).toEqual([
      { id: 'ent_tm_1', kind: 'team', name: 'De Kraaien', avatar: '🦅', memberNames: ['Doom', 'Tim'], teamSetId: 'ts_1', sourceTeamId: 'tm_1' },
      { id: 'ent_tm_2', kind: 'team', name: 'De Wolven', avatar: '🐺', memberNames: ['Bram'], teamSetId: 'ts_1', sourceTeamId: 'tm_2' },
    ]);
  });

  it('is deterministic — same team set produces the same entrant ids', () => {
    const teamSet = { id: 'ts_1', teams: [{ id: 'tm_1', name: 'X', members: [] }] };
    expect(entrantsFromTeamSet(teamSet)).toEqual(entrantsFromTeamSet(teamSet));
  });

  it('skips malformed team rows and never throws on a malformed team set', () => {
    expect(entrantsFromTeamSet(null)).toEqual([]);
    expect(entrantsFromTeamSet({ teams: 'not-an-array' })).toEqual([]);
    expect(entrantsFromTeamSet({ teams: [null, { id: 'tm_1' }, { name: 'no id' }] })).toEqual([
      { id: 'ent_tm_1', kind: 'team', name: 'Naamloos team', avatar: '🎯', memberNames: [], teamSetId: null, sourceTeamId: 'tm_1' },
    ]);
  });
});

describe('entrantsFromAttendees', () => {
  it('only includes attendees who actually went/are going by default', () => {
    const attendees = [
      { name: 'Doom', status: 'went' },
      { name: 'Bram', status: 'going' },
      { name: 'Sander', status: 'absent' },
      { name: 'Tim', status: 'maybe' },
    ];
    const entrants = entrantsFromAttendees(attendees);
    expect(entrants.map((e) => e.name)).toEqual(['Doom', 'Bram']);
    expect(entrants[0]).toMatchObject({ kind: 'player', memberNames: [], teamSetId: null, sourceTeamId: null });
  });

  it('honours a custom statuses filter', () => {
    const attendees = [{ name: 'Tim', status: 'maybe' }];
    const entrants = entrantsFromAttendees(attendees, { statuses: ['maybe'] });
    expect(entrants.map((e) => e.name)).toEqual(['Tim']);
  });

  it('never throws on malformed attendees', () => {
    expect(entrantsFromAttendees(null)).toEqual([]);
    expect(entrantsFromAttendees([null, { status: 'went' }, { name: '  ', status: 'went' }])).toEqual([]);
  });

  it('produces deterministic, slug-based ids', () => {
    const attendees = [{ name: 'Doom', status: 'went' }];
    expect(entrantsFromAttendees(attendees)[0].id).toBe('ent_p_doom');
  });
});
