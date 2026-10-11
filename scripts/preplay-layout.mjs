import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as viteServer } from 'vite';
import { chromium } from 'playwright';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] ?? `${root}/test-results/preplay/layout`);
const evidence = {kind: 'component-fixture', compileCount: 0, sessions: 0, actions: 0, requests: [], screenshots: []};
const priorWindow = globalThis.window;
let vite, server, browser;
async function cleanup() {
  await browser?.close();
  if (server?.listening) await new Promise(accept => server.close(accept));
  await vite?.close();
}
const interrupted = () => { void cleanup().finally(() => process.exit(130)); };
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
try {
  globalThis.window = {sessionStorage: undefined};
  vite = await viteServer({root, server: {middlewareMode: true, hmr: false, watch: null}, appType: 'custom'});
  const ui = await vite.ssrLoadModule('/src/App.tsx');
  const {publicFrame, surface, memory} = await vite.ssrLoadModule('/src/presence.fixtures.ts');
  const noop = () => {};
  const frame = publicFrame();
  frame.fields.lifeState = 'alive'; frame.fields.coldState = 'mobile';
  frame.information.visibleEntities = Array.from({length: 8}, (_, i) => surface(`person-${i}`, 'person', 'ballroom_entrance',
    `仪式处靠近门槛的第${i + 1}位长名称居民`));
  frame.observations = frame.information.visibleEntities.map(item => {
    const prior = memory(item.id, 'person', item.site);
    prior.state = 'immune'; prior.detailRecordedAt = {...prior.recordedAt};
    prior.facts = [{label: '御寒', value: 'immune'}];
    return prior;
  });
  frame.feedback = {status: 'published', entry: 'offer_escort_adventurer', actionLabel: 'Invite residents', text: 'Public', result: {
    changes: [], laterChanges: [], discoveries: [], laterDiscoveries: [],
  }};
  const offer = {index: 7, entry: 'thaw_person_adventurer', label: 'Spend one charge to thaw person'};
  frame.offers = [offer];

  function html(state) {
    const next = structuredClone(frame);
    if (state === 'moving') {
      next.information.movements = [{id: 'motion', subjectId: 'person-0', label: '仪式处居民',
        start: 'ritual_ring', end: 'ritual_threshold', recordedAt: {time: 10, revision: 4}}];
      next.feedback.result.laterDiscoveries = [{kind: 'movement', movement: next.information.movements[0]}];
    }
    return '<!doctype html><html lang="zh"><meta charset="utf-8"><link rel="stylesheet" href="/style.css">'
      + renderToStaticMarkup(h('div', {className: 'app'},
        h('header', {className: 'masthead'}, '固定状态呈现检查 · 测试夹具，非真实游玩'),
        h('main', {className: 'play-area board details-open'},
          h('section', {className: 'resource-hud'}, h(ui.PlayerIdentity), h(ui.ResourceReadbacks, {frame: next})),
          h('section', {className: 'scene-content'},
            h('div', {className: 'quest-hud'}, h(ui.AdventureStatus, {frame: next}),
              h(ui.NextStepGuidance, {frame: next, blocked: false, onAct: noop, compact: true})),
            h('div', {className: 'scene-heading'}, h('h1', {}, '舞厅入口'),
              h('p', {}, '你已抵达舞厅入口。'), h('span', {}, '局内时刻 1100')),
            h(ui.SceneStage, {frame: next, onSelect: noop})),
          h('aside', {className: 'inspector'},
            h('div', {className: 'offer-scroll'}, h(ui.SurfaceHistory, {frame: next, id: 'person-0'})),
            h('section', {className: 'confirmation'},
              h(ui.ActionPreview, {frame: next, offer, heading: '解冻居民'}),
              h('button', {className: 'execute', 'data-testid': 'execute'}, '执行行动'),
              h('button', {className: 'execute', disabled: true}, '正在结算'))),
          h('div', {className: 'action-dock'}, h(ui.LatestReceipt, {frame: next, error: null, onRead: noop})))))
      + '</html>';
  }

  server = httpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    evidence.requests.push({method: req.method, path: url.pathname});
    try {
      assert.equal(req.method, 'GET');
      if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html(url.searchParams.get('state'))); return; }
      const file = url.pathname === '/style.css' ? resolve(root, 'src/style.css') : resolve(root, `public${decodeURIComponent(url.pathname)}`);
      assert.ok(url.pathname === '/style.css' || url.pathname.startsWith('/assets/'));
      assert.ok(file === resolve(root, 'src/style.css') || file.startsWith(resolve(root, 'public/assets') + sep));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', url.pathname === '/style.css' ? 'text/css' : 'font/woff');
      res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${server.address().port}`;
  await mkdir(output, {recursive: true});
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const req = route.request();
    return req.url().startsWith(base + '/') && req.method() === 'GET' ? route.continue() : route.abort();
  });
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
    for (const state of ['quiet', 'moving']) {
      await page.setViewportSize({width, height});
      // Keep the document/font alive; only the actual rendered fixture body changes.
      await page.evaluate(markup => {
        document.body.innerHTML = new DOMParser().parseFromString(markup, 'text/html').body.innerHTML;
      }, html(state));
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.fonts.check('15px M1Chinese')));
      assert.equal(await page.locator('.surface-token').count(), 8);
      const geometry = await page.locator('.surface-token').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        return [...node.children].every(child => {
          const rect = child.getBoundingClientRect();
          return rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
        });
      }));
      assert.ok(geometry.every(Boolean), `${width}/${state}: token content escaped its bounds`);
      const surface = page.locator('.visible-surface');
      await surface.evaluate(node => { node.scrollTop = node.scrollHeight; });
      const lastToken = await page.locator('.surface-token').last().evaluate(node => {
        const box = node.getBoundingClientRect(), list = node.closest('.visible-surface').getBoundingClientRect();
        const dock = document.querySelector('.action-dock').getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, listTop: list.top, listBottom: list.bottom,
          dockTop: dock.top, readable: box.top >= list.top - 1 && box.bottom <= list.bottom + 1 && box.bottom < dock.top };
      });
      assert.ok(lastToken.readable, `${width}/${state}: last token cannot be fully read above the dock: ${JSON.stringify(lastToken)}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const execute = page.getByTestId('execute');
      await execute.hover();
      const contrast = await execute.evaluate(node => {
        const style = getComputedStyle(node);
        const luminance = color => {
          const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
            const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
          });
          return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
        };
        const a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      assert.ok(contrast >= 4.5, `${width}: execute hover contrast ${contrast}`);
      const summary = await page.locator('.receipt-brief').innerText();
      assert.match(summary, state === 'quiet' ? /本次暂未看见新的动身迹象/ : /随后看见仪式处居民/);
      assert.doesNotMatch(summary, /答应了|已获救|接受了/);
      const file = `${state}-${width}.png`;
      await page.screenshot({path: `${output}/${file}`});
      evidence.screenshots.push({file, width, height, state, contrast});
    }
  }
  assert.deepEqual(errors, []);
  assert.ok(evidence.requests.every(row => row.method === 'GET' && !row.path.startsWith('/api/')));
  await writeFile(`${output}/summary.json`, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`固定状态检查通过：6张桌面截图，0 Compile / Session / Action；${output}`);
} finally {
  await cleanup();
  process.removeListener('SIGINT', interrupted);
  process.removeListener('SIGTERM', interrupted);
  if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
}
