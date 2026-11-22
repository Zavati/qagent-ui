const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {fixture,h}=require('./test-design-support.cjs');
const {compileObservedPlan,observedPlanPage}=require(path.join(process.env.QAGENT_UI_BUILD,'src/services/uiObservedPlan.js'));
const {readTestDesignPlanPage,TEST_DESIGN_COMPILE_TIMEOUT_MS}=require(path.join(process.env.QAGENT_UI_BUILD,'src/services/uiTestDesignService.js'));
const guard=require(path.join(process.env.QAGENT_UI_BUILD,'src/contracts/uiObservedPlanGuard.js'));
const worker=require(path.join(process.env.QAGENT_UI_BUILD,'src/index.js')).default;
const SECRET='synthetic-ui-reference-plan-secret-for-tests-only';
async function data(options={}){const d=await fixture(options);return{d,envelope:(await d.base.assemble()).envelope,read:async id=>new Uint8Array(d.base.bytes.get(id))};}
async function seal(e){delete e.manifestHash;e.manifestHash=await h.c.digestJson(e);return e;}
async function page(c,input){const plan=await compileObservedPlan(c.envelope);return observedPlanPage(c.envelope,{specification:plan.specification,specificationHash:plan.specificationHash,...input},SECRET,c.read);}
async function all(c,section,extra={}){let cursor,rows=[],pages=0,total;do{const p=await page(c,{section,cursor,limit:100,...extra});rows.push(...p.items);cursor=p.nextCursor??undefined;total=p.totalItems;assert.ok(++pages<10000);}while(cursor);assert.equal(rows.length,total);return rows;}
async function replace(c,artifactId,value,raw=false){const bytes=Buffer.from(raw?value:JSON.stringify(value)),ref=c.envelope.bundle.artifacts.find(a=>a.artifactId===artifactId);ref.sha256=await h.c.sha256(new Uint8Array(bytes));ref.byteLength=bytes.length;c.d.base.bytes.set(artifactId,bytes);await seal(c.envelope);}
async function deployed(){const d=await fixture(),ui=await h.environment(d.base);ui.env.UI_TEST_DESIGN_SECRET=SECRET;await ui.consume(await h.protocol.makeMessage(d.base.ref,h.protocol.DEFAULT_PROFILE,h.support.SECRET));return{d,ui,...ui.stored()};}
async function request(env,op,body,secret=SECRET,principal='test-design'){return worker.fetch(await h.protocol.signedRequest('https://ui.internal/internal/ui/v1/test-design/'+op,body,secret,principal),env);}

