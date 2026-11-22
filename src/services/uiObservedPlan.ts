/** A small immutable recipe over ALL source evidence. Size grows with digit counts, not node counts.
 * Generating a recipe is not checking the application; missing comparators remain pending. */
import { canonicalJson, digestJson, fail, sha256 } from '../contracts/canonical';
import { hash, id } from '../contracts/uiCapture';
import { validateDesignEnvelope, type ArtifactReadOptions } from './uiTestDesignCompiler';
import { UI_OBSERVED_DEFAULT_PROFILE, UI_OBSERVED_SECTIONS, UI_OBSERVED_COMPILER_VERSION, validateUiObservedProfileShape,
  validateUiObservedPlanShape, validateUiObservedPlanPageShape } from '../contracts/uiObservedPlanGuard.js';
import type { ObservedPlanCompilation, ObservedPlanSpecification, ObservedPlanProfile, ObservedPlanItem, ObservedPlanPage } from '../contracts/uiObservedPlan';

const knownArtifactKinds=new Set(['DOCUMENT_HTML','RENDERED_HTML','DOM_SNAPSHOT_JSON','LAYOUT_JSON','FORM_STATE_JSON','RESOURCE_MANIFEST_JSON','CSS_TEXT','SCRIPT_TEXT','ASSET_BINARY','HTTP_REQUEST_BODY','HTTP_RESPONSE_BODY','SCREENSHOT_PNG','ACTION_VALUE_JSON','HEADERS_JSON']);
const plannedJsonKinds=new Set(['DOM_SNAPSHOT_JSON','LAYOUT_JSON','FORM_STATE_JSON','RESOURCE_MANIFEST_JSON','HTTP_REQUEST_BODY','HTTP_RESPONSE_BODY','ACTION_VALUE_JSON','HEADERS_JSON']);
const actionTypes=new Set(['CLICK','FILL','SELECT','CHECK','NAVIGATE','SCROLL']);
const OMITTED_ACTION_CODES=['UI_KEY_ACTION_UNSUPPORTED','UI_SHADOW_ACTION_UNSUPPORTED','UI_FILE_INPUT_UNSUPPORTED','UI_MULTI_SELECT_UNSUPPORTED','UI_PRIVATE_ACTION_OMITTED'];
const collectionPointers=new Set(UI_OBSERVED_SECTIONS.filter(s=>s.section!=='SOURCE_METADATA').map(s=>s.pointer));
const utf8=new TextEncoder();
const sortedCodes=(values:string[])=>[...new Set(values)].sort();
const clone=<T>(value:T):T=>JSON.parse(canonicalJson(value));
const pointerEscape=(value:string)=>value.replace(/~/g,'~0').replace(/\//g,'~1');
function at(value:any,pointer:string):any{return pointer.split('/').slice(1).reduce((v,k)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],value);}
function sourceRows(envelope:any,section:string):any[]{const entry=UI_OBSERVED_SECTIONS.find(s=>s.section===section);if(!entry||section==='SOURCE_METADATA')fail('UI_TEST_DESIGN_SECTION_INVALID');const rows=at(envelope,entry.pointer);if(!Array.isArray(rows))fail('UI_TEST_DESIGN_SOURCE_INVALID',422);return rows;}
function check(signal?:AbortSignal){if(signal?.aborted)throw signal.reason??new Error('UI_TEST_DESIGN_COMPILE_CANCELLED');}

