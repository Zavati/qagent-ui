const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const build=process.env.QAGENT_UI_BUILD;
const {SourceClient}=require(path.join(build,'src/services/sourceClient.js'));
const {UiError}=require(path.join(build,'src/contracts/canonical.js'));
const {authenticate}=require(path.join(build,'src/protocol.js'));
const SECRET='synthetic-source-io-secret-with-at-least-32-characters';
const source={contractVersion:'qagent.ui-bundle-source-ref.v2',exporterVersion:'qagent_ui_page_environment_source_v2',
    scope:{organizationId:'org_test',projectId:'prj_test',environmentId:'env_test'},captureId:'uic_test',sourceRevision:'a'.repeat(64),sourceHash:'b'.repeat(64)};
const client=fetch=>new SourceClient({UI_BUNDLE_SOURCE_SECRET:SECRET,OBSERVATION_SERVICE:{fetch}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const timeout=error=>error instanceof UiError&&error.status===504&&error.code==='UI_BUNDLE_SOURCE_READ_TIMEOUT';

// Synchronize on stream operations, not event-loop turns or elapsed wall time.
// A zero high-water mark prevents pull() until the production reader requests bytes.
function stalledResponse({status=200,cancelNever=false}={}){
    const reading=deferred(),cancelled=deferred(),released=deferred();let cancelCalls=0;
    const body=new ReadableStream({
        pull(){reading.resolve();return new Promise(()=>{});},
        cancel(){cancelCalls++;cancelled.resolve();if(cancelNever)return new Promise(()=>{});}
    },{highWaterMark:0});
    const getReader=body.getReader.bind(body);
    body.getReader=(...args)=>{
        const reader=getReader(...args),release=reader.releaseLock.bind(reader);
        reader.releaseLock=()=>{release();released.resolve();};return reader;
    };
    return {response:new Response(body,{status}),reading:reading.promise,cancelled:cancelled.promise,released:released.promise,get cancelCalls(){return cancelCalls;}};
}

// Observe rejection immediately, and abort/settle in finally even if an assertion fails.
// Waiting for a test event also stops immediately if the production call rejects first.
function operation(run,parent=new AbortController()){
    const pending=run(parent.signal),settled=pending.then(()=>{},()=>{});
    return {pending,parent,wait:event=>Promise.race([event,pending.then(()=>{throw new Error('source call completed before test event');})]),
        async cleanup(){if(!parent.signal.aborted)parent.abort(new Error('source I/O test cleanup'));await settled;}};
}

test('artifact deadline rejects a headers stall even when binding ignores abort',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const reached=deferred();let signal;
    const run=operation(parentSignal=>client(request=>{signal=request.signal;reached.resolve();return new Promise(()=>{});}).artifact(source,'uia_stall',{signal:parentSignal}));
    try {
        await run.wait(reached.promise);t.mock.timers.tick(15000);await assert.rejects(run.pending,timeout);
        assert.equal(signal.aborted,true);
    } finally {await run.cleanup();}
});

test('artifact deadline includes signing and never starts fetch after an early timeout',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});let calls=0;
    const signing=deferred(),release=deferred(),signed=deferred(),sign=crypto.subtle.sign.bind(crypto.subtle);
    t.mock.method(crypto.subtle,'sign',async(...args)=>{
        signing.resolve();await release.promise;
        try{return await sign(...args);}finally{signed.resolve();}
    });
    const run=operation(signal=>client(async()=>{calls++;return new Response('unused');}).artifact(source,'uia_stall',{signal}));
    try {
        await run.wait(signing.promise);t.mock.timers.tick(15000);await assert.rejects(run.pending,timeout);
        release.resolve();await signed.promise;await nextTurn();assert.equal(calls,0);
    } finally {release.resolve();await run.cleanup();}
});

