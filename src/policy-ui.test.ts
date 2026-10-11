import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { IntentPolicy, PolicyStartSettings, SessionResponse } from './types';
import { emptyPlayReport } from './playReport.fixtures';

const startSettings: PolicyStartSettings = { maxActions: 64, stopOnUnexpected: true };

const initial: SessionResponse = {
  sessionId: 'policy-ui', revision: 0, policyRevision: 0, entries: [],
  playReport: emptyPlayReport(),
  intentOffers: [
    { id: 'cautious_investigator', label: '谨慎调查者', description: '先弄清所见，再审慎行动。', maxActions: 128 },
    { id: 'helpful_rescuer', label: '热心救援者', description: '留意需要帮助的人，量力伸出援手。', maxActions: 128 },
    { id: 'decisive_explorer', label: '果断探索者', description: '愿意向未知迈步，但不忽视眼前风险。', maxActions: 128 },
  ],
  policy: { id: null, intentId: null, label: null, reason: null, stopDetail: null, status: 'idle', executed: 0, limit: 64, stopOnUnexpected: true, plan: null, steps: [] },
  frame: {
    time: 0, ending: null, observations: [],
    offers: [{ index: 617, entry: 'observe_routes_adventurer', label: 'Observe routes' }, { index: 903, entry: 'wait_adventurer', label: 'Wait' }],
    fields: { details: [], lifeState: 'alive', coldState: 'mobile', location: '公开起点', locationId: 'public_origin', everflameCharges: 5, carriedReservoirCharges: null, coldCondition: 'Able to move', movementSpeed: 5, chandelierClue: null, ritualSigns: null, protection: [] },
    scene: { playerSite: 'public_origin', knownSites: ['public_origin', 'public_destination'], siteLabels: { public_origin: '公开起点', public_destination: '公开目的地' }, routes: [] },
    information: {
      visibleEntities: [], nearbyEntities: [], movements: [], visibility: 'provided', visibilityNotice: '眼前没有人物。',
      ritual: { phase: 'unknown', label: '尚未听到动静', evidence: 'unknown', recordedAt: null },
      escortResponse: { status: 'not_observed', label: '尚未观察到回应。' }, timingNotice: '行动会推进时间。',
    },
  },
};

const running: IntentPolicy = { id: 'dynamic-policy/91', intentId: 'cautious_investigator', label: '谨慎调查者', reason: null, stopDetail: null, status: 'running', executed: 0, limit: 64, stopOnUnexpected: true, plan: null, steps: [] };

