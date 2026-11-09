import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import process from 'node:process';
const args=process.argv.slice(2),targetArg=args[args.indexOf('--target')+1],apply=args.includes('--apply');
if(!targetArg)throw Error('use --target <qagent-ui checkout> [--apply]');
const target=path.resolve(targetArg),root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/,m=>m.slice(1))),filesRoot=path.join(root,'files');
const files=['src/services/buildService.ts','src/index.ts','package.json','package-lock.json','tests/unit.node.cjs','README.md','QAGENT-UI-0.1.2-DIAGNOSTICO-STAGE.md'];
const pkg=JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8'));if(!['0.1.1','0.1.2'].includes(pkg.version))throw Error('CONFLICT: expected qagent-ui 0.1.1/0.1.2, got '+pkg.version);
const backup=path.join(target,'.qagent-stage-backups',new Date().toISOString().replace(/[:.]/g,'-'));
if(!apply){console.log('READY_LOCAL_ONLY');console.log(files.join('\n'));process.exit(0)}
fs.mkdirSync(backup,{recursive:true});
for(const rel of files){const src=path.join(filesRoot,rel),dst=path.join(target,rel);if(fs.existsSync(dst)){const b=path.join(backup,rel);fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(dst,b)}fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst)}
console.log('APPLIED');console.log('backup='+backup);console.log('wrangler.toml preserved');