interface Value {pointer:string;value:any;collection:boolean;}
/** Visit every value, including empty containers. Collection payloads are referenced by dedicated sections. */
function* values(value:any,pointer='',metadata=false):Generator<Value>{
  const collection=metadata&&collectionPointers.has(pointer);
  yield {pointer,value,collection};if(collection)return;
  if(Array.isArray(value)){for(let i=0;i<value.length;i++)yield* values(value[i],pointer+'/'+i,metadata);}
  else if(value&&typeof value==='object'){for(const key of Object.keys(value).sort())yield* values(value[key],pointer+'/'+pointerEscape(key),metadata);}
}
function valueCount(value:any,metadata=false):number{let n=0;for(const _entry of values(value,'',metadata))n++;return n;}
function pendingFor(section:string,row:any):string[]{
  if(section==='ACTIONS'){
    const reasons:string[]=[];if(!actionTypes.has(row?.type))reasons.push('UI_TEST_DESIGN_ACTION_UNSUPPORTED');
    if((['CLICK','FILL','SELECT','CHECK'].includes(row?.type)||(row?.type==='SCROLL'&&row.scrollTarget!==null))&&(!row.target||row.target.observedMatchCount!==1||!Array.isArray(row.target.framePath)||row.target.framePath.length||!['TEST_ID','CSS'].includes(row.target.primaryLocator?.strategy)))reasons.push('UI_TEST_DESIGN_ACTION_LOCATOR_UNSUPPORTED');
    if(['FILL','SELECT'].includes(row?.type)&&!row.inputValueRef)reasons.push('UI_TEST_DESIGN_ACTION_VALUE_MISSING');
    if(row?.type==='NAVIGATE'){try{if(!['http:','https:'].includes(new URL(row.destination).protocol))reasons.push('UI_TEST_DESIGN_NAVIGATION_UNAVAILABLE');}catch{reasons.push('UI_TEST_DESIGN_NAVIGATION_UNAVAILABLE');}}
    if(row?.type==='CHECK'&&typeof row.checked!=='boolean')reasons.push('UI_TEST_DESIGN_ACTION_VALUE_MISSING');
    return reasons;
  }
  if(section==='CHECKPOINTS')return row?.stability!=='STABLE'?['UI_TEST_DESIGN_CHECKPOINT_UNSTABLE']:row.domRef===null?['UI_PAGE_DOM_REFERENCE_MISSING']:[];
  if(section==='FIXTURES')return row?.availability==='READY'?[]:['UI_TEST_DESIGN_REPLAY_FIXTURES_UNAVAILABLE'];
  if(section==='ARTIFACTS'){
    const reasons:string[]=[];if(row?.completeness!=='COMPLETE')reasons.push('UI_TEST_DESIGN_ARTIFACT_INCOMPLETE');
    if(!knownArtifactKinds.has(row?.kind))reasons.push('UI_TEST_DESIGN_UNKNOWN_ARTIFACT_KIND');
    else if(!plannedJsonKinds.has(row.kind))reasons.push(row.kind==='SCREENSHOT_PNG'?'UI_TEST_DESIGN_SCREENSHOT_COMPARATOR_DEFERRED':'UI_TEST_DESIGN_ARTIFACT_COMPARATOR_PENDING');
    return reasons;
  }
  if(section==='SOURCE_METADATA')return ['UI_TEST_DESIGN_METADATA_COMPARATOR_PENDING'];
  if(section==='RESOURCES'||section==='STATE_RESOURCES')return ['UI_TEST_DESIGN_RESOURCE_COMPARATOR_PENDING'];
  return [];
}

/** A JSON value is data, not automatically an executable UI assertion. Unknown schema fields
 * and evidence tied only to unstable states retain a pending obligation at the exact pointer. */
