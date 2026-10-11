import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { displayScore, PlayReport } from './PlayReport';
import { EndingSummary } from './EndingSummary';
import { emptyPlayReport } from './playReport.fixtures';
import type { Frame, PlayReport as Report } from './types';

function ongoingReport(): Report {
  return {
    ...emptyPlayReport(),
    scores: { common: 120, cautious_investigator: 6, helpful_rescuer: 10, decisive_explorer: 4, cost: 2 },
    efficiency: { cautious_investigator: 62, helpful_rescuer: 64, decisive_explorer: 61 },
    metrics: {
      publishedActions: 2, manualActions: 1, delegatedActions: 1, rejectedAttempts: 3,
      elapsed: 9.5, visitedPlaces: 2, peopleDetailed: 1, peopleThawed: 1, ritualDisrupted: 0,
      departed: 0, failed: 0, enduranceSpent: 2, knownChargeSpent: 1,
    },
    achievements: [{ id: 'public-thaw', label: '确认解冻', evidence: '公开行动记录确认人物解冻。' }],
    actions: [
      { number: 1, entry: 'observe_resident_adventurer', label: '仔细观察人物', mode: 'manual', personality: null,
        timeBefore: 0, timeAfter: 7, achievements: [],
        scoreDelta: { common: 40, cautious_investigator: 6, helpful_rescuer: 0, decisive_explorer: 1, cost: 0 } },
      { number: 2, entry: 'thaw_person_adventurer', label: '解冻眼前人物', mode: 'delegated', personality: 'helpful_rescuer',
        timeBefore: 7, timeAfter: 9.5, achievements: ['public-thaw'],
        scoreDelta: { common: 80, cautious_investigator: 0, helpful_rescuer: 10, decisive_explorer: 3, cost: 2 } },
    ],
  };
}

const render = (report: Report, compact = false) => renderToStaticMarkup(createElement(PlayReport, { report, compact }));

