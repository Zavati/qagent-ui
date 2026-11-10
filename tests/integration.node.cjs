const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {observationEnvironment,uiEnvironment,sample,delivery,SECRET,OPS}=require('./support.cjs');
const ob=process.env.QAGENT_OBSERVATION_BUILD,oroot=process.env.QAGENT_OBSERVATION_ROOT,ub=process.env.QAGENT_UI_BUILD,uroot=process.env.QAGENT_UI_ROOT;
async function fixture(t){const obs=observationEnvironment(ob,oroot);const data=await obs.seed();const ui=uiEnvironment(ub,uroot,data);t.after(()=>{obs.close();ui.close();});
 const worker=require(path.join(ob,'src/index.js')).default;
 ui.env.OBSERVATION_SERVICE={fetch:req=>worker.fetch(req,obs.env,{waitUntil:()=>{}})};
 obs.env.UI_BUNDLE_SERVICE={fetch:req=>ui.routes.default.fetch(req,ui.env)};
 return {obs,ui,data,p:ui.p};}
async function consume(ui,m){const message=delivery(m);await ui.services.consumeBuilds({queue:ui.p.protocol.MAIN_QUEUE,messages:[message]},ui.env);return message;}
async function operator(ui,op,body){const r=await ui.p.protocol.signedRequest('https://ui.test'+ui.p.protocol.UI_PREFIX+op,body,OPS,'operator');return ui.routes.default.fetch(r,ui.env);}

