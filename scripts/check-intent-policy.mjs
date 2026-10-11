import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_TABLETOP_URL ?? 'http://127.0.0.1:8873';
const output = process.env.M1_POLICY_BROWSER_EVIDENCE ?? 'test-results/personality-real';
const profileId = process.env.M1_PERSONALITY_ID ?? 'cautious_investigator';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const posts = [], errors = [], realSteps = [];
let releaseFourth;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.method() === 'POST') posts.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
});
async function shot(name) {
  await page.screenshot({ path: `${output}/${name}.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
  const clipped = await page.locator('.intent-choice, .execute, .policy-readback, .policy-commands button').evaluateAll(nodes => nodes.filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
  assert.deepEqual(clipped, [], 'personality text overflows a control');
}
try {
  await page.goto(url);
  await page.getByTestId('current-scene').waitFor();
  const handle = JSON.parse(await page.evaluate(() => sessionStorage.getItem('m1-tabletop.session.v1')));
  const initial = await (await page.request.get(`${url}/api/sessions/${handle.id}`)).json();
  assert.deepEqual(initial.intentOffers.map(offer => offer.id).sort(), ['cautious_investigator', 'decisive_explorer', 'helpful_rescuer']);
  const profile = initial.intentOffers.find(offer => offer.id === profileId);
  assert.ok(profile, 'requested personality is not supplied by the backend');
  assert.equal(profile.maxActions, 24);
  assert.ok(initial.intentOffers.every(offer => !('targetSite' in offer)), 'personality still contains a destination goal');
  await page.getByRole('button', { name: '人格倾向', exact: true }).click();
  const consent = await page.locator('.intent-choices').innerText();
  assert.ok(consent.includes(profile.description));
  assert.ok(consent.includes('安全上限：24 次行动') && consent.includes('行动会耗去局内时间') && consent.includes('你可以随时停止'));
  assert.ok(consent.includes('消耗永焰后至少保留 2 点') && consent.includes('按作者评价与人格偏好行动'));
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await shot(`personality-options-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(`input[value="${profile.id}"]`).check();

  // Hold the fourth real receipt so Stop is exercised before another step can start.
  let fourthReady, fourthFailed;
  const fourthCommitted = new Promise((resolve, reject) => { fourthReady = resolve; fourthFailed = reject; });
  void fourthCommitted.catch(() => {});
  await page.route('**/policy/step', async route => {
    try {
      assert.ok(realSteps.length < 4, 'more than four real steps were requested');
      const upstream = await route.fetch();
      assert.equal(upstream.status(), 200);
      const value = await upstream.json(); realSteps.push(value);
      if (realSteps.length === 4) {
        const released = new Promise(resolve => { releaseFourth = resolve; });
        fourthReady(value);
        await released;
      }
      await route.fulfill({ response: upstream });
    } catch (error) { fourthFailed(error); await route.abort('failed'); }
  });
  const startedResponse = page.waitForResponse(response => response.url().endsWith('/policy/start'));
  await page.getByRole('button', { name: '按此倾向行动', exact: true }).click();
  const started = await (await startedResponse).json();
  assert.equal(started.revision, initial.revision, 'approval attempted a world action');
  assert.equal(started.policy.status, 'running');
  assert.equal(started.policy.limit, 24);
  assert.equal(started.policy.executed, 0);
  const timeoutSignal = AbortSignal.timeout(30_000);
  const fourth = await Promise.race([fourthCommitted, new Promise((_, reject) => timeoutSignal.addEventListener('abort', () => reject(new Error('personality did not continue to a fourth real step')), { once: true }))]);
  const cancelResponse = page.waitForResponse(response => response.url().endsWith('/policy/cancel'));
  await page.getByRole('button', { name: '停止', exact: true }).click();
  assert.equal(posts.filter(row => row.path.endsWith('/policy/cancel')).length, 0, 'cancel did not wait for the in-flight receipt');
  releaseFourth(); releaseFourth = null;
  const cancelled = await (await cancelResponse).json();
  await page.locator('[data-policy-status="stopped"]').waitFor();
  assert.ok(cancelled.policy.stopDetail, 'stopped policy has no stop detail');
  const latestStep = cancelled.policy.steps.at(-1);
  if (latestStep) {
    const latestAction = await page.getByTestId('policy-latest-action').innerText();
    assert.ok(latestAction.includes('刚刚完成：'));
    if (/^[A-Za-z]/.test(latestStep.label)) assert.ok(!latestAction.includes(latestStep.label), 'last action is not localized');
    assert.ok(latestAction.includes(latestStep.reason));
  }
  assert.ok((await page.locator('.policy-reason').innerText()).includes(cancelled.policy.reason));
  const choices = page.locator('.policy-stop-choices li');
  assert.equal(await choices.count(), cancelled.policy.stopDetail.choices.length);
  for (const label of await choices.allTextContents()) assert.ok(/[\u3400-\u9fff]/.test(label), 'stop choice is not localized');
  assert.deepEqual(await choices.evaluateAll(nodes => nodes.map(node => Number(node.dataset.choiceIndex))), cancelled.policy.stopDetail.choices.map(choice => choice.index));
  assert.equal(await page.locator('.policy-stop-choices button, .policy-stop-choices input').count(), 0);
  assert.equal(realSteps.length, 4);
  assert.ok(fourth.policy.executed > 3, 'personality remained a three-action batch');
  const ordinaryDiscovery = realSteps.slice(0, 3).findIndex(value => value.frame.feedback?.result?.discoveries?.length > 0 && value.policy.status === 'running');
  assert.ok(ordinaryDiscovery >= 0, 'no ordinary discovery remained running');
  assert.ok(realSteps[ordinaryDiscovery + 1].policy.executed > realSteps[ordinaryDiscovery].policy.executed, 'ordinary discovery did not continue');
  const cancelPost = posts.find(row => row.path.endsWith('/policy/cancel'));
  assert.equal(cancelPost.body.revision, fourth.revision);
  assert.equal(cancelPost.body.policyRevision, fourth.policyRevision);
  assert.equal(cancelled.revision, fourth.revision, 'cancel attempted a world action');
  assert.equal(posts.filter(row => row.path.endsWith('/actions')).length, 0, 'UI chose an Action index');
  assert.equal(posts.filter(row => row.path.endsWith('/policy/step')).length, 4);
  assert.ok(posts.filter(row => row.path.includes('/policy/')).every(row => !('index' in row.body) && Number.isInteger(row.body.policyRevision)));
  assert.equal(await page.getByRole('checkbox', { name: '引导路线' }).isChecked(), false);
  await page.unroute('**/policy/step');
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const panelBox = await page.locator('.policy-progress').boundingBox();
    for (const choice of await choices.all()) {
      const box = await choice.boundingBox();
      assert.ok(box && panelBox && box.y >= panelBox.y && box.y + box.height <= panelBox.y + panelBox.height,
        'a current stop choice is below the visible panel');
    }
    await shot(`actual-four-step-personality-cancel-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const beforeStoppedReload = posts.length;
  await page.reload(); await page.getByTestId('current-scene').waitFor();
  assert.equal(posts.length, beforeStoppedReload, 'refresh replayed a control or action');

  // A running backend authorization survives reload without restarting the UI pump.
  const current = await (await page.request.get(`${url}/api/sessions/${handle.id}`)).json();
  const reauthorized = await page.request.post(`${url}/api/sessions/${handle.id}/policy/start`, {
    data: { revision: current.revision, policyRevision: current.policyRevision, requestId: crypto.randomUUID(), intentId: profile.id },
  });
  assert.equal(reauthorized.status(), 200);
  assert.equal((await reauthorized.json()).policy.status, 'running');
  const beforeReload = posts.length;
  await page.reload(); await page.getByRole('button', { name: '继续行动', exact: true }).waitFor();
  assert.equal(posts.length, beforeReload);
  const refreshed = await (await page.request.get(`${url}/api/sessions/${handle.id}`)).json();
  assert.equal(refreshed.revision, current.revision);
  assert.equal(refreshed.policy.executed, 0);
  await shot('actual-reload-interrupted');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.locator('[data-policy-status="stopped"]').waitFor();
  assert.equal(posts.filter(row => row.path.endsWith('/policy/step')).length, 4);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/evidence.json`, JSON.stringify({ url, profileId, posts, realSteps, cancelled, refreshed, errors,
    ordinaryDiscoveryContinues: true, moreThanThreeRealSteps: true, refreshReadOnly: true, cancelWaitsInFlight: true }, null, 2));
  console.log(JSON.stringify({ result: 'passed', output, profileId, realSteps: realSteps.length, screenshots: 7 }));
} catch (error) {
  releaseFourth?.();
  await shot('failure');
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), profileId, posts, realSteps, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
