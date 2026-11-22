const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {getEventListeners}=require('node:events');
const {fixture,h,contract,compileObservedBundle}=require('./test-design-support.cjs');
const {canonicalJson,digestJson,sha256}=h.c;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const turn=()=>new Promise(resolve=>setImmediate(resolve));

async function reseal(envelope){delete envelope.manifestHash;envelope.manifestHash=await digestJson(envelope);}
/** Every reference has stored, hashed bytes. Checkpoints use distinct DOM/form/layout blobs. */
async function sourceWithArtifacts(total,checkpoints=26){
  const d=await fixture(),envelope=(await d.base.assemble()).envelope,bytes=new Map(d.base.bytes);
  const templates=new Map(envelope.bundle.artifacts.map(ref=>[ref.kind,ref]));
  async function append(artifactId,value,kind='ASSET_BINARY'){
    const data=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
    const template=templates.get(kind)??templates.get('HTTP_RESPONSE_BODY');
    const ref={...template,artifactId,kind,sha256:await sha256(new Uint8Array(data)),byteLength:data.length};
    if(kind==='ASSET_BINARY')Object.assign(ref,{contentType:'application/octet-stream',representation:'BINARY'});
    envelope.bundle.artifacts.push(ref);bytes.set(artifactId,data);return ref;
  }
  for(let i=1;i<checkpoints;i++){
    const original=envelope.pageIndex.states[0],state=structuredClone(original);
    Object.assign(state,{stateId:'state_io_'+i,checkpointId:'check_io_'+i,checkpointEventId:'uie_io_'+i,stateSequence:i,observedSequence:2+i,captureStartedUs:29000+i*10000,captureFinishedUs:30000+i*10000});
    for(const [field,kind] of [['domRef','DOM_SNAPSHOT_JSON'],['layoutRef','LAYOUT_JSON'],['formStateRef','FORM_STATE_JSON']]){
      const value=JSON.parse(bytes.get(original[field]));
      if(kind==='DOM_SNAPSHOT_JSON')value.nodes.find(n=>n.nodeType===3).text='Items '+i;
      else if(kind==='LAYOUT_JSON')value.viewport.scrollY=i;
      else value.fields[0].value='sample '+i;
      state[field]=(await append('uia_io_'+field+'_'+String(i).padStart(3,'0'),value,kind)).artifactId;
    }
    envelope.pageIndex.states.push(state);envelope.journey.checkpointRefs.push(state.checkpointId);
  }
  assert.ok(envelope.bundle.artifacts.length<=total);
  while(envelope.bundle.artifacts.length<total){const i=envelope.bundle.artifacts.length;await append('uia_zz_payload_'+String(i).padStart(4,'0'),Buffer.from('synthetic binary artifact '+i));}
  await reseal(envelope);return {envelope,bytes,append};
}

test('artifact scheduling retains the exact existing v1 canonical compilation',async()=>{
  const d=await fixture(),actual=await d.compile();
  const expected=JSON.parse(fs.readFileSync(path.join(process.env.QAGENT_UI_ROOT,'fixtures/ui-test-design-compilation.v1.json'),'utf8'));
  assert.equal(canonicalJson(actual),canonicalJson(expected));
  assert.equal(actual.compilerVersion,contract.COMPILER_VERSION);
});

for(const total of [338,510])test(total+' distinct artifacts and 26 checkpoints verify completely with at most four reads, independent of completion order',async(t)=>{
  const d=await sourceWithArtifacts(total),original=canonicalJson(d.envelope);
  const baseline=await compileObservedBundle(d.envelope,async id=>new Uint8Array(d.bytes.get(id)));
  let active=0,maxActive=0;const reads=[],completed=[],progress=[],controller=new AbortController();
  const actual=await compileObservedBundle(d.envelope,async(id,options)=>{
    const ordinal=reads.length;reads.push(id);active++;maxActive=Math.max(maxActive,active);
    assert.equal(options.maxBytes,d.bytes.get(id).length);assert.equal(options.signal.aborted,false);
    try{await delay((3-ordinal%4)*2+1);completed.push(id);return new Uint8Array(d.bytes.get(id));}finally{active--;}
  },undefined,{signal:controller.signal,onProgress:p=>progress.push(p)});
  assert.equal(actual.outcome,'COMPILED');assert.equal(reads.length,total);assert.equal(new Set(reads).size,total);
  assert.equal(maxActive,4);assert.equal(active,0);assert.notDeepEqual(completed,reads);
  assert.equal(actual.specification.checkpoints.length,26);assert.equal(actual.specification.coverage.artifactsVerified,total);
  assert.equal(canonicalJson(actual),canonicalJson(baseline));assert.equal(canonicalJson(d.envelope),original);
  assert.equal(progress.length,total+1);assert.deepEqual(progress.map(p=>p.verifiedArtifacts),Array.from({length:total+1},(_,i)=>i));
  assert.ok(progress.every(p=>p.totalArtifacts===total));
  assert.equal(progress.at(-1).verifiedBytes,[...d.bytes.values()].reduce((sum,b)=>sum+b.length,0));
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
  t.diagnostic(JSON.stringify({artifacts:total,checkpoints:26,maxConcurrentReads:maxActive,verifiedBytes:progress.at(-1).verifiedBytes,specificationHash:actual.specificationHash}));
});

