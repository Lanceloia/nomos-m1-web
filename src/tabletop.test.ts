import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  actionName, actionNote, CHANDELIER_NOTICES, contextOffers, emptyDiscoveryNote, feedbackText, feedbackTitle, journeyGuidance, locationNote, memoriesAtSite,
  needsConfirmation, observationOffers, places, publicCost, publishedResult, recordedAt, siteName, tableFeatures, targetNames, text,
  adjacentSites, historicalTargetWarning, movementDescription, offerGroups, PUBLIC_FEEDBACK_TEXT, publicTowerDialogue, recoveryNote, recoveryOffers, routeReadbackChanges, sessionRouteChanges, timingGuidance,
} from './tabletop';
import type { Frame, Offer } from './types';

export const frame: Frame = {
  time: 0, ending: null,
  fields: { details: [], lifeState: 'alive', coldState: 'mobile', location: 'Ballroom entrance', locationId: 'ballroom_entrance', everflameCharges: 5, carriedReservoirCharges: null, coldCondition: 'Able to move', movementSpeed: 5, chandelierClue: null, ritualSigns: null, protection: [] },
  information: {
    visibleEntities: [], nearbyEntities: [], movements: [], visibility: 'not_provided', visibilityNotice: '当前在场尚未确认；下面的对象是你取得过的观察。',
    ritual: { phase: 'unknown', label: '尚未察觉仪式现况', evidence: 'unknown', recordedAt: null },
    escortResponse: { status: 'not_observed', label: '尚未取得护送邀请的回应观察。' },
    timingNotice: '观察和其他行动都会推进寒冷与仪式；停下来思考不会推进世界。',
  },
  scene: { playerSite: 'ballroom_entrance', knownSites: ['ballroom_entrance', 'ballroom_chandelier_reach', 'ritual_ring'], siteLabels: {}, routes: [] },
  offers: [
    { index: 14, entry: 'cross_ice_adventurer', label: 'Cross', destination: 'ballroom_chandelier_reach' },
    { index: 27, entry: 'observe_floor_adventurer', label: 'Inspect' },
    { index: 31, entry: 'thaw_person_adventurer', label: 'Thaw', targetIds: ['seen-1'] },
  ],
  observations: [{ id: 'seen-1', kind: 'person', label: '大厅居民一', site: 'ballroom_entrance', state: 'frozen', evidence: 'last_observed', facts: [{ label: '生命', value: 'Alive' }], presence: 'not_confirmed', recordedAt: { time: 0, revision: 0 }, detailRecordedAt: { time: 0, revision: 0 } }],
};

const result = { changes: [], laterChanges: [], discoveries: [], laterDiscoveries: [] };

