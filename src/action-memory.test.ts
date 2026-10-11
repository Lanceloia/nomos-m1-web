import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { historicalTiming, thawAfterObservation } from './actionMemory';
import { emptyPlayReport } from './playReport.fixtures';
import { publicFrame, surface, memory } from './presence.fixtures';

let ui: typeof import('./App');
beforeAll(async () => { vi.stubGlobal('window', {sessionStorage: undefined}); ui = await import('./App'); });
afterAll(() => vi.unstubAllGlobals());

function thawReport() {
  const report = emptyPlayReport();
  report.actions.push({number: 1, label: 'Spend one charge to thaw person', entry: 'thaw_person_adventurer',
    mode: 'manual', personality: null, timeBefore: 100, timeAfter: 200,
    achievements: [], scoreDelta: {...report.scores}, thawedTargetId: 'person'});
  return report;
}

describe('published action memory, not current world state', () => {
  it('retains a confirmed thaw after other actions and sync, folding older frozen detail', () => {
    const frame = publicFrame(), report = thawReport();
    frame.time = 500; frame.feedback = null;
    frame.information.visibleEntities = [surface('person', 'person', 'ballroom_entrance')];
    const old = memory('person', 'person', 'ritual_ring');
    old.state = 'frozen'; old.detailRecordedAt = {time: 100, revision: 1}; frame.observations = [old];
    const html = renderToStaticMarkup(createElement(ui.CurrentSurface, {frame, report, onSelect: vi.fn()}));
    expect(html).toContain('你已解冻过对方'); expect(html).not.toContain('冰封');
    const detail = renderToStaticMarkup(createElement(ui.SurfaceHistory, {frame, report, id: 'person'}));
    expect(detail.indexOf('你已解冻过')).toBeLessThan(detail.indexOf('<details>'));
    expect(detail).toContain('冰封'); expect(detail).not.toMatch(/现在可行动|当前安全|已获救/);
    expect(renderToStaticMarkup(createElement(ui.HistoricalMemory, {frame, report, onSelect: vi.fn()}))).toContain('你已解冻过');
    const later = structuredClone(frame); later.observations[0].detailRecordedAt = {time: 400, revision: 4};
    expect(thawAfterObservation(later, report, 'person')).toBeUndefined();
    expect(thawAfterObservation(frame, emptyPlayReport(), 'person')).toBeUndefined();
    expect(thawAfterObservation(frame, report, 'other')).toBeUndefined();
    expect(report).toEqual(thawReport());
  });
  it('uses exact recorded entry and label for past total advancement, never as a forecast', () => {
    const offer = {index: 8, entry: 'thaw_person_adventurer', label: 'Spend one charge to thaw person'};
    expect(historicalTiming(offer, thawReport())).toContain('100 局内时间单位');
    expect(historicalTiming(offer, thawReport())).toContain('仅供比较');
    expect(historicalTiming({...offer, label: 'Another target'}, thawReport())).toBeNull();
    expect(historicalTiming({...offer, entry: 'other'}, thawReport())).toBeNull();
    expect(historicalTiming(offer, emptyPlayReport())).toBeNull();
    expect(ui.actionTimingNote({index: 1, entry: 'leave_palace_adventurer', label: 'Leave'}, thawReport())).toBe('确认离宫后，本局结束。');
  });
  it('places the selected personality launch before long choices without extra execution controls', () => {
    const html = renderToStaticMarkup(createElement(ui.PersonalityChoices, {
      offers: [{id: 'helpful_rescuer', label: '热心救援者', description: '一条很长的说明'.repeat(50), maxActions: 128}],
      selectedId: 'helpful_rescuer', settings: {maxActions: 3, stopOnUnexpected: true}, disabled: false,
      onSettings: vi.fn(), onSelect: vi.fn(), onApprove: vi.fn(),
    }));
    expect(html.indexOf('按此倾向行动')).toBeLessThan(html.indexOf('<fieldset'));
    expect(html).toContain('最多 3 次'); expect(html.match(/<button/g)).toHaveLength(1);
  });
  it('surfaces the existing recommendation first without losing or changing offered indices', () => {
    const frame = publicFrame();
    const offers = [{index: 8, entry: 'move_adventurer', label: 'Move'},
      {index: 31, entry: 'thaw_person_adventurer', label: 'Thaw'}, {index: 9, entry: 'observe_floor_adventurer', label: 'Inspect'}];
    const snapshot = structuredClone(offers);
    const html = renderToStaticMarkup(createElement(ui.ActionChoices, {frame, offers, blocked: false,
      selectedIndex: null, onAct: vi.fn(), onPreview: vi.fn(), recommendedIndex: 31}));
    const order = [...html.matchAll(/data-offer-index="(\d+)"/g)].map(match => Number(match[1]));
    expect(order[0]).toBe(31); expect(new Set(order)).toEqual(new Set([8, 31, 9]));
    expect(offers).toEqual(snapshot);
  });
});
