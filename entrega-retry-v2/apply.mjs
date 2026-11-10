import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),i=args.indexOf('--target');if(i<0||!args[i+1]){console.error('use --target <path> [--apply]');process.exit(2)}
const target=path.resolve(args[i+1]),apply=args.includes('--apply'),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['src/protocol.ts','src/services/buildService.ts','src/storage/repository.ts','src/index.ts','package.json','package-lock.json','tests/support.cjs','tests/unit.node.cjs','tests/integration.node.cjs'];
const protocol=path.join(target,'src/protocol.ts');if(!fs.existsSync(protocol)){console.error('CONFLICT missing src/protocol.ts');process.exit(1)}
const current=fs.readFileSync(protocol,'utf8');if(!current.includes("redirect:'manual'")){console.error('CONFLICT qagent-ui must include Cloudflare redirect manual fix');process.exit(1)}
if(current.includes("BUILDER_VERSION = 'qagent_ui_bundle_builder_v2'")&&fs.existsSync(path.join(target,'src/services/buildService.ts'))&&fs.readFileSync(path.join(target,'src/services/buildService.ts'),'utf8').includes("build.superseded")){console.log('ALREADY_APPLIED');process.exit(0)}
if(!current.includes("BUILDER_VERSION = 'qagent_ui_bundle_builder_v1'")){console.error('CONFLICT unsupported builder baseline');process.exit(1)}
for(const rel of files){if(!fs.existsSync(path.join(root,rel))){console.error('CONFLICT delivery missing '+rel);process.exit(1)}if(!fs.existsSync(path.join(target,rel))){console.error('CONFLICT target missing '+rel);process.exit(1)}}
if(!apply){console.log('READY_LOCAL_ONLY');process.exit(0)}
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backup=path.join(target,'.qagent-a3-retry-backups',stamp);fs.mkdirSync(backup,{recursive:true});
for(const rel of files){const src=path.join(root,rel),dst=path.join(target,rel),bak=path.join(backup,rel);fs.mkdirSync(path.dirname(bak),{recursive:true});fs.copyFileSync(dst,bak);fs.copyFileSync(src,dst)}
console.log('APPLIED '+backup);
