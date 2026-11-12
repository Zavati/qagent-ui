/** PAGE-COPY PC.2. Explicit v2 contracts; v1 validators remain unchanged.
 * New writes are synthetic-only until the observed collector/sanitizers are implemented in PC.3.
 * The wire representation is archival evidence, never executable Console content. */
import { canonicalJson, decodeJson, fail } from './canonical';
import { object, id, hash, safeUrl, origin, validateAction, validateCheckpoint, validateInteraction,
    validateEvents, validateCaptureStart, validateCaptureComplete, CONTRACTS, UI_LIMITS,
    type ArtifactInput, type CaptureStart, type CaptureComplete, type EventsInput, type UiEvent } from './uiCapture';

export const PAGE_REVISION = '08.2-PC.2.r1';
export const PAGE_CONTRACTS = Object.freeze({capture:'qagent.ui-capture.v2',events:'qagent.ui-capture-events.v2',artifact:'qagent.ui-artifact.v2',action:'qagent.ui-action.v2',interaction:'qagent.ui-interaction.v2',checkpoint:'qagent.ui-checkpoint.v2'});
// Initial tested profile: bound the whole verification pass; do not advertise 2048 objects yet.
export const PAGE_LIMITS = Object.freeze({artifactBytes:16*1024*1024,artifactsPerCapture:512,captureArtifactBytes:256*1024*1024,
    manifestBytes:256*1024,graphDepth:8,sourcePartBytes:256*1024,sourcePartItems:64,sourceParts:128,
    eventBytes:UI_LIMITS.eventBytes,batchBytes:UI_LIMITS.batchBytes,batchEvents:UI_LIMITS.batchEvents,captureEvents:UI_LIMITS.captureEvents,captureEventBytes:UI_LIMITS.captureEventBytes});
