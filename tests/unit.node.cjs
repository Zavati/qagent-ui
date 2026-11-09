const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {production,sample,uiEnvironment,delivery,SECRET,OPS}=require('./support.cjs');
const build=process.env.QAGENT_UI_BUILD,root=process.env.QAGENT_UI_ROOT,p=production(build);
const {assemble}=require(path.join(build,'src/services/assembler.js'));
const {Repository}=require(path.join(build,'src/storage/repository.js'));
const assembled=(d,profile=d.profile)=>assemble(d.snapshot,d.ref,profile,async id=>{if(!d.bytes.has(id))p.canonical.fail('UI_ARTIFACT_UNAVAILABLE',409);return new Uint8Array(d.bytes.get(id));});
async function fixture(t){const d=await sample(p),f=uiEnvironment(build,root,d);t.after(()=>f.close());return {d,f};}
async function ops(f,op,body){const req=await p.protocol.signedRequest('https://ui.test'+p.protocol.UI_PREFIX+op,body,OPS,'operator');return f.routes.default.fetch(req,f.env);}
async function consumeOne(f,m){const msg=delivery(m);await f.services.consumeBuilds({queue:p.protocol.MAIN_QUEUE,messages:[msg]},f.env);return msg;}

test('contracts: exact A.2 source snapshot and chain are accepted',async()=>{const d=await sample(p);await p.protocol.validateSnapshot(d.snapshot,d.ref);});
test('signed Queue message validates and rejects changed scope',async()=>{const d=await sample(p),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET);await p.protocol.validateMessage(m,SECRET);m.source.scope.projectId='prj_other';await assert.rejects(()=>p.protocol.validateMessage(m,SECRET));});
test('wrong source HMAC does not authorize a build',async()=>{const d=await sample(p),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET);await assert.rejects(()=>p.protocol.validateMessage(m,OPS),/UI_BUNDLE_AUTH_INVALID/);});
test('snapshot corruption is rejected before assembly',async()=>{const d=await sample(p);d.snapshot.events[1].payload.type='CLICK';await assert.rejects(()=>assembled(d),/UI_BUNDLE_SOURCE_HASH_MISMATCH/);});
test('source scope substitution is rejected',async()=>{const d=await sample(p);d.ref.scope={...d.ref.scope,organizationId:'org_other'};await assert.rejects(()=>assembled(d),/UI_BUNDLE_SOURCE_SCOPE_MISMATCH/);});
test('sequence gap is not repaired by ordering or guessing',async()=>{const d=await sample(p);d.snapshot.events[3].sequence=8;d.ref=await d.rehash();await assert.rejects(()=>assembled(d),/UI_BUNDLE_EVENT_INTEGRITY_FAILED/);});
test('tampered content hash is rejected even with a recalculated outer digest',async()=>{const d=await sample(p);d.snapshot.events[0].contentHash='f'.repeat(64);d.ref.sourceHash=await p.canonical.digestJson(d.snapshot);await assert.rejects(()=>assembled(d),/UI_BUNDLE_EVENT_INTEGRITY_FAILED/);});
test('complete synthetic scenario + explicit NONE bootstrap qualifies functional/semantic, not UI approval',async()=>{const d=await sample(p),r=await assembled(d);assert.equal(r.envelope.qualification.overall,'READY');assert.equal(r.envelope.manifestState,'SEALED');assert.equal(r.envelope.qualification.uiTestPassed,false);assert.equal(r.envelope.qualification.apiEvidencePromoted,false);assert.deepEqual(r.envelope.qualification.eligibleModes,['FUNCTIONAL','SEMANTIC']);await p.contracts.validateManifest(r.envelope.bundle);await p.contracts.validateManifest(r.envelope.journey);});
test('same source and profile produce byte-identical manifests',async()=>{const d=await sample(p);const a=await assembled(d),b=await assembled(d);assert.equal(p.canonical.canonicalJson(a),p.canonical.canonicalJson(b));});
test('default bootstrap is unknown, never inferred from first URL',async()=>{const d=await sample(p),r=await assembled(d,p.protocol.DEFAULT_PROFILE);assert.equal(r.envelope.qualification.overall,'NEEDS_ATTENTION');assert.equal(r.envelope.bundle.bootstrap.mode,'UNAVAILABLE');});
test('CONTROLLED_SESSION carries reference only',async()=>{const d=await sample(p),profile={...d.profile,bootstrap:{mode:'CONTROLLED_SESSION',authProfileRef:'authp_synthetic'}};const r=await assembled(d,profile);assert.deepEqual(r.envelope.bundle.bootstrap,profile.bootstrap);assert.equal(JSON.stringify(r).includes('password'),false);});
test('credential contents cannot be smuggled into bootstrap contract',()=>{assert.throws(()=>p.protocol.validateProfile({...p.protocol.DEFAULT_PROFILE,bootstrap:{mode:'CONTROLLED_SESSION',authProfileRef:'authp_test',password:'not-allowed'}}));});
test('new requested revision creates a distinct immutable version',async()=>{const d=await sample(p),a=await p.protocol.identity(d.ref,d.profile),b=await p.protocol.identity(d.ref,{...d.profile,revision:2});assert.equal(a.bundleId,b.bundleId);assert.notEqual(a.bundleVersionId,b.bundleVersionId);});
test('unknown source build remains a provenance blocker',async()=>{const d=await sample(p);d.snapshot.capture.descriptor.sourceBuildRef=null;d.snapshot.capture.descriptor.issues=['SOURCE_BUILD_UNKNOWN'];d.ref=await d.rehash();const r=await assembled(d);assert.equal(r.envelope.qualification.dimensions.provenance.status,'UNAVAILABLE');});
test('304 body absence never becomes complete network fixture',async()=>{const d=await sample(p),x=d.snapshot.events[3].payload;x.response={status:304,bodyRef:null,bodyHash:null,headersRef:'uia_headers',completeness:'PARTIAL'};d.ref=await d.rehash();const r=await assembled(d);assert.equal(r.envelope.qualification.overall,'NEEDS_ATTENTION');assert.equal(r.envelope.bundle.captureCompleteness,'PARTIAL');assert.ok(r.envelope.qualification.dimensions.network.reasonCodes.includes('UI_CACHE_BODY_UNAVAILABLE'));});
test('missing object produces diagnostic-only output, never sealed complete manifest',async()=>{const d=await sample(p);d.bytes.delete('uia_body');const r=await assembled(d);assert.equal(r.envelope.manifestState,'DIAGNOSTIC');assert.equal(r.envelope.bundle,null);assert.ok(r.envelope.diagnostic.interactions.length);});
test('corrupt artifact bytes produce an explicit integrity blocker',async()=>{const d=await sample(p);d.bytes.set('uia_body',Buffer.from('{}'));const r=await assembled(d);assert.equal(r.envelope.manifestState,'DIAGNOSTIC');assert.ok(r.envelope.qualification.dimensions.integrity.reasonCodes.includes('UI_BUNDLE_ARTIFACT_HASH_MISMATCH'));});
test('infrastructure outage is retried, not converted into a diagnostic version',async()=>{const d=await sample(p);await assert.rejects(()=>assemble(d.snapshot,d.ref,d.profile,async()=>{throw Error('network down');}),/network down/);});
test('missing checkpoint documents are qualified explicitly',async()=>{const d=await sample(p);d.snapshot.events[0].payload.documentId='doc_other';d.ref=await d.rehash();const r=await assembled(d);assert.equal(r.envelope.qualification.coverage.documentOccurrences,2);assert.equal(r.envelope.qualification.coverage.documentOccurrencesWithCheckpoint,1);assert.ok(r.envelope.qualification.dimensions.semantic.reasonCodes.includes('UI_DOCUMENT_WITHOUT_CHECKPOINT'));});
test('application CSS/JS observed warnings do not become old-build fixtures',async()=>{const d=await sample(p);d.snapshot.capture.descriptor.issues=['UI_BUILD_STYLESHEET_OBSERVED'];d.ref=await d.rehash();const r=await assembled(d);assert.equal(r.envelope.qualification.overall,'READY');assert.equal(r.envelope.applicationResources.strategy,'EXECUTE_TARGET_BUILD');});
test('same matching context with different responses is ambiguous',async()=>{const d=await sample(p),e=structuredClone(d.snapshot.events[3]);e.eventId='uie_second';e.sequence=5;e.payload.entryId='entry_second';e.payload.requestId='request_second';e.payload.response.status=201;d.snapshot.events.push(e);d.ref=await d.rehash();const r=await assembled(d);assert.ok(r.envelope.qualification.dimensions.network.reasonCodes.includes('UI_MATCH_AMBIGUOUS'));});
test('query pairs and duplicates are preserved exactly',async()=>{const d=await sample(p);d.snapshot.events[3].payload.request.query=[['q','one'],['q','two'],['offset','0']];d.ref=await d.rehash();const r=await assembled(d);assert.deepEqual(r.envelope.bundle.interactions[0].request.query,[['q','one'],['q','two'],['offset','0']]);});
test('signed internal HTTP request rejects altered body and expired timestamp',async()=>{const req=await p.protocol.signedRequest('https://x.test/internal/ui/v1/list',{scope:{organizationId:'org_x',projectId:'prj_x',environmentId:'env_x'}},OPS,'operator');await p.protocol.authenticate(req.clone(),OPS,'operator');const modified=new Request(req.url,{method:'POST',headers:req.headers,body:'{}'});await assert.rejects(()=>p.protocol.authenticate(modified,OPS,'operator'),/UI_BUNDLE_AUTH_INVALID/);const stale=await p.protocol.signedRequest(req.url,{},OPS,'operator',Date.now()-120000);await assert.rejects(()=>p.protocol.authenticate(stale,OPS,'operator'),/UI_BUNDLE_AUTH_EXPIRED/);});
test('operator credential is not accepted as a service principal',async()=>{const req=await p.protocol.signedRequest('https://x.test/internal/ui/v1/capabilities',{},OPS,'operator');await assert.rejects(()=>p.protocol.authenticate(req,SECRET,'source'),/UI_BUNDLE_AUTH_INVALID/);});
test('production worker persists actual immutable manifest and pins source artifacts',async t=>{const {d,f}=await fixture(t),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET),msg=await consumeOne(f,m);assert.equal(msg.acked,true);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);assert.equal(f.pins.size,4);const v=f.db.sql.prepare('SELECT * FROM ui_bundle_versions').get();assert.equal(v.qualification_state,'READY');assert.throws(()=>f.db.sql.prepare("UPDATE ui_bundle_versions SET qualification_state='NEEDS_ATTENTION'").run(),/IMMUTABLE/);});
test('duplicate deliveries do not create duplicate versions or overwrite R2 manifest',async t=>{const {d,f}=await fixture(t),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET);await consumeOne(f,m);const puts=f.bucket.puts;const msg=await consumeOne(f,m);assert.equal(msg.acked,true);assert.equal(f.bucket.puts,puts);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);});
test('consumer stopped: operator request accepts publication without processing',async t=>{const {d,f}=await fixture(t);const r=await ops(f,'build',{scope:d.ref.scope,captureId:d.ref.captureId,profile:d.profile});assert.equal(r.status,202);assert.equal(f.queue.messages.length,1);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,0);await f.services.consumeBuilds({queue:p.protocol.MAIN_QUEUE,messages:f.queue.messages},f.env);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);});
test('failed queue publication is not acknowledged as 202; durable local request can recover',async t=>{const {d,f}=await fixture(t);f.queue.fail=true;const r=await ops(f,'build',{scope:d.ref.scope,captureId:d.ref.captureId,profile:d.profile});assert.equal(r.status,503);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_builds').get().n,1);f.queue.fail=false;await f.services.recoverBuilds(f.env);assert.equal(f.queue.messages.length,1);});
test('ambiguous publication ACK remains idempotent on retry',async t=>{const {d,f}=await fixture(t);f.queue.ambiguous=true;assert.equal((await ops(f,'build',{scope:d.ref.scope,captureId:d.ref.captureId,profile:d.profile})).status,503);f.queue.ambiguous=false;assert.equal((await ops(f,'build',{scope:d.ref.scope,captureId:d.ref.captureId,profile:d.profile})).status,202);for(const m of f.queue.messages)await f.services.consumeBuilds({queue:p.protocol.MAIN_QUEUE,messages:[m]},f.env);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,1);});
test('R2 failure does not publish a version and message is retried',async t=>{const {d,f}=await fixture(t);f.bucket.fail=true;const m=await p.protocol.makeMessage(d.ref,d.profile,SECRET),msg=await consumeOne(f,m);assert.equal(msg.retried,true);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n,0);f.bucket.fail=false;assert.equal((await consumeOne(f,m)).acked,true);});
test('R2 success with lost reply recovers without corrupting object',async t=>{const {d,f}=await fixture(t);f.bucket.afterPutFailure=true;const m=await p.protocol.makeMessage(d.ref,d.profile,SECRET);assert.equal((await consumeOne(f,m)).retried,true);f.bucket.afterPutFailure=false;assert.equal((await consumeOne(f,m)).acked,true);assert.equal(f.bucket.puts,1);});
test('leases fence concurrent builds; duplicated message cannot acquire active lease',async t=>{const {d,f}=await fixture(t),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET),repo=new Repository(f.db);await repo.admit(m);assert.ok(await repo.lease(m.buildId));assert.equal(await repo.lease(m.buildId),null);const msg=await consumeOne(f,m);assert.equal(msg.retried,true);});
test('scope-isolated reads cannot reveal another tenant version',async t=>{const {d,f}=await fixture(t),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET);await consumeOne(f,m);const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;assert.equal((await ops(f,'read',{scope:{...d.ref.scope,organizationId:'org_other'},bundleVersionId:id})).status,404);});
test('valid scoped reads return verified manifest',async t=>{const {d,f}=await fixture(t);await consumeOne(f,await p.protocol.makeMessage(d.ref,d.profile,SECRET));const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;const r=await ops(f,'read',{scope:d.ref.scope,bundleVersionId:id});assert.equal(r.status,200);const b=await r.json();await p.canonical.verifyManifestHash(b);});
test('revocation is separate from immutable evidence and blocks subsequent reads',async t=>{const {d,f}=await fixture(t);await consumeOne(f,await p.protocol.makeMessage(d.ref,d.profile,SECRET));const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;assert.equal((await ops(f,'revoke',{scope:d.ref.scope,bundleVersionId:id})).status,200);assert.equal((await ops(f,'read',{scope:d.ref.scope,bundleVersionId:id})).status,410);assert.equal(f.bucket.data.size,1);});
test('upstream revocation blocks stored manifest read',async t=>{const {d,f}=await fixture(t);await consumeOne(f,await p.protocol.makeMessage(d.ref,d.profile,SECRET));f.revokeSource();const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;assert.equal((await ops(f,'read',{scope:d.ref.scope,bundleVersionId:id})).status,410);});
test('artifact export only permits artifacts in the sealed manifest',async t=>{const {d,f}=await fixture(t);await consumeOne(f,await p.protocol.makeMessage(d.ref,d.profile,SECRET));const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;assert.equal((await ops(f,'artifact',{scope:d.ref.scope,bundleVersionId:id,artifactId:'uia_secret_unrelated'})).status,403);assert.equal((await ops(f,'artifact',{scope:d.ref.scope,bundleVersionId:id,artifactId:'uia_body'})).status,200);});
test('age alone never expires a persisted reference',async t=>{const {d,f}=await fixture(t);await consumeOne(f,await p.protocol.makeMessage(d.ref,d.profile,SECRET));const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;const now=Date.now;Date.now=()=>now()+365*86400000;try{assert.equal((await ops(f,'read',{scope:d.ref.scope,bundleVersionId:id})).status,200);}finally{Date.now=now;}});
test('explicit object loss is diagnosed without changing old qualification',async t=>{const {d,f}=await fixture(t);await consumeOne(f,await p.protocol.makeMessage(d.ref,d.profile,SECRET));d.bytes.delete('uia_body');const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;const r=await ops(f,'inspect',{scope:d.ref.scope,bundleVersionId:id});assert.equal(r.status,200);const b=await r.json();assert.equal(b.dependenciesAvailable,false);assert.equal(b.qualificationAtAssembly,'READY');});
test('bad queue envelope retries then is quarantined without raw payload',async t=>{const {f}=await fixture(t);const msg=delivery({secret:'must-not-be-stored'});await f.services.consumeBuilds({queue:p.protocol.DLQ,messages:[msg]},f.env);assert.equal(msg.acked,true);const row=f.db.sql.prepare('SELECT * FROM ui_bundle_deadletters').get();assert.ok(row);assert.equal(JSON.stringify(row).includes('must-not-be-stored'),false);});
test('unknown paths stay closed, no unauthenticated data endpoint',async t=>{const {f}=await fixture(t);assert.equal((await f.routes.default.fetch(new Request('https://ui.test/'),f.env)).status,404);assert.equal((await f.routes.default.fetch(new Request('https://ui.test/internal/ui/v1/list',{method:'POST',body:'{}'}),f.env)).status,401);});
test('public health contains no credentials or capture data',async t=>{const {f}=await fixture(t);const r=await f.routes.default.fetch(new Request('https://ui.test/health'),f.env);assert.equal(r.status,200);assert.deepEqual(Object.keys(await r.json()).sort(),['service','stage','status','version']);});
test('revoked version does not poison a duplicate successful delivery',async t=>{const {d,f}=await fixture(t),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET);await consumeOne(f,m);const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;await ops(f,'revoke',{scope:d.ref.scope,bundleVersionId:id});assert.equal((await consumeOne(f,m)).acked,true);});
test('oversized contract issue union persists diagnostic instead of truncating issues',async()=>{const d=await sample(p);for(let i=0;i<70;i++){d.snapshot.events.push({eventId:'uie_gap_'+i,sequence:5+i,kind:'GAP',payload:{code:'UI_CUSTOM_GAP_'+i,documentId:'doc_synthetic',stepId:null},contentHash:''});}d.ref=await d.rehash();const r=await assembled(d);assert.equal(r.envelope.manifestState,'DIAGNOSTIC');assert.ok(r.envelope.qualification.issues.length>=70);});