describe('personality consent and progress presentation', () => {
  it('uses raw world-time units in both total progress and individual steps, not seconds', async () => {
    vi.stubGlobal('window', { sessionStorage: undefined });
    try {
      const { PolicyDetails } = await import('./App');
      const markup = renderToStaticMarkup(createElement(PolicyDetails, {
        policy: { ...running, steps: [{ entry: 'public-action', label: '公开行动', index: 617, score: 2, reason: '公开原因', beforeRevision: 0, afterRevision: 1, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 2.5, afterTime: 9 }] },
        offers: initial.frame.offers,
      }));
      expect(markup).toContain('实际总耗时 6.5 局内时间单位');
      expect(markup).toContain('耗时 6.5 局内时间单位');
      expect(markup).not.toContain('秒');
    } finally { vi.unstubAllGlobals(); }
  });
  it('shows all supplied personalities and descriptions with ongoing consent and a safety cap, not a destination task', async () => {
    vi.stubGlobal('window', { sessionStorage: undefined });
    try {
      const { PersonalityChoices } = await import('./App');
      const markup = renderToStaticMarkup(createElement(PersonalityChoices, {
        offers: initial.intentOffers!, selectedId: 'helpful_rescuer', settings: startSettings, onSettings: () => {}, disabled: false, onSelect: () => {}, onApprove: () => {},
      }));
      for (const offer of initial.intentOffers!) {
        expect(markup).toContain(offer.id); expect(markup).toContain(offer.label); expect(markup).toContain(offer.description);
      }
      expect(markup).toContain('人格倾向'); expect(markup).toContain('按此倾向行动');
      expect(markup).toContain('name="maxActions"'); expect(markup).toContain('value="64"');
      expect(markup).toContain('按作者评价与人格偏好行动');
      expect(markup).not.toContain('重新评分');
      expect(markup).toContain('行动会推进局内时间'); expect(markup).toContain('点击停止即可接手');
      for (const scope of ['可观察', '沿已知通路行进', '取用资源', '帮助已知受困者', '搬离眼前仪式祭品', '邀请身边居民或离宫']) expect(markup).toContain(scope);
      expect(markup).toContain('优先保留 2 点充能，并寻找其他可行行动');
      expect(markup).toContain('关闭后继续重规划，但死亡、失能或冰封仍会停止');
      expect(markup).toContain('无法保证成功');
      expect(markup).not.toMatch(/自动获胜|(?<!无法)保证成功/);
      expect(markup).not.toMatch(/不自动|至少保留|永远保留/);
      expect(markup.match(/class="selection-note"/g)).toHaveLength(1);
      expect(markup).not.toContain('目标：'); expect(markup).not.toContain('批准');
    } finally { vi.unstubAllGlobals(); }
  });
  it('presents execution count independently of the safety cap and surfaces the latest scoring reason', async () => {
    vi.stubGlobal('window', { sessionStorage: undefined });
    try {
      const { PolicyDetails } = await import('./App');
      const markup = renderToStaticMarkup(createElement(PolicyDetails, {
        policy: { ...running, executed: 4, steps: [{ entry: 'public-action', label: '公开行动', index: 617, score: 2.5, reason: '当前所见支持继续调查', beforeRevision: 3, afterRevision: 4, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 21, afterTime: 28 }] },
        offers: initial.frame.offers,
      }));
      expect(markup).toContain('已行动 4 次'); expect(markup).toContain('你设置的上限 64 次');
      expect(markup).not.toContain('4 / 64');
      expect(markup).toContain('最新判断：当前所见支持继续调查'); expect(markup).toContain('选择权重 2.5');
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('published action and stop detail presentation', () => {
  async function renderProgress(policy: IntentPolicy, offers = initial.frame.offers) {
    vi.stubGlobal('window', { sessionStorage: undefined });
    const onResume = vi.fn(), onCancel = vi.fn();
    try {
      const { PolicyDetails } = await import('./App');
      const markup = renderToStaticMarkup(createElement(PolicyDetails, {
        policy, offers,
      }));
      expect(onResume).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      return markup;
    } finally { vi.unstubAllGlobals(); }
  }

  it('uses the same Chinese action names as buttons without interpreting stale indices', async () => {
    const policy: IntentPolicy = {
      ...running, status: 'stopped', executed: 1, reason: '玩家停止。',
      steps: [{ entry: 'thaw_floor_adventurer', label: 'Spend one charge to thaw the observed floor',
        index: 42, score: 1, reason: '清理冰面', beforeRevision: 0, afterRevision: 1, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 0, afterTime: 100 }],
      stopDetail: { code: 'cancelled', choices: [{ index: 3, label: 'Wait' }] },
    };
    const markup = await renderProgress(policy, [{ index: 3, entry: 'wait_adventurer', label: 'Wait' }]);
    expect(markup).toContain('本次已行动 1 次');
    expect(markup).not.toContain('Spend one charge');
    expect(markup).toContain('刚刚完成：解冻可达冰面');
    expect(markup).toContain('<li data-choice-index="3">留在原地等待</li>');
    const stale = await renderProgress(policy, [{ index: 3, entry: 'leave_palace_adventurer', label: 'Leave' }]);
    expect(stale).not.toContain('<li data-choice-index="3">离开');
  });

  const steps: IntentPolicy['steps'] = [
    { entry: 'observe_routes_adventurer', label: '观察附近通路', index: 617, score: 2, reason: '了解当前通路', beforeRevision: 0, afterRevision: 1, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 0, afterTime: 7 },
    { entry: 'public-published-action', label: '已完成的公开行动', index: 951, score: 3, reason: '最后行动的作者评价', beforeRevision: 1, afterRevision: 2, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 7, afterTime: 9.5 },
  ];

  it('shows the actual last published label, appraisal and time outside the collapsed history while running', async () => {
    const markup = await renderProgress({ ...running, executed: 2, steps });
    const visible = markup.split('<section class="policy-steps">')[0];
    expect(visible).toContain('刚刚完成：已完成的公开行动');
    expect(visible).not.toContain('刚刚完成：观察附近通路');
    expect(visible).toContain('最新判断：最后行动的作者评价');
    expect(visible).toContain('局内时刻 7 → 9.5 · 耗时 2.5 局内时间单位');
    expect(visible).toContain('实际总耗时 9.5 局内时间单位');
    expect(visible).not.toContain('policy-stop-choices');
    expect(markup).not.toContain('<details open');
  });

  it('keeps the last published action distinct from the stop reason and lists only supplied manual choices as text', async () => {
    const policy: IntentPolicy = {
      ...running, status: 'stopped', executed: 2, steps, reason: '当前选择需要你决定。',
      stopDetail: { code: 'public_choice', choices: [{ index: 903, label: '等待下一刻' }, { index: 1204, label: '查看眼前物件' }] },
    };
    const markup = await renderProgress(policy);
    const visible = markup.split('<section class="policy-steps">')[0];
    expect(visible).toContain('刚刚完成：已完成的公开行动');
    expect(visible).toContain('当前选择需要你决定。');
    expect(visible).toContain('data-stop-code="public_choice"');
    expect(visible).toContain('<li data-choice-index="903">等待下一刻</li>');
    expect(visible).toContain('<li data-choice-index="1204">查看眼前物件</li>');
    expect(visible.indexOf('等待下一刻')).toBeLessThan(visible.indexOf('查看眼前物件'));
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('刚刚完成：等待下一刻');
    expect(markup).not.toContain('刚刚完成：查看眼前物件');
  });

  it('shows a world-ending stop reason without manual choices or a fabricated last action', async () => {
    const markup = await renderProgress({
      ...running, status: 'stopped', reason: '这段旅程已经结束。', stopDetail: { code: 'worldending', choices: [] },
    });
    expect(markup).toContain('这段旅程已经结束。');
    expect(markup).not.toContain('当前可选行动');
    expect(markup).not.toContain('刚刚完成');
    expect(markup).not.toContain('最新判断');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<details');
  });

  it('preserves the actual last published action at a world-ending stop with empty choices', async () => {
    const markup = await renderProgress({
      ...running, status: 'stopped', executed: 2, steps, reason: '旅程终局。', stopDetail: { code: 'worldending', choices: [] },
    });
    const visible = markup.split('<section class="policy-steps">')[0];
    expect(visible).toContain('刚刚完成：已完成的公开行动');
    expect(visible).toContain('旅程终局。');
    expect(markup).not.toContain('policy-stop-choices');
    expect(markup).not.toContain('<button');
  });

  it('does not claim a completed action or current choices before the first publication', async () => {
    const markup = await renderProgress(running);
    expect(markup).not.toContain('刚刚完成');
    expect(markup).not.toContain('最新判断');
    expect(markup).not.toContain('policy-stop-choices');
    expect(markup).toContain('已行动 0 次');
  });

  it('renders idle null stop detail without progress, feedback or commands', async () => {
    expect(await renderProgress(initial.policy!)).toBe('');
  });
});

describe('public replan UI controls and readback', () => {
  async function components() {
    vi.stubGlobal('window', { sessionStorage: undefined });
    try { return await import('./App'); } finally { vi.unstubAllGlobals(); }
  }

  it('offers an integer maximum and a checked unexpected-stop checkbox with default authorization values', async () => {
    const { PersonalityChoices } = await components();
    const onApprove = vi.fn(), onSettings = vi.fn();
    const markup = renderToStaticMarkup(createElement(PersonalityChoices, {
      offers: initial.intentOffers!, selectedId: 'cautious_investigator', settings: startSettings,
      disabled: false, onSelect: () => {}, onSettings, onApprove,
    }));
    expect(markup).toMatch(/type="number"[^>]*min="1"[^>]*max="128"[^>]*step="1"[^>]*value="64"/);
    expect(markup).toMatch(/type="checkbox"[^>]*name="stopOnUnexpected"[^>]*checked/);
    expect(markup).not.toMatch(/class="execute" disabled/);
    expect(markup).not.toContain('安全上限：128');
    expect(onApprove).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
  });

  it.each([0, 129, 1.5, NaN])('disables approval for an invalid maximum %s rather than silently clamping', async maxActions => {
    const { PersonalityChoices } = await components();
    const markup = renderToStaticMarkup(createElement(PersonalityChoices, {
      offers: initial.intentOffers!, selectedId: 'cautious_investigator', settings: { maxActions, stopOnUnexpected: false },
      disabled: false, onSelect: () => {}, onSettings: () => {}, onApprove: () => {},
    }));
    expect(markup).toMatch(/class="execute" disabled/);
    expect(markup).not.toMatch(/type="checkbox"[^>]*checked/);
    if (Number.isNaN(maxActions)) expect(markup).toMatch(/type="number"[^>]*value=""/);
  });

  it('reads the running plan and actual authorization without claiming an optimal or guaranteed outcome', async () => {
    const { PolicyDetails } = await components();
    const markup = renderToStaticMarkup(createElement(PolicyDetails, {
      policy: { ...running, limit: 13, stopOnUnexpected: false, plan: {
        goal: '继续调查公开人物', targetSite: 'public_destination',
        route: [{ site: 'public_origin', label: '公开起点' }, { site: 'public_destination', label: '公开目的地' }],
        estimatedActions: 4, estimatedGain: 6, value: 1.5, uncertainty: '后续行动仍需按实际所见确认。',
      } }, offers: initial.frame.offers,
    }));
    expect(markup).toContain('当前目标：继续调查公开人物');
    expect(markup).toContain('预计路线：公开起点 → 公开目的地');
    expect(markup).toContain('预计 4 次行动 · 结果待实际行动确认');
    expect(markup).toContain('你设置的上限 13 次');
    expect(markup).toContain('意外停点：关闭');
    expect(markup).toContain('后续行动仍需按实际所见确认');
    expect(markup).not.toMatch(/最优|保证|一定|public_destination|public_origin/);
  });

  it('does not fabricate a plan when the required plan is null', async () => {
    const { PolicyProgress } = await components();
    const markup = renderToStaticMarkup(createElement(PolicyProgress, {
      policy: running, offers: initial.frame.offers, pumping: false, cancelling: false, disabled: false,
      canContinue: false, onResume: () => {}, onCancel: () => {}, onDetails: () => {},
    }));
    expect(markup).not.toContain('当前目标');
    expect(markup).not.toContain('预计路线');
    expect(markup).toContain('继续行动');
  });

  it('restores authorized settings on first read or a new policy, not on a same-policy cancel or refresh', async () => {
    const { policySettingsReadback } = await components();
    const restored = { ...initial, policy: { ...running, limit: 13, stopOnUnexpected: false } };
    expect(policySettingsReadback(null, initial)).toBeNull();
    expect(policySettingsReadback(null, restored)).toEqual({ maxActions: 13, stopOnUnexpected: false });
    const cancelled = { ...restored, policy: { ...restored.policy, status: 'stopped' as const } };
    expect(policySettingsReadback(restored, cancelled)).toBeNull();
    expect(policySettingsReadback(cancelled, cancelled)).toBeNull();
    const approved = { ...restored, policy: { ...running, id: 'new-policy', limit: 128 } };
    expect(policySettingsReadback(cancelled, approved)).toEqual({ maxActions: 128, stopOnUnexpected: true });
    expect(policySettingsReadback(approved, { ...approved, sessionId: 'another-session' })).toEqual({ maxActions: 128, stopOnUnexpected: true });
  });

  it.each([false, true])('offers a stopped continuation with disabled=%s and never executes it during rendering', async disabled => {
    const { PolicyProgress } = await components();
    const onResume = vi.fn(), onCancel = vi.fn();
    const markup = renderToStaticMarkup(createElement(PolicyProgress, {
      policy: { ...running, status: 'stopped', reason: '玩家停止。' }, offers: initial.frame.offers,
      pumping: false, cancelling: false, disabled, canContinue: true, onResume, onCancel, onDetails: () => {},
    }));
    expect(markup).toContain('继续「谨慎调查者」代行');
    expect(markup).not.toContain('继续行动');
    expect(markup).not.toContain('>停止</button>');
    if (disabled) expect(markup).toContain('<button disabled=""');
    else expect(markup).not.toContain('<button disabled');
    expect(onResume).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps only the latest action, count and controls in the HUD while preserving complete long details in the panel', async () => {
    const { PolicyProgress, PolicyDetails } = await components();
    const reason = '公开行动的完整判断理由。'.repeat(80);
    const policy: IntentPolicy = { ...running, executed: 128, limit: 128, steps: Array.from({ length: 128 }, (_, index) => ({
      entry: 'public-action', label: `公开行动 ${index + 1}`, index, score: 1.25, reason,
      beforeRevision: index, afterRevision: index + 1, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: index, afterTime: index + 1,
    })), plan: { goal: '按当前所见继续调查', targetSite: 'public_destination',
      route: [{ site: 'public_origin', label: '公开起点' }, { site: 'public_destination', label: '公开目的地' }],
      estimatedActions: 2, estimatedGain: 3, value: 1.5, uncertainty: '仍需实际确认。' } };
    const snapshot = structuredClone(policy);
    const onDetails = vi.fn(), onCancel = vi.fn();
    const hud = renderToStaticMarkup(createElement(PolicyProgress, {
      policy, offers: initial.frame.offers, pumping: true, cancelling: false, disabled: false, canContinue: false,
      onResume: () => {}, onCancel, onDetails,
    }));
    expect(hud).toContain('已执行 128 次');
    expect(hud).toContain('刚刚完成：公开行动 128');
    expect(hud).toContain('>停止</button>');
    expect(hud).toContain('aria-label="行动详情"');
    expect(hud).not.toContain(reason);
    expect(hud).not.toMatch(/预计路线|已执行行动|<ol|<details|评分/);
    const panel = renderToStaticMarkup(createElement(PolicyDetails, { policy, offers: initial.frame.offers }));
    expect(panel).toContain(reason);
    expect(panel).toContain('公开行动 1</strong>');
    expect(panel).toContain('公开行动 128</strong>');
    expect(panel).toContain('预计路线：公开起点 → 公开目的地');
    expect(panel).toContain('选择权重 1.25');
    expect(panel).toContain('实际总耗时 128 局内时间单位');
    expect(policy).toEqual(snapshot);
    expect(onCancel).not.toHaveBeenCalled(); expect(onDetails).not.toHaveBeenCalled();
    const css = await readFile(resolve(process.cwd(), 'src/style.css'), 'utf8');
    const hudRule = css.match(/\.policy-progress \{([^}]+)\}/)![1];
    expect(hudRule).not.toMatch(/max-height:|overflow:|line-clamp|text-overflow/);
    expect(hudRule).toContain('minmax(0, 1fr) auto');
  });

  it('shows the stop reason directly while keeping choices and predicted routes in details', async () => {
    const { PolicyProgress, PolicyDetails } = await components();
    const policy: IntentPolicy = { ...running, status: 'stopped', reason: '需要亲自选择。',
      stopDetail: { code: 'public_choice', choices: [{ index: 903, label: 'Wait' }] },
      plan: { goal: '停止前的公开目标', targetSite: 'public_destination', route: [{ site: 'public_origin', label: '公开起点' }],
        estimatedActions: 1, estimatedGain: 2, value: 2, uncertainty: '停止前的预测。' } };
    const hud = renderToStaticMarkup(createElement(PolicyProgress, { policy, offers: initial.frame.offers,
      pumping: false, cancelling: false, disabled: false, canContinue: true,
      onResume: () => {}, onCancel: () => {}, onDetails: () => {} }));
    expect(hud).toContain('继续「谨慎调查者」代行');
    expect(hud).toContain('需要亲自选择。');
    expect(hud).not.toMatch(/可亲自选择|预计路线/);
    const panel = renderToStaticMarkup(createElement(PolicyDetails, { policy, offers: initial.frame.offers }));
    expect(panel).toContain('需要亲自选择。');
    expect(panel).toContain('停止前目标：停止前的公开目标');
    expect(panel).toContain('预计路线：公开起点');
    expect(panel).toContain('留在原地等待');
  });
});

describe('policy UI built artifact (network isolated, no server)', () => {
  it('approves once, cancels after the in-flight readback, and requires explicit resume after refresh or error', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    page.setDefaultTimeout(4_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let latest = structuredClone(initial);
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    let releaseStart!: () => void;
    let releaseStep!: () => void;
    let failStep = false;
    await page.route('http://127.0.0.1:8873/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/')) {
        if (path.endsWith('/advice')) { await route.fulfill({json: {}}); return; }
        if (request.method() === 'POST') {
          const body = request.postDataJSON(); posts.push({ path, body });
          if (path.includes('/policy/') && body.policyRevision !== latest.policyRevision) {
            await route.fulfill({ status: 409, json: { error: 'stale policyRevision' } }); return;
          }
          if (path.endsWith('/policy/start')) {
            await new Promise<void>(resolve => { releaseStart = resolve; });
            latest = { ...latest, policyRevision: latest.policyRevision! + 1, policy: { ...structuredClone(running), limit: body.maxActions, stopOnUnexpected: body.stopOnUnexpected } };
          }
          if (path.endsWith('/policy/step')) {
            if (failStep) { await route.abort('failed'); return; }
            await new Promise<void>(resolve => { releaseStep = resolve; });
            latest = { ...latest, revision: 1, policyRevision: latest.policyRevision! + 1, frame: { ...latest.frame, time: 7 }, policy: { ...latest.policy!, executed: 1, steps: [{
              entry: 'observe_routes_adventurer', label: '观察附近通路', index: 617, score: 2, reason: '根据最新公开通路', beforeRevision: 0, afterRevision: 1, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: 0, afterTime: 7,
            }] } };
          }
          if (path.endsWith('/policy/cancel')) latest = { ...latest, policyRevision: latest.policyRevision! + 1, policy: { ...latest.policy!, status: 'stopped', reason: '玩家停止', stopDetail: { code: 'player_cancelled', choices: latest.frame.offers.map(({ index, label }) => ({ index, label })) } } };
        }
        await route.fulfill({ json: latest }); return;
      }
      const file = path === '/' ? 'index.html' : path.slice(1);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html';
      try { await route.fulfill({ body: await readFile(resolve(process.cwd(), 'dist', file)), contentType }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    try {
      await page.goto('http://127.0.0.1:8873');
      await page.getByTestId('current-scene').waitFor();
      await page.getByRole('button', { name: '人格倾向', exact: true }).click();
      expect(await page.locator('.intent-choice').count()).toBe(3);
      expect(await page.getByRole('spinbutton', { name: '行动上限', exact: true }).inputValue()).toBe('8');
      await page.getByRole('spinbutton', { name: '行动上限', exact: true }).fill('9');
      await page.getByRole('checkbox', { name: '遇到意外时停止', exact: true }).uncheck();
      expect(await page.getByRole('button', { name: '按此倾向行动', exact: true }).isEnabled()).toBe(true);
      await page.locator('.intent-choice input[value="cautious_investigator"]').check();
      await page.screenshot({ path: 'test-results/policy-ui/approval.png' });
      expect(posts).toHaveLength(1);
      await page.getByRole('button', { name: '按此倾向行动', exact: true }).click();
      await page.getByText('正在启动…', { exact: true }).waitFor();
      expect(await page.getByRole('button', { name: '停止', exact: true }).isEnabled()).toBe(true);
      expect(await page.getByTestId('next-step-guidance').count()).toBe(0);
      releaseStart();
      await page.waitForFunction(() => document.querySelector('[data-policy-status="running"]'));
      await page.clock.fastForward(2500);
      await expect.poll(() => posts.filter(post => post.path.endsWith('/policy/step')).length).toBe(1);
      expect(posts[1].body).toEqual({ intentId: 'cautious_investigator', maxActions: 9, stopOnUnexpected: false, revision: 0, policyRevision: 0, requestId: expect.any(String) });
      expect(posts[2].body).toEqual({ policyId: 'dynamic-policy/91', revision: 0, policyRevision: 1, requestId: expect.any(String) });
      expect(await page.getByRole('button', { name: '重新开始', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('.guide-toggle input').isChecked()).toBe(true);
      expect(await page.getByTestId('capsule-guidance').count()).toBe(0);
      await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
      expect(await page.locator('.inspector [data-offer-index]').count()).toBe(2);
      expect(await page.locator('.inspector [data-offer-index="617"]').isDisabled()).toBe(true);
      expect(await page.locator('.inspector [data-offer-index="903"]').isDisabled()).toBe(true);
      await page.screenshot({ path: 'test-results/policy-ui/running.png' });
      await page.getByRole('button', { name: '停止', exact: true }).click();
      expect(posts).toHaveLength(3);
      releaseStep();
      await page.locator('[data-policy-status="stopped"]').waitFor();
      expect(posts).toHaveLength(4);
      expect(posts[3]).toEqual({ path: '/api/sessions/policy-ui/policy/cancel', body: { policyId: 'dynamic-policy/91', revision: 1, policyRevision: 2, requestId: expect.any(String) } });
      await page.getByRole('button', { name: '行动详情', exact: true }).click();
      expect(await page.locator('.policy-details').innerText()).toContain('实际总耗时 7 局内时间单位');
      expect(await page.locator('.policy-steps').innerText()).toContain('耗时 7 局内时间单位');
      expect(await page.locator('.policy-details').innerText()).not.toContain('秒');
      expect(await page.locator('.policy-details').innerText()).toContain('玩家停止');
      expect(await page.getByRole('button', { name: '继续「谨慎调查者」代行', exact: true }).isEnabled()).toBe(true);
      expect(await page.locator('.policy-details').innerText()).toContain('你设置的上限 9 次');
      expect(await page.locator('.policy-details').innerText()).toContain('意外停点：关闭');
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('button', { name: '人格倾向', exact: true }).click();
      expect(await page.getByRole('spinbutton', { name: '行动上限', exact: true }).inputValue()).toBe('9');
      expect(await page.getByRole('checkbox', { name: '遇到意外时停止', exact: true }).isChecked()).toBe(false);
      await page.getByRole('button', { name: '关闭', exact: true }).click();

      latest = { ...latest, policyRevision: 4, policy: { ...latest.policy!, status: 'running', reason: null, stopDetail: null } };
      await page.reload(); await page.getByRole('button', { name: '继续行动', exact: true }).waitFor();
      expect(posts).toHaveLength(4);
      expect(await page.locator('.policy-progress').innerText()).toContain('行动已中断');
      expect(await page.getByRole('button', { name: '停止', exact: true }).isEnabled()).toBe(true);
      await page.screenshot({ path: 'test-results/policy-ui/interrupted.png' });
      failStep = true;
      await page.getByRole('button', { name: '继续行动', exact: true }).click();
      await page.getByText('结果尚未同步', { exact: true }).waitFor();
      expect(posts).toHaveLength(5);
      await page.getByRole('button', { name: '同步会话', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.spinning'));
      expect(posts).toHaveLength(5);
      expect(await page.locator('.policy-progress').innerText()).toContain('行动已中断');
      await page.getByRole('button', { name: '停止', exact: true }).click();
      await page.locator('[data-policy-status="stopped"]').waitFor();
      expect(posts).toHaveLength(6);
      expect(posts[4].body).toMatchObject({ revision: 1, policyRevision: 4 });
      expect(posts[5].body).toMatchObject({ revision: 1, policyRevision: 4 });
      expect(new Set(posts.map(post => post.body.requestId)).size).toBe(posts.length);
      expect(posts.some(post => post.path.endsWith('/actions') || post.path.endsWith('/restart'))).toBe(false);
      expect(errors).toEqual([]);
    } catch (error) {
      await page.screenshot({ path: 'test-results/policy-ui/failure.png' });
      throw new Error(`${String(error)}\nBrowser errors: ${JSON.stringify(errors)}`);
    } finally { await browser.close(); }
  }, 20_000);

  it('continues after ordinary discovery beyond three steps without selecting a frontend index or treating 64 as a batch target', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    page.setDefaultTimeout(4_000);
    let latest = structuredClone(initial);
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    const readbacks: SessionResponse[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let releaseFourth!: () => void;
    let stepCount = 0;
    await page.route('http://127.0.0.1:8873/**', async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/')) {
        if (path.endsWith('/advice')) { await route.fulfill({json: {}}); return; }
        if (request.method() === 'POST') {
          const body = request.postDataJSON(); posts.push({ path, body });
          if (path.includes('/policy/') && body.policyRevision !== latest.policyRevision) {
            await route.fulfill({ status: 409, json: { error: 'stale policyRevision' } }); return;
          }
          if (path.endsWith('/policy/start')) latest = { ...latest, policyRevision: 1, policy: { ...running, intentId: body.intentId, label: initial.intentOffers![2].label, limit: body.maxActions, stopOnUnexpected: body.stopOnUnexpected } };
          if (path.endsWith('/policy/step')) {
            const ordinal = ++stepCount;
            if (ordinal === 4) await new Promise<void>(resolve => { releaseFourth = resolve; });
            const observation = { id: 'public-discovery', kind: 'floor', label: '通路旁的普通发现', site: 'public_origin', state: 'observed', evidence: 'local_record', facts: [], presence: 'not_confirmed' as const, recordedAt: { time: 7, revision: 1 }, detailRecordedAt: null };
            const step = { entry: ordinal === 1 ? 'observe_routes_adventurer' : 'wait_adventurer', label: ordinal === 1 ? '观察通路' : '当前公开行动', index: ordinal === 1 ? 617 : 903, score: ordinal, reason: `第 ${ordinal} 次公开判断`, beforeRevision: latest.revision, afterRevision: ordinal, beforeSite: "ballroom_entrance", afterSite: "ritual_threshold", beforeTime: latest.frame.time, afterTime: ordinal * 7 };
            latest = { ...latest, revision: ordinal, policyRevision: latest.policyRevision! + 1,
              frame: { ...latest.frame, time: step.afterTime, observations: [observation], feedback: { status: 'published', entry: step.entry, actionLabel: step.label, text: '公开读回', result: { changes: [], laterChanges: [], discoveries: ordinal === 1 ? [{ kind: 'observation', change: 'new', observation }] : [], laterDiscoveries: [] } } },
              policy: { ...latest.policy!, executed: ordinal, steps: [...latest.policy!.steps, step] },
            };
            readbacks.push(structuredClone(latest));
          }
          if (path.endsWith('/policy/cancel')) latest = { ...latest, policyRevision: latest.policyRevision! + 1, policy: { ...latest.policy!, status: 'stopped', reason: '玩家停止', stopDetail: { code: 'player_cancelled', choices: latest.frame.offers.map(({ index, label }) => ({ index, label })) } } };
        }
        await route.fulfill({ json: latest }); return;
      }
      const file = path === '/' ? 'index.html' : path.slice(1);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html';
      try { await route.fulfill({ body: await readFile(resolve(process.cwd(), 'dist', file)), contentType }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    try {
      await page.goto('http://127.0.0.1:8873'); await page.getByTestId('current-scene').waitFor();
      await page.getByRole('button', { name: '人格倾向', exact: true }).click();
      await page.locator('input[value="decisive_explorer"]').check();
      await page.getByRole('button', { name: '按此倾向行动', exact: true }).click();
      await page.locator('[data-policy-status="running"]').waitFor();
      for (let ordinal = 1; ordinal <= 3; ordinal++) {
        await page.clock.fastForward(2500);
        await expect.poll(() => page.locator('.policy-progress').innerText()).toContain(`已执行 ${ordinal} 次`);
      }
      await page.clock.fastForward(2500);
      await expect.poll(() => page.locator('.policy-progress').innerText()).toContain('已执行 3 次');
      await expect.poll(() => stepCount).toBe(4);
      expect(readbacks).toHaveLength(3);
      expect(readbacks[0].frame.feedback!.result!.discoveries).toHaveLength(1);
      expect(readbacks.every(result => result.policy!.status === 'running')).toBe(true);
      expect(await page.locator('.policy-progress').innerText()).toContain('已执行 3 次');
      await page.getByRole('button', { name: '行动详情', exact: true }).click();
      expect(await page.locator('.policy-details').innerText()).toContain('你设置的上限 8 次');
      expect(await page.getByRole('button', { name: '重新开始', exact: true }).isDisabled()).toBe(true);
      await page.getByRole('button', { name: '停止', exact: true }).click();
      releaseFourth(); await page.locator('[data-policy-status="stopped"]').waitFor({state: 'attached'});
      expect(latest.policy!.executed).toBe(4); expect(stepCount).toBe(4);
      expect(await page.locator('.policy-details').innerText()).toContain('最新判断：第 4 次公开判断');
      expect(await page.locator('.policy-details').innerText()).toContain('实际总耗时 28 局内时间单位');
      expect(posts.find(post => post.path.endsWith('/policy/start'))!.body.intentId).toBe('decisive_explorer');
      expect(posts.filter(post => post.path.endsWith('/policy/step')).every(post => !('index' in post.body))).toBe(true);
      expect(posts.at(-1)!.body).toMatchObject({ revision: 4, policyRevision: 5 });
      expect(posts.some(post => post.path.endsWith('/actions'))).toBe(false);
      expect(errors).toEqual([]);
      await page.screenshot({ path: 'test-results/personality-ui/ordinary-discovery-four-steps.png' });
    } catch (error) {
      await page.screenshot({ path: 'test-results/personality-ui/failure.png' });
      throw error;
    } finally { await browser.close(); }
  }, 20_000);
});
