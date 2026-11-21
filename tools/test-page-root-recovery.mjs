import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileForNode } from './compile-ui-test-sources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), index = args.indexOf('--observation');
if ((args.length && (index !== 0 || args.length !== 2)) || (index >= 0 && !args[index + 1])) {
  throw Error('Use: node tools/test-page-root-recovery.mjs [--observation ../qagent-observation]');
}
const observation = path.resolve(index >= 0 ? args[index + 1] : path.join(root, '../qagent-observation'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-page-root-recovery-'));
try {
  const uiBuild = compileForNode(root, path.join(temp, 'ui'));
  const obsBuild = compileForNode(observation, path.join(temp, 'observation'));
  const result = spawnSync(process.execPath, ['--test', path.join(root, 'tests/page-root-recovery.node.cjs')], {
    stdio: 'inherit', shell: false,
    env: { ...process.env, QAGENT_UI_ROOT: root, QAGENT_UI_BUILD: uiBuild,
      QAGENT_OBSERVATION_ROOT: observation, QAGENT_OBSERVATION_BUILD: obsBuild }
  });
  process.exitCode = result.status ?? 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { fs.rmSync(temp, { recursive: true, force: true }); }
