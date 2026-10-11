import type { PersonalityAdvice, SessionResponse } from './types';
import { actionNote } from './tabletop';

export function guidanceIntent(session: SessionResponse, selected: string | null): string | undefined {
  const ids = session.intentOffers?.map(row => row.id) ?? [];
  return [selected, session.policy?.intentId, 'helpful_rescuer', ...ids]
    .find((id): id is string => typeof id === 'string' && ids.includes(id));
}

export function currentPersonalityAdvice(session: SessionResponse, advice: PersonalityAdvice | null,
  intentId: string | undefined, stopOnUnexpected: boolean) {
  if (!advice || advice.intentId !== intentId || advice.sessionId !== session.sessionId
    || advice.revision !== session.revision || advice.policyRevision !== session.policyRevision
    || advice.stopOnUnexpected !== stopOnUnexpected
    || session.frame.ending || session.policy?.status === 'running') return null;
  return advice;
}

export function personalityRecommendation(session: SessionResponse, advice: PersonalityAdvice | null,
  intentId: string | undefined, stopOnUnexpected: boolean) {
  advice = currentPersonalityAdvice(session, advice, intentId, stopOnUnexpected);
  if (!advice) return null;
  const choice = advice.choice;
  if (!choice) return null;
  const matches = session.frame.offers.filter(offer => offer.index === choice.index
    && offer.entry === choice.entry && offer.label === choice.label);
  if (matches.length !== 1) return null;
  return { offer: matches[0], stage: advice.label,
    reason: advice.plan?.goal ?? actionNote(matches[0], session.frame, false) };
}
