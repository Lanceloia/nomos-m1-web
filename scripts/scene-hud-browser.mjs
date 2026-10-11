import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_PLAYER_URL ?? 'http://127.0.0.1:8863';
const output = process.env.M1_PLAYER_EVIDENCE ?? '/tmp/m1-scene-hud-witness';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const posts = [], actions = [], errors = [];
let current;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
page.on('response', async response => {
  if (!response.url().includes('/api/sessions')) return;
  try { const value = await response.json(); if (value.frame) current = value; } catch {}
});

async function screenshot(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const image = document.querySelector('.board-art');
    return image && image.complete && image.naturalWidth > 0;
  });
  const scene = page.getByTestId('current-scene');
  const box = await scene.boundingBox();
  const viewport = page.viewportSize();
  assert(box && box.width >= viewport.width * .6 && box.height >= viewport.height * .55, 'Scene is not the primary surface');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
  const clipped = await page.locator('button:not(.geographic-place)').evaluateAll(nodes => nodes.filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 2).map(node => node.textContent));
  assert.deepEqual(clipped, [], 'Control text overflow');
  const visible = await scene.locator('[data-surface]').count();
  assert.equal(visible, current.frame.information.visibleEntities.length, 'Current entities are not on the primary scene');
  const labelSizes = await scene.locator('.surface-token strong').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
  assert(labelSizes.every(size => size >= 14), 'Primary entity labels remain too small');
  assert.equal(await page.getByTestId('scene-player').locator('img').count(), 0, 'Player still mixes portrait art with icon pieces');
  assert.equal(await page.getByTestId('scene-player').locator('.identity-icon .lucide-user-round').count(), 1);
  assert.equal(await scene.locator('.resource-hud [data-testid="scene-player"]').count(), 1, 'Player identity is outside status HUD');
  assert.equal(await page.getByTestId('scene-stage').locator('[data-testid="scene-player"]').count(), 0);
  const centered = await page.locator('.identity-icon').evaluate(node => {
    const circle = node.getBoundingClientRect(), icon = node.querySelector('svg').getBoundingClientRect();
    return { x: Math.abs(circle.x + circle.width / 2 - icon.x - icon.width / 2), y: Math.abs(circle.y + circle.height / 2 - icon.y - icon.height / 2) };
  });
  assert(centered.x < 1 && centered.y < 1, 'Player icon is not centered');
  assert(await page.locator('.board-art').evaluate(image => image.complete && image.naturalWidth > 0), 'Current room art is missing');
  const dock = await page.locator('.action-dock').boundingBox();
  for (const selector of ['.resource-hud', '.visible-surface']) {
    const item = await page.locator(selector).boundingBox();
    assert(item && dock && item.y + item.height <= dock.y, `${selector} overlaps the action dock`);
  }
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}

async function choose(entry, destination, targetId) {
  const matches = current.frame.offers.filter(offer => offer.entry === entry &&
    (destination === undefined || offer.destination === destination) &&
    (targetId === undefined || offer.targetIds?.includes(targetId)));
  assert.equal(matches.length, 1, `Need one actual offer: ${entry}`);
  const all = page.getByRole('button', { name: '查看全部行动', exact: true });
  if (await all.count()) await all.click();
  const result = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/actions'));
  await page.locator(`[data-offer-index="${matches[0].index}"]`).first().click();
  if (await page.getByTestId('execute').count()) await page.getByTestId('execute').click();
  const response = await result;
  assert.equal(response.status(), 200);
  current = await response.json();
  assert.equal(current.frame.feedback.status, 'published');
  await page.waitForFunction(() => !document.querySelector('.spinning'));
  actions.push({ chosenIndex: matches[0].index, entry, receipt: current });
}

try {
  const health = await (await page.request.get(`${url}/api/health`)).json();
  assert.equal(health.status, 'ready');
  await page.goto(url);
  await page.getByTestId('current-scene').waitFor();
  assert(current);
  assert.equal((await page.request.get(`${url}/assets/palace-geographic-v3.png`)).status(), 200);
  for (const [width, height] of [[1024, 576], [1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await screenshot(`opening-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const beforeMap = posts.length;
  await page.getByRole('button', { name: '已知地图', exact: true }).click();
  await page.getByRole('dialog').getByTestId('geographic-map').waitFor();
  await page.screenshot({ path: `${output}/expanded-geography.png`, fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(posts.length, beforeMap, 'Expanding the map executed an Action');
  const mini = page.getByTestId('geographic-map').first();
  assert(await mini.locator('[data-map-connection]').count() > 0, 'Known map routes are missing');
  const arrows = await mini.locator('[data-map-arrow]').evaluateAll(nodes => nodes.map(node => {
    const point = node.ownerSVGElement.createSVGPoint();
    point.x = node.x2.baseVal.value; point.y = node.y2.baseVal.value;
    const screen = point.matrixTransform(node.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }));
  const oneWay = await mini.locator('[data-map-connection]:not([data-map-directions="both"])').count();
  assert.equal(arrows.length, oneWay, 'Only single-direction routes should have arrows');
  for (const arrow of arrows) {
    assert(await page.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('.geographic-place'), arrow), 'Route arrow is hidden by a map pin');
  }
  const pin = mini.locator('.geographic-place:not(.here)').first();
  const resting = await pin.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderColor }));
  await pin.hover();
  const hovering = await pin.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderColor, opacity: getComputedStyle(node).opacity }));
  assert.equal(hovering.background, resting.background, 'Hover changed the map pin fill');
  assert.equal(hovering.opacity, '1', 'Hover made the map pin transparent');
  assert.notEqual(hovering.border, resting.border, 'Map pin has no visible hover feedback');
  await page.screenshot({ path: `${output}/map-pin-hover.png`, fullPage: true });
  await mini.locator('[data-map-site="ritual_ring"]').click();
  assert.equal(posts.length, beforeMap, 'Map selection executed an Action');
  await choose('cross_ice_adventurer', 'ritual_passage_entry');
  await choose('move_adventurer', 'ritual_threshold');
  await choose('move_adventurer', 'ritual_ring');
  const scene = page.getByTestId('current-scene');
  const target = current.frame.information.visibleEntities.find(entity => entity.kind === 'person');
  assert(target);
  const beforeTarget = posts.length;
  await scene.locator(`[data-surface="${target.id}"]`).click();
  assert.equal(posts.length, beforeTarget, 'Inspecting a surface executed an Action');
  for (const [width, height] of [[1024, 576], [1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await screenshot(`ritual-entities-${width}`);
  }
  await choose('carry_from_ritual_adventurer');
  assert.equal(current.frame.information.ritual.phase, 'disrupted');
  assert.equal(posts.filter(path => path.endsWith('/actions')).length, actions.length);
  const beforeRefresh = posts.length;
  await page.reload();
  await page.getByTestId('current-scene').waitFor();
  assert.equal(posts.length, beforeRefresh, 'Refresh replayed an Action');
  const finalHealth = await (await page.request.get(`${url}/api/health`)).json();
  assert.equal(finalHealth.compileCount, health.compileCount);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/evidence.json`, JSON.stringify({ url, result: 'passed', health, realActions: actions.length, actions, posts, errors }, null, 2));
  console.log(JSON.stringify({ result: 'passed', realActions: actions.length, output }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), current, actions, posts, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
