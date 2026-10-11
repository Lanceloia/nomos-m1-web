import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_TABLETOP_URL ?? 'http://127.0.0.1:8883';
const output = process.env.M1_JOURNEY_BROWSER_OUTPUT ?? '/tmp/m1-journey-v3-browser';
const witness = JSON.parse(await readFile(process.env.M1_JOURNEY_EVIDENCE ?? '/tmp/m1-journey-v3-live.json', 'utf8'));
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1280,height:720}});
const page = await context.newPage();
const errors = [], posts = [], shots = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
const map = () => page.locator('.geographic-map.compact').evaluate(node => ({
  viewBox:node.querySelector('svg').getAttribute('viewBox'),
  pins:[...node.querySelectorAll('[data-map-site]')].map(pin => ({
    site:pin.dataset.mapSite,left:pin.style.left,top:pin.style.top,here:pin.getAttribute('aria-current') === 'location'})),
}));
async function shot(name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  });
  assert(await page.locator('.board-art').evaluate(image => image.complete && image.naturalWidth > 0));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path:`${output}/${name}.png`}); shots.push(name);
}
try {
  await page.goto(url);
  await page.getByTestId('current-scene').waitFor();
  const initial = await map();
  // Open the actual known destination, not a synthetic frame or map route.
  await page.locator('.geographic-map.compact [data-map-site="ballroom_chandelier_reach"]').click();
  const submitted = page.waitForResponse(response => response.url().endsWith('/actions') && response.request().method() === 'POST');
  await page.locator('.inspector [data-offer="cross_ice_adventurer"]').first().click();
  if (await page.getByTestId('execute').count()) await page.getByTestId('execute').click();
  const actual = await (await submitted).json();
  assert.equal(actual.frame.feedback.status, 'published');
  assert.equal(actual.frame.fields.locationId, 'ballroom_chandelier_reach');
  await page.locator('.geographic-map.compact [data-map-site="ballroom_chandelier_reach"][aria-current="location"]').waitFor();
  const moved = await map();
  assert.equal(initial.viewBox, moved.viewBox);
  assert.notDeepEqual(initial.pins.find(pin => pin.here)?.site, moved.pins.find(pin => pin.here)?.site);
  for (const before of initial.pins) {
    const after = moved.pins.find(pin => pin.site === before.site);
    assert(after); assert.equal(after.left,before.left); assert.equal(after.top,before.top);
  }
  await shot('same-region-actual-move-1280');
  assert(witness.final.frame.ending, 'the real witness did not reach an ending');
  await page.evaluate(handle => sessionStorage.setItem('m1-tabletop.session.v1', JSON.stringify(handle)),
    {id:witness.final.sessionId,revision:witness.final.revision});
  await page.reload();
  await page.getByRole('button',{name:'查看结算',exact:true}).waitFor();
  const postCount = posts.length;
  const sizes = [[1280,720],[1440,900],[1920,1080]];
  for (const [width,height] of sizes) {
    await page.setViewportSize({width,height});
    assert.equal(await page.getByTestId('current-scene').count(),1);
    assert.equal(await page.getByTestId('ending-summary').count(),0);
    await shot(`final-scene-${width}`);
    await page.getByRole('button',{name:'查看结算',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByTestId('ending-summary').count(),1);
    assert.equal(await page.getByTestId('current-scene').count(),1);
    await shot(`settlement-${width}`);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),0);
    assert(await page.getByRole('button',{name:'查看结算',exact:true}).evaluate(node => node === document.activeElement));
  }
  await page.reload(); await page.getByRole('button',{name:'查看结算',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(posts.length,postCount,'settlement and refresh submitted or restarted');
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/evidence.json`,JSON.stringify({url,initial,moved,shots,errors,
    actualMovement:{sessionId:actual.sessionId,revision:actual.revision,site:actual.frame.fields.locationId},
    ending:{sessionId:witness.final.sessionId,revision:witness.final.revision,id:witness.final.frame.ending.id},
    readOnlySettlement:true,posts},null,2));
  console.log(JSON.stringify({result:'passed',output,shots:shots.length,errors}));
} finally { await browser.close(); }
