import { readFile } from 'node:fs/promises';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EndingNotice, EndingSummary } from './EndingSummary';
import { GeographicMap } from './GeographicMap';
import { emptyPlayReport } from './playReport.fixtures';
import { memory, surface } from './presence.fixtures';
import type { Frame, SessionResponse } from './types';

// Exercise App handlers without a browser, DOM dependency, or transport.
const hooks = vi.hoisted(() => ({
  active: false, stateIndex: 0, refIndex: 0,
  states: [] as unknown[], refs: [] as { current: unknown }[],
}));
const transport = vi.hoisted(() => ({
  start: vi.fn(), refresh: vi.fn(), choose: vi.fn(), restart: vi.fn(),
  newSession: vi.fn(), policyRun: vi.fn(), policyCancel: vi.fn(),
  policyObserve: vi.fn(), policyInterrupt: vi.fn(), policyReceive: null as ((next: SessionResponse) => void) | null,
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useId: () => hooks.active ? 'presence-test-map' : actual.useId(),
    useState(initial: unknown) {
      if (!hooks.active) return actual.useState(initial);
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.states[index], (update: unknown) => {
        hooks.states[index] = typeof update === 'function' ? update(hooks.states[index]) : update;
      }];
    },
    useRef(initial: unknown) {
      if (!hooks.active) return actual.useRef(initial);
      const index = hooks.refIndex++;
      return hooks.refs[index] ??= { current: initial };
    },
    useEffect: (...args: Parameters<typeof actual.useEffect>) => {
      if (!hooks.active) actual.useEffect(...args);
    },
  };
});
vi.mock('./client', async importOriginal => ({
  ...await importOriginal<typeof import('./client')>(),
  SessionClient: class {
    start = transport.start; refresh = transport.refresh; choose = transport.choose;
    restart = transport.restart; newSession = transport.newSession;
  },
  IntentPolicyRunner: class {
    constructor(_client: unknown, receive: (next: SessionResponse) => void) { transport.policyReceive = receive; }
    observe = transport.policyObserve; interrupt = transport.policyInterrupt;
    run = transport.policyRun; cancel = transport.policyCancel;
  },
}));

const initial: SessionResponse = {
  sessionId: 'journey-ui', revision: 0, policyRevision: 0, entries: [],
  playReport: emptyPlayReport(), intentOffers: [],
  policy: { id: null, intentId: null, label: null, reason: null, stopDetail: null,
    status: 'idle', executed: 0, limit: 64, stopOnUnexpected: true, plan: null, steps: [] },
  frame: {
    time: 0, ending: null, observations: [],
    offers: [{ index: 9, entry: 'wait_adventurer', label: 'Wait' }],
    fields: { details: [], lifeState: 'alive', coldState: 'mobile', location: '舞厅入口', locationId: 'ballroom_entrance', life: 'Alive', endurance: 4,
      everflameCharges: 3, carriedReservoirCharges: null, coldCondition: 'Able to move', movementSpeed: 5,
      chandelierClue: null, ritualSigns: null, protection: [] },
    scene: { playerSite: 'ballroom_entrance', knownSites: ['ballroom_entrance', 'ballroom_chandelier_reach'], siteLabels: {},
      routes: [{ start: 'ballroom_entrance', end: 'ballroom_chandelier_reach', kind: 'walk' }] },
    information: { visibleEntities: [], nearbyEntities: [], movements: [], visibility: 'provided', visibilityNotice: '眼前的最终场景记录',
      ritual: { phase: 'unknown', label: '尚未听到动静', evidence: 'unknown', recordedAt: null },
      escortResponse: { status: 'not_observed', label: '尚未观察到回应' }, timingNotice: '行动会推进时间' },
  },
};

