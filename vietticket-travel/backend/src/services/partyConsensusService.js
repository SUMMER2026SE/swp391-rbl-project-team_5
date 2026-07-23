'use strict';

const ALGORITHM_VERSION = 'PARTY_CONSENSUS_V1';
const VOTE_SATISFACTION = Object.freeze({
  LOVE: 1,
  LIKE: 0.7,
  VETO: -1,
});

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function mean(values) {
  const finite = (values || []).filter(Number.isFinite);
  return finite.length > 0
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : 0;
}

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function memberPreferences(member) {
  const preferences = member?.preferences;
  const values = Array.isArray(preferences)
    ? preferences
    : Array.isArray(preferences?.categories)
      ? preferences.categories
      : [];
  return [...new Set(values.map(normalizedText).filter(Boolean))].slice(0, 5);
}

function candidateCategories(candidate) {
  const snapshot = candidate?.snapshot || {};
  return (Array.isArray(snapshot.categories) ? snapshot.categories : [])
    .map(normalizedText)
    .filter(Boolean);
}

function hasPreferenceMatch(member, candidate) {
  const preferences = memberPreferences(member);
  if (preferences.length === 0) return false;
  const categories = candidateCategories(candidate);
  return preferences.some((preference) =>
    categories.some((category) =>
      category.includes(preference) || preference.includes(category),
    ),
  );
}

function candidatePrice(candidate) {
  const value = Number(candidate?.snapshot?.minPrice);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function memberBudget(member) {
  const value = Number(member?.budgetCap);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function scoreCandidates({ candidates = [], members = [], votes = [] } = {}) {
  const activeMembers = members.filter((member) => !member.removedAt);
  const voteByKey = new Map(
    votes.map((vote) => [`${vote.memberId}:${vote.candidateId}`, vote]),
  );

  return candidates
    .map((candidate) => {
      const price = candidatePrice(candidate);
      const vetoMemberIds = [];
      const satisfactionByMember = {};
      let preferenceMatches = 0;
      let declaredBudgets = 0;
      let comfortableBudgets = 0;

      activeMembers.forEach((member) => {
        const vote = voteByKey.get(`${member.id}:${candidate.id}`);
        if (vote?.value === 'VETO') vetoMemberIds.push(member.id);

        const preferenceMatch = hasPreferenceMatch(member, candidate);
        if (preferenceMatch) preferenceMatches += 1;

        const budget = memberBudget(member);
        if (budget != null) {
          declaredBudgets += 1;
          if (price == null || price <= budget) comfortableBudgets += 1;
        }

        const voteScore = vote?.value
          ? VOTE_SATISFACTION[vote.value]
          : 0.35;
        const preferenceBonus = preferenceMatch ? 0.1 : 0;
        const budgetAdjustment =
          budget == null || price == null
            ? 0
            : price <= budget
              ? 0.05
              : -0.15;
        satisfactionByMember[member.id] = voteScore < 0
          ? 0
          : clamp(voteScore + preferenceBonus + budgetAdjustment);
      });

      const satisfaction = Object.values(satisfactionByMember);
      const averageSatisfaction = mean(satisfaction);
      const minimumSatisfaction =
        satisfaction.length > 0 ? Math.min(...satisfaction) : 0;
      const budgetComfortRatio =
        declaredBudgets > 0 ? comfortableBudgets / declaredBudgets : 1;
      const preferenceMatchRatio =
        activeMembers.length > 0 ? preferenceMatches / activeMembers.length : 0;
      const rating = clamp(Number(candidate?.snapshot?.rating || 0) / 5);
      const score =
        averageSatisfaction * 0.45
        + minimumSatisfaction * 0.25
        + budgetComfortRatio * 0.15
        + rating * 0.1
        + preferenceMatchRatio * 0.05;

      return {
        candidateId: candidate.id,
        attractionId: candidate.attractionId,
        title: candidate.snapshot?.title || 'Điểm tham quan',
        position: Number(candidate.position || 0),
        score: clamp(score),
        averageSatisfaction,
        minimumSatisfaction,
        budgetComfortRatio,
        preferenceMatchRatio,
        satisfactionByMember,
        vetoMemberIds,
        excluded: vetoMemberIds.length > 0,
      };
    })
    .sort((left, right) =>
      Number(left.excluded) - Number(right.excluded)
      || right.score - left.score
      || left.position - right.position
      || left.candidateId.localeCompare(right.candidateId),
    );
}

function selectConsensusCandidates(scoredCandidates, targetCount) {
  const count = Math.max(1, Number(targetCount) || 1);
  const eligible = (scoredCandidates || []).filter((candidate) => !candidate.excluded);
  return {
    eligible,
    selected: eligible.slice(0, count),
    vetoed: (scoredCandidates || []).filter((candidate) => candidate.excluded),
  };
}

function computePlanMetrics({ plan, scoredCandidates, members }) {
  const activities = (plan?.days || []).flatMap((day) => day.activities || []);
  const selectedAttractionIds = [
    ...new Set(activities.map((activity) => activity.attractionId).filter(Boolean)),
  ];
  const scoreByAttraction = new Map(
    (scoredCandidates || []).map((candidate) => [candidate.attractionId, candidate]),
  );
  const activeMembers = (members || []).filter((member) => !member.removedAt);
  const satisfactionByMember = {};

  activeMembers.forEach((member) => {
    const values = selectedAttractionIds
      .map((attractionId) => scoreByAttraction.get(attractionId)?.satisfactionByMember?.[member.id])
      .filter(Number.isFinite);
    satisfactionByMember[member.id] = values.length > 0 ? mean(values) : 0;
  });

  const memberSatisfactionValues = Object.values(satisfactionByMember);
  const averageSatisfaction = mean(memberSatisfactionValues);
  const minimumSatisfaction =
    memberSatisfactionValues.length > 0 ? Math.min(...memberSatisfactionValues) : 0;
  const perPersonCost = Number(plan?.estimatedCost?.perPerson || 0);
  const declaredBudgets = activeMembers
    .map(memberBudget)
    .filter((value) => value != null);
  const budgetComfortCount = declaredBudgets.filter(
    (budget) => perPersonCost <= budget,
  ).length;
  const budgetComfortRatio =
    declaredBudgets.length > 0 ? budgetComfortCount / declaredBudgets.length : 1;
  const consensusScore = clamp(
    averageSatisfaction * 0.55
    + minimumSatisfaction * 0.3
    + budgetComfortRatio * 0.15,
  );

  return {
    consensusScore: Math.round(consensusScore * 100),
    averageSatisfaction: Math.round(averageSatisfaction * 100),
    minimumSatisfaction: Math.round(minimumSatisfaction * 100),
    budgetComfortCount,
    declaredBudgetCount: declaredBudgets.length,
    perPersonCost,
    selectedAttractionIds,
    satisfactionByMember: Object.fromEntries(
      Object.entries(satisfactionByMember).map(([key, value]) => [
        key,
        Math.round(value * 100),
      ]),
    ),
  };
}

function votingMemberIds(votes, activeMemberIds) {
  const active = new Set(activeMemberIds || []);
  return [...new Set(
    (votes || [])
      .filter((vote) => active.has(vote.memberId))
      .map((vote) => vote.memberId),
  )];
}

module.exports = {
  ALGORITHM_VERSION,
  VOTE_SATISFACTION,
  computePlanMetrics,
  hasPreferenceMatch,
  memberPreferences,
  scoreCandidates,
  selectConsensusCandidates,
  votingMemberIds,
};
