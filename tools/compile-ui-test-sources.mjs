import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
/** Compile actual production sources without changing the project's package type or tsconfig.
 * Queue/R2/HTTP test doubles are separate; this is not the official Vite/Vitest/Workers build. */
export function compileForNode(root, temp, plugin = false) {
  const source = path.join(temp, 'source'), output = path.join(temp, 'build');
  fs.mkdirSync(source, { recursive: true });
  fs.cpSync(path.join(root, 'src'), path.join(source, 'src'), { recursive: true });
  const inputConfig = JSON.parse(fs.readFileSync(path.join(root, plugin ? 'tsconfig.ui-async-tests.json' : 'tsconfig.json'), 'utf8'));
  if (!plugin) fs.copyFileSync(path.join(root, 'worker-configuration.d.ts'), path.join(source, 'worker-configuration.d.ts'));
  fs.writeFileSync(path.join(source, 'package.json'), '{"type":"commonjs"}');
  const config = { ...inputConfig, compilerOptions: { ...inputConfig.compilerOptions,
    module: 'Node16', moduleResolution: 'Node16', noEmit: false, rootDir: source, outDir: output } };
  fs.writeFileSync(path.join(source, 'tsconfig.json'), JSON.stringify(config, null, 2));
  const local = path.join(root, 'node_modules/typescript/bin/tsc');
  const args = ['-p', path.join(source, 'tsconfig.json')];
  const r = fs.existsSync(local)
    ? spawnSync(process.execPath, [local, ...args], { cwd: root, stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'tsc.cmd' : 'tsc', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error || r.status !== 0) throw new Error(`TypeScript compilation failed (${r.status ?? r.error?.code ?? 'unknown'})`);
  fs.writeFileSync(path.join(output, 'package.json'), '{"type":"commonjs"}');
  return output;
}
