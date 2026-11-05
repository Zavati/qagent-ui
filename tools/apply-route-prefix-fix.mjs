#!/usr/bin/env node
/** Local-only installer. Never runs Wrangler or touches bindings, secrets or databases. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),opts={};
try {
 while(args.length){const k=args.shift();if(!['--target','--apply','--rollback'].includes(k)||Object.hasOwn(opts,k))throw Error('Use --target <checkout> [--apply | --rollback <backup>]');opts[k]=k==='--apply'?true:args.shift();}
 if(typeof opts['--target']!=='string'||!opts['--target'])throw Error('--target obrigatorio');
 if(opts['--apply']&&opts['--rollback'])throw Error('Nao combine --apply e --rollback');
 const target=fs.realpathSync(path.resolve(opts['--target']));
 if(target===fs.realpathSync(source))throw Error('Extraia em pasta separada do checkout antes de aplicar');
 if(JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8')).name!=='qagent-ui')throw Error('O target nao e qagent-ui');
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const textHash=b=>hash(b.toString('utf8').replace(/\r\n/g,'\n'));
 const safe=(root,rel)=>{
  if(!rel||path.isAbsolute(rel)||rel.split(/[\\/]/).some(x=>x==='..'||x===''))throw Error('Caminho invalido no manifesto');
  const dest=path.resolve(root,rel);if(!dest.startsWith(root+path.sep))throw Error('Caminho fora do target');
  let current=root;for(const part of rel.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Symlink nao permitido: '+rel);}
  return dest;
 };
 if(opts['--rollback']){
  const dir=fs.realpathSync(path.resolve(opts['--rollback']));
  const journal=JSON.parse(fs.readFileSync(path.join(dir,'backup.json'),'utf8'));
  if(journal.target!==target)throw Error('Backup pertence a outro target');
  for(const item of journal.files){
   if(textHash(fs.readFileSync(safe(target,item.path)))!==item.after)throw Error('CONFLICT_ROLLBACK: '+item.path);
   if(hash(fs.readFileSync(safe(dir,item.path)))!==item.beforeRaw)throw Error('BACKUP_INVALID: '+item.path);
  }
  for(const item of journal.files)fs.copyFileSync(safe(dir,item.path),safe(target,item.path));
  console.log(JSON.stringify({status:'ROLLED_BACK_LOCAL_ONLY',target,files:journal.files.length}));
 }else{
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'entrega-route/FILES.json'),'utf8'));
  const pending=[],conflicts=[];
  for(const item of manifest.files){
   const src=safe(source,item.path),dest=safe(target,item.path);
   if(textHash(fs.readFileSync(src))!==item.after)throw Error('DELIVERY_INVALID: '+item.path);
   if(!fs.existsSync(dest)){conflicts.push({path:item.path,reason:'MISSING_BASE_FILE'});continue;}
   const before=fs.readFileSync(dest),h=textHash(before);
   if(h===item.after)continue;
   if(h!==item.before){conflicts.push({path:item.path,reason:'LOCAL_CHANGE'});continue;}
   pending.push({...item,bytes:before});
  }
  if(conflicts.length){console.log(JSON.stringify({status:'CONFLICT',conflicts},null,2));process.exitCode=2;}
  else if(!opts['--apply']||!pending.length)console.log(JSON.stringify({status:pending.length?'READY_LOCAL_ONLY':'ALREADY_APPLIED',target,files:pending.map(x=>x.path)},null,2));
  else{
   const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8);
   const backup=path.join(target,'.qagent-route-backups',stamp);fs.mkdirSync(backup,{recursive:true});
   const journal={target,files:pending.map(x=>({path:x.path,beforeRaw:hash(x.bytes),after:x.after}))};
   for(const item of pending){const b=safe(backup,item.path);fs.mkdirSync(path.dirname(b),{recursive:true});fs.writeFileSync(b,item.bytes,{flag:'wx'});}
   fs.writeFileSync(path.join(backup,'backup.json'),JSON.stringify(journal,null,2)+'\n',{flag:'wx'});
   for(const item of pending){const dest=safe(target,item.path);if(hash(fs.readFileSync(dest))!==hash(item.bytes))throw Error('CONCURRENT_CHANGE: '+item.path);}
   for(const item of pending){const dest=safe(target,item.path),temp=dest+'.qagent-route-tmp';fs.writeFileSync(temp,fs.readFileSync(safe(source,item.path)),{flag:'wx'});fs.renameSync(temp,dest);}
   console.log(JSON.stringify({status:'APPLIED_LOCAL_ONLY',target,backup,files:pending.map(x=>x.path)},null,2));
  }
 }
}catch(e){console.error('Operacao interrompida: '+e.message);process.exitCode=1;}
