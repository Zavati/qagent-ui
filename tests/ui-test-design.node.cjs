const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {fixture,h,contract,compileObservedBundle}=require('./test-design-support.cjs');
const {canonicalJson,digestJson}=h.c;
const route=require(path.join(process.env.QAGENT_UI_BUILD,'src/index.js')).default;
const TD_SECRET='synthetic-test-design-secret-independent-from-operator-and-source';
async function envelope(d){return (await d.base.assemble()).envelope;}
async function reseal(e){delete e.manifestHash;e.manifestHash=await digestJson(e);return e;}
async function deployed(d){const e=await h.environment(d.base);e.env.UI_TEST_DESIGN_SECRET=TD_SECRET;await e.consume(await h.protocol.makeMessage(d.base.ref,h.protocol.DEFAULT_PROFILE,h.support.SECRET));return e;}
async function request(env,op,body,secret=TD_SECRET,principal='test-design'){
 return route.fetch(await h.protocol.signedRequest('https://ui.internal/internal/ui/v1/test-design/'+op,body,secret,principal),env);
}

test('compiles observed DOM/form/layout into one finite paired design with honest source limitations',async()=>{
 const d=await fixture(),r=await d.compile();assert.equal(r.outcome,'COMPILED');assert.equal(r.executionPerformed,false);const s=r.specification;
 assert.deepEqual(s.executionModes,['UI_REPLAY','UI_LIVE']);assert.equal(s.steps.length,1);assert.equal(s.steps[0].operator,'NAVIGATE');
 for(const operator of ['ELEMENT_PRESENT','ATTRIBUTE_EQUALS','TEXT_EQUALS','FORM_VALUE_EQUALS','CHECKED_EQUALS','BOUNDS_WITHIN_TOLERANCE','STYLE_EQUALS','URL_MATCHES','REQUEST_MATCHES','FIXTURE_CONSUMPTION_MATCHES'])assert.ok(s.assertions.some(a=>a.operator===operator),operator);
 assert.equal(s.assertions.find(a=>a.operator==='TEXT_EQUALS').expected,'Items');assert.deepEqual(s.assertions.find(a=>a.operator==='BOUNDS_WITHIN_TOLERANCE').expected,[20,60,240,32]);
 assert.ok(s.assertions.every(a=>a.policies.UI_REPLAY==='FIXED'&&a.policies.UI_LIVE==='OBSERVED_DIFF'));
 assert.deepEqual(s.bindings,[]);assert.ok(s.timeline.every(x=>x.causalProof===false));assert.equal(s.preparation.observedResponsesRestoreWholeState,false);
 assert.equal(s.readiness.UI_REPLAY.status,'REQUIRES_CONFIGURATION');assert.ok(s.limitations.includes('SOURCE_BUILD_UNKNOWN'));assert.equal(s.executionPerformed,false);
 assert.equal(await digestJson(s),r.specificationHash);assert.equal(s.coverage.artifactsVerified,d.base.artifacts.length);assert.ok(Buffer.byteLength(canonicalJson(r))<768*1024);
 if(process.env.QAGENT_UI_TD_FIXTURE_EXPORT)fs.writeFileSync(process.env.QAGENT_UI_TD_FIXTURE_EXPORT,JSON.stringify(r,null,2)+'\n');
});
test('canonical deterministic output ignores object key order and does not mutate sealed source',async()=>{
 const d=await fixture(),e=await envelope(d),before=canonicalJson(e),reader=async id=>new Uint8Array(d.base.bytes.get(id));
 const one=await compileObservedBundle(e,reader),reordered=Object.fromEntries(Object.entries(e).reverse()),two=await compileObservedBundle(reordered,reader);
 assert.deepEqual(one,two);assert.equal(canonicalJson(e),before);
 const profile={...contract.DEFAULT_TEST_DESIGN_PROFILE,layoutTolerancePx:3},three=await compileObservedBundle(e,reader,profile);assert.notEqual(one.specificationHash,three.specificationHash);
 assert.throws(()=>contract.validateTestDesignProfile({...profile,provider:'x'}));assert.throws(()=>contract.validateTestDesignProfile({}));
});
test('304 missing representation blocks replay only, is preserved and never fabricated',async()=>{
 const d=await fixture();d.base.network.payload.response={...d.base.network.payload.response,status:304,networkStatus:304,replayStatus:304,bodyRef:null,bodyHash:null,bodyState:'MISSING',bodySource:'UNAVAILABLE',completeness:'PARTIAL'};
 d.base.network.payload.issues=['UI_CACHE_BODY_UNAVAILABLE'];await d.base.rehash();const r=await d.compile(),s=r.specification;
 assert.equal(r.outcome,'COMPILED');assert.equal(s.network.fixtures[0].response.bodyRef,null);assert.equal(s.network.fixtures[0].response.replayStatus,304);
 assert.equal(s.readiness.UI_REPLAY.status,'BLOCKED');assert.equal(s.readiness.UI_LIVE.status,'REQUIRES_CONFIGURATION');assert.equal(s.coverage.unavailableFixtures,1);assert.equal(s.network.matching.liveBusinessFallback,false);
});
test('changed bytes fail before any specification can be published',async()=>{
 const d=await fixture(),e=await envelope(d);await assert.rejects(compileObservedBundle(e,async id=>id===d.dom.artifactId?new Uint8Array([1,2]):new Uint8Array(d.base.bytes.get(id))),e=>e.code==='UI_BUNDLE_ARTIFACT_HASH_MISMATCH');
});
test('artifact document mismatch and fixture response mismatch are rejected even with a resealed manifest',async()=>{
 const d=await fixture(),e=await envelope(d),raw=JSON.parse(d.base.bytes.get(d.form.artifactId));raw.documentId='doc_other';const bytes=Buffer.from(JSON.stringify(raw)),r=e.bundle.artifacts.find(a=>a.artifactId===d.form.artifactId);r.sha256=await h.c.sha256(new Uint8Array(bytes));r.byteLength=bytes.length;await reseal(e);
 await assert.rejects(compileObservedBundle(e,async id=>id===d.form.artifactId?new Uint8Array(bytes):new Uint8Array(d.base.bytes.get(id))),e=>e.code==='UI_TEST_DESIGN_ARTIFACT_CONTEXT_MISMATCH');
 const changed=JSON.parse(canonicalJson(await envelope(d)));changed.bundle.fixtures[0].response.replayStatus=201;await reseal(changed);await assert.rejects(compileObservedBundle(changed,async id=>new Uint8Array(d.base.bytes.get(id))),e=>e.code==='UI_TEST_DESIGN_NETWORK_CONTEXT_MISMATCH');
});
test('unstable-only reference yields NO_DESIGN, never zero-check PASS',async()=>{
 const d=await fixture({unstable:true}),r=await d.compile();assert.equal(r.outcome,'NO_DESIGN');assert.equal(r.specification,null);assert.equal(r.specificationHash,null);assert.ok(r.summary.reasonCodes.includes('UI_TEST_DESIGN_NO_UI_CHECKS'));
});
test('action evidence keeps null post-state and marks unsupported locator without inventing it',async()=>{
 const d=await fixture(),v=await d.base.artifact('ACTION_VALUE_JSON',{value:'query'},'uia_fill');d.base.add('ACTION',{contractVersion:h.pc.PAGE_CONTRACTS.action,...d.base.common(3,40000),actionId:'act_fill',type:'FILL',target:{primaryLocator:{strategy:'CSS',value:'#query'},candidateLocators:[],observedMatchCount:2,framePath:[]},input:{source:'OBSERVED_ENVIRONMENT_MANAGED',valueRef:v.artifactId},stateBeforeId:'state_one',stateAfterId:null});await d.base.rehash();
 const s=(await d.compile()).specification;assert.equal(s.steps[1].stateAfterId,null);assert.equal(s.steps[1].availability,'UNSUPPORTED');assert.equal(s.readiness.UI_REPLAY.status,'BLOCKED');assert.equal(s.readiness.UI_LIVE.status,'BLOCKED');
});
test('duplicate test IDs use structural remapping and preserve local ID only as evidence',async()=>{
 const d=await fixture();d.nodes.find(n=>n.nodeId==='node_query').attributes.push(['data-testid','active']);await d.replace(d.dom,{contractVersion:'qagent.ui-dom-snapshot.v1',documentId:d.base.doc,nodes:d.nodes});await d.base.rehash();
 const s=(await d.compile()).specification,a=s.assertions.find(a=>a.locator?.sourceNodeId==='node_active');assert.equal(a.locator.strategy,'CSS');assert.ok(a.locator.value.includes('nth-of-type'));assert.notEqual(a.locator.value,'node_active');
});
async function manyCheckpoints(d,count=26){
 for(let i=1;i<count;i++){const p=structuredClone(d.base.checkpoint.payload);p.checkpointId='check_many_'+i;p.observedSequence=2+i;p.relativeTimeUs=29000+i*10000;p.relativeTimeMs=Math.floor(p.relativeTimeUs/1000);p.pageCapture={...p.pageCapture,stateId:'state_many_'+i,stateSequence:i,observedSequence:p.observedSequence,captureStartedUs:p.relativeTimeUs,captureFinishedUs:p.relativeTimeUs+1000};d.base.add('CHECKPOINT',p);}
 await d.base.rehash();
}
test('per-checkpoint quotas generate useful designs from many states and explicitly account exclusions',async()=>{
 const d=await fixture();await manyCheckpoints(d);const r=await d.compile({...contract.DEFAULT_TEST_DESIGN_PROFILE,maxChecks:104});
 assert.equal(r.outcome,'COMPILED');assert.ok(r.specification.coverage.checksExcluded>0);assert.equal(new Set(r.specification.assertions.filter(a=>a.stateId).map(a=>a.stateId)).size,26);
 assert.ok(Buffer.byteLength(canonicalJson(r))<=768*1024);assert.equal(r.specification.steps.length,1);assert.equal(r.specification.network.fixtures.length,1);
});
test('representative 26 checkpoints and 500 DOM fields retain complete dependencies within publication budget',async(t)=>{
 const d=await fixture();for(let i=0;i<500;i++)d.nodes.push({nodeId:'node_large_'+i,parentId:'node_main',nodeType:1,name:'input',attributes:[['data-testid','field-'+i],['type','text'],['name','field-'+i]],text:''});
 await d.replace(d.dom,{contractVersion:'qagent.ui-dom-snapshot.v1',documentId:d.base.doc,nodes:d.nodes});await manyCheckpoints(d);const r=await d.compile();
 assert.equal(r.outcome,'COMPILED');const s=r.specification;assert.equal(s.checkpoints.length,26);assert.equal(new Set(s.assertions.filter(a=>a.stateId).map(a=>a.stateId)).size,26);
 assert.ok(s.coverage.checksExcluded>0);assert.equal(s.network.fixtures.length,1);assert.equal(s.evidence.artifacts.length,d.base.artifacts.length);assert.ok(Buffer.byteLength(canonicalJson(r))<768*1024);
 t.diagnostic(JSON.stringify({publicationBytes:Buffer.byteLength(canonicalJson(r)),checks:s.assertions.length,checksExcluded:s.coverage.checksExcluded,nodesConsidered:s.coverage.nodesConsidered}));
});
test('finite budgets produce explicit NO_DESIGN before expensive artifact reads',async()=>{
 const d=await fixture(),e=await envelope(d);let reads=0;const r=await compileObservedBundle(e,async id=>{reads++;return new Uint8Array(d.base.bytes.get(id));},{...contract.DEFAULT_TEST_DESIGN_PROFILE,maxArtifactBytes:1024});assert.equal(r.outcome,'NO_DESIGN');assert.equal(reads,0);assert.ok(r.summary.reasonCodes.includes('UI_TEST_DESIGN_ARTIFACT_BUDGET_EXCEEDED'));
});
test('routes use separate HMAC, scope, immutable access, and never mutate a bundle',async()=>{
 const d=await fixture(),ui=await deployed(d);try{const {row}=ui.stored(),body={scope:d.base.scope,bundleVersionId:row.bundle_version_id,compilerVersion:contract.COMPILER_VERSION},before=Buffer.from(ui.bucket.data.get(row.object_key));
 const response=await request(ui.env,'compile',body);assert.equal(response.status,200);assert.equal((await response.json()).outcome,'COMPILED');assert.deepEqual(ui.bucket.data.get(row.object_key),before);
 const operator=await request(ui.env,'compile',body,h.support.OPS,'operator');assert.equal(operator.status,401);
 const crossed=await request(ui.env,'compile',{...body,scope:{...body.scope,organizationId:'org_other'}});assert.equal(crossed.status,404);
 const source=await request(ui.env,'source',{scope:body.scope,bundleVersionId:body.bundleVersionId,expectedManifestHash:row.manifest_hash});assert.equal(source.status,200);
 const stale=await request(ui.env,'source',{scope:body.scope,bundleVersionId:body.bundleVersionId,expectedManifestHash:'a'.repeat(64)});assert.equal(stale.status,409);
 const {Repository}=require(path.join(process.env.QAGENT_UI_BUILD,'src/storage/repository.js'));await new Repository(ui.db).revoke(body.scope,body.bundleVersionId);assert.equal((await request(ui.env,'compile',body)).status,410);
 }finally{ui.close();}
});
test('sources report inaccessible observed candidates, filter nonobserved bundles and do not claim inventory snapshot',async()=>{
 const d=await fixture(),ui=await deployed(d);try{const response=await request(ui.env,'sources',{scope:d.base.scope,limit:1}),r=await response.json();assert.equal(response.status,200);assert.equal(r.items.length,1);assert.equal(r.pagination.inventoryComplete,false);assert.equal(r.items[0].eligibility,'OBSERVED_SOURCE_AVAILABLE');
 const {Repository}=require(path.join(process.env.QAGENT_UI_BUILD,'src/storage/repository.js'));await new Repository(ui.db).revoke(d.base.scope,r.items[0].bundleVersionId);const hidden=await (await request(ui.env,'sources',{scope:d.base.scope,limit:1})).json();assert.equal(hidden.items.length,0);assert.equal(hidden.diagnostics[0].code,'UI_BUNDLE_ACCESS_REVOKED');
 }finally{ui.close();}
});

