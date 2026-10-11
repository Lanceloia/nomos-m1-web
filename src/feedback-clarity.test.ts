import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { memory, publicFrame, surface } from './presence.fixtures';
import { hasPublicVitalLoss, receiptDiscoveries } from './tabletop';
import type { Frame, IntentPolicy } from './types';

let components: typeof import('./App');
beforeAll(async () => {
  vi.stubGlobal('window', { sessionStorage: undefined });
  components = await import('./App');
});
afterAll(() => vi.unstubAllGlobals());

function inspected(): Frame {
  const frame = publicFrame();
  const floor = memory('local-floor', 'floor', 'ballroom_entrance');
  floor.label = '脚下冰面'; floor.state = 'frozen';
  floor.detailRecordedAt = { ...floor.recordedAt };
  frame.feedback = { status: 'published', entry: 'observe_floor_adventurer', actionLabel: 'Inspect', text: 'Public', result: {
    changes: [], laterChanges: [], discoveries: [{ kind: 'observation', change: 'new', observation: floor }], laterDiscoveries: [],
  } };
  return frame;
}

function progress(policy: IntentPolicy, currentRevision = 1) {
  return renderToStaticMarkup(createElement(components.PolicyProgress, { policy, currentRevision,
    offers: [], pumping: false, cancelling: false, disabled: false, canContinue: true,
    onResume: vi.fn(), onCancel: vi.fn(), onDetails: vi.fn() }));
}

const stopped: IntentPolicy = { id: 'policy', intentId: 'decisive_explorer', label: '果断探索者',
  status: 'stopped', reason: '达到本次 12 步上限，由你继续选择。', stopDetail: { code: 'limit', choices: [] },
  executed: 12, limit: 12, stopOnUnexpected: true, plan: null,
  steps: [{ index: 3, entry: 'wait_adventurer', label: 'Wait', score: 1, reason: 'Public',
    beforeRevision: 0, afterRevision: 1, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 0, afterTime: 100 }] };

