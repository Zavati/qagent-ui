/** Paged PAGE-COPY source. Hashes identify stored bytes; no HTML/body in Queue. */
import { canonicalJson, digestJson, fail } from './canonical';
import { id, hash, object, validateScope, type Scope } from './uiCapture';
import { PAGE_LIMITS, validatePageStart, validateCompleteAny, ids, uint } from './uiPageCopy';
export const PAGE_SOURCE_VERSION='qagent.ui-page-source.v2';
export const PAGE_SOURCE_REF_VERSION='qagent.ui-bundle-source-ref.v2';
export const PAGE_EXPORTER_VERSION='qagent_ui_page_source_v2';
export const PAGE_OBSERVED_EXPORTER_VERSION='qagent_ui_page_observed_source_v2';
export function isPageExporter(value:unknown):boolean{return value===PAGE_EXPORTER_VERSION||value===PAGE_OBSERVED_EXPORTER_VERSION;}
export function pageExporterForCapture(capture:{dataOrigin:string}):typeof PAGE_EXPORTER_VERSION|typeof PAGE_OBSERVED_EXPORTER_VERSION{return capture.dataOrigin==='OBSERVED_SANITIZED'?PAGE_OBSERVED_EXPORTER_VERSION:PAGE_EXPORTER_VERSION;}
export const PAGE_PART_VERSION='qagent.ui-page-source-part.v1';
export interface PagePartRef {kind:'EVENTS'|'ARTIFACTS';index:number;sha256:string;byteLength:number;count:number;}
export interface PageSourceRoot {contractVersion:typeof PAGE_SOURCE_VERSION;exporterVersion:typeof PAGE_EXPORTER_VERSION|typeof PAGE_OBSERVED_EXPORTER_VERSION;scope:Scope;captureId:string;sourceRevision:string;
 capture:{descriptor:any;completion:any;status:string;createdAt:number;completedAt:number;origins:string[]};
 ingestion:{expectedEvents:number;lastSequence:number;eventChainHash:string};parts:PagePartRef[];reachableArtifactIds:string[];counts:{events:number;artifacts:number;referencedArtifacts:number};}
export function validatePartRef(value:unknown):PagePartRef {const v=object(value,['kind','index','sha256','byteLength','count']);if(!['EVENTS','ARTIFACTS'].includes(v.kind))fail('UI_PAGE_SOURCE_INVALID');uint(v.index,PAGE_LIMITS.sourceParts);hash(v.sha256);uint(v.byteLength,PAGE_LIMITS.sourcePartBytes);uint(v.count,PAGE_LIMITS.sourcePartItems);if(!v.byteLength||!v.count)fail('UI_PAGE_SOURCE_INVALID');return v as PagePartRef;}
export async function validatePageRoot(value:unknown,ref:{scope:Scope;captureId:string;sourceRevision:string;sourceHash:string;exporterVersion?:string}):Promise<PageSourceRoot> {
 const v=object(value,['contractVersion','exporterVersion','scope','captureId','sourceRevision','capture','ingestion','parts','reachableArtifactIds','counts']);
 if(v.contractVersion!==PAGE_SOURCE_VERSION||!isPageExporter(v.exporterVersion)||v.captureId!==ref.captureId||v.sourceRevision!==ref.sourceRevision||canonicalJson(v.scope)!==canonicalJson(ref.scope))fail('UI_BUNDLE_SOURCE_SCOPE_MISMATCH',409);
 validateScope(v.scope);id(v.captureId);hash(v.sourceRevision);if(await digestJson(v)!==ref.sourceHash)fail('UI_BUNDLE_SOURCE_HASH_MISMATCH',409);
 if(ref.exporterVersion!==undefined&&v.exporterVersion!==ref.exporterVersion)fail('UI_BUNDLE_SOURCE_VERSION_UNSUPPORTED',409);
 const c=object(v.capture,['descriptor','completion','status','createdAt','completedAt','origins']);validatePageStart(c.descriptor,true);validateCompleteAny(c.completion);
 if(v.exporterVersion!==pageExporterForCapture(c.descriptor))fail('UI_BUNDLE_SOURCE_VERSION_UNSUPPORTED',409);
 if(c.completion.contractVersion!==c.descriptor.contractVersion||c.status!==c.completion.outcome||!['RECORDED','PARTIAL','ABORTED'].includes(c.status))fail('UI_BUNDLE_SOURCE_NOT_RECONCILED',409);
 uint(c.createdAt);uint(c.completedAt);if(c.completedAt<c.createdAt||await digestJson(c.completion)!==ref.sourceRevision)fail('UI_BUNDLE_SOURCE_REVISION_MISMATCH',409);
 if(!Array.isArray(c.origins)||c.origins.length!==1||c.origins[0]!==new URL(c.descriptor.entryUrl).origin)fail('UI_BUNDLE_SOURCE_SCOPE_MISMATCH',409);
 const n=object(v.ingestion,['expectedEvents','lastSequence','eventChainHash']);uint(n.expectedEvents,PAGE_LIMITS.captureEvents);hash(n.eventChainHash);if(n.lastSequence!==n.expectedEvents-1)fail('UI_BUNDLE_SEQUENCE_GAP',409);
 const counts=object(v.counts,['events','artifacts','referencedArtifacts']);uint(counts.events,PAGE_LIMITS.captureEvents);uint(counts.artifacts,PAGE_LIMITS.artifactsPerCapture);uint(counts.referencedArtifacts,PAGE_LIMITS.artifactsPerCapture);ids(v.reachableArtifactIds,PAGE_LIMITS.artifactsPerCapture);
 if(!Array.isArray(v.parts)||v.parts.length>PAGE_LIMITS.sourceParts)fail('UI_PAGE_SOURCE_INVALID');
 let eventPhase=false;const idx={EVENTS:0,ARTIFACTS:0},total={EVENTS:0,ARTIFACTS:0};for(const x of v.parts){const p=validatePartRef(x);if(p.kind==='EVENTS')eventPhase=true;else if(eventPhase)fail('UI_PAGE_PART_SEQUENCE_INVALID');if(p.index!==idx[p.kind]++)fail('UI_PAGE_PART_SEQUENCE_INVALID');total[p.kind]+=p.count;}
 if(total.EVENTS!==counts.events||total.ARTIFACTS!==counts.artifacts||counts.events!==n.expectedEvents||v.reachableArtifactIds.length!==counts.referencedArtifacts||counts.referencedArtifacts>counts.artifacts)fail('UI_PAGE_SOURCE_COUNT_MISMATCH');
 return v as PageSourceRoot;
}
export async function validatePagePart(value:unknown,part:PagePartRef,root:PageSourceRoot):Promise<any[]> {
 const p=object(value,['contractVersion','scope','captureId','sourceRevision','kind','index','items']);
 if(p.contractVersion!==PAGE_PART_VERSION||p.captureId!==root.captureId||p.sourceRevision!==root.sourceRevision||canonicalJson(p.scope)!==canonicalJson(root.scope)||p.kind!==part.kind||p.index!==part.index||!Array.isArray(p.items)||p.items.length!==part.count)fail('UI_PAGE_PART_SCOPE_MISMATCH',409);
 if(await digestJson(p)!==part.sha256)fail('UI_PAGE_PART_HASH_MISMATCH',409);return p.items;
}
