import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { publicFrame } from './presence.fixtures';
import { emptyPlayReport } from './playReport.fixtures';
import { PlayReport } from './PlayReport';
import { actionNote, contextOffers, journeyGuidance, locationNote } from './tabletop';
import { EndingSummary } from './EndingSummary';

vi.stubGlobal('window', { sessionStorage: undefined });
const { AdventureStatus, CheckConclusion, EscortResponse, PolicyProgress, PolicyDetails, LocalCommands, PublicFirstStep, StoppedPolicyNotice, requiresActionConfirmation, uniqueSelectionOffer, SiteActionGap, DiscoverySummary, LatestReceipt, actionTimingNote } = await import('./App');

describe('stranger-facing public readback', () => {
  it('keeps invitation results in an explicit reader, never an automatically expanded scene overlay', () => {
    const frame = publicFrame();
    frame.feedback = {status: 'published', entry: 'offer_escort_adventurer', actionLabel: 'Invite', text: 'Invitation published'};
    const html = renderToStaticMarkup(createElement(LatestReceipt, {frame, error: null, onRead: () => {}}));
    expect(html).toContain('查看本次结果');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('receipt-scroll');
    expect(html).not.toContain('role="dialog"');
  });
  it('does not present retained frozen detail as a new change when only the location record updates', () => {
    const frame = publicFrame();
    const observation = {id: 'p', kind: 'person', label: 'Resident', site: 'ritual_threshold', state: 'frozen', evidence: 'local_record', facts: [{label: 'State', value: 'frozen'}], presence: 'not_confirmed' as const,
      recordedAt: {time: 500, revision: 5}, detailRecordedAt: {time: 200, revision: 2}};
    const items = [{kind: 'observation' as const, change: 'updated' as const, observation}];
    const before = structuredClone(items);
    const html = renderToStaticMarkup(createElement(DiscoverySummary, {items, frame}));
    expect(html).toContain('所见记录更新');
    expect(html).toContain('时刻 200');
    expect(html).not.toContain('frozen');
    expect(items).toEqual(before);
    observation.detailRecordedAt = observation.recordedAt;
    expect(renderToStaticMarkup(createElement(DiscoverySummary, {items, frame}))).toContain('冰封');
  });
  it('links a currently visible torch to existing thaw offers without changing targets or creating offers', () => {
    const frame = publicFrame();
    frame.information.visibleEntities = [{id: 'torch', kind: 'everflame', label: 'Everflame', site: frame.fields.locationId!, state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current'}];
    frame.offers = [{index: 47, entry: 'thaw_floor_adventurer', label: 'Spend one charge'}, {index: 61, entry: 'thaw_person_adventurer', label: 'Thaw', targetIds: ['p']}];
    const snapshot = structuredClone(frame);
    expect(contextOffers(frame, {kind: 'surface', id: 'torch'}).map(row => row.index)).toEqual([47, 61]);
    expect(uniqueSelectionOffer(frame, {kind: 'surface', id: 'torch'})).toBeUndefined();
    expect(frame).toEqual(snapshot);
    frame.information.visibleEntities = [];
    expect(contextOffers(frame, {kind: 'object', id: 'torch'})).toEqual([]);
  });
  it('explains resource purposes and departure without claiming a zero-time ending consumes time', () => {
    const frame = publicFrame();
    expect(actionNote({index: 1, entry: 'detach_reservoir_adventurer', label: ''}, frame)).toContain('给永焰补能');
    expect(actionNote({index: 1, entry: 'thaw_floor_adventurer', label: ''}, frame)).toContain('可达冰面');
    const leave = {index: 1, entry: 'leave_palace_adventurer', label: ''};
    expect(actionNote(leave, frame)).toContain('结束这次旅程');
    expect(actionTimingNote(leave)).not.toContain('耗去时间');
  });
  it('preselects a unique target offer without executing or choosing among alternatives', () => {
    const frame = publicFrame();
    frame.offers = [{index: 83, entry: 'observe_resident_adventurer', label: 'Inspect', targetIds: ['p']}];
    frame.information.visibleEntities = [{id: 'p', kind: 'person', label: 'Person', site: frame.fields.locationId!, state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current'}];
    expect(uniqueSelectionOffer(frame, {kind: 'surface', id: 'p'})?.index).toBe(83);
    expect(uniqueSelectionOffer(frame, {kind: 'all'})).toBeUndefined();
    frame.offers[0].targetIds = ['p', 'other'];
    expect(uniqueSelectionOffer(frame, {kind: 'surface', id: 'p'})).toBeUndefined();
    frame.offers[0].targetIds = ['p'];
    frame.offers.push({...frame.offers[0], index: 84});
    expect(uniqueSelectionOffer(frame, {kind: 'surface', id: 'p'})).toBeUndefined();
  });
  it('offers a current route check rather than promising unknown movement', () => {
    const frame = publicFrame();
    frame.offers = [{index: 35, entry: 'observe_routes_adventurer', label: 'Look'}];
    const html = renderToStaticMarkup(createElement(SiteActionGap, {frame, id: 'palace_exit', onAct: () => {}}));
    expect(html).toContain('外岸');
    expect(html).toContain('寻找附近通路');
    expect(html).toContain('舞厅入口');
    expect(html).not.toContain('可以抵达');
    frame.offers = [];
    expect(renderToStaticMarkup(createElement(SiteActionGap, {frame, id: 'palace_exit', onAct: () => {}}))).not.toContain('<button');
    const here = renderToStaticMarkup(createElement(SiteActionGap, {frame, id: frame.fields.locationId!, onAct: () => {}}));
    expect(here).toContain('当前没有与这个地点对应的行动');
    expect(here).not.toContain('前往行动');
  });
  it('translates plan names and folds diagnostic weights separately from the current reason', () => {
    const policy = {id: 'r', intentId: 'helpful_rescuer', label: '热心救援者', status: 'stopped' as const, executed: 1, limit: 4, stopOnUnexpected: true, reason: '完成上限', stopDetail: null,
      plan: {goal: '仪式', targetSite: 'ritual_ring', route: [{site: 'ritual_ring', label: 'Ritual circle'}], estimatedActions: 1, uncertainty: '', estimatedGain: 1, value: 1000},
      steps: [{index: 1, entry: 'move_adventurer', label: 'Walk', score: 1550, reason: '沿已知路线前进', beforeRevision: 0, afterRevision: 1, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 0, afterTime: 100}]};
    const html = renderToStaticMarkup(createElement(PolicyDetails, {policy, offers: []}));
    expect(html).toContain('预计路线：仪式圈');
    expect(html).not.toContain('Ritual circle');
    expect(html).toContain('<details><summary>计算记录</summary>');
  });
  it('does not ask the player to wait indefinitely for an unobserved answer', () => {
    const frame = publicFrame();
    const html = renderToStaticMarkup(createElement(EscortResponse, {frame}));
    expect(html).toContain('可以继续行动');
    expect(html).not.toContain('同意同行');
  });
  it('renders public motion names and endpoints without turning them into escort assent', () => {
    const frame = publicFrame();
    frame.information.movements = [{id: 'm', subjectId: 'p', label: 'Resident at the ritual', start: 'ritual_ring', end: 'ritual_threshold', recordedAt: {time: 400, revision: 4}}];
    const html = renderToStaticMarkup(createElement(EscortResponse, {frame}));
    expect(html).toContain('仪式处居民');
    expect(html).toContain('仪式圈');
    expect(html).toContain('仪式门槛');
    expect(html).not.toContain('同意了');
    expect(html).not.toContain('已获救');
  });
  it('keeps lengthy ranking explanations behind a named summary in the compact HUD', () => {
    const frame = publicFrame();
    const html = renderToStaticMarkup(createElement(PublicFirstStep, {frame, offer: {index: 1, label: 'Look'}, reason: '一段真实评价', compact: true}));
    expect(html).toContain('<details><summary>判断依据</summary>');
    expect(html).toContain('一段真实评价');
  });
  it('consistently previews manual actions even when recommendation changes', () => {
    const offer = {index: 3, entry: 'observe_routes_adventurer', label: 'Look'};
    expect(requiresActionConfirmation(offer)).toBe(true);
    expect(requiresActionConfirmation(offer, 3)).toBe(true);
    expect(requiresActionConfirmation(offer, 4)).toBe(true);
  });

  it('celebrates people actually visible at departure, not historical or distant people', () => {
    const frame = publicFrame();
    frame.fields.locationId = 'palace_exit';
    frame.ending = {id: 'departed_palace', title: '离宫', narrationZh: '离宫'};
    frame.information.visibleEntities = [{id: 'p', kind: 'person', label: '仪式处居民', site: 'palace_exit', state: 'unknown', facts: [], evidence: 'current_surface', presence: 'current'}];
    const props = {frame, report: emptyPlayReport(), onRestart: () => {}, onHistory: () => {}};
    const html = renderToStaticMarkup(createElement(EndingSummary, props));
    expect(html).toContain('你并非独自站在外岸');
    expect(html).toContain('这是你最后亲眼看见的去向');
    expect(props.report.metrics.peopleThawed).toBe(0);
    frame.information.visibleEntities[0].site = 'ritual_ring';
    expect(renderToStaticMarkup(createElement(EndingSummary, props))).not.toContain('你并非独自站在外岸');
  });
  it('retires the old compact stop reason after a later manual revision', () => {
    const policy = { id: 'run', intentId: 'helpful_rescuer', label: '热心救援者', status: 'stopped' as const, executed: 1, limit: 8, stopOnUnexpected: true, plan: null, reason: '旧的无候选原因', stopDetail: null,
      steps: [{ index: 1, entry: 'wait_adventurer', label: 'Wait', score: 0, reason: 'test', beforeRevision: 0, afterRevision: 1, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 0, afterTime: 100 }] };
    const before = renderToStaticMarkup(createElement(StoppedPolicyNotice, {policy, currentRevision: 1, onDetails: () => {}}));
    expect(before).toContain('上段停点：旧的无候选原因');
    const after = renderToStaticMarkup(createElement(StoppedPolicyNotice, {policy, currentRevision: 2, onDetails: () => {}}));
    expect(after).toContain('你已接手');
    expect(after).not.toContain('旧的无候选原因');
  });
  it('provides named commands only for unambiguous current offers, with original indexes', () => {
    const frame = publicFrame();
    frame.offers = [{index: 73, entry: 'observe_routes_adventurer', label: 'Look'}, {index: 91, entry: 'leave_palace_adventurer', label: 'Leave'}];
    const html = renderToStaticMarkup(createElement(LocalCommands, {frame, blocked: false, recommendedIndex: 73, onAct: () => {}}));
    expect(html).toContain('data-local-offer-index="73"');
    expect(html).toContain('寻找附近通路');
    expect(html).toContain('class="recommended-location"');
    expect(html).toContain('data-local-offer-index="91"');
    expect(journeyGuidance(frame).objective).toContain('完成本次旅程');
    expect(locationNote(frame)).toContain('选择');
    frame.offers.push({...frame.offers[0], index: 74});
    expect(renderToStaticMarkup(createElement(LocalCommands, {frame, blocked: true, onAct: () => {}}))).not.toContain('data-local-offer-index="73"');
    frame.offers = [];
    expect(journeyGuidance(frame).objective).not.toContain('完成本次旅程');
  });

  it('names the real first destination without predicting subsequent actions or cost', () => {
    const frame = publicFrame();
    const html = renderToStaticMarkup(createElement(PublicFirstStep, {frame, offer: {index: 11, entry: 'move_adventurer', label: 'Walk', destination: 'ritual_threshold'}, reason: '沿已知路线前进'}));
    expect(html).toContain('仪式门槛');
    expect(html).toContain('沿已知路线前进');
    expect(html).not.toContain('100');
    expect(html).not.toContain('必定');
  });
  it('always names the adventure without inventing an unknown ritual phase or countdown', () => {
    const frame = publicFrame();
    const html = renderToStaticMarkup(createElement(AdventureStatus, { frame }));
    expect(html).toContain('中断仪式');
    expect(html).toContain('仪式不会等待你');
    expect(html).not.toContain('仪式接近完成');
    expect(html).not.toContain('倒计时');
    frame.information.ritual = { phase: 'completed', label: '曾察觉仪式已完成', evidence: 'last_observed', recordedAt: { time: 2100, revision: 4 } };
    const known = renderToStaticMarkup(createElement(AdventureStatus, { frame }));
    expect(known).toContain('曾察觉仪式已完成');
    expect(known).toContain('时刻 2100');
    expect(known).not.toContain('中断仪式 ·');
  });

  it('reports known climb routes, not absence of hidden routes or a rejected check', () => {
    const frame = publicFrame();
    frame.feedback = { status: 'published', entry: 'observe_climbs_adventurer', actionLabel: 'Observe climb', text: 'Action complete' };
    let html = renderToStaticMarkup(createElement(CheckConclusion, { frame }));
    expect(html).toContain('还没有取得从此处出发的攀爬记录');
    expect(html).not.toContain('没有可攀爬处');
    frame.scene!.routes.push({ start: 'ballroom_entrance', end: 'ritual_threshold', kind: 'climb' });
    html = renderToStaticMarkup(createElement(CheckConclusion, { frame }));
    expect(html).toContain('仪式门槛');
    frame.feedback = undefined;
    expect(CheckConclusion({ frame })).toBeNull();
  });

  it('keeps observed movement distinct from assent and rescue', () => {
    const frame = publicFrame();
    frame.information.escortResponse = { status: 'movement_observed', label: 'public motion' };
    const html = renderToStaticMarkup(createElement(EscortResponse, { frame }));
    expect(html).toContain('你曾亲眼看见的移动');
    expect(html).not.toMatch(/接受了护送|已获救|正在同行/);
  });

  it('puts only exact current stop choices in the progress HUD', () => {
    const policy = { id: 'run', intentId: 'helpful_rescuer', label: '热心救援者', status: 'stopped' as const, executed: 0, limit: 8, stopOnUnexpected: true, steps: [], plan: null,
      reason: '请亲选', stopDetail: { code: 'manual_decision', choices: [{ index: 7, label: 'Wait' }, { index: 9, label: 'Old' }] } };
    const html = renderToStaticMarkup(createElement(PolicyProgress, { policy, offers: [{ index: 7, entry: 'wait_adventurer', label: 'Wait' }, { index: 9, entry: 'leave_palace_adventurer', label: 'Leave' }], pumping: false, cancelling: false, disabled: false, canContinue: true, onResume: () => {}, onCancel: () => {}, onDetails: () => {} }));
    expect(html).toContain('可亲自选择：留在原地等待');
    expect(html).not.toContain('可亲自选择：离开');
    expect(html).not.toContain('Old');
  });

  it('uses action identity for Chinese ledger names and explains unchanged score arithmetic', () => {
    const report = emptyPlayReport();
    report.actions = [{ number: 1, entry: 'observe_routes_adventurer', label: 'Observe reachable paths', mode: 'manual', personality: null, timeBefore: 0, timeAfter: 100, achievements: [], scoreDelta: { ...report.scores } }];
    report.achievements = [{ id: 'place', label: '到达：Ritual threshold', evidence: '本人实际位置' }];
    const html = renderToStaticMarkup(createElement(PlayReport, { report }));
    expect(html).toContain('寻找附近通路');
    expect(html).toContain('到达：仪式门槛');
    expect(html).toContain('每行动净收益 =');
    expect(html).not.toContain('Observe reachable paths');
    expect(html).not.toContain('Ritual threshold');
    expect(report.scores.common).toBe(0);
  });

  it('retains distinct published destinations and separates elapsed time from score costs', () => {
    const report = emptyPlayReport();
    const base = { mode: 'manual' as const, personality: null, timeBefore: 0, timeAfter: 100, achievements: [], scoreDelta: { ...report.scores } };
    report.actions = [
      { ...base, number: 1, entry: 'move_adventurer', label: 'Attempt direct passage (ice may block) to Ritual circle' },
      { ...base, number: 2, entry: 'move_adventurer', label: 'Attempt direct passage (ice may block) to Halls beside the bridge stair' },
      { ...base, number: 3, entry: 'balloon_flight_adventurer', label: 'Fly the balloon to the upper stop' },
    ];
    const html = renderToStaticMarkup(createElement(PlayReport, { report }));
    expect(html).toContain('尝试直接通行 → 仪式圈');
    expect(html).toContain('尝试直接通行 → 桥梯旁大厅');
    expect(html).toContain('驾驶球囊前往上层停靠点');
    expect(html).not.toContain('→ the upper stop');
    expect(html).toContain('耗时单独记录');
    expect(html).toContain('了解人物影响人格评价，不计共同成就');
    expect(html).not.toContain('行动时间、耐力与充能消耗计入代价');
  });
});