function ended(id: string): SessionResponse {
  return { ...structuredClone(initial), revision: 1, playReport: { ...emptyPlayReport(), status: 'finished' },
    frame: { ...structuredClone(initial.frame), time: 7,
      ending: { id, title: `公开结局：${id}`, narrationZh: '真实终局回执。' },
      scene: { ...initial.frame.scene!, playerSite: 'ballroom_chandelier_reach' },
      feedback: { status: 'published', entry: 'wait_adventurer', actionLabel: '等待', text: '最终行动已经发布' },
    },
  };
}

type Element = ReactElement<Record<string, any>>;
function find(tree: ReactNode, matches: (node: Element) => boolean): Element {
  const visit = (node: ReactNode): Element | undefined => {
    if (Array.isArray(node)) return node.map(visit).find(Boolean);
    if (!isValidElement<Record<string, any>>(node)) return;
    return matches(node) ? node : visit(node.props.children);
  };
  const result = visit(tree);
  if (!result) throw new Error('Expected UI element was absent');
  return result;
}

let App: typeof import('./App').default;
let manageSheetFocus: typeof import('./App').manageSheetFocus;
let listenForEscape: typeof import('./App').listenForEscape;

function renderApp() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.active = true;
  try { return App(); }
  finally { hooks.active = false; }
}
const markup = () => renderToStaticMarkup(renderApp());
const viewSummary = () => find(renderApp(), node => node.type === EndingNotice).props.onView();

beforeAll(async () => {
  vi.stubGlobal('window', { sessionStorage: { getItem: () => null, setItem: () => {} } });
  vi.stubGlobal('document', {activeElement: null});
  vi.stubGlobal('HTMLButtonElement', class {});
  ({ default: App, manageSheetFocus, listenForEscape } = await import('./App'));
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  hooks.states = [structuredClone(initial), false]; hooks.refs = [];
  vi.clearAllMocks();
  transport.policyRun.mockReset();
});

