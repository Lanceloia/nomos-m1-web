import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.env.M1_FAMILY_URL ?? 'http://127.0.0.1:5193';
const baseline = process.env.M1_FAMILY_BASELINE ?? 'http://127.0.0.1:5182';
const output = resolve(process.env.M1_FAMILY_EVIDENCE ?? 'docs/family-mobile/evidence');
const ledgerPath = `${output}/action-ledger.json`;
await mkdir(output, { recursive: true });
let ledger;
try { ledger = JSON.parse(await readFile(ledgerPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const reuse = process.argv.includes('--reuse');
assert(!ledger || reuse, 'Existing action ledger: pass --reuse; never silently repeat real actions.');
assert(!reuse || ledger?.handle, '--reuse requires a saved real session.');
const evidence = { root, baseline, reuse, checks: [], screenshots: [], requests: [], errors: [], views: [] };
const health = await (await fetch(`${root}/api/health`)).json();
assert.equal(health.status, 'ready');
evidence.engineRevision = health.engineRevision;
const browser = await chromium.launch({ headless: true });

function check(name, condition, detail) {
  evidence.checks.push({ name, passed: Boolean(condition), detail });
}

async function capture(page, name, fullPage = false) {
  const path = `${name}.png`;
  await page.screenshot({ path: `${output}/${path}`, fullPage });
  evidence.screenshots.push(path);
}

async function activate(page, locator, mobile) {
  await locator.scrollIntoViewIfNeeded();
  if (mobile) await locator.tap();
  else await locator.click();
}

async function openPage(url, width, height, mobile, handle) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile,
    deviceScaleFactor: 1, locale: 'zh-CN' });
  if (handle) await context.addInitScript(value => sessionStorage.setItem('m1-tabletop.session.v1', JSON.stringify(value)), handle);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST') evidence.requests.push({ origin: new URL(request.url()).origin, path: new URL(request.url()).pathname });
  });
  await page.goto(url);
  await page.getByTestId('current-scene').waitFor({ timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const image = document.querySelector('.board-art');
    return !image || image.complete && image.naturalWidth > 0;
  });
  await page.locator('.quest-hud [data-testid="personality-guidance"]').waitFor({ timeout: 120_000 });
  if (await page.getByRole('button', { name: '进入舞厅', exact: true }).isVisible()) {
    // The unmodified desktop-only baseline cannot receive a portrait tap.
    if (!(url === baseline && mobile)) await activate(page, page.getByRole('button', { name: '进入舞厅', exact: true }), mobile);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return { context, page };
}

async function audit(page, name, mobile) {
  const layout = await page.evaluate(() => {
    const box = selector => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
    };
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
      && !node.closest('[aria-hidden="true"]');
    const controls = [...document.querySelectorAll('button, summary, .guide-toggle, .policy-settings label')].filter(visible);
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      resource: box('.resource-hud'), heading: box('.scene-heading'), goal: box('.quest-hud'),
      stage: box('.scene-stage'), dock: box('.action-dock'), map: box('.map-hud'), inspector: box('.inspector'),
      sheet: box('.sheet'), sheetBody: box('.sheet-body'),
      smallControls: controls.filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.height < 43.9 || rect.width < 43.9;
      }).map(node => ({ name: node.getAttribute('aria-label') || node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
      clippedControls: controls.filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 2)
        .map(node => node.getAttribute('aria-label') || node.textContent),
      entities: document.querySelectorAll('.surface-token').length,
      recommendation: document.querySelector('.recommended-location, .offer.recommended')?.getAttribute('class'),
      site: document.querySelector('.scene-heading h1')?.textContent,
      goalText: document.querySelector('.quest-hud')?.textContent,
      flame: document.querySelector('[data-testid="flame-value"]')?.textContent,
    };
  });
  evidence.views.push({ name, mobile, layout });
  check(`${name}: no horizontal overflow`, layout.scrollWidth <= page.viewportSize().width && layout.width === page.viewportSize().width, layout.scrollWidth);
  check(`${name}: control text fits`, layout.clippedControls.length === 0, layout.clippedControls);
  if (mobile) check(`${name}: 44px touch targets`, layout.smallControls.length === 0, layout.smallControls);
  if (layout.inspector) check(`${name}: inspector fits`, layout.inspector.y >= 0 && layout.inspector.bottom <= layout.height + 1, layout.inspector);
  if (layout.sheet) check(`${name}: sheet fits`, layout.sheet.x >= 0 && layout.sheet.width <= layout.width && layout.sheet.bottom <= layout.height + 1 && layout.sheetBody.height > 80, layout.sheet);
  return layout;
}

