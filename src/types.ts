export interface Offer {
  index: number;
  entry?: string;
  label: string;
  destination?: string;
  movementKind?: string;
  targetIds?: string[];
  forecasts?: { label: string; value?: string | number | boolean }[];
  passageWarning?: {
    floorState: 'unknown' | 'frozen' | 'clear';
    lastAttemptBlocked: boolean;
    crossingIndexes: number[];
  };
}

export interface RecordedAt { time: number; revision: number }
export type RitualPhase = 'unknown' | 'preparing' | 'gathering' | 'critical' | 'disrupted' | 'completed';

export interface Observation {
  id: string;
  kind: string;
  label: string;
  site: string | null;
  state: string;
  evidence: string;
  facts: { label: string; value: string }[];
  presence: 'not_confirmed';
  recordedAt: RecordedAt;
  detailRecordedAt: RecordedAt | null;
}

export interface SurfaceEntity {
  id: string;
  kind: 'person' | 'elemental' | 'chandelier' | 'reservoir' | 'everflame';
  label: string;
  site: string;
  state: 'unknown';
  facts: [];
  evidence: 'current_surface';
  presence: 'current';
}

export interface MovementObservation {
  id: string;
  subjectId: string;
  label: string;
  start: string;
  end: string;
  recordedAt: RecordedAt;
}

export interface EscortReplyObservation {
  id: string;
  subjectId: string;
  label: string;
  site: string;
  destination: string;
  status: 'ready_now' | 'not_ready_now' | 'unable_now';
  recordedAt: RecordedAt;
}

export interface PlayerInformation {
  visibleEntities: SurfaceEntity[];
  nearbyEntities: SurfaceEntity[];
  visibility: 'provided' | 'unavailable' | 'not_provided';
  visibilityNotice: string;
  ritual: { phase: RitualPhase; label: string; evidence: string; recordedAt: RecordedAt | null };
  movements: MovementObservation[];
  escortReplies?: EscortReplyObservation[];
  escortResponse: { status: 'not_observed' | 'movement_observed' | 'reply_heard'; label: string };
  timingNotice: string;
}

export type Discovery =
  | { kind: 'observation'; change: 'new' | 'updated'; observation: Observation }
  | { kind: 'ritual'; phase: RitualPhase; label: string }
  | { kind: 'movement'; movement: MovementObservation }
  | { kind: 'escort_reply'; reply: EscortReplyObservation };

export interface Change { field: string; before?: string | number | boolean; after: string | number | boolean }

export const REFUSAL_CODES = ['K0_NOT_ADMITTED', 'C0_BINDING_REJECTED', 'UNPUBLISHED_RESULT'] as const;
export type RefusalCode = typeof REFUSAL_CODES[number];

export interface Frame {
  briefing?: string;
  time: number;
  fields: {
    details: { label: string; value: string }[];
    lifeState: 'alive' | 'incapacitated' | 'dead' | null;
    coldState: 'mobile' | 'frozen' | 'immune' | null;
    location: string;
    locationId?: string;
    everflameCharges: number;
    carriedReservoirCharges: number | null;
    coldCondition: string;
    movementSpeed: number;
    maxMovementSpeed?: number | null;
    life?: string | null;
    endurance?: number | null;
    maxEndurance?: number | null;
    gold?: number | null;
    chandelierClue: string | null;
    ritualSigns: string | null;
    protection: { siteId?: string; site: string; now: string; afterSpendOne: string }[];
  };
  scene?: {
    playerSite: string;
    knownSites: string[];
    siteLabels: Record<string, string>;
    routes: { start: string; end: string; kind: string }[];
  };
  information: PlayerInformation;
  observations: Observation[];
  offers: Offer[];
  feedback?: {
    entry?: string;
    actionLabel: string;
    text: string;
    result?: {
      landing?: string;
      target?: string;
      collision?: boolean;
      movementAttempt?: { start: string; destination: string; landing: string; outcome: 'arrived' | 'blocked' };
      elapsed?: { action: number; subsequent: number };
      changes: Change[];
      laterChanges: Change[];
      discoveries: Discovery[];
      laterDiscoveries: Discovery[];
      rolls?: { kind: string; value: number }[];
      laterRolls?: { kind: string; value: number }[];
    } | null;
  } & ({ status: 'published'; refusal?: never } | { status: 'rejected'; refusal: { code: RefusalCode } }) | null;
  ending: { title: string; narrationZh: string; id: string } | null;
}

export interface IntentOffer {
  id: string;
  label: string;
  description: string;
  maxActions: number;
}

export interface PolicyStartSettings {
  maxActions: number;
  stopOnUnexpected: boolean;
}

export interface PolicyStartRequest extends PolicyStartSettings {
  intentId: string;
}

export interface PersonalityAdvice {
  sessionId: string;
  revision: number;
  policyRevision: number;
  intentId: string;
  label: string;
  stopOnUnexpected: boolean;
  choice: null | { index: number; entry: string; label: string; score: number; reason: string };
  plan: IntentPolicy['plan'];
  reason: string | null;
}

export interface IntentPolicy {
  id: string | null;
  intentId: string | null;
  status: 'idle' | 'running' | 'stopped';
  label: string | null;
  reason: string | null;
  stopDetail: null | { code: string; choices: { index: number; label: string }[] };
  executed: number;
  limit: number;
  stopOnUnexpected: boolean;
  plan: null | {
    goal: string;
    targetSite: string;
    route: { site: string; label: string }[];
    estimatedActions: number;
    estimatedGain: number;
    value: number;
    uncertainty: string;
  };
  steps: {
    entry: string;
    label: string;
    index: number;
    score: number;
    reason: string;
    beforeRevision: number;
    afterRevision: number;
    beforeTime: number;
    afterTime: number;
    beforeSite: string;
    afterSite: string;
  }[];
}

export interface PlayScores {
  common: number;
  cautious_investigator: number;
  helpful_rescuer: number;
  decisive_explorer: number;
  cost: number;
}

export interface PlayReport {
  schema: 'm1.play_report.v1';
  status: 'ongoing' | 'finished';
  scores: PlayScores;
  efficiency: {
    cautious_investigator: number | null;
    helpful_rescuer: number | null;
    decisive_explorer: number | null;
  };
  metrics: {
    publishedActions: number;
    manualActions: number;
    delegatedActions: number;
    rejectedAttempts: number;
    elapsed: number;
    visitedPlaces: number;
    peopleDetailed: number;
    peopleThawed: number;
    ritualDisrupted: number;
    departed: number;
    failed: number;
    enduranceSpent: number;
    knownChargeSpent: number;
  };
  achievements: { id: string; label: string; evidence: string }[];
  actions: {
    number: number;
    label: string;
    entry: string;
    mode: 'manual' | 'delegated';
    personality: string | null;
    timeBefore: number;
    timeAfter: number;
    thawedTargetId?: string;
    achievements: string[];
    scoreDelta: PlayScores;
  }[];
  rescuesConfirmed: null;
  scoreRulesDigest: string;
}

export interface SessionResponse {
  sessionId: string;
  revision: number;
  frame: Frame;
  entries: { id: number; kind: string; text: string; detail?: string }[];
  playReport: PlayReport;
  // Manual-only sessions may predate the policy API rollout.
  intentOffers?: IntentOffer[];
  policy?: IntentPolicy;
  policyRevision?: number;
}
