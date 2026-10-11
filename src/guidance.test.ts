import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CORE_CAPSULE } from './coreCapsule';
import { newGuide, receiveGuide, recommend, restoreGuide, saveGuide } from './guidance';
import { guideLocation } from './guideLocation';
import { EndingRules, EndingSummary } from './EndingSummary';
import { GeographicMap } from './GeographicMap';
import type { Frame, Offer, SessionResponse } from './types';
import { emptyPlayReport } from './playReport.fixtures';

const offer = (entry: string, index = 71, destination?: string): Offer => ({ entry, index, label: entry, destination });
function response(offers: Offer[], revision = 0, site = 'ballroom_entrance', sessionId = 'fixture'): SessionResponse {
  const frame: Frame = {
    time: revision, ending: null, offers, observations: [],
    fields: { details: [], lifeState: 'alive', coldState: 'mobile', location: site, locationId: site, everflameCharges: 5, carriedReservoirCharges: null,
      coldCondition: 'mobile', movementSpeed: 5, chandelierClue: null, ritualSigns: null, protection: [] },
    scene: { playerSite: site, knownSites: [site], siteLabels: {}, routes: [] },
    information: { visibility: 'provided', visibilityNotice: '', visibleEntities: [], nearbyEntities: [], movements: [],
      ritual: { phase: 'unknown', label: '', evidence: 'unknown', recordedAt: null },
      escortResponse: { status: 'not_observed', label: '' }, timingNotice: '' },
  };
  return { frame, revision, sessionId, entries: [], playReport: emptyPlayReport() };
}
const first = offer('cross_ice_adventurer', 71, 'ritual_passage_entry');
const step = (entry: string) => CORE_CAPSULE.findIndex(row => row.entry === entry);
const attempt = (before: SessionResponse, chosen: Offer) => ({ sessionId: before.sessionId, revision: before.revision, offer: chosen });
function published(before: SessionResponse, chosen: Offer, site = before.frame.scene!.playerSite): SessionResponse {
  const next = response([], before.revision + 1, site, before.sessionId);
  next.frame.feedback = { entry: chosen.entry, actionLabel: chosen.label, status: 'published', text: '' };
  return next;
}