function fieldReasons(envelope:any,ref:any,pointer:string):string[]{
  const reasons:string[]=[];
  if(['DOM_SNAPSHOT_JSON','FORM_STATE_JSON','LAYOUT_JSON','SCREENSHOT_PNG','RENDERED_HTML'].includes(ref.kind)){
    const states=sourceRows(envelope,'CHECKPOINTS').filter(s=>['domRef','formStateRef','layoutRef','screenshotRef','htmlRef'].some(k=>s[k]===ref.artifactId));
    if(!states.length)reasons.push('UI_TEST_DESIGN_ARTIFACT_STATE_UNLINKED');
    else if(states.some(s=>s.stability!=='STABLE'))reasons.push('UI_TEST_DESIGN_CHECKPOINT_UNSTABLE');
  }
  if(ref.kind==='RESOURCE_MANIFEST_JSON')reasons.push('UI_TEST_DESIGN_RESOURCE_COMPARATOR_PENDING');
  let known=true;
  if(ref.kind==='DOM_SNAPSHOT_JSON')known=/^(?:|\/(?:contractVersion|documentId)|\/nodes(?:\/\d+(?:\/(?:nodeId|parentId|nodeType|name|text)|\/attributes(?:\/\d+(?:\/[01])?)?)?)?)$/.test(pointer);
  else if(ref.kind==='FORM_STATE_JSON')known=/^(?:|\/(?:contractVersion|documentId)|\/fields(?:\/\d+(?:\/(?:nodeId|type|value|checked))?)?|\/scroll(?:\/\d+(?:\/(?:nodeId|x|y|scrollX|scrollY))?)?)$/.test(pointer);
  else if(ref.kind==='LAYOUT_JSON')known=/^(?:|\/(?:contractVersion|documentId)|\/viewport(?:\/(?:width|height|deviceScaleFactor|scrollX|scrollY))?|\/entries(?:\/\d+(?:\/nodeId|\/bounds(?:\/[0-3])?|\/styles(?:\/[^/]+)?)?)?)$/.test(pointer);
  else if(ref.kind==='ACTION_VALUE_JSON')known=pointer===''||pointer==='/value';
  else if(!plannedJsonKinds.has(ref.kind))known=false;
  if(!known)reasons.push('UI_TEST_DESIGN_UNKNOWN_FIELD_COMPARATOR_PENDING');
  return reasons;
}

