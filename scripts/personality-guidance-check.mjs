import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = process.env.M1_WEB_URL ?? 'http://127.0.0.1:5173';
const output = process.env.M1_ADVICE_EVIDENCE ?? '/tmp/m1-personality-guidance-live';
const health = await (await fetch(`${root}/api/health`)).json();
assert.equal(health.status, 'ready');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const evidence = { root, engineRevision: health.engineRevision, compileCount: health.compileCount,
  advice: [], actions: [], errors: [], screenshots: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  let latest, lastAdvice;
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('response', async response => {
    const path = new URL(response.url()).pathname;
    if (!response.ok() || !path.startsWith('/api/sessions')) return;
    const body = await response.json();
    if (path.endsWith('/advice')) {
      lastAdvice = body;
      evidence.advice.push(body);
    } else if (body.frame) latest = body;
  });
  await page.goto(root);
  await page.getByTestId('personality-guidance').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-session-revision]')?.getAttribute('data-session-revision') === '0');
  assert.equal(latest.revision, 0);
  assert.equal(lastAdvice.intentId, 'helpful_rescuer');
  const openingChoice = lastAdvice.choice;

  async function choosePersonality(id) {
    await page.getByRole('button', { name: '人格倾向', exact: true }).click();
    const returned = page.waitForResponse(r => r.ok() && new URL(r.url()).pathname.endsWith('/advice')
      && r.request().postDataJSON().intentId === id);
    await page.locator(`input[value="${id}"]`).check();
    const advice = await (await returned).json();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    return advice;
  }

  const decisive = await choosePersonality('decisive_explorer');
  assert.equal(latest.revision, 0, 'Selecting a personality must not execute an Action');
  assert.notEqual(decisive.choice.index, openingChoice.index);
  await choosePersonality('cautious_investigator');

  async function manual(entry, expectedIndex) {
    const nextRevision = latest.revision + 1;
    await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
    const offer = expectedIndex === undefined ? page.locator(`.inspector button[data-offer="${entry}"]`).first()
      : page.locator(`.inspector button[data-offer-index="${expectedIndex}"][data-recommended="true"]`);
    await offer.waitFor();
    const returned = page.waitForResponse(r => r.request().method() === 'POST'
      && /\/api\/sessions\/[^/]+\/actions$/.test(new URL(r.url()).pathname));
    const advised = page.waitForResponse(r => r.ok() && new URL(r.url()).pathname.endsWith('/advice')
      && r.request().postDataJSON().revision === nextRevision);
    await offer.click();
    if (await page.getByTestId('execute').isVisible()) await page.getByTestId('execute').click();
    const body = await (await returned).json();
    assert.equal(body.frame.feedback.status, 'published');
    const advice = await (await advised).json();
    evidence.actions.push({ mode: 'manual', entry: body.frame.feedback.entry, revision: body.revision, time: body.frame.time });
    return advice;
  }

  // The original capsule starts by crossing ice, not by manually checking this floor.
  const deviated = await manual('observe_floor_adventurer');
  assert.equal(deviated.revision, 1);
  assert.ok(deviated.choice, 'Manual deviation must still produce a current recommendation');
  assert.notEqual(deviated.choice.entry, 'observe_floor_adventurer');
  await manual(deviated.choice.entry, deviated.choice.index);
  const closeDetails = page.getByRole('button', { name: '关闭详情', exact: true });
  if (await closeDetails.isVisible()) await closeDetails.click();
  await page.getByTestId('personality-guidance').waitFor();
  await page.screenshot({ path: `${output}/deviation-1280.png` });
  evidence.screenshots.push('deviation-1280.png');

  // Turning the display off is not an Action, and turning it on recomputes advice.
  const revision = latest.revision;
  await page.getByRole('checkbox', { name: '人格引导', exact: true }).uncheck();
  assert.equal(await page.locator('[data-recommended="true"]').count(), 0);
  const enabled = page.waitForResponse(r => r.ok() && new URL(r.url()).pathname.endsWith('/advice'));
  await page.getByRole('checkbox', { name: '人格引导', exact: true }).check();
  await enabled;
  assert.equal(latest.revision, revision);

  await page.getByRole('button', { name: '人格倾向', exact: true }).click();
  await page.locator('input[value="decisive_explorer"]').check();
  await page.locator('input[name="maxActions"]').fill('1');
  const stoppedAdvice = page.waitForResponse(r => r.ok() && new URL(r.url()).pathname.endsWith('/advice')
    && r.request().postDataJSON().revision > revision);
  await page.getByRole('button', { name: /按此倾向行动/ }).click();
  await page.locator('[data-policy-status="stopped"]').waitFor({ timeout: 90000 });
  await stoppedAdvice;
  assert.equal(latest.policy.executed, 1);
  assert.equal(lastAdvice.intentId, 'decisive_explorer');
  assert.ok(lastAdvice.choice, 'Stopped delegation must return a manual highlight');
  evidence.actions.push({ mode: 'delegated', entry: latest.policy.steps[0].entry,
    revision: latest.revision, time: latest.frame.time });
  await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
  const highlighted = page.locator(`.inspector [data-recommended="true"][data-offer-index="${lastAdvice.choice.index}"]`);
  await highlighted.waitFor();
  await highlighted.scrollIntoViewIfNeeded();
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const file = `stopped-highlight-${width}.png`;
    await page.screenshot({ path: `${output}/${file}` });
    evidence.screenshots.push(file);
  }
  assert.equal((await (await fetch(`${root}/api/health`)).json()).compileCount, health.compileCount);
  assert.deepEqual(evidence.errors, []);
  await writeFile(`${output}/summary.json`, JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
console.log(JSON.stringify({ output, actions: evidence.actions.length, advice: evidence.advice.length }));
