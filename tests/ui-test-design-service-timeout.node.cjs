const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture,h,contract,compileObservedBundle}=require('./test-design-support.cjs');
const {compileTestDesign,TEST_DESIGN_COMPILE_TIMEOUT_MS}=require(path.join(process.env.QAGENT_UI_BUILD,'src/services/uiTestDesignService.js'));
const worker=require(path.join(process.env.QAGENT_UI_BUILD,'src/index.js')).default;
const SECRET='synthetic-ui-compile-runtime-secret-for-tests-only';
const TRACE='11111111-2222-4333-8444-555555555555';
async function setup(){
  const d=await fixture(),ui=await h.environment(d.base);
  ui.env.UI_TEST_DESIGN_SECRET=SECRET;
  await ui.consume(await h.protocol.makeMessage(d.base.ref,h.protocol.DEFAULT_PROFILE,h.support.SECRET));
  const stored=ui.stored();assert.ok(stored.row);
  return {d,ui,...stored};
}
function logs(t){
  const rows=[];t.mock.method(console,'info',value=>{const row=JSON.parse(value);if(row.t==='qagent_ui_test_design')rows.push(row);});return rows;
}
test('runtime logs correlate compilation without entering the immutable specification',async t=>{
  const c=await setup();try{
    const expected=await compileObservedBundle(c.envelope,async id=>new Uint8Array(c.d.base.bytes.get(id)));
    const rows=logs(t),body={scope:c.d.base.scope,bundleVersionId:c.row.bundle_version_id,compilerVersion:contract.COMPILER_VERSION};
    const req=await h.protocol.signedRequest('https://ui.internal/internal/ui/v1/test-design/compile',body,SECRET,'test-design');
    req.headers.set('X-QAgent-UI-Test-Design-Request-Id',TRACE);
    const response=await worker.fetch(req,c.ui.env);assert.equal(response.status,200);
    const actual=await response.json();assert.deepEqual(actual,expected);
    assert.ok(rows.length>=5);assert.ok(rows.every(row=>row.requestId===TRACE));
    assert.equal(rows[0].event,'compile.started');assert.equal(rows.at(-1).event,'compile.completed');
    const progress=rows.filter(row=>row.event==='compile.progress').at(-1);
    assert.equal(progress.totalArtifacts,c.envelope.bundle.artifacts.length);
    assert.equal(progress.verifiedArtifacts,progress.totalArtifacts);
    assert.equal(progress.verifiedBytes,c.envelope.bundle.artifacts.reduce((sum,a)=>sum+a.byteLength,0));
    assert.ok(rows.some(row=>row.stage==='source.recheck'));
    assert.ok(!JSON.stringify(rows).includes('https://app.example.test'));
    assert.ok(!JSON.stringify(actual).includes(TRACE));
  }finally{c.ui.close();}
});
test('local deadline bounds a stalled envelope read and exposes its stage',async t=>{
  const c=await setup();try{
    const rows=logs(t),schedule=globalThis.setTimeout;
    t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>schedule(callback,delay===TEST_DESIGN_COMPILE_TIMEOUT_MS?20:delay,...args));
    c.ui.env.UI_BUNDLES={get:async()=>new Promise(()=>{})};
    await assert.rejects(compileTestDesign(c.ui.env,c.d.base.scope,c.row.bundle_version_id,contract.COMPILER_VERSION),e=>e.code==='UI_TEST_DESIGN_COMPILE_TIMEOUT'&&e.status===504);
    const last=rows.at(-1);assert.equal(last.event,'compile.failed');assert.equal(last.stage,'source.envelope');
    assert.equal(last.code,'UI_TEST_DESIGN_COMPILE_TIMEOUT');assert.equal(last.verifiedArtifacts,0);
  }finally{c.ui.close();}
});
test('caller cancellation stops admission even when an artifact binding ignores abort',async t=>{
  const c=await setup();try{
    const rows=logs(t),controller=new AbortController(),original=c.ui.env.OBSERVATION_SERVICE.fetch;
    let artifactReads=0;
    c.ui.env.OBSERVATION_SERVICE={fetch:async request=>{
      if(new URL(request.url).pathname.endsWith('/artifact')){
        artifactReads++;queueMicrotask(()=>controller.abort(new Error('private caller detail')));
        return new Promise(()=>{});
      }
      return original(request);
    }};
    await assert.rejects(compileTestDesign(c.ui.env,c.d.base.scope,c.row.bundle_version_id,contract.COMPILER_VERSION,undefined,{signal:controller.signal}),e=>e.code==='UI_TEST_DESIGN_COMPILE_CANCELLED'&&e.status===499);
    const count=artifactReads;await new Promise(resolve=>setImmediate(resolve));
    assert.ok(count>=1&&count<=4);assert.equal(artifactReads,count);
    assert.equal(rows.at(-1).event,'compile.failed');assert.ok(!JSON.stringify(rows).includes('private caller detail'));
    assert.ok(!rows.some(row=>row.event==='compile.completed'));
  }finally{c.ui.close();}
});
test('a source revoked after verification still prevents successful compilation',async t=>{
  const c=await setup();try{
    const rows=logs(t),original=c.ui.env.OBSERVATION_SERVICE.fetch;let statusCalls=0;
    c.ui.env.OBSERVATION_SERVICE={fetch:async request=>{
      if(new URL(request.url).pathname.endsWith('/status')&&++statusCalls===2)
        return h.protocol.json({status:'error',code:'UI_BUNDLE_SOURCE_REVOKED'},410);
      return original(request);
    }};
    await assert.rejects(compileTestDesign(c.ui.env,c.d.base.scope,c.row.bundle_version_id,contract.COMPILER_VERSION),e=>e.code==='UI_BUNDLE_SOURCE_REVOKED'&&e.status===410);
    assert.equal(statusCalls,2);assert.equal(rows.at(-1).stage,'source.recheck');
    assert.ok(!rows.some(row=>row.event==='compile.completed'));
  }finally{c.ui.close();}
});
