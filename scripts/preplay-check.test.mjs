import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stages } from './preplay-check.mjs';

const config = {python: '/selected/python'};
test('fast default names specific test modules and does not start a browser or game service', () => {
  const plan = stages(config, '/evidence');
  assert.equal(plan.length, 3);
  assert.equal(plan[0][0], config.python);
  assert.deepEqual(plan[1][1], ['-m', 'unittest', 'server.test_preplay_audit']);
  assert.ok(plan[2][1].includes('src/feedback-clarity.test.ts'));
  assert.ok(plan[2][1].includes('--maxWorkers=1'));
  assert.ok(plan.every(([, args]) => !args.some(arg => /server\.bridge|pytest|preplay-layout/.test(arg))));
});
test('layout is an explicit additional stage, never a full play route', () => {
  const plan = stages(config, '/evidence', true);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.at(-1)[1], ['scripts/preplay-layout.mjs', '/evidence/layout']);
  assert.deepEqual(plan.slice(0, 3), stages(config, '/evidence'));
});
