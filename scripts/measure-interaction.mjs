import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_TABLETOP_URL ?? 'http://127.0.0.1:5182';
const output = process.env.M1_LATENCY_OUTPUT ?? 'test-results/interaction-latency';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const requests = [];
const starts = new Map();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.url().includes('/api/')) starts.set(request, performance.now());
});
page.on('requestfinished', request => {
  if (!starts.has(request)) return;
  requests.push({ path: new URL(request.url()).pathname,
    wallMs: performance.now() - starts.get(request), timing: request.timing() });
});

async function settle(revision) {
  await page.waitForFunction(revision =>
    document.querySelector('.app')?.dataset.sessionRevision === String(revision)
    && !document.querySelector('.spinning'), revision);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

try {
  const opened = page.waitForResponse(response => response.request().method() === 'POST'
    && response.url().endsWith('/api/sessions'));
  const cold = performance.now();
  await page.goto(url);
  let frame = (await (await opened).json()).frame;
  await page.getByTestId('current-scene').waitFor();
  if (await page.getByRole('button', { name: '进入舞厅', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '进入舞厅', exact: true }).click();
  }
  const openMs = performance.now() - cold;
  const actions = [];
  for (const [entry, destination] of [
    ['observe_floor_adventurer', null],
    ['cross_ice_adventurer', 'ballroom_chandelier_reach'],
    ['offer_escort_adventurer', null],
  ]) {
    // Wait for the ordinary recommended-action refresh, without changing its content.
    await page.waitForTimeout(500);
    const offer = frame.offers.find(row => row.entry === entry
      && (!destination || row.destination === destination));
    assert(offer, `Missing public offer: ${entry}`);
    if (await page.locator('.scrim').isVisible()) await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
    const button = page.locator(`.inspector button[data-offer-index="${offer.index}"]`);
    await button.click();
    const execute = page.getByTestId('execute');
    assert(await execute.isVisible());
    await execute.scrollIntoViewIfNeeded();
    await execute.click({ trial: true });
    await execute.evaluate(button => {
      window.m1LatencyClickAt = null;
      button.addEventListener('click', () => {
        window.m1LatencyClickAt = performance.now();
      }, { once: true, capture: true });
    });
    const returned = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith('/actions'));
    const started = performance.now();
    await execute.click();
    const response = await returned;
    const responseMs = performance.now() - started;
    const data = await response.json();
    frame = data.frame;
    assert.equal(frame.feedback.status, 'published');
    await settle(data.revision);
    const renderedMs = performance.now() - started;
    const browserTiming = await page.evaluate(actionUrl => {
      const resource = performance.getEntriesByName(actionUrl).at(-1);
      if (!resource || window.m1LatencyClickAt == null) throw new Error('Missing browser timing');
      return { browserClickToResponseMs: resource.responseEnd - window.m1LatencyClickAt,
        browserClickToRenderedFrameMs: performance.now() - window.m1LatencyClickAt };
    }, response.url());
    // RAF and revision prove a rendered-frame observation, not physical display scanout.
    actions.push({ entry, destination, automationClickToResponseMs: responseMs,
      automationClickToRenderedFrameMs: renderedMs, ...browserTiming, revision: data.revision,
      time: frame.time, status: frame.feedback.status,
      replies: frame.information.escortReplies.length });
  }
  await page.waitForTimeout(500);
  assert.deepEqual(errors, []);
  const health = await (await page.request.get(`${url}/api/health`)).json();
  const result = { url, engineRevision: health.engineRevision, openMs, actions, requests, errors };
  await writeFile(`${output}/actual.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, openMs, actions, requests }));
} finally {
  await browser.close();
}