test('artifact deadline cancels a body stall, releases the reader and removes parent listener',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const parent=new AbortController(),originalAdd=parent.signal.addEventListener.bind(parent.signal),originalRemove=parent.signal.removeEventListener.bind(parent.signal);
    let added=0,removed=0,signal;const body=stalledResponse();
    parent.signal.addEventListener=(...args)=>{added++;return originalAdd(...args);};
    parent.signal.removeEventListener=(...args)=>{removed++;return originalRemove(...args);};
    const run=operation(parentSignal=>client(async request=>{signal=request.signal;return body.response;}).artifact(source,'uia_stall',{signal:parentSignal}),parent);
    try {
        await run.wait(body.reading);assert.equal(body.response.body.locked,true);
        t.mock.timers.tick(15000);await assert.rejects(run.pending,timeout);await body.released;
        assert.equal(body.response.body.locked,false);
        assert.equal(signal.aborted,true);assert.equal(body.cancelCalls,1);assert.equal(added,1);assert.equal(removed,1);
    } finally {await run.cleanup();}
});

test('artifact deadline stays bounded when stream cancellation itself never settles',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const body=stalledResponse({cancelNever:true});
    const run=operation(signal=>client(async()=>body.response).artifact(source,'uia_stall',{signal}));
    try {
        await run.wait(body.reading);t.mock.timers.tick(15000);await assert.rejects(run.pending,timeout);
        await body.released;assert.equal(body.cancelCalls,1);
    } finally {await run.cleanup();}
});

test('a response arriving after timeout is cancelled without being read',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const reached=deferred(),late=deferred(),body=stalledResponse();
    const run=operation(signal=>client(()=>{reached.resolve();return late.promise;}).artifact(source,'uia_late',{signal}));
    try {
        await run.wait(reached.promise);t.mock.timers.tick(15000);await assert.rejects(run.pending,timeout);
        late.resolve(body.response);await body.cancelled;
        assert.equal(body.cancelCalls,1);assert.equal(body.response.body.locked,false);
    } finally {late.resolve(body.response);await run.cleanup();}
});

test('successful artifact keeps signing and byte content and clears the deadline',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});let signal,response;
    const bytes=await client(async request=>{
        signal=request.signal;assert.equal(new URL(request.url).pathname,'/internal/ui-bundles/v1/artifact');
        assert.deepEqual(JSON.parse(JSON.stringify(await authenticate(request,SECRET,'source'))),{source,artifactId:'uia_ok'});
        response=new Response(new Uint8Array([0,1,2,255]));return response;
    }).artifact(source,'uia_ok',{maxBytes:4});
    assert.deepEqual([...bytes],[0,1,2,255]);assert.equal(response.body.locked,false);
    t.mock.timers.tick(15000);assert.equal(signal.aborted,false);
});

test('upstream HTTP errors preserve safe codes and original status',async()=>{
    for(const [status,body,code] of [
        [410,'{"code":"UI_BUNDLE_SOURCE_REVOKED"}','UI_BUNDLE_SOURCE_REVOKED'],
        [503,'{"code":"UI_PAGE_ARTIFACT_UNAVAILABLE"}','UI_PAGE_ARTIFACT_UNAVAILABLE'],
        [403,'{"code":"unsafe detail"}','UI_BUNDLE_UPSTREAM_UNAVAILABLE'],
        [500,'not json','UI_BUNDLE_UPSTREAM_UNAVAILABLE'],
    ]){
        await assert.rejects(client(async()=>new Response(body,{status})).artifact(source,'uia_error',{maxBytes:1}),
            error=>error instanceof UiError&&error.status===status&&error.code===code);
    }
});

test('error response bodies are also bounded by the source deadline',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const body=stalledResponse({status:503});
    const run=operation(signal=>client(async()=>body.response).artifact(source,'uia_error',{signal}));
    try {
        await run.wait(body.reading);t.mock.timers.tick(15000);await assert.rejects(run.pending,timeout);
        await body.released;assert.equal(body.cancelCalls,1);
    } finally {await run.cleanup();}
});