const surfaceFrame: Frame = { ...frame,
  fields: { ...frame.fields, location: 'Beneath the chandelier', locationId: 'ballroom_chandelier_reach' },
  observations: [{ ...frame.observations[0], id: 'seen-99', site: 'halls_ballroom_door' }],
  scene: { ...frame.scene!, playerSite: 'ballroom_chandelier_reach' },
  information: { ...frame.information, visibility: 'provided', visibilityNotice: '当前表面仅确认同区存在，详细状态未知。', visibleEntities: [
    { id: 'seen-2', kind: 'chandelier', label: '枝形吊灯', site: 'ballroom_chandelier_reach', state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current' },
    { id: 'seen-3', kind: 'reservoir', label: '吊灯储能器', site: 'ballroom_chandelier_reach', state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current' },
    { id: 'seen-1', kind: 'everflame', label: '永焰', site: 'ballroom_chandelier_reach', state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current' },
    { id: 'seen-4', kind: 'person', label: '吊灯旁居民一', site: 'ballroom_chandelier_reach', state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current' },
    { id: 'seen-5', kind: 'person', label: '吊灯旁居民二', site: 'ballroom_chandelier_reach', state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current' },
  ] },
  offers: [
    { index: 17, entry: 'observe_chandelier_adventurer', label: 'Observe and call beneath the chandelier', targetIds: ['seen-2', 'seen-3'] },
    { index: 19, entry: 'observe_routes_adventurer', label: 'Look for routes from here' },
    { index: 23, entry: 'offer_escort_adventurer', label: 'Call out an offer of escort to the palace exit' },
    { index: 31, entry: 'wait_adventurer', label: 'Wait' },
  ],
};

const ritualOffers: Offer[] = [
  { index: 58, entry: 'wait_adventurer', label: 'Wait' },
  { index: 63, entry: 'observe_foxes_adventurer', label: 'Look for foxes here' },
  { index: 74, entry: 'observe_climbs_adventurer', label: 'Inspect reachable climbing surfaces' },
  { index: 87, entry: 'observe_resident_adventurer', label: 'Observe the resident: Resident at the ritual', targetIds: ['seen-1'] },
  { index: 93, entry: 'carry_from_ritual_adventurer', label: 'Carry toward the threshold: Resident at the ritual', targetIds: ['seen-1'], destination: 'ritual_threshold' },
  { index: 102, entry: 'offer_torch_adventurer', label: 'Offer Everflame and mention the threshold to Resident at the ritual', targetIds: ['seen-1'] },
  { index: 115, entry: 'observe_routes_adventurer', label: 'Look for routes from here' },
];
const ritualFrame: Frame = { ...frame,
  scene: { ...frame.scene!, playerSite: 'ritual_ring' },
  information: { ...frame.information, ritual: { phase: 'critical', label: '曾察觉仪式接近完成', evidence: 'local_record', recordedAt: { time: 300, revision: 3 } } },
  observations: [{ ...frame.observations[0], label: '仪式处居民', site: 'ritual_ring' }],
  offers: ritualOffers,
};

describe('tabletop projection', () => {
  it('uses only current offers, retaining actual indices', () => {
    expect(contextOffers(frame, { kind: 'site', id: 'ballroom_chandelier_reach' }).map(o => o.index)).toEqual([14]);
    expect(contextOffers(frame, { kind: 'site', id: 'ballroom_entrance' }).map(o => o.index)).toEqual([27, 31]);
    expect(contextOffers(frame, { kind: 'object', id: 'seen-1' }).map(o => o.index)).toEqual([31]);
    expect(contextOffers(frame, { kind: 'all' })).toEqual(frame.offers);
  });
  it('lists only real public observation entries without making them target-associated', () => {
    expect(contextOffers(surfaceFrame, { kind: 'surface', id: 'seen-4' })).toEqual([]);
    expect(contextOffers(surfaceFrame, { kind: 'surface', id: 'seen-2' }).map(o => o.index)).toEqual([17]);
    expect(observationOffers(surfaceFrame).map(o => o.index)).toEqual([17, 19]);
    expect(contextOffers(surfaceFrame, { kind: 'observations' })).toEqual(observationOffers(surfaceFrame));
    expect(surfaceFrame.offers[0].targetIds).toEqual(['seen-2', 'seen-3']);
  });
  it('translates the existing public person and place vocabulary without deriving new labels', () => {
    const people = [
      ['First resident by the chandelier', '吊灯旁居民一'], ['Second resident by the chandelier', '吊灯旁居民二'],
      ['Resident at the ritual', '仪式处居民'], ['Resident trapped in ice', '冰中受困居民'],
      ['First person in the hall', '大厅居民一'], ['Second person in the hall', '大厅居民二'],
      ['Third person in the hall', '大厅居民三'], ['Fourth person in the hall', '大厅居民四'], ['Fifth person in the hall', '大厅居民五'],
    ];
    const sites = [
      'Outside shore beyond the bridge', 'Halls beside the ballroom', 'Halls beside the bridge stair',
      'Halls wall (collision point)', 'Palace bridgehead above the abyss', 'Narrow bridge above the abyss',
      'Ballroom ice-bar door', 'Ice bar', 'Ritual lower stair', 'Lower passage', 'Lower passage wall (collision point)',
      'Before the frozen stable door', 'Beyond the frozen stable door', 'Stable wall after a slide',
      'Outside the prison guard line', 'Prison holding area', 'Deeper in the prison', 'Inside the barred cell',
      'Ballroom entrance', 'Ritual passage', 'Ritual threshold', 'Ritual circle', 'Beneath the chandelier',
      'Ballroom far wall (collision point)', 'Wall beyond the chandelier (collision point)',
      'Ice-bar-side wall (collision point)', 'Ritual passage wall (collision point)',
      'Treasure corridor', 'Release side of the ice wall', 'Beyond the treasure wall', 'Inside the ice wall', 'Abyss below the palace bridge',
    ];
    for (const [original, translated] of people) expect(text(original)).toBe(translated);
    for (const label of sites) {
      expect(text(label)).not.toMatch(/[A-Za-z]/);
      const located = { ...frame, scene: { ...frame.scene!, siteLabels: { 'public-place': label } } };
      expect(siteName('public-place', located)).toBe(text(label));
    }
    expect(text('Unnamed public label')).toBe('Unnamed public label');
    expect(text('private_actor_ref')).toBe('未知');
  });
  it('does not invent routes, sites, unseen people, or object actions', () => {
    expect(places({ ...frame, scene: undefined, offers: [] }).map(p => p.id)).toEqual(['ballroom_entrance']);
    expect(places(frame).map(p => p.id)).not.toContain('ritual_ring');
    expect(contextOffers(frame, { kind: 'object', id: 'unseen-person' })).toEqual([]);
    expect(memoriesAtSite({ ...frame, observations: [] }, 'ballroom_entrance')).toEqual([]);
  });
  it('keeps historical people across location changes without inferring presence', () => {
    const observations = [...frame.observations, { ...frame.observations[0], id: 'seen-2', label: 'Second person in the hall', site: 'ritual_ring' }];
    const changed = { ...frame, observations, scene: { ...frame.scene!, playerSite: 'ritual_ring' } };
    expect(memoriesAtSite(changed, 'ballroom_entrance')).toHaveLength(1);
    expect(changed.observations.map(o => o.id)).toEqual(['seen-1', 'seen-2']);
    expect(changed.information.visibleEntities).toEqual([]);
    expect(changed.observations.every(o => o.presence === 'not_confirmed')).toBe(true);
    expect(places(changed).map(p => p.id)).not.toContain('ballroom_entrance');
  });
  it('retains unskinned offered locations but does not display opaque identity', () => {
    const changed = { ...frame, offers: [{ index: 1, label: 'Go', destination: 'new-area-ref' }] };
    expect(places(changed).find(p => p.id === 'new-area-ref')?.label).toBe('未知地点');
    expect(siteName('private_actor_ref', frame)).toBe('未知地点');
    expect(text('seen-99')).toBe('未知');
    expect(text('Person Ref(owner=secret)')).toBe('未知');
    expect(text('private_actor_ref')).toBe('未知');
    expect(text({ owner: 'secret' })).toBe('未知');
  });
  it('reports actual landing, not intended success or presumed collision', () => {
    const moved = { ...frame, feedback: { status: 'published' as const, actionLabel: 'Cross', text: 'Published', result: { ...result, target: 'ballroom_chandelier_reach', landing: 'ballroom_opposite_wall' } } };
    expect(feedbackTitle(moved)).toContain('未达目标');
    expect(feedbackTitle(moved)).not.toContain('碰撞');
    expect(feedbackTitle({ ...moved, feedback: { ...moved.feedback, result: { ...moved.feedback.result, collision: true } } })).toContain('碰撞');
    expect(feedbackTitle({ ...moved, feedback: { ...moved.feedback, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } } })).toBe('行动未发生');
    expect(publishedResult({ ...moved, feedback: { ...moved.feedback, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } } })).toBeNull();
  });
  it('reads cost only from explicit public wording', () => {
    expect(publicCost({ index: 0, label: 'Spend one charge to thaw a person' })).toContain('1');
    expect(publicCost({ index: 0, label: 'Mystery', entry: 'thaw_person_adventurer' })).toBeNull();
  });
  it('keeps public affordances separate from unseen residents', () => {
    expect(tableFeatures(frame).map(f => f.id)).toEqual(['floor']);
    expect(tableFeatures({ ...frame, offers: [] })).toEqual([]);
    expect(contextOffers(frame, { kind: 'feature', id: 'floor' }).map(o => o.index)).toEqual([27]);
  });
  it.each(Object.entries(CHANDELIER_NOTICES))('translates the full authored clue without generating people: %s', (original, translated) => {
    expect(text(original)).toBe(translated);
    expect(text(original)).not.toMatch(/[A-Za-z]/);
    const changed = { ...frame, fields: { ...frame.fields, carriedReservoirCharges: 2, chandelierClue: original } };
    expect(tableFeatures(changed).map(f => f.id)).not.toContain('voices');
    expect(changed.observations).toBe(frame.observations);
    expect(tableFeatures(changed).map(f => f.id)).not.toContain('reservoir');
  });
  it('covers all six authored response/pulse branches', () => {
    expect(Object.keys(CHANDELIER_NOTICES)).toHaveLength(6);
    expect(Object.values(CHANDELIER_NOTICES).filter(v => v.startsWith('吊灯下有两人'))).toHaveLength(2);
    expect(Object.values(CHANDELIER_NOTICES).filter(v => v.startsWith('吊灯下有一人'))).toHaveLength(2);
    expect(Object.values(CHANDELIER_NOTICES).filter(v => v.startsWith('没有人回应'))).toHaveLength(2);
  });
  it('offers escort only from the actual action and never claims acceptance', () => {
    const changed = { ...frame, offers: [{ index: 47, entry: 'offer_escort_adventurer', label: 'Call' }] };
    expect(tableFeatures(changed).find(f => f.id === 'voices')?.note).toBe(frame.information.escortResponse.label);
    expect(contextOffers(changed, { kind: 'feature', id: 'voices' })[0].index).toBe(47);
    expect(actionNote(changed.offers[0], changed)).toContain('邀请他们一起离开');
  });
  it('confirms public targets, destinations, forecasts and costs but not ordinary actions', () => {
    expect(needsConfirmation({ index: 1, label: 'Look', entry: 'observe_floor_adventurer' })).toBe(false);
    expect(needsConfirmation({ index: 1, label: 'Wait', entry: 'wait_adventurer', forecasts: [], targetIds: [] })).toBe(false);
    expect(needsConfirmation({ index: 1, label: 'Go', destination: 'ballroom_entrance' })).toBe(true);
    expect(needsConfirmation({ index: 1, label: 'Look', targetIds: ['seen-1'] })).toBe(true);
    expect(needsConfirmation({ index: 1, label: 'Go', forecasts: [{ label: 'Protection', value: 'Unknown from my available knowledge' }] })).toBe(true);
    expect(needsConfirmation({ index: 1, label: 'Spend one charge to thaw ice' })).toBe(true);
    expect(needsConfirmation({ index: 1, label: 'Leave', entry: 'leave_palace_adventurer' })).toBe(true);
  });
  it('distinguishes new observation, history, ice attempts and direct passage', () => {
    expect(actionNote(frame.offers[1], frame)).toContain('脚下是否结冰');
    expect(actionNote(frame.offers[0], frame)).toContain('其他落点');
    expect(actionNote({ index: 1, entry: 'move_adventurer', label: 'Move' }, frame)).toContain('冰封的地面');
    expect(recordedAt({ time: 125, revision: 8 })).toBe('时刻 125');
    expect(recordedAt(null)).toBe('尚未细看');
  });

  it.each([
    ['carry_from_ritual_adventurer', 'Carry toward the threshold'], ['offer_torch_adventurer', 'Offer Everflame'],
    ['carry_move_adventurer', 'Carry observed patient'], ['carry_cross_ice_adventurer', 'Carry observed patient'],
    ['carry_bridge_slow_adventurer', 'Carry observed patient'], ['carry_pass_door_adventurer', 'Carry observed patient through this door'],
    ['strike_person_adventurer', 'Strike the observed person'], ['inspect_patient_adventurer', 'Attempt inspection'],
    ['observe_wall_adventurer', 'Observe wall'], ['observe_hall_adventurer', 'Observe people in this hall'],
  ])('localizes important current attempts without changing their target: %s', (entry, label) => {
    const offer = { index: 197, entry, label, targetIds: ['seen-1'] };
    expect(actionName(offer)).not.toMatch(/[A-Za-z_]/);
    expect(targetNames(offer, ritualFrame)).toEqual(['仪式处居民']);
    expect(offer.targetIds).toEqual(['seen-1']); expect(offer.index).toBe(197);
  });
  it('distinguishes multiple authored commands on one entry instead of flattening their meaning', () => {
    expect(actionName({ index: 1, entry: 'balloon_control_adventurer', label: 'Board the balloon basket' })).toBe('登上球囊吊篮');
    expect(actionName({ index: 2, entry: 'balloon_control_adventurer', label: 'Leave the balloon basket' })).toBe('离开球囊吊篮');
    expect(actionName({ index: 3, entry: 'ask_prison_adventurer', label: 'Ask for a charge: a public person' })).toBe('询问能否提供充能');
    expect(actionName({ index: 4, entry: 'ask_prison_adventurer', label: 'Ask about yourself: a public person' })).toBe('询问对方的情况');
  });
  it('localizes actual phase values and protection labels without defining a clock unit', () => {
    for (const phase of ['preparing', 'gathering', 'critical', 'erupted']) expect(text(phase)).not.toMatch(/[A-Za-z]/);
    expect(text('critical → erupted')).toBe('接近完成 → 已完成');
    expect(text('Protection at the known target area now')).toBe('已知目标区域目前的保护记录');
    expect(journeyGuidance(ritualFrame).note).not.toMatch(/\d+\s*(秒|回合)/);
  });
  it.each(Object.entries(PUBLIC_FEEDBACK_TEXT))('translates only actual public receipt text: %s', (original, translated) => {
    const actual: Frame = { ...frame, feedback: { status: 'published', entry: 'carry_from_ritual_adventurer', actionLabel: 'Carry', text: original.replace(/ /g, '\n ') } };
    expect(feedbackText(actual)).toBe(translated);
    expect(feedbackText({ ...actual, feedback: { ...actual.feedback!, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } } })).toBe(translated);
    expect(translated).not.toMatch(/[A-Za-z_]/);
  });
  it('preserves unfamiliar public wording and does not synthesize a success or hidden refusal reason from entry', () => {
    for (const status of ['published', 'rejected'] as const) {
      const receipt = { entry: 'carry_from_ritual_adventurer', actionLabel: 'Carry', text: '这次作者公开的特殊说明。' };
      const actual: Frame = { ...frame, feedback: status === 'rejected' ? { ...receipt, status, refusal: { code: 'K0_NOT_ADMITTED' } } : { ...receipt, status } };
      expect(feedbackText(actual)).toBe(actual.feedback!.text);
      expect(feedbackText({ ...actual, feedback: { ...actual.feedback!, text: '' } })).toBeNull();
    }
  });
  it('prioritizes actual ritual offers over optional investigations and waiting, retaining original objects and IDs', () => {
    const before = JSON.stringify(ritualFrame);
    const groups = offerGroups(ritualFrame);
    expect(groups.map(g => g.id)).toEqual(['ritual', 'people', 'observe', 'wait']);
    expect(groups[0].offers).toEqual([ritualOffers[4]]);
    const grouped = groups.flatMap(g => g.offers);
    expect(grouped.map(o => o.index).sort((a, b) => a - b)).toEqual(ritualOffers.map(o => o.index).sort((a, b) => a - b));
    for (const o of grouped) expect(ritualOffers).toContain(o);
    expect(JSON.stringify(ritualFrame)).toBe(before);
    expect(contextOffers(ritualFrame, { kind: 'site', id: 'ritual_ring' })).toContain(ritualOffers[4]);
    expect(offerGroups(ritualFrame, [ritualOffers[0]]).flatMap(g => g.offers)).toEqual([ritualOffers[0]]);
  });
  it('explains the existing carry attempt only when offered, without requiring a preliminary detail action', () => {
    const noDetails = { ...ritualFrame, observations: [] };
    expect(journeyGuidance(noDetails).note).toContain('可以尝试把居民带离仪式圈');
    expect(actionNote(ritualOffers[4], noDetails)).toContain('尝试把居民带离仪式圈');
    expect(needsConfirmation(ritualOffers[4])).toBe(true);
    expect(needsConfirmation({ index: 20, entry: 'carry_from_ritual_adventurer', label: 'Carry' })).toBe(true);
    const absent = { ...noDetails, offers: ritualOffers.filter(o => o.entry !== 'carry_from_ritual_adventurer') };
    expect(journeyGuidance(absent).note).not.toContain('搬');
    expect(locationNote(absent)).not.toContain('搬');
    expect(offerGroups(absent).some(g => g.id === 'ritual')).toBe(false);
  });
  it.each(['completed', 'disrupted'] as const)('stops the interruption objective after known %s without claiming rescue or terminal failure', phase => {
    const ended = { ...ritualFrame, information: { ...ritualFrame.information, ritual: { ...ritualFrame.information.ritual, phase } } };
    expect(journeyGuidance(ended).objective).not.toContain('中断');
    expect(journeyGuidance(ended).objective).toContain('帮助居民');
    expect(offerGroups(ended).some(g => g.id === 'ritual')).toBe(false);
    expect(offerGroups(ended).flatMap(g => g.offers)).toContain(ritualOffers[4]);
    expect(locationNote(ended)).not.toContain('尝试中断');
  });
  it('warns only from the same target historical death, retains attempts, and does not assert a current guard cause', () => {
    const knownDead = { ...ritualFrame, observations: [{ ...ritualFrame.observations[0], state: 'dead', facts: [{ label: '生命', value: 'Dead' }] }] };
    for (const offer of [ritualOffers[4], ritualOffers[5]]) {
      const note = actionNote(offer, knownDead);
      expect(note).toContain('上次观察记录为死亡'); expect(note).toContain('在附近重新观察');
      expect(note).not.toMatch(/必定成功|已获救/); expect(note).not.toContain('必然');
      expect(offerGroups(knownDead).flatMap(g => g.offers)).toContain(offer);
      expect(actionNote({ ...offer, targetIds: ['seen-99'] }, knownDead)).not.toContain('记录为死亡');
    }
  });
  it('offers only actual recovery checks, without treating suggested checks as diagnosed causes', () => {
    const rejected: Frame = { ...ritualFrame, feedback: { status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' }, entry: 'carry_from_ritual_adventurer', actionLabel: 'Carry', text: '公开拒绝' } };
    expect(recoveryOffers(rejected)).toEqual([ritualOffers[3], ritualOffers[6]]);
    expect(offerGroups(rejected)[0]).toEqual({ id: 'recovery', label: '重新寻找机会', offers: [ritualOffers[3], ritualOffers[6]] });
    expect(recoveryNote(rejected)).toContain('原因还不清楚');
    expect(recoveryNote(rejected)).toContain('观察居民');
    expect(recoveryOffers({ ...rejected, offers: [] })).toEqual([]);
    expect(recoveryNote({ ...rejected, offers: [] })).toContain('寻找其他通路');
    expect(recoveryNote(frame)).toBeNull();
  });
  it('scopes empty route discovery wording to tracked details, without promising a route was discovered', () => {
    const looked: Frame = { ...frame, feedback: { status: 'published', entry: 'observe_routes_adventurer', actionLabel: 'Routes', text: 'Public', result } };
    expect(emptyDiscoveryNote(looked)).toBe('本次没有新增人物／物件详情记录；通路等其他读回见地图与相关记录。');
    expect(emptyDiscoveryNote(looked)).not.toContain('未取得新的观察记录');
    expect(emptyDiscoveryNote(looked)).not.toContain('发现了');
  });
});

describe('public receipt rendering', () => {
  async function components() {
    vi.stubGlobal('window', { sessionStorage: undefined });
    try { return await import('./App'); }
    finally { vi.unstubAllGlobals(); }
  }

  it('uses player-facing scene wording while retaining observation times and real crossing risk', async () => {
    const { CurrentSurface, HistoricalMemory, MovementReadbacks } = await components();
    const before = JSON.stringify(surfaceFrame);
    const html = renderToStaticMarkup(createElement(CurrentSurface, { frame: surfaceFrame, onSelect: vi.fn() }))
      + renderToStaticMarkup(createElement(HistoricalMemory, { frame: surfaceFrame, onSelect: vi.fn() }))
      + renderToStaticMarkup(createElement(MovementReadbacks, { frame: surfaceFrame }));
    expect(html).toContain('就在附近');
    expect(html).toContain('上次所见');
    expect(html).toContain('时刻 0');
    expect(html).not.toMatch(/不保证|不等于|非精确坐标|不是眼前对象/);
    expect(JSON.stringify(surfaceFrame)).toBe(before);
    const dangerous: Offer = { index: 5, label: 'Risky bridge crossing (d20 + balance bonus >= 12; failure kills; no cost saving) toward outside' };
    expect(movementDescription(dangerous)).toContain('失败致命');
    expect(movementDescription(dangerous)).toContain('12');
  });

  it('keeps player identity in the status HUD and gives the scene only current entities', async () => {
    const { SceneStage, PlayerIdentity, sceneBackdrop } = await components();
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(createElement(SceneStage, { frame: surfaceFrame, onSelect }));
    expect(html).toContain('data-testid="scene-stage"');
    expect(html).not.toContain('data-testid="scene-player"');
    const identity = renderToStaticMarkup(createElement(PlayerIdentity));
    expect(identity).toContain('data-testid="scene-player"');
    expect(identity).toContain('class="identity-icon"');
    expect(identity).toContain('携焰的旅人'); expect(identity).not.toContain('<button');
    expect(html).not.toContain('traveler.png');
    expect(html).toContain('lucide-user-round');
    expect((html.match(/data-surface=/g) ?? []).length).toBe(5);
    expect(html).not.toContain('data-object=');
    expect(html).not.toContain('data-offer=');
    expect(html).not.toContain('历史状态');
    expect(onSelect).not.toHaveBeenCalled();
    const missing = { ...surfaceFrame, information: { ...surfaceFrame.information, visibility: 'unavailable' as const } };
    expect(renderToStaticMarkup(createElement(SceneStage, { frame: missing, onSelect }))).not.toContain('data-surface=');
    const at = (id: string) => ({ ...frame, scene: { ...frame.scene!, playerSite: id } });
    expect(sceneBackdrop(at('ballroom_entrance'))).toBe('/assets/scene-ballroom-v3.png');
    expect(sceneBackdrop(at('halls_ballroom_door'))).toBe('/assets/scene-corridor-v3.png');
    expect(sceneBackdrop(at('bridge_palace_landing'))).toBe('/assets/scene-bridge-v3.png');
    expect(sceneBackdrop(at('ritual_ring'))).toBe('/assets/scene-ritual-v3.png');
    for (const [id, file] of [
      ['ritual_threshold', 'ritual-v3'], ['ritual_passage_entry', 'ritual-v3'],
      ['treasure_approach', 'treasure-v3'], ['icebar_entry', 'icebar-v3'],
      ['lower_corridor_entry', 'lower-v3'], ['stables_approach', 'lower-v3'], ['stables_entry', 'stables-v3'],
      ['prison_holding', 'prison-v3'], ['captive_cell', 'prison-v3'],
      ['tower_base', 'tower-base-v3'], ['alpha_box_interior', 'tower-base-v3'], ['tower_top', 'tower-top-v3'],
      ['palace_exit', 'bridge-v3'],
    ]) expect(sceneBackdrop(at(id))).toBe(`/assets/scene-${file}.png`);
    expect(sceneBackdrop(at('unknown_site'))).toBeNull();
  });

  it('keeps compact guidance passive and quick actions bounded to exact public offers, with busy and ending guards', async () => {
    const { QuickActions, NextStepGuidance } = await components();
    const onAct = vi.fn();
    const compact = renderToStaticMarkup(createElement(NextStepGuidance, { frame: ritualFrame, blocked: false, onAct, compact: true }));
    expect(compact).not.toContain('<button');
    expect(compact).not.toContain('data-guidance-offer-index');
    expect(onAct).not.toHaveBeenCalled();
    const quick = QuickActions({ frame: ritualFrame, blocked: false, onAct })!;
    const buttons = quick.props.children;
    expect(buttons.length).toBeLessThanOrEqual(4);
    expect(new Set(buttons.map((button: { props: { 'data-offer-index': number } }) => button.props['data-offer-index'])).size).toBe(buttons.length);
    for (const button of buttons) {
      const actual = ritualFrame.offers.find(offer => offer.index === button.props['data-offer-index']);
      expect(actual).toBeDefined();
      const initiator = {} as HTMLButtonElement;
      button.props.onClick({ currentTarget: initiator });
      expect(onAct).toHaveBeenLastCalledWith(actual, initiator);
    }
    const busy = renderToStaticMarkup(createElement(QuickActions, { frame: ritualFrame, blocked: true, onAct }));
    expect((busy.match(/disabled=""/g) ?? []).length).toBe(buttons.length);
    expect(QuickActions({ frame: { ...ritualFrame, ending: { id: 'done', title: '结束', narrationZh: '结束记录' } }, blocked: true, onAct })).toBeNull();
  });

  it('renders only current surface as positionless pieces, localizes them and only selects on click', async () => {
    const { CurrentSurface, MovementReadbacks, HistoricalMemory } = await components();
    const selected = vi.fn();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const view = CurrentSurface({ frame: surfaceFrame, onSelect: selected });
      const pieces = view.props.children[2].props.children;
      expect(pieces).toHaveLength(5);
      expect(pieces[0].props['data-surface']).toBe('seen-4');
      expect(pieces[1].props['data-surface']).toBe('seen-5');
      pieces[0].props.onClick();
      expect(selected).toHaveBeenCalledWith('seen-4');
      expect(fetcher).not.toHaveBeenCalled();
      const html = renderToStaticMarkup(view);
      expect(html).toContain('就在附近');
      expect(html).toContain('吊灯旁居民一'); expect(html).toContain('吊灯旁居民二');
      expect(html).not.toContain('First resident'); expect(html).not.toContain('Second resident');
      expect(html).not.toContain('大厅居民一'); expect(html).not.toContain('冰封');
      expect(html).not.toContain('style=');
      expect(surfaceFrame.information.visibleEntities[0].id).toBe('seen-2');
      const history = { ...frame.observations[0], label: '吊灯旁居民一' };
      const memory = renderToStaticMarkup(createElement(HistoricalMemory, { frame: { ...frame, observations: [history] }, onSelect: selected }));
      expect(memory).toContain('吊灯旁居民一'); expect(memory).not.toContain('First resident');
      expect(memory).toContain('<details'); expect(memory).not.toContain('open=');
      expect(memory).toContain('上次所见'); expect(memory).toContain('时刻 0');
      const withMotion: Frame = { ...frame,
        scene: { ...frame.scene!, siteLabels: { halls_bridge_door: 'Halls beside the bridge stair' } },
        information: { ...frame.information, movements: [{ id: 'motion-1', subjectId: 'seen-4', label: 'First resident by the chandelier', start: 'halls_bridge_door', end: 'ballroom_chandelier_reach', recordedAt: { time: 100, revision: 1 } }] },
      };
      const motion = renderToStaticMarkup(createElement(MovementReadbacks, { frame: withMotion }));
      expect(motion).toContain('吊灯旁居民一'); expect(motion).toContain('桥梯旁大厅');
      expect(motion).not.toContain('First resident');
      const noSurface: Frame = { ...surfaceFrame, information: { ...surfaceFrame.information, visibleEntities: [] } };
      expect(renderToStaticMarkup(createElement(CurrentSurface, { frame: noSurface, onSelect: selected }))).not.toContain('data-surface=');
    } finally { vi.unstubAllGlobals(); }
  });
  it('provides a non-executing observation-list entry for an unmatched target, not a fabricated action', async () => {
    const { SurfaceActionGap } = await components();
    const browse = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const view = SurfaceActionGap({ frame: surfaceFrame, id: 'seen-4', onBrowse: browse });
      const html = renderToStaticMarkup(view);
      expect(html).toContain('暂时没有与这个目标互动的行动');
      expect(html).toContain('此处可尝试：观察吊灯并呼喊、寻找附近通路');
      view!.props.children[1].props.children[1].props.onClick();
      expect(browse).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
      expect(SurfaceActionGap({ frame: surfaceFrame, id: 'seen-2', onBrowse: browse })).toBeNull();
      const unavailable = renderToStaticMarkup(createElement(SurfaceActionGap, { frame: { ...surfaceFrame, offers: [] }, id: 'seen-4', onBrowse: browse }));
      expect(unavailable).toContain('继续探索其他地方'); expect(unavailable).not.toContain('<button');
    } finally { vi.unstubAllGlobals(); }
  });

  it('does not create current items or claim holding from old charges, observations or action entries', async () => {
    const { CurrentSurface, ResourceReadbacks } = await components();
    const known: Frame = { ...surfaceFrame,
      fields: { ...surfaceFrame.fields, carriedReservoirCharges: 2 },
      offers: [...surfaceFrame.offers, { index: 61, entry: 'reload_everflame_adventurer', label: 'Reload' }],
      observations: [
        { ...frame.observations[0], id: 'seen-1', kind: 'everflame', label: '永焰', site: 'ballroom_chandelier_reach' },
        { ...frame.observations[0], id: 'seen-3', kind: 'reservoir', label: '吊灯储能器', site: 'ballroom_chandelier_reach' },
      ],
    };
    for (const visibility of ['provided', 'unavailable', 'not_provided'] as const) {
      const absent: Frame = { ...known, information: { ...known.information, visibility, visibleEntities: [] } };
      const html = renderToStaticMarkup(createElement(CurrentSurface, { frame: absent, onSelect: () => {} }));
      expect(html).not.toContain('data-surface=');
      expect(tableFeatures(absent).some(f => ['everflame', 'reservoir', 'chandelier'].includes(f.id))).toBe(false);
    }
    const resources = renderToStaticMarkup(createElement(ResourceReadbacks, { frame: known }));
    expect(resources).toContain('永焰 · 已知充能'); expect(resources).toContain('储能器 · 已知充能');
    expect(resources).toContain('data-testid="reservoir-value">2');
    expect(resources).not.toContain('本人携带'); expect(resources).not.toContain('当前持有');
    const unknown = renderToStaticMarkup(createElement(ResourceReadbacks, { frame }));
    expect(unknown).toContain('未知'); expect(unknown).not.toContain('未携带');
    const visible = renderToStaticMarkup(createElement(CurrentSurface, { frame: known, onSelect: () => {} }));
    expect(visible).toContain('data-surface="seen-1"'); expect(visible).toContain('data-surface="seen-3"');
    expect(visible).not.toContain('本人携带'); expect(visible).not.toContain('充能');
  });

  it('reads escort response status without interpreting autonomous movement as a response or acceptance', async () => {
    const { EscortResponse } = await components();
    const autonomous: Frame = { ...frame, information: { ...frame.information,
      escortResponse: { status: 'not_observed', label: '尚未发出护送邀请。' },
      movements: [{ id: 'motion-1', subjectId: 'seen-4', label: 'First resident by the chandelier', start: 'halls_bridge_door', end: 'ballroom_chandelier_reach', recordedAt: { time: 100, revision: 1 } }],
    } };
    const html = renderToStaticMarkup(createElement(EscortResponse, { frame: autonomous }));
    expect(html).toContain('你曾亲眼看见的移动'); expect(html).not.toContain('邀请后');
    const observed: Frame = { ...autonomous, information: { ...autonomous.information,
      movements: [], escortResponse: { status: 'movement_observed', label: '邀请后取得新的移动观察。' },
    } };
    const response = renderToStaticMarkup(createElement(EscortResponse, { frame: observed }));
    expect(response).toContain('你曾亲眼看见的移动'); expect(response).not.toMatch(/接受了护送|已获救|正在同行/);
    expect(response).toContain('仔细观察');
  });

  it('shows distinct general/detail readbacks without claiming presence', async () => {
    const { MemoryDetails } = await components();
    const item = { ...frame.observations[0], recordedAt: { time: 300, revision: 3 }, detailRecordedAt: { time: 100, revision: 1 } };
    const html = renderToStaticMarkup(createElement(MemoryDetails, { item, frame }));
    expect(html).toContain('上次见到');
    expect(html).toContain('时刻 300');
    expect(html).toContain('时刻 100');
    expect(html).toContain('生命');
    expect(html).not.toContain('seen-1');
  });
  it('renders immediate and later discoveries separately, including ritual phases', async () => {
    const { ActionOutcome } = await components();
    const changed: Frame = { ...frame, feedback: { status: 'published', actionLabel: 'Look', text: 'Public', result: {
      ...result, discoveries: [{ kind: 'observation', change: 'new', observation: frame.observations[0] }],
      laterDiscoveries: [{ kind: 'ritual', phase: 'critical', label: '曾察觉仪式接近完成' }],
    } } };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: changed, busy: false, error: null, onRefresh: () => {} }));
    expect(html).toContain('本次变化');
    expect(html).toContain('新取得 · 大厅居民一');
    expect(html).toContain('随后变化');
    expect(html).toContain('曾察觉仪式接近完成');
    expect(html).not.toContain('Unknown');
  });
  it('suppresses even malformed rejected results instead of discoveries or costs', async () => {
    const { ActionOutcome } = await components();
    const changed: Frame = { ...frame, feedback: { status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' }, actionLabel: 'Look', text: 'Rejected', result: {
      ...result, changes: [{ field: 'everflameCharges', before: 5, after: 4 }],
      discoveries: [{ kind: 'ritual', phase: 'completed', label: '此项不得显示' }],
    } } };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: changed, busy: false, error: null, onRefresh: () => {} }));
    expect(html).toContain('行动未开始');
    expect(html).not.toContain('此项不得显示');
    expect(html).not.toContain('本次变化');
  });
  it('separates current surface identity from already acquired detail and never renews its time', async () => {
    const { CurrentSurface } = await components();
    const changed: Frame = { ...frame, information: { ...frame.information, visibility: 'provided', visibleEntities: [{
      id: 'seen-1', kind: 'person', label: '当前公开目标', site: 'ballroom_entrance',
      state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current',
    }] } };
    const html = renderToStaticMarkup(createElement(CurrentSurface, { frame: changed, onSelect: () => {} }));
    expect(html).toContain('当前公开目标');
    expect(html).toContain('上次观察：冰封 · 时刻 0');
    expect(html).not.toContain('生命');
    expect(html).not.toContain('当前状态：冰封');
    expect(contextOffers(changed, { kind: 'surface', id: 'seen-1' }).map(o => o.index)).toEqual([31]);
    expect(targetNames(frame.offers[2], changed)).toEqual(['当前公开目标']);
    expect(targetNames({ index: 9, label: 'Try', targetIds: ['unseen-private-ref'] }, changed)).toEqual(['目标尚无公开名称']);
    const unavailable: Frame = { ...changed, information: { ...changed.information, visibility: 'unavailable' } };
    const hidden = renderToStaticMarkup(createElement(CurrentSurface, { frame: unavailable, onSelect: () => {} }));
    expect(hidden).not.toContain('当前公开目标');
    expect(targetNames(frame.offers[2], unavailable)).toEqual(['大厅居民一']);
  });
  it('renders only public movement endpoints and readback, not current position or escort acceptance', async () => {
    const { MovementReadbacks } = await components();
    const changed: Frame = { ...frame, information: { ...frame.information,
      escortResponse: { status: 'movement_observed', label: '取得移动观察，未确认护送接受。' },
      movements: [{ id: 'move-1', subjectId: 'unseen-private-ref', label: '公开居民的移动', start: 'ballroom_entrance', end: 'ballroom_chandelier_reach', recordedAt: { time: 200, revision: 2 } }],
    } };
    const html = renderToStaticMarkup(createElement(MovementReadbacks, { frame: changed }));
    expect(html).toContain('舞厅入口');
    expect(html).toContain('吊灯边缘');
    expect(html).toContain('时刻 200');
    expect(html).not.toMatch(/接受了护送|已获救|正在同行/);
    expect(html).toContain('你曾看见这次移动');
    expect(html).not.toContain('unseen-private-ref');
    expect(changed.observations).toBe(frame.observations);
  });
  it('does not replace immediate discovery details with the later version of the same object', async () => {
    const { ActionOutcome } = await components();
    const later = { ...frame.observations[0], state: 'dead', facts: [{ label: '生命', value: 'Dead' }], recordedAt: { time: 200, revision: 2 }, detailRecordedAt: { time: 200, revision: 2 } };
    const changed: Frame = { ...frame, observations: [later], feedback: { status: 'published', actionLabel: 'Observe', text: 'Public', result: {
      ...result, discoveries: [{ kind: 'observation', change: 'new', observation: frame.observations[0] }],
      laterDiscoveries: [{ kind: 'observation', change: 'updated', observation: later }],
    } } };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: changed, busy: false, error: null, onRefresh: () => {} }));
    expect(html).toContain('存活');
    expect(html).toContain('死亡');
    expect(html).toContain('新取得');
    expect(html).toContain('更新记录');
  });
  it.each(['discoveries', 'laterDiscoveries'] as const)('renders public movement discovery in %s without inventing acceptance', async group => {
    const { ActionOutcome } = await components();
    const movement = { id: 'motion-readback', subjectId: 'unseen-private-ref', label: '公开的移动观察', start: 'ballroom_entrance', end: 'ballroom_chandelier_reach', recordedAt: { time: 200, revision: 2 } };
    const changed: Frame = { ...frame, feedback: { status: 'published', actionLabel: 'Invite', text: 'Public', result: {
      ...result, discoveries: group === 'discoveries' ? [{ kind: 'movement', movement }] : [],
      laterDiscoveries: group === 'laterDiscoveries' ? [{ kind: 'movement', movement }] : [],
    } } };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: changed, busy: false, error: null, onRefresh: () => {} }));
    expect(html).toContain('公开的移动观察');
    expect(html).toContain('舞厅入口');
    expect(html).toContain('吊灯边缘');
    expect(html).not.toMatch(/接受了护送|已获救|正在同行/);
    expect(html).not.toContain('unseen-private-ref');
  });

  it('renders authored text before compact summaries, with complete immediate/later evidence initially folded', async () => {
    const { ActionOutcome } = await components();
    const original = 'You observed the nearby resident. Their life, condition and location below record this encounter, not a remote update.';
    const changed: Frame = { ...frame, feedback: { status: 'published', entry: 'observe_resident_adventurer', actionLabel: 'Observe', text: original, result: {
      ...result, discoveries: [{ kind: 'observation', change: 'new', observation: frame.observations[0] }],
      laterDiscoveries: [{ kind: 'ritual', phase: 'completed', label: '曾察觉仪式已完成' }],
      changes: [{ field: 'gold', before: 0, after: 1 }], laterChanges: [{ field: 'publicFact', before: '旧值', after: '新值' }],
      target: 'ritual_threshold', landing: 'ritual_ring', collision: false,
      rolls: [{ kind: 'balance', value: 20 }], laterRolls: [{ kind: 'cold', value: 7 }],
    } } };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: changed, busy: false, error: null, onRefresh: () => {} }));
    expect(html.indexOf(PUBLIC_FEEDBACK_TEXT[original])).toBeLessThan(html.indexOf('本次变化'));
    expect(html.indexOf('生命 存活')).toBeLessThan(html.indexOf('完整证据与掷骰记录'));
    expect(html.indexOf('曾察觉仪式已完成')).toBeLessThan(html.indexOf('完整证据与掷骰记录'));
    const evidence = html.slice(html.indexOf('<details class="outcome-evidence"'));
    expect(evidence).toContain('本次变化'); expect(evidence).toContain('随后变化');
    expect(evidence).toContain('时刻 0'); expect(evidence).toContain('详细观察');
    expect(evidence).toContain('本次平衡骰'); expect(evidence).toContain('随后严寒骰');
    expect(evidence).toContain('20'); expect(evidence).toContain('7'); expect(evidence).not.toContain('open=');
    expect(evidence).toContain('尝试目的地：仪式门槛'); expect(evidence).toContain('实际落点：仪式圈');
    expect(evidence).toContain('碰撞记录：否'); expect(evidence).toContain('publicFact'); expect(evidence).toContain('新值');
    expect(html).not.toContain(original);
  });
  it('shows the actual rejected public message and optional checks even if the rejected result is malformed', async () => {
    const { ActionOutcome } = await components();
    const original = 'This crossing could not start. Check your current position, condition and reachable crossing choices. Refusal is not a failed balance roll or a collision.';
    const rejected: Frame = { ...ritualFrame, feedback: { status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' }, entry: 'cross_ice_adventurer', actionLabel: 'Cross', text: original, result: {
      ...result, landing: 'palace_exit', changes: [{ field: 'everflameCharges', before: 5, after: 0 }], rolls: [{ kind: 'balance', value: 1 }],
    } } };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: rejected, busy: false, error: null, onRefresh: () => {} }));
    expect(html).toContain(PUBLIC_FEEDBACK_TEXT[original]); expect(html).toContain('暂时无法开始穿越');
    expect(html).toContain('原因还不清楚'); expect(html).not.toContain('具体拒绝原因未知');
    expect(html).not.toContain('抵达外岸'); expect(html).not.toContain('完整证据与掷骰记录');
  });
  it('shows scoped route wording and the authored routes feedback without inventing a route discovery', async () => {
    const { ActionOutcome } = await components();
    const original = 'You looked for routes from here. Check the current choices below; knowing a passage does not guarantee that it is now passable.';
    const looked: Frame = { ...frame, feedback: { status: 'published', entry: 'observe_routes_adventurer', actionLabel: 'Routes', text: original, result } };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: looked, busy: false, error: null, onRefresh: () => {} }));
    expect(html).toContain(PUBLIC_FEEDBACK_TEXT[original]); expect(html).toContain(emptyDiscoveryNote(looked));
    expect(html).not.toContain('本次未取得新的观察记录'); expect(html).not.toContain('新通路');
  });
  it('renders grouped actions but routes clicks through the exact offer, without execution from selection or preview', async () => {
    const { ActionChoices } = await components();
    const act = vi.fn(); const preview = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const view = ActionChoices({ frame: ritualFrame, offers: ritualOffers, blocked: false, selectedIndex: null, onAct: act, onPreview: preview });
      const carry = view.props.children[0].props.children[1][0];
      expect(carry.props['data-offer-index']).toBe(93);
      carry.props.onFocus(); expect(preview).toHaveBeenCalledWith(93); expect(act).not.toHaveBeenCalled();
      const initiator = { focus: vi.fn() };
      carry.props.onClick({ currentTarget: initiator }); expect(act).toHaveBeenCalledWith(ritualOffers[4], initiator); expect(fetcher).not.toHaveBeenCalled();
      const html = renderToStaticMarkup(view);
      expect(html).toContain('应对仪式'); expect(html).toContain('仪式处居民');
      expect(html).not.toContain('Carry'); expect(html).not.toContain('Offer Everflame');
    } finally { vi.unstubAllGlobals(); }
  });
  it('renders completed/disrupted objectives without the static interruption loop', async () => {
    const { JourneyObjective } = await components();
    for (const phase of ['completed', 'disrupted'] as const) {
      const ended = { ...ritualFrame, information: { ...ritualFrame.information, ritual: { ...ritualFrame.information.ritual, phase } } };
      const html = renderToStaticMarkup(createElement(JourneyObjective, { frame: ended }));
      expect(html).toContain('帮助居民'); expect(html).toContain('寻找离开路线'); expect(html).not.toContain('中断仪式 ·');
      expect(html).not.toContain('尝试中断');
    }
  });
  it('cancels confirmation on Escape and restores its exact initiating offer, without a request', async () => {
    const { ActionChoices, cancelActionConfirmation, listenForEscape } = await components();
    const events = new EventTarget();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const initiator = { isConnected: true, disabled: false, focus: vi.fn() } as unknown as HTMLButtonElement;
    let pending: Offer | null = null;
    let opener: HTMLButtonElement | null = null;
    try {
      const view = ActionChoices({ frame: ritualFrame, offers: ritualOffers, blocked: false, selectedIndex: null,
        onAct: (offer, trigger) => { pending = offer; opener = trigger; }, onPreview: () => {} });
      view.props.children[0].props.children[1][0].props.onClick({ currentTarget: initiator });
      expect(pending).toBe(ritualOffers[4]); expect(opener).toBe(initiator);
      const close = vi.fn(() => { pending = null; });
      const cleanup = listenForEscape(events, () => cancelActionConfirmation(close, opener));
      const other = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter' });
      events.dispatchEvent(other); expect(pending).toBe(ritualOffers[4]); expect(close).not.toHaveBeenCalled();
      const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
      events.dispatchEvent(escape);
      expect(pending).toBeNull(); expect(close).toHaveBeenCalledOnce(); expect(initiator.focus).toHaveBeenCalledOnce();
      expect(escape.defaultPrevented).toBe(true); expect(fetcher).not.toHaveBeenCalled();
      cleanup(); events.dispatchEvent(escape); expect(close).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([
    { isConnected: false, disabled: false }, { isConnected: true, disabled: true }, null,
  ])('still cancels confirmation if its initiating offer cannot regain focus: %j', async state => {
    const { cancelActionConfirmation } = await components();
    const close = vi.fn(); const focus = vi.fn();
    cancelActionConfirmation(close, state ? { ...state, focus } as unknown as HTMLButtonElement : null);
    expect(close).toHaveBeenCalledOnce(); expect(focus).not.toHaveBeenCalled();
  });
  it('uses the same Escape listener for dialogs and removes it when dismissed', async () => {
    const { listenForEscape } = await components();
    const events = new EventTarget(); const closeDialog = vi.fn();
    const cleanup = listenForEscape(events, closeDialog);
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    events.dispatchEvent(escape); expect(closeDialog).toHaveBeenCalledOnce();
    cleanup(); events.dispatchEvent(escape); expect(closeDialog).toHaveBeenCalledOnce();
  });
  it('replaces terminal risk and previews with read-only wording even with stale offers or timing', async () => {
    const { ActionRisk, ActionPreview, ActionChoices, JourneyObjective, EscortResponse } = await components();
    const ended: Frame = { ...ritualFrame, ending: { id: 'departed', title: '独自离开宫殿', narrationZh: '你已离开；不能证明未见居民的命运。' } };
    const risk = renderToStaticMarkup(createElement(ActionRisk, { frame: ended }));
    const preview = renderToStaticMarkup(createElement(ActionPreview, { frame: ended, heading: '仪式圈', offer: ritualOffers[4], feature: { label: '护送邀请', note: '执行会推进世界' } }));
    const choices = renderToStaticMarkup(createElement(ActionChoices, { frame: ended, offers: ritualOffers, blocked: true, selectedIndex: 93, onAct: vi.fn(), onPreview: vi.fn() }));
    const objective = renderToStaticMarkup(createElement(JourneyObjective, { frame: ended }));
    const response = renderToStaticMarkup(createElement(EscortResponse, { frame: ended }));
    expect(risk).toContain('回看结局与这一路的见闻'); expect(risk).toContain('旅程记录');
    expect(risk).not.toContain(ended.information.timingNotice); expect(risk).not.toContain('消耗可能缩小');
    expect(preview).toContain('回看结局'); expect(preview).not.toContain('尝试中断'); expect(preview).not.toContain('执行会推进世界');
    expect(choices).toContain('没有可执行的世界行动'); expect(choices).not.toContain('<button');
    expect(objective).toContain(ended.ending!.title); expect(objective).not.toContain('寻找中断');
    expect(response).toContain('旅程已结束'); expect(response).not.toContain('可以继续行动');
    expect(locationNote(ended)).toContain('结束时的地点'); expect(locationNote(ended)).not.toContain('可尝试');
    expect(feedbackTitle(ended)).toBe(ended.ending!.title);
    expect(timingGuidance(frame).notice).toBe(frame.information.timingNotice);
    expect(ended.offers).toBe(ritualOffers);
    expect(`${risk}${preview}${choices}${objective}`).not.toMatch(/全局失败|游戏失败|全员获救|game over/i);
  });
});

describe('batch3 bounded public information', () => {
  const threshold: Frame = { ...frame, observations: [],
    scene: { playerSite: 'ritual_threshold', knownSites: ['ritual_threshold', 'ritual_ring', 'ritual_lower_stair'],
      siteLabels: { ritual_lower_stair: 'Ritual lower stair' },
      routes: [{ start: 'ritual_threshold', end: 'ritual_ring', kind: 'walk' }, { start: 'ritual_threshold', end: 'ritual_lower_stair', kind: 'ice' }] },
    offers: [
      { index: 301, entry: 'move_adventurer', label: 'Attempt direct passage (ice may block) to the circle', destination: 'ritual_ring', movementKind: 'walk' },
      { index: 409, entry: 'cross_ice_adventurer', label: 'Attempt crossing toward the stair', destination: 'ritual_lower_stair', movementKind: 'ice' },
      { index: 510, entry: 'move_adventurer', label: 'Attempt direct passage (ice may block) to the stair', destination: 'ritual_lower_stair', movementKind: 'walk' },
    ],
  };
  async function components() {
    vi.stubGlobal('window', { sessionStorage: undefined });
    try { return await import('./App'); }
    finally { vi.unstubAllGlobals(); }
  }
  it('lists only actual outgoing records or offered destinations, without adding reverse or distant routes', () => {
    const incoming = { start: 'palace_exit', end: 'ritual_threshold', kind: 'walk' };
    const distant = { start: 'palace_exit', end: 'bridge_midspan', kind: 'bridge' };
    const known = { ...threshold, scene: { ...threshold.scene!, routes: [...threshold.scene!.routes, incoming, distant], knownSites: [...threshold.scene!.knownSites, 'palace_exit'] } };
    const sites = adjacentSites(known);
    expect(sites.map(s => s.id).sort()).toEqual(['ritual_lower_stair', 'ritual_ring']);
    expect(sites.find(s => s.id === 'ritual_lower_stair')!.offers).toEqual(threshold.offers.slice(1));
    expect(sites.find(s => s.id === 'ritual_lower_stair')!.offers[0]).toBe(threshold.offers[1]);
    expect(adjacentSites({ ...known, offers: [] }).map(s => s.id).sort()).toEqual(['ritual_lower_stair', 'ritual_ring']);
    expect(adjacentSites({ ...known, scene: undefined }).map(s => s.id).sort()).toEqual(['ritual_lower_stair', 'ritual_ring']);
    expect(adjacentSites({ ...known, scene: undefined, offers: [] })).toEqual([]);
    expect(adjacentSites({ ...known, scene: { ...known.scene!, routes: [...known.scene!.routes].reverse() }, offers: [...known.offers].reverse() }).map(s => s.id)).toEqual(sites.map(s => s.id));
  });
  it('makes newly adjacent destinations separate ordinary-flow buttons and selects only, with no request', async () => {
    const { AdjacentRouteList } = await components();
    const select = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const view = AdjacentRouteList({ frame: threshold, selectedId: 'ritual_ring', onSelect: select });
      const buttons = view.props.children[1].props.children;
      expect(buttons).toHaveLength(2);
      const stair = buttons.find((button: { props: { 'data-site': string } }) => button.props['data-site'] === 'ritual_lower_stair');
      stair.props.onClick(); expect(select).toHaveBeenCalledWith('ritual_lower_stair'); expect(fetcher).not.toHaveBeenCalled();
      const html = renderToStaticMarkup(view);
      expect(html).toContain('仪式下层阶梯'); expect(html).toContain('仪式圈');
      expect(html).toContain('尝试穿越冰面'); expect(html).toContain('尝试直接通行');
      expect(html).not.toContain('style='); expect(html).not.toContain('<svg class="routes"');
      expect(buttons.every((button: { props: { style?: unknown } }) => button.props.style === undefined)).toBe(true);
      expect(contextOffers(threshold, { kind: 'site', id: 'ritual_lower_stair' }).map(o => o.index)).toEqual([409, 510]);
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not mark a route record without a current offer as passable or terminal records as actionable', async () => {
    const { AdjacentRouteList } = await components();
    const recordOnly = { ...threshold, offers: [] };
    const html = renderToStaticMarkup(createElement(AdjacentRouteList, { frame: recordOnly, onSelect: vi.fn() }));
    expect(html).toContain('仅有路线记录，暂无当前通行尝试'); expect(html).not.toContain('保证抵达');
    const ended = { ...threshold, ending: { id: 'finished', title: '旅程结束', narrationZh: '结束记录' } };
    expect(renderToStaticMarkup(createElement(AdjacentRouteList, { frame: ended, onSelect: vi.fn() }))).toContain('结束时的已知记录');
  });
  it('compares actual public endpoint/kind sets and ignores ordering and duplicate records', () => {
    const before = { ...threshold, scene: { ...threshold.scene!, routes: [threshold.scene!.routes[0]] } };
    expect(routeReadbackChanges(before, threshold)).toEqual([{ kind: 'added', label: '仪式门槛 → 仪式下层阶梯', beforeKinds: [], afterKinds: ['ice'] }]);
    const reordered = { ...threshold, scene: { ...threshold.scene!, routes: [threshold.scene!.routes[1], threshold.scene!.routes[0], threshold.scene!.routes[1]] } };
    expect(routeReadbackChanges(threshold, reordered)).toEqual([]);
    const changed = { ...threshold, scene: { ...threshold.scene!, routes: [{ ...threshold.scene!.routes[0], kind: 'ice' }] } };
    expect(routeReadbackChanges(threshold, changed)).toEqual([
      { kind: 'changed', label: '仪式门槛 → 仪式圈', beforeKinds: ['walk'], afterKinds: ['ice'] },
      { kind: 'removed', label: '仪式门槛 → 仪式下层阶梯', beforeKinds: ['ice'], afterKinds: [] },
    ]);
    expect(routeReadbackChanges(threshold, { ...threshold, offers: [] })).toEqual([]);
  });
  it('does not invent a route diff on first read, unavailable scene, another session, or from offer changes', () => {
    expect(routeReadbackChanges(null, threshold)).toEqual([]);
    expect(routeReadbackChanges({ ...threshold, scene: undefined }, threshold)).toEqual([]);
    expect(routeReadbackChanges(threshold, { ...threshold, scene: undefined })).toEqual([]);
    expect(sessionRouteChanges({ sessionId: 'old', frame: threshold }, { sessionId: 'new', frame: frame })).toEqual([]);
    expect(sessionRouteChanges(null, { sessionId: 'new', frame: threshold })).toEqual([]);
    expect(routeReadbackChanges(threshold, { ...threshold, offers: [...threshold.offers, { index: 600, label: 'Go', destination: 'palace_exit' }] })).toEqual([]);
  });
  it('keeps public route-delta names and limitations in the receipt, without attributing them to action success', async () => {
    const { ActionOutcome, RouteReadbackSummary } = await components();
    const before = { ...threshold, scene: { ...threshold.scene!, routes: [] } };
    const after: Frame = { ...threshold, feedback: { status: 'published', entry: 'open_door_adventurer', actionLabel: 'Open', text: 'Action resolved.', result } };
    const changes = routeReadbackChanges(before, after);
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: after, routeChanges: changes, busy: false, error: null, onRefresh: vi.fn() }));
    expect(html).toContain('行动完成。'); expect(html).toContain('新增记录：仪式门槛 → 仪式下层阶梯');
    expect(html).toContain('旅途中记下的路线变化'); expect(html).not.toMatch(/已经封堵|安全路线/);
    expect(html).not.toContain('成功打开'); expect(html).not.toContain('发现了安全路线');
    const removed = renderToStaticMarkup(createElement(RouteReadbackSummary, { changes: routeReadbackChanges(after, before) }));
    expect(removed).toContain('未再列出'); expect(removed).not.toContain('路线已经封堵');
    expect(RouteReadbackSummary({ changes: [] })).toBeNull();
  });
  it('shows movement differences from public kind or wording without introducing time, speed or charge numbers', () => {
    const ice = threshold.offers[1]; const walk = threshold.offers[2];
    expect(movementDescription(ice)).toContain('穿越冰面'); expect(movementDescription(walk)).toContain('沿通路行走');
    expect(movementDescription({ ...ice, movementKind: undefined })).toContain('穿越冰面');
    expect(movementDescription({ ...walk, movementKind: undefined })).toContain('沿通路行走');
    expect(movementDescription({ index: 1, entry: 'move_adventurer', label: 'Mystery movement' })).toBeNull();
    expect(`${movementDescription(ice)}${movementDescription(walk)}${actionNote(ice, threshold)}`).not.toMatch(/\d+|更快|节省|必定通过/);
    expect(actionNote(ice, threshold)).toContain('可能滑到其他落点');
    expect(publicCost(ice)).toBeNull(); expect(publicCost({ index: 1, entry: 'thaw_door_adventurer', label: 'Thaw the frozen stable door' })).toBeNull();
  });
  it('preserves only explicitly worded bridge comparisons, not guessed rules from an entry', () => {
    const slow = { index: 1, entry: 'bridge_slow_adventurer', label: 'Careful bridge crossing (no balance roll; same cost as risky crossing) toward outside', destination: 'palace_exit' };
    const rush = { index: 2, entry: 'bridge_rush_adventurer', label: 'Risky bridge crossing (d20 + balance bonus >= 12; failure kills; no cost saving) toward outside', destination: 'palace_exit' };
    expect(movementDescription(slow)).toContain('耗费与冒险过桥相同'); expect(movementDescription(rush)).toContain('失败致命');
    expect(movementDescription({ ...slow, movementKind: 'walk' })).toContain('耗费与冒险过桥相同');
    expect(actionNote({ ...slow, label: 'Mystery' }, threshold)).not.toContain('耗费与冒险过桥相同');
    expect(actionNote({ ...rush, label: 'Mystery' }, threshold)).not.toContain('12');
  });
  it.each(['unknown', 'Unknown', 'UNKNOWN', '  unknown  '])('localizes the actual unknown scalar: %s', value => {
    expect(text(value)).toBe('未知');
  });
  it('translates generic resolved public text but never manufactures an action-specific success', () => {
    for (const entry of ['open_door_adventurer', 'thaw_door_adventurer', 'carry_from_ritual_adventurer']) {
      const resolved: Frame = { ...frame, feedback: { status: 'published', entry, actionLabel: 'Act', text: 'Action resolved.', result } };
      expect(feedbackText(resolved)).toBe('行动完成。');
      expect(feedbackText({ ...resolved, feedback: { ...resolved.feedback!, text: '公开作者另一句说明' } })).toBe('公开作者另一句说明');
    }
  });
  it('reads the new stable-door cost only from the explicitly supplied public label', () => {
    const known: Offer = { index: 99, entry: 'thaw_door_adventurer', label: 'Spend one charge to thaw the frozen stable door' };
    expect(publicCost(known)).toBe('消耗 1 点永焰'); expect(needsConfirmation(known)).toBe(true);
    expect(actionNote(known, frame)).toContain('消耗 1 点永焰');
    expect(publicCost({ ...known, label: 'Thaw the frozen stable door' })).toBeNull();
    expect(publicCost({ ...known, label: 'Unknown' })).toBeNull();
  });
  it.each([
    ['You spent one charge thawing the inspected reachable floor. This action does not certify distant ground or prevent later freezing.', '你消耗了 1 点充能，融开了眼前的冰面。'],
    ['You spent one charge thawing the nearby stable door. Opening it and passing through remain separate actions.', '你消耗了 1 点充能，解冻了附近的马厩门。打开它和穿过门口仍是另外两项行动。'],
    ['You opened the nearby stable door in this action. Passing through is separate; later changes can still affect the doorway.', '你打开了附近的马厩门。'],
    ['You closed the nearby stable door in this action. This does not report what happened to people on the other side.', '你关上了附近的马厩门。'],
  ])('matches the entire newly authored feedback: %s', (original, translated) => {
    expect(feedbackText({ ...frame, feedback: { status: 'published', actionLabel: 'Act', text: original } })).toBe(translated);
    expect(feedbackText({ ...frame, feedback: { status: 'published', actionLabel: 'Act', text: `${original} Additional public detail.` } })).not.toBe(translated);
  });
  it.each([
    ['tower_base', 'At the foot of the tower', '塔下'],
    ['tower_wall_landing', 'Tower wall landing', '塔墙平台'],
    ['tower_top', 'Top of the tower', '塔顶'],
    ['alpha_box_interior', 'Inside the tower chest', '塔下宝箱内部'],
    ['queen_box_interior', 'Inside the carried reward box', '报酬锁盒内部'],
  ])('localizes only the publicly supplied site label for %s', (id, label, translated) => {
    const known = { ...threshold, scene: { ...threshold.scene!, siteLabels: { [id]: label } } };
    expect(siteName(id, known)).toBe(translated); expect(siteName(id, threshold)).toBe('未知地点');
    expect(siteName('unpublished_site', known)).toBe('未知地点');
  });
  it('shows the actual heard dialogue facts near results and before acceptance without interpreting it as a physical token', async () => {
    const { TowerConversation, ActionOutcome, CurrentSurface } = await components();
    const dialogue = { id: 'heard-1', kind: 'dialogue', label: '我实际听到的护送提议', site: null, state: 'unknown', evidence: 'heard_offer', presence: 'not_confirmed' as const,
      recordedAt: { time: 1700, revision: 18 }, detailRecordedAt: { time: 1700, revision: 18 }, facts: [
        { label: '条件', value: '以艾玛活着离开宫殿为条件，提出交付所许诺的物品。' },
        { label: '现状', value: '提议不等于已经交付，也不保证最终兑现。' },
        { label: '接受的含义', value: '你当场表示接受；不保证对方听见、采取行动或交付物品。' },
      ] };
    const heard: Frame = { ...threshold, observations: [dialogue], feedback: { status: 'published', entry: 'ask_alpha_adventurer', actionLabel: 'Ask', text: 'Action resolved.', result } };
    expect(publicTowerDialogue(heard)).toEqual([dialogue]); expect(publicTowerDialogue(heard)[0]).toBe(dialogue);
    const outcome = renderToStaticMarkup(createElement(ActionOutcome, { frame: heard, busy: false, error: null, onRefresh: vi.fn() }));
    const confirmation = renderToStaticMarkup(createElement(TowerConversation, { frame: heard, accepting: true }));
    for (const fact of dialogue.facts) { expect(outcome).toContain(fact.value); expect(confirmation).toContain(fact.value); }
    expect(outcome.indexOf(dialogue.facts[0].value)).toBeLessThan(outcome.indexOf('本次变化'));
    expect(confirmation).toContain('时刻 1700'); expect(confirmation).toContain('上次听到的提议');
    expect(renderToStaticMarkup(createElement(CurrentSurface, { frame: heard, onSelect: vi.fn() }))).not.toContain(dialogue.label);
    expect(outcome).not.toMatch(/金币.*\d|必定交付|收费原因/);
  });
  it('does not make unread dialogue from an accept entry, raw display fields, or unrelated records', async () => {
    const { TowerConversation, ActionOutcome } = await components();
    const absent: Frame = { ...threshold, observations: [], feedback: { status: 'published', entry: 'ask_alpha_adventurer', actionLabel: 'Ask', text: 'Action resolved.', result },
      offers: [{ index: 912, entry: 'accept_alpha_adventurer', label: 'Accept the heard offer to take Emma out alive (no item delivered yet)' }] };
    const raw = { ...absent, fields: { ...absent.fields, details: [{ label: 'The conditional offer I actually heard', value: 'invented terms' }] }, observations: [{ ...frame.observations[0], kind: 'dialogue', evidence: 'unrelated' }] };
    expect(publicTowerDialogue(raw)).toEqual([]);
    expect(TowerConversation({ frame: raw })).toBeNull();
    const confirmation = renderToStaticMarkup(createElement(TowerConversation, { frame: raw, accepting: true }));
    const outcome = renderToStaticMarkup(createElement(ActionOutcome, { frame: raw, busy: false, error: null, onRefresh: vi.fn() }));
    expect(confirmation).toContain('还没有听清这项提议的条件'); expect(outcome).toContain('还没有听清这项提议的条件');
    expect(`${confirmation}${outcome}`).not.toContain('invented terms'); expect(`${confirmation}${outcome}`).not.toContain('以艾玛活着');
    expect(absent.offers[0].index).toBe(912);
  });
  it('warns from same target detail history before carrying or speaking, without removing an offer or naming anonymous people', async () => {
    const { TargetHistoryWarning, ActionChoices } = await components();
    const target = { ...surfaceFrame.information.visibleEntities[3], id: 'seen-1', label: '未辨认姓名的个体 3' };
    const known: Frame = { ...surfaceFrame,
      information: { ...surfaceFrame.information, visibleEntities: [target] },
      observations: [{ ...frame.observations[0], label: '旧公开目标称呼', state: 'unknown', recordedAt: { time: 500, revision: 5 }, detailRecordedAt: { time: 400, revision: 4 }, facts: [{ label: '生命', value: 'Dead' }] }],
      offers: [
        { index: 710, entry: 'carry_move_adventurer', label: 'Carry observed patient toward the threshold', targetIds: ['seen-1'] },
        { index: 720, entry: 'offer_torch_adventurer', label: 'Offer Everflame', targetIds: ['seen-1'] },
      ],
    };
    for (const offer of known.offers) {
      const warning = historicalTargetWarning(offer, known)!;
      expect(warning).toContain('未辨认姓名的个体 3'); expect(warning).toContain('时刻 400'); expect(warning).not.toContain('时刻 500');
      expect(warning).toContain('在附近重新观察'); expect(warning).not.toContain('旧公开目标称呼');
      expect(historicalTargetWarning({ ...offer, targetIds: ['seen-99'] }, known)).toBeNull();
      expect(historicalTargetWarning({ ...offer, targetIds: undefined }, known)).toBeNull();
      expect(offerGroups(known).flatMap(g => g.offers)).toContain(offer);
      expect(renderToStaticMarkup(createElement(TargetHistoryWarning, { offer, frame: known }))).toContain('上次观察记录为死亡');
      expect(actionName(offer)).not.toContain('受困者');
    }
    const html = renderToStaticMarkup(createElement(ActionChoices, { frame: known, offers: known.offers, blocked: false, selectedIndex: null, onAct: vi.fn(), onPreview: vi.fn() }));
    expect(html).toContain('上次观察记录为死亡，现况未知'); expect(html).not.toContain('必然拒绝');
  });
  it('consumes a currently offered anonymous nearby-person observation using its original entry, index and target', async () => {
    const { CurrentSurface, SurfaceActionGap, ActionChoices } = await components();
    const person = { ...surfaceFrame.information.visibleEntities[3], id: 'seen-123', label: '未辨认姓名的个体 3' };
    const offer: Offer = { index: 811, entry: 'observe_resident_adventurer', label: 'Observe nearby person', targetIds: [person.id] };
    const nearby: Frame = { ...surfaceFrame, observations: [], information: { ...surfaceFrame.information, visibleEntities: [person] }, offers: [offer] };
    const select = vi.fn(); const act = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const surface = CurrentSurface({ frame: nearby, onSelect: select });
      surface.props.children[2].props.children[0].props.onClick();
      expect(select).toHaveBeenCalledWith(person.id); expect(fetcher).not.toHaveBeenCalled();
      const associated = contextOffers(nearby, { kind: 'surface', id: person.id });
      expect(associated).toEqual([offer]); expect(associated[0]).toBe(offer);
      expect(SurfaceActionGap({ frame: nearby, id: person.id, onBrowse: vi.fn() })).toBeNull();
      expect(actionName(offer)).toBe('观察附近人物'); expect(targetNames(offer, nearby)).toEqual([person.label]); expect(needsConfirmation(offer)).toBe(true);
      const actions = ActionChoices({ frame: nearby, offers: associated, blocked: false, selectedIndex: null, onAct: act, onPreview: vi.fn() });
      const button = actions.props.children[0].props.children[1][0]; const initiator = {};
      button.props.onClick({ currentTarget: initiator }); expect(act).toHaveBeenCalledWith(offer, initiator);
      const html = renderToStaticMarkup(actions); expect(html).toContain(person.label); expect(html).toContain('观察附近人物'); expect(html).not.toContain('仪式处居民');
      expect(fetcher).not.toHaveBeenCalled(); expect(nearby.observations).toEqual([]); expect(offer.index).toBe(811);
      const absent = { ...nearby, offers: [] };
      expect(contextOffers(absent, { kind: 'surface', id: person.id })).toEqual([]);
      expect(SurfaceActionGap({ frame: absent, id: person.id, onBrowse: vi.fn() })).not.toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