test('source revocation does not poison already completed delivery',async t=>{const {d,f}=await fixture(t),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET);await consumeOne(f,m);f.revokeSource();assert.equal((await consumeOne(f,m)).acked,true);const id=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;assert.equal((await ops(f,'read',{scope:d.ref.scope,bundleVersionId:id})).status,410);});
test('DLQ cannot fail a job with an active fenced lease',async t=>{const {d,f}=await fixture(t),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET),repo=new Repository(f.db);await repo.admit(m);await repo.lease(m.buildId);const msg=delivery(m);await f.services.consumeBuilds({queue:p.protocol.DLQ,messages:[msg]},f.env);assert.equal(msg.retried,true);assert.equal((await repo.getBuild(m.buildId)).status,'BUILDING');});

test('operator CLI HMAC interoperates with the production HTTP verifier',async()=>{const {buildRequest}=await import(require('node:url').pathToFileURL(path.join(root,'tools/ui-ops.mjs')));const cfg={baseUrl:'https://ui.test',scope:{organizationId:'org_synthetic',projectId:'prj_synthetic',environmentId:'env_synthetic'}},r=buildRequest('list',{},cfg,OPS);assert.equal(JSON.stringify(await p.protocol.authenticate(new Request(r.url,r.init),OPS,'operator')),JSON.stringify({scope:cfg.scope}));});
test('operator CLI rejects remote plaintext, redirects in base URL and credential config',async()=>{const cli=await import(require('node:url').pathToFileURL(path.join(root,'tools/ui-ops.mjs')));for(const baseUrl of ['http://ui.test','https://u:secret@ui.test','https://ui.test/?token=x'])assert.throws(()=>cli.buildRequest('health',{}, {baseUrl},null));assert.throws(()=>cli.buildRequest('revoke',{bundle:'urbv_example'}, {baseUrl:'https://ui.test',scope:{organizationId:'org_test',projectId:'prj_test',environmentId:'env_test'}},OPS),/confirm-revoke/);});

