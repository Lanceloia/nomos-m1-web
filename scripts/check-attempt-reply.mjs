import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_TABLETOP_URL ?? 'http://127.0.0.1:5182';
const output = process.env.M1_TABLETOP_EVIDENCE ?? 'test-results/attempt-reply';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const actions = [];

async function choose(frame, entry, destination) {
  if (await page.locator('.scrim').isVisible()) await page.keyboard.press('Escape');
  const offer = frame.offers.find(row => row.entry === entry
    && (!destination || row.destination === destination));
  assert(offer, `Missing current offer: ${entry} / ${destination}`);
  let button = page.locator(`button[data-offer-index="${offer.index}"]`).first();
  if (!await button.isVisible()) {
    await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
    button = page.locator(`.inspector button[data-offer-index="${offer.index}"]`).first();
  }
  const returned = page.waitForResponse(response => response.request().method() === 'POST'
    && response.url().endsWith('/actions'));
  await button.click();
  if (await page.getByTestId('execute').isVisible()) await page.getByTestId('execute').click();
  const response = await returned;
  assert.equal(response.status(), 200);
  const data = await response.json();
  assert.equal(data.frame.feedback.status, 'published');
  await page.waitForFunction(() => !document.querySelector('.spinning'));
  actions.push({ entry, destination, feedback: data.frame.feedback });
  return data.frame;
}

try {
  const opened = page.waitForResponse(response => response.request().method() === 'POST'
    && response.url().endsWith('/api/sessions'));
  await page.goto(url);
  const opening = await (await opened).json();
  await page.getByTestId('current-scene').waitFor();
  if (await page.getByRole('button', { name: '进入舞厅', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '进入舞厅', exact: true }).click();
  }
  let frame = opening.frame;
  frame = await choose(frame, 'cross_ice_adventurer', 'ballroom_chandelier_reach');
  assert.equal(frame.fields.locationId, 'ballroom_chandelier_reach');
  frame = await choose(frame, 'offer_escort_adventurer');
  assert.equal(frame.information.escortReplies.length, 2);
  assert(frame.feedback.result.laterDiscoveries.some(row => row.kind === 'escort_reply'));
  await page.getByRole('button', { name: '查看本次结果', exact: true }).click();
  await page.getByTestId('escort-response').waitFor();
  for (const [width, height] of [[1280, 720], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.locator('[data-reply-discovery]').count() >= 2);
    await page.screenshot({ path: `${output}/heard-replies-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/actual.json`, JSON.stringify({ url, actions, errors,
    replies: frame.information.escortReplies }, null, 2));
  console.log(JSON.stringify({ result: 'passed', realActions: actions.length, screenshots: 2 }));
} finally {
  await browser.close();
}