describe('visible public feedback and handover', () => {
  it('summarizes invitation outcomes without inferring a reply from old movement or a refusal', () => {
    const frame = publicFrame();
    frame.feedback = {status: 'published', entry: 'offer_escort_adventurer', actionLabel: 'Invite residents', text: 'Public', result: {
      changes: [], laterChanges: [], discoveries: [], laterDiscoveries: [],
    }};
    const motion = {id: 'm', subjectId: 'resident', label: '居民', start: 'ritual_ring',
      end: 'ritual_threshold', recordedAt: {time: 8, revision: 4}};
    frame.information.movements = [motion];
    const render = () => renderToStaticMarkup(createElement(components.ReceiptSummary, {frame}));
    expect(render()).toContain('本次暂未看见新的动身迹象');
    frame.feedback.result!.laterDiscoveries = [{kind: 'movement', movement: motion}];
    expect(render()).toContain('随后看见居民');
    expect(render()).not.toContain('本次暂未看见新的动身迹象');
    expect(render()).not.toMatch(/接受了|拒绝了|答应了|已获救/);
    frame.feedback = {...frame.feedback, status: 'rejected', refusal: {code: 'K0_NOT_ADMITTED'}};
    expect(render()).not.toContain('邀请已经喊出');
  });
  it('prioritizes a newer actual movement over old frozen detail without declaring current safety', () => {
    const frame = publicFrame(), item = surface('resident', 'person', 'ballroom_entrance');
    const prior = memory('resident', 'person', 'ritual_ring');
    prior.state = 'frozen'; prior.detailRecordedAt = {time: 2, revision: 1};
    frame.observations = [prior]; frame.information.visibleEntities = [item];
    frame.information.movements = [{id: 'm', subjectId: item.id, label: '居民', start: 'ritual_ring',
      end: 'ballroom_entrance', recordedAt: {time: 8, revision: 4}}];
    const snapshot = structuredClone(frame);
    const token = renderToStaticMarkup(createElement(components.CurrentSurface, {frame, onSelect: vi.fn()}));
    expect(token).toContain('后来看见移动 · 时刻 8'); expect(token).not.toContain('冰封');
    const detail = renderToStaticMarkup(createElement(components.SurfaceHistory, {frame, id: item.id}));
    expect(detail.indexOf('后来看见的移动')).toBeLessThan(detail.indexOf('较早的详细观察'));
    expect(detail).toContain('冰封'); expect(detail).not.toMatch(/已获救|当前安全|现在可行动/);
    const memoryHtml = renderToStaticMarkup(createElement(components.HistoricalMemory, {frame, onSelect: vi.fn()}));
    expect(memoryHtml).toContain('后来见其移向'); expect(memoryHtml).toContain('时刻 8');
    expect(frame).toEqual(snapshot);
    frame.information.movements[0].recordedAt = {time: 1, revision: 0};
    expect(renderToStaticMarkup(createElement(components.CurrentSurface, {frame, onSelect: vi.fn()}))).toContain('上次观察：冰封');
    frame.information.movements[0].subjectId = 'other';
    expect(renderToStaticMarkup(createElement(components.SurfaceHistory, {frame, id: item.id}))).not.toContain('后来看见的移动');
  });

  it('uses Chinese for the acquired immune state', () => {
    const frame = publicFrame(), item = surface('resident', 'person', 'ballroom_entrance');
    const prior = memory(item.id, 'person', item.site);
    prior.state = 'immune'; prior.detailRecordedAt = {...prior.recordedAt};
    frame.observations = [prior]; frame.information.visibleEntities = [item];
    const html = renderToStaticMarkup(createElement(components.CurrentSurface, {frame, onSelect: vi.fn()}));
    expect(html).toContain('不受宫殿寒冷影响'); expect(html).not.toContain('immune');
  });

  it('puts already acquired detail on the current token and opens its facts without a second fold', () => {
    const frame = publicFrame(), item = surface('resident', 'person', 'ballroom_entrance');
    frame.information.visibleEntities = [item];
    const prior = memory('resident', 'person', 'ritual_ring');
    prior.state = 'frozen'; prior.facts = [{label: '御寒', value: 'frozen'}];
    prior.detailRecordedAt = {time: 2, revision: 1}; prior.recordedAt = {time: 8, revision: 4};
    frame.observations = [prior];
    const snapshot = structuredClone(frame);
    const token = renderToStaticMarkup(createElement(components.CurrentSurface, {frame, onSelect: vi.fn()}));
    expect(token).toContain('上次观察：冰封 · 时刻 2');
    expect(token).not.toContain('详细状态未知');
    const details = renderToStaticMarkup(createElement(components.SurfaceHistory, {frame, id: item.id}));
    expect(details.indexOf('御寒')).toBeLessThan(details.indexOf('<details'));
    expect(details).toContain('上次观察（时刻 2');
    expect(frame).toEqual(snapshot);
    prior.detailRecordedAt = null;
    expect(renderToStaticMarkup(createElement(components.CurrentSurface, {frame, onSelect: vi.fn()}))).toContain('详细状态未知');
    expect(renderToStaticMarkup(createElement(components.SurfaceHistory, {frame, id: item.id}))).not.toContain('御寒');
  });

  it.each(['frozen', 'normal', 'unknown'])('shows the actual %s floor inspection in the collapsed receipt', state => {
    const frame = inspected(), item = frame.feedback!.result!.discoveries[0];
    if (item.kind !== 'observation') throw Error('test observation');
    item.observation.state = state;
    const snapshot = structuredClone(frame);
    const html = renderToStaticMarkup(createElement(components.ReceiptSummary, { frame }));
    expect(html).toContain(`脚下冰面：${state === 'frozen' ? '有冰' : state === 'normal' ? '无冰' : '情况未明'}`);
    expect(html).not.toContain('<details'); expect(frame).toEqual(snapshot);
  });

  it('does not turn retained detail into a new inspection when a location record changes', () => {
    const frame = inspected(), item = frame.feedback!.result!.discoveries[0];
    if (item.kind !== 'observation') throw Error('test observation');
    item.observation.recordedAt = { time: 20, revision: 10 };
    expect(receiptDiscoveries(frame)[0]).toContain('详情沿用');
    expect(receiptDiscoveries(frame)[0]).not.toContain('有冰');
  });

  it('does not refer to an earlier detail when a new existence record has never been inspected', () => {
    const frame = inspected(), item = frame.feedback!.result!.discoveries[0];
    if (item.kind !== 'observation') throw Error('test observation');
    item.observation.detailRecordedAt = null;
    expect(receiptDiscoveries(frame)[0]).toContain('尚未细查');
    expect(receiptDiscoveries(frame)[0]).not.toMatch(/详情沿用|有冰/);
  });

  it('keeps immediate/later discoveries distinct and bounds the visible summary without deleting evidence', () => {
    const frame = inspected(), result = frame.feedback!.result!;
    result.laterDiscoveries = [{ kind: 'ritual', phase: 'completed', label: '吟唱结束' },
      { kind: 'ritual', phase: 'disrupted', label: '另一条公开记录' }];
    const snapshot = structuredClone(frame);
    const html = renderToStaticMarkup(createElement(components.ReceiptSummary, { frame }));
    expect(html).toContain('随后听见：吟唱结束'); expect(html).toContain('随后听见：另一条公开记录');
    expect(html).toContain('另有 1 条见闻'); expect(html).not.toContain('脚下冰面：有冰');
    expect(receiptDiscoveries(frame).at(-1)).toContain('本次记录');
    expect(frame).toEqual(snapshot);
  });

  it('shows actual vital loss but does not blame a simultaneous roll, NPC or protection state', () => {
    const frame = inspected();
    frame.feedback!.result!.laterChanges = [{ field: 'endurance', before: 3, after: 2 }];
    frame.feedback!.result!.laterRolls = [{ kind: 'cold', value: 1 }];
    const html = renderToStaticMarkup(createElement(components.ReceiptSummary, { frame }));
    expect(html).toContain('随后耐力 3 → 2'); expect(html).toContain('受损来源待查');
    expect(html).not.toMatch(/因为寒冷|敌人攻击|保护失效/);
  });

  it('does not label recovery, charge expenditure or unknown previous life as observed vital loss', () => {
    const frame = inspected(), result = frame.feedback!.result!;
    result.changes = [{ field: 'endurance', before: 2, after: 3 }, { field: 'everflameCharges', before: 5, after: 4 },
      { field: 'life', after: 'dead' }];
    expect(hasPublicVitalLoss(frame)).toBe(false);
    result.laterChanges = [{ field: 'life', before: 'Alive', after: 'Dead' }];
    expect(hasPublicVitalLoss(frame)).toBe(true);
  });

  it('cannot render an unpublished result or substitute a retained observation for a new discovery', () => {
    const frame = inspected(); frame.observations = [memory('old', 'person', 'tower_top')];
    frame.feedback = { ...frame.feedback!, status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' } };
    expect(receiptDiscoveries(frame)).toEqual([]); expect(hasPublicVitalLoss(frame)).toBe(false);
    const html = renderToStaticMarkup(createElement(components.ReceiptSummary, { frame }));
    expect(html).not.toMatch(/有冰|新取得|受损来源/);
    frame.feedback = null; expect(receiptDiscoveries(frame)).toEqual([]);
  });

  it.each(['limit', 'player_cancelled', 'unexpected'])('shows the supplied %s stop reason without opening details', code => {
    const html = progress({ ...stopped, stopDetail: { code, choices: [] } });
    expect(html).toContain(stopped.reason!); expect(html).toContain(`继续「${stopped.label}」代行`);
    expect(html).not.toContain('<details');
  });

  it('treats a later manual revision as handover, keeping resume but retiring the old latest action and reason', () => {
    const html = progress(stopped, 2);
    expect(html).toContain('你已接手'); expect(html).toContain('上段代行 12 次');
    expect(html).toContain(`继续「${stopped.label}」代行`); expect(html).not.toContain('刚刚完成');
    expect(html).not.toContain(stopped.reason!);
    expect(progress({ ...stopped, status: 'running' }, 2)).toContain('刚刚完成');
  });

  it('relates current presence to retained history without claiming that its old facts are current', () => {
    const frame = publicFrame(), item = surface('resident', 'person', 'ballroom_entrance');
    expect(renderToStaticMarkup(createElement(components.CurrentEntityDetails, { item, frame }))).toContain('靠近后仔细观察');
    const prior = memory('resident', 'person', 'ballroom_entrance');
    prior.facts = [{ label: '生命', value: 'alive' }]; prior.detailRecordedAt = { ...prior.recordedAt }; frame.observations = [prior];
    const html = renderToStaticMarkup(createElement(components.CurrentEntityDetails, { item, frame }));
    expect(html).toContain('上次观察'); expect(html).not.toMatch(/详细状态未知|alive|存活/);
  });

  it('does not promise historical detail merely because an existence record is retained', () => {
    const frame = publicFrame(), item = surface('resident', 'person', 'ballroom_entrance');
    frame.observations = [memory('resident', 'person', 'ballroom_entrance')];
    const html = renderToStaticMarkup(createElement(components.CurrentEntityDetails, { item, frame }));
    expect(html).toContain('靠近后仔细观察'); expect(html).not.toContain('详细情况见下方');
  });
});
