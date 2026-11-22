/** Pure UI-TD-1 compiler. Reads immutable, verified evidence; never calls an application or AI. */
import { CANONICAL_VERSION, canonicalJson, decodeJson, digestJson, fail, sha256, verifyManifestHash, UiError } from '../contracts/canonical';
import { id, hash, object, validateScope } from '../contracts/uiCapture';
import { validateUiSpecificationShape } from '../contracts/uiTestDesignGuard.js';
import { validateSourceRef, sameScope } from '../protocol';
import { ACTION_OPERATORS, ADAPTER_VERSION, COMPARISON_VERSION, COMPILATION_VERSION, COMPILER_VERSION,
  TEMPLATE_VERSION, TEST_DESIGN_VERSION, validateTestDesignProfile,
  type Assertion, type AssertionOperator, type Compilation, type Context, type DesignSource,
  type Exclusion, type ExpectedSource, type Locator, type ModeReadiness, type Step,
  type TestDesignProfile, type TestDesignSpecification } from '../contracts/uiTestDesign';

export const MAX_COMPILATION_BYTES = 768 * 1024;
const MAX_ARTIFACTS=1024, MAX_STATES=200, MAX_ACTIONS=2000, MAX_INTERACTIONS=10000;
const safeAttributes=new Set(['type','name','role','aria-label','aria-expanded','aria-selected','aria-checked','aria-disabled','disabled','required','readonly','placeholder','title']);
const safeStyles=new Set(['display','visibility','position','width','height','color','background-color','font-family','font-size','font-weight','line-height','margin','padding','border','border-radius','box-sizing','overflow','transform','opacity','z-index','text-align','white-space','flex','grid-template-columns']);
const inertTags=new Set(['script','style','noscript','iframe','object','embed','head','meta','link','base','title']);
const cleanText=(s:string)=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
const sortedUnique=(xs:string[])=>[...new Set(xs)].sort();
const clone=<T>(v:T):T=>JSON.parse(canonicalJson(v));
function array(v:unknown,max:number,code='UI_TEST_DESIGN_SOURCE_INVALID'):any[]{if(!Array.isArray(v)||v.length>max)fail(code,422);return v;}
function context(v:any):Context {for(const key of ['documentId','navigationId','frameId'])id(v[key]);if(v.stepId!==null)id(v.stepId);return {documentId:v.documentId,navigationId:v.navigationId,frameId:v.frameId,stepId:v.stepId};}
function ordinal(v:unknown):number{if(!Number.isSafeInteger(v)||Number(v)<0)fail('UI_TEST_DESIGN_ORDER_INVALID',409);return Number(v);}
function sourceOf(e:any):DesignSource {
  validateSourceRef(e.source);id(e.bundleVersionId);hash(e.manifestHash);
  return {scope:clone(e.source.scope),captureId:e.source.captureId,bundleVersionId:e.bundleVersionId,sourceHash:e.source.sourceHash,manifestHash:e.manifestHash};
}
export async function validateDesignEnvelope(e:any):Promise<DesignSource>{
  await verifyManifestHash(e);
  if(e.contractVersion!=='qagent.ui-page-evidence.v2'||e.manifestState!=='SEALED'||e.qualification?.dimensions?.integrity?.status!=='READY'
    ||e.journey?.contractVersion!=='qagent.ui-observed-journey.v1'||e.bundle?.contractVersion!=='qagent.ui-page-fixture-index.v1'
    ||!['qagent_ui_page_observed_source_v2','qagent_ui_page_environment_source_v2'].includes(e.source?.exporterVersion))fail('UI_TEST_DESIGN_SOURCE_UNSUPPORTED',422);
  const source=sourceOf(e);validateScope(source.scope);
  if(e.journey.captureId!==source.captureId||e.bundle.captureId!==source.captureId)fail('UI_TEST_DESIGN_SOURCE_CONTEXT_MISMATCH',409);
  if(typeof e.journey.entryUrl!=='string'||!['http:','https:'].includes(new URL(e.journey.entryUrl).protocol))fail('UI_TEST_DESIGN_SOURCE_INVALID',422);
  if(e.journey.sourceBuildRef!==null)id(e.journey.sourceBuildRef);
  if(e.bundle.matching?.liveBusinessFallback!==false||e.bundle.matching?.unmatchedRequest!=='BLOCK'||e.bundle.matching?.exhaustedFixture!=='BLOCK'
    ||e.bundle.applicationResources?.strategy!=='EXECUTE_TARGET_BUILD'||e.bundle.applicationResources?.archiveExecutionAllowed!==false)fail('UI_TEST_DESIGN_MATCH_POLICY_UNSUPPORTED',422);
  return source;
}
interface Artifact {artifactId:string;kind:string;sha256:string;byteLength:number;completeness:string;contentType:string;[key:string]:any;}
interface DomNode {nodeId:string;parentId:string|null;nodeType:number;name:string;attributes:[string,string][];text:string;}
function domNodes(value:any,doc:string):DomNode[]{
  object(value,['contractVersion','documentId','nodes']);if(value.contractVersion!=='qagent.ui-dom-snapshot.v1'||value.documentId!==doc)fail('UI_TEST_DESIGN_ARTIFACT_CONTEXT_MISMATCH',409);
  const nodes=array(value.nodes,10000),seen=new Set<string>();
  for(const n of nodes){object(n,['nodeId','parentId','nodeType','name','attributes','text']);id(n.nodeId);
    if(seen.has(n.nodeId)||(n.parentId!==null&&!seen.has(n.parentId)))fail('UI_TEST_DESIGN_DOM_REFERENCE_INVALID',409);seen.add(n.nodeId);
    if(![1,3,8,9,10,11].includes(n.nodeType)||typeof n.name!=='string'||n.name.length>256||typeof n.text!=='string'||n.text.length>1048576)fail('UI_TEST_DESIGN_ARTIFACT_FORMAT_INVALID',422);
    const attrs=array(n.attributes,128),keys=new Set<string>();for(const a of attrs){if(!Array.isArray(a)||a.length!==2||a.some(x=>typeof x!=='string')||keys.has(a[0]))fail('UI_TEST_DESIGN_ARTIFACT_FORMAT_INVALID',422);keys.add(a[0]);}
  }return nodes;
}
function locatorsFor(nodes:DomNode[]):Map<string,Locator>{
  const elements=nodes.filter(n=>n.nodeType===1),byId=new Map(nodes.map(n=>[n.nodeId,n])),out=new Map<string,Locator>();
  const attributes=new Map(elements.map(n=>[n.nodeId,new Map(n.attributes)])),counts=new Map<string,number>();
  const siblingCounts=new Map<string,number>(),siblingOrder=new Map<string,number>(),paths=new Map<string,string|null>();
  for(const n of elements){const key=n.parentId+'\0'+n.name.toLowerCase(),order=(siblingCounts.get(key)??0)+1;siblingCounts.set(key,order);siblingOrder.set(n.nodeId,order);
    for(const key of ['data-testid','id']){const v=attributes.get(n.nodeId)!.get(key);if(v)counts.set(key+'\0'+v,(counts.get(key+'\0'+v)??0)+1);}}
  const path=(n:DomNode,depth=0):string|null=>{if(paths.has(n.nodeId))return paths.get(n.nodeId)!;
    if(depth>100||!/^[a-zA-Z][a-zA-Z0-9-]{0,100}$/.test(n.name))return null;
    const component=n.name.toLowerCase()+':nth-of-type('+siblingOrder.get(n.nodeId)+')',parent=n.parentId?byId.get(n.parentId):null;
    const head=parent?.nodeType===1?path(parent,depth+1):'',result=head===null?null:(head?head+' > ':'')+component;paths.set(n.nodeId,result);return result;};
  for(const n of elements){const a=attributes.get(n.nodeId)!;if(inertTags.has(n.name.toLowerCase())||a.get('data-qagent-redacted')==='true')continue;
    const testId=a.get('data-testid'),htmlId=a.get('id');let strategy:'CSS'|'TEST_ID'='CSS',value:string|null=null;
    if(testId&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(testId)&&counts.get('data-testid\0'+testId)===1){strategy='TEST_ID';value=testId;}
    else if(htmlId&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(htmlId)&&counts.get('id\0'+htmlId)===1)value='[id="'+htmlId+'"]';
    else value=path(n);
    if(value&&value.length<=2048)out.set(n.nodeId,{strategy,value,observedMatchCount:1,sourceNodeId:n.nodeId});
  }return out;
}
function assertDocumentArtifact(value:any,doc:string,version:string,keys:string[]):void{object(value,keys);if(value.contractVersion!==version||value.documentId!==doc)fail('UI_TEST_DESIGN_ARTIFACT_CONTEXT_MISMATCH',409);}

