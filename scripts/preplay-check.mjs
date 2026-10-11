import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configuration } from './dev.mjs';

export function stages(config, output, layout = false) {
  return [
  [config.python, ['-m', 'server.preplay_audit', '--output', `${output}/assets.json`]],
  [config.python, ['-m', 'unittest', 'server.test_preplay_audit']],
  [process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/feedback-clarity.test.ts',
    'src/action-window.test.ts', 'src/reading-ui.test.ts', '--minWorkers=1', '--maxWorkers=1']],
  ...(layout ? [[process.execPath, ['scripts/preplay-layout.mjs', `${output}/layout`]]] : []),
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--layout') || args.length > 1) {
    console.error('Usage: node scripts/preplay-check.mjs [--layout]');
    process.exitCode = 2;
  } else {
    const config = configuration();
    const output = resolve(config.root, 'test-results/preplay');
    mkdirSync(output, {recursive: true});
    const env = {...process.env, NOMOS_ENGINE_ROOT: config.engineRoot, PYTHONDONTWRITEBYTECODE: '1'};
    const timings = [];
    const start = performance.now();
    for (const [command, parameters] of stages(config, output, args.includes('--layout'))) {
      const before = performance.now();
      const result = spawnSync(command, parameters, {cwd: config.root, env, stdio: 'inherit', timeout: 120000});
      timings.push({parameters, seconds: (performance.now() - before) / 1000, exitCode: result.status});
      if (result.error) console.error(result.error.message);
      if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
    }
    const seconds = (performance.now() - start) / 1000;
    writeFileSync(`${output}/timings.json`, JSON.stringify({seconds, layoutRequested: args.includes('--layout'), timings}, null, 2) + '\n');
    console.log(`试玩前检查用时 ${seconds.toFixed(1)}s；功能缺口仍须单独处理，无玩家评分。`);
  }
}
