import { CORE_CAPSULE } from './coreCapsule';
import type { Frame, Offer, SessionResponse } from './types';

export interface GuideState {
  sessionId: string;
  revision: number;
  step: number;
  paused: boolean;
  residentId?: string;
  recovering: boolean;
  crossingOrigin?: string;
}
export interface Recommendation {
  offer: Offer;
  step: number;
  stage: string;
  reason: string;
  recovering: boolean;
}
export interface GuideAttempt { sessionId: string; revision: number; offer: Offer }

const STORAGE_KEY = 'm1-tabletop.core-guide.v1';
const site = (frame: Frame) => frame.scene?.playerSite ?? frame.fields.locationId;

export function newGuide(response: SessionResponse): GuideState {
  return { sessionId: response.sessionId, revision: response.revision, step: 0,
    paused: response.revision !== 0, recovering: false };
}

export function recommend(state: GuideState, frame: Frame): Recommendation | null {
  if (state.paused || frame.ending) return null;
  for (let cursor = state.step; cursor < CORE_CAPSULE.length; cursor++) {
    const step = CORE_CAPSULE[cursor];
    if (step.resident && !state.residentId) return null;
    const matches = frame.offers.filter(offer => offer.entry === step.entry &&
      (!step.destination || offer.destination === step.destination) &&
      (!step.resident || offer.targetIds?.includes(state.residentId!)));
    if (matches.length === 1) return { offer: matches[0], step: cursor, stage: step.stage,
      reason: step.reason, recovering: false };
    if (matches.length > 1) return null;
    if (step.entry === 'cross_ice_adventurer' && state.recovering) {
      const recovery = frame.offers.filter(offer => offer.entry === step.entry &&
        state.crossingOrigin !== undefined && offer.destination === state.crossingOrigin);
      if (recovery.length === 1) return { offer: recovery[0], step: cursor, stage: '重新站稳',
        reason: '先沿眼前可用的方向恢复行动，再继续原来的路线。', recovering: true };
    }
    if (!step.optional) return null;
  }
  return null;
}

export function receiveGuide(state: GuideState, before: SessionResponse | null,
  after: SessionResponse, attempt?: GuideAttempt | null): GuideState {
  if (state.sessionId !== after.sessionId) return newGuide(after);
  if (after.revision === state.revision) return state;
  if (after.revision < state.revision) return { ...state, paused: true };
  const updated = { ...state, revision: after.revision };
  if (!before || before.sessionId !== state.sessionId || before.revision !== state.revision ||
    !attempt || attempt.sessionId !== state.sessionId || attempt.revision !== state.revision ||
    after.revision !== state.revision + 1) return { ...updated, paused: true };
  if (after.frame.feedback?.status === 'rejected') return updated;
  if (after.frame.feedback?.status !== 'published' || after.frame.feedback.entry !== attempt.offer.entry)
    return { ...updated, paused: true };
  const choice = recommend(state, before.frame);
  if (!choice || choice.offer.index !== attempt.offer.index || choice.offer.entry !== attempt.offer.entry)
    return { ...updated, paused: true };
  const step = CORE_CAPSULE[choice.step];
  if (step.entry === 'cross_ice_adventurer' && site(after.frame) !== step.destination)
    return { ...updated, step: choice.step, recovering: true,
      crossingOrigin: state.crossingOrigin ?? site(before.frame) };
  const residentId = step.entry === 'carry_from_ritual_adventurer' && choice.offer.targetIds?.length === 1
    ? choice.offer.targetIds[0] : state.residentId;
  return { ...updated, step: choice.step + 1, recovering: false, crossingOrigin: undefined, residentId };
}

export function restoreGuide(storage: Pick<Storage, 'getItem'> | undefined, response: SessionResponse): GuideState {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (saved && saved.sessionId === response.sessionId && saved.revision === response.revision &&
      Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= CORE_CAPSULE.length &&
      typeof saved.paused === 'boolean' && typeof saved.recovering === 'boolean' &&
      (saved.crossingOrigin === undefined || typeof saved.crossingOrigin === 'string') &&
      (saved.residentId === undefined || typeof saved.residentId === 'string')) return saved;
  } catch { /* Unavailable UI storage never changes the Session. */ }
  return newGuide(response);
}

export function saveGuide(storage: Pick<Storage, 'setItem'> | undefined, state: GuideState) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { /* The world still runs if optional UI progress cannot be persisted. */ }
}
