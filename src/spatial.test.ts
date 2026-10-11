import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Frame, Offer, SessionResponse } from './types';
import { emptyPlayReport } from './playReport.fixtures';
import { knownPath, latestHistory, nextStep, recentThawDetailNote, selectedSiteOffers, siteRegion, spatialGraph, surfaceReadbackChanges } from './spatial';
import { actionName, feedbackTitle, journeyGuidance, observationDetailNote, publicCost, text } from './tabletop';

// Explicit public-frame fixtures, not compiled scenes or evidence of real play.
const opening: Frame = {
  time: 0, ending: null, briefing: '可以尝试解冻或搬离祭品中断仪式；出宫方向可返回大厅入口继续探索。',
  fields: { details: [], lifeState: 'alive', coldState: 'mobile', location: 'Ballroom entrance', locationId: 'ballroom_entrance', everflameCharges: 5, carriedReservoirCharges: null, coldCondition: 'mobile', movementSpeed: 5, chandelierClue: null, ritualSigns: null, protection: [] },
  scene: { playerSite: 'ballroom_entrance', knownSites: ['ballroom_entrance', 'ritual_passage_entry', 'ritual_threshold', 'ritual_ring', 'treasure_approach', 'halls_ballroom_door'], siteLabels: {}, routes: [
    { start: 'ballroom_entrance', end: 'ritual_passage_entry', kind: 'ice' },
    { start: 'ritual_passage_entry', end: 'ritual_threshold', kind: 'walk' },
    { start: 'ritual_threshold', end: 'ritual_ring', kind: 'walk' },
    { start: 'ritual_threshold', end: 'treasure_approach', kind: 'walk' },
    { start: 'ritual_threshold', end: 'ritual_passage_entry', kind: 'walk' },
    { start: 'ritual_passage_entry', end: 'ballroom_entrance', kind: 'ice' },
    { start: 'ballroom_entrance', end: 'halls_ballroom_door', kind: 'walk' },
  ] },
  observations: [], offers: [
    { index: 84, entry: 'cross_ice_adventurer', label: 'Attempt crossing toward Ritual passage', destination: 'ritual_passage_entry', movementKind: 'ice' },
    { index: 22, entry: 'move_adventurer', label: 'Attempt direct passage (ice may block) to Halls beside the ballroom', destination: 'halls_ballroom_door', movementKind: 'walk' },
    { index: 10, entry: 'observe_floor_adventurer', label: 'Inspect floor' },
  ],
  information: { visibility: 'provided', visibilityNotice: '同区域存在，不含详细状态', visibleEntities: [], nearbyEntities: [], movements: [],
    ritual: { phase: 'unknown', label: '尚未察觉仪式现况', evidence: 'unknown', recordedAt: null },
    escortResponse: { status: 'not_observed', label: '尚未观察到回应' }, timingNotice: '行动与观察推进世界，思考不会。' },
};
const response = (frame: Frame, revision = 0, sessionId = 'spatial-fixture'): SessionResponse => ({ frame, revision, sessionId, entries: [], playReport: emptyPlayReport() });
const at = (id: string, phase: Frame['information']['ritual']['phase'] = 'completed'): Frame => ({ ...opening,
  scene: { ...opening.scene!, playerSite: id, knownSites: [...opening.scene!.knownSites, id] },
  information: { ...opening.information, ritual: { ...opening.information.ritual, phase } },
});
async function components() {
  vi.stubGlobal('window', { sessionStorage: undefined });
  try { return await import('./App'); } finally { vi.unstubAllGlobals(); }
}

