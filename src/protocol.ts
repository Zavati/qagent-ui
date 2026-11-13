import { PAGE_SOURCE_REF_VERSION, PAGE_EXPORTER_VERSION, PAGE_OBSERVED_EXPORTER_VERSION, isPageExporter } from './contracts/pageSource';
/** Shared with Observation. Artifact and event contracts are the unchanged A.2 contracts. */
import { canonicalJson, digestJson, sha256, fail, readBytes, decodeJson, UiError } from './contracts/canonical';
import { id, hash, object, validateScope, validateCaptureStart, validateCaptureComplete, validateArtifactInput,
    validateEvents, type Scope, type CaptureStart, type CaptureComplete, type UiEvent, type ArtifactInput } from './contracts/uiCapture';

export const SOURCE_VERSION = 'qagent.ui-bundle-source.v1';
export const SOURCE_REF_VERSION = 'qagent.ui-bundle-source-ref.v1';
export const BUILD_REQUEST_VERSION = 'qagent.ui-bundle-build-request.v1';
export const ASSEMBLY_VERSION = 'qagent.ui-bundle-assembly.v1';
export const EXPORTER_VERSION = 'qagent_ui_source_v1';
export const BUILDER_VERSION = 'qagent_ui_bundle_builder_v2';
export const OBSERVED_BUILDER_VERSION = 'qagent_ui_bundle_builder_v3';
export function builderVersionForSource(source:SourceRef):string{return source.exporterVersion===PAGE_OBSERVED_EXPORTER_VERSION?OBSERVED_BUILDER_VERSION:BUILDER_VERSION;}
export const LEGACY_BUILDER_VERSION = 'qagent_ui_bundle_builder_v1';
export const PROFILE_VERSION = 'qagent.ui-assembly-profile.v1';
export const MATCH_VERSION = 'qagent_ui_exact_request_v1';
export const MAIN_QUEUE = 'qagent-ui-bundle-build-dev';
export const DLQ = 'qagent-ui-bundle-build-dlq-dev';
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const INTERNAL_MAX_BYTES = 32768;
export const SOURCE_PREFIX = '/internal/ui-bundles/v1/';
export const UI_PREFIX = '/internal/ui/v1/';

export interface SourceRef {
    contractVersion: typeof SOURCE_REF_VERSION | typeof PAGE_SOURCE_REF_VERSION;
    exporterVersion: typeof EXPORTER_VERSION | typeof PAGE_EXPORTER_VERSION | typeof PAGE_OBSERVED_EXPORTER_VERSION;
    scope: Scope;
    captureId: string;
    sourceRevision: string;
    sourceHash: string;
}
export interface SourceArtifact { artifactId: string; descriptor: ArtifactInput; status: 'PENDING' | 'FINALIZED'; }
export interface SourceSnapshot {
    contractVersion: typeof SOURCE_VERSION;
    exporterVersion: typeof EXPORTER_VERSION;
    scope: Scope;
    captureId: string;
    sourceRevision: string;
    capture: { descriptor: CaptureStart; completion: CaptureComplete; status: 'RECORDED' | 'PARTIAL' | 'ABORTED'; createdAt: number; completedAt: number; origins: string[] };
    ingestion: { expectedEvents: number; lastSequence: number; eventChainHash: string };
    events: UiEvent[];
    artifacts: SourceArtifact[];
}
export interface AssemblyProfile {
    contractVersion: typeof PROFILE_VERSION;
    revision: number;
    bootstrap: { mode: 'NONE' | 'CONTROLLED_SESSION' | 'UNAVAILABLE'; authProfileRef: string | null };
}
export const DEFAULT_PROFILE: AssemblyProfile = Object.freeze({ contractVersion: PROFILE_VERSION, revision: 1,
    bootstrap: Object.freeze({mode: 'UNAVAILABLE', authProfileRef: null}) });
