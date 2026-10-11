import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EndingNotice } from './EndingSummary';
import { GeographicMap } from './GeographicMap';
import { IntentPolicyRunner } from './client';
import { emptyPlayReport } from './playReport.fixtures';
import { memory, publicFrame, surface } from './presence.fixtures';
import { actionName, actionNote, actionValueNote, feedbackText, recoveryNote } from './tabletop';
import type { Frame, SessionResponse } from './types';

let ActionOutcome: typeof import('./App').ActionOutcome;
let ReceiptSummary: typeof import('./App').ReceiptSummary;
let automationStop: typeof import('./App').automationStop;
let PolicyProgress: typeof import('./App').PolicyProgress;
beforeAll(async () => {
  vi.stubGlobal('window', { sessionStorage: undefined });
  ({ ActionOutcome, ReceiptSummary, automationStop, PolicyProgress } = await import('./App'));
});
afterAll(() => vi.unstubAllGlobals());

function terminal(): Frame {
  const frame = publicFrame();
  frame.fields.lifeState = 'dead'; frame.fields.life = 'Dead';
  frame.ending = { id: 'adventurer_dead', title: '旅人死亡', narrationZh: '这次旅程已经终止。' };
  frame.feedback = { status: 'published', entry: 'cross_ice_adventurer', actionLabel: 'Cross', text: 'Action resolved.', result: {
    target: 'ballroom_chandelier_reach', landing: 'ballroom_entrance', changes: [{ field: 'life', before: 'alive', after: 'dead' }],
    laterChanges: [{ field: 'endurance', before: 3, after: 0 }], discoveries: [], laterDiscoveries: [],
  } };
  return frame;
}

const rejections = [
  ['carry_from_ritual_adventurer', 'The carry could not start. This intervention is for the frozen resident in an ongoing ritual. Check your nearby observation and the ritual signs before trying again.', '搬离行动未开始。这项干预用于仍在进行的仪式中的冰封居民。再试之前，请检查附近的观察记录与仪式迹象。'],
  ['care_person_adventurer', 'The care could not start. Observe the person nearby again; care requires an incapacitated person who is not frozen. Check your own ability to act too.', '照护行动未开始。请靠近对方重新观察；照护需要对方失去行动能力且没有冰封。也请检查自己是否还能行动。'],
];

