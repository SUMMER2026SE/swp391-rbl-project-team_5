'use strict';

const {
  computePlanMetrics,
  scoreCandidates,
  selectConsensusCandidates,
  votingMemberIds,
} = require('../services/partyConsensusService');

function member(id, preferences = [], budgetCap = 500_000) {
  return {
    id,
    preferences: { categories: preferences },
    budgetCap,
    removedAt: null,
  };
}

function candidate(id, attractionId, categories, minPrice, rating = 4.5) {
  return {
    id,
    attractionId,
    position: 0,
    snapshot: {
      title: attractionId,
      categories,
      minPrice,
      rating,
    },
  };
}

describe('partyConsensusService', () => {
  test('a single hard veto excludes a candidate from selection', () => {
    const members = [member('m1'), member('m2')];
    const candidates = [
      candidate('c1', 'a1', ['Thiên nhiên'], 200_000),
      candidate('c2', 'a2', ['Bảo tàng'], 150_000),
    ];
    const votes = [
      { memberId: 'm1', candidateId: 'c1', value: 'LOVE' },
      { memberId: 'm2', candidateId: 'c1', value: 'VETO' },
      { memberId: 'm1', candidateId: 'c2', value: 'LIKE' },
      { memberId: 'm2', candidateId: 'c2', value: 'LIKE' },
    ];

    const scored = scoreCandidates({ members, candidates, votes });
    const result = selectConsensusCandidates(scored, 2);

    expect(result.selected.map((item) => item.attractionId)).toEqual(['a2']);
    expect(result.vetoed.map((item) => item.attractionId)).toEqual(['a1']);
  });

  test('minimum-member satisfaction rewards a balanced choice', () => {
    const members = [member('m1'), member('m2'), member('m3')];
    const candidates = [
      candidate('c1', 'popular-but-polarized', ['Thiên nhiên'], 200_000, 5),
      candidate('c2', 'balanced', ['Bảo tàng'], 200_000, 4),
    ];
    const votes = [
      { memberId: 'm1', candidateId: 'c1', value: 'LOVE' },
      { memberId: 'm2', candidateId: 'c1', value: 'LOVE' },
      { memberId: 'm1', candidateId: 'c2', value: 'LIKE' },
      { memberId: 'm2', candidateId: 'c2', value: 'LIKE' },
      { memberId: 'm3', candidateId: 'c2', value: 'LIKE' },
    ];

    const scored = scoreCandidates({ members, candidates, votes });
    expect(scored[0].attractionId).toBe('balanced');
    expect(scored[0].minimumSatisfaction).toBeGreaterThanOrEqual(0.7);
  });

  test('final metrics are calculated from attractions actually scheduled', () => {
    const members = [member('m1'), member('m2')];
    const candidates = [
      candidate('c1', 'a1', ['Thiên nhiên'], 200_000),
      candidate('c2', 'a2', ['Bảo tàng'], 150_000),
    ];
    const votes = [
      { memberId: 'm1', candidateId: 'c1', value: 'LOVE' },
      { memberId: 'm2', candidateId: 'c1', value: 'LIKE' },
      { memberId: 'm1', candidateId: 'c2', value: 'LIKE' },
      { memberId: 'm2', candidateId: 'c2', value: 'LOVE' },
    ];
    const scoredCandidates = scoreCandidates({ members, candidates, votes });
    const plan = {
      days: [{ activities: [{ attractionId: 'a2' }] }],
      estimatedCost: { perPerson: 150_000 },
    };

    const metrics = computePlanMetrics({ plan, scoredCandidates, members });
    expect(metrics.selectedAttractionIds).toEqual(['a2']);
    expect(metrics.consensusScore).toBeGreaterThan(70);
    expect(metrics.budgetComfortCount).toBe(2);
  });

  test('removed members do not count as voters', () => {
    const activeIds = ['m1', 'm2'];
    const votes = [
      { memberId: 'm1' },
      { memberId: 'm1' },
      { memberId: 'm3' },
    ];
    expect(votingMemberIds(votes, activeIds)).toEqual(['m1']);
  });
});