test('production Observation export -> queue -> production UI -> manifest -> source acknowledgement',async t=>{const {obs,ui,data}=await fixture(t);await obs.service.recoverBundleExports(obs.env);assert.equal(obs.queue.messages.length,1);const msg=await consume(ui,obs.queue.messages[0].body);assert.equal(msg.acked,true);const v=ui.db.sql.prepare('SELECT * FROM ui_bundle_versions').get();assert.equal(v.manifest_state,'SEALED');assert.equal(v.qualification_state,'NEEDS_ATTENTION');assert.equal(obs.db.sql.prepare('SELECT status FROM ui_bundle_export_outbox').get().status,'DELIVERED');assert.equal(obs.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_artifact_pins').get().n,4);});
test('paused downstream consumer does not change capture reconciliation or lose queued source',async t=>{const {obs,ui}=await fixture(t);await obs.service.recoverBundleExports(obs.env);assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,0);assert.equal(obs.db.sql.prepare('SELECT phase FROM ui_ingestion_sessions').get().phase,'COMPLETE');assert.equal(obs.db.sql.prepare('SELECT status FROM ui_captures').get().status,'RECORDED');const msg=await consume(ui,obs.queue.messages[0].body);assert.equal(msg.acked,true);});
test('source unavailable during assembly retries; recovered source finishes same build',async t=>{const {obs,ui}=await fixture(t);await obs.service.recoverBundleExports(obs.env);obs.bucket.fail=true;assert.equal((await consume(ui,obs.queue.messages[0].body)).retried,true);assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,0);obs.bucket.fail=false;assert.equal((await consume(ui,obs.queue.messages[0].body)).acked,true);});
test('duplicate source message crosses both service boundaries without duplicate versions',async t=>{const {obs,ui}=await fixture(t);await obs.service.recoverBundleExports(obs.env);const m=obs.queue.messages[0].body;await consume(ui,m);await consume(ui,m);assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);assert.equal(obs.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_artifact_pins').get().n,4);});
test('explicit bootstrap profile creates second immutable assembly, keeps old default diagnostic qualification',async t=>{const {obs,ui,data}=await fixture(t);await obs.service.recoverBundleExports(obs.env);await consume(ui,obs.queue.messages[0].body);const request=await operator(ui,'build',{scope:data.ref.scope,captureId:data.ref.captureId,profile:data.profile});assert.equal(request.status,202);await consume(ui,ui.queue.messages[0].body);const versions=ui.db.sql.prepare('SELECT qualification_state FROM ui_bundle_versions ORDER BY qualification_state').all();assert.deepEqual(versions.map(r=>r.qualification_state),['NEEDS_ATTENTION','READY']);});
test('safe manifest and artifact export reads the original private Observation bytes',async t=>{const {obs,ui,data}=await fixture(t);await obs.service.recoverBundleExports(obs.env);await consume(ui,obs.queue.messages[0].body);const v=ui.db.sql.prepare('SELECT bundle_version_id FROM ui_bundle_versions').get();const response=await operator(ui,'artifact',{scope:data.ref.scope,bundleVersionId:v.bundle_version_id,artifactId:'uia_body'});assert.equal(response.status,200);assert.equal(await response.text(),data.bytes.get('uia_body').toString());});
test('retention pin blocks deletion in Observation after asynchronous commit',async t=>{const {obs,ui}=await fixture(t);await obs.service.recoverBundleExports(obs.env);await consume(ui,obs.queue.messages[0].body);assert.throws(()=>obs.db.sql.exec("DELETE FROM ui_artifacts WHERE artifact_id='uia_semantic'"),/PINNED/);});
test('a lost source acknowledgement retries after local commit without duplicating manifest',async t=>{const {obs,ui}=await fixture(t);await obs.service.recoverBundleExports(obs.env);const source=ui.env.OBSERVATION_SERVICE;let once=true;ui.env.OBSERVATION_SERVICE={fetch:async req=>{const r=await source.fetch(req);if(once&&new URL(req.url).pathname.endsWith('/ack')){once=false;throw Error('lost ACK');}return r;}};const m=obs.queue.messages[0].body;assert.equal((await consume(ui,m)).retried,true);assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);assert.equal((await consume(ui,m)).acked,true);assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);});
test('shared protocol and original contract implementations are equivalent across repos',()=>{const a=fs.readFileSync(path.join(oroot,'src/ui/bundles/protocol.ts'),'utf8').replaceAll("from '../contracts/","from './contracts/");assert.equal(a,fs.readFileSync(path.join(uroot,'src/protocol.ts'),'utf8'));for(const name of ['canonical.ts','uiCapture.ts'])assert.equal(fs.readFileSync(path.join(oroot,'src/ui/contracts',name),'utf8'),fs.readFileSync(path.join(uroot,'src/contracts',name),'utf8'));});
test('end-to-end with REAL A.2 admission/reconciliation modules, not only seeded closed rows',async t=>{
 const old=require(path.join(oroot,'test-ui-async/support.cjs'));const f=old.fixture();t.after(()=>f.close());f.db.sql.exec(fs.readFileSync(path.join(oroot,'migrations/0015_ui_bundle_exports.sql'),'utf8'));f.db.sql.exec(fs.readFileSync(path.join(oroot,'migrations/0016_ui_bundle_build_attempts.sql'),'utf8'));
 const p=uiEnvironment;const control=await sample(require('./support.cjs').production(ub));const ui=uiEnvironment(ub,uroot,control);t.after(()=>ui.close());
 const s=await old.start(f),mapped={};
 for(const item of control.snapshot.artifacts){const descriptor=item.descriptor;const admit=await old.call(f,`/v1/ui/captures/${s.id}/artifacts`,s.token,descriptor);assert.equal(admit.status,200);const aid=admit.body.artifact.artifactId;mapped[item.artifactId]=aid;
  const upload=await f.fetch(new Request(`https://obs.test/v1/ui/captures/${s.id}/artifacts/${aid}/content`,{method:'PUT',headers:{authorization:'Bearer '+s.token,'content-type':'application/json'},body:control.bytes.get(item.artifactId)}));assert.equal(upload.status,200);
  const finalize=await old.call(f,`/v1/ui/captures/${s.id}/artifacts/${aid}/finalize`,s.token,{contractVersion:old.CONTRACTS.artifact,sha256:descriptor.sha256,byteLength:descriptor.byteLength});assert.equal(finalize.status,200);
 }
 const events=JSON.parse(JSON.stringify(control.snapshot.events).replace(/uia_(value|headers|body|semantic)/g,id=>mapped[id]));
 for(const e of events){const {contentHash,...rest}=e;e.contentHash=await old.digestJson(rest);}
 assert.equal((await old.post(f,s,'events',{contractVersion:old.CONTRACTS.events,operationId:'op_integration_events',events})).status,202);
 const seal=await old.seal(events,'RECORDED');assert.equal((await old.post(f,s,'seal',seal)).status,202);await old.consume(f);
 assert.equal((await old.status(f,s)).body.ingestion.phase,'COMPLETE');
 const source=require(path.join(ob,'src/ui/bundles/exportService.js'));const Q=require('./support.cjs').Queue;const downstream=new Q();
 Object.assign(f.env,{UI_BUNDLE_EXPORT_ENABLED:'true',UI_BUNDLE_SOURCE_SECRET:SECRET,UI_BUNDLE_BUILD_QUEUE:downstream,UI_BUNDLE_SERVICE:{fetch:req=>ui.routes.default.fetch(req,ui.env)}});
 ui.env.OBSERVATION_SERVICE={fetch:req=>source.routeBundleSource(req,f.env)};
 await source.recoverBundleExports(f.env);assert.equal(downstream.messages.length,1);const msg=await consume(ui,downstream.messages[0].body);assert.equal(msg.acked,true);
 assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);assert.equal(f.db.sql.prepare('SELECT phase FROM ui_ingestion_sessions').get().phase,'COMPLETE');
});