export async function compileObservedPlan(envelope:Record<string,any>,profileInput?:unknown,signal?:AbortSignal):Promise<ObservedPlanCompilation>{
  check(signal);const source=await validateDesignEnvelope(envelope);check(signal);
  const profile=clone(validateUiObservedProfileShape(profileInput??UI_OBSERVED_DEFAULT_PROFILE)) as ObservedPlanProfile;
  const artifacts=sourceRows(envelope,'ARTIFACTS'),refs=new Set<string>();let artifactBytes=0;
  for(const ref of artifacts){id(ref.artifactId);hash(ref.sha256);if(refs.has(ref.artifactId)||!Number.isSafeInteger(ref.byteLength)||ref.byteLength<1)fail('UI_TEST_DESIGN_ARTIFACT_REF_INVALID',409);refs.add(ref.artifactId);artifactBytes+=ref.byteLength;if(!Number.isSafeInteger(artifactBytes))fail('UI_TEST_DESIGN_ARTIFACT_REF_INVALID',409);}
  // Integrity READY alone is insufficient to claim every declared byte was verified at assembly.
  const originalCounts=envelope.qualification?.counts;
  if(originalCounts?.referencedArtifacts!==artifacts.length||originalCounts?.verifiedArtifacts!==artifacts.length)fail('UI_TEST_DESIGN_SOURCE_INTEGRITY_INCONSISTENT',409);
  const metadataCount=valueCount(envelope,true),sections=UI_OBSERVED_SECTIONS.map(s=>({...s,count:s.section==='SOURCE_METADATA'?metadataCount:sourceRows(envelope,s.section).length}));
  const states=sourceRows(envelope,'CHECKPOINTS'),fixtures=sourceRows(envelope,'FIXTURES'),actions=sourceRows(envelope,'ACTIONS');
  const stable=states.filter(s=>s.stability==='STABLE').length,usable=fixtures.filter(f=>f.availability==='READY').length;
  let pending=metadataCount;for(const s of sections)if(s.section!=='SOURCE_METADATA')for(const row of sourceRows(envelope,s.section))if(pendingFor(s.section,row).length)pending++;
  const coverage={actionsTotal:actions.length,actionsPlanned:actions.length,checkpointsTotal:states.length,checkpointsPlanned:states.length,stableCheckpoints:stable,unstableCheckpoints:states.length-stable,
    interactionsTotal:sourceRows(envelope,'INTERACTIONS').length,interactionsPlanned:sourceRows(envelope,'INTERACTIONS').length,businessFixtures:fixtures.length,usableFixtures:usable,unavailableFixtures:fixtures.length-usable,
    sourceMetadataValues:metadataCount,documentsTotal:sourceRows(envelope,'DOCUMENTS').length,resourcesTotal:sourceRows(envelope,'RESOURCES').length,stateResourceLinksTotal:sourceRows(envelope,'STATE_RESOURCES').length,
    artifactsTotal:artifacts.length,referencedArtifacts:artifacts.length,verifiedArtifacts:artifacts.length,artifactBytesReferenced:artifactBytes,artifactsReadDuringCompilation:0,checksGenerated:0,
    validationUnitsPlanned:sections.reduce((n,s)=>n+s.count,0),validationUnitsPending:pending,validationUnitsExecuted:0};
  const reasons=Array.isArray(envelope.qualification?.reasonCodes)?envelope.qualification.reasonCodes.filter((c:unknown)=>typeof c==='string'&&/^[A-Z0-9_]{1,128}$/.test(c)):[];
  const limitations=sortedCodes(['UI_TEST_DESIGN_NOT_EXECUTED','UI_TEST_DESIGN_OBSERVED_CHARACTERIZATION','UI_TEST_DESIGN_VALIDATION_EXPANSION_DEFERRED','UI_TEST_DESIGN_PENDING_COMPARATORS',...reasons,
    ...(coverage.unstableCheckpoints?['UI_TEST_DESIGN_CHECKPOINT_UNSTABLE']:[]),...(coverage.unavailableFixtures?['UI_TEST_DESIGN_REPLAY_FIXTURES_UNAVAILABLE']:[])]);
  const commonBlocks=sortedCodes([...actions.flatMap(a=>pendingFor('ACTIONS',a)),...OMITTED_ACTION_CODES.filter(c=>limitations.includes(c))]);
  const required=['UI_TEST_DESIGN_TARGET_BUILD_REQUIRED','UI_TEST_DESIGN_RENDER_PROFILE_REQUIRED','UI_TEST_DESIGN_RUNNER_REQUIRED'];
  if(envelope.profile?.bootstrap?.mode==='UNAVAILABLE')required.push('UI_BOOTSTRAP_UNAVAILABLE');
  if(actions.some(a=>a.stateAfterId===null))required.push('UI_TEST_DESIGN_STATE_TRANSITIONS_UNPROVEN');
  const readiness=(blocks:string[])=>({status:blocks.length?'BLOCKED' as const:'REQUIRES_CONFIGURATION' as const,reasonCodes:sortedCodes([...blocks,...required])});
  const specification:ObservedPlanSpecification={contractVersion:'qagent.ui-test-design.v2',compilerVersion:UI_OBSERVED_COMPILER_VERSION,templateVersion:'qagent_ui_observed_templates_v2',adapterVersion:'qagent_ui_page_evidence_adapter_v1',canonicalizerVersion:'qagent.ui-canonical-json.v1',
    scope:source.scope,source,profile,executionModes:['UI_REPLAY','UI_LIVE'],entryUrl:envelope.journey.entryUrl,sourceBuildRef:envelope.journey.sourceBuildRef,
    preparation:{strategy:'EXECUTE_TARGET_BUILD',observedBootstrapPointer:'/profile/bootstrap',targetBuildPinRequired:true,freshContextPerMode:true,livePreparationRequired:true,observedResponsesRestoreWholeState:false},
    plan:{contractVersion:'qagent.ui-observed-validation-plan.v1',ruleSetVersion:'qagent_ui_observed_validation_rules_v1',selection:'ALL_OBSERVED',expectedValues:'IMMUTABLE_SOURCE_REFERENCES',expansion:'PAGED',unknownData:'PENDING_WITH_REASON',unstableEvidence:'PENDING_WITH_REASON',silentOmissionAllowed:false,completion:'ALL_SECTIONS_AND_ARTIFACT_CONTENT',pendingCannotPass:true,sections},
    evidenceVerification:{manifest:'VERIFIED',artifactBytes:'VERIFIED_AT_BUNDLE_ASSEMBLY',artifactBytesRecheckedDuringCompilation:false},coverage,limitations,
    readiness:{UI_REPLAY:readiness([...commonBlocks,...(coverage.unavailableFixtures?['UI_TEST_DESIGN_REPLAY_FIXTURES_UNAVAILABLE']:[])]),UI_LIVE:readiness(commonBlocks)},executionPerformed:false};
  validateUiObservedPlanShape(specification);check(signal);
  return {contractVersion:'qagent.ui-test-design-compilation.v2',compilerVersion:UI_OBSERVED_COMPILER_VERSION,outcome:'COMPILED',source,specification,specificationHash:await digestJson(specification),summary:{coverage,limitations,reasonCodes:[]},executionPerformed:false};
}

