import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.M1_PLAYER_URL ?? 'http://127.0.0.1:8863';
const output = process.env.M1_ART_EVIDENCE ?? '/tmp/m1-scene-art-v3';
const files = ['ballroom', 'corridor', 'bridge', 'ritual', 'treasure', 'icebar', 'lower', 'stables', 'prison', 'tower-base', 'tower-top'].map(name => `/assets/scene-${name}-v3.png`);
files.push('/assets/palace-geographic-v3.png');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results = [];
try {
  await page.goto(`${url}/assets/SCENE_ASSETS.md`);
  for (const src of files) {
    const result = await page.evaluate(async src => {
      const response = await fetch(src);
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return { status: response.status, image: false };
      const bytes = await response.arrayBuffer();
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const image = new Image(); image.src = src; await image.decode();
      return { status: response.status, image: true, width: image.naturalWidth, height: image.naturalHeight, bytes: bytes.byteLength, sha256 };
    }, src);
    assert.equal(result.status, 200); assert(result.image);
    const isMap = src.includes('geographic');
    assert(result.width >= (isMap ? 800 : 1000) && result.height >= (isMap ? 1000 : 600), 'Art lacks sufficient resolution');
    results.push({ src, ...result });
  }
  assert.equal(new Set(results.map(result => result.sha256)).size, files.length, 'Distinct regions share duplicate image bytes');
  await writeFile(`${output}/evidence.json`, JSON.stringify({ result: 'passed', url, results, note: 'Asset loading/decoding only; no Session, no Action, no assertion of visits or map knowledge.' }, null, 2));
  console.log(JSON.stringify({ result: 'passed', assets: results.length, output }));
} finally { await browser.close(); }
