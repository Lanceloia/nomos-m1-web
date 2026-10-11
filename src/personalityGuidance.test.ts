import { describe, expect, it, vi, afterEach } from 'vitest';
import { SessionClient } from './client';
import { guidanceIntent, personalityRecommendation } from './personalityGuidance';
import { emptyPlayReport } from './playReport.fixtures';
import type { PersonalityAdvice, SessionResponse } from './types';

function fixture() {
  const session = { sessionId: 'test', revision: 18, policyRevision: 3,
    intentOffers: ['helpful_rescuer', 'decisive_explorer'].map(id => ({ id, label: id })),
    frame: { ending: null, offers: [{ index: 57, entry: 'observe_routes_adventurer', label: 'Routes' }] },
    entries: [], playReport: emptyPlayReport() } as unknown as SessionResponse;
  const advice: PersonalityAdvice = { sessionId: 'test', revision: 18, policyRevision: 3,
    intentId: 'helpful_rescuer', label: '热心救助者', plan: null, reason: null, stopOnUnexpected: true,
    choice: { index: 57, entry: 'observe_routes_adventurer', label: 'Routes', score: 18, reason: '查看眼前通路' } };
  return { session, advice };
}

afterEach(() => vi.unstubAllGlobals());

describe('current personality highlights, independent of capsule progress', () => {
  it('highlights the current offer after arbitrary manual history', () => {
    const { session, advice } = fixture();
    expect(personalityRecommendation(session, advice, 'helpful_rescuer', true)?.offer).toBe(session.frame.offers[0]);
    expect(personalityRecommendation(session, advice, 'helpful_rescuer', true)?.reason).toBe('了解附近有哪些通路，再选择前进方向。');
  });
  it.each([{ revision: 17 }, { policyRevision: 2 }, { sessionId: 'other' }, { intentId: 'decisive_explorer' }])(
    'does not display stale or wrong-personality advice %j', mismatch => {
      const { session, advice } = fixture();
      expect(personalityRecommendation(session, { ...advice, ...mismatch }, 'helpful_rescuer', true)).toBeNull();
    });
  it('requires the exact current index, entry and label; missing and ambiguous offers stay unmarked', () => {
    const { session, advice } = fixture();
    for (const choice of [{ ...advice.choice!, index: 1 }, { ...advice.choice!, entry: 'other' },
      { ...advice.choice!, label: 'old' }, null]) {
      expect(personalityRecommendation(session, { ...advice, choice }, 'helpful_rescuer', true)).toBeNull();
    }
    session.frame.offers.push({ ...session.frame.offers[0] });
    expect(personalityRecommendation(session, advice, 'helpful_rescuer', true)).toBeNull();
  });
  it('suppresses advice during automatic execution and at an ending', () => {
    const { session, advice } = fixture();
    session.policy = { status: 'running' } as SessionResponse['policy'];
    expect(personalityRecommendation(session, advice, 'helpful_rescuer', true)).toBeNull();
    session.policy = undefined;
    session.frame.ending = { id: 'departed_palace', title: '离宫', narrationZh: '' };
    expect(personalityRecommendation(session, advice, 'helpful_rescuer', true)).toBeNull();
  });
  it('immediately suppresses a previous safety setting before the replacement request finishes', () => {
    const { session, advice } = fixture();
    expect(personalityRecommendation(session, advice, 'helpful_rescuer', false)).toBeNull();
    expect(personalityRecommendation(session, { ...advice, stopOnUnexpected: false }, 'helpful_rescuer', false)?.offer)
      .toBe(session.frame.offers[0]);
  });
  it('uses explicit selected personality, then current control preference, then a real available default', () => {
    const { session } = fixture();
    expect(guidanceIntent(session, null)).toBe('helpful_rescuer');
    expect(guidanceIntent(session, 'decisive_explorer')).toBe('decisive_explorer');
    session.policy = { intentId: 'decisive_explorer' } as SessionResponse['policy'];
    expect(guidanceIntent(session, null)).toBe('decisive_explorer');
    session.intentOffers = [];
    expect(guidanceIntent(session, 'decisive_explorer')).toBeUndefined();
  });
  it('requests advice without changing session transport identity or executing an action', async () => {
    const { session, advice } = fixture();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(session)))
      .mockResolvedValueOnce(new Response(JSON.stringify(advice)))
      .mockResolvedValueOnce(new Response(JSON.stringify(session)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient();
    await client.start();
    expect(await client.advice(session, 'helpful_rescuer', true)).toEqual(advice);
    expect(fetcher.mock.calls[1][0]).toBe('/api/sessions/test/advice');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ revision: 18, policyRevision: 3,
      intentId: 'helpful_rescuer', stopOnUnexpected: true });
    await client.refresh();
    expect(fetcher.mock.calls[2][0]).toBe('/api/sessions/test');
  });
  it('an advice failure does not make manual submission uncertain', async () => {
    const { session } = fixture();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(session)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'stale advice' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session)));
    vi.stubGlobal('fetch', fetcher);
    const client = new SessionClient();
    await client.start();
    await expect(client.advice(session, 'helpful_rescuer', true)).rejects.toThrow('stale advice');
    await client.choose(57);
    expect(fetcher.mock.calls[2][0]).toBe('/api/sessions/test/actions');
  });
});