function preview(value:any):Record<string,unknown>{
  if(value===null)return {type:'null',value:null,previewOnly:true};
  if(typeof value==='string')return {type:'string',value:value.slice(0,160),previewTruncated:value.length>160,length:value.length,previewOnly:true};
  if(typeof value!=='object')return {type:typeof value,value,previewOnly:true};
  if(Array.isArray(value))return {type:'array',length:value.length,previewOnly:true};
  const fields=['type','actionId','eventId','stateId','checkpointId','documentId','resourceId','artifactId','kind','stability','availability','classification','observedSequence','requestSequence','completeness','contentType','byteLength'];
  const out:Record<string,unknown>={type:'object',fieldCount:Object.keys(value).length,previewOnly:true};
  for(const k of fields){const v=value[k];if(typeof v==='string')out[k]=v.slice(0,160);else if(typeof v==='number'||typeof v==='boolean'||v===null)out[k]=v;}
  if(value.actionId!==undefined){out.actionType=String(value.type??'').slice(0,32);for(const key of ['destination','inputValueRef','scrollTarget'])if(typeof value[key]==='string'){out[key]=value[key].slice(0,160);if(value[key].length>160)out.previewTruncated=true;}if(typeof value.checked==='boolean')out.checked=value.checked;
    if(value.target?.primaryLocator){out.locatorStrategy=String(value.target.primaryLocator.strategy??'').slice(0,32);const locator=String(value.target.primaryLocator.value??'');out.locator=locator.slice(0,160);if(locator.length>160)out.previewTruncated=true;}
    if(value.position&&typeof value.position==='object')for(const k of ['x','y','scrollX','scrollY'])if(typeof value.position[k]==='number'&&Number.isFinite(value.position[k]))out[k]=value.position[k];}
  if(value.request&&typeof value.request==='object'){out.method=String(value.request.method??'').slice(0,20);out.path=String(value.request.path??'').slice(0,160);}
  if(value.response&&typeof value.response==='object'){out.networkStatus=value.response.networkStatus??null;out.replayStatus=value.response.replayStatus??null;out.bodyState=String(value.response.bodyState??'').slice(0,32);}
  return out;
}
function keyOf(row:any,index:number){return String(row?.actionId??row?.stateId??row?.eventId??row?.fixtureId??row?.documentId??row?.resourceId??row?.artifactId??'entry_'+index).slice(0,200);}
function rowItem(envelope:any,section:string,index:number,row:any,pointer:string,rule:string):ObservedPlanItem{
  const reasons=pendingFor(section,row),isArtifact=section==='ARTIFACTS';
  return {index,id:keyOf(row,index),sourceRef:{manifestHash:envelope.manifestHash,pointer,artifactId:isArtifact?row.artifactId:null,sha256:isArtifact?row.sha256:null,byteLength:isArtifact?row.byteLength:null},
    validation:{rule,status:reasons.length?'PENDING':'PLANNED',reasonCodes:reasons},preview:preview(row)};
}
function encode(bytes:Uint8Array):string{return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
function unhex(text:string):Uint8Array{return Uint8Array.from(text.match(/../g)??[],x=>parseInt(x,16));}
async function cursorKey(secret:string){if(typeof secret!=='string'||secret.length<32)fail('UI_TEST_DESIGN_NOT_CONFIGURED',503);return crypto.subtle.importKey('raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function cursorEncode(context:string,offset:number,secret:string):Promise<string>{const body=btoa(canonicalJson({version:1,context,offset})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');const signature=await crypto.subtle.sign('HMAC',await cursorKey(secret),utf8.encode(body));return body+'.'+encode(new Uint8Array(signature));}
async function cursorOffset(value:string|undefined,context:string,secret:string):Promise<number>{
  if(value===undefined)return 0;
  if(typeof value!=='string'||value.length>4096||!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(value))fail('UI_TEST_DESIGN_CURSOR_INVALID');
  const [body,signature]=value.split('.');if(!await crypto.subtle.verify('HMAC',await cursorKey(secret),unhex(signature).slice().buffer,utf8.encode(body)))fail('UI_TEST_DESIGN_CURSOR_INVALID');
  let cursor:any;try{cursor=JSON.parse(atob(body.replace(/-/g,'+').replace(/_/g,'/')));}catch{fail('UI_TEST_DESIGN_CURSOR_INVALID');}
  if(!cursor||Object.keys(cursor).sort().join(',')!=='context,offset,version'||cursor.version!==1||cursor.context!==context||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)fail('UI_TEST_DESIGN_CURSOR_CONTEXT_MISMATCH',409);
  return cursor.offset;
}

/** Strict JSON evidence reader with no aggregate node cap. Byte size is already bounded per artifact.
 * Unsupported depth/duplicate keys become an explicit whole-artifact pending obligation, never lost fields. */
function parseEvidenceJson(text:string):any{
  let pos=0;const ws=()=>{while(/[\x20\t\r\n]/.test(text[pos]??'!'))pos++;};
  function str():string{const start=pos++;let escaped=false;for(;pos<text.length;pos++){const c=text[pos];if(c==='"'&&!escaped){pos++;return JSON.parse(text.slice(start,pos));}if(c==='\\'&&!escaped)escaped=true;else escaped=false;}throw new Error('unterminated');}
  function value(depth:number):any{if(depth>256)throw new Error('depth');ws();const c=text[pos];if(c==='"')return str();if(c==='{'){pos++;const out=Object.create(null);ws();if(text[pos]==='}'){pos++;return out;}while(pos<text.length){ws();if(text[pos]!=='"')throw new Error('key');const key=str();if(Object.hasOwn(out,key))throw new Error('duplicate');ws();if(text[pos++]!==':')throw new Error('colon');out[key]=value(depth+1);ws();const end=text[pos++];if(end==='}')return out;if(end!==',')throw new Error('comma');}throw new Error('object');}if(c==='['){pos++;const out:any[]=[];ws();if(text[pos]===']'){pos++;return out;}while(pos<text.length){out.push(value(depth+1));ws();const end=text[pos++];if(end===']')return out;if(end!==',')throw new Error('comma');}throw new Error('array');}for(const [token,result]of [['true',true],['false',false],['null',null]]as const){if(text.slice(pos,pos+token.length)===token){pos+=token.length;return result;}}const m=text.slice(pos).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);if(!m)throw new Error('number');pos+=m[0].length;const n=Number(m[0]);if(!Number.isFinite(n))throw new Error('number');return n;}
  const result=value(0);ws();if(pos!==text.length)throw new Error('trailing');return result;
}