export const PAGE_KINDS = ['DOCUMENT_HTML','RENDERED_HTML','DOM_SNAPSHOT_JSON','LAYOUT_JSON','FORM_STATE_JSON','RESOURCE_MANIFEST_JSON','CSS_TEXT','SCRIPT_TEXT','ASSET_BINARY','HTTP_REQUEST_BODY','HTTP_RESPONSE_BODY','SCREENSHOT_PNG','ACTION_VALUE_JSON','HEADERS_JSON'] as const;
export type PageArtifactKind = typeof PAGE_KINDS[number];
export const PAGE_PRIVACY = 'qagent.ui-page-synthetic.v1';
export type PageLimits = {artifactBytes:number;artifactsPerCapture:number;captureArtifactBytes:number};
export interface PageArtifactInput {
    contractVersion: typeof PAGE_CONTRACTS.artifact; operationId:string; kind:PageArtifactKind;
    contentType:string; originalContentType:string; storedEncoding:'identity'; representation:'UTF8_TEXT'|'STRUCTURED_JSON'|'BINARY';
    captureMethod:'NETWORK_BODY'|'DOM_SERIALIZATION'|'DOM_SNAPSHOT'|'CSSOM'|'FORM_STATE'|'SCREENSHOT'|'MANIFEST'|'SYNTHETIC_FIXTURE';
    completeness:'COMPLETE'|'TRUNCATED'; byteLength:number;sha256:string;
    privacy:{policyVersion:typeof PAGE_PRIVACY;dataOrigin:'SYNTHETIC_CONTROL';transformations:{kind:'REDACTED'|'PSEUDONYMIZED';path:string}[]};
}
export type AnyArtifactInput=ArtifactInput|PageArtifactInput;
export type PageCaptureStart=CaptureStart & {limitsSnapshot?:PageLimits};
export const isPageCapture=(v:any):boolean=>v?.contractVersion===PAGE_CONTRACTS.capture;
export const isPageArtifact=(v:any):v is PageArtifactInput=>v?.contractVersion===PAGE_CONTRACTS.artifact;
export function uint(v:unknown,max=Number.MAX_SAFE_INTEGER):asserts v is number {if(!Number.isSafeInteger(v)||Number(v)<0||Number(v)>max)fail('UI_PAGE_NUMBER_INVALID');}
function string(v:unknown,max=4096):asserts v is string {if(typeof v!=='string'||!v.length||v.length>max||/[\x00-\x1f\x7f]/.test(v))fail('UI_PAGE_TEXT_INVALID');}
function choice(v:unknown,values:readonly unknown[]):void {if(!values.includes(v))fail('UI_PAGE_ENUM_INVALID');}
export function ids(v:unknown,max=512):asserts v is string[] {if(!Array.isArray(v)||v.length>max)fail('UI_PAGE_LIST_LIMIT',413);v.forEach(id);if(new Set(v).size!==v.length)fail('UI_PAGE_DUPLICATE_REF',409);}
function nullable(v:unknown):void {if(v!==null)id(v);}
export function pageLimits(value:unknown):PageLimits {const v=object(value,['artifactBytes','artifactsPerCapture','captureArtifactBytes']);for(const k of Object.keys(v)){uint(v[k],PAGE_LIMITS[k as keyof PageLimits]);if(v[k]<1)fail('UI_PAGE_LIMIT_INVALID');}if(v.artifactBytes>v.captureArtifactBytes)fail('UI_PAGE_LIMIT_INVALID');return v as PageLimits;}
export function resolvePageLimits(env:Record<string,unknown>):PageLimits {
    const defaults:PageLimits={artifactBytes:PAGE_LIMITS.artifactBytes,artifactsPerCapture:PAGE_LIMITS.artifactsPerCapture,captureArtifactBytes:PAGE_LIMITS.captureArtifactBytes};
    for(const [k,n] of Object.entries({artifactBytes:'UI_PAGE_ARTIFACT_BYTES',artifactsPerCapture:'UI_PAGE_ARTIFACT_COUNT',captureArtifactBytes:'UI_PAGE_CAPTURE_BYTES'})) {
        if(env[n]!==undefined){if(typeof env[n]!=='string'||!/^\d+$/.test(env[n] as string))fail('UI_PAGE_LIMIT_CONFIG_INVALID',503);(defaults as any)[k]=Number(env[n]);}
    }
    return pageLimits(defaults);
}
export function validatePageStart(value:unknown,stored=false):PageCaptureStart {
    const v=object(value,['contractVersion','operationId','dataOrigin','documentId','entryUrl','sourceBuildRef','issues'],stored?['limitsSnapshot']:[]);
    if(v.contractVersion!==PAGE_CONTRACTS.capture)fail('UI_CONTRACT_VERSION_UNSUPPORTED');
    if(v.dataOrigin!=='SYNTHETIC_CONTROL')fail('UI_PAGE_OBSERVED_NOT_ENABLED',422);
    const {limitsSnapshot,...base}=v;validateCaptureStart({...base,contractVersion:CONTRACTS.capture});
    if(stored){pageLimits(limitsSnapshot);}return v as PageCaptureStart;
}
export function validateStartAny(v:unknown):CaptureStart {return isPageCapture(v)?validatePageStart(v):validateCaptureStart(v);}
export function validateCompleteAny(v:unknown):CaptureComplete {
    if(isPageCapture(v)){validateCaptureComplete({...v as object,contractVersion:CONTRACTS.capture});return v as CaptureComplete;}
    return validateCaptureComplete(v);
}
export function validatePageArtifact(value:unknown):PageArtifactInput {
    const v=object(value,['contractVersion','operationId','kind','contentType','originalContentType','storedEncoding','representation','captureMethod','completeness','byteLength','sha256','privacy']);
    if(v.contractVersion!==PAGE_CONTRACTS.artifact)fail('UI_CONTRACT_VERSION_UNSUPPORTED');id(v.operationId);hash(v.sha256);choice(v.kind,PAGE_KINDS);
    uint(v.byteLength,PAGE_LIMITS.artifactBytes);if(!v.byteLength)fail('UI_PAGE_EMPTY_BODY_USE_STATE');
    if(typeof v.contentType!=='string'||!/^[-a-z0-9.+]+\/[-a-z0-9.+]+$/.test(v.contentType)||v.contentType.length>128)fail('UI_MEDIA_TYPE_UNSUPPORTED',415);
    string(v.originalContentType,256);choice(v.storedEncoding,['identity']);choice(v.representation,['UTF8_TEXT','STRUCTURED_JSON','BINARY']);
    choice(v.captureMethod,['NETWORK_BODY','DOM_SERIALIZATION','DOM_SNAPSHOT','CSSOM','FORM_STATE','SCREENSHOT','MANIFEST','SYNTHETIC_FIXTURE']);choice(v.completeness,['COMPLETE','TRUNCATED']);
    const p=object(v.privacy,['policyVersion','dataOrigin','transformations']);
    if(p.policyVersion!==PAGE_PRIVACY||p.dataOrigin!=='SYNTHETIC_CONTROL')fail('UI_PAGE_OBSERVED_NOT_ENABLED',422);
    if(!Array.isArray(p.transformations)||p.transformations.length>64)fail();
    p.transformations.forEach((t:any)=>{object(t,['kind','path']);choice(t.kind,['REDACTED','PSEUDONYMIZED']);string(t.path,512);});
    const jsonKinds=['DOM_SNAPSHOT_JSON','LAYOUT_JSON','FORM_STATE_JSON','RESOURCE_MANIFEST_JSON','ACTION_VALUE_JSON','HEADERS_JSON'];
    if(jsonKinds.includes(v.kind)){if(v.contentType!=='application/json'||v.representation!=='STRUCTURED_JSON'||v.completeness!=='COMPLETE')fail('UI_PAGE_ARTIFACT_FORMAT_INVALID',422);}
    const textTypes:Record<string,string[]>={DOCUMENT_HTML:['text/html'],RENDERED_HTML:['text/html'],CSS_TEXT:['text/css'],SCRIPT_TEXT:['text/javascript','application/javascript']};
    if(textTypes[v.kind]&&(!textTypes[v.kind].includes(v.contentType)||v.representation!=='UTF8_TEXT'))fail('UI_PAGE_ARTIFACT_FORMAT_INVALID',422);
    const binaryTypes=['image/png','image/jpeg','image/gif','image/webp','font/woff','font/woff2','font/ttf','font/otf'];
    if(v.kind==='SCREENSHOT_PNG'&&(v.contentType!=='image/png'||v.representation!=='BINARY'))fail('UI_PAGE_ARTIFACT_FORMAT_INVALID',422);
    if(v.kind==='ASSET_BINARY'&&(!binaryTypes.includes(v.contentType)||v.representation!=='BINARY'))fail('UI_PAGE_BINARY_UNSUPPORTED',415);
    if(['HTTP_REQUEST_BODY','HTTP_RESPONSE_BODY'].includes(v.kind)) {
        const ok=v.representation==='STRUCTURED_JSON'?v.contentType==='application/json':v.representation==='BINARY'?v.contentType==='application/octet-stream':['text/plain','text/html','text/css','text/javascript','application/javascript','application/x-www-form-urlencoded','application/xml','text/xml'].includes(v.contentType);
        if(!ok)fail('UI_PAGE_ARTIFACT_FORMAT_INVALID',422);
    }
    if(v.kind==='RESOURCE_MANIFEST_JSON'&&v.byteLength>PAGE_LIMITS.manifestBytes)fail('UI_PAGE_MANIFEST_LIMIT',413);
    return v as PageArtifactInput;
}
export function artifactLimit(d:AnyArtifactInput):number{return isPageArtifact(d)?PAGE_LIMITS.artifactBytes:UI_LIMITS.artifactBytes;}
export interface PageStateWire {
    contractVersion:'qagent.ui-page-state.v1';stateId:string;stateSequence:number;observedSequence:number;url:string;
    captureStartedUs:number;captureFinishedUs:number;stability:'STABLE'|'UNSTABLE'|'INTERRUPTED';
    domRef:string|null;htmlRef:string|null;layoutRef:string|null;formStateRef:string|null;resourceManifestRef:string|null;screenshotRef:string|null;mhtmlRef:null;missing:string[];
}
export function validatePageState(value:unknown):PageStateWire {
    const v=object(value,['contractVersion','stateId','stateSequence','observedSequence','url','captureStartedUs','captureFinishedUs','stability','domRef','htmlRef','layoutRef','formStateRef','resourceManifestRef','screenshotRef','mhtmlRef','missing']);
    if(v.contractVersion!=='qagent.ui-page-state.v1')fail('UI_CONTRACT_VERSION_UNSUPPORTED');id(v.stateId);uint(v.stateSequence);uint(v.observedSequence);safeUrl(v.url);uint(v.captureStartedUs);uint(v.captureFinishedUs);if(v.captureFinishedUs<v.captureStartedUs)fail('UI_PAGE_TIME_INVALID');
    choice(v.stability,['STABLE','UNSTABLE','INTERRUPTED']);for(const k of ['domRef','htmlRef','layoutRef','formStateRef','resourceManifestRef','screenshotRef'])nullable(v[k]);
    if(v.mhtmlRef!==null)fail('UI_PAGE_MHTML_UNSUPPORTED',422);ids(v.missing,64);return v as PageStateWire;
}
export function validateEventsAny(value:unknown):EventsInput {
    if((value as any)?.contractVersion!==PAGE_CONTRACTS.events)return validateEvents(value);
    const v=object(value,['contractVersion','operationId','events']);id(v.operationId);
    if(!Array.isArray(v.events)||!v.events.length||v.events.length>UI_LIMITS.batchEvents)fail('UI_PAGE_EVENT_LIMIT',413);
    const seen=new Set(),seqs=new Set();
    for(const e of v.events) {
        object(e,['eventId','sequence','kind','payload','contentHash']);id(e.eventId);uint(e.sequence,100000);hash(e.contentHash);
        if(seen.has(e.eventId)||seqs.has(e.sequence))fail('UI_EVENT_CONFLICT',409);seen.add(e.eventId);seqs.add(e.sequence);
        const p=e.payload;
        if(e.kind==='GAP') {validateEvents({contractVersion:CONTRACTS.events,operationId:v.operationId,events:[e]});continue;}
        if(!p||typeof p!=='object')fail();uint(p.observedSequence);uint(p.relativeTimeUs);id(p.frameId);
        if(p.relativeTimeMs!==Math.floor(p.relativeTimeUs/1000))fail('UI_PAGE_TIME_INVALID');
        const {observedSequence,relativeTimeUs,frameId,...base}=p;
        if(e.kind==='ACTION') {
            if(p.contractVersion!==PAGE_CONTRACTS.action)fail('UI_CONTRACT_VERSION_UNSUPPORTED');
            const {stateBeforeId,stateAfterId,scrollTarget,clickCount,...old}=base;
            nullable(stateBeforeId);nullable(stateAfterId);
            if(scrollTarget!==undefined){id(scrollTarget);if(p.type!=='SCROLL')fail();}
            if(clickCount!==undefined){uint(clickCount,2);if(clickCount<1||p.type!=='CLICK')fail();}
            validateAction({...old,contractVersion:CONTRACTS.action});
        } else if(e.kind==='CHECKPOINT') {
            if(p.contractVersion!==PAGE_CONTRACTS.checkpoint)fail('UI_CONTRACT_VERSION_UNSUPPORTED');
            const {pageCapture,...old}=base;validateCheckpoint({...old,contractVersion:CONTRACTS.checkpoint});
            const page=validatePageState(pageCapture);if(page.screenshotRef!==p.screenshotRef||page.observedSequence!==observedSequence)fail('UI_PAGE_CHECKPOINT_MISMATCH');
        } else if(e.kind==='INTERACTION') {
            if(p.contractVersion!==PAGE_CONTRACTS.interaction)fail('UI_CONTRACT_VERSION_UNSUPPORTED');
            const {requestSequence,redirectHop,resourceId,resourceType,classification,startedOffsetUs,finishedOffsetUs,...old}=base;
            uint(requestSequence);uint(redirectHop,100);id(resourceId);uint(startedOffsetUs);if(finishedOffsetUs!==null){uint(finishedOffsetUs);if(finishedOffsetUs<startedOffsetUs)fail('UI_PAGE_TIME_INVALID');}
            choice(resourceType,['DOCUMENT','STYLESHEET','SCRIPT','IMAGE','FONT','MEDIA','XHR','FETCH','OTHER']);choice(classification,['BUSINESS_API','APP_RESOURCE','BOOTSTRAP','AUXILIARY']);
            const res=object(p.response,['status','bodyRef','headersRef','bodyHash','completeness','bodyState','bodySource','networkStatus','replayStatus','cacheEvidence']);
            const {bodyState,bodySource,networkStatus,replayStatus,cacheEvidence,...oldResponse}=res;
            choice(bodyState,['COMPLETE','EMPTY','MISSING','OMITTED','TRUNCATED']);choice(bodySource,['NETWORK','CACHE','UNAVAILABLE']);
            if(res.status!==networkStatus)fail('UI_PAGE_STATUS_MISMATCH');
            if(replayStatus!==null){uint(replayStatus,599);if(replayStatus<100)fail();}
            if(['EMPTY','MISSING','OMITTED'].includes(bodyState)&&(res.bodyRef!==null||res.bodyHash!==null))fail('UI_PAGE_BODY_STATE_INVALID');
            if(['COMPLETE','TRUNCATED'].includes(bodyState)&&(!res.bodyRef||!res.bodyHash))fail('UI_PAGE_BODY_STATE_INVALID');
            if((['MISSING','OMITTED'].includes(bodyState))!==(bodySource==='UNAVAILABLE'))fail('UI_PAGE_BODY_STATE_INVALID');
            if(['COMPLETE','EMPTY'].includes(bodyState)!==(res.completeness==='COMPLETE'))fail('UI_PAGE_BODY_STATE_INVALID');
            if(bodySource==='CACHE') {
                const c=object(cacheEvidence,['bodySha256','representationId','matchKeySha256']);hash(c.bodySha256);hash(c.matchKeySha256);id(c.representationId);
                if(c.bodySha256!==res.bodyHash||networkStatus!==304||replayStatus!==200||bodyState!=='COMPLETE')fail('UI_PAGE_CACHE_EVIDENCE_INVALID');
            } else if(cacheEvidence!==null||replayStatus!==networkStatus)fail('UI_PAGE_CACHE_EVIDENCE_INVALID');
            if(networkStatus===304&&bodySource!=='CACHE'&&bodyState!=='MISSING')fail('UI_PAGE_CACHE_EVIDENCE_REQUIRED');
            if((p.request.method==='HEAD'||[204,205].includes(networkStatus))&&bodyState!=='EMPTY')fail('UI_PAGE_BODY_STATE_INVALID');
            // v1 rejects legitimate empty 200 bodies. Validation proxy is structural only; stored bytes/status are never changed.
            validateInteraction({...old,contractVersion:CONTRACTS.interaction,response:{...oldResponse,...(bodyState==='EMPTY'?{status:204}:{})}});
        } else fail('UI_PAGE_EVENT_KIND_INVALID');
        if(['ACTION','CHECKPOINT'].includes(e.kind)&&p.sequence!==e.sequence)fail('UI_EVENT_CONFLICT',409);
        if(new TextEncoder().encode(canonicalJson(e)).length>UI_LIMITS.eventBytes)fail('UI_EVENT_TOO_LARGE',413);
    }
    return v as EventsInput;
}
export function pageEventRefs(event:UiEvent):string[] {
    const p:any=event.payload;const refs:string[]=[];
    if(event.kind==='ACTION'&&p.input?.valueRef)refs.push(p.input.valueRef);
    if(event.kind==='INTERACTION')refs.push(p.request.bodyRef,p.request.businessHeadersRef,p.response.bodyRef,p.response.headersRef);
    if(event.kind==='CHECKPOINT') {
        refs.push(p.functionalRef,p.semanticRef,p.screenshotRef);
        if(p.pageCapture) for(const key of ['domRef','htmlRef','layoutRef','formStateRef','resourceManifestRef','screenshotRef'])refs.push(p.pageCapture[key]);
    }
    return [...new Set(refs.filter((x):x is string=>typeof x==='string'))];
}
export interface ResourceManifest { contractVersion:'qagent.ui-resource-manifest.v1';parts:string[];artifacts:{artifactId:string;kind:string;sha256:string}[];documents:Record<string,any>[];resources:Record<string,any>[];stateResources:Record<string,any>[]; }
export function validateResourceManifest(value:unknown):ResourceManifest {
    const v=object(value,['contractVersion','parts','artifacts','documents','resources','stateResources']);
    if(v.contractVersion!=='qagent.ui-resource-manifest.v1')fail('UI_CONTRACT_VERSION_UNSUPPORTED');ids(v.parts,64);
    if(!Array.isArray(v.artifacts)||v.artifacts.length>128)fail('UI_PAGE_MANIFEST_LIMIT',413);
    const seen=new Set();for(const a of v.artifacts){object(a,['artifactId','kind','sha256']);id(a.artifactId);hash(a.sha256);string(a.kind,80);if(seen.has(a.artifactId))fail('UI_PAGE_DUPLICATE_REF');seen.add(a.artifactId);}
    for(const key of ['documents','resources','stateResources'])if(!Array.isArray(v[key])||v[key].length>128)fail('UI_PAGE_MANIFEST_LIMIT',413);
    // Projection record details are validated by pageValidation in the Observation before use.
    for(const d of v.documents){if(!d||typeof d!=='object')fail();id(d.documentId);if(d.sourceHtmlRef!==null&&!seen.has(d.sourceHtmlRef))fail('UI_PAGE_MANIFEST_REF_MISSING');}
    for(const d of v.resources){if(!d||typeof d!=='object')fail();id(d.resourceId);if(d.bodyRef!==null&&!seen.has(d.bodyRef))fail('UI_PAGE_MANIFEST_REF_MISSING');}
    if(new TextEncoder().encode(canonicalJson(v)).length>PAGE_LIMITS.manifestBytes)fail('UI_PAGE_MANIFEST_LIMIT',413);
    return v as ResourceManifest;
}

