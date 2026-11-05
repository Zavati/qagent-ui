import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {compileForNode} from './compile-ui-test-sources.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'qagent-ui-a3-'));
try {const build=compileForNode(root,temp);const r=spawnSync(process.execPath,['--test',path.join(root,'tests/unit.node.cjs')],{stdio:'inherit',env:{...process.env,QAGENT_UI_BUILD:build,QAGENT_UI_ROOT:root}});process.exitCode=r.status??1;}catch(e){console.error(e.message);process.exitCode=1;}finally{fs.rmSync(temp,{recursive:true,force:true});}