test('in-flight declared artifact bytes never exceed 16 MiB and a 16 MiB artifact runs alone',async()=>{
  const d=await sourceWithArtifacts(5,1),mib=1024*1024;
  for(const [i,size] of [12*mib,4*mib,16*mib,mib].entries())await d.append('uia_00_large_'+i,Buffer.alloc(size,i+1));
  await reseal(d.envelope);
  let active=0,activeBytes=0,maxBytes=0;const largeActive=[];
  const result=await compileObservedBundle(d.envelope,async(id,options)=>{
    const bytes=d.bytes.get(id);active++;activeBytes+=bytes.length;maxBytes=Math.max(maxBytes,activeBytes);
    assert.ok(active<=4);assert.ok(activeBytes<=16*mib);assert.equal(options.maxBytes,bytes.length);
    if(bytes.length===16*mib)largeActive.push(active);
    try{await delay(2);return new Uint8Array(bytes);}finally{active--;activeBytes-=bytes.length;}
  },{...contract.DEFAULT_TEST_DESIGN_PROFILE,maxArtifactBytes:64*mib});
  assert.equal(result.outcome,'COMPILED');assert.equal(result.specification.coverage.artifactsVerified,9);
  assert.equal(maxBytes,16*mib);assert.deepEqual(largeActive,[1]);assert.equal(active,0);assert.equal(activeBytes,0);
});

for(const corruption of ['hash','size'])test('a final artifact '+corruption+' mismatch prevents all compilation output',async()=>{
  const d=await sourceWithArtifacts(338),last=[...d.envelope.bundle.artifacts].sort((a,b)=>a.artifactId.localeCompare(b.artifactId)).at(-1).artifactId;
  const reads=new Set(),progress=[];
  await assert.rejects(compileObservedBundle(d.envelope,async id=>{
    reads.add(id);const bytes=new Uint8Array(d.bytes.get(id));
    if(id!==last)return bytes;
    if(corruption==='size')return bytes.slice(1);
    bytes[0]^=1;return bytes;
  },undefined,{onProgress:p=>progress.push(p)}),error=>error.code==='UI_BUNDLE_ARTIFACT_HASH_MISMATCH');
  assert.equal(reads.size,338);assert.ok(reads.has(last));assert.ok(progress.at(-1).verifiedArtifacts<338);
});

test('cancellation rejects promptly even when readers ignore the signal, stops dispatch and observes late failures',async()=>{
  const d=await sourceWithArtifacts(338),controller=new AbortController(),reason=new Error('synthetic compilation deadline');
  const pending=[],signals=[],progress=[];let announce;const started=new Promise(resolve=>{announce=resolve;});
  const compilation=compileObservedBundle(d.envelope,(id,options)=>new Promise((resolve,reject)=>{
    pending.push({id,resolve,reject});signals.push(options.signal);if(pending.length===4)announce();
  }),undefined,{signal:controller.signal,onProgress:p=>progress.push(p)});
  await started;controller.abort(reason);
  let timeout;
  try{await assert.rejects(Promise.race([compilation,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('compiler did not cancel')),250);})]),error=>error===reason);}
  finally{clearTimeout(timeout);}
  assert.equal(pending.length,4);assert.ok(signals.every(signal=>signal.aborted&&signal.reason===reason));
  assert.equal(getEventListeners(controller.signal,'abort').length,0);assert.equal(progress.length,1);
  for(const [i,p] of pending.entries())if(i%2)p.resolve(new Uint8Array(d.bytes.get(p.id)));else p.reject(new Error('late ignored-reader rejection'));
  await turn();await turn();assert.equal(pending.length,4);assert.equal(progress.length,1);
  assert.ok(signals.every(signal=>getEventListeners(signal,'abort').length===0));
});

test('an already aborted compilation never reads an artifact',async()=>{
  const d=await sourceWithArtifacts(5,1),controller=new AbortController(),reason=new Error('already stopped');let reads=0;
  controller.abort(reason);
  await assert.rejects(compileObservedBundle(d.envelope,async()=>{reads++;return new Uint8Array();},undefined,{signal:controller.signal}),error=>error===reason);
  assert.equal(reads,0);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('a failed reader cancels sibling reads and never starts queued artifacts',async()=>{
  const d=await sourceWithArtifacts(338),failure=new Error('synthetic artifact transport failure'),signals=[],pending=[];let reads=0;
  await assert.rejects(compileObservedBundle(d.envelope,(id,options)=>{
    reads++;signals.push(options.signal);if(reads===1)return Promise.reject(failure);
    return new Promise((resolve,reject)=>pending.push({id,resolve,reject}));
  }),error=>error===failure);
  assert.equal(reads,4);assert.ok(signals.every(signal=>signal.aborted&&signal.reason===failure));
  for(const p of pending)p.reject(new Error('late sibling failure'));
  await turn();assert.equal(reads,4);assert.ok(signals.every(signal=>getEventListeners(signal,'abort').length===0));
});
