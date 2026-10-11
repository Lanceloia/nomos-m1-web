import { spawnSync } from 'node:child_process';
import { configuration } from './dev.mjs';

const modules = process.argv.slice(2);
if (!modules.length || modules.some(name => !/^server\.test_[a-z0-9_]+(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name))) {
  console.error('Name specific unittest modules, e.g. npm run test:bridge -- server.test_feedback_v5');
  process.exitCode = 2;
} else {
  const config = configuration();
  const result = spawnSync(config.python, ['-m', 'unittest', ...modules], { cwd: config.root,
    env: { ...process.env, NOMOS_ENGINE_ROOT: config.engineRoot, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
