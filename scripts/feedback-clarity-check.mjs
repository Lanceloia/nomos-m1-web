import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = process.env.M1_WEB_URL ?? 'http://127.0.0.1:5173';
const output = process.env.M1_CLARITY_EVIDENCE ?? '/tmp/m1-feedback-clarity-live';
const health = await (await fetch(`${root}/api/health`)).json();
assert.equal(health.status, 'ready');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const evidence = { root, engineRevision: health.engineRevision, compileCount: health.compileCount,
  actions: [], screenshots: [], errors: [], stopReason: null };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(root);
  await page.getByTestId('current-scene').waitFor();

  async function act(entry) {
    await page.getByRole('button', { name: '查看全部行动', exact: true }).click();
    const offer = page.locator(`.inspector button[data-offer="${entry}"]`).first();
    await offer.waitFor();
    const receipt = page.waitForResponse(response => response.request().method() === 'POST'
      && /\/api\/sessions\/[^/]+\/actions$/.test(new URL(response.url()).pathname));
    await offer.click();
    if (await page.getByTestId('execute').isVisible()) await page.getByTestId('execute').click();
    const response = await receipt;
    assert.equal(response.status(), 200);
    const body = await response.json();
    assert.equal(body.frame.feedback.status, 'published');
    await page.getByText(`局内时刻 ${body.frame.time}`, { exact: true }).first().waitFor();
    evidence.actions.push({ entry, time: body.frame.time, revision: body.revision,
      changes: body.frame.feedback.result?.changes, summary: await page.locator('.latest-receipt .receipt-brief').innerText() });
    return body;
  }

  await act('observe_floor_adventurer');
  assert.match(evidence.actions.at(-1).summary, /脚下|冰面/);
  assert.match(evidence.actions.at(-1).summary, /有冰/);
  await act('thaw_floor_adventurer');
  assert.match(evidence.actions.at(-1).summary, /永焰 5 → 4/);
  await act('observe_floor_adventurer');
  assert.match(evidence.actions.at(-1).summary, /无冰/);
  if (await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();

  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('.action-dock').evaluate(node => node.scrollHeight <= node.clientHeight + 1));
    const file = `inspection-${width}.png`;
    await page.screenshot({ path: `${output}/${file}` }); evidence.screenshots.push(file);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '人格倾向', exact: true }).click();
  await page.locator('input[value="decisive_explorer"]').check();
  await page.locator('input[name="maxActions"]').fill('1');
  await page.getByRole('button', { name: /按此倾向行动/ }).click();
  await page.locator('[data-policy-status="stopped"]').waitFor({ timeout: 90000 });
  const reason = page.locator('.quest-hud .policy-safety-stop');
  assert.ok((await reason.innerText()).trim());
  evidence.stopReason = await reason.innerText();
  await page.screenshot({ path: `${output}/stop-1280.png` }); evidence.screenshots.push('stop-1280.png');
  const final = await act('observe_floor_adventurer');
  assert.equal(final.policy.executed, 1);
  evidence.delegatedActions = final.policy.executed;
  assert.match(await page.locator('.quest-hud').innerText(), /你已接手/);
  assert.doesNotMatch(await page.locator('.quest-hud').innerText(), /刚刚完成/);
  assert.deepEqual(evidence.errors, []);
  const finalHealth = await (await fetch(`${root}/api/health`)).json();
  assert.equal(finalHealth.compileCount, health.compileCount);
  await writeFile(`${output}/summary.json`, JSON.stringify(evidence, null, 2));
} finally { await browser.close(); }
console.log(JSON.stringify({ output, manualActions: evidence.actions.length, stopReason: evidence.stopReason }));