test('maxBytes rejects a streamed oversize body without content-length and cancels it',async()=>{
    let response,cancelled=0;
    await assert.rejects(client(async()=>response=new Response(new ReadableStream({
        start(controller){controller.enqueue(new Uint8Array([1,2,3]));controller.enqueue(new Uint8Array([4,5]));},
        cancel(){cancelled++;}
    }))).artifact(source,'uia_large',{maxBytes:4}),error=>error.code==='UI_BUNDLE_UPSTREAM_TOO_LARGE'&&error.status===413);
    assert.equal(cancelled,1);assert.equal(response.body.locked,false);
});

test('oversized declared content-length is rejected and cancelled before reading',async()=>{
    let cancelled=0,response;
    await assert.rejects(client(async()=>response=new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-length':'5'}}))
        .artifact(source,'uia_large',{maxBytes:4}),error=>error.code==='UI_BUNDLE_UPSTREAM_TOO_LARGE');
    assert.equal(cancelled,1);assert.equal(response.body.locked,false);
});

test('maxBytes cannot raise either source contract ceiling',async()=>{
    const v1={...source,contractVersion:'qagent.ui-bundle-source-ref.v1',exporterVersion:'qagent_ui_source_v1'};
    for(const [ref,size] of [[v1,1048577],[source,16777217]]){
        await assert.rejects(client(async()=>new Response(null,{headers:{'content-length':String(size)}})).artifact(ref,'uia_large',{maxBytes:67108864}),
            error=>error.code==='UI_BUNDLE_UPSTREAM_TOO_LARGE');
    }
});

test('parent abort preserves its UiError and cancels a pending body',async()=>{
    const parent=new AbortController(),reason=new UiError(504,'UI_TEST_DESIGN_COMPILE_TIMEOUT'),body=stalledResponse();let signal;
    const run=operation(parentSignal=>client(async request=>{signal=request.signal;return body.response;})
        .artifact(source,'uia_parent',{signal:parentSignal}),parent);
    try {
        await run.wait(body.reading);assert.equal(body.response.body.locked,true);
        parent.abort(reason);await assert.rejects(run.pending,error=>error===reason);await body.released;
        assert.equal(body.response.body.locked,false);assert.equal(body.cancelCalls,1);assert.equal(signal.reason,reason);
    } finally {await run.cleanup();}
});

test('an already aborted parent does not start signing or fetch',async()=>{
    const parent=new AbortController(),reason=new UiError(504,'UI_TEST_DESIGN_COMPILE_TIMEOUT');parent.abort(reason);let calls=0;
    await assert.rejects(client(async()=>{calls++;return new Response('unused');}).artifact(source,'uia_parent',{signal:parent.signal}),error=>error===reason);
    assert.equal(calls,0);
});

test('checkAccess releases an ignored success body',async()=>{
    let cancelled=0,response;
    await client(async()=>response=new Response(new ReadableStream({cancel(){cancelled++;}}))).checkAccess(source);
    assert.equal(cancelled,1);assert.equal(response.body.locked,false);
});

test('checkAccess forwards parent cancellation while waiting for headers',async()=>{
    const parent=new AbortController(),reason=new UiError(504,'UI_TEST_DESIGN_COMPILE_TIMEOUT'),reached=deferred();let signal;
    const run=operation(parentSignal=>client(request=>{signal=request.signal;reached.resolve();return new Promise(()=>{});}).checkAccess(source,{signal:parentSignal}),parent);
    try {
        await run.wait(reached.promise);parent.abort(reason);await assert.rejects(run.pending,error=>error===reason);assert.equal(signal.reason,reason);
    } finally {await run.cleanup();}
});

test('checkAccess cancellation cannot hold the request past its deadline',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const body=stalledResponse({cancelNever:true});
    const run=operation(signal=>client(async()=>body.response).checkAccess(source,{signal}));
    try {
        await run.wait(body.cancelled);t.mock.timers.tick(15000);await assert.rejects(run.pending,timeout);assert.equal(body.cancelCalls,1);
    } finally {await run.cleanup();}
});
