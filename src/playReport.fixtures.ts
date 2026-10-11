import type { PlayReport } from './types';

// Public-response fixtures only, not evidence of engine execution.
export function emptyPlayReport(): PlayReport {
  return {
    schema: 'm1.play_report.v1', status: 'ongoing',
    scores: { common: 0, cautious_investigator: 0, helpful_rescuer: 0, decisive_explorer: 0, cost: 0 },
    efficiency: { cautious_investigator: null, helpful_rescuer: null, decisive_explorer: null },
    metrics: {
      publishedActions: 0, manualActions: 0, delegatedActions: 0, rejectedAttempts: 0,
      elapsed: 0, visitedPlaces: 0, peopleDetailed: 0, peopleThawed: 0, ritualDisrupted: 0,
      departed: 0, failed: 0, enduranceSpent: 0, knownChargeSpent: 0,
    },
    achievements: [], actions: [], rescuesConfirmed: null, scoreRulesDigest: 'public-test-rules',
  };
}