describe('public play report presentation', () => {
  it('renders zero totals and null efficiencies without fabricated achievements or actions', () => {
    const report = emptyPlayReport();
    const markup = render(report, true);
    expect(markup).toContain('进行中');
    expect(markup.match(/<td>暂无<\/td>/g)).toHaveLength(3);
    expect(markup).toContain('共同成就分</dt><dd>0</dd>');
    expect(markup).toContain('暂无已确认成就');
    expect(markup).toContain('还没有已完成的行动');
    expect(markup).not.toMatch(/NaN|Infinity|100 分|救出\d/);
    expect(markup).not.toContain('public-test-rules');
  });

  it('shows cumulative weights, all three dimensions and returned efficiencies in compact ongoing progress', () => {
    const report = ongoingReport();
    const snapshot = structuredClone(report);
    const markup = render(report, true);
    expect(markup).toContain('data-report-status="ongoing"');
    expect(markup).toContain('旅程进展');
    expect(markup).toContain('共同成就分</dt><dd>1200</dd>');
    expect(markup).toContain('行动代价（分）</dt><dd>20</dd>');
    for (const [label, weight, efficiency] of [['谨慎调查者', 60, 620], ['热心救援者', 100, 640], ['果断探索者', 40, 610]]) {
      expect(markup).toContain(`<th scope="row">${label}</th><td>${weight}</td><td>${efficiency}</td>`);
    }
    expect(markup).toContain('已完成 2 次 · 手动 1 / 委托 1 · 耗时 9.5 局内时间单位');
    expect(markup).toContain('依据本局已确认记录计分');
    expect(markup).toContain('行为倾向得分');
    expect(markup).toContain('本次分数变化');
    expect(markup).toContain('进展与成就 · 1 项');
    expect(markup).not.toContain('权重');
    expect(markup).not.toContain('百分制');
    expect(markup).not.toContain('<details class="report-actions" open');
    expect(markup).not.toContain('<details class="report-achievements" open');
    expect(report).toEqual(snapshot);
  });

  it('renders the full finished ledger with evidence, costs, every actual action and raw world time', () => {
    const report: Report = { ...ongoingReport(), status: 'finished' };
    const markup = render(report);
    expect(markup).toContain('本局报告');
    expect(markup).toContain('已结束');
    expect(markup).not.toContain('<details class="report-actions" open');
    expect(markup).toContain('<details class="report-achievements"><summary>');
    expect(markup).toContain('这一路的经历');
    expect(markup).toContain('<details class="report-evaluation"><summary>性格与行动评分</summary>');
    expect(markup).not.toContain('<details class="report-evaluation" open');
    expect(markup.indexOf('这一路的经历')).toBeLessThan(markup.indexOf('共同成就分'));
    expect(markup).toContain('公开行动记录确认人物解冻');
    expect(markup).toContain('手动 · 局内时刻 0 → 7 · 耗时 7 局内时间单位');
    expect(markup).toContain('委托 · 热心救援者 · 局内时刻 7 → 9.5 · 耗时 2.5 局内时间单位');
    expect(markup).toContain('成就：确认解冻');
    expect(markup).toContain('未获准执行</dt><dd>3</dd>');
    expect(markup).toContain('耐力消耗</dt><dd>2</dd>');
    expect(markup).toContain('已知充能消耗</dt><dd>1</dd>');
    expect(markup).toContain('新到访地点</dt><dd>2</dd>');
    expect(markup).toContain('人物详察</dt><dd>1</dd>');
    expect(markup).toContain('仪式中断记录</dt><dd>0</dd>');
    expect(markup).toContain('行动代价</dt><dd>+20</dd>');
    expect(markup).not.toContain('秒');
    expect(markup).not.toContain('public-thaw');
  });

  it('does not turn thaw or departure records into rescued residents, even at an ending', () => {
    const report: Report = { ...ongoingReport(), status: 'finished' };
    report.metrics.peopleThawed = 4;
    report.metrics.departed = 1;
    const markup = render(report);
    expect(markup).toContain('已确认的解冻与离宫');
    expect(markup).toContain('人物解冻记录 4 · 离宫记录 1');
    expect(markup).toContain('本局没有统计居民离宫的确认记录');
    expect(markup).not.toMatch(/救出\s*\d|获救\s*\d|救援人数[： ]\d/);
    expect(report.rescuesConfirmed).toBeNull();
  });

  it('uses the required report in the ending summary without deriving scores from the final scene', () => {
    const frame: Frame = {
      time: 9.5, ending: { id: 'departed_palace', title: '离宫', narrationZh: '旅程结束。' },
      offers: [], observations: [],
      fields: { details: [], lifeState: 'alive', coldState: 'mobile', location: '外岸', everflameCharges: 4, carriedReservoirCharges: null, coldCondition: 'mobile', movementSpeed: 5, chandelierClue: null, ritualSigns: null, protection: [] },
      information: { visibility: 'provided', visibilityNotice: '', visibleEntities: [], nearbyEntities: [], movements: [],
        ritual: { phase: 'unknown', label: '', evidence: 'unknown', recordedAt: null },
        escortResponse: { status: 'not_observed', label: '' }, timingNotice: '' },
    };
    const markup = renderToStaticMarkup(createElement(EndingSummary, {
      frame, report: { ...ongoingReport(), status: 'finished' }, onRestart: () => {}, onHistory: () => {},
    }));
    expect(markup).toContain('本局报告');
    expect(markup).toContain('谨慎调查者');
    expect(markup).toContain('热心救援者');
    expect(markup).toContain('果断探索者');
    expect(markup).toContain('人物解冻记录 1 · 离宫记录 0');
    expect(markup).not.toContain('ending-banner');
  });

  it('keeps all ledger actions rather than truncating to the recent receipt history', () => {
    const report = emptyPlayReport();
    const action = ongoingReport().actions[0];
    report.actions = Array.from({ length: 25 }, (_, i) => ({ ...action, number: i + 1, label: `公开行动 ${i + 1}` }));
    const markup = render(report, true);
    expect(markup).toContain('实际行动 · 25 次');
    expect(markup).toContain('<li value="1">');
    expect(markup).toContain('<li value="25">');
    expect(markup.match(/观察居民<\/strong>/g)).toHaveLength(25);
  });

  it('displays the returned efficiency rather than recomputing or substituting a null', () => {
    const report = ongoingReport();
    report.efficiency.cautious_investigator = -1.23456;
    report.efficiency.helpful_rescuer = 0;
    report.efficiency.decisive_explorer = null;
    const markup = render(report);
    expect(markup).toContain('<td>-12.346</td>');
    expect(markup).toContain('<th scope="row">热心救援者</th><td>100</td><td>0</td>');
    expect(markup).toContain('<th scope="row">果断探索者</th><td>40</td><td>暂无</td>');
  });

  it('presents the supplied terminal failure cost without dropping or applying the penalty again', () => {
    const report = ongoingReport();
    report.status = 'finished';
    report.metrics.failed = 1;
    report.scores.cost = 102;
    report.efficiency = { cautious_investigator: 12, helpful_rescuer: 14, decisive_explorer: 11 };
    const snapshot = structuredClone(report);
    const markup = render(report);
    expect(markup).toContain('行动代价（分）</dt><dd>1020</dd>');
    expect(markup).toContain('<th scope="row">谨慎调查者</th><td>60</td><td>120</td>');
    expect(markup).toContain('<th scope="row">热心救援者</th><td>100</td><td>140</td>');
    expect(markup).toContain('<th scope="row">果断探索者</th><td>40</td><td>110</td>');
    expect(report).toEqual(snapshot);
  });

  it.each([false, true])('scales every score delta once in compact=%s without scaling public metrics or mutating the ledger', compact => {
    const report = ongoingReport();
    report.actions[0].scoreDelta = { common: 0.5, cautious_investigator: -0.25, helpful_rescuer: 0, decisive_explorer: 1.2, cost: 0.1 };
    const snapshot = structuredClone(report);
    const markup = render(report, compact);
    expect(markup).toContain('共同成就分</dt><dd>+5</dd>');
    expect(markup).toContain('谨慎调查者</dt><dd>-2.5</dd>');
    expect(markup).toContain('热心救援者</dt><dd>0</dd>');
    expect(markup).toContain('果断探索者</dt><dd>+12</dd>');
    expect(markup).toContain('行动代价</dt><dd>+1</dd>');
    expect(markup).toContain('每行动净收益（分/行动）');
    expect(markup).toContain('实际行动 · 2 次');
    expect(markup).toContain('时刻 7 → 9.5');
    expect(markup).toContain('人物解冻记录 1 · 离宫记录 0');
    expect(report).toEqual(snapshot);
  });

  it('uses the same score formatting for signed fractions, zero and missing efficiency', () => {
    expect(displayScore(0.07)).toBe('0.7');
    expect(displayScore(-0.07)).toBe('-0.7');
    expect(displayScore(0)).toBe('0');
    expect(displayScore(null)).toBe('暂无');
  });
});