describe('public spatial orientation fixtures', () => {
  it('groups only supplied knowledge and does not treat known sites as visited or generate reverse edges', () => {
    const graph = spatialGraph(opening);
    expect(graph.regions.map(r => r.id).sort()).toEqual(['ballroom', 'halls', 'ritual', 'treasure']);
    expect(graph.nodes).toHaveLength(6); expect(graph.nodes.some(n => n.id === 'palace_exit')).toBe(false);
    expect(graph.edges.some(e => e.start === 'ritual_ring' && e.end === 'ritual_threshold')).toBe(false);
    expect(graph.regionEdges.some(e => e.start === 'halls' && e.end === 'ballroom')).toBe(false);
    expect(graph.nodes).not.toHaveProperty('visited');
    expect(siteRegion('undisclosed_place')).toEqual({ id: 'other', label: '其他已知地点' });
  });
  it('never learns site labels alone, private observations or a mission string as map nodes', () => {
    const changed = { ...opening, briefing: '提及一个秘密地点与未公开出口', scene: { ...opening.scene!, siteLabels: { secret_exit: 'Hidden exit', tower_top: 'Top of the tower' } },
      observations: [{ id: 'private-looking-fixture', kind: 'person', label: 'Historical person', site: 'tower_top', state: 'unknown', evidence: 'history', presence: 'not_confirmed' as const, facts: [], recordedAt: { time: 0, revision: 0 }, detailRecordedAt: null }] };
    expect(spatialGraph(changed).nodes).toEqual(spatialGraph(opening).nodes);
    expect(spatialGraph(changed).nodes.some(node => ['tower_top', 'secret_exit'].includes(node.id))).toBe(false);
  });
  it('includes only current destination attempts as dashed offer edges, without asserting recorded passage', () => {
    const offer: Offer = { index: 601, label: 'Try a public destination', destination: 'unnamed_public_site' };
    const graph = spatialGraph({ ...opening, offers: [offer] });
    expect(graph.nodes.find(n => n.id === offer.destination)!.label).toBe('未知地点');
    expect(graph.edges.find(e => e.end === offer.destination)).toEqual({ start: 'ballroom_entrance', end: offer.destination, kinds: [], offeredOnly: true });
    expect(graph.edges.some(e => e.start === offer.destination)).toBe(false);
  });
  it('finds a directed route and maps far selection to the actual current first-step index', () => {
    expect(knownPath(opening, 'ritual_ring')).toEqual(['ballroom_entrance', 'ritual_passage_entry', 'ritual_threshold', 'ritual_ring']);
    const selected = selectedSiteOffers(opening, 'ritual_ring');
    expect(selected.firstStep).toBe(true); expect(selected.offers).toEqual([opening.offers[0]]); expect(selected.offers[0]).toBe(opening.offers[0]);
    expect(selected.offers[0].index).toBe(84); expect(knownPath(opening, 'palace_exit')).toBeNull();
    expect(knownPath({ ...at('ritual_ring'), offers: [] }, 'halls_ballroom_door')).toBeNull();
  });
  it('handles disconnected, missing and cyclic knowledge without manufacturing a first step', () => {
    const disconnected = { ...opening, scene: { ...opening.scene!, routes: [] }, offers: [] };
    expect(knownPath(disconnected, 'ritual_ring')).toBeNull(); expect(selectedSiteOffers(disconnected, 'ritual_ring').offers).toEqual([]);
    expect(knownPath({ ...opening, scene: undefined, offers: [] }, 'ritual_ring')).toBeNull();
    expect(knownPath(opening, 'ballroom_entrance')).toEqual(['ballroom_entrance']);
    expect(spatialGraph({ ...opening, scene: undefined, offers: [] }).nodes.map(n => n.id)).toEqual(['ballroom_entrance']);
  });
  it('summarizes an actual authored success instead of inferring it from the selected action', () => {
    const carry = 'You carried the frozen resident away from the ritual and interrupted it. Carrying is not thawing or rescuing; check the local record below and observe the resident nearby.';
    const thaw = 'You spent one charge thawing the person. This is not yet a rescue; invite them and observe them again when you meet on the way out. Protection forecasts use your available knowledge; unknown does not mean safe or unsafe.';
    const frame = (raw: string, status: 'published' | 'rejected' = 'published'): Frame => {
      const receipt = { entry: 'thaw_person_adventurer', actionLabel: 'Thaw', text: raw };
      return { ...opening, feedback: status === 'rejected' ? { ...receipt, status, refusal: { code: 'K0_NOT_ADMITTED' } } : { ...receipt, status } };
    };
    expect(feedbackTitle(frame(carry))).toBe('你把冰封居民搬离仪式，并中断了仪式。');
    expect(feedbackTitle(frame(thaw))).toBe('你消耗了 1 点充能解冻对方。');
    expect(feedbackTitle(frame(carry, 'rejected'))).toBe('行动未发生');
    expect(feedbackTitle(frame('Unrecognized public result.'))).toContain('已结算');
  });
  it('prioritizes the actual ritual direction before a voluntary floor inspection', () => {
    const guide = nextStep(opening);
    expect(guide.title).toContain('优先探索仪式'); expect(guide.next).toContain('仪式通道');
    expect(guide.offers).toEqual([opening.offers[0]]); expect(guide.detail).toContain('根据眼前可用的行动选择路线');
    expect(guide.detail).not.toContain('可以直接选择穿冰');
    expect(guide.offers).not.toContain(opening.offers[2]); expect(guide.detail).not.toMatch(/\d+|秒|回合|必定/);
  });
  it('offers carry/thaw only when actually present, preserving targets and refusing to assert success', () => {
    const carry: Offer = { index: 707, entry: 'carry_from_ritual_adventurer', label: 'Carry', targetIds: ['seen-1'] };
    const thaw: Offer = { index: 809, entry: 'thaw_ritual_resident', label: 'Spend one charge to thaw the observed resident', targetIds: ['seen-1'] };
    const critical = { ...at('ritual_ring', 'critical'), offers: [carry, thaw] };
    expect(nextStep(critical).offers).toEqual([carry, thaw]); expect(nextStep(critical).offers[0]).toBe(carry);
    expect(nextStep(critical).next).toContain('尝试把居民带离仪式圈'); expect(nextStep(critical).detail).not.toMatch(/已中断|已获救/);
    expect(nextStep({ ...critical, offers: [] }).offers).toEqual([]);
    expect(nextStep({ ...critical, information: { ...critical.information, ritual: { ...critical.information.ritual, phase: 'completed' } } }).offers).not.toContain(carry);
    expect(publicCost(thaw)).toBe('消耗 1 点永焰');
  });
  it.each(['completed', 'disrupted'] as const)('uses the authored hall exploration direction only from ritual knowledge after %s', phase => {
    const current = { ...at('ritual_threshold', phase), offers: [{ index: 60, entry: 'move_adventurer', label: 'Move', destination: 'ritual_passage_entry' }] };
    const guide = nextStep(current);
    expect(guide.path.at(-1)).toBe('halls_ballroom_door'); expect(guide.offers[0]).toBe(current.offers[0]);
    expect(guide.next).toContain('返回大厅入口'); expect(guide.title).not.toContain('中断机会'); expect(guide.detail).toContain('继续帮助居民');
    const fallback = nextStep({ ...current, briefing: undefined });
    expect(fallback.next).not.toContain('返回大厅入口'); expect(fallback.next).toContain('还不熟悉的通路');
  });
  it.each(['halls_ballroom_door', 'halls_bridge_door', 'bridge_palace_landing'])('does not pull %s back to a hall loop when exit is not known', id => {
    const query = { index: 700, entry: 'observe_routes_adventurer', label: 'Look for routes from here' };
    const current = { ...at(id), offers: [query] };
    const guide = nextStep(current);
    expect(guide.next).toContain(id === 'bridge_palace_landing' ? '查看眼前的桥路' : '先寻找附近通路'); expect(guide.offers).toEqual([query]); expect(guide.path).toEqual([]);
    expect(guide.next).not.toContain('返回大厅'); expect(guide.next).not.toContain('秘密出口');
  });
  it('does not loop from bridge even with a known return to the hall, and prioritizes a known directed exit once connected', () => {
    const current = at('bridge_palace_landing');
    current.scene = { ...current.scene!, routes: [...current.scene!.routes, { start: 'bridge_palace_landing', end: 'halls_ballroom_door', kind: 'walk' }] };
    current.offers = [{ index: 801, entry: 'observe_routes_adventurer', label: 'Routes' }, { index: 802, label: 'Move back', destination: 'halls_ballroom_door' }];
    expect(nextStep(current).path).toEqual([]); expect(nextStep(current).offers).toEqual([current.offers[0]]);
    const exitOffer = { index: 901, label: 'Careful bridge crossing (no balance roll; same cost as risky crossing) toward shore', destination: 'palace_exit', entry: 'bridge_slow_adventurer' };
    const connected = { ...current, scene: { ...current.scene, routes: [...current.scene.routes, { start: 'bridge_palace_landing', end: 'palace_exit', kind: 'bridge' }] }, offers: [exitOffer] };
    expect(nextStep(connected).path).toEqual(['bridge_palace_landing', 'palace_exit']); expect(nextStep(connected).offers[0]).toBe(exitOffer);
  });
  it('keeps missing exit or a disconnected known exit honest, and read-only terminal guidance without ongoing actions', () => {
    const current = { ...at('tower_base'), offers: [] };
    expect(nextStep(current).next).toContain('出口的方向还不清楚');
    const knownExit = { ...current, scene: { ...current.scene!, knownSites: [...current.scene!.knownSites, 'palace_exit'] } };
    expect(nextStep(knownExit).next).toContain('还不清楚怎样从这里到达外岸');
    const ended = { ...knownExit, ending: { id: 'finished', title: '旅程结束', narrationZh: '保留的结束记录' }, offers: opening.offers };
    expect(nextStep(ended).offers).toEqual([]); expect(nextStep(ended).next).toBe('旅程结束'); expect(nextStep(ended).detail).not.toContain('推进仪式');
  });
  it('preserves preparing distinct from gathering and transports briefing verbatim without deriving map knowledge', async () => {
    const { NextStepGuidance } = await components();
    const preparing = at('ballroom_entrance', 'preparing');
    expect(text(preparing.information.ritual.phase)).toBe('准备中'); expect(journeyGuidance(preparing).title).toContain('准备中');
    const html = renderToStaticMarkup(createElement(NextStepGuidance, { frame: preparing, blocked: false, onAct: vi.fn() }));
    expect(html).toContain(preparing.briefing); expect(html).toContain('此行缘由');
    const fallback = renderToStaticMarkup(createElement(NextStepGuidance, { frame: { ...preparing, briefing: undefined }, blocked: false, onAct: vi.fn() }));
    expect(fallback).not.toContain('此行缘由');
  });
  it('only intentional guidance activation passes its exact offer; rendering never requests observations', async () => {
    const { NextStepGuidance } = await components(); const act = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const view = NextStepGuidance({ frame: opening, blocked: false, onAct: act });
      const button = view.props.children[1][0]; const initiator = {} as HTMLButtonElement;
      expect(button.props['data-guidance-offer-index']).toBe(84); expect(act).not.toHaveBeenCalled();
      renderToStaticMarkup(view); expect(fetcher).not.toHaveBeenCalled();
      button.props.onClick({ currentTarget: initiator }); expect(act).toHaveBeenCalledWith(opening.offers[0], initiator); expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('observed targets, resources and view differences', () => {
  const person = { id: 'seen-1', kind: 'person' as const, label: '未辨认姓名的个体 1', site: 'ritual_threshold', state: 'unknown' as const, facts: [] as [], evidence: 'current_surface' as const, presence: 'current' as const };
  const history = { ...person, site: 'ritual_ring', state: 'frozen', presence: 'not_confirmed' as const, evidence: 'last_observed', facts: [{ label: '生命', value: 'Alive' }, { label: '御寒', value: 'Frozen' }], recordedAt: { time: 500, revision: 5 }, detailRecordedAt: { time: 300, revision: 3 } };
  const observed = { ...opening, scene: { ...opening.scene!, playerSite: 'ritual_threshold' }, observations: [history], information: { ...opening.information, visibleEntities: [person] } };
  it('shows same-id detail history immediately with its old time, not a new free observation or current frozen state', async () => {
    const { SurfaceHistory } = await components();
    const html = renderToStaticMarkup(createElement(SurfaceHistory, { frame: observed, id: person.id }));
    expect(html).toContain('data-testid="surface-history"'); expect(html).toContain('上次观察（时刻 300'); expect(html).toContain('生命'); expect(html).toContain('冰封');
    expect(html).toContain('上次观察'); expect(latestHistory(observed, 'other-id')).toBeUndefined();
    const missing = renderToStaticMarkup(createElement(SurfaceHistory, { frame: observed, id: 'other-id' }));
    expect(missing).toContain('还没有仔细观察过这个目标'); expect(missing).not.toContain('冰封');
  });
  it('warns about unrefreshed older details only for an actually submitted target and authored successful thaw feedback', async () => {
    const { SurfaceHistory } = await components();
    const offer: Offer = { index: 709, entry: 'thaw_person_adventurer', label: 'Spend one charge to thaw the person', targetIds: [person.id] };
    const thawed: Frame = { ...observed, time: 600, feedback: { status: 'published', entry: offer.entry, actionLabel: offer.label, text: 'You spent one charge thawing the person. This is not yet a rescue; invite them and observe them again when you meet on the way out. Protection forecasts use your available knowledge; unknown does not mean safe or unsafe.' } };
    expect(recentThawDetailNote(thawed, history, offer)).toContain('较早的观察');
    expect(recentThawDetailNote(thawed, history)).toBeNull(); expect(recentThawDetailNote(thawed, history, { ...offer, targetIds: ['other-id'] })).toBeNull();
    expect(recentThawDetailNote({ ...thawed, feedback: { ...thawed.feedback!, text: 'Action resolved.' } }, history, offer)).toBeNull();
    expect(recentThawDetailNote({ ...thawed, feedback: { ...thawed.feedback!, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } } }, history, offer)).toBeNull();
    expect(recentThawDetailNote(thawed, { ...history, detailRecordedAt: { time: 600, revision: 6 } }, offer)).toBeNull();
    const html = renderToStaticMarkup(createElement(SurfaceHistory, { frame: thawed, id: person.id, submitted: offer }));
    expect(html).toContain('刚刚已解冻对方'); expect(html).toContain('可以再查看一次'); expect(thawed.observations[0].state).toBe('frozen');
  });
  it.each([5, 4, 3, 0, 7])('shows %s yellow filled pips and gray remaining slots without changing known charges', async charge => {
    const { ResourceReadbacks } = await components();
    const html = renderToStaticMarkup(createElement(ResourceReadbacks, { frame: { ...opening, fields: { ...opening.fields, everflameCharges: charge } } }));
    expect((html.match(/data-filled="true"/g) ?? []).length).toBe(charge);
    expect((html.match(/data-filled="false"/g) ?? []).length).toBe(Math.max(5, charge) - charge); expect(html).toContain(`永焰已知充能 ${charge} 点`);
  });
  it('explains absent Everflame detail as a record scope, never a contradiction of HUD charge', async () => {
    const { SurfaceHistory, ActionOutcome } = await components();
    const item = { ...history, id: 'seen-fire', kind: 'everflame', label: 'Everflame', facts: [], state: 'unknown' };
    expect(observationDetailNote(item)).toContain('存在记录没有详细状态；充能见上方本人状态');
    expect(observationDetailNote({ ...history, facts: [] })).toBeNull();
    expect(observationDetailNote({ ...item, kind: 'person', label: '未辨认个体' })).toBe('这条存在记录没有详细状态。');
    const current: Frame = { ...opening, observations: [item], feedback: { status: 'published', actionLabel: 'Move', text: 'Action resolved.', result: { changes: [], laterChanges: [], discoveries: [{ kind: 'observation', change: 'updated', observation: item }], laterDiscoveries: [] } } };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame: current, busy: false, error: null, onRefresh: vi.fn() }));
    expect(html).toContain('这条永焰存在记录没有详细状态'); expect(html).not.toContain('永焰：未知');
    expect(renderToStaticMarkup(createElement(SurfaceHistory, { frame: current, id: item.id }))).not.toContain('充能未知');
  });
  it.each(['Observe ', 'Spend one charge to open ', 'Pass through '])('retains the two actual public wall labels for %s', prefix => {
    const entry = prefix === 'Observe ' ? 'observe_wall_adventurer' : prefix === 'Pass through ' ? 'move_wall_adventurer' : 'open_plain_wall_adventurer';
    const release = { index: 31, entry, label: `${prefix}Release ice wall` }; const treasure = { ...release, index: 90, label: `${prefix}Treasure ice wall` };
    expect(actionName(release)).toContain('释放冰墙'); expect(actionName(treasure)).toContain('宝箱冰墙'); expect(actionName(release)).not.toBe(actionName(treasure));
    expect(actionName(release)).not.toContain('居民');
    expect(`${actionName(release)}${actionName(treasure)}`).not.toMatch(/死亡|存活|金币|获救|已打开/);
    expect(release.index).toBe(31); expect(treasure.index).toBe(90);
  });
  it('compares public surfaces as view differences without a causal movement or acceptance claim', async () => {
    const { SurfaceReadbackSummary } = await components();
    const next = { ...observed, information: { ...observed.information, visibleEntities: [{ ...person, id: 'seen-2', label: '未辨认个体 2' }] } };
    const changes = surfaceReadbackChanges(response(observed), response(next, 1));
    expect(changes.map(c => c.kind)).toEqual(['appeared', 'disappeared']);
    const html = renderToStaticMarkup(createElement(SurfaceReadbackSummary, { changes }));
    expect(html).toContain('目前在此见到未辨认个体 2'); expect(html).toContain('当前地点不再看见未辨认姓名的个体 1；去向未观察到');
    expect(html).not.toMatch(/接受了护送|已获救|正在同行/); expect(html).not.toContain('接受了邀请');
    expect(surfaceReadbackChanges(null, response(next))).toEqual([]);
    expect(surfaceReadbackChanges(response(observed), response(next, 1, 'another'))).toEqual([]);
    expect(surfaceReadbackChanges(response(observed), response({ ...next, information: { ...next.information, visibility: 'unavailable' } }))).toEqual([]);
    expect(surfaceReadbackChanges(response(observed), response(observed, 1))).toEqual([]);
  });
  it('links a new actual movement record separately, but never labels old motion as the latest disappearance cause', () => {
    const movement = { id: 'motion-1', subjectId: person.id, label: person.label, start: 'ritual_ring', end: 'ritual_threshold', recordedAt: { time: 500, revision: 5 } };
    const absent = { ...observed, information: { ...observed.information, visibleEntities: [], movements: [movement] } };
    expect(surfaceReadbackChanges(response(observed), response(absent))[0].hasMovement).toBe(true);
    expect(surfaceReadbackChanges(response({ ...observed, information: { ...observed.information, movements: [movement] } }), response(absent))[0].hasMovement).toBe(false);
  });
  it('keeps immediate and later resource results meaningful in the collapsed receipt without concealing a rejection', async () => {
    const { ReceiptSummary } = await components();
    const current: Frame = { ...opening, feedback: { status: 'published', actionLabel: 'Thaw', text: 'Action resolved.', result: { changes: [{ field: 'everflameCharges', before: 5, after: 4 }], laterChanges: [{ field: 'endurance', before: 3, after: 2 }], discoveries: [], laterDiscoveries: [] } } };
    const html = renderToStaticMarkup(createElement(ReceiptSummary, { frame: current }));
    expect(html).toContain('本次永焰 5 → 4'); expect(html).toContain('随后耐力 3 → 2');
    expect(renderToStaticMarkup(createElement(ReceiptSummary, { frame: { ...current, feedback: { ...current.feedback!, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } } } }))).toContain('行动未发生');
  });
});
