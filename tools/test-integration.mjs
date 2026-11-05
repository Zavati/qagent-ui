import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {compileForNode} from './compile-ui-test-sources.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),idx=args.indexOf('--observation');
const observation=path.resolve(idx>=0?args[idx+1]:path.join(root,'../qagent-observation'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qagent-a3-integration-'));
try {if(!fs.existsSync(path.join(observation,'src/ui/bundles/exportService.ts')))throw Error('Use --observation <pasta-do-Observation-0.1.7>');
 const ui=compileForNode(root,path.join(temp,'ui')),obs=compileForNode(observation,path.join(temp,'observation'));
 const r=spawnSync(process.execPath,['--test',path.join(root,'tests/integration.node.cjs')],{stdio:'inherit',env:{...process.env,QAGENT_UI_BUILD:ui,QAGENT_UI_ROOT:root,QAGENT_OBSERVATION_BUILD:obs,QAGENT_OBSERVATION_ROOT:observation}});process.exitCode=r.status??1;
}catch(e){console.error(e.message);process.exitCode=1;}finally{fs.rmSync(temp,{recursive:true,force:true});}
