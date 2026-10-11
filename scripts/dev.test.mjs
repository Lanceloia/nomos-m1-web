import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { assertPortAvailable, commands, configuration } from './dev.mjs';

test('development launches only the local service and proxies to its exact port', () => {
  const config = configuration({ M1_WEB_PORT: '8810', M1_BRIDGE_PORT: '8811', M1_API_URL: 'http://wrong' }, false, '/tmp/web');
  const [service, web] = commands(config);
  assert.equal(service.command, '/tmp/web/.venv/bin/python');
  assert.deepEqual(service.args, ['-u', '-m', 'server.bridge', '--port', '8811']);
  assert.equal(web.env.M1_API_URL, 'http://127.0.0.1:8811');
  assert.equal(service.env.NOMOS_ENGINE_ROOT, '/tmp/nomosengine2-release');
});
test('preview uses one local process for static files and API', () => {
  const config = configuration({ M1_WEB_PORT: '8812' }, true, '/tmp/web');
  assert.equal(config.bridgePort, 8812);
  assert.equal(commands(config).length, 1);
  assert.deepEqual(commands(config)[0].args, ['-u', '-m', 'server.bridge', '--port', '8812', '--static', '/tmp/web/dist']);
});
test('only explicit overrides select a different interpreter or engine', () => {
  const config = configuration({ NOMOS_PYTHON: '/python/selected', NOMOS_ENGINE_ROOT: '/engine/selected' }, false, '/tmp/web');
  assert.equal(config.python, '/python/selected');
  assert.equal(config.explicitPython, true);
  assert.equal(config.engineRoot, '/engine/selected');
});
test('Windows selects its own local virtual environment', () => {
  assert.equal(configuration({}, false, '/tmp/web', 'win32').python, '/tmp/web/.venv/Scripts/python.exe');
});
test('malformed ports and equal development ports are rejected', () => {
  for (const value of ['', '0', '65536', '12.5', 'NaN']) assert.throws(() => configuration({ M1_WEB_PORT: value }));
  assert.throws(() => configuration({ M1_WEB_PORT: '8810', M1_BRIDGE_PORT: '8810' }));
});
test('startup timeout must be finite and positive', () => {
  for (const value of ['0', 'Infinity', '1.5', '3600001']) assert.throws(() => configuration({ M1_STARTUP_TIMEOUT_MS: value }));
});
test('occupied ports reject without disturbing the existing listener', async () => {
  const server = createServer();
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  try { await assert.rejects(assertPortAvailable(server.address().port), /unavailable/); }
  finally { await new Promise(accept => server.close(accept)); }
});
