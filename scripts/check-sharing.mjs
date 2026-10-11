import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const state = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(state.status, 'ready');
const output = process.env.M1_SHARE_EVIDENCE ?? 'test-results/family-share';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const evidence = { origin: state.origin, realActions: 0, independentSessions: false, fragmentRemoved: false };

async function enter(context) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const created = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/sessions', { timeout: 90000 });
  await page.goto(state.invitationURL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const response = await created;
  assert.equal(response.status(), 201);
  const session = await response.json();
  await page.getByTestId('current-scene').waitFor({ timeout: 45000 });
  if (await page.getByRole('button', { name: '进入舞厅', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '进入舞厅', exact: true }).click();
  }
  assert.equal(new URL(page.url()).hash, '');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  return { page, session };
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const { page, session } = await enter(context);
  evidence.fragmentRemoved = true;
  const cookie = (await context.cookies()).find(row => row.name === '__Host-m1_invite');
  assert(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
  await page.screenshot({ path: `${output}/public-mobile-opening.png`, fullPage: true });
  const all = page.getByRole('button', { name: '查看全部行动', exact: true });
  await all.click();
  const result = page.waitForResponse(response => response.request().method() === 'POST'
    && response.url().endsWith('/actions'), { timeout: 90000 });
  await page.locator('.inspector [data-offer="observe_floor_adventurer"]').first().click();
  if (await page.getByTestId('execute').isVisible()) await page.getByTestId('execute').click();
  const published = await (await result).json();
  assert.equal(published.frame.feedback.status, 'published');
  assert(published.revision > session.revision);
  evidence.realActions = 1;
  evidence.action = { entry: 'observe_floor_adventurer', time: published.frame.time, revision: published.revision };
  await page.waitForFunction(() => !document.querySelector('.spinning'));
  await page.screenshot({ path: `${output}/public-mobile-result.png`, fullPage: true });
  const second = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  const other = await enter(second);
  assert.notEqual(other.session.sessionId, session.sessionId);
  assert.equal(other.session.revision, session.revision);
  const unchanged = await (await context.request.get(`${state.origin}/api/sessions/${session.sessionId}`)).json();
  assert.equal(unchanged.revision, published.revision);
  evidence.independentSessions = true;
  const guest = await browser.newContext();
  assert.equal((await guest.request.post(`${state.origin}/api/sessions`, {
    headers: { Origin: state.origin }, data: { requestId: 'guest' },
  })).status(), 401);
  assert.equal((await context.request.post(`${state.origin}/api/sessions`, {
    headers: { Origin: 'https://elsewhere.example' }, data: { requestId: 'other-origin' },
  })).status(), 403);
  const health = await (await context.request.get(`${state.origin}/api/health`)).json();
  assert.equal(health.status, 'ready');
  assert.equal(health.compileCount, 1);
  assert.deepEqual(Object.keys(health).sort(), ['compileCount', 'engine', 'ok', 'status']);
  assert.deepEqual(errors, []);
  evidence.status = 'passed';
  await writeFile(`${output}/summary.json`, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