describe('ending stays in the actual scene', () => {
  it.each(['adventurer_dead', 'rescue_window_expired'])('interrupts stale running auto on actual %s even with unexpected stop off, keeps scene and enables explicit restart', async id => {
    const session = hooks.states[0] as SessionResponse;
    session.policy = { ...session.policy!, id: 'policy', intentId: 'helpful_rescuer', label: '热心救援者', status: 'stopped', stopOnUnexpected: false };
    const final = ended(id); final.policy = { ...session.policy, status: 'running' };
    transport.policyRun.mockImplementation(async () => transport.policyReceive?.(final));
    const { StoppedPolicyNotice } = await import('./App');
    find(renderApp(), node => node.type === StoppedPolicyNotice).props.onDetails();
    find(renderApp(), node => typeof node.type === 'function' && node.type.name === 'PolicyCommands').props.onResume();
    await vi.waitFor(() => expect(hooks.states[0]).toEqual(final));
    expect(transport.policyInterrupt).toHaveBeenCalledOnce();
    const html = markup(); expect(html).toContain('data-testid="current-scene"');
    expect(html).toContain('查看结算'); expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('按此倾向继续'); expect(html).not.toContain('人格行动进度');
    expect(html).toContain('意外停点已关闭；死亡、失能或冰封仍会停止自动行动。');
    expect(find(renderApp(), node => node.props['aria-label'] === '重新开始').props.disabled).toBe(false);
    expect(transport.choose).not.toHaveBeenCalled(); expect(transport.restart).not.toHaveBeenCalled();
  });

  it.each(['incapacitated', 'frozen'] as const)('interrupts auto on own %s and prevents resume without treating it as an ending', async code => {
    const session = hooks.states[0] as SessionResponse;
    session.policy = { ...session.policy!, id: 'policy', intentId: 'helpful_rescuer', label: '热心救援者', status: 'stopped', stopOnUnexpected: false };
    const next = structuredClone(session); next.revision = 1; next.policy!.status = 'stopped';
    next.policy!.stopDetail = { code, choices: [] }; next.policy!.reason = '自身状态使自动行动停止。';
    if (code === 'incapacitated') next.frame.fields.lifeState = code;
    else next.frame.fields.coldState = code;
    transport.refresh.mockResolvedValue(next);
    find(renderApp(), node => node.props['aria-label'] === '同步会话').props.onClick();
    await vi.waitFor(() => expect(hooks.states[0]).toEqual(next));
    expect(transport.policyInterrupt).toHaveBeenCalledOnce();
    expect(markup()).toContain('自身状态使自动行动停止。');
    expect(markup()).not.toContain('按此倾向继续'); expect(markup()).not.toContain('查看结算');
    expect(transport.policyRun).not.toHaveBeenCalled();
  });

  it.each(['K0_NOT_ADMITTED', 'C0_BINDING_REJECTED', 'UNPUBLISHED_RESULT'] as const)('keeps public refusal %s and explanation visible without opening the receipt or executing another action', async code => {
    const next = structuredClone(initial);
    next.frame.feedback = { status: 'rejected', refusal: { code }, entry: 'care_person_adventurer', actionLabel: 'Care', text: '作者尚未公开具体原因。' };
    transport.refresh.mockResolvedValue(next);
    find(renderApp(), node => node.props['aria-label'] === '同步会话').props.onClick();
    await vi.waitFor(() => expect(hooks.states[0]).toEqual(next));
    expect(markup()).toContain(`role="alert" aria-label="${code === 'UNPUBLISHED_RESULT' ? '提交结果待核对' : '行动未发生'}"`);
    if (code === 'UNPUBLISHED_RESULT') {
      expect(markup()).toContain('发布结果未知');
      expect(markup()).not.toContain('未消耗局内时间与资源');
    } else expect(markup()).toContain('未消耗局内时间与资源');
    expect(markup()).toContain('作者尚未公开具体原因。');
    expect(markup()).toContain(`错误码: <code>${code}</code>`);
    expect(markup()).not.toContain('receipt-scroll');
    expect(markup()).not.toContain('role="dialog"');
    expect(transport.choose).not.toHaveBeenCalled(); expect(transport.policyRun).not.toHaveBeenCalled();
  });

  it('does not offer a settlement before an actual ending', () => {
    const onView = vi.fn();
    expect(EndingNotice({ frame: initial.frame, onView })).toBeNull();
    expect(markup()).not.toContain('查看结算');
    expect(markup()).not.toContain('role="dialog"');
    expect(onView).not.toHaveBeenCalled();
  });

  it.each(['departed_palace', 'adventurer_dead', 'rescue_window_expired'])('keeps %s visible in the scene on refresh, without an automatic sheet', async id => {
    const before = find(renderApp(), node => node.props['data-testid'] === 'current-scene');
    const final = ended(id);
    transport.refresh.mockResolvedValue(final);
    find(renderApp(), node => node.props['aria-label'] === '同步会话').props.onClick();
    await vi.waitFor(() => expect(hooks.states[0]).toEqual(final));
    const after = find(renderApp(), node => node.props['data-testid'] === 'current-scene');
    expect(after.type).toBe(before.type); expect(after.key).toBe(before.key);
    const html = markup();
    expect(html).toContain('scene-ballroom-v3.png');
    expect(html).toContain('吊灯边缘');
    expect(html).toContain('眼前的最终场景记录');
    expect(html).toContain('data-testid="latest-receipt"');
    expect(html).toContain(final.frame.ending!.title);
    expect(html).toContain('查看结算');
    expect(html).not.toContain('ending-page');
    expect(html).not.toContain('ending-summary');
    expect(html).not.toContain('role="dialog"');
    expect(transport.choose).not.toHaveBeenCalled(); expect(transport.restart).not.toHaveBeenCalled();
    expect(transport.policyRun).not.toHaveBeenCalled();
    const { LatestReceipt } = await import('./App');
    find(renderApp(), node => node.type === LatestReceipt).props.onRead();
    expect(markup()).toContain('最终行动已经发布');
    expect(markup()).toContain('本次行动与随后变化');
    find(renderApp(), node => node.props['aria-label'] === '关闭').props.onClick();
    expect(markup()).not.toContain('role="dialog"');
  });

  it('opens the complete settlement only on request, closes back to the scene, and can reopen it', () => {
    hooks.states[0] = ended('departed_palace');
    const snapshot = structuredClone(hooks.states[0]);
    viewSummary();
    const html = markup();
    expect(html).toContain('data-testid="current-scene"');
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="sheet-title"');
    expect(html).toContain('id="sheet-title">旅程结算');
    expect(html).toContain('data-testid="ending-summary"');
    expect(html).toContain('本局报告');
    for (const label of ['谨慎调查者', '热心救援者', '果断探索者']) expect(html).toContain(label);
    find(renderApp(), node => node.props['aria-label'] === '关闭').props.onClick();
    expect(markup()).not.toContain('role="dialog"');
    expect(markup()).toContain('查看结算');
    viewSummary();
    expect(markup()).toContain('data-testid="ending-summary"');
    expect(hooks.states[0]).toEqual(snapshot);
    expect(transport.choose).not.toHaveBeenCalled(); expect(transport.restart).not.toHaveBeenCalled();
  });

  it('keeps backdrop and inside-click dismissal consistent with other sheets', () => {
    hooks.states[0] = ended('adventurer_dead'); viewSummary();
    const stopPropagation = vi.fn();
    find(renderApp(), node => node.props.role === 'dialog').props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(markup()).toContain('role="dialog"');
    find(renderApp(), node => node.props.className === 'scrim').props.onClick();
    expect(markup()).not.toContain('role="dialog"');
  });

  it('leaves ending snapshots in the scene on initial restore as well as repeated refresh', async () => {
    const final = ended('rescue_window_expired'); hooks.states[0] = final;
    expect(markup()).not.toContain('role="dialog"');
    transport.refresh.mockResolvedValue(structuredClone(final));
    find(renderApp(), node => node.props['aria-label'] === '同步会话').props.onClick();
    await vi.waitFor(() => expect(transport.refresh).toHaveBeenCalledOnce());
    expect(markup()).not.toContain('role="dialog"');
    expect(markup()).toContain('data-testid="current-scene"');
  });

  it('keeps ended selections read-only, including stale offers, and requires explicit restart confirmation', async () => {
    hooks.states[0] = ended('departed_palace');
    const map = find(renderApp(), node => node.type === GeographicMap);
    map.props.onSelect('ballroom_entrance');
    expect(markup()).toContain('没有可执行的世界行动');
    expect(markup()).not.toContain('data-testid="execute"');
    expect(find(renderApp(), node => node.props['aria-label'] === '人格倾向').props.disabled).toBe(true);
    expect(transport.choose).not.toHaveBeenCalled();
    viewSummary();
    const summary = find(renderApp(), node => node.type === EndingSummary);
    summary.props.onHistory();
    expect(markup()).toContain('id="sheet-title">行动记录');
    expect(markup()).toContain('data-testid="current-scene"');
    find(renderApp(), node => node.props['aria-label'] === '关闭').props.onClick();
    viewSummary();
    find(renderApp(), node => node.type === EndingSummary).props.onRestart();
    expect(markup()).toContain('重新开始这段旅程？');
    expect(transport.restart).not.toHaveBeenCalled();
    transport.restart.mockResolvedValue(structuredClone(initial));
    find(renderApp(), node => node.type === 'button' && node.props.className === 'execute').props.onClick();
    await vi.waitFor(() => expect(hooks.states[0]).toEqual(initial));
    expect(transport.restart).toHaveBeenCalledOnce();
    expect(markup()).not.toContain('旅程已结束');
  });

  it('selects an individual map site without executing its offered movement', () => {
    (hooks.states[0] as SessionResponse).frame.offers.push({ index: 17, label: 'Move', entry: 'walk_adventurer', destination: 'ballroom_chandelier_reach' });
    find(renderApp(), node => node.type === GeographicMap).props.onSelect('ballroom_chandelier_reach');
    expect(markup()).toContain('aria-label="所选详情"');
    expect(markup()).toContain('aria-pressed="true" aria-label="吊灯边缘"');
    expect((hooks.states[0] as SessionResponse).frame.scene!.playerSite).toBe('ballroom_entrance');
    expect(transport.choose).not.toHaveBeenCalled();
  });

  it('keeps the compact map aspect ratio intact at narrow desktop widths', async () => {
    const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
    const geographicCss = await readFile(new URL('./geographic.css', import.meta.url), 'utf8');
    const rules = [...css.matchAll(/\.geographic-map\.compact \.geographic-chart\s*\{([^}]+)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule[1]).not.toMatch(/height:/);
    expect(geographicCss).toContain('aspect-ratio: var(--map-ratio, 900 / 1280)');
    expect(geographicCss).toContain('.compact .geographic-place { width: 12px; height: 12px;');
  });
});

describe('presence map selection integration', () => {
  it('opens adjacent entity details from the expanded map without submitting or placing the entity in the main scene', () => {
    const session = hooks.states[0] as SessionResponse;
    session.frame.information.nearbyEntities = [surface('adjacent', 'elemental', 'ritual_threshold', '作者提供的元素名称')];
    session.frame.offers.push({ index: 51, label: '观察', entry: 'observe_elemental_adventurer', targetIds: ['adjacent'] });
    find(renderApp(), node => node.props['aria-label'] === '已知地图').props.onClick();
    const expandedMap = find(renderApp(), node => node.type === GeographicMap && !node.props.compact);
    expandedMap.props.onSelectEntity('adjacent');
    const html = markup();
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('<h2>作者提供的元素名称</h2>');
    expect(html).toContain('相邻可见 · 仪式门槛');
    expect(html).toContain('元素 · 靠近后仔细观察');
    expect(html).not.toContain('data-surface="adjacent"');
    expect(html).toContain('aria-label="行动确认"');
    expect(transport.choose).not.toHaveBeenCalled(); expect(transport.policyRun).not.toHaveBeenCalled();
  });

  it('opens historical entity details as last-seen, then retains a memory selection when a current entity disappears', async () => {
    const session = hooks.states[0] as SessionResponse;
    session.frame.observations = [memory('known', 'person', 'tower_top')];
    find(renderApp(), node => node.type === GeographicMap).props.onSelectEntity('known');
    expect(markup()).toContain('上次观察'); expect(markup()).toContain('时刻 2');
    expect(markup()).not.toContain('aria-label="当前实体读回"');
    session.frame.information.nearbyEntities = [surface('known', 'person', 'halls_ballroom_door', '当前作者名称')];
    find(renderApp(), node => node.type === GeographicMap).props.onSelectEntity('known');
    expect(markup()).toContain('<h2>当前作者名称</h2>');
    const next = structuredClone(session); next.revision = 2; next.frame.information.nearbyEntities = [];
    transport.refresh.mockResolvedValue(next);
    find(renderApp(), node => node.props['aria-label'] === '同步会话').props.onClick();
    await vi.waitFor(() => expect(hooks.states[0]).toEqual(next));
    expect(markup()).toContain('<h2>上次观察的名称</h2>');
    expect(markup()).not.toContain('aria-label="当前实体读回"');
    expect(transport.choose).not.toHaveBeenCalled();
  });

  it('keeps adjacent current selection through refresh without turning it into a same-site surface', async () => {
    const session = hooks.states[0] as SessionResponse;
    session.frame.information.nearbyEntities = [surface('known', 'person', 'ritual_threshold', '匿名个体')];
    find(renderApp(), node => node.type === GeographicMap).props.onSelectEntity('known');
    const next = structuredClone(session); next.revision = 1; next.frame.time = 15;
    transport.refresh.mockResolvedValue(next);
    find(renderApp(), node => node.props['aria-label'] === '同步会话').props.onClick();
    await vi.waitFor(() => expect(hooks.states[0]).toEqual(next));
    expect(markup()).toContain('<h2>匿名个体</h2>');
    expect(markup()).not.toContain('data-surface="known"');
    expect(markup()).toContain('相邻可见 · 仪式门槛');
  });

  it('selects a singleton pin directly, expands a crowded cluster, and selects each member without transport', () => {
    const frame = (hooks.states[0] as SessionResponse).frame;
    frame.information.visibleEntities = [surface('one', 'person', 'ballroom_entrance'), surface('two', 'person', 'ballroom_entrance')];
    frame.information.nearbyEntities = [surface('elemental', 'elemental', 'ritual_threshold')];
    frame.observations = [memory('past', 'everflame', 'tower_top')];
    hooks.states = [];
    const onSelect = vi.fn(), onSelectEntity = vi.fn();
    const renderMap = () => {
      hooks.stateIndex = 0; hooks.active = true;
      try { return GeographicMap({ frame, compact: true, onSelect, onSelectEntity }); }
      finally { hooks.active = false; }
    };
    find(renderMap(), node => typeof node.props['data-entity-cluster'] === 'string' && node.props['data-entity-cluster'].includes('elemental')).props.onClick();
    expect(onSelectEntity).toHaveBeenLastCalledWith('elemental');
    const cluster = find(renderMap(), node => typeof node.props['data-entity-cluster'] === 'string' && node.props['data-entity-cluster'].includes('person'));
    cluster.props.onClick();
    expect(onSelectEntity).toHaveBeenCalledOnce();
    expect(find(renderMap(), node => node.props.className === 'geographic-entities').props.open).toBe(true);
    find(renderMap(), node => node.props['data-map-entity'] === 'two').props.onClick();
    expect(onSelectEntity).toHaveBeenLastCalledWith('two');
    find(renderMap(), node => node.props.className === 'entity-list-all').props.onClick();
    expect(find(renderMap(), node => node.props.className === 'geographic-entities').props.open).toBe(true);
    find(renderMap(), node => node.props['data-map-entity'] === 'past').props.onClick();
    expect(onSelectEntity).toHaveBeenLastCalledWith('past');
    expect(onSelect).not.toHaveBeenCalled(); expect(transport.choose).not.toHaveBeenCalled();
  });
});

describe('settlement sheet keyboard focus', () => {
  it('traps focus, closes on Escape, returns to the original opener, and removes listeners', () => {
    const target = new EventTarget();
    const document = { activeElement: null as unknown };
    const first = { getClientRects: () => [{}], focus: vi.fn(() => { document.activeElement = first; }) };
    const last = { getClientRects: () => [{}], focus: vi.fn(() => { document.activeElement = last; }) };
    const hidden = { getClientRects: () => [], focus: vi.fn() };
    const initiator = { isConnected: true, focus: vi.fn(() => { document.activeElement = initiator; }) };
    const sheet = { ownerDocument: document, querySelectorAll: () => [first, last, hidden], contains: (node: unknown) => node === first || node === last } as unknown as HTMLElement;
    const cleanup = manageSheetFocus(target, sheet, initiator as unknown as HTMLElement);
    const dismiss = vi.fn(cleanup);
    const stopEscape = listenForEscape(target, dismiss);
    expect(document.activeElement).toBe(first);
    const tab = (shiftKey: boolean) => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Tab', shiftKey });
      target.dispatchEvent(event); return event;
    };
    expect(tab(true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
    expect(tab(false).defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
    expect(hidden.focus).not.toHaveBeenCalled();
    document.activeElement = initiator;
    expect(tab(false).defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
    target.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
    expect(dismiss).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(initiator);
    stopEscape();
    expect(tab(true).defaultPrevented).toBe(false);
    target.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('does not attempt to refocus an opener removed by an explicit restart', () => {
    const initiator = { isConnected: false, focus: vi.fn() };
    const sheet = { querySelectorAll: () => [] } as unknown as HTMLElement;
    manageSheetFocus(new EventTarget(), sheet, initiator as unknown as HTMLElement)();
    expect(initiator.focus).not.toHaveBeenCalled();
  });
});
