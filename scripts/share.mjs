import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPortAvailable, configuration } from './dev.mjs';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');

export function sharingConfiguration(env = process.env) {
  const config = configuration({ ...env, M1_WEB_PORT: env.M1_SHARE_PORT ?? '5195' }, true);
  const minutes = Number(env.M1_SHARE_MINUTES ?? 120);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) throw Error('M1_SHARE_MINUTES must be from 15 to 1440');
  const maxGames = Number(env.M1_SHARE_MAX_GAMES ?? 16);
  if (!Number.isInteger(maxGames) || maxGames < 1 || maxGames > 128) throw Error('M1_SHARE_MAX_GAMES must be from 1 to 128');
  const cloudflared = env.CLOUDFLARED ?? resolve(homedir(), '.local/bin/cloudflared');
  return { ...config, minutes, maxGames, cloudflared };
}

export function tunnelOrigin(text) {
  return text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[\s/|]|$)/)?.[0] ?? null;
}

function save(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export async function serve(config, stateFile) {
  await assertPortAvailable(config.webPort);
  if (!existsSync(resolve(root, 'dist/index.html'))) throw Error('Run npm run build before sharing');
  if (!existsSync(config.cloudflared)) throw Error('Install official cloudflared or set CLOUDFLARED');
  const tokenFile = resolve(dirname(stateFile), 'invite.txt');
  const token = randomBytes(24).toString('hex');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const state = { status: 'starting', pid: process.pid, port: config.webPort,
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + config.minutes * 60000).toISOString() };
  save(stateFile, state);
  const children = []; let closing = false, timer;
  function stop(code = 0, message = 'Sharing stopped') {
    if (closing) return;
    closing = true; clearTimeout(timer);
    for (const child of children) child.kill('SIGTERM');
    rmSync(tokenFile, { force: true });
    delete state.invitationURL;
    state.status = code ? 'error' : 'closed'; state.message = message;
    save(stateFile, state); process.exitCode = code;
  }
  process.once('SIGINT', () => stop());
  process.once('SIGTERM', () => stop());
  process.once('exit', () => stop());
  const start = (command, args) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env,
      NOMOS_ENGINE_ROOT: config.engineRoot, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    child.once('error', error => stop(1, error.message));
    child.once('exit', (code, signal) => { if (!closing) stop(1, `Child exited: ${command} (${code ?? signal})`); });
    return child;
  };
  try {
    let origin = null;
    const tunnel = start(config.cloudflared, ['tunnel', '--url', `http://127.0.0.1:${config.webPort}`,
      '--protocol', 'http2', '--no-autoupdate']);
    let tunnelLog = '';
    const inspect = data => {
      const text = data.toString(); process.stdout.write(text);
      tunnelLog = (tunnelLog + text).slice(-16000);
      origin ??= tunnelOrigin(tunnelLog);
    };
    tunnel.stdout.on('data', inspect); tunnel.stderr.on('data', inspect);
    const tunnelDeadline = Date.now() + config.timeout;
    while (!origin && !closing && Date.now() < tunnelDeadline) await new Promise(accept => setTimeout(accept, 200));
    if (!origin || closing) throw Error('Temporary tunnel did not provide an HTTPS address; see sharing log');
    state.origin = origin; save(stateFile, state);
    const backend = start(config.python, ['-u', '-m', 'server.bridge', '--port', String(config.webPort),
      '--static', resolve(root, 'dist'), '--public-origin', origin, '--share-token-file', tokenFile,
      '--share-lifetime', String(config.minutes * 60), '--max-games', String(config.maxGames)]);
    backend.stdout.on('data', data => process.stdout.write(data));
    backend.stderr.on('data', data => process.stderr.write(data));
    const deadline = Date.now() + config.timeout;
    let ready = false;
    while (!closing && Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${config.webPort}/api/health`, { signal: AbortSignal.timeout(1500) });
        const health = await response.json();
        if (health.status === 'error') throw Error('M1 compilation failed');
        if (response.ok && health.status === 'ready' && health.engine === 'NomosEngine2') { ready = true; break; }
      } catch (error) {
        if (error.message === 'M1 compilation failed') throw error;
      }
      await new Promise(accept => setTimeout(accept, 250));
    }
    if (!ready || closing) throw Error('M1 did not become ready; see sharing log');
    state.status = 'ready'; state.invitationURL = `${origin}/#invite=${token}`;
    state.expiresAt = new Date(Date.now() + config.minutes * 60000).toISOString(); save(stateFile, state);
    console.log(`M1 invitation ready; private state: ${stateFile}`);
    timer = setTimeout(() => stop(0, 'Scheduled sharing window ended'), config.minutes * 60000);
  } catch (error) { stop(1, error.message); throw error; }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--stop') {
    const stateFile = resolve(args[1] ?? '');
    const state = JSON.parse(readFileSync(stateFile));
    if (!['ready', 'starting'].includes(state.status)) { console.log(`Sharing already ${state.status}`); return; }
    const command = readFileSync(`/proc/${state.pid}/cmdline`, 'utf8').split('\0');
    if (!command.includes(script) || !command.includes(stateFile)) throw Error('PID no longer identifies this sharing supervisor');
    process.kill(state.pid, 'SIGTERM'); console.log('Stopped this sharing window'); return;
  }
  const config = sharingConfiguration();
  if (args[0] === '--attached') return serve(config, resolve(args[1]));
  await assertPortAvailable(config.webPort);
  if (!existsSync(resolve(root, 'dist/index.html'))) throw Error('Run npm run build before sharing');
  if (!existsSync(config.cloudflared)) throw Error('Install official cloudflared or set CLOUDFLARED');
  const directory = resolve(homedir(), '.local/state/nomos-m1', `share-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stateFile = resolve(directory, 'state.json');
  const log = openSync(resolve(directory, 'share.log'), 'a', 0o600);
  const child = spawn(process.execPath, [script, '--attached', stateFile], {
    detached: true, cwd: root, env: process.env, stdio: ['ignore', log, log],
  });
  closeSync(log);
  let childExit;
  child.once('error', error => { childExit = error.message; });
  child.once('exit', code => { childExit = `Sharing supervisor exited (${code})`; });
  child.unref();
  console.log(`Sharing supervisor PID ${child.pid}; state ${stateFile}`);
  const deadline = Date.now() + config.timeout * 2;
  while (Date.now() < deadline) {
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile));
      if (state.status === 'ready') { console.log(state.invitationURL); console.log(`Expires ${state.expiresAt}; stop: node scripts/share.mjs --stop ${stateFile}`); return; }
      if (state.status === 'error' || state.status === 'closed') throw Error(`${state.message}; log ${directory}/share.log`);
    }
    if (childExit) throw Error(`${childExit}; log ${directory}/share.log`);
    await new Promise(accept => setTimeout(accept, 500));
  }
  process.kill(child.pid, 'SIGTERM'); throw Error(`Sharing startup timed out; log ${directory}/share.log`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