async function panel(page, button, title, name, mobile) {
  await activate(page, page.getByRole('button', { name: button, exact: true }), mobile);
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await audit(page, name, mobile);
  await capture(page, name);
  await activate(page, page.getByRole('button', { name: '关闭', exact: true }), mobile);
}

try {
  const desktopBaselines = new Map();
  for (const [width, height] of [[1280, 720], [1440, 900], [390, 844]]) {
    const { context, page } = await openPage(baseline, width, height, width < 1024);
    const layout = await page.evaluate(() => {
      const selectors = ['.masthead', '.resource-hud', '.scene-content', '.scene-heading', '.scene-stage', '.action-dock', '.map-hud'];
      return { scrollWidth: document.documentElement.scrollWidth, boxes: Object.fromEntries(selectors.map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, [rect.x, rect.y, rect.width, rect.height]];
      })) };
    });
    if (width >= 1024) desktopBaselines.set(width, layout.boxes);
    evidence.views.push({ name: `baseline-${width}x${height}`, layout });
    await capture(page, `baseline-${width}x${height}`);
    await context.close();
  }

  for (const [width, height] of [[1280, 720], [1440, 900], [390, 844], [430, 932], [844, 390]]) {
    const mobile = width < 1024;
    const name = `${width}x${height}`;
    const { context, page } = await openPage(root, width, height, mobile, mobile && ledger?.handle);
    const initial = await audit(page, `scene-${name}`, mobile);
    if (mobile && ledger?.handle) {
      const handle = await page.evaluate(() => JSON.parse(sessionStorage.getItem('m1-tabletop.session.v1')));
      check(`scene-${name}: real session reused`, handle?.id === ledger.handle.id && handle?.revision === ledger.handle.revision, handle);
      check(`scene-${name}: real inspection result retained`, /脚下|冰面/.test(await page.locator('.receipt-brief').innerText()), await page.locator('.receipt-brief').innerText());
    }
    check(`scene-${name}: existing information present`, initial.entities > 0 && initial.site && initial.goalText && initial.flame && initial.recommendation, initial);
    if (!mobile) {
      const actual = await page.evaluate(() => Object.fromEntries(['.masthead', '.resource-hud', '.scene-content', '.scene-heading', '.scene-stage', '.action-dock', '.map-hud'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, [rect.x, rect.y, rect.width, rect.height]];
      })));
      check(`desktop-${name}: unchanged geometry`, JSON.stringify(actual) === JSON.stringify(desktopBaselines.get(width)), { actual, baseline: desktopBaselines.get(width) });
      check(`desktop-${name}: scene not obscured`, initial.stage.height >= 100 && initial.stage.bottom <= initial.dock.y, initial.stage);
    } else {
      check(`scene-${name}: sections do not overlap`, initial.resource.bottom <= initial.heading.y && initial.heading.bottom <= initial.goal.y && initial.goal.bottom <= initial.stage.y && initial.stage.bottom <= initial.dock.y && initial.dock.bottom <= initial.map.y, initial);
    }
    await capture(page, `scene-${name}`);
    if (mobile) await capture(page, `scene-full-${name}`, true);

    await activate(page, page.getByRole('button', { name: '查看全部行动', exact: true }), mobile);
    await page.locator('.inspector .offer').first().waitFor();
    await audit(page, `all-actions-${name}`, mobile);
    await capture(page, `all-actions-${name}`);
    await activate(page, page.locator('.inspector [data-offer="observe_floor_adventurer"]').first(), mobile);
    await page.getByTestId('execute').waitFor();
    await audit(page, `confirm-${name}`, mobile);
    await capture(page, `confirm-${name}`);
    if (width === 390 && !ledger) {
      const handle = await page.evaluate(() => JSON.parse(sessionStorage.getItem('m1-tabletop.session.v1')));
      ledger = { handle, submissions: 0, actions: [] };
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST'
        && /\/api\/sessions\/[^/]+\/actions$/.test(new URL(response.url()).pathname), { timeout: 120_000 });
      ledger.submissions++;
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
      await activate(page, page.getByTestId('execute'), mobile);
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      const value = await response.json();
      assert.equal(value.frame.feedback.status, 'published');
      ledger.actions.push({ entry: value.frame.feedback.entry, revision: value.revision, time: value.frame.time, status: value.frame.feedback.status });
      ledger.handle = { id: value.sessionId, revision: value.revision };
      await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
      await page.locator(`.app[data-session-revision="${value.revision}"]`).waitFor();
      await page.locator('.quest-hud [data-testid="personality-guidance"]').waitFor();
      check('floor inspection: real feedback', /脚下|冰面/.test(await page.locator('.receipt-brief').innerText()), await page.locator('.receipt-brief').innerText());
    }
    if (await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible()) {
      await activate(page, page.getByRole('button', { name: '关闭详情', exact: true }), mobile);
    }
    if (mobile) {
      await panel(page, '查看本次结果', '本次行动与随后变化', `result-${name}`, mobile);
      await panel(page, '已知地图', '已知地图', `map-${name}`, mobile);
      await activate(page, page.getByRole('button', { name: '已知地图', exact: true }), mobile);
      await activate(page, page.locator('.known-place-key button[aria-current="location"]'), mobile);
      await audit(page, `map-selection-${name}`, mobile);
      await activate(page, page.getByRole('button', { name: '关闭详情', exact: true }), mobile);
      await panel(page, '人格倾向', '人格倾向', `personality-${name}`, mobile);
      await panel(page, '目标与结局', '目标与结局', `goal-${name}`, mobile);
      await panel(page, '观察记录', '观察记录', `memory-${name}`, mobile);
      await panel(page, '行动记录', '行动记录', `history-${name}`, mobile);
      // Exercise the original entity entry and secondary map lists without an Action.
      await activate(page, page.locator('.surface-token').first(), mobile);
      await page.locator('.inspector').waitFor();
      await audit(page, `entity-${name}`, mobile);
      await capture(page, `entity-${name}`);
      await activate(page, page.getByRole('button', { name: '关闭详情', exact: true }), mobile);
    }
    await context.close();
  }
  evidence.actionSubmissionsThisRun = evidence.requests.filter(item => /\/actions$/.test(item.path)).length;
  evidence.totalRealActionSubmissions = ledger?.submissions ?? 0;
  evidence.realActions = ledger?.actions ?? [];
  check('bounded real actions', evidence.totalRealActionSubmissions <= 3 && evidence.actionSubmissionsThisRun <= (reuse ? 0 : 1), evidence.totalRealActionSubmissions);
  check('no automation or restart requests', !evidence.requests.some(item => /\/policy\/|\/restart$/.test(item.path)));
  check('no browser errors', evidence.errors.length === 0, evidence.errors);
} catch (error) {
  evidence.errors.push(error.stack ?? error.message);
} finally {
  await browser.close();
  evidence.result = evidence.errors.length === 0 && evidence.checks.every(item => item.passed) ? 'passed' : 'failed';
  await writeFile(`${output}/summary.json`, JSON.stringify(evidence, null, 2));
}
console.log(JSON.stringify({ result: evidence.result, output, checks: evidence.checks.length,
  failed: evidence.checks.filter(item => !item.passed), errors: evidence.errors, realActions: ledger?.submissions ?? 0 }, null, 2));
assert.equal(evidence.result, 'passed');