test('sources keyset pagination traverses unreadable candidates and binds cursor to scope',async()=>{
 const d=await fixture(),ui=await deployed(d);try{
  await ui.consume(await h.protocol.makeMessage(d.base.ref,{contractVersion:h.protocol.PROFILE_VERSION,revision:2,bootstrap:{mode:'NONE',authProfileRef:null}},h.support.SECRET));
  const rows=ui.db.sql.prepare('SELECT bundle_version_id FROM ui_bundle_versions ORDER BY bundle_version_id').all();assert.equal(rows.length,2);
  const {Repository}=require(path.join(process.env.QAGENT_UI_BUILD,'src/storage/repository.js'));await new Repository(ui.db).revoke(d.base.scope,rows[0].bundle_version_id);
  const first=await (await request(ui.env,'sources',{scope:d.base.scope,limit:1})).json();assert.equal(first.items.length,0);assert.ok(first.nextCursor);assert.equal(first.diagnostics[0].bundleVersionId,rows[0].bundle_version_id);
  const second=await (await request(ui.env,'sources',{scope:d.base.scope,limit:1,cursor:first.nextCursor})).json();assert.equal(second.items.length,1);assert.equal(second.items[0].bundleVersionId,rows[1].bundle_version_id);assert.equal(second.nextCursor,null);
  const crossed=await request(ui.env,'sources',{scope:{...d.base.scope,organizationId:'org_other'},limit:1,cursor:first.nextCursor});assert.equal(crossed.status,403);
 }finally{ui.close();}
});