export async function compileObservedBundle(envelope:Record<string,any>,readArtifact:(artifactId:string)=>Promise<Uint8Array>,profileInput?:unknown):Promise<Compilation>{
  const source=await validateDesignEnvelope(envelope),profile=validateTestDesignProfile(profileInput);
  const exclusions:Exclusion[]=[],limitations=new Set<string>(['UI_TEST_DESIGN_OBSERVED_CHARACTERIZATION','UI_TEST_DESIGN_NOT_EXECUTED','UI_TEST_DESIGN_FULL_COVERAGE_UNPROVEN','UI_TEST_DESIGN_RENDER_PROFILE_INCOMPLETE']);
  const coverage:Record<string,number>={actionsTotal:0,actionsSupported:0,checkpointsTotal:0,stableCheckpoints:0,nodesConsidered:0,checksGenerated:0,checksExcluded:0,actionsExcluded:0,checkpointsExcluded:0,nodesExcluded:0,capabilitiesExcluded:0,artifactsVerified:0,artifactBytesVerified:0,businessFixtures:0,usableFixtures:0,unavailableFixtures:0};
  const noDesign=(codes:string[]):Compilation=>({contractVersion:COMPILATION_VERSION,compilerVersion:COMPILER_VERSION,outcome:'NO_DESIGN',source,specification:null,specificationHash:null,summary:{coverage,limitations:sortedUnique([...limitations]),reasonCodes:sortedUnique(codes)},executionPerformed:false});
  const exclude=(kind:Exclusion['kind'],sourceId:string,reasonCode:string,count=1)=>{const counter={ACTION:'actionsExcluded',CHECKPOINT:'checkpointsExcluded',NODE:'nodesExcluded',OPERATOR:'checksExcluded',CAPABILITY:'capabilitiesExcluded'}[kind];coverage[counter]+=count;limitations.add(reasonCode);const prior=exclusions.find(x=>x.kind===kind&&x.sourceId===sourceId&&x.reasonCode===reasonCode);if(prior)prior.count+=count;else exclusions.push({kind,sourceId,reasonCode,count});};
  const refs=array(envelope.bundle.artifacts,MAX_ARTIFACTS),artifacts=new Map<string,Artifact>();let declared=0;
  for(const r of refs){id(r.artifactId);hash(r.sha256);if(artifacts.has(r.artifactId)||!Number.isSafeInteger(r.byteLength)||r.byteLength<1||r.byteLength>16777216
    ||r.dataOrigin!==(envelope.source.exporterVersion==='qagent_ui_page_environment_source_v2'?'OBSERVED_ENVIRONMENT_MANAGED':'OBSERVED_SANITIZED'))fail('UI_TEST_DESIGN_ARTIFACT_REF_INVALID',409);
    artifacts.set(r.artifactId,r);declared+=r.byteLength;}
  if(declared>profile.maxArtifactBytes)return noDesign(['UI_TEST_DESIGN_ARTIFACT_BUDGET_EXCEEDED']);
  const decoded=new Map<string,any>();
  for(const r of [...artifacts.values()].sort((a,b)=>a.artifactId<b.artifactId?-1:a.artifactId>b.artifactId?1:0)){const bytes=await readArtifact(r.artifactId);
    if(bytes.length!==r.byteLength||await sha256(bytes)!==r.sha256)fail('UI_BUNDLE_ARTIFACT_HASH_MISMATCH',409);
    coverage.artifactsVerified++;coverage.artifactBytesVerified+=bytes.length;
    if(['DOM_SNAPSHOT_JSON','LAYOUT_JSON','FORM_STATE_JSON','ACTION_VALUE_JSON','HEADERS_JSON'].includes(r.kind))decoded.set(r.artifactId,decodeJson(bytes));
  }
  const ref=(artifactId:string,kind?:string):Artifact=>{const r=artifacts.get(artifactId);if(!r||(kind&&r.kind!==kind))fail('UI_TEST_DESIGN_ARTIFACT_REF_INVALID',409);return r;};
  const expectedRef=(artifactId:string,pointer:string):ExpectedSource=>{const r=ref(artifactId);return {artifactId,sha256:r.sha256,byteLength:r.byteLength,jsonPointer:pointer};};
  const manifestRef=(pointer:string):ExpectedSource=>({artifactId:null,sha256:source.manifestHash,byteLength:null,jsonPointer:pointer});
  const states=array(envelope.pageIndex?.states,MAX_STATES).map(clone),stateIds=new Set<string>(),orders=new Set<number>();
  for(const state of states){id(state.stateId);id(state.checkpointId);context(state);ordinal(state.stateSequence);ordinal(state.observedSequence);
    if(stateIds.has(state.stateId)||orders.has(state.observedSequence))fail('UI_TEST_DESIGN_ORDER_INVALID',409);stateIds.add(state.stateId);orders.add(state.observedSequence);
    if(!['STABLE','UNSTABLE','UNKNOWN'].includes(state.stability))fail('UI_TEST_DESIGN_SOURCE_INVALID',422);
    for(const [field,kind] of [['domRef','DOM_SNAPSHOT_JSON'],['layoutRef','LAYOUT_JSON'],['formStateRef','FORM_STATE_JSON'],['screenshotRef','SCREENSHOT_PNG']] as const)if(state[field]!==null){ref(state[field],kind);if(['domRef','layoutRef','formStateRef'].includes(field)&&decoded.get(state[field])?.documentId!==state.documentId)fail('UI_TEST_DESIGN_ARTIFACT_CONTEXT_MISMATCH',409);}
  }
  states.sort((a,b)=>a.observedSequence-b.observedSequence);
  const actions=array(envelope.journey.actions,MAX_ACTIONS).map(clone).sort((a,b)=>a.observedSequence-b.observedSequence),steps:Step[]=[],actionIds=new Set<string>();
  for(const a of actions){id(a.actionId);id(a.eventId);context(a);ordinal(a.observedSequence);
    if(actionIds.has(a.actionId)||orders.has(a.observedSequence))fail('UI_TEST_DESIGN_ORDER_INVALID',409);actionIds.add(a.actionId);orders.add(a.observedSequence);
    if(!(ACTION_OPERATORS as readonly string[]).includes(a.type))fail('UI_TEST_DESIGN_ACTION_UNSUPPORTED',422);
    const reasons:string[]=[];for(const key of ['stateBeforeId','stateAfterId'])if(a[key]!==null){if(!stateIds.has(a[key]))fail('UI_TEST_DESIGN_STATE_REF_INVALID',409);const s=states.find(s=>s.stateId===a[key])!;
      if(s.documentId!==a.documentId||s.frameId!==a.frameId||(key==='stateBeforeId'?s.captureFinishedUs>a.relativeTimeUs:s.captureStartedUs<a.relativeTimeUs))fail('UI_TEST_DESIGN_STATE_REF_INVALID',409);}
    if(a.stateAfterId===null)limitations.add('UI_ACTION_STATE_LINK_UNAVAILABLE');
    const target=a.target??null;
    if((['CLICK','FILL','SELECT','CHECK'].includes(a.type)||(a.type==='SCROLL'&&a.scrollTarget!==null))&&(!target||target.observedMatchCount!==1||!Array.isArray(target.framePath)||target.framePath.length
      ||!['TEST_ID','CSS'].includes(target.primaryLocator?.strategy)||typeof target.primaryLocator?.value!=='string'||!target.primaryLocator.value.length||target.primaryLocator.value.length>2048))reasons.push('UI_TEST_DESIGN_ACTION_LOCATOR_UNSUPPORTED');
    let input:Step['input']=null;if(a.inputValueRef!==null){const r=ref(a.inputValueRef,'ACTION_VALUE_JSON'),v=decoded.get(r.artifactId);object(v,['value']);
      if(v.value!==null&&!['string','number','boolean'].includes(typeof v.value))fail('UI_TEST_DESIGN_ACTION_VALUE_INVALID',422);input={artifactId:r.artifactId,sha256:r.sha256,value:clone(v.value)};}
    if(['FILL','SELECT'].includes(a.type)&&(!input||typeof input.value!=='string'))reasons.push('UI_ACTION_VALUE_UNAVAILABLE');
    if(a.type==='NAVIGATE'&&(typeof a.destination!=='string'||!['http:','https:'].includes(new URL(a.destination).protocol)))reasons.push('UI_TEST_DESIGN_NAVIGATION_UNAVAILABLE');
    if(a.type==='CHECK'&&typeof a.checked!=='boolean')reasons.push('UI_TEST_DESIGN_ACTION_VALUE_INVALID');
    reasons.forEach(r=>exclude('ACTION',a.actionId,r));steps.push({stepId:a.actionId,operator:a.type,sourceEventId:a.eventId,observedSequence:a.observedSequence,
      context:context(a),target:clone(target),input,destination:a.destination??null,checked:a.checked??null,position:a.position??null,scrollTarget:a.scrollTarget??null,
      clickCount:a.clickCount??null,stateBeforeId:a.stateBeforeId,stateAfterId:a.stateAfterId,availability:reasons.length?'UNSUPPORTED':'SUPPORTED',reasonCodes:sortedUnique(reasons)});
  }
  coverage.actionsTotal=steps.length;coverage.actionsSupported=steps.filter(s=>s.availability==='SUPPORTED').length;
  coverage.checkpointsTotal=states.length;coverage.stableCheckpoints=states.filter(s=>s.stability==='STABLE').length;
  const assertions:Assertion[]=[];let assertionBytes=0;
  const assertionByteBudget=262144,stateByteBudget=Math.max(1024,Math.floor(196608/Math.max(1,states.length)));
  const stateCheckBudget=Math.max(1,Math.floor(profile.maxChecks/Math.max(1,states.length))),stateUsage=new Map<string,{checks:number;bytes:number}>();
  coverage.assertionByteBudget=assertionByteBudget;
  const add=(operator:AssertionOperator,state:any|null,locator:Locator|null,expected:unknown,origin:ExpectedSource,parameters:Record<string,unknown>={},ctx?:Context)=>{
    if(assertions.length>=profile.maxChecks){exclude('OPERATOR',state?.stateId??'network','UI_TEST_DESIGN_CHECK_LIMIT');return;}
    const candidate:Assertion={assertionId:'uicheck_'+String(assertions.length).padStart(6,'0'),operator,checkpointId:state?.checkpointId??null,stateId:state?.stateId??null,
      context:ctx??context(state),locator,expected:clone(expected),expectedSource:origin,parameters,policies:{UI_REPLAY:'FIXED',UI_LIVE:'OBSERVED_DIFF'},required:true};
    const size=new TextEncoder().encode(canonicalJson(candidate)).length,usage=state?stateUsage.get(state.stateId)??{checks:0,bytes:0}:null;
    if(assertionBytes+size>assertionByteBudget||(usage&&(usage.checks>=stateCheckBudget||usage.bytes+size>stateByteBudget))){exclude('OPERATOR',state?.stateId??'network','UI_TEST_DESIGN_CHECK_BUDGET');return;}
    assertions.push(candidate);assertionBytes+=size;if(usage){usage.checks++;usage.bytes+=size;stateUsage.set(state.stateId,usage);} 
  };
  for(const state of states){const sourceIndex=envelope.pageIndex.states.findIndex((s:any)=>s.stateId===state.stateId);
    if(state.stability!=='STABLE'){exclude('CHECKPOINT',state.stateId,'UI_TEST_DESIGN_CHECKPOINT_UNSTABLE');continue;}
    if(state.url!==null)add('URL_MATCHES',state,null,state.url,manifestRef('/pageIndex/states/'+sourceIndex+'/url'),{originMapping:'EXPLICIT_REQUIRED'});
    if(state.domRef===null){exclude('CHECKPOINT',state.stateId,'UI_PAGE_DOM_REFERENCE_MISSING');continue;}
    const d=ref(state.domRef,'DOM_SNAPSHOT_JSON');if(d.completeness!=='COMPLETE'){exclude('CHECKPOINT',state.stateId,'UI_TEST_DESIGN_DOM_INCOMPLETE');continue;}
    const nodes=domNodes(decoded.get(state.domRef),state.documentId);coverage.nodesConsidered+=nodes.length;
    if(coverage.nodesConsidered>profile.maxNodes){exclude('CHECKPOINT',state.stateId,'UI_TEST_DESIGN_NODE_LIMIT',nodes.length);continue;}
    const locators=locatorsFor(nodes),nodeIds=new Set(nodes.map(n=>n.nodeId)),textsByParent=new Map<string,DomNode[]>();
    for(const n of nodes)if(n.nodeType===3&&n.parentId!==null){const list=textsByParent.get(n.parentId)??[];list.push(n);textsByParent.set(n.parentId,list);}
    if(state.formStateRef!==null){const f=decoded.get(state.formStateRef);assertDocumentArtifact(f,state.documentId,'qagent.ui-form-state.v1',['contractVersion','documentId','fields','scroll']);
      for(const [fi,field] of array(f.fields,2048).entries()){object(field,['nodeId','type','value','checked']);id(field.nodeId);if(typeof field.value!=='string'||typeof field.checked!=='boolean')fail('UI_TEST_DESIGN_ARTIFACT_FORMAT_INVALID',422);
        const locator=locators.get(field.nodeId);if(!nodeIds.has(field.nodeId)||!locator||field.type==='file'){exclude('NODE',state.stateId+':'+field.nodeId,'UI_TEST_DESIGN_FORM_NODE_UNAVAILABLE');continue;}
        if(field.value!=='[REDACTED]')add('FORM_VALUE_EQUALS',state,locator,field.value,expectedRef(state.formStateRef,'/fields/'+fi+'/value'),{fieldType:field.type});
        if(['checkbox','radio'].includes(field.type))add('CHECKED_EQUALS',state,locator,field.checked,expectedRef(state.formStateRef,'/fields/'+fi+'/checked'));
      }
    }
    if(state.layoutRef!==null){const l=decoded.get(state.layoutRef);assertDocumentArtifact(l,state.documentId,'qagent.ui-layout.v1',['contractVersion','documentId','viewport','entries']);
      object(l.viewport,['width','height','deviceScaleFactor','scrollX','scrollY']);if(!Object.values(l.viewport).every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0))fail('UI_TEST_DESIGN_ARTIFACT_FORMAT_INVALID',422);
      for(const [li,entry] of array(l.entries,10000).entries()){object(entry,['nodeId','bounds','styles']);id(entry.nodeId);if(!Array.isArray(entry.bounds)||entry.bounds.length!==4||!entry.bounds.every((n:any)=>typeof n==='number'&&Number.isFinite(n)))fail('UI_TEST_DESIGN_ARTIFACT_FORMAT_INVALID',422);
        const locator=locators.get(entry.nodeId);if(!nodeIds.has(entry.nodeId)||!locator){exclude('NODE',state.stateId+':'+entry.nodeId,'UI_TEST_DESIGN_LAYOUT_NODE_UNAVAILABLE');continue;}
        add('BOUNDS_WITHIN_TOLERANCE',state,locator,entry.bounds,expectedRef(state.layoutRef,'/entries/'+li+'/bounds'),{tolerancePx:profile.layoutTolerancePx,viewport:clone(l.viewport),qualification:'VIEWPORT_DPR_SCROLL_ONLY',historicalRenderProfile:'UNAVAILABLE'});
        if(!entry.styles||typeof entry.styles!=='object'||Array.isArray(entry.styles))fail('UI_TEST_DESIGN_ARTIFACT_FORMAT_INVALID',422);
        for(const name of Object.keys(entry.styles).sort())if(safeStyles.has(name)){if(typeof entry.styles[name]!=='string')fail('UI_TEST_DESIGN_ARTIFACT_FORMAT_INVALID',422);add('STYLE_EQUALS',state,locator,entry.styles[name],expectedRef(state.layoutRef,'/entries/'+li+'/styles/'+name),{property:name,viewport:clone(l.viewport),historicalRenderProfile:'UNAVAILABLE'});}
      }
    }
    for(let ni=0;ni<nodes.length;ni++){const node=nodes[ni];if(node.nodeType!==1)continue;const locator=locators.get(node.nodeId);
      if(!locator){exclude('NODE',state.stateId+':'+node.nodeId,'UI_TEST_DESIGN_NODE_NOT_REMAPPABLE');continue;}
      add('ELEMENT_PRESENT',state,locator,true,expectedRef(state.domRef,'/nodes/'+ni),{runtimeUniquenessRequired:true});
      for(let ai=0;ai<node.attributes.length;ai++){const [name,value]=node.attributes[ai];if(safeAttributes.has(name)&&value!=='[REDACTED]')add('ATTRIBUTE_EQUALS',state,locator,value,expectedRef(state.domRef,'/nodes/'+ni+'/attributes/'+ai+'/1'),{attribute:name});}
      const texts=textsByParent.get(node.nodeId)??[];if(texts.length&&texts.every(n=>n.text!=='[REDACTED]')&&texts.some(n=>n.text.trim()))
        add('TEXT_EQUALS',state,locator,cleanText(texts.map(n=>n.text).join('')),expectedRef(state.domRef,'/nodes'),{extraction:'DIRECT_TEXT_CONTENT',normalization:'CAPTURE_CONTROL_CHAR_FILTER_V1',sourceTextNodeIds:texts.map(n=>n.nodeId)});
    }
    if(state.screenshotRef!==null)exclude('CAPABILITY',state.stateId,'UI_TEST_DESIGN_SCREENSHOT_COMPARATOR_DEFERRED');
  }
  const fixtures=array(envelope.bundle.fixtures,MAX_INTERACTIONS),interactions=array(envelope.pageIndex.interactions,MAX_INTERACTIONS),seenFixture=new Set<string>();
  const interactionById=new Map<string,any>(),interactionIds=new Set<string>();for(const n of interactions){id(n.eventId);if(interactionIds.has(n.eventId))fail('UI_TEST_DESIGN_NETWORK_CONTEXT_MISMATCH',409);interactionIds.add(n.eventId);interactionById.set(n.eventId,n);context(n);}
  for(const [fi,f] of fixtures.entries()){id(f.fixtureId);if(seenFixture.has(f.fixtureId)||!interactionIds.has(f.eventId))fail('UI_TEST_DESIGN_NETWORK_CONTEXT_MISMATCH',409);seenFixture.add(f.fixtureId);context(f);
    const original=interactionById.get(f.eventId)!;
    if(canonicalJson(original.request)!==canonicalJson(f.request)||canonicalJson(original.response)!==canonicalJson(f.response)||canonicalJson(context(original))!==canonicalJson(context(f))||f.match?.causalProof!==false)fail('UI_TEST_DESIGN_NETWORK_CONTEXT_MISMATCH',409);
    if(f.consumption?.liveFallback!==false||f.consumption?.reuseAfterExhaustion!==false||!['READY','UNAVAILABLE'].includes(f.availability))fail('UI_TEST_DESIGN_MATCH_POLICY_UNSUPPORTED',422);
    for(const [artifactId,h,kind] of [[f.request.bodyRef,f.request.bodySha256,'HTTP_REQUEST_BODY'],[f.request.businessHeadersRef,f.request.businessHeadersSha256,'HEADERS_JSON'],[f.response.bodyRef,f.response.bodySha256,'HTTP_RESPONSE_BODY'],[f.response.headersRef,f.response.headersSha256,'HEADERS_JSON']]){
      if(artifactId!==null){const r=ref(artifactId,kind);if(r.sha256!==h)fail('UI_TEST_DESIGN_NETWORK_HASH_MISMATCH',409);}else if(h!==null)fail('UI_TEST_DESIGN_NETWORK_HASH_MISMATCH',409);}
    const fingerprint=await digestJson({service:f.request.logicalServiceKey,origin:f.request.origin,method:f.request.method,path:f.request.path,query:f.request.query,bodyHash:f.request.bodySha256,businessHeadersHash:f.request.businessHeadersSha256});
    if(f.match.policyVersion!=='qagent_ui_observed_fixture_match_v1'||f.match.requestFingerprint!==fingerprint||canonicalJson(context(f.match))!==canonicalJson(context(f))||!Number.isSafeInteger(f.match.occurrenceIndex)||f.match.occurrenceIndex<0)fail('UI_TEST_DESIGN_MATCH_POLICY_UNSUPPORTED',422);
    if(f.availability==='READY'&&(!['COMPLETE','EMPTY'].includes(f.response.bodyState)||f.response.replayStatus===null||(f.response.networkStatus===304&&!f.response.cacheEvidenceVerified)||(f.response.bodyState==='COMPLETE'&&f.response.bodyRef===null)))fail('UI_TEST_DESIGN_FIXTURE_AVAILABILITY_INVALID',409);
    add('REQUEST_MATCHES',null,null,{request:f.request,match:f.match},manifestRef('/bundle/fixtures/'+fi),{fixtureId:f.fixtureId},context(f));
    add('FIXTURE_CONSUMPTION_MATCHES',null,null,f.consumption,manifestRef('/bundle/fixtures/'+fi+'/consumption'),{fixtureId:f.fixtureId},context(f));
  }
  coverage.businessFixtures=fixtures.length;coverage.usableFixtures=fixtures.filter(f=>f.availability==='READY').length;coverage.unavailableFixtures=fixtures.length-coverage.usableFixtures;coverage.checksGenerated=assertions.length;
  if(!envelope.journey.sourceBuildRef)limitations.add('SOURCE_BUILD_UNKNOWN');
  for(const code of array(envelope.qualification.reasonCodes??[],1000))if(typeof code==='string'&&/^[A-Z0-9_]{1,128}$/.test(code))limitations.add(code);
  if(coverage.unavailableFixtures)limitations.add('UI_TEST_DESIGN_REPLAY_FIXTURES_UNAVAILABLE');
  const uiChecks=assertions.filter(a=>!['REQUEST_MATCHES','FIXTURE_CONSUMPTION_MATCHES','URL_MATCHES'].includes(a.operator)).length;
  if(!uiChecks)return noDesign(['UI_TEST_DESIGN_NO_UI_CHECKS']);
  const commonBlocks=steps.filter(s=>s.availability==='UNSUPPORTED').flatMap(s=>s.reasonCodes);
  // These codes describe omitted user actions, unlike an iframe merely present on a page.
  // A new bootstrap cannot reconstruct an action absent from the immutable observation.
  for(const code of ['UI_KEY_ACTION_UNSUPPORTED','UI_SHADOW_ACTION_UNSUPPORTED','UI_FILE_INPUT_UNSUPPORTED','UI_MULTI_SELECT_UNSUPPORTED','UI_PRIVATE_ACTION_OMITTED'])
    if(limitations.has(code)){commonBlocks.push(code);exclude('CAPABILITY',source.captureId,code);}
  const requiredConfig=['UI_TEST_DESIGN_TARGET_BUILD_REQUIRED','UI_TEST_DESIGN_RENDER_PROFILE_REQUIRED'];
  if(envelope.profile?.bootstrap?.mode==='UNAVAILABLE')requiredConfig.push('UI_BOOTSTRAP_UNAVAILABLE');
  if(limitations.has('UI_ACTION_STATE_LINK_UNAVAILABLE'))requiredConfig.push('UI_TEST_DESIGN_STATE_TRANSITIONS_UNPROVEN');
  const ready=(blocks:string[]):ModeReadiness=>({status:blocks.length?'BLOCKED':'REQUIRES_CONFIGURATION',reasonCodes:sortedUnique([...blocks,...requiredConfig])});
  const specification:TestDesignSpecification={contractVersion:TEST_DESIGN_VERSION,compilerVersion:COMPILER_VERSION,templateVersion:TEMPLATE_VERSION,adapterVersion:ADAPTER_VERSION,
    canonicalizerVersion:CANONICAL_VERSION,scope:source.scope,source,profile,executionModes:['UI_REPLAY','UI_LIVE'],entryUrl:envelope.journey.entryUrl,sourceBuildRef:envelope.journey.sourceBuildRef,
    preparation:{strategy:'EXECUTE_TARGET_BUILD',observedBootstrap:clone(envelope.profile.bootstrap),targetBuildPinRequired:true,freshContextPerMode:true,livePreparationRequired:true,observedResponsesRestoreWholeState:false},
    steps,checkpoints:states,timeline:[...steps.map(s=>({kind:'ACTION' as const,id:s.stepId,observedSequence:s.observedSequence,causalProof:false as const})),...states.map(s=>({kind:'CHECKPOINT' as const,id:s.checkpointId,observedSequence:s.observedSequence,causalProof:false as const}))].sort((a,b)=>a.observedSequence-b.observedSequence),
    assertions,bindings:[],network:{matching:clone(envelope.bundle.matching),fixtures:clone(fixtures),interactions:clone(interactions),applicationResources:clone(envelope.bundle.applicationResources)},
    evidence:{artifacts:clone(refs),documents:clone(envelope.pageIndex.documents)},coverage,exclusions,limitations:sortedUnique([...limitations]),
    readiness:{UI_REPLAY:ready([...commonBlocks,...(coverage.unavailableFixtures?['UI_TEST_DESIGN_REPLAY_FIXTURES_UNAVAILABLE']:[])]),UI_LIVE:ready(commonBlocks)},executionPerformed:false};
  try{
    // Preserve the complete journey/network/evidence. If their size leaves less room for
    // assertions, admit checks fairly across checkpoints and account every rejected check.
    const provisional=(assertions:Assertion[])=>({contractVersion:COMPILATION_VERSION,compilerVersion:COMPILER_VERSION,outcome:'COMPILED',source,
      specification:{...specification,assertions},specificationHash:'0'.repeat(64),summary:{coverage,limitations:specification.limitations,reasonCodes:[]},executionPerformed:false});
    const initialSize=new TextEncoder().encode(canonicalJson(provisional(specification.assertions))).length;
    if(initialSize>MAX_COMPILATION_BYTES){
      const baseSize=new TextEncoder().encode(canonicalJson(provisional([]))).length,budget=MAX_COMPILATION_BYTES-baseSize-65536;
      const groups=new Map<string,Assertion[]>();for(const a of specification.assertions){const key=a.stateId??'network',xs=groups.get(key)??[];xs.push(a);groups.set(key,xs);}
      const accepted=new Set<string>();let used=0,remaining=true;
      while(remaining){remaining=false;for(const xs of groups.values()){const a=xs.shift();if(!a)continue;remaining=true;const bytes=new TextEncoder().encode(canonicalJson(a)).length+1;
        if(used+bytes<=budget){accepted.add(a.assertionId);used+=bytes;}else exclude('OPERATOR',a.stateId??'network','UI_TEST_DESIGN_TRANSPORT_CHECK_BUDGET');}}
      specification.assertions=specification.assertions.filter(a=>accepted.has(a.assertionId));coverage.checksGenerated=specification.assertions.length;specification.limitations=sortedUnique([...limitations]);
      if(!specification.assertions.some(a=>!['REQUEST_MATCHES','FIXTURE_CONSUMPTION_MATCHES','URL_MATCHES'].includes(a.operator)))return noDesign(['UI_TEST_DESIGN_SPECIFICATION_LIMIT']);
    }
    try{validateUiSpecificationShape(specification);} catch{fail('UI_TEST_DESIGN_OUTPUT_INVALID',422);}
    const result:Compilation={contractVersion:COMPILATION_VERSION,compilerVersion:COMPILER_VERSION,outcome:'COMPILED',source,specification,specificationHash:await digestJson(specification),summary:{coverage,limitations:specification.limitations,reasonCodes:[]},executionPerformed:false};
    if(new TextEncoder().encode(canonicalJson(result)).length>MAX_COMPILATION_BYTES)return noDesign(['UI_TEST_DESIGN_SPECIFICATION_LIMIT']);
    return result;
  }catch(e){if(e instanceof UiError&&e.code==='UI_JSON_COMPLEXITY_LIMIT')return noDesign(['UI_TEST_DESIGN_SPECIFICATION_LIMIT']);throw e;}
}
