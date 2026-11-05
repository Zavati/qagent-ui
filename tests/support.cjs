const {DatabaseSync}=require('node:sqlite');
const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const SECRET='synthetic-source-secret-for-a3-tests-not-a-real-credential-12345';
const OPS='synthetic-operator-secret-for-a3-tests-separate-from-source-67890';
class D1 {
 constructor(){this.sql=new DatabaseSync(':memory:');this.sql.exec('PRAGMA foreign_keys=ON');this.calls=0;this.fail=false;this.failPattern=null;}
 prepare(text){const db=this;return {text,args:[],bind(...args){this.args=args;return this;},
  async all(){db.check(text);return {success:true,results:db.sql.prepare(text).all(...this.args),meta:{changes:0}};},
  async first(column){db.check(text);const r=db.sql.prepare(text).get(...this.args);return r?(column?r[column]:r):null;},
  async run(){db.check(text);const r=db.sql.prepare(text).run(...this.args);return {success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}
 check(text){this.calls++;if(this.fail || (this.failPattern&&text.includes(this.failPattern)))throw Error('Injected SQLite/D1 transport failure');}
 async batch(statements){this.sql.exec('BEGIN');try{const out=[];for(const s of statements){this.check(s.text);const results=this.sql.prepare(s.text).all(...s.args);const changes=this.sql.prepare('SELECT changes() AS n').get().n;out.push({success:true,results,meta:{changes:Number(changes)}});}this.sql.exec('COMMIT');return out;}catch(e){this.sql.exec('ROLLBACK');throw e;}}
 close(){this.sql.close();}
}
class R2 {
 constructor(){this.data=new Map();this.puts=0;this.reads=0;this.fail=false;this.afterPutFailure=false;}
 async head(key){if(this.fail)throw Error('Injected R2 failure');const b=this.data.get(key);return b?{size:b.length,key}:null;}
 async put(key,value,options={}){if(this.fail)throw Error('Injected R2 failure');const b=Buffer.from(value);if(options.sha256 && crypto.createHash('sha256').update(b).digest('hex')!==options.sha256)throw Error('checksum mismatch');if(options.onlyIf?.etagDoesNotMatch==='*'&&this.data.has(key))return null;this.data.set(key,Buffer.from(b));this.puts++;if(this.afterPutFailure)throw Error('Injected ambiguous R2 ACK');return {key,size:b.length};}
 async get(key){if(this.fail)throw Error('Injected R2 failure');this.reads++;const b=this.data.get(key);return b?{key,size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;}
}
function delivery(body){return {id:crypto.randomUUID(),body:structuredClone(body),attempts:1,timestamp:new Date(),acked:false,retried:false,ack(){this.acked=true;},retry(o){this.retried=true;this.retryOptions=o;}};}
class Queue {constructor(){this.messages=[];this.fail=false;this.ambiguous=false;}async send(body){if(this.fail)throw Error('Injected queue outage');this.messages.push(delivery(body));if(this.ambiguous)throw Error('Injected lost Queue publish ACK');}}
function production(compiled,prefix='src'){return {canonical:require(path.join(compiled,prefix,'contracts/canonical.js')),contracts:require(path.join(compiled,prefix,'contracts/uiCapture.js')),protocol:require(path.join(compiled,prefix==='src'?'src/protocol.js':'src/ui/bundles/protocol.js'))};}
async function sample(p,options={}) {
 const scope=options.scope??{organizationId:'org_synthetic',projectId:'prj_synthetic',environmentId:'env_synthetic'};
 const captureId=options.captureId??'uic_synthetic_control';const artifacts=[];const bytes=new Map();const C=p.contracts.CONTRACTS;
 async function artifact(artifactId,kind,value){const data=Buffer.from(JSON.stringify(value));const d={contractVersion:C.artifact,operationId:'op_'+artifactId,kind,contentType:'application/json',byteLength:data.length,sha256:await p.canonical.sha256(new Uint8Array(data)),privacy:{policyVersion:p.contracts.PRIVACY_VERSION,representation:'SANITIZED_JSON',dataOrigin:'SYNTHETIC_CONTROL',transformations:[]}};artifacts.push({artifactId,descriptor:d,status:'FINALIZED'});bytes.set(artifactId,data);return artifactId;}
 await artifact('uia_value','ACTION_VALUE_JSON',{value:'sample query'});
 await artifact('uia_headers','HEADERS_JSON',[['content-type','application/json']]);
 await artifact('uia_body','RESPONSE_JSON',{data:[{id:1,name:'Sample item'}]});
 await artifact('uia_semantic','SEMANTIC_JSON',{version:'qagent.ui-semantic.v1',viewport:{width:1280,height:720,deviceScaleFactor:1,scrollX:0,scrollY:0},renderProfile:{locale:'en-US',timezoneId:'UTC',colorScheme:'light',userAgent:'synthetic-control'},elements:[{tag:'h1',text:'Items',visible:true}],textPolicy:'SYNTHETIC_CONTROL'});
 const target={primaryLocator:{strategy:'CSS',value:'#query'},candidateLocators:[{strategy:'CSS',value:'#query'}],observedMatchCount:1,framePath:[]};
 const common={documentId:'doc_synthetic',navigationId:'nav_synthetic'};
 const payloads=[
 ['ACTION',{contractVersion:C.action,actionId:'act_nav',stepId:'step_nav',sequence:0,...common,relativeTimeMs:0,type:'NAVIGATE',destination:'https://app.example.test/items'}],
 ['ACTION',{contractVersion:C.action,actionId:'act_fill',stepId:'step_fill',sequence:1,...common,relativeTimeMs:100,type:'FILL',target,input:{source:'SYNTHETIC_CONTROL',valueRef:'uia_value'}}],
 ['ACTION',{contractVersion:C.action,actionId:'act_click',stepId:'step_click',sequence:2,...common,relativeTimeMs:200,type:'CLICK',target:{...target,primaryLocator:{strategy:'CSS',value:'#search'}}}],
 ['INTERACTION',{contractVersion:C.interaction,entryId:'entry_list',requestId:'request_list',stepId:'step_click',...common,relativeTimeMs:250,logicalServiceKey:'main',request:{method:'GET',origin:'https://app.example.test',path:'/api/items',query:[['q','sample query']],bodyRef:null,businessHeadersRef:'uia_headers'},response:{status:200,bodyRef:'uia_body',headersRef:'uia_headers',bodyHash:artifacts.find(a=>a.artifactId==='uia_body').descriptor.sha256,completeness:'COMPLETE'},consumption:{required:true,minimum:1,maximum:1},correlationBasis:'NAVIGATION_AND_STEP_WINDOW',issues:[]}],
 ['CHECKPOINT',{contractVersion:C.checkpoint,checkpointId:'check_list',stepId:'step_click',sequence:4,...common,relativeTimeMs:500,stability:{kind:'DOM_QUIET',durationMs:500},functionalRef:'uia_semantic',semanticRef:'uia_semantic',screenshotRef:null,modalities:{functional:'AVAILABLE',semantic:'AVAILABLE',visual:'UNAVAILABLE'},issues:[]}]];
 const events=[];for(let i=0;i<payloads.length;i++){const e={eventId:'uie_'+i,sequence:i,kind:payloads[i][0],payload:payloads[i][1]};events.push({...e,contentHash:await p.canonical.digestJson(e)});}
 const descriptor={contractVersion:C.capture,operationId:'op_'+captureId,dataOrigin:'SYNTHETIC_CONTROL',documentId:'doc_synthetic',entryUrl:'https://app.example.test/items',sourceBuildRef:'build_synthetic_reference',issues:[]};
 const completion={contractVersion:C.capture,operationId:'op_seal_'+captureId,outcome:'RECORDED',issues:[]};
 const snapshot={contractVersion:p.protocol.SOURCE_VERSION,exporterVersion:p.protocol.EXPORTER_VERSION,scope,captureId,sourceRevision:await p.canonical.digestJson(completion),capture:{descriptor,completion,status:'RECORDED',createdAt:1700000000000,completedAt:1700000010000,origins:['https://app.example.test']},ingestion:{expectedEvents:events.length,lastSequence:events.length-1,eventChainHash:''},events,artifacts};
 async function rehash(){let chain='0'.repeat(64);for(const e of snapshot.events){const {contentHash,...raw}=e;e.contentHash=await p.canonical.digestJson(raw);chain=await p.canonical.digestJson([chain,e.sequence,e.contentHash]);}snapshot.ingestion={expectedEvents:snapshot.events.length,lastSequence:snapshot.events.length-1,eventChainHash:chain};snapshot.sourceRevision=await p.canonical.digestJson(snapshot.capture.completion);return {contractVersion:p.protocol.SOURCE_REF_VERSION,exporterVersion:p.protocol.EXPORTER_VERSION,scope:snapshot.scope,captureId:snapshot.captureId,sourceRevision:snapshot.sourceRevision,sourceHash:await p.canonical.digestJson(snapshot)};}
 const ref=await rehash();return {snapshot,ref,bytes,rehash,profile:{contractVersion:p.protocol.PROFILE_VERSION,revision:1,bootstrap:{mode:'NONE',authProfileRef:null}}};
}
async function seedObservation(db,bucket,p,data){const s=data.snapshot,scope=Object.values(s.scope);const c=s.capture;
 db.sql.prepare('INSERT INTO ui_captures(capture_id,organization_id,project_id,environment_id,plugin_session_id,grant_jti,operation_id,request_hash,descriptor_json,origins_json,created_at,ingestion_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
 .run(s.captureId,...scope,'psn_'+s.captureId,'qugj_'+s.captureId,c.descriptor.operationId,await p.canonical.digestJson(c.descriptor),p.canonical.canonicalJson(c.descriptor),JSON.stringify(c.origins),c.createdAt,'qagent.ui-ingestion.v1');
 for(const a of s.artifacts){const d=a.descriptor,key='synthetic/'+s.captureId+'/'+a.artifactId;db.sql.prepare('INSERT INTO ui_artifacts(artifact_id,capture_id,organization_id,project_id,environment_id,operation_id,descriptor_hash,descriptor_json,object_key,expected_bytes,expected_hash,created_at,status,finalized_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(a.artifactId,s.captureId,...scope,d.operationId,await p.canonical.digestJson(d),p.canonical.canonicalJson(d),key,d.byteLength,d.sha256,c.createdAt,a.status,c.completedAt);if(data.bytes.has(a.artifactId))bucket.data.set(key,Buffer.from(data.bytes.get(a.artifactId)));}
 for(const e of s.events){const text=p.canonical.canonicalJson(e);db.sql.prepare('INSERT INTO ui_capture_events(capture_id,organization_id,project_id,environment_id,event_id,sequence,kind,content_hash,event_json,byte_length) VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.captureId,...scope,e.eventId,e.sequence,e.kind,e.contentHash,text,Buffer.byteLength(text));}
 db.sql.prepare('UPDATE ui_captures SET status=?,completed_at=?,completion_hash=?,completion_json=? WHERE capture_id=?').run(c.status,c.completedAt,s.sourceRevision,p.canonical.canonicalJson(c.completion),s.captureId);
 db.sql.prepare("INSERT INTO ui_ingestion_sessions(capture_id,organization_id,project_id,environment_id,contract_version,phase,expected_events,last_sequence,event_chain_hash,created_at,updated_at) VALUES(?,?,?,?,?,'COMPLETE',?,?,?,?,?)").run(s.captureId,...scope,'qagent.ui-ingestion.v1',s.ingestion.expectedEvents,s.ingestion.lastSequence,s.ingestion.eventChainHash,c.createdAt,c.completedAt);
}
function observationEnvironment(compiled,root){const p=production(compiled,'src/ui'),db=new D1(),bucket=new R2(),queue=new Queue();for(const name of ['0013_ui_capture_artifacts.sql','0014_ui_async_ingestion.sql','0015_ui_bundle_exports.sql'])db.sql.exec(fs.readFileSync(path.join(root,'migrations',name),'utf8'));
 const service=require(path.join(compiled,'src/ui/bundles/exportService.js'));
 const env={OBSERVATION_DB:db,UI_ARTIFACTS:bucket,UI_BUNDLE_BUILD_QUEUE:queue,UI_BUNDLE_SOURCE_SECRET:SECRET,UI_BUNDLE_EXPORT_ENABLED:'true',UI_BUNDLE_SERVICE:{fetch:async req=>{await p.protocol.authenticate(req,SECRET,'source');return p.protocol.json({ready:true,sourceVersion:p.protocol.SOURCE_VERSION,buildRequestVersion:p.protocol.BUILD_REQUEST_VERSION});}}};
 return {p,env,db,bucket,queue,service,close(){db.close();},async seed(options){const d=await sample(p,options);await seedObservation(db,bucket,p,d);return d;}};
}
function uiEnvironment(compiled,root,data){const p=production(compiled),db=new D1(),bucket=new R2(),queue=new Queue();db.sql.exec(fs.readFileSync(path.join(root,'migrations/0001_ui_bundles.sql'),'utf8'));
 const routes=require(path.join(compiled,'src/index.js'));const services=require(path.join(compiled,'src/services/buildService.js'));
 const calls=[],pins=new Set();let revoked=false;
 const sourceBinding={fetch:async req=>{try{const body=await p.protocol.authenticate(req,SECRET,'source'),op=new URL(req.url).pathname.split('/').pop();calls.push(op);
  if(revoked)p.canonical.fail('UI_BUNDLE_SOURCE_REVOKED',410);
  const source=op==='resolve'?{scope:body.scope,captureId:body.captureId}:op==='snapshot'||op==='status'?body:body.source;
  if(!p.protocol.sameScope(source.scope,data.snapshot.scope)||source.captureId!==data.snapshot.captureId)p.canonical.fail('UI_BUNDLE_SOURCE_NOT_FOUND',404);
  if(op==='resolve')return p.protocol.json({source:data.ref});
  if(source.sourceHash!==data.ref.sourceHash)p.canonical.fail('UI_BUNDLE_SOURCE_HASH_MISMATCH',409);
  if(op==='snapshot')return p.protocol.json(data.snapshot);
  if(op==='status')return p.protocol.json({status:'ok'});
  if(op==='pin'){body.artifactIds.forEach(id=>pins.add(id));return p.protocol.json({status:'ok',pinned:body.artifactIds.length,pinnedArtifactIds:body.artifactIds,unavailableArtifactIds:[]});}
  if(op==='artifact'){if(!data.bytes.has(body.artifactId))p.canonical.fail('UI_ARTIFACT_UNAVAILABLE',409);return new Response(data.bytes.get(body.artifactId));}
  if(op==='ack')return p.protocol.json({status:'ok'});
  return new Response(null,{status:404});
 }catch(e){return p.protocol.safeFailure(e);}}};
 const env={UI_DB:db,UI_BUNDLES:bucket,UI_BUNDLE_BUILD_QUEUE:queue,OBSERVATION_SERVICE:sourceBinding,UI_BUNDLE_SOURCE_SECRET:SECRET,UI_BUNDLE_OPERATOR_SECRET:OPS,UI_BUNDLE_BUILD_ENABLED:'true'};
 return {p,env,db,bucket,queue,routes,services,calls,pins,revokeSource(){revoked=true;},close(){db.close();}};
}
module.exports={D1,R2,Queue,delivery,production,sample,seedObservation,observationEnvironment,uiEnvironment,SECRET,OPS};