test('transport quota removes only checks with explicit coverage and retains complete source dependencies',async(t)=>{
 const d=await fixture();for(let i=0;i<300;i++)d.nodes.push({nodeId:'node_quota_'+i,parentId:'node_main',nodeType:1,name:'input',attributes:[['data-testid','quota-'+i],['type','text'],['name','quota-'+i]],text:''});
 await d.replace(d.dom,{contractVersion:'qagent.ui-dom-snapshot.v1',documentId:d.base.doc,nodes:d.nodes});await manyCheckpoints(d);
 const e=await envelope(d),original=e.pageIndex.documents[0];for(let i=0;i<76;i++)e.pageIndex.documents.push({...original,documentId:'doc_quota_'+i,initialUrl:'https://app.example.test/'+String(i)+'/'+('x'.repeat(7500))});await reseal(e);
 const r=await compileObservedBundle(e,async id=>new Uint8Array(d.base.bytes.get(id)));assert.equal(r.outcome,'COMPILED');assert.ok(r.specification.limitations.includes('UI_TEST_DESIGN_TRANSPORT_CHECK_BUDGET'));
 assert.equal(r.specification.evidence.documents.length,e.pageIndex.documents.length);assert.equal(r.specification.network.fixtures.length,e.bundle.fixtures.length);assert.equal(r.specification.steps.length,e.journey.actions.length);assert.ok(Buffer.byteLength(canonicalJson(r))<=768*1024);
 t.diagnostic(JSON.stringify({transportBytes:Buffer.byteLength(canonicalJson(r)),remainingChecks:r.specification.assertions.length}));
});