describe('capsule recommendations over public frames', () => {
  it('matches the real current index without mutating or removing options', () => {
    const before = response([offer('wait_adventurer', 4), first]);
    const original = JSON.stringify(before);
    expect(recommend(newGuide(before), before.frame)?.offer).toBe(first);
    expect(JSON.stringify(before)).toBe(original);
    expect(CORE_CAPSULE.some(row => 'index' in row || 'payload' in row)).toBe(false);
  });

  it('returns no fake option on a missing or ambiguous match', () => {
    const before = response([first, { ...first, index: 72 }]);
    expect(recommend(newGuide(before), before.frame)).toBeNull();
    before.frame.offers = [];
    expect(recommend(newGuide(before), before.frame)).toBeNull();
  });

  it('advances only after the recommended offer really publishes', () => {
    const before = response([first]);
    const state = newGuide(before);
    const next = receiveGuide(state, before, published(before, first, 'ritual_passage_entry'), attempt(before, first));
    expect(next.step).toBe(1);
    expect(next.revision).toBe(1);
    expect(next.paused).toBe(false);
  });

  it('does not advance after rejection, refresh, or a duplicate receipt', () => {
    const before = response([first]);
    const state = newGuide(before);
    const rejected = published(before, first);
    rejected.frame.feedback = { ...rejected.frame.feedback!, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } };
    const unchanged = receiveGuide(state, before, rejected, attempt(before, first));
    expect(unchanged.step).toBe(0);
    expect(unchanged.paused).toBe(false);
    expect(receiveGuide(state, before, before)).toBe(state);
    expect(receiveGuide(unchanged, rejected, rejected)).toBe(unchanged);
  });

  it('pauses on an unrelated action, unknown transition, or mismatched receipt', () => {
    const other = offer('observe_floor_adventurer', 3);
    const before = response([first, other]);
    const state = newGuide(before);
    expect(receiveGuide(state, before, published(before, other), attempt(before, other)).paused).toBe(true);
    expect(receiveGuide(state, before, published(before, first, 'ritual_passage_entry')).paused).toBe(true);
    expect(receiveGuide(state, before, published(before, other), attempt(before, first)).paused).toBe(true);
  });

  it('keeps the guide after a rejected off-route attempt because nothing happened', () => {
    const other = offer('observe_floor_adventurer', 3);
    const before = response([first, other]);
    const rejected = published(before, other);
    rejected.frame.feedback = { ...rejected.frame.feedback!, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } };
    rejected.frame.offers = before.frame.offers;
    const state = receiveGuide(newGuide(before), before, rejected, attempt(before, other));
    expect(state.step).toBe(0);
    expect(state.paused).toBe(false);
    expect(recommend(state, rejected.frame)?.offer).toBe(first);
  });

  it('keeps the crossing goal until a public arrival reaches it', () => {
    const before = response([first]);
    const landing = published(before, first, 'ballroom_opposite_wall');
    const state = receiveGuide(newGuide(before), before, landing, attempt(before, first));
    expect(state.step).toBe(0);
    expect(state.recovering).toBe(true);
    const recovery = offer('cross_ice_adventurer', 94, 'ballroom_entrance');
    landing.frame.offers = [recovery];
    expect(recommend(state, landing.frame)?.offer).toBe(recovery);
    const recovered = published(landing, recovery, 'ballroom_entrance');
    const stillCrossing = receiveGuide(state, landing, recovered, attempt(landing, recovery));
    expect(stillCrossing.step).toBe(0);
    recovered.frame.offers = [first];
    expect(recommend(stillCrossing, recovered.frame)?.offer).toBe(first);
  });

  it('does not invent or arbitrarily pick a recovery action', () => {
    const before = response([offer('cross_ice_adventurer', 5, 'other')]);
    expect(recommend(newGuide(before), before.frame)).toBeNull();
    const recovering = { ...newGuide(before), recovering: true, crossingOrigin: 'ballroom_entrance' };
    expect(recommend(recovering, before.frame)).toBeNull();
    before.frame.offers.push(offer('cross_ice_adventurer', 6, 'ballroom_entrance'));
    expect(recommend(recovering, before.frame)?.offer.index).toBe(6);
    before.frame.offers.push(offer('cross_ice_adventurer', 7, 'ballroom_entrance'));
    expect(recommend(recovering, before.frame)).toBeNull();
  });

  it('skips optional thaw only when it has no current offer, not when ambiguous', () => {
    const reload = offer('reload_everflame_adventurer', 8);
    const before = response([reload]);
    const state = { ...newGuide(before), step: step('thaw_floor_adventurer') };
    expect(recommend(state, before.frame)?.offer).toBe(reload);
    expect(state.step).toBe(step('thaw_floor_adventurer'));
    const thaw = offer('thaw_floor_adventurer', 6);
    before.frame.offers = [thaw, { ...thaw, index: 7 }, reload];
    expect(recommend(state, before.frame)).toBeNull();
  });

  it('remembers only the public target of the actual carry choice', () => {
    const carry = { ...offer('carry_from_ritual_adventurer'), targetIds: ['local-person'] };
    const before = response([carry]);
    const state = { ...newGuide(before), step: step(carry.entry!) };
    const next = receiveGuide(state, before, published(before, carry), attempt(before, carry));
    expect(next.residentId).toBe('local-person');
    expect(next).not.toHaveProperty('rescued');
  });

  it('never selects an unobserved or different resident', () => {
    const known = { ...offer('observe_resident_adventurer'), targetIds: ['known'] };
    const other = { ...known, index: 72, targetIds: ['other'] };
    const before = response([known, other]);
    const state = { ...newGuide(before), step: step(known.entry!) };
    expect(recommend(state, before.frame)).toBeNull();
    expect(recommend({ ...state, residentId: 'known' }, before.frame)?.offer).toBe(known);
  });

  it('invitation progresses a selection witness without claiming acceptance or rescue', () => {
    const invite = offer('offer_escort_adventurer');
    const before = response([invite]);
    const state = { ...newGuide(before), step: step(invite.entry!) };
    const next = receiveGuide(state, before, published(before, invite), attempt(before, invite));
    expect(next.step).toBe(state.step + 1);
    expect(next).not.toHaveProperty('accepted');
    expect(next).not.toHaveProperty('rescued');
  });

  it('does not reuse progress across sessions or recommend after termination', () => {
    const before = response([first]);
    const state = { ...newGuide(before), step: 10 };
    const other = response([first], 0, 'ballroom_entrance', 'new-session');
    expect(receiveGuide(state, before, other)).toEqual(newGuide(other));
    before.frame.ending = { title: '结束', narrationZh: '', id: 'departed_palace' };
    expect(recommend(newGuide(before), before.frame)).toBeNull();
    expect(recommend({ ...newGuide(other), paused: true }, other.frame)).toBeNull();
  });

  it('restores same-session UI progress but rejects mismatched or malformed storage', () => {
    const before = response([first]);
    let saved = '';
    const storage = { setItem: (_key: string, value: string) => { saved = value; }, getItem: () => saved };
    const state = { ...newGuide(before), step: 5 };
    saveGuide(storage, state);
    expect(restoreGuide(storage, before)).toEqual(state);
    expect(restoreGuide(storage, response([], 2)).paused).toBe(true);
    saved = JSON.stringify({ ...state, step: -1 });
    expect(restoreGuide(storage, before)).toEqual(newGuide(before));
    saved = '{';
    expect(restoreGuide(storage, before)).toEqual(newGuide(before));
    expect(() => saveGuide({ setItem: () => { throw Error('blocked'); } }, state)).not.toThrow();
  });
});