describe('terminal and refused action presentation', () => {
  it('explains only a checked numeric action-value forecast, never prices from entry or label', () => {
    const offer = {index: 1, entry: 'move_adventurer', label: 'Cost 10000'};
    expect(actionValueNote(offer)).toBeNull();
    expect(actionValueNote({...offer, forecasts: [{label: '行动值消耗'}]})).toBeNull();
    expect(actionValueNote({...offer, forecasts: [{label: '行动值消耗', value: 10000}]})).toContain('下一次行动机会');
    expect(actionValueNote({...offer, forecasts: [{label: '行动值消耗', value: 10000}]})).not.toContain('耗时 10000');
  });
  it('distinguishes world rejection from failed binding and unknown publication without claiming a guard cause', () => {
    const frame = publicFrame();
    frame.feedback = {status: 'rejected', refusal: {code: 'K0_NOT_ADMITTED'},
      actionLabel: 'Attempt', text: 'Unknown'};
    expect(recoveryNote(frame)).toContain('世界未接纳这次尝试');
    expect(recoveryNote(frame)).toContain('人格引导会避开');
    frame.feedback.refusal.code = 'C0_BINDING_REJECTED';
    expect(recoveryNote(frame)).toContain('绑定未通过校验');
    expect(recoveryNote(frame)).not.toContain('冰面');
    frame.feedback.refusal.code = 'UNPUBLISHED_RESULT';
    expect(recoveryNote(frame)).toContain('未取得发布结果');
    expect(recoveryNote(frame)).not.toContain('已消耗');
  });
  it.each(['K0_NOT_ADMITTED', 'C0_BINDING_REJECTED', 'UNPUBLISHED_RESULT'] as const)('shows public error code %s without guard/source leakage or a guessed cause', code => {
    const frame = publicFrame();
    frame.feedback = { status: 'rejected', refusal: { code }, actionLabel: 'Attempt', text: '作者尚未公开具体原因。' };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame, busy: false, error: null, onRefresh: vi.fn() }));
    expect(html).toContain(`错误码: <code>${code}</code>`); expect(html).toContain('作者尚未公开具体原因。');
    expect(html).not.toMatch(/private_guard|exception|源代码|绑定已经过期|因为对方/);
    frame.feedback = { status: 'published', actionLabel: 'Attempt', text: 'Action resolved.' };
    expect(renderToStaticMarkup(createElement(ActionOutcome, { frame, busy: false, error: null, onRefresh: vi.fn() }))).not.toContain('错误码');
  });
  it('prioritizes an actual death over the latest landing, exposing vital loss without automatically opening a summary', () => {
    const frame = terminal(), onView = vi.fn();
    const notice = renderToStaticMarkup(createElement(EndingNotice, { frame, onView }));
    expect(notice).toContain('role="alert"'); expect(notice).toContain('你已死亡 · 旅人死亡');
    expect(notice).toContain('生命 · 死亡'); expect(notice).toContain('生命 存活 → 死亡');
    expect(notice).toContain('耐力 3 → 0'); expect(notice).toContain('本局行动已结束');
    expect(notice).toContain('查看结算'); expect(notice).not.toContain('role="dialog"');
    const receipt = renderToStaticMarkup(createElement(ReceiptSummary, { frame }));
    expect(receipt).toContain('<strong>旅人死亡</strong>'); expect(receipt).not.toContain('抵达');
    const outcome = renderToStaticMarkup(createElement(ActionOutcome, { frame, busy: false, error: null, onRefresh: () => {} }));
    expect(outcome).toContain('<h2>旅人死亡</h2>'); expect(outcome).not.toContain('<h2>抵达');
    expect(onView).not.toHaveBeenCalled();
  });

  it('does not invent a terminal state or damage from exhausted resources', () => {
    const frame = publicFrame(); frame.fields.endurance = 0; frame.fields.everflameCharges = 0;
    frame.fields.lifeState = 'alive'; frame.fields.coldState = 'mobile';
    expect(EndingNotice({ frame, onView: vi.fn() })).toBeNull();
    expect(automationStop(frame)).toBeNull();
  });

  it.each(rejections)('shows the exact public %s rejection explanation, no execution or time/resource cost', (entry, original, translated) => {
    const frame = publicFrame();
    frame.feedback = { status: 'rejected', refusal: { code: 'K0_NOT_ADMITTED' }, entry, actionLabel: 'Attempt', text: original, result: {
      landing: 'palace_exit', changes: [{ field: 'life', before: 'Alive', after: 'Dead' }],
      laterChanges: [], discoveries: [], laterDiscoveries: [], rolls: [{ kind: 'balance', value: 1 }],
    } };
    const snapshot = structuredClone(frame);
    expect(feedbackText(frame)).toBe(translated);
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame, busy: false, error: null, onRefresh: vi.fn() }));
    expect(html).toContain('行动未发生'); expect(html).toContain('未执行 · 未消耗局内时间与资源');
    expect(html).toContain(`data-testid="authored-feedback">${translated}</p>`);
    expect(html).not.toContain('<details class="authored-feedback"');
    expect(html).not.toMatch(/生命 存活 → 死亡|本次平衡骰|抵达外岸|本次变化|owner=|private_guard/);
    expect(frame).toEqual(snapshot);
    expect(feedbackText({ ...frame, feedback: { ...frame.feedback!, text: `${original} Author extra.` } })).not.toBe(translated);
  });

  it('preserves unknown refusal without inventing a cause or successful execution', () => {
    const frame = publicFrame();
    frame.feedback = { status: 'rejected', refusal: { code: 'UNPUBLISHED_RESULT' }, entry: 'care_person_adventurer', actionLabel: 'Care', text: '作者尚未公开具体原因。' };
    const html = renderToStaticMarkup(createElement(ActionOutcome, { frame, busy: false, error: null, onRefresh: vi.fn() }));
    expect(html).toContain('作者尚未公开具体原因。'); expect(html).toContain('原因还不清楚');
    expect(html).not.toMatch(/对方已经死亡|因为对方冰封|已经救出|照护成功/);
    expect(html).toContain('提交结果待核对');
    expect(html).not.toMatch(/未消耗局内时间与资源|行动未发生|未执行/);
    const receipt = renderToStaticMarkup(createElement(ReceiptSummary, {frame}));
    expect(receipt).toContain('发布结果未知');
    expect(receipt).not.toContain('未消耗');
  });

  it.each(['care_person_adventurer', 'inspect_patient_adventurer'])('labels %s as a real care or inspection attempt, not a generic rescue', entry => {
    const offer = { index: 7, entry, label: 'Public attempt' };
    expect(actionName(offer)).toContain('尝试');
    expect(actionName(offer)).toContain(entry === 'care_person_adventurer' ? '照护' : '查看');
    expect(actionNote(offer, publicFrame())).not.toMatch(/救出|救援成功|已恢复/);
    expect(actionName(offer)).not.toMatch(/救援|营救|获救/);
  });
});