test('existing sanitized r1 and archived bodies without status remain compatible without invented fixtures',async()=>{
 const sanitized=await fixture({environmentManaged:false});assert.equal((await sanitized.compile()).outcome,'COMPILED');
 const d=await fixture();d.base.network.payload.response={...d.base.network.payload.response,status:null,networkStatus:null,replayStatus:null};d.base.network.payload.issues=['UI_NETWORK_STATUS_UNVERIFIED'];await d.base.rehash();
 const r=await d.compile();assert.equal(r.outcome,'COMPILED');assert.equal(r.specification.network.fixtures[0].response.bodyState,'COMPLETE');assert.equal(r.specification.network.fixtures[0].response.replayStatus,null);assert.equal(r.specification.readiness.UI_REPLAY.status,'BLOCKED');
});
test('already-proven cached representation preserves 304 network status, 200 replay status and original proof',async()=>{
 const d=await fixture();await d.base.cache304();const r=await d.compile(),cached=r.specification.network.fixtures.find(f=>f.response.networkStatus===304);
 assert.equal(r.outcome,'COMPILED');assert.equal(cached.response.replayStatus,200);assert.equal(cached.response.cacheEvidenceVerified,true);assert.ok(cached.response.cacheEvidence.representationId);assert.equal(cached.availability,'READY');
});

test('known omitted keyboard action remains a blocker rather than invented executable evidence',async()=>{
 const d=await fixture();d.base.completion.issues.push('UI_KEY_ACTION_UNSUPPORTED');await d.base.rehash();const r=await d.compile();assert.equal(r.outcome,'COMPILED');
 assert.equal(r.specification.steps.length,1);assert.equal(r.specification.readiness.UI_REPLAY.status,'BLOCKED');assert.equal(r.specification.readiness.UI_LIVE.status,'BLOCKED');assert.ok(r.specification.readiness.UI_LIVE.reasonCodes.includes('UI_KEY_ACTION_UNSUPPORTED'));assert.equal(r.specification.coverage.capabilitiesExcluded,1);
});
