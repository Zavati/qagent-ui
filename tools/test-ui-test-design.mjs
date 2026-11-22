import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileForNode } from './compile-ui-test-sources.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'qagent-test-design-'));
try{const output=compileForNode(root,temp);const tests=fs.readdirSync(path.join(root,'tests')).filter(name=>/^ui-test-design(?:-[a-z-]+)?\.node\.cjs$/.test(name)).sort().map(name=>path.join(root,'tests',name));const result=spawnSync(process.execPath,['--test',...tests],{stdio:'inherit',env:{...process.env,QAGENT_UI_ROOT:root,QAGENT_UI_BUILD:output}});process.exitCode=result.status??1;}
catch(error){console.error(error.message);process.exitCode=1;}
finally{fs.rmSync(temp,{recursive:true,force:true});}