// 0.1.1: exact public mount; the signed request's wire path must not be rewritten.
const publicMount='/v1/qagent-ui/';
async function publicOps(f,op,body,secret=OPS,principal='operator'){
 const req=await p.protocol.signedRequest('https://api.example.test'+publicMount+op,body,secret,principal);
 return f.routes.default.fetch(req,f.env);
}
async function cliModule(){return import(require('node:url').pathToFileURL(path.join(root,'tools/ui-ops.mjs')));}

test('public prefix health responds without DB, Queue, R2 or operator credentials',async t=>{
 const {f}=await fixture(t);const r=await f.routes.default.fetch(new Request('https://api.example.test/v1/qagent-ui/health'),{});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'ok',service:'qagent-ui',version:'0.1.2',stage:'08.2-A.3'});
});
test('public prefix never exposes source capabilities or unknown paths',async t=>{
 const {f}=await fixture(t);
 for(const suffix of ['capabilities','unknown','health/','/health']){
  const r=await f.routes.default.fetch(new Request('https://api.example.test'+publicMount+suffix),f.env);assert.equal(r.status,404,suffix);
 }
 for(const pathname of ['/v1/qagent-uix/health','/v1/qagent-ui-extra/health','/v1/observation/health','/v1/plugin/health']){
  assert.equal((await f.routes.default.fetch(new Request('https://api.example.test'+pathname),f.env)).status,404,pathname);
 }
});
test('every mounted operator endpoint still rejects unsigned POST',async t=>{
 const {f}=await fixture(t);
 for(const op of ['list','build','read','artifact','inspect','revoke','build-status']){
  const r=await f.routes.default.fetch(new Request('https://api.example.test'+publicMount+op,{method:'POST',body:'{}'}),f.env);assert.equal(r.status,401,op);
 }
});
test('mounted data endpoints reject GET and the source principal',async t=>{
 const {f,d}=await fixture(t);
 assert.equal((await f.routes.default.fetch(new Request('https://api.example.test'+publicMount+'list'),f.env)).status,401);
 assert.equal((await publicOps(f,'list',{scope:d.ref.scope},SECRET,'source')).status,401);
});
test('internal source capability route still accepts its original signed request',async t=>{
 const {f}=await fixture(t);const req=await p.protocol.signedRequest('https://qagent.internal'+p.protocol.UI_PREFIX+'capabilities',{},SECRET,'source');
 const r=await f.routes.default.fetch(req,f.env);assert.equal(r.status,200);assert.equal((await r.json()).ready,true);
});
test('CLI chooses exact public health and operator paths with or without trailing slash',async()=>{
 const cli=await cliModule();const scope={organizationId:'org_test',projectId:'prj_test',environmentId:'env_test'};
 for(const baseUrl of ['https://api.example.test/v1/qagent-ui','https://api.example.test/v1/qagent-ui/']){
  const health=cli.buildRequest('health',{}, {baseUrl},null);assert.equal(health.url,'https://api.example.test/v1/qagent-ui/health');assert.equal(health.init.redirect,'error');
  const list=cli.buildRequest('list',{}, {baseUrl,scope},OPS);assert.equal(list.url,'https://api.example.test/v1/qagent-ui/list');assert.equal(list.init.redirect,'error');
  assert.equal(JSON.stringify(await p.protocol.authenticate(new Request(list.url,list.init),OPS,'operator')),JSON.stringify({scope}));
 }
});
test('CLI preserves legacy root URLs and Service Binding path signatures',async()=>{
 const cli=await cliModule();const cfg={baseUrl:'https://ui.example.test/',scope:{organizationId:'org_test',projectId:'prj_test',environmentId:'env_test'}};
 assert.equal(cli.buildRequest('health',{},cfg,null).url,'https://ui.example.test/health');
 const req=cli.buildRequest('list',{},cfg,OPS);assert.equal(req.url,'https://ui.example.test/internal/ui/v1/list');
 assert.equal(JSON.stringify(await p.protocol.authenticate(new Request(req.url,req.init),OPS,'operator')),JSON.stringify({scope:cfg.scope}));
});
test('CLI rejects invalid public bases rather than silently dropping their path',async()=>{
 const cli=await cliModule();
 for(const baseUrl of ['http://api.example.test/v1/qagent-ui','https://u:secret@api.example.test/v1/qagent-ui','https://api.example.test/v1/qagent-ui?key=x','https://api.example.test/v1/qagent-ui#fragment','https://api.example.test/v1/qagent-ui-other','https://api.example.test/v1/qagent-ui/health','https://api.example.test/v1/qagent-ui//','https://api.example.test/arbitrary']){
  assert.throws(()=>cli.buildRequest('health',{}, {baseUrl},null),undefined,baseUrl);
 }
 assert.equal(cli.buildRequest('health',{}, {baseUrl:'http://127.0.0.1:8787/v1/qagent-ui'},null).url,'http://127.0.0.1:8787/v1/qagent-ui/health');
});
test('HMAC binds full public path: rewriting to internal path fails authentication',async t=>{
 const {f,d}=await fixture(t);const signed=await p.protocol.signedRequest('https://api.example.test'+publicMount+'list',{scope:d.ref.scope},OPS,'operator');
 const bad=new Request('https://api.example.test'+p.protocol.UI_PREFIX+'list',{method:'POST',headers:signed.headers,body:await signed.text()});
 assert.equal((await f.routes.default.fetch(bad,f.env)).status,401);
});
test('HMAC from internal path cannot be replayed on public mount',async t=>{
 const {f,d}=await fixture(t);const signed=await p.protocol.signedRequest('https://api.example.test'+p.protocol.UI_PREFIX+'list',{scope:d.ref.scope},OPS,'operator');
 const bad=new Request('https://api.example.test'+publicMount+'list',{method:'POST',headers:signed.headers,body:await signed.text()});
 assert.equal((await f.routes.default.fetch(bad,f.env)).status,401);
});
test('public operator workflow: build, status, list, read, inspect, artifact and revoke',async t=>{
 const {f,d}=await fixture(t);const cli=await cliModule();const cfg={baseUrl:'https://api.example.test/v1/qagent-ui',scope:d.ref.scope};
 async function call(op,options={}){const r=cli.buildRequest(op,options,cfg,OPS);return f.routes.default.fetch(new Request(r.url,r.init),f.env);}
 const initial=await call('build',{capture:d.ref.captureId,bootstrap:'none'});assert.equal(initial.status,202);
 const requested=await initial.json();assert.equal(f.queue.messages.length,1);
 assert.equal((await consumeOne(f,f.queue.messages[0].body)).acked,true);
 const status=await call('build-status',{build:requested.buildId});assert.equal(status.status,200);assert.equal((await status.json()).status,'COMPLETE');
 assert.equal((await call('list',{capture:d.ref.captureId})).status,200);
 const bundle=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;
 const read=await call('read',{bundle});assert.equal(read.status,200);await p.canonical.verifyManifestHash(await read.json());
 const inspect=await call('inspect',{bundle});assert.equal(inspect.status,200);assert.equal((await inspect.json()).dependenciesAvailable,true);
 const artifact=await call('artifact',{bundle,artifact:'uia_body'});assert.equal(artifact.status,200);assert.equal(await artifact.text(),d.bytes.get('uia_body').toString());
 assert.equal((await call('revoke',{bundle,'confirm-revoke':true})).status,200);assert.equal((await call('read',{bundle})).status,410);
});
test('public operator scope mismatch and unrelated artifacts stay blocked',async t=>{
 const {f,d}=await fixture(t);await consumeOne(f,await p.protocol.makeMessage(d.ref,d.profile,SECRET));
 const bundleVersionId=(await p.protocol.identity(d.ref,d.profile)).bundleVersionId;
 assert.equal((await publicOps(f,'read',{scope:{...d.ref.scope,organizationId:'org_other'},bundleVersionId})).status,404);
 assert.equal((await publicOps(f,'artifact',{scope:d.ref.scope,bundleVersionId,artifactId:'uia_unrelated'})).status,403);
});