test('historical failed build remains immutable while builder v2 completes a new build for the same capture',async t=>{
 const {obs,ui,data}=await fixture(t);await obs.service.recoverBundleExports(obs.env);const current=obs.queue.messages[0].body;
 const oldBuild='uib_'+ 'c'.repeat(64),now=Date.now();
 ui.db.sql.prepare("INSERT INTO ui_bundle_builds(build_id,organization_id,project_id,environment_id,capture_id,source_hash,request_hash,message_json,status,created_at,updated_at,next_dispatch_at,last_error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(oldBuild,data.ref.scope.organizationId,data.ref.scope.projectId,data.ref.scope.environmentId,data.ref.captureId,data.ref.sourceHash,'d'.repeat(64),'{}','FAILED',now,now,now,'UI_BUNDLE_SERVICE_UNAVAILABLE');
 const msg=await consume(ui,current);assert.equal(msg.acked,true);
 assert.equal(ui.db.sql.prepare('SELECT status FROM ui_bundle_builds WHERE build_id=?').get(oldBuild).status,'FAILED');
 assert.equal(ui.db.sql.prepare('SELECT status FROM ui_bundle_builds WHERE build_id=?').get(current.buildId).status,'COMPLETE');
 assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);
});

test('stale old rejection after v2 publish does not poison the active export',async t=>{
 const {obs,ui}=await fixture(t);await obs.service.recoverBundleExports(obs.env);const current=obs.queue.messages[0].body;
 const old='uib_'+ 'e'.repeat(64);const req=await ui.p.protocol.signedRequest('https://obs.test'+ui.p.protocol.SOURCE_PREFIX+'ack',{source:current.source,buildId:old,bundleVersionId:null,disposition:'REJECTED'},SECRET,'source');
 const stale=await obs.service.routeBundleSource(req,obs.env);assert.equal(stale.status,200);assert.equal((await stale.json()).applied,false);
 assert.equal(obs.db.sql.prepare('SELECT status FROM ui_bundle_export_outbox').get().status,'PUBLISHED');
 await consume(ui,current);assert.equal(obs.db.sql.prepare('SELECT status FROM ui_bundle_export_outbox').get().status,'DELIVERED');
});
