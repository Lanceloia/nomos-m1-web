import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_TABLETOP_URL ?? 'http://127.0.0.1:8881';
const output = process.env.M1_FEEDBACK_BROWSER_OUTPUT ?? '/tmp/m1-feedback-v2-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], steps = [], shots = [];
page.setDefaultTimeout(60000);
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (response.url().endsWith('/policy/step')) steps.push(await response.json());
});
const mapRead = () => page.locator('.geographic-map.compact').evaluate(node => ({
  viewBox: node.querySelector('svg').getAttribute('viewBox'),
  image: node.querySelector('image').getAttribute('href'),
  markers: [...node.querySelectorAll('[data-map-region]')].map(pin => ({
    region: pin.dataset.mapRegion, left: pin.style.left, top: pin.style.top,
  })),
}));
async function shot(name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/${name}.png` }); shots.push(name);
}
try {
  await page.goto(url);
  await page.getByTestId('current-scene').waitFor();
  const initialMap = await mapRead();
  await page.getByRole('button', { name: '人格倾向', exact: true }).click();
  await page.locator('input[value="decisive_explorer"]').check();
  await page.locator('input[name="maxActions"]').fill('8');
  await page.locator('input[name="stopOnUnexpected"]').uncheck();
  await page.getByRole('button', { name: '按此倾向行动', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-policy-status="running"]') && !document.querySelector('.sheet'));
  await shot('running-1280');
  await page.locator('[data-policy-status="stopped"]').waitFor();
  const handle = JSON.parse(await page.evaluate(() => sessionStorage.getItem('m1-tabletop.session.v1')));
  const actual = await (await page.request.get(`${url}/api/sessions/${handle.id}`)).json();
  assert.equal(actual.policy.executed, 8);
  assert(steps.some(row => row.frame.fields.locationId !== 'ballroom_entrance'), 'no real movement covered');
  const finalMap = await mapRead();
  assert.equal(finalMap.viewBox, initialMap.viewBox);
  assert.equal(finalMap.image, initialMap.image);
  for (const before of initialMap.markers) {
    const after = finalMap.markers.find(row => row.region === before.region);
    assert.deepEqual(after, before, 'existing region anchor moved');
  }
  const hud = [];
  for (const [width, height] of [[1280,720],[1440,900],[1920,1080]]) {
    await page.setViewportSize({ width, height });
    const dimensions = await page.locator('.policy-progress').evaluate(node => ({
      height: node.clientHeight, scrollHeight: node.scrollHeight,
      overflowing: [...node.querySelectorAll('*'),node].filter(item =>
        ['auto','scroll'].includes(getComputedStyle(item).overflowY) && item.scrollHeight > item.clientHeight + 1
      ).map(item => item.className),
    }));
    assert.deepEqual(dimensions.overflowing, []);
    assert(dimensions.height < height / 4, 'progress dominates scene');
    hud.push({ width,height,...dimensions });
    await shot(`compact-${width}`);
  }
  await page.getByRole('button', { name: '行动详情', exact: true }).click();
  await page.getByRole('heading', { name: '自动行动详情' }).waitFor();
  assert.equal(await page.locator('.policy-steps li').count(), actual.policy.steps.length);
  await shot('details-1920');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '行动记录', exact: true }).click();
  const displayed = await page.locator('.report-scores tbody tr').evaluateAll(rows => rows.map(row => row.querySelector('td').textContent));
  assert.deepEqual(displayed, ['cautious_investigator','helpful_rescuer','decisive_explorer'].map(key => String(actual.playReport.scores[key] * 10)));
  await shot('report-1920');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const revision = actual.revision;
  await page.reload(); await page.getByTestId('current-scene').waitFor();
  const reread = await (await page.request.get(`${url}/api/sessions/${handle.id}`)).json();
  assert.equal(reread.revision, revision);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/evidence.json`, JSON.stringify({url,sessionId:handle.id,
    initialMap,finalMap,hud,scores:actual.playReport.scores,displayed,steps:steps.length,
    manualActions:actual.playReport.metrics.manualActions,shots,errors,refreshReadOnly:true},null,2));
  console.log(JSON.stringify({result:'passed',output,steps:steps.length,hud,displayed}));
} finally { await browser.close(); }
