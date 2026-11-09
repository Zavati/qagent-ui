import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2);const i=args.indexOf('--target');if(i<0||!args[i+1]){console.error('use --target <path> [--apply]');process.exit(2)}
const target=path.resolve(args[i+1]),apply=args.includes('--apply');
const p=path.join(target,'src','protocol.ts');if(!fs.existsSync(p)){console.error('CONFLICT missing src/protocol.ts');process.exit(1)}
let s=fs.readFileSync(p,'utf8');if(s.includes("redirect:'manual'")){console.log('ALREADY_APPLIED');process.exit(0)}
if(!s.includes("redirect:'error'")){console.error('CONFLICT redirect setting not recognized');process.exit(1)}
if(!apply){console.log('READY_LOCAL_ONLY');process.exit(0)}
s=s.replace("redirect:'error'","redirect:'manual'");fs.writeFileSync(p,s);console.log('APPLIED');
