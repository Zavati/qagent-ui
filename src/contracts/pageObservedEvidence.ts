/** Cross-event PC.3 checks run after reconciliation, never inferred from arrival order. */
import { canonicalJson, fail } from './canonical';
import { environmentVariantHeaders } from './observedPrivacy';
import { pageCacheMatchKey } from './uiPageCopy';
import type { UiEvent, DataOrigin } from './uiCapture';
/** Called only for r2, after both HEADERS_JSON artifacts pass hash/format checks.
 * An absent optional field preserves historical evidence without inventing it. */
export function assertEnvironmentRequestHeaders(request:{businessHeadersRef:string|null;observedHeadersRef?:string|null},lookup:(id:string)=>readonly [string,string][]|undefined):void {
    if(!Object.hasOwn(request,'observedHeadersRef'))return;
    const observed=request.observedHeadersRef===null?[]:lookup(request.observedHeadersRef!);
    const business=request.businessHeadersRef===null?[]:lookup(request.businessHeadersRef);
    if(!observed||!business)fail('UI_ARTIFACT_REF_UNAVAILABLE',409);
    if(canonicalJson(environmentVariantHeaders(observed))!==canonicalJson(business))fail('UI_PAGE_REQUEST_HEADERS_MISMATCH',409);
}
export async function validateObservedPageEvidence(captureId:string,events:UiEvent[],dataOrigin:DataOrigin='OBSERVED_SANITIZED'):Promise<void> {
    const byId=new Map(events.map(e=>[e.eventId,e]));
    const states=new Map<string,any>(),stateSequence=new Set<number>(),observedSequence=new Set<number>(),requests=new Set<number>();
    for(const event of events){
        const p:any=event.payload;if(event.kind==='GAP')continue;
        if(observedSequence.has(p.observedSequence))fail('UI_PAGE_OBSERVED_ORDER_CONFLICT',409);observedSequence.add(p.observedSequence);
        if(event.kind==='INTERACTION'){
            if(requests.has(p.requestSequence))fail('UI_PAGE_REQUEST_ORDER_CONFLICT',409);requests.add(p.requestSequence);
            if(['XHR','FETCH'].includes(p.resourceType)&&p.classification!=='BUSINESS_API')fail('UI_PAGE_CLASSIFICATION_MISMATCH',409);
        }
        if(event.kind==='CHECKPOINT'){
            const state=p.pageCapture;
            if(!state.triggerKind)fail('UI_PAGE_TRIGGER_REQUIRED',422);
            if(states.has(state.stateId)||stateSequence.has(state.stateSequence))fail('UI_PAGE_STATE_CONFLICT',409);
            if(p.semanticRef!==state.domRef||p.functionalRef!==state.domRef||p.screenshotRef!==state.screenshotRef)fail('UI_PAGE_CHECKPOINT_MISMATCH',409);
            if(state.captureStartedUs<p.relativeTimeUs)fail('UI_PAGE_TIME_INVALID',409);
            states.set(state.stateId,p);stateSequence.add(state.stateSequence);
        }
        if(event.kind!=='INTERACTION'||p.response.bodySource!=='CACHE')continue;
        const proof=p.response.cacheEvidence;if(!proof||typeof proof.representationId!=='string')fail('UI_PAGE_CACHE_EVIDENCE_INVALID',409);
        const source=byId.get(proof.representationId),previous:any=source?.payload;
        if(!source||source.kind!=='INTERACTION'||source.eventId===event.eventId||previous.requestSequence>=p.requestSequence||previous.finishedOffsetUs===null||previous.finishedOffsetUs>p.startedOffsetUs||previous.redirectHop!==0||p.redirectHop!==0||previous.response.networkStatus!==200||previous.response.replayStatus!==200||previous.response.bodySource!=='NETWORK'||previous.response.bodyState!=='COMPLETE'||previous.response.completeness!=='COMPLETE'||previous.response.bodyRef!==p.response.bodyRef||previous.response.bodyHash!==p.response.bodyHash||previous.response.bodyHash!==proof.bodySha256||previous.issues.length)fail('UI_PAGE_CACHE_EVIDENCE_INVALID',409);
        const match=await pageCacheMatchKey(captureId,p,dataOrigin);
        if(proof.matchKeySha256!==match||await pageCacheMatchKey(captureId,previous,dataOrigin)!==match)fail('UI_PAGE_CACHE_EVIDENCE_INVALID',409);
    }
    for(const event of events){if(event.kind!=='ACTION')continue;const p:any=event.payload;
        for(const key of ['stateBeforeId','stateAfterId'])if(p[key]!==null){const state=states.get(p[key]);
            if(!state||state.documentId!==p.documentId||state.frameId!==p.frameId)fail('UI_PAGE_STATE_REF_INVALID',409);
            if(key==='stateBeforeId'?state.pageCapture.captureFinishedUs>p.relativeTimeUs:state.pageCapture.captureStartedUs<p.relativeTimeUs)fail('UI_PAGE_STATE_ORDER_INVALID',409);
        }
    }
}
