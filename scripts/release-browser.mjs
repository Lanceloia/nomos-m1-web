// Render a saved live session without submitting any further world actions.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = process.env.M1_WEB_URL ?? 'http://127.0.0.1:5173';
const evidence = JSON.parse(await readFile(process.env.M1_EVIDENCE ?? '/tmp/m1-torch-conversation-live.json', 'utf8'));
const output = process.env.M1_SCREENSHOTS ?? '/tmp/m1-desktop-release-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const posts = [], errors = [], screenshots = [];
try {
  const context = await browser.newContext();
  await context.addInitScript(({ id, revision }) => sessionStorage.setItem('m1-tabletop.session.v1',
    JSON.stringify({ id, revision })), { id: evidence.final.sessionId, revision: evidence.final.revision });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto(root);
  await page.getByTestId('current-scene').waitFor();
  await page.getByText('你向对方提议借助永焰离开，并指向门槛。', { exact: true }).first().waitFor();
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const file = `conversation-${width}.png`;
    await page.screenshot({ path: `${output}/${file}` });
    screenshots.push(file);
  }
  assert.deepEqual(posts, []);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/summary.json`, JSON.stringify({ root, screenshots, posts, errors,
    liveSession: evidence.final.sessionId, sourceRevision: evidence.health.engineRevision }, null, 2));
} finally { await browser.close(); }
console.log(JSON.stringify({ output, screenshots }));