describe('exact own lifecycle safety readback', () => {
  it.each([
    ['dead', 'mobile', 'death'], ['incapacitated', 'immune', 'incapacitated'], ['alive', 'frozen', 'frozen'],
  ] as const)('stops on %s/%s regardless of localized HUD strings or unchecked unexpected stop', async (lifeState, coldState, code) => {
    const initial: SessionResponse = { sessionId: 'safety-ui', revision: 0, entries: [], playReport: emptyPlayReport(), frame: publicFrame(),
      policy: { id: 'policy', intentId: 'helpful_rescuer', status: 'running', label: '热心救援者', reason: null, stopDetail: null,
        executed: 0, limit: 64, stopOnUnexpected: false, plan: null, steps: [] } };
    initial.frame.fields.lifeState = 'alive'; initial.frame.fields.coldState = 'mobile';
    const stopped = structuredClone(initial); stopped.revision = 1;
    stopped.frame.fields.lifeState = lifeState; stopped.frame.fields.coldState = coldState;
    stopped.frame.fields.life = 'Alive'; stopped.frame.fields.coldCondition = 'Able to move';
    const transport = { startPolicy: vi.fn(), stepPolicy: vi.fn().mockResolvedValue(stopped), cancelPolicy: vi.fn() };
    const receive = vi.fn((next: SessionResponse) => { if (automationStop(next.frame)) runner.interrupt(); });
    const runner = new IntentPolicyRunner(transport, receive, () => Promise.resolve()); runner.observe(initial);
    await runner.run();
    expect(automationStop(stopped.frame)).toBe(code); expect(transport.stepPolicy).toHaveBeenCalledOnce();
    expect(transport.cancelPolicy).not.toHaveBeenCalled(); expect(receive).toHaveBeenCalledWith(stopped);
  });

  it('uses exact codes only, allowing ordinary injury and unknown absent state without inferring lifecycle from formatted text', () => {
    const frame = publicFrame(); frame.fields.lifeState = 'alive'; frame.fields.coldState = 'immune';
    frame.fields.life = 'Unable to act; needs care'; frame.fields.coldCondition = 'Frozen'; frame.fields.endurance = 0;
    expect(automationStop(frame)).toBeNull();
    frame.fields.lifeState = null; frame.fields.coldState = null;
    expect(automationStop(frame)).toBeNull();
    frame.ending = terminal().ending;
    expect(automationStop(frame)).toBe('ending');
  });

  it.each(['death', 'incapacitated', 'frozen'])('keeps the public %s stop reason visible in compact progress', code => {
    const html = renderToStaticMarkup(createElement(PolicyProgress, { policy: { id: 'policy', intentId: 'helpful_rescuer', status: 'stopped',
      label: '热心救援者', reason: '自身状态使自动行动停止。', stopDetail: { code, choices: [] }, executed: 1, limit: 64, stopOnUnexpected: false, plan: null, steps: [] },
      pumping: false, cancelling: false, disabled: true, canContinue: false, offers: [], onResume: vi.fn(), onCancel: vi.fn(), onDetails: vi.fn() }));
    expect(html).toContain('role="alert">自身状态使自动行动停止。');
    expect(html).not.toContain('按此倾向继续');
  });
});

describe('map marker computed interaction styles', () => {
  it.each([true, false])('keeps all compact=%s markers opaque under real hover and keyboard focus despite later global/sheet rules', async compact => {
    const frame = publicFrame();
    frame.information.visibleEntities = [surface('person', 'person', 'ballroom_entrance'), surface('fire', 'everflame', 'ballroom_entrance')];
    frame.information.nearbyEntities = [surface('elemental', 'elemental', 'ritual_ring'), surface('object', 'reservoir', 'tower_base')];
    frame.observations = [memory('memory-person', 'person', 'bridge_palace_landing'), memory('memory-object', 'chandelier', 'captive_cell')];
    const geographicCss = await readFile(new URL('./geographic.css', import.meta.url), 'utf8');
    const globalCss = await readFile(new URL('./style.css', import.meta.url), 'utf8');
    const html = renderToStaticMarkup(createElement(GeographicMap, { frame, compact, selectedId: 'ballroom_entrance', onSelect: vi.fn(), onSelectEntity: vi.fn() }));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    page.setDefaultTimeout(3000);
    await page.route('**/*', route => route.abort());
    try {
      await page.setContent(`<!doctype html><html><head><style>${geographicCss}</style><style>${globalCss}</style></head><body><div class="${compact ? '' : 'sheet'}" style="width:${compact ? 250 : 600}px; padding:0">${html}</div></body></html>`);
      const markers = page.locator('button[data-map-site], button[data-entity-cluster]');
      const count = await markers.count(); expect(count).toBeGreaterThan(8);
      const expected = await markers.evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
      expect(expected.every(color => /^rgb\(/.test(color))).toBe(true);
      for (let i = 0; i < count; i++) {
        await page.keyboard.press('Tab');
        const marker = markers.nth(i);
        expect(await marker.evaluate(element => element.matches(':focus-visible'))).toBe(true);
        expect(await marker.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(expected[i]);
        expect(await marker.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      }
      await page.locator('body').click({ position: { x: 1100, y: 20 } });
      for (let i = 0; i < count; i++) {
        const marker = markers.nth(i); await marker.hover();
        expect(await marker.evaluate(element => element.matches('button:hover'))).toBe(true);
        expect(await marker.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(expected[i]);
        expect(await marker.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      }
    } finally { await browser.close(); }
  }, 20000);
});