test('0.1.2 retry diagnostics expose safe failing stage without payload or secret',async t=>{
 const {d,f}=await fixture(t),m=await p.protocol.makeMessage(d.ref,d.profile,SECRET),logs=[],orig=console.info;
 f.env.OBSERVATION_SERVICE={fetch:async()=>{throw Error('synthetic transport failure with private details');}};
 console.info=(...args)=>logs.push(args.join(' '));
 try {const msg=delivery(m);await f.services.consumeBuilds({queue:p.protocol.MAIN_QUEUE,messages:[msg]},f.env);assert.equal(msg.retried,true);}
 finally {console.info=orig;}
 const retry=logs.map(x=>{try{return JSON.parse(x)}catch{return null}}).find(x=>x?.event==='build.retry');
 const failed=logs.map(x=>{try{return JSON.parse(x)}catch{return null}}).find(x=>x?.event==='build.stage_failed');
 assert.equal(retry.stage,'source.snapshot');assert.equal(retry.code,'UI_BUNDLE_SERVICE_UNAVAILABLE');
 assert.equal(failed.stage,'source.snapshot');assert.equal(failed.code,'UI_BUNDLE_SERVICE_UNAVAILABLE');
 assert.equal(logs.join('\n').includes('synthetic transport failure with private details'),false);
 assert.equal(logs.join('\n').includes(SECRET),false);
});
