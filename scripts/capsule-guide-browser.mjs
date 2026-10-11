import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_PLAYER_URL ?? 'http://127.0.0.1:8864';
const output = process.env.M1_GUIDE_EVIDENCE ?? '/tmp/m1-capsule-guide-v1';
const limit = Number(process.env.M1_GUIDE_LIMIT ?? 65);
assert(Number.isInteger(limit) && limit > 0 && limit <= 65);
const short = limit < 65;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120_000);
const actions = [], posts = [], errors = [], layouts = [];
let current;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
page.on('response', async response => {
  if (!response.url().includes('/api/sessions')) return;
  try { const body = await response.json(); if (body.frame) current = body; } catch {}
});

async function settled() {
  await page.waitForFunction(revision => Number(document.querySelector('.app')?.dataset.sessionRevision) === revision &&
    !document.querySelector('.spinning'), current.revision);
}

async function screenshot(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => { const image = document.querySelector('.board-art'); return image?.complete && image.naturalWidth > 0; });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
  const clipped = await page.locator('button:not(.geographic-place)').evaluateAll(nodes => nodes.filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 2).map(node => node.textContent));
  assert.deepEqual(clipped, [], 'Button text overflow');
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}

async function nativeRecommendedOffer() {
  const existing = page.locator('.offer-list button[data-recommended="true"]');
  if (await existing.count() === 1) return existing;
  const target = page.locator('.surface-token.recommended-location');
  const feature = page.locator('.action-tools [data-feature].recommended-location');
  const destination = page.locator('.destination-toggle.recommended-location');
  if (await target.count() === 1) await target.click();
  else if (await feature.count() === 1) await feature.click();
  else if (await destination.count() === 1) {
    await destination.click();
    const route = page.locator('.adjacent-route.recommended-location');
    assert.equal(await route.count(), 1, 'No unique native destination entry');
    await route.click();
  } else await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
  assert.equal(await existing.count(), 1, 'No unique recommended Action in its native context');
  return existing;
}

try {
  const health = await (await page.request.get(`${url}/api/health`)).json();
  assert.equal(health.status, 'ready');
  assert.equal(health.worldSourceRevision, 'd56b070ab8119fafcb108756464ca6985b5b128d');
  await page.goto(url);
  await page.getByTestId('current-scene').waitFor();
  await settled();
  for (const [width, height] of [[1024, 576], [1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await screenshot(`opening-${width}`);
    assert.equal(await page.locator('.quick-actions button[data-recommended="true"]').count(), 0);
    assert(await page.locator('.recommended-location').count() > 0, 'No native entry highlighted');
    layouts.push({ width, height });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const beforePassive = posts.length;
  await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
  assert.equal(await page.locator('.offer-list [data-offer-index]').count(), current.frame.offers.length);
  const highlightedIndex = Number(await page.locator('.offer-list [data-recommended="true"]').getAttribute('data-offer-index'));
  assert(current.frame.offers.some(offer => offer.index === highlightedIndex));
  await screenshot('all-actions');
  await page.getByLabel('引导路线', { exact: true }).uncheck();
  assert.equal(await page.locator('[data-recommended="true"]').count(), 0);
  assert.equal(await page.locator('.offer-list [data-offer-index]').count(), current.frame.offers.length);
  await page.getByLabel('引导路线', { exact: true }).check();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.reload();
  await page.getByTestId('current-scene').waitFor();
  await settled();
  assert.equal(posts.length, beforePassive, 'Passive UI controls submitted an Action');

  for (let count = 0; count < limit && !current.frame.ending; count++) {
    const beforeNavigation = posts.length;
    const recommended = await nativeRecommendedOffer();
    assert.equal(posts.length, beforeNavigation, 'Opening a native context executed an Action');
    assert.equal(await recommended.count(), 1, `No unique recommendation at step ${count + 1}`);
    const index = Number(await recommended.getAttribute('data-offer-index'));
    const choice = current.frame.offers.find(offer => offer.index === index);
    assert(choice, 'Highlighted offer is not in the actual latest menu');
    const previous = current;
    const stage = await page.getByTestId('capsule-guidance').innerText();
    const result = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/actions'));
    const beforeSelection = posts.length;
    await recommended.click();
    const confirmation = page.getByTestId('execute');
    await confirmation.waitFor({ state: 'visible' });
    assert.equal(posts.length, beforeSelection, 'Recommended selection executed before confirmation');
    assert.equal(await page.locator('.offer-list [data-offer-index]').count(), 0, 'Confirmation mixes unrelated options');
    await confirmation.click();
    const response = await result;
    assert.equal(response.status(), 200);
    const request = response.request().postDataJSON();
    assert.equal(request.index, index);
    assert.equal(request.revision, previous.revision);
    current = await response.json();
    assert.equal(current.frame.feedback.status, 'published');
    await settled();
    actions.push({ number: count + 1, stage, offer: choice, beforeRevision: previous.revision,
      afterRevision: current.revision, time: current.frame.time, site: current.frame.scene.playerSite,
      feedback: current.frame.feedback, visibleEntities: current.frame.information.visibleEntities });
    console.log(`${count + 1}: ${choice.entry} -> ${current.frame.scene.playerSite}`);
    if ([4, 14, 21, 35].includes(count + 1) || current.frame.ending) await screenshot(`step-${count + 1}`);
    if (count === 3) {
      const actionPosts = posts.length;
      await page.reload();
      await page.getByTestId('current-scene').waitFor();
      await settled();
      assert.equal(posts.length, actionPosts, 'Mid-route refresh replayed an Action');
      assert(await page.locator('.recommended-location').count() > 0, 'Refresh lost native guidance');
    }
  }
  if (!short) assert.equal(current.frame.ending?.id, 'departed_palace');
  assert.equal(posts.filter(path => path.endsWith('/actions')).length, actions.length);
  assert.deepEqual(errors, []);
  const finalHealth = await (await page.request.get(`${url}/api/health`)).json();
  assert.equal(finalHealth.compileCount, health.compileCount);
  const result = short ? 'passed-short' : 'passed';
  await writeFile(`${output}/evidence.json`, JSON.stringify({ result, url, health,
    realActions: actions.length, layouts, actions, posts, errors, ending: current.frame.ending,
    finalInformation: current.frame.information, note: 'One deterministic guided browser route, not a cold-player score or all-region walkthrough.' }, null, 2));
  console.log(JSON.stringify({ result, realActions: actions.length, output }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), current, actions, posts, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
