/** PC.2 backend evidence receipt. No browser execution and no READY replay claim.
 * PC.4 will add page inspection/matching qualifications; this reader verifies typed bytes now. */
import { CANONICAL_VERSION,canonicalJson,digestJson,sha256,decodeJson,fail } from '../contracts/canonical';
import { object,id,type UiEvent } from '../contracts/uiCapture';
import { assertPageEventRefTypes,validateEventsAny,validatePageArtifact,pageEventRefs,validateResourceManifest,PAGE_CONTRACTS,PAGE_LIMITS,type PageArtifactInput } from '../contracts/uiPageCopy';
import { type PageSourceRoot } from '../contracts/pageSource';
import { identity,BUILDER_VERSION,type SourceRef,type AssemblyProfile } from '../protocol';
export async function assemblePageEvidence(root:PageSourceRoot,ref:SourceRef,profile:AssemblyProfile,
 readPart:(index:number)=>Promise<any[]>,readArtifact:(id:string)=>Promise<Uint8Array>):Promise<{envelope:Record<string,any>;artifactIds:string[]}> {
 const descriptors=new Map<string,{descriptor:PageArtifactInput;status:string}>(),roots=new Set<string>();
 let count=0,chain='0'.repeat(64),actions=0,interactions=0,checkpoints=0;const observed=new Set<number>(),requestOrder=new Set<number>(),eventIds=new Set<string>(),issues=new Set<string>();
 for(let index=0;index<root.parts.length;index++){
  const part=root.parts[index],items=await readPart(index);
  if(part.kind==='ARTIFACTS')for(const item of items){object(item,['artifactId','descriptor','status']);id(item.artifactId);if(descriptors.has(item.artifactId)||!['PENDING','FINALIZED'].includes(item.status))fail('UI_PAGE_SOURCE_INVALID');descriptors.set(item.artifactId,{descriptor:validatePageArtifact(item.descriptor),status:item.status});}
  else {
   const input=validateEventsAny({contractVersion:PAGE_CONTRACTS.events,operationId:'op_page_reader',events:items});
   for(const event of input.events){assertPageEventRefTypes(event,id=>descriptors.get(id)?.status==='FINALIZED'?descriptors.get(id)?.descriptor:undefined);const {contentHash,...content}=event;if(event.sequence!==count++||eventIds.has(event.eventId)||await digestJson(content)!==contentHash)fail('UI_BUNDLE_EVENT_INTEGRITY_FAILED',409);eventIds.add(event.eventId);chain=await digestJson([chain,event.sequence,contentHash]);pageEventRefs(event).forEach(x=>roots.add(x));const p:any=event.payload;
    if(event.kind!=='GAP'){if(observed.has(p.observedSequence))fail('UI_PAGE_OBSERVED_ORDER_CONFLICT',409);observed.add(p.observedSequence);}
    if(event.kind==='ACTION')actions++;
    if(event.kind==='INTERACTION'){interactions++;if(requestOrder.has(p.requestSequence))fail('UI_PAGE_REQUEST_ORDER_CONFLICT',409);requestOrder.add(p.requestSequence);if(!['COMPLETE','EMPTY'].includes(p.response.bodyState))issues.add('UI_PAGE_RESPONSE_'+p.response.bodyState);}
    if(event.kind==='CHECKPOINT'){checkpoints++;for(const missing of p.pageCapture.missing)issues.add(missing);}
    if(event.kind==='GAP')issues.add(p.code);
   }
  }
 }
 if(count!==root.counts.events||descriptors.size!==root.counts.artifacts||chain!==root.ingestion.eventChainHash)fail('UI_PAGE_SOURCE_COUNT_MISMATCH',409);
 const manifests=new Map<string,ReturnType<typeof validateResourceManifest>>(),artifactRefs:any[]=[];
 for(const artifactId of root.reachableArtifactIds){const item=descriptors.get(artifactId);if(!item||item.status!=='FINALIZED')fail('UI_PAGE_ARTIFACT_REF_UNAVAILABLE',409);const d=item.descriptor,bytes=await readArtifact(artifactId);
  if(bytes.length!==d.byteLength||await sha256(bytes)!==d.sha256)fail('UI_BUNDLE_ARTIFACT_HASH_MISMATCH',409);
  if(d.kind==='RESOURCE_MANIFEST_JSON')manifests.set(artifactId,validateResourceManifest(decodeJson(bytes)));
  if(d.completeness!=='COMPLETE')issues.add('UI_PAGE_ARTIFACT_TRUNCATED');
  artifactRefs.push({artifactId,kind:d.kind,sha256:d.sha256,byteLength:d.byteLength,contentType:d.contentType,representation:d.representation,storedEncoding:d.storedEncoding,completeness:d.completeness,privacyPolicyVersion:d.privacy.policyVersion,dataOrigin:d.privacy.dataOrigin});
 }
 // Independently recompute the transitive closure; do not trust a root's reachability claim alone.
 const verified=new Set<string>(),active=new Set<string>();
 function walk(id:string,depth:number):void {
  if(active.has(id))fail('UI_PAGE_REFERENCE_CYCLE',409);if(verified.has(id))return;if(depth>PAGE_LIMITS.graphDepth)fail('UI_PAGE_REFERENCE_LIMIT',413);
  const a=descriptors.get(id);if(!a||!root.reachableArtifactIds.includes(id)||a.status!=='FINALIZED')fail('UI_PAGE_ARTIFACT_REF_UNAVAILABLE',409);active.add(id);
  if(a.descriptor.kind==='RESOURCE_MANIFEST_JSON'){
   const m=manifests.get(id);if(!m)fail('UI_PAGE_MANIFEST_KIND_MISMATCH',409);
   for(const p of m.parts){if(descriptors.get(p)?.descriptor.kind!=='RESOURCE_MANIFEST_JSON')fail('UI_PAGE_MANIFEST_KIND_MISMATCH',409);walk(p,depth+1);}
   for(const doc of m.documents)if(doc.sourceHtmlRef!==null&&descriptors.get(doc.sourceHtmlRef)?.descriptor.kind!=='DOCUMENT_HTML')fail('UI_PAGE_MANIFEST_KIND_MISMATCH',409);
   for(const entry of m.artifacts){const d=descriptors.get(entry.artifactId)?.descriptor;if(!d||d.sha256!==entry.sha256||d.kind!==entry.kind)fail('UI_PAGE_MANIFEST_REF_MISMATCH',409);walk(entry.artifactId,depth+1);}
  }
  active.delete(id);verified.add(id);
 }
 for(const id of roots)walk(id,0);
 if(verified.size!==root.reachableArtifactIds.length)fail('UI_PAGE_SOURCE_UNREFERENCED_ARTIFACT',409);
 const ids=await identity(ref,profile);
 const content={contractVersion:'qagent.ui-page-evidence.v1',canonicalizerVersion:CANONICAL_VERSION,builderVersion:BUILDER_VERSION,...ids,source:ref,profile,
  manifestState:'SEALED',journey:null,bundle:{contractVersion:'qagent.ui-page-artifact-index.v1',artifacts:artifactRefs},
  pageSource:{contractVersion:root.contractVersion,counts:root.counts,parts:root.parts},
  qualification:{overall:'NEEDS_ATTENTION',dimensions:{integrity:{status:'READY',reasonCodes:[]}},
   reasonCodes:['UI_PAGE_REPLAY_NOT_IMPLEMENTED',...issues].sort(),counts:{actions,interactions,checkpoints,referencedArtifacts:verified.size,verifiedArtifacts:verified.size},
   eligibleModes:[],meaning:'PAGE_EVIDENCE_STORED_NOT_RENDERED_OR_EXECUTED',uiTestPassed:false,apiEvidencePromoted:false}};
 return {envelope:{...content,manifestHash:await digestJson(content)},artifactIds:[...verified].sort()};
}