export interface BuildMessage { contractVersion: typeof BUILD_REQUEST_VERSION; source: SourceRef; profile: AssemblyProfile; buildId: string; signature: string; }
export type BuildUnsigned = Omit<BuildMessage, 'signature'>;
export function errorCode(error: unknown): string {
    return error instanceof UiError ? error.code : 'UI_BUNDLE_SERVICE_UNAVAILABLE';
}
export function scoped(s: Scope): unknown[] { return [s.organizationId, s.projectId, s.environmentId]; }
export function sameScope(a: Scope,b: Scope): boolean { return canonicalJson(a) === canonicalJson(b); }
export function validateProfile(value: unknown): AssemblyProfile {
    const p = object(value,['contractVersion','revision','bootstrap']);
    if(p.contractVersion !== PROFILE_VERSION || !Number.isSafeInteger(p.revision) || p.revision < 1 || p.revision > 1000000) fail('UI_BUNDLE_PROFILE_INVALID');
    const b = object(p.bootstrap,['mode','authProfileRef']);
    if(!['NONE','CONTROLLED_SESSION','UNAVAILABLE'].includes(b.mode)) fail('UI_BUNDLE_PROFILE_INVALID');
    if(b.authProfileRef !== null) id(b.authProfileRef);
    if((b.mode === 'CONTROLLED_SESSION') !== (b.authProfileRef !== null)) fail('UI_BUNDLE_PROFILE_INVALID');
    return p as AssemblyProfile;
}
export function validateSourceRef(value: unknown): SourceRef {
    const s = object(value,['contractVersion','exporterVersion','scope','captureId','sourceRevision','sourceHash']);
    if(!((s.contractVersion === SOURCE_REF_VERSION && s.exporterVersion === EXPORTER_VERSION)||(s.contractVersion === PAGE_SOURCE_REF_VERSION && isPageExporter(s.exporterVersion)))) fail('UI_BUNDLE_SOURCE_VERSION_UNSUPPORTED');
    validateScope(s.scope); id(s.captureId); hash(s.sourceRevision); hash(s.sourceHash);
    if(!s.captureId.startsWith('uic_')) fail('UI_BUNDLE_SOURCE_INVALID');
    return s as SourceRef;
}
export async function validateSnapshot(value: unknown, ref: SourceRef): Promise<SourceSnapshot> {
    const s = object(value,['contractVersion','exporterVersion','scope','captureId','sourceRevision','capture','ingestion','events','artifacts']);
    if(s.contractVersion !== SOURCE_VERSION || s.exporterVersion !== EXPORTER_VERSION || s.captureId !== ref.captureId || s.sourceRevision !== ref.sourceRevision || !sameScope(s.scope,ref.scope)) fail('UI_BUNDLE_SOURCE_SCOPE_MISMATCH',409);
    if(await digestJson(s) !== ref.sourceHash) fail('UI_BUNDLE_SOURCE_HASH_MISMATCH',409);
    const c = object(s.capture,['descriptor','completion','status','createdAt','completedAt','origins']);
    validateCaptureStart(c.descriptor); validateCaptureComplete(c.completion);
    if(c.status !== c.completion.outcome || !['RECORDED','PARTIAL','ABORTED'].includes(c.status) || !Number.isSafeInteger(c.createdAt) || !Number.isSafeInteger(c.completedAt) || c.completedAt < c.createdAt) fail('UI_BUNDLE_SOURCE_NOT_RECONCILED',409);
    if(await digestJson(c.completion) !== ref.sourceRevision) fail('UI_BUNDLE_SOURCE_REVISION_MISMATCH',409);
    if(!Array.isArray(c.origins) || c.origins.length !== 1 || c.origins[0] !== new URL(c.descriptor.entryUrl).origin) fail('UI_BUNDLE_SOURCE_SCOPE_MISMATCH',409);
    const n = object(s.ingestion,['expectedEvents','lastSequence','eventChainHash']); hash(n.eventChainHash);
    if(!Array.isArray(s.events) || s.events.length > 2000 || s.events.length !== n.expectedEvents || n.lastSequence !== s.events.length-1) fail('UI_BUNDLE_SEQUENCE_GAP',409);
    let chain='0'.repeat(64);
    for(let start=0;start<s.events.length;start+=100) validateEvents({contractVersion:'qagent.ui-capture-events.v1',operationId:'op_bundle_validation',events:s.events.slice(start,start+100)});
    for(let i=0;i<s.events.length;i++) {
        const e=s.events[i] as UiEvent; const {contentHash,...content}=e;
        if(e.sequence!==i || await digestJson(content)!==contentHash) fail('UI_BUNDLE_EVENT_INTEGRITY_FAILED',409);
        // Keep identical to A.2 uiIngestion.nextEventChain; tested against the source implementation.
        chain=await digestJson([chain,e.sequence,e.contentHash]);
    }
    if(chain!==n.eventChainHash) fail('UI_BUNDLE_SEQUENCE_HASH_MISMATCH',409);
    if(!Array.isArray(s.artifacts) || s.artifacts.length>128) fail('UI_BUNDLE_SOURCE_INVALID',409);
    const seen=new Set<string>();
    for(const a of s.artifacts) {
        object(a,['artifactId','descriptor','status']); id(a.artifactId); validateArtifactInput(a.descriptor);
        if(seen.has(a.artifactId) || !['PENDING','FINALIZED'].includes(a.status) || a.descriptor.privacy.dataOrigin!==c.descriptor.dataOrigin) fail('UI_BUNDLE_SOURCE_INVALID',409);
        seen.add(a.artifactId);
    }
    return s as SourceSnapshot;
}
async function hmacKey(secret: string|undefined, usage: KeyUsage[]): Promise<CryptoKey> {
    if(typeof secret!=='string' || secret.length<32 || secret.length>512) fail('UI_BUNDLE_AUTH_UNAVAILABLE',503);
    return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,usage);
}
function hex(bytes: ArrayBuffer): string { return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''); }
function unhex(s: string): Uint8Array { hash(s); return Uint8Array.from(s.match(/../g)!,v=>parseInt(v,16)); }
async function sign(secret: string|undefined, data: string): Promise<string> {
    return hex(await crypto.subtle.sign('HMAC',await hmacKey(secret,['sign']),new TextEncoder().encode(data)));
}
async function verify(secret: string|undefined,data: string, signature: string): Promise<void> {
    if(!/^[a-f0-9]{64}$/.test(signature) || !await crypto.subtle.verify('HMAC',await hmacKey(secret,['verify']),unhex(signature).slice().buffer,new TextEncoder().encode(data))) fail('UI_BUNDLE_AUTH_INVALID',401);
}
export async function identityForBuilder(source: SourceRef,profile: AssemblyProfile,builderVersion:string): Promise<{buildId:string;journeyId:string;journeyVersionId:string;bundleId:string;bundleVersionId:string}> {
    const captureKey=await digestJson({scope:source.scope,captureId:source.captureId});
    const version=await digestJson({source,profile,builderVersion,matchPolicyVersion:MATCH_VERSION});
    return {buildId:'uib_'+version,journeyId:'uj_'+captureKey,journeyVersionId:'ujv_'+version,bundleId:'urb_'+captureKey,bundleVersionId:'urbv_'+version};
}
export async function identity(source: SourceRef,profile: AssemblyProfile) { return identityForBuilder(source,profile,builderVersionForSource(source)); }
export async function messageBuilderVersion(message:Pick<BuildMessage,'source'|'profile'|'buildId'>):Promise<string|null> {
    const expected=builderVersionForSource(message.source);
    if(message.buildId===(await identityForBuilder(message.source,message.profile,expected)).buildId)return expected;
    if(message.source.exporterVersion!==PAGE_OBSERVED_EXPORTER_VERSION&&message.buildId===(await identityForBuilder(message.source,message.profile,LEGACY_BUILDER_VERSION)).buildId)return LEGACY_BUILDER_VERSION;
    return null;
}
export async function makeMessage(source:SourceRef,profile:AssemblyProfile,secret:string|undefined):Promise<BuildMessage> {
    validateSourceRef(source);validateProfile(profile);
    const unsigned:BuildUnsigned={contractVersion:BUILD_REQUEST_VERSION,source,profile,buildId:(await identity(source,profile)).buildId};
    return {...unsigned,signature:await sign(secret,'QAGENT_UI_BUNDLE_QUEUE_V1\n'+canonicalJson(unsigned))};
}
export async function validateMessage(value:unknown,secret:string|undefined):Promise<BuildMessage> {
    const m=object(value,['contractVersion','source','profile','buildId','signature']);
    if(m.contractVersion!==BUILD_REQUEST_VERSION) fail('UI_BUNDLE_MESSAGE_UNSUPPORTED');
    validateSourceRef(m.source);validateProfile(m.profile);id(m.buildId);
    if(!(await messageBuilderVersion(m as BuildMessage))) fail('UI_BUNDLE_MESSAGE_IDENTITY_MISMATCH',409);
    const {signature,...unsigned}=m;
    await verify(secret,'QAGENT_UI_BUNDLE_QUEUE_V1\n'+canonicalJson(unsigned),signature);
    return m as BuildMessage;
}
export async function signedRequest(url:string,body:unknown,secret:string|undefined,principal:'source'|'operator',now=Date.now()):Promise<Request> {
    const bytes=new TextEncoder().encode(canonicalJson(body));
    if(bytes.length>INTERNAL_MAX_BYTES) fail('UI_BUNDLE_CONTROL_TOO_LARGE',413);
    const time=String(Math.floor(now/1000)),path=new URL(url).pathname;
    const signature=await sign(secret,`QAGENT_UI_BUNDLE_HTTP_V1\n${principal}\nPOST\n${path}\n${time}\n${await sha256(bytes)}`);
    return new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-QAgent-Bundle-Principal':principal,'X-QAgent-Bundle-Time':time,'X-QAgent-Bundle-Signature':signature},body:bytes.slice().buffer,redirect:'manual'});
}
export async function authenticate(request:Request,secret:string|undefined,principal:'source'|'operator',now=Date.now()):Promise<unknown> {
    if(request.method!=='POST' || new URL(request.url).search || request.headers.get('X-QAgent-Bundle-Principal')!==principal) fail('UI_BUNDLE_AUTH_INVALID',401);
    const time=request.headers.get('X-QAgent-Bundle-Time')??'';
    if(!/^\d{10,12}$/.test(time) || Math.abs(now/1000-Number(time))>60) fail('UI_BUNDLE_AUTH_EXPIRED',401);
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')) fail('UI_MEDIA_TYPE_UNSUPPORTED',415);
    const bytes=await readBytes(request,INTERNAL_MAX_BYTES);
    await verify(secret,`QAGENT_UI_BUNDLE_HTTP_V1\n${principal}\nPOST\n${new URL(request.url).pathname}\n${time}\n${await sha256(bytes)}`,request.headers.get('X-QAgent-Bundle-Signature')??'');
    return decodeJson(bytes);
}
export function json(value:unknown,status=200):Response { return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}); }
export function safeFailure(error:unknown):Response { return json({status:'error',code:errorCode(error)},error instanceof UiError?error.status:503); }
export function log(event:string,fields:Record<string,unknown>={}):void { console.info(JSON.stringify({t:'qagent_ui_bundle',event,...fields})); }
export async function limitedResponse(response:Response,max:number):Promise<Uint8Array> {
    const length=response.headers.get('content-length');
    if(length && (!/^\d+$/.test(length) || Number(length)>max)) fail('UI_BUNDLE_UPSTREAM_TOO_LARGE',413);
    if(!response.body) return new Uint8Array();
    const reader=response.body.getReader(), parts:Uint8Array[]=[];let size=0;
    try {while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>max){await reader.cancel();fail('UI_BUNDLE_UPSTREAM_TOO_LARGE',413);}parts.push(p.value);}}
    finally {reader.releaseLock();}
    const out=new Uint8Array(size);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;
}
export async function internalFetch(binding:Fetcher|undefined,path:string,body:unknown,secret:string|undefined,principal:'source'|'operator'='source'):Promise<Response> {
    if(!binding) fail('UI_BUNDLE_SOURCE_UNAVAILABLE',503);
    const req=await signedRequest('https://qagent.internal'+path,body,secret,principal);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try {
        const response=await binding.fetch(new Request(req,{signal:controller.signal}));
        if(!response.ok) {
            let code='UI_BUNDLE_UPSTREAM_UNAVAILABLE';
            try {const parsed=JSON.parse(new TextDecoder().decode(await limitedResponse(response,INTERNAL_MAX_BYTES)));if(typeof parsed.code==='string'&&/^[A-Z][A-Z0-9_]{2,100}$/.test(parsed.code))code=parsed.code;}catch{}
            fail(code,response.status);
        }
        return response;
    } finally {clearTimeout(timer);}
}