test('reference recipe includes every source section, two modes and no eager artifact download or invented validations',async()=>{
 const c=await data(),r=await compileObservedPlan(c.envelope),s=r.specification;
 assert.equal(r.outcome,'COMPILED');guard.validateUiObservedPlanShape(s);assert.equal(s.plan.selection,'ALL_OBSERVED');assert.equal(s.plan.pendingCannotPass,true);assert.equal(s.plan.completion,'ALL_SECTIONS_AND_ARTIFACT_CONTENT');
 assert.deepEqual(s.executionModes,['UI_REPLAY','UI_LIVE']);assert.equal(s.coverage.artifactsReadDuringCompilation,0);assert.equal(s.coverage.validationUnitsExecuted,0);assert.equal(s.coverage.checksGenerated,0);assert.equal(s.evidenceVerification.artifactBytes,'VERIFIED_AT_BUNDLE_ASSEMBLY');
 for(const key of ['steps','checkpoints','assertions','network','evidence'])assert.equal(Object.hasOwn(s,key),false);
 assert.equal(s.plan.sections.length,9);assert.equal(s.coverage.actionsPlanned,c.envelope.journey.actions.length);assert.equal(s.coverage.referencedArtifacts,c.envelope.bundle.artifacts.length);assert.ok(JSON.stringify(r).length<16384);
 assert.equal(await h.c.digestJson(s),r.specificationHash);assert.equal(r.executionPerformed,false);
 const golden=JSON.parse(fs.readFileSync(path.join(process.env.QAGENT_UI_ROOT,'fixtures/ui-test-design-compilation.v2.json')));assert.deepEqual(r,golden);
});
test('metadata larger than the former 768 KiB output ceiling yields a compact reference design with all documents',async t=>{
 const c=await data(),before=await compileObservedPlan(c.envelope),doc=c.envelope.pageIndex.documents[0];
 for(let i=0;i<120;i++)c.envelope.pageIndex.documents.push({...doc,documentId:'doc_long_'+i,initialUrl:'https://app.example.test/'+i+'/'+('x'.repeat(7500))});
 await seal(c.envelope);assert.ok(JSON.stringify(c.envelope).length>768*1024);const r=await compileObservedPlan(c.envelope);
 assert.equal(r.outcome,'COMPILED');assert.equal(r.specification.coverage.documentsTotal,121);assert.ok(JSON.stringify(r).length<16384);assert.ok(JSON.stringify(r).length-JSON.stringify(before).length<1000);
 const docs=await all(c,'DOCUMENTS');assert.equal(docs.length,121);assert.equal(docs.at(-1).sourceRef.pointer,'/pageIndex/documents/120');assert.equal(docs[0].validation.status,'PLANNED');
 t.diagnostic(JSON.stringify({sourceBytes:JSON.stringify(c.envelope).length,referenceDesignBytes:JSON.stringify(r).length,documents:docs.length}));
});
test('unstable or empty UI evidence remains a generated plan with explicit pending obligations',async()=>{
 const c=await data({unstable:true}),r=await compileObservedPlan(c.envelope);assert.equal(r.outcome,'COMPILED');assert.equal(r.specification.coverage.stableCheckpoints,0);assert.equal(r.specification.coverage.checkpointsPlanned,1);
 const checkpoints=await all(c,'CHECKPOINTS');assert.equal(checkpoints[0].validation.status,'PENDING');assert.ok(checkpoints[0].validation.reasonCodes.includes('UI_TEST_DESIGN_CHECKPOINT_UNSTABLE'));
 const fields=await all(c,'ARTIFACT_CONTENT',{artifactId:c.d.dom.artifactId});assert.ok(fields.every(row=>row.validation.status==='PENDING'));assert.ok(fields.every(row=>row.validation.reasonCodes.includes('UI_TEST_DESIGN_CHECKPOINT_UNSTABLE')));
 c.envelope.pageIndex.states=[];await seal(c.envelope);assert.equal((await compileObservedPlan(c.envelope)).outcome,'COMPILED');assert.equal((await all(c,'CHECKPOINTS')).length,0);
});
test('source artifact verification claims must match the immutable assembly counts',async()=>{
 const c=await data();c.envelope.qualification.counts.verifiedArtifacts--;await seal(c.envelope);await assert.rejects(compileObservedPlan(c.envelope),e=>e.code==='UI_TEST_DESIGN_SOURCE_INTEGRITY_INCONSISTENT');
});
test('deterministic recipe changes with source/profile and accepts both observed exporters',async()=>{
 for(const environmentManaged of [true,false]){const c=await data({environmentManaged}),a=await compileObservedPlan(c.envelope),b=await compileObservedPlan(Object.fromEntries(Object.entries(c.envelope).reverse()));assert.deepEqual(a,b);
 const other=await compileObservedPlan(c.envelope,{...guard.UI_OBSERVED_DEFAULT_PROFILE,layoutTolerancePx:3});assert.notEqual(other.specificationHash,a.specificationHash);}
 assert.throws(()=>guard.validateUiObservedProfileShape({...guard.UI_OBSERVED_DEFAULT_PROFILE,maxChecks:5000}));
});
test('all action pages traverse the entire source without a journey-wide page quota',async()=>{
 const c=await data(),base=c.envelope.journey.actions[0];for(let i=1;i<257;i++)c.envelope.journey.actions.push({...base,actionId:'act_page_'+i,eventId:'evt_page_'+i,observedSequence:i*2});await seal(c.envelope);
 const rows=await all(c,'ACTIONS');assert.equal(rows.length,257);assert.equal(new Set(rows.map(r=>r.sourceRef.pointer)).size,257);assert.deepEqual(rows.map(r=>r.index),Array.from({length:257},(_,i)=>i));assert.equal(rows.at(-1).sourceRef.pointer,'/journey/actions/256');
});
test('more than 2000 JSON values are all addressable; long previews never become expected values',async()=>{
 const c=await data(),bodyId=c.envelope.bundle.fixtures[0].response.bodyRef,values=Array.from({length:2200},(_,i)=>({id:i,text:i===2199?'last-value-'+('z'.repeat(10000)):'row-'+i}));
 await replace(c,bodyId,{rows:values});const rows=await all(c,'ARTIFACT_CONTENT',{artifactId:bodyId});assert.equal(rows.length,6602);const last=rows.find(r=>r.sourceRef.pointer==='/rows/2199/text');assert.ok(last);assert.equal(last.preview.previewOnly,true);assert.equal(last.preview.previewTruncated,true);assert.equal(last.preview.length,10011);assert.equal(last.sourceRef.sha256,c.envelope.bundle.artifacts.find(a=>a.artifactId===bodyId).sha256);assert.ok(rows.every(r=>r.validation.rule==='ARTIFACT_JSON_VALUE'));
});
test('new manifest fields and unknown DOM fields remain explicit pending references',async()=>{
 const c=await data();c.envelope.newObservedData={novel:true,values:[null,'preserved']};await seal(c.envelope);
 const metadata=await all(c,'SOURCE_METADATA');for(const p of ['/newObservedData','/newObservedData/novel','/newObservedData/values/0','/newObservedData/values/1'])assert.ok(metadata.some(row=>row.sourceRef.pointer===p&&row.validation.status==='PENDING'),p);
 const dom=JSON.parse(c.d.base.bytes.get(c.d.dom.artifactId));dom.nodes[0].futureAttribute={important:'evidence'};await replace(c,c.d.dom.artifactId,dom);
 const content=await all(c,'ARTIFACT_CONTENT',{artifactId:c.d.dom.artifactId}),unknown=content.find(row=>row.sourceRef.pointer==='/nodes/0/futureAttribute/important');assert.ok(unknown);assert.equal(unknown.validation.status,'PENDING');assert.ok(unknown.validation.reasonCodes.includes('UI_TEST_DESIGN_UNKNOWN_FIELD_COMPARATOR_PENDING'));
});
test('signed cursors cannot cross sections/artifacts/specifications or be edited',async()=>{
 const c=await data(),r=await compileObservedPlan(c.envelope),input={specification:r.specification,specificationHash:r.specificationHash,section:'SOURCE_METADATA',limit:1};
 const one=await observedPlanPage(c.envelope,input,SECRET,c.read);assert.ok(one.nextCursor);
 await assert.rejects(observedPlanPage(c.envelope,{...input,section:'ARTIFACTS',cursor:one.nextCursor},SECRET,c.read),e=>e.code==='UI_TEST_DESIGN_CURSOR_CONTEXT_MISMATCH');
 const edited=one.nextCursor.slice(0,-1)+(one.nextCursor.endsWith('0')?'1':'0');await assert.rejects(observedPlanPage(c.envelope,{...input,cursor:edited},SECRET,c.read),e=>e.code==='UI_TEST_DESIGN_CURSOR_INVALID');
 const p=await page(c,{section:'ARTIFACT_CONTENT',artifactId:c.d.dom.artifactId,limit:1});await assert.rejects(page(c,{section:'ARTIFACT_CONTENT',artifactId:c.d.form.artifactId,cursor:p.nextCursor}),e=>e.code==='UI_TEST_DESIGN_CURSOR_CONTEXT_MISMATCH');
 await assert.rejects(observedPlanPage(c.envelope,{...input,specificationHash:'0'.repeat(64)},SECRET,c.read),e=>e.code==='UI_TEST_DESIGN_HASH_MISMATCH');
});
test('artifact bytes are hash-checked before content pages; missing and unreferenced evidence is rejected',async()=>{
 const c=await data(),r=await compileObservedPlan(c.envelope),input={specification:r.specification,specificationHash:r.specificationHash,section:'ARTIFACT_CONTENT',artifactId:c.d.dom.artifactId};
 await assert.rejects(observedPlanPage(c.envelope,input,SECRET,async()=>new Uint8Array([1])),e=>e.code==='UI_BUNDLE_ARTIFACT_HASH_MISMATCH');
 await assert.rejects(page(c,{section:'ARTIFACT_CONTENT',artifactId:'uia_unreferenced'}),e=>e.code==='UI_BUNDLE_ARTIFACT_NOT_REFERENCED');
});
test('duplicate JSON keys retain the entire original as an explicit unreadable pending artifact',async()=>{
 const c=await data(),body=c.envelope.bundle.fixtures[0].response.bodyRef;await replace(c,body,'{"field":1,"field":2}',true);
 const rows=await all(c,'ARTIFACT_CONTENT',{artifactId:body});assert.equal(rows.length,1);assert.equal(rows[0].validation.rule,'ARTIFACT_OPAQUE_BYTES');assert.equal(rows[0].sourceRef.pointer,'');assert.ok(rows[0].validation.reasonCodes.includes('UI_TEST_DESIGN_ARTIFACT_JSON_UNREADABLE'));
});
test('portable guard rejects missing sections, false coverage, silent omissions and false execution',async()=>{
 const c=await data(),r=await compileObservedPlan(c.envelope);
 for(const mutate of [s=>s.plan.sections.pop(),s=>s.coverage.validationUnitsExecuted=1,s=>s.plan.silentOmissionAllowed=true,s=>s.plan.pendingCannotPass=false,s=>s.coverage.actionsPlanned=0,s=>s.executionPerformed=true]){const s=structuredClone(r.specification);mutate(s);assert.throws(()=>guard.validateUiObservedPlanShape(s));}
 const p=await page(c,{section:'ACTIONS'});p.items[0].validation.rule='SOURCE_METADATA_ALL';assert.throws(()=>guard.validateUiObservedPlanPageShape(p));
});
test('v2 route downloads no blobs and preserves v1 while evidence pages recheck scope/access',async t=>{
 t.mock.method(console,'info',()=>{});const c=await deployed();try{const original=c.ui.env.OBSERVATION_SERVICE.fetch;let reads=0;c.ui.env.OBSERVATION_SERVICE={fetch:async req=>{if(new URL(req.url).pathname.endsWith('/artifact'))reads++;return original(req);}};
 const body={scope:c.d.base.scope,bundleVersionId:c.row.bundle_version_id,compilerVersion:guard.UI_OBSERVED_COMPILER_VERSION};let response=await request(c.ui.env,'compile',body);assert.equal(response.status,200);const r=await response.json();assert.equal(reads,0);assert.equal(r.contractVersion,'qagent.ui-test-design-compilation.v2');
 const pageInput={scope:body.scope,specification:r.specification,specificationHash:r.specificationHash,section:'ARTIFACT_CONTENT',artifactId:c.d.dom.artifactId,limit:1};response=await request(c.ui.env,'plan-page',pageInput);assert.equal(response.status,200);assert.equal(reads,1);assert.equal((await response.json()).items.length,1);
 assert.equal((await request(c.ui.env,'plan-page',{...pageInput,scope:{...body.scope,organizationId:'org_wrong'}})).status,403);
 assert.equal((await request(c.ui.env,'plan-page',pageInput,h.support.OPS,'operator')).status,401);
 response=await request(c.ui.env,'compile',{...body,compilerVersion:'qagent_ui_test_design_compiler_v1'});assert.equal(response.status,200);assert.equal((await response.json()).contractVersion,'qagent.ui-test-design-compilation.v1');
 const {Repository}=require(path.join(process.env.QAGENT_UI_BUILD,'src/storage/repository.js'));await new Repository(c.ui.db).revoke(body.scope,body.bundleVersionId);assert.equal((await request(c.ui.env,'plan-page',pageInput)).status,410);
 }finally{c.ui.close();}
});
test('whole-page deadline bounds a stalled manifest read independently of per-blob deadlines',async t=>{
 const c=await deployed();try{const r=await compileObservedPlan(c.envelope),schedule=globalThis.setTimeout;t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>schedule(fn,delay===TEST_DESIGN_COMPILE_TIMEOUT_MS?20:delay,...args));c.ui.env.UI_BUNDLES={get:async()=>new Promise(()=>{})};
 await assert.rejects(readTestDesignPlanPage(c.ui.env,c.d.base.scope,{specification:r.specification,specificationHash:r.specificationHash,section:'ACTIONS'}),e=>e.code==='UI_TEST_DESIGN_PLAN_READ_TIMEOUT'&&e.status===504);
 }finally{c.ui.close();}
});
