import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function configuration(env = process.env, preview = false, directory = root, platform = process.platform) {
  const port = (name, fallback) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a port from 1 to 65535`);
    return value;
  };
  const webPort = port('M1_WEB_PORT', 5173);
  const bridgePort = preview ? webPort : port('M1_BRIDGE_PORT', 8791);
  if (!preview && bridgePort === webPort) throw new Error('Development web and API ports must differ');
  const timeout = Number(env.M1_STARTUP_TIMEOUT_MS ?? 120000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 3600000) throw new Error('M1_STARTUP_TIMEOUT_MS must be from 1000 to 3600000');
  const engineRoot = resolve(directory, env.NOMOS_ENGINE_ROOT ?? '../nomosengine2-release');
  return { root: directory, preview, webPort, bridgePort, timeout, engineRoot,
    python: env.NOMOS_PYTHON ?? resolve(directory, platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'),
    explicitPython: env.NOMOS_PYTHON !== undefined };
}

export function commands(config) {
  const env = { NOMOS_ENGINE_ROOT: config.engineRoot, PYTHONDONTWRITEBYTECODE: '1',
    M1_API_URL: `http://127.0.0.1:${config.bridgePort}` };
  return [
    { command: config.python, args: ['-u', '-m', 'server.bridge', '--port', String(config.bridgePort),
      ...(config.preview ? ['--static', resolve(config.root, 'dist')] : [])], env },
    ...(!config.preview ? [{ command: process.execPath,
      args: [resolve(config.root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(config.webPort), '--strictPort'], env }] : []),
  ];
}

export async function assertPortAvailable(port) {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', error => reject(new Error(`Port ${port} unavailable: ${error.message}`)));
    server.listen(port, '127.0.0.1', () => server.close(accept));
  });
}

export async function run(config) {
  if (!config.explicitPython && !existsSync(config.python)) throw new Error('Create the Web .venv and install ../nomosengine2-release; see README.md');
  if (!existsSync(resolve(config.engineRoot, 'src/nomos_examples/everflame/world.bundle.yaml'))) throw new Error('NOMOS_ENGINE_ROOT must select the release checkout with the M1 bundle');
  if (config.preview && !existsSync(resolve(config.root, 'dist/index.html'))) throw new Error('Run npm run build before npm start');
  config = { ...config, engineRoot: realpathSync(config.engineRoot) };
  for (const port of new Set([config.webPort, config.bridgePort])) await assertPortAvailable(port);
  const children = [];
  const controller = new AbortController();
  let closing = false;
  const stop = (code = 0) => {
    if (closing) return;
    closing = true;
    controller.abort();
    for (const child of children) child.kill('SIGTERM');
    process.exitCode = code;
  };
  process.once('SIGINT', () => stop());
  process.once('SIGTERM', () => stop());
  const start = specification => {
    const child = spawn(specification.command, specification.args, { cwd: config.root,
      env: { ...process.env, ...specification.env }, stdio: 'inherit' });
    children.push(child);
    child.once('error', error => { console.error(error.message); stop(1); });
    child.once('exit', code => { if (!closing) stop(code || 1); });
  };
  const [service, web] = commands(config);
  start(service);
  console.log(`Compiling M1 once from ${config.engineRoot}; waiting for the session service...`);
  const deadline = Date.now() + config.timeout;
  let ready = false;
  try {
    while (!closing && Date.now() < deadline) {
      let response, health;
      try {
        response = await fetch(`http://127.0.0.1:${config.bridgePort}/api/health`,
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]) });
        health = await response.json();
      } catch {
        if (closing) break;
      }
      if (health?.status === 'error') throw new Error('M1 compilation failed; see the Python service error above');
      if (response?.ok && health?.status === 'ready') {
        if (health.engine !== 'NomosEngine2' || health.engineRoot !== config.engineRoot) throw new Error('The service loaded a different engine checkout');
        ready = true;
        break;
      }
      await new Promise(accept => setTimeout(accept, 250));
    }
    if (!closing && !ready) throw new Error('M1 startup timed out; inspect the service log or set M1_STARTUP_TIMEOUT_MS');
    if (ready && !closing) {
      if (web) start(web);
      console.log(`M1: http://127.0.0.1:${config.webPort}/ (one Program shared by new sessions)`);
    }
  } catch (error) { stop(1); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(configuration(process.env, process.argv.includes('--preview')))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
