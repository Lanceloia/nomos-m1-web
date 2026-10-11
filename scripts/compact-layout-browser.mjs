import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_PLAYER_URL ?? 'http://127.0.0.1:8863';
const output = process.env.M1_LAYOUT_EVIDENCE ?? '/tmp/m1-compact-layout-v3';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const posts = [], errors = [], views = [];
page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(url);
  await page.getByTestId('current-scene').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => { const image = document.querySelector('.board-art'); return image?.complete && image.naturalWidth > 0; });
  for (const [width, height] of [[1024, 576], [1280, 720], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const box = selector => {
        const element = document.querySelector(selector), rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom };
      };
      const circle = box('.identity-icon'), icon = box('.identity-icon svg');
      return {
        identityInHud: Boolean(document.querySelector('.resource-hud [data-testid="scene-player"]')),
        identityInStage: Boolean(document.querySelector('.scene-stage [data-testid="scene-player"]')),
        iconOffset: [Math.abs(circle.x + circle.width / 2 - icon.x - icon.width / 2), Math.abs(circle.y + circle.height / 2 - icon.y - icon.height / 2)],
        bodyWidth: document.documentElement.scrollWidth,
        hud: box('.resource-hud'), dock: box('.action-dock'), heading: box('.scene-heading'), stage: box('.scene-stage'),
        guidance: box('.quest-hud'), surface: box('.visible-surface'), map: box('.map-hud'),
        clippedButtons: [...document.querySelectorAll('button:not(.geographic-place)')].filter(element => element.clientWidth && element.scrollWidth > element.clientWidth + 2).map(element => element.textContent),
      };
    });
    assert(layout.identityInHud && !layout.identityInStage);
    assert(layout.iconOffset.every(offset => offset < 1));
    assert(layout.bodyWidth <= width, 'Desktop scaling causes horizontal overflow');
    assert(layout.hud.bottom <= layout.dock.y && layout.map.bottom <= layout.dock.y, 'Auxiliary HUD overlaps action dock');
    assert(layout.guidance.bottom <= layout.heading.y && layout.heading.bottom <= layout.stage.y, 'Scene copy overlaps adjacent content');
    assert(layout.surface.bottom <= layout.dock.y && layout.stage.height >= 100, 'Scene stage is occluded');
    assert.deepEqual(layout.clippedButtons, []);
    await page.screenshot({ path: `${output}/opening-${width}.png`, fullPage: true });
    views.push({ width, height, layout });
  }
  assert.equal(posts.filter(path => path.endsWith('/actions')).length, 0);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/evidence.json`, JSON.stringify({ result: 'passed', url, views, posts, errors, note: '1024x576 models a 1280x720 screen at 125% effective desktop scaling; not a Windows system-settings measurement.' }, null, 2));
  console.log(JSON.stringify({ result: 'passed', views: views.length, actions: 0, output }));
} finally { await browser.close(); }
