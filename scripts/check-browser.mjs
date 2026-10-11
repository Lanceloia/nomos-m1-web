import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_TABLETOP_URL ?? 'http://127.0.0.1:8852';
const output = process.env.M1_TABLETOP_EVIDENCE ?? 'test-results/tabletop';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
const posts = [];
const actions = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST') posts.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() }); });

async function screenshot(name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
  const scene = await page.getByTestId('current-scene').boundingBox();
  assert(scene && scene.width >= page.viewportSize().width * .6 && scene.height >= page.viewportSize().height * .55, 'scene is not the primary surface');
  assert.equal(await page.getByTestId('current-scene').locator('[data-object]').count(), 0, 'history leaked into the current scene');
  assert.equal(await page.getByTestId('scene-player').locator('button').count(), 0, 'player is a fake selectable object');
  const clipped = await page.locator('.memory-token, .surface-token, .offer, .quick-actions button').evaluateAll(nodes => nodes.filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
  assert.deepEqual(clipped, [], 'text overflows a control');
  for (const locator of [page.getByTestId('scene-stage'), page.getByTestId('next-step-guidance').first(), page.locator('.action-dock')]) {
    const box = await locator.boundingBox();
    assert(box && box.y >= 0 && box.y + box.height <= page.viewportSize().height, 'scene, task or action dock outside the first viewport');
  }
  const sizes = await page.locator('.surface-token strong').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
  assert(sizes.every(size => size >= 14), 'current entity labels are too small');
  const pipCounts = await page.getByTestId('charge-pips').evaluate(node => ({ filled: node.querySelectorAll('[data-filled="true"]').length, filledColor: getComputedStyle(node.querySelector('[data-filled="true"]') ?? node).backgroundColor, emptyColor: getComputedStyle(node.querySelector('[data-filled="false"]') ?? node).backgroundColor }));
  const charge = Number((await page.getByTestId('flame-value').innerText()).match(/\d+/)?.[0]);
  assert.equal(pipCounts.filled, charge, 'pips contradict known charge');
  if (charge < 5) assert.notEqual(pipCounts.filledColor, pipCounts.emptyColor, 'filled and empty charge slots have the same color');
}

async function choose(entry) {
  if (!await page.locator(`.inspector button[data-offer="${entry}"]`).count()) await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/actions'));
  await page.locator(`.inspector button[data-offer="${entry}"]`).first().click();
  if (await page.getByTestId('execute').count()) await page.getByTestId('execute').click();
  const result = await response;
  assert.equal(result.status(), 200);
  const data = await result.json();
  assert.equal(data.frame.feedback.status, 'published');
  await page.waitForFunction(() => !document.querySelector('.spinning'));
  actions.push({ entry, revision: data.revision, frame: data.frame });
  return data;
}

try {
  const health = await (await page.request.get(`${url}/api/health`)).json();
  assert.equal(health.status, 'ready');
  await page.goto(url);
  await page.getByTestId('current-scene').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(posts.length, 1);
  const image = await page.evaluate(() => new Promise(resolve => { const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = () => resolve([0, 0]); image.src = '/assets/scene-ballroom-v3.png'; }));
  assert(image[0] > 500 && image[1] > 500, 'board art not loaded');
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await screenshot(`opening-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '已知地图', exact: true }).click();
  await page.keyboard.press('Escape');
  assert(await page.getByRole('button', { name: '已知地图', exact: true }).evaluate(el => el === document.activeElement));
  await page.getByRole('button', { name: '已知地图', exact: true }).click();
  await page.locator('.sheet [data-map-site="ballroom_chandelier_reach"]').click();
  await page.locator('.inspector [data-offer="cross_ice_adventurer"]').hover();
  assert.equal(posts.length, 1, 'map selection or hover submitted prematurely');
  await screenshot('crossing-preview');
  const crossing = await choose('cross_ice_adventurer');
  assert.equal(crossing.frame.scene.playerSite, 'ballroom_chandelier_reach', 'seeded short route did not reach chandelier; inspect real result');
  await screenshot('actual-arrival');
  const fixture = crossing.frame.information.visibleEntities.find(row => row.kind === 'chandelier');
  assert(fixture, 'No current authored chandelier surface');
  await page.locator(`[data-surface="${fixture.id}"]`).click();
  assert.equal(posts.filter(p => p.path.endsWith('/actions')).length, 1, 'object selection executed an action');
  const observed = await choose('observe_chandelier_adventurer');
  assert(observed.frame.fields.chandelierClue);
  assert.equal(await page.locator('[data-feature="voices"]').count(), observed.frame.offers.some(offer => offer.entry === 'offer_escort_adventurer') ? 1 : 0, 'escort affordance must come from the offer, not clue parsing');
  assert(Array.isArray(observed.frame.information.visibleEntities));
  assert(Array.isArray(observed.frame.information.movements));
  assert.equal(await page.locator('[data-surface]').count(), observed.frame.information.visibility === 'provided' ? observed.frame.information.visibleEntities.length : 0);
  await page.getByRole('button', { name: '观察记录', exact: true }).click();
  assert.equal(await page.locator('.historical-memory [data-object]').count(), observed.frame.observations.length);
  assert.equal(await page.locator('.movement-readbacks [data-movement]').count(), observed.frame.information.movements.length);
  assert(['provided', 'unavailable'].includes(observed.frame.information.visibility), 'formal service lacks the new surface producer');
  assert.equal(await page.locator('.clue').count(), 1);
  assert(!/[A-Za-z]/.test(await page.locator('.clue').innerText()), 'chandelier clue not fully translated');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '行动记录', exact: true }).click();
  const escortRecord = page.locator('[data-testid="escort-response"]');
  await escortRecord.locator('summary').click();
  const escortText = await escortRecord.innerText();
  assert(escortText.includes(observed.frame.information.escortResponse.label), 'public escort status missing');
  if (observed.frame.information.escortResponse.status === 'movement_observed') assert(escortText.includes('不表示因邀请而移动'), 'movement was presented as acceptance');
  await escortRecord.locator('summary').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('execute').count(), 0, 'observation added a redundant execute step');
  await page.locator(`[data-surface="${fixture.id}"]`).click();
  await screenshot('actual-chandelier-observation');
  const detached = await choose('detach_reservoir_adventurer');
  assert.equal(detached.frame.fields.carriedReservoirCharges, 2);
  const reservoir = detached.frame.information.visibleEntities.find(row => row.kind === 'reservoir');
  assert(reservoir);
  assert.equal(await page.locator(`[data-surface="${reservoir.id}"]`).count(), 1);
  assert.equal(await page.locator('[data-offer="detach_reservoir_adventurer"]').count(), 0);
  assert.equal(await page.getByTestId('reservoir-value').innerText(), '2 点');
  await page.getByRole('button', { name: '观察记录', exact: true }).click();
  await page.locator('.historical-memory summary').click();
  for (const item of observed.frame.observations) assert(await page.locator('.historical-memory').innerText().then(value => value.includes('时刻 ' + item.recordedAt.time)), 'historical readback time missing');
  await page.locator('.historical-memory summary').click();
  await page.keyboard.press('Escape');
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await screenshot(`after-actions-${width}`);
  }
  const count = posts.length;
  await page.reload();
  await page.getByTestId('current-scene').waitFor();
  assert.equal(posts.length, count, 'reload created a second session or replayed an action');
  assert.equal(await page.getByTestId('reservoir-value').innerText(), '2 点');
  assert.deepEqual(errors, []);
  const finalHealth = await (await page.request.get(`${url}/api/health`)).json();
  assert.equal(finalHealth.compileCount, health.compileCount, 'prototype caused recompilation');
  await writeFile(`${output}/actual.json`, JSON.stringify({ url, backend: { engineRevision: health.engineRevision, compileCount: health.compileCount }, actions, posts, errors, screenshots: 9, reloadReadOnly: true }, null, 2));
  console.log(JSON.stringify({ result: 'passed', realActions: actions.length, sessionCreates: posts.filter(p => p.path === '/api/sessions').length, screenshots: 9, output }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), posts, actions, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
