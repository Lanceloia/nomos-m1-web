import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { publicFrame, memory, surface } from './presence.fixtures';
import { entityPresences } from './presence';
import { actionNote, feedbackText, receiptDiscoveries } from './tabletop';
import { nextStep } from './spatial';

vi.stubGlobal('window', { sessionStorage: undefined });
const { EscortResponse, AvailableResourceActions, AdventureStatus, ActionOutcome, WallCheckConclusion } = await import('./App');

describe('action-window readback and last-seen positions', () => {
  it('connects an actual wall check to that target\'s current choices without claiming wall state', () => {
    const frame = publicFrame(), wall = memory('wall', 'wall', null);
    wall.evidence = 'checked_target';
    frame.feedback = {status: 'published', entry: 'observe_wall_adventurer', actionLabel: 'Inspect', text: '', result: {changes: [], laterChanges: [], discoveries: [{kind: 'observation', change: 'new', observation: wall}], laterDiscoveries: []}};
    frame.offers = [{index: 17, entry: 'open_plain_wall_adventurer', label: 'Spend one charge to open Treasure ice wall', targetIds: ['wall']},
                    {index: 18, entry: 'open_plain_wall_adventurer', label: 'SHOULD_NOT_APPEAR', targetIds: ['other']}];
    const onAct = vi.fn();
    const html = renderToStaticMarkup(createElement(WallCheckConclusion, {frame, onAct}));
    expect(html).toContain('宝箱冰墙');
    expect(html).not.toContain('SHOULD_NOT_APPEAR');
    expect(html).not.toContain('已经打开');
    expect(onAct).not.toHaveBeenCalled();
    frame.feedback = {...frame.feedback, status: 'rejected', refusal: {code: 'K0_NOT_ADMITTED'}};
    expect(WallCheckConclusion({frame, onAct})).toBeNull();
  });

  it('reports later invitation motion once in the open summary without contradicting it with empty news', () => {
    const frame = publicFrame();
    const movement = {id: 'new', subjectId: 'p', label: '本次的居民', start: 'ritual_ring', end: 'ritual_threshold', recordedAt: {time: 700, revision: 7}};
    frame.feedback = {status: 'published', entry: 'offer_escort_adventurer', actionLabel: 'Invite', text: '', result: {changes: [], laterChanges: [], discoveries: [], laterDiscoveries: [{kind: 'movement', movement}]}};
    const html = renderToStaticMarkup(createElement(ActionOutcome, {frame, busy: false, error: null, onRefresh: vi.fn()}));
    const summary = html.split('<details class="outcome-evidence">')[0];
    expect(summary).toContain('本次的居民');
    expect(summary.match(/本次的居民/g)).toHaveLength(1);
    expect(summary).not.toContain('没有新增');
    expect(summary).not.toContain('随后没有新的见闻');
    expect(summary).not.toContain('随后读回摘要');
    expect(html).toContain('完整证据与掷骰记录');
    expect(html).not.toMatch(/接受了护送|已经获救|正在同行/);
  });

  it('keeps later losses and non-movement news separate from invitation motion', () => {
    const frame = publicFrame();
    frame.feedback = {status: 'published', entry: 'offer_escort_adventurer', actionLabel: 'Invite', text: '', result: {changes: [], laterChanges: [{field: 'life', before: 10, after: 9}], discoveries: [], laterDiscoveries: [{kind: 'ritual', phase: 'disrupted', label: '仪式已中断'}]}};
    const html = renderToStaticMarkup(createElement(ActionOutcome, {frame, busy: false, error: null, onRefresh: vi.fn()}));
    expect(html).toContain('随后读回摘要');
    expect(html).toContain('仪式已中断');
    expect(html).toContain('暂未看见新的动身迹象');
    expect(html).not.toContain('没有新增');
  });

  it('puts real ritual and movement news before coarse memory refreshes without losing any records', () => {
    const frame = publicFrame();
    const observation = memory('p', 'person', 'ritual_ring');
    const movement = {id: 'm', subjectId: 'p', label: '仪式处居民', start: 'ritual_ring', end: 'ritual_threshold', recordedAt: {time: 400, revision: 2}};
    frame.feedback = {status: 'published', text: '', actionLabel: 'Carry', result: {changes: [], laterChanges: [], discoveries: [{kind: 'observation', change: 'updated', observation}], laterDiscoveries: [{kind: 'movement', movement}, {kind: 'ritual', phase: 'disrupted', label: '仪式已中断'}]}};
    const snapshot = structuredClone(frame);
    const lines = receiptDiscoveries(frame);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('随后听见');
    expect(lines[1]).toContain('随后看见');
    expect(lines[2]).toContain('本次记录');
    expect(frame).toEqual(snapshot);
  });
  it('distinguishes a ritual sighting within the completed action from its end time and old memory', () => {
    const frame = publicFrame(); frame.time = 500;
    frame.information.ritual = {phase: 'disrupted', label: '仪式已中断', evidence: 'last_observed', recordedAt: {time: 300, revision: 2}};
    frame.feedback = {status: 'published', text: '', actionLabel: 'Carry', result: {changes: [], laterChanges: [], discoveries: [{kind: 'ritual', phase: 'disrupted', label: '仪式已中断'}], laterDiscoveries: []}};
    expect(renderToStaticMarkup(createElement(AdventureStatus, {frame}))).toContain('本次行动中察觉 · 时刻 300；行动结束 500');
    frame.feedback.result!.discoveries = [];
    expect(renderToStaticMarkup(createElement(AdventureStatus, {frame}))).toContain('上次察觉：时刻 300');
    expect(frame.information.ritual.recordedAt?.time).toBe(300);
  });
  it('excludes pre-invitation motion from the invitation receipt but retains separate history', () => {
    const frame = publicFrame();
    const old = {id: 'old', subjectId: 'p', label: '过去的居民', start: 'ritual_ring', end: 'ritual_threshold', recordedAt: {time: 500, revision: 5}};
    const fresh = {...old, id: 'new', label: '本次的居民', recordedAt: {time: 700, revision: 7}};
    frame.information.movements = [old, fresh];
    frame.feedback = {status: 'published', entry: 'offer_escort_adventurer', actionLabel: 'Invite', text: '', result: {changes: [], laterChanges: [], discoveries: [], laterDiscoveries: [{kind: 'movement', movement: fresh}]}};
    const html = renderToStaticMarkup(createElement(EscortResponse, {frame, invitation: true}));
    expect(html).toContain('本次的居民');
    expect(html).not.toContain('过去的居民');
    expect(html).not.toMatch(/接受了护送|已经获救|正在同行/);
    expect(renderToStaticMarkup(createElement(EscortResponse, {frame}))).toContain('过去的居民');
    frame.feedback!.result!.laterDiscoveries = [];
    expect(renderToStaticMarkup(createElement(EscortResponse, {frame, invitation: true}))).toContain('暂未看见新的动身迹象');
    frame.ending = {id: 'end', title: '旅程结束', narrationZh: ''};
    const ended = renderToStaticMarkup(createElement(EscortResponse, {frame}));
    expect(ended).not.toContain('可以继续行动');
  });

  it('offers a real resource entry after chandelier inspection without auto execution or synthetic targets', () => {
    const frame = publicFrame();
    frame.feedback = {status: 'published', entry: 'observe_chandelier_adventurer', actionLabel: 'Inspect', text: ''};
    frame.offers = [{index: 83, entry: 'detach_reservoir_adventurer', label: 'Detach', targetIds: ['reservoir']}];
    const onAct = vi.fn();
    const html = renderToStaticMarkup(createElement(AvailableResourceActions, {frame, onAct}));
    expect(html).toContain('取下吊灯储能器');
    expect(html).toContain('确认后才执行');
    expect(onAct).not.toHaveBeenCalled();
    frame.offers = [];
    expect(renderToStaticMarkup(createElement(AvailableResourceActions, {frame, onAct}))).toBe('');
    expect(actionNote({index: 1, entry: 'observe_floor_adventurer', label: ''}, frame)).toContain('脚下是否结冰');
  });

  it('does not claim ritual interruption again from unconditional thaw prose', () => {
    const frame = publicFrame();
    frame.feedback = {status: 'published', entry: 'thaw_ritual_resident', actionLabel: 'Thaw', text: 'You spent one charge thawing the person at the ritual and interrupted the chant. They still have to leave by their own actions; meet and observe them again.'};
    expect(feedbackText(frame)).toContain('解冻');
    expect(feedbackText(frame)).not.toContain('中断');
  });

  it('uses only a newer matching person motion as last-seen location and keeps detail untouched', () => {
    const frame = publicFrame();
    frame.observations = [memory('p', 'person', 'ritual_ring'), memory('q', 'person', 'ritual_ring')];
    frame.information.movements = [{id: 'm', subjectId: 'p', label: '同名居民', start: 'ritual_ring', end: 'ritual_threshold', recordedAt: {time: 6, revision: 3}}];
    const snapshot = structuredClone(frame);
    expect(entityPresences(frame).find(row => row.id === 'p')).toMatchObject({site: 'ritual_threshold', presence: 'memory', recordedAt: {time: 6, revision: 3}});
    expect(entityPresences(frame).find(row => row.id === 'q')?.site).toBe('ritual_ring');
    expect(frame).toEqual(snapshot);
    frame.observations.push(memory('p', 'person', null, 4));
    expect(entityPresences(frame).some(row => row.id === 'p')).toBe(false);
    frame.information.visibleEntities = [surface('p', 'person', frame.fields.locationId!)];
    expect(entityPresences(frame).filter(row => row.id === 'p')).toMatchObject([{site: frame.fields.locationId, presence: 'current'}]);
  });

  it('does not relocate a remembered person on clock advance or an unrelated motion', () => {
    const frame = publicFrame();
    frame.observations = [memory('p', 'person', 'ritual_ring', 5)];
    frame.information.movements = [{id: 'm', subjectId: 'q', label: '同名居民', start: 'ritual_ring', end: 'ritual_threshold', recordedAt: {time: 20, revision: 10}}];
    const before = entityPresences(frame);
    frame.time = 1000;
    expect(entityPresences(frame)).toEqual(before);
    expect(before[0].site).toBe('ritual_ring');
  });

  it('names the known bridge rather than generic uncertainty, without inventing an exit route', () => {
    const frame = publicFrame();
    frame.fields.locationId = 'bridge_palace_landing';
    frame.scene!.playerSite = 'bridge_palace_landing';
    frame.scene!.knownSites = ['bridge_palace_landing'];
    frame.scene!.routes = [];
    frame.information.ritual.phase = 'disrupted';
    frame.offers = [{index: 17, entry: 'observe_routes_adventurer', label: 'Look'}];
    const next = nextStep(frame);
    expect(next.next).toContain('宫殿桥头');
    expect(next.path).toEqual([]);
    expect(next.offers[0].index).toBe(17);
  });
});