describe('visible recommendation markup', () => {
  it('does not inject a dock shortcut; highlights the offer at its original list position', async () => {
    vi.stubGlobal('window', { sessionStorage: undefined });
    const { QuickActions, ActionChoices, requiresActionConfirmation } = await import('./App');
    vi.unstubAllGlobals();
    const frame = response([offer('observe_floor_adventurer', 3), first]).frame;
    const dock = renderToStaticMarkup(createElement(QuickActions, { frame, blocked: false, onAct: () => {} }));
    expect(dock).not.toContain('data-recommended="true"');
    const all = renderToStaticMarkup(createElement(ActionChoices, { frame, offers: frame.offers, blocked: false,
      selectedIndex: null, recommendedIndex: first.index, onAct: () => {}, onPreview: () => {} }));
    expect(all).toContain('推荐');
    const ordinary = renderToStaticMarkup(createElement(ActionChoices, { frame, offers: frame.offers, blocked: false,
      selectedIndex: null, onAct: () => {}, onPreview: () => {} }));
    expect(all.match(/data-offer-index="\d+"/g)).toEqual(ordinary.match(/data-offer-index="\d+"/g));
    expect(all.match(/data-offer-index=/g)).toHaveLength(frame.offers.length);
    const disabled = renderToStaticMarkup(createElement(QuickActions, { frame, blocked: false, onAct: () => {} }));
    expect(disabled).not.toContain('data-recommended="true"');
    const observation = offer('observe_routes_adventurer', 42);
    expect(requiresActionConfirmation(observation, 42)).toBe(true);
    expect(requiresActionConfirmation(observation)).toBe(true);
  });

  it('marks only existing destination, surface, feature and observation contexts', () => {
    const before = response([first]);
    expect(guideLocation(before.frame, first)).toEqual({ kind: 'site', id: first.destination });
    const inspect = { ...offer('observe_resident_adventurer'), targetIds: ['known'] };
    before.frame.offers = [inspect];
    before.frame.information.visibleEntities = [{ id: 'known', kind: 'person', label: '居民',
      site: 'ballroom_entrance', state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current' }];
    expect(guideLocation(before.frame, inspect)).toEqual({ kind: 'surface', id: 'known' });
    before.frame.information.visibleEntities = [];
    expect(guideLocation(before.frame, inspect)).toEqual({ kind: 'observations' });
    const floor = offer('observe_floor_adventurer');
    before.frame.offers = [floor];
    expect(guideLocation(before.frame, floor)).toEqual({ kind: 'feature', id: 'floor' });
    before.frame.ending = { id: 'departed_palace', title: '离宫', narrationZh: '' };
    expect(guideLocation(before.frame, floor)).toBeNull();
  });

  it('renders an authoritative ending without claiming rescue, victory or hidden ritual truth', () => {
    const frame = response([]).frame;
    const render = () => renderToStaticMarkup(createElement(EndingSummary, { frame, report: { ...emptyPlayReport(), status: 'finished' }, onRestart: () => {}, onHistory: () => {} }));
    expect(render()).toBe('');
    frame.ending = { id: 'departed_palace', title: '离宫', narrationZh: '' };
    expect(render()).toContain('已完成离宫');
    expect(render()).toContain('没有取得仪式记录');
    expect(render()).not.toContain('获救');
    expect(render()).not.toContain('胜利');
    frame.ending = { id: 'rescue_window_expired', title: '救援窗口关闭', narrationZh: '旅程结束' };
    expect(render()).not.toContain('<dd>死亡</dd>');
    frame.ending = { id: 'adventurer_dead', title: '旅人死亡', narrationZh: '旅程结束' };
    expect(render()).toContain('<dd>死亡</dd>');
    expect(renderToStaticMarkup(createElement(EndingRules))).not.toContain('5 次寒冷结算');
  });

  it('marks only the actual individual recommended destination in both map sizes', () => {
    const frame = response([offer('move_adventurer', 1, 'ritual_threshold')], 1, 'ritual_passage_entry').frame;
    frame.scene!.knownSites = ['ritual_passage_entry', 'ritual_threshold'];
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(createElement(GeographicMap, { frame, compact,
        recommendedSite: 'ritual_threshold', onSelect: () => {}, onSelectEntity: () => {} }));
      expect(html).toMatch(/class="geographic-place[^\"]*recommended-location"[^>]*data-map-site="ritual_threshold"/);
      expect(html).not.toMatch(/class="geographic-place[^\"]*recommended-location"[^>]*data-map-site="ritual_passage_entry"/);
    }
  });
});