export interface PlanPageRequest {specification:ObservedPlanSpecification;specificationHash:string;section:string;cursor?:string;limit?:number;artifactId?:string;}
type Reader=(id:string,options?:ArtifactReadOptions)=>Promise<Uint8Array>;
export async function observedPlanPage(envelope:Record<string,any>,input:PlanPageRequest,secret:string,readArtifact:Reader,signal?:AbortSignal):Promise<ObservedPlanPage>{
  check(signal);validateUiObservedPlanShape(input.specification);hash(input.specificationHash);
  if(await digestJson(input.specification)!==input.specificationHash)fail('UI_TEST_DESIGN_HASH_MISMATCH',409);
  // Regenerate only the small recipe: binds every count/rule/profile to the immutable manifest.
  const expected=await compileObservedPlan(envelope,input.specification.profile,signal);
  if(expected.specificationHash!==input.specificationHash)fail('UI_TEST_DESIGN_SOURCE_CHANGED',409);
  const section=UI_OBSERVED_SECTIONS.find(s=>s.section===input.section),content=input.section==='ARTIFACT_CONTENT';
  if(!section&&!content)fail('UI_TEST_DESIGN_SECTION_INVALID');
  if(content)id(input.artifactId);else if(input.artifactId!==undefined)fail('UI_TEST_DESIGN_ARTIFACT_CONTEXT_MISMATCH',409);
  const limit=input.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('UI_TEST_DESIGN_PAGINATION_INVALID');
  const artifactId=content?input.artifactId!:null,context=await digestJson({source:expected.source,specificationHash:input.specificationHash,section:input.section,artifactId});
  const offset=await cursorOffset(input.cursor,context,secret);check(signal);
  const page:ObservedPlanPage={contractVersion:'qagent.ui-test-design-plan-page.v1',source:expected.source,specificationHash:input.specificationHash,section:input.section,artifactId,items:[],totalItems:0,nextCursor:null,executionPerformed:false};
  if(content){
    const ref=sourceRows(envelope,'ARTIFACTS').find(r=>r.artifactId===artifactId);if(!ref)fail('UI_BUNDLE_ARTIFACT_NOT_REFERENCED',403);
    const bytes=await readArtifact(artifactId!,{signal,maxBytes:ref.byteLength});check(signal);
    if(bytes.length!==ref.byteLength||await sha256(bytes)!==ref.sha256)fail('UI_BUNDLE_ARTIFACT_HASH_MISMATCH',409);
    let data:any,parsed=false,parseError=false;
    if(/(?:application\/json|\+json)(?:;|$)/i.test(ref.contentType??'')||ref.kind?.endsWith('_JSON')){
      try{data=parseEvidenceJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));parsed=true;}catch{parseError=true;}
    }
    const reasons=pendingFor('ARTIFACTS',ref),known=plannedJsonKinds.has(ref.kind);
    if(parseError)reasons.push('UI_TEST_DESIGN_ARTIFACT_JSON_UNREADABLE');
    if(parsed){let i=0;for(const item of values(data)){if(i>=offset&&page.items.length<limit){const pending=sortedCodes([...reasons,...fieldReasons(envelope,ref,item.pointer),...(known?[]:['UI_TEST_DESIGN_UNKNOWN_FIELD_COMPARATOR_PENDING'])]);page.items.push({index:i,id:'value_'+i,sourceRef:{manifestHash:envelope.manifestHash,pointer:item.pointer,artifactId:ref.artifactId,sha256:ref.sha256,byteLength:ref.byteLength},validation:{rule:'ARTIFACT_JSON_VALUE',status:pending.length?'PENDING':'PLANNED',reasonCodes:pending},preview:preview(item.value)});}i++;}page.totalItems=i;}
    else {page.totalItems=1;if(offset===0)page.items=[{index:0,id:ref.artifactId,sourceRef:{manifestHash:envelope.manifestHash,pointer:'',artifactId:ref.artifactId,sha256:ref.sha256,byteLength:ref.byteLength},validation:{rule:'ARTIFACT_OPAQUE_BYTES',status:'PENDING',reasonCodes:sortedCodes([...reasons,parseError?'UI_TEST_DESIGN_ARTIFACT_JSON_UNREADABLE':'UI_TEST_DESIGN_ARTIFACT_COMPARATOR_PENDING'])},preview:{type:'opaque',kind:ref.kind,byteLength:bytes.length,integrity:'VERIFIED',previewOnly:true}}];}
  }else if(input.section==='SOURCE_METADATA'){
    let i=0;for(const entry of values(envelope,'',true)){if(i>=offset&&page.items.length<limit){const item=rowItem(envelope,'SOURCE_METADATA',i,entry.value,entry.pointer,section!.rule);item.id='metadata_'+i;item.preview.collectionReference=entry.collection;page.items.push(item);}i++;}page.totalItems=i;
  }else{
    const rows=sourceRows(envelope,input.section);page.totalItems=rows.length;
    for(let i=offset;i<rows.length&&page.items.length<limit;i++)page.items.push(rowItem(envelope,input.section,i,rows[i],section!.pointer+'/'+i,section!.rule));
  }
  if(offset>page.totalItems||(offset===page.totalItems&&offset!==0))fail('UI_TEST_DESIGN_CURSOR_INVALID');
  const next=offset+page.items.length;if(next<page.totalItems)page.nextCursor=await cursorEncode(context,next,secret);
  check(signal);validateUiObservedPlanPageShape(page);return page;
}
