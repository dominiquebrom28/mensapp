// src/features/quiz/model.js -- the pure half of "bring a legacy quiz's
// teams into the Team Creator library" (owner brief, 2026-08-26). See
// TeamSetPicker.jsx's own header for the full flow this feeds; these tests
// cover only the decisions that can be made without a DOM or a Supabase
// call: name deduping, roster-matching against the existing library, and
// the draft this hands to `saveTeamSet`.
import { describe, it, expect } from 'vitest';
import { buildLegacyImportPlan, buildLegacyTeamSetDraft, dedupeTeamNames } from '../../features/quiz/model.js';

describe('dedupeTeamNames', () => {
  it('leaves already-unique names untouched, case differences included', () => {
    const { names, renamed } = dedupeTeamNames(['Team Alfa', 'Team Beta']);
    expect(names).toEqual(['Team Alfa', 'Team Beta']);
    expect(renamed).toEqual([]);
  });

  it('renames every collision after the first, case-insensitively, with an increasing suffix', () => {
    const { names, renamed } = dedupeTeamNames(['Team Gamma', 'team gamma', 'TEAM GAMMA']);
    expect(names).toEqual(['Team Gamma', 'Team Gamma (2)', 'Team Gamma (3)']);
    expect(renamed).toEqual([
      { index: 1, from: 'team gamma', to: 'Team Gamma (2)' },
      { index: 2, from: 'TEAM GAMMA', to: 'Team Gamma (3)' },
    ]);
  });

  it('never produces a fresh collision against a name the input already contains', () => {
    // Input already has both "Alfa" and "Alfa (2)" -- a naive first-collision
    // rename of the second "Alfa" would produce a second "Alfa (2)".
    const { names } = dedupeTeamNames(['Alfa', 'Alfa (2)', 'Alfa']);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);
    expect(names[0]).toBe('Alfa');
    expect(names[1]).toBe('Alfa (2)');
    expect(names[2]).not.toBe('Alfa (2)');
  });

  it('falls back to a numbered default for a blank/whitespace-only name, and dedupes those too', () => {
    const { names } = dedupeTeamNames(['', '   ', 'Team 1']);
    // index 0 -> "Team 1" (blank), index 1 -> "Team 2" (blank), index 2 ->
    // literal "Team 1" collides with index 0's default and gets suffixed.
    expect(names[0]).toBe('Team 1');
    expect(names[1]).toBe('Team 2');
    expect(names[2]).toBe('Team 1 (2)');
  });

  it('is defensive against a non-array input', () => {
    expect(dedupeTeamNames(null)).toEqual({ names: [], renamed: [] });
  });
});

describe('buildLegacyImportPlan', () => {
  const legacyQuiz = {
    title: 'Kroegquiz Editie 7',
    teams: [
      { name: 'De Kraaien', members: ['Doom', 'Tim'], captain: 'Doom' },
      { name: 'de kraaien', members: ['Bram'] }, // legacy dup, different case
    ],
  };

  it('produces fresh library-shaped teams with new ids, deduping the legacy roster', () => {
    const plan = buildLegacyImportPlan(legacyQuiz, [], { now: 1000 });
    expect(plan.candidateTeams).toEqual([
      { id: 'tm_1000_0', name: 'De Kraaien', avatar: expect.any(String), members: ['Doom', 'Tim'], captain: 'Doom' },
      { id: 'tm_1000_1', name: 'De Kraaien (2)', avatar: expect.any(String), members: ['Bram'], captain: null },
    ]);
    expect(plan.renamed).toEqual([{ index: 1, from: 'de kraaien', to: 'De Kraaien (2)' }]);
    expect(plan.match).toBeNull();
  });

  it('names a brand-new set after the quiz title', () => {
    const plan = buildLegacyImportPlan(legacyQuiz, [], { now: 1 });
    expect(plan.setName).toBe('Kroegquiz Editie 7 — Teams');
  });

  it('falls back to a generic name for an untitled quiz', () => {
    const plan = buildLegacyImportPlan({ teams: legacyQuiz.teams }, [], { now: 1 });
    expect(plan.setName).toBe('Geïmporteerde teams');
  });

  it('finds an existing ACTIVE set with the identical (deduped) roster and offers it as a match', () => {
    const existing = {
      id: 'ts_1', name: 'Kroeg Teams', status: 'active',
      teams: [
        { id: 'tm_a', name: 'De Kraaien', members: ['Doom', 'Tim'] },
        { id: 'tm_b', name: 'De Kraaien (2)', members: ['Bram'] },
      ],
    };
    const plan = buildLegacyImportPlan(legacyQuiz, [existing], { now: 1000 });
    expect(plan.match).toBe(existing);
  });

  it('ignores an archived set even with an identical roster -- never offered as a match', () => {
    const archived = {
      id: 'ts_1', name: 'Oude set', status: 'archived',
      teams: [
        { id: 'tm_a', name: 'De Kraaien', members: ['Doom', 'Tim'] },
        { id: 'tm_b', name: 'De Kraaien (2)', members: ['Bram'] },
      ],
    };
    expect(buildLegacyImportPlan(legacyQuiz, [archived], { now: 1000 }).match).toBeNull();
  });

  it('does not match on name alone -- different members means a different roster', () => {
    const lookalike = {
      id: 'ts_2', name: 'Andere set', status: 'active',
      teams: [
        { id: 'tm_a', name: 'De Kraaien', members: ['Someone', 'Else'] },
        { id: 'tm_b', name: 'De Kraaien (2)', members: ['Bram'] },
      ],
    };
    expect(buildLegacyImportPlan(legacyQuiz, [lookalike], { now: 1000 }).match).toBeNull();
  });

  it('matching is order-independent -- team order in the library set does not matter', () => {
    const reordered = {
      id: 'ts_3', name: 'Andere volgorde', status: 'active',
      teams: [
        { id: 'tm_b', name: 'De Kraaien (2)', members: ['Bram'] },
        { id: 'tm_a', name: 'De Kraaien', members: ['Tim', 'Doom'] }, // member order differs too
      ],
    };
    expect(buildLegacyImportPlan(legacyQuiz, [reordered], { now: 1000 }).match).toBe(reordered);
  });

  it('is defensive against a quiz with no teams / hostile input -- never throws', () => {
    expect(() => buildLegacyImportPlan(null, null, { now: 1 })).not.toThrow();
    const plan = buildLegacyImportPlan({ teams: 'not-an-array' }, 'not-an-array', { now: 1 });
    expect(plan.candidateTeams).toEqual([]);
    expect(plan.match).toBeNull();
  });
});

describe('buildLegacyTeamSetDraft', () => {
  it('builds a real team_sets-shaped draft (teamlib model) ready for saveTeamSet', () => {
    const plan = buildLegacyImportPlan(legacyQuizFixture(), [], { now: 2000 });
    const draft = buildLegacyTeamSetDraft(plan, { now: 2000, createdBy: 'Doom' });
    expect(draft.id).toBe('ts_2000');
    expect(draft.name).toBe(plan.setName);
    expect(draft.teams).toBe(plan.candidateTeams);
    expect(draft.status).toBe('active');
    expect(draft.eventIds).toEqual([]);
    expect(draft.awards).toEqual([]);
    expect(draft.createdBy).toBe('Doom');
    expect(draft.createdAt).toBe(new Date(2000).toISOString());
  });

  function legacyQuizFixture() {
    return { title: 'Test Quiz', teams: [{ name: 'Team A', members: [] }] };
  }
});