/** Validate each typed direct reference without inspecting arbitrary page strings. */
export function assertPageEventRefTypes(event:UiEvent,lookup:(artifactId:string)=>PageArtifactInput|undefined):void {
 const p:any=event.payload;
 for(const artifactId of pageEventRefs(event)) {
  const d=lookup(artifactId);if(!d)fail('UI_ARTIFACT_REF_UNAVAILABLE',409);const expected:string[]=[];
  if(event.kind==='ACTION'&&p.input?.valueRef===artifactId)expected.push('ACTION_VALUE_JSON');
  if(event.kind==='INTERACTION'){
   if(p.request.bodyRef===artifactId)expected.push('HTTP_REQUEST_BODY');
   if(p.response.bodyRef===artifactId){expected.push('HTTP_RESPONSE_BODY');if(p.response.bodyHash!==d.sha256)fail('UI_CHECKSUM_MISMATCH',409);if((p.response.bodyState==='COMPLETE')!==(d.completeness==='COMPLETE'))fail('UI_PAGE_BODY_STATE_INVALID');}
   if(p.request.businessHeadersRef===artifactId||p.response.headersRef===artifactId)expected.push('HEADERS_JSON');
  }
  if(event.kind==='CHECKPOINT'){
   if(p.semanticRef===artifactId||p.functionalRef===artifactId)expected.push('DOM_SNAPSHOT_JSON');
   if(p.screenshotRef===artifactId)expected.push('SCREENSHOT_PNG');
   const roles:Record<string,string>={domRef:'DOM_SNAPSHOT_JSON',htmlRef:'RENDERED_HTML',layoutRef:'LAYOUT_JSON',formStateRef:'FORM_STATE_JSON',resourceManifestRef:'RESOURCE_MANIFEST_JSON',screenshotRef:'SCREENSHOT_PNG'};
   for(const [field,kind] of Object.entries(roles))if(p.pageCapture[field]===artifactId)expected.push(kind);
  }
  if(expected.some(kind=>kind!==d.kind))fail('UI_ARTIFACT_KIND_MISMATCH',422);
 }
}
