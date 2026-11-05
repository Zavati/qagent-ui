import { CANONICAL_VERSION,canonicalJson,digestJson,sha256,decodeJson,UiError } from '../contracts/canonical';
import { CONTRACTS,eventArtifactRefs,validateManifest,type Action,type Checkpoint,type Interaction,type ArtifactRef } from '../contracts/uiCapture';
import { ASSEMBLY_VERSION,BUILDER_VERSION,MATCH_VERSION,identity,validateSnapshot,validateProfile,type SourceRef,type SourceSnapshot,type AssemblyProfile } from '../protocol';

type Dimension='integrity'|'actions'|'network'|'bootstrap'|'provenance'|'semantic'|'visual';
export interface QualificationIssue {code:string;dimensions:Dimension[];severity:'BLOCKER'|'WARNING'|'INFO';refs:string[];}
interface DimensionResult {status:'READY'|'PARTIAL'|'UNAVAILABLE';reasonCodes:string[];}
export interface AssemblyResult {envelope:Record<string,any>;artifactIds:string[];}
const INFO_CODES=new Set(['UI_BUILD_SCRIPT_OBSERVED','UI_BUILD_STYLESHEET_OBSERVED','UI_BUILD_FONT_OBSERVED','UI_REPEATED_REQUEST_OBSERVED']);
const MISSING_CODES=new Set(['UI_ARTIFACT_UNAVAILABLE','UI_ARTIFACT_INTEGRITY_FAILED','UI_BUNDLE_ARTIFACT_MISSING']);
/** Deterministic materialization, not test generation. Never executes captured requests or repairs absent evidence. */
export async function assemble(source:SourceSnapshot,ref:SourceRef,profile:AssemblyProfile,
    readArtifact:(id:string)=>Promise<Uint8Array>):Promise<AssemblyResult> {
    await validateSnapshot(source,ref);validateProfile(profile);
    const ids=await identity(ref,profile),issues:QualificationIssue[]=[];
    const add=(code:string,dimensions:Dimension[],refs:string[]=[],severity:QualificationIssue['severity']='BLOCKER')=>{
        const previous=issues.find(i=>i.code===code&&canonicalJson(i.dimensions)===canonicalJson(dimensions)&&i.severity===severity);
        if(previous)previous.refs=[...new Set([...previous.refs,...refs])].sort();
        else issues.push({code,dimensions,severity,refs:[...new Set(refs)].sort()});
    };
    const actions=source.events.filter(e=>e.kind==='ACTION').map(e=>e.payload as Action);
    const interactions=source.events.filter(e=>e.kind==='INTERACTION').map(e=>e.payload as Interaction);
    const checkpoints=source.events.filter(e=>e.kind==='CHECKPOINT').map(e=>e.payload as Checkpoint);
    const refIds=[...new Set(source.events.flatMap(eventArtifactRefs))].sort();
    const descriptorMap=new Map(source.artifacts.map(a=>[a.artifactId,a]));
    const verified=new Set<string>(),artifactRefs:ArtifactRef[]=[],renderProfiles:Record<string,unknown>[]=[];
    const artifactResults:Record<string,unknown>[]=[];
    // Bounded sequential verification: at most one body (<=1 MiB) retained at a time, not the entire capture in memory.
    for(const artifactId of refIds) {
        const item=descriptorMap.get(artifactId);
        if(!item || item.status!=='FINALIZED') {add('UI_BUNDLE_ARTIFACT_NOT_FINALIZED',['integrity'],[artifactId]);artifactResults.push({artifactId,status:'MISSING'});continue;}
        let bytes:Uint8Array;
        try {bytes=await readArtifact(artifactId);}
        catch(e) {
            if(e instanceof UiError && MISSING_CODES.has(e.code)) {add(e.code,['integrity'],[artifactId]);artifactResults.push({artifactId,status:'UNAVAILABLE',code:e.code});continue;}
            throw e; // Network/auth/DB failure is retryable infrastructure, never converted into a valid partial bundle.
        }
        const d=item.descriptor;
        if(bytes.length!==d.byteLength || await sha256(bytes)!==d.sha256) {
            add('UI_BUNDLE_ARTIFACT_HASH_MISMATCH',['integrity'],[artifactId]);artifactResults.push({artifactId,status:'HASH_MISMATCH'});continue;
        }
        verified.add(artifactId);artifactResults.push({artifactId,status:'VERIFIED',sha256:d.sha256,byteLength:d.byteLength,kind:d.kind});
        artifactRefs.push({artifactId,sha256:d.sha256,byteLength:d.byteLength,contentType:d.contentType,privacyPolicyVersion:d.privacy.policyVersion,completeness:'COMPLETE',dataOrigin:d.privacy.dataOrigin});
        if(d.kind==='SEMANTIC_JSON') {
            try {
                const snapshot=decodeJson(bytes) as any;
                if(!snapshot || !snapshot.viewport || !snapshot.renderProfile || !Array.isArray(snapshot.elements))add('UI_RENDER_PROFILE_UNAVAILABLE',['semantic','visual'],[artifactId]);
                else renderProfiles.push({artifactId,viewport:snapshot.viewport,renderProfile:snapshot.renderProfile,textPolicy:snapshot.textPolicy??null});
            }catch {add('UI_SEMANTIC_SNAPSHOT_INVALID',['semantic','visual'],[artifactId]);}
        }
    }
    const expectKind=(artifactId:string|null|undefined,kind:string,refId:string,dimension:Dimension)=>{
        if(!artifactId || !verified.has(artifactId))add('UI_BUNDLE_REQUIRED_ARTIFACT_UNAVAILABLE',[dimension],[refId]);
        else if(descriptorMap.get(artifactId)?.descriptor.kind!==kind)add('UI_BUNDLE_ARTIFACT_KIND_MISMATCH',['integrity',dimension],[refId,artifactId]);
    };
    if(!actions.length)add('UI_NO_ACTIONS',['actions']);
    for(const action of actions) {
        if(['CLICK','FILL','SELECT','CHECK'].includes(action.type) && (!action.target || action.target.observedMatchCount!==1))add('UI_LOCATOR_NOT_UNIQUE',['actions'],[action.actionId]);
        if(action.target?.framePath.length)add('UI_FRAME_PATH_UNSUPPORTED',['actions'],[action.actionId]);
        if(['FILL','SELECT'].includes(action.type))expectKind(action.input?.valueRef,'ACTION_VALUE_JSON',action.actionId,'actions');
    }
    if(!interactions.length)add('UI_NO_NETWORK_FIXTURES',['network']);
    const matchingEntries:Record<string,unknown>[]=[];
    const groups=new Map<string,{responseKey:string;entryId:string}[]>();
    for(const x of interactions) {
        if(x.response.completeness!=='COMPLETE' || (x.response.status===304 && !x.response.bodyRef))add(x.response.status===304?'UI_CACHE_BODY_UNAVAILABLE':'UI_RESPONSE_INCOMPLETE',['network'],[x.entryId]);
        if(x.response.status!==null && ![204,205].includes(x.response.status) && x.request.method!=='HEAD')expectKind(x.response.bodyRef,'RESPONSE_JSON',x.entryId,'network');
        if(x.request.bodyRef)expectKind(x.request.bodyRef,'REQUEST_JSON',x.entryId,'network');
        if(x.request.businessHeadersRef)expectKind(x.request.businessHeadersRef,'HEADERS_JSON',x.entryId,'network');
        if(x.response.headersRef)expectKind(x.response.headersRef,'HEADERS_JSON',x.entryId,'network');
        const expectedHash=x.response.bodyRef?descriptorMap.get(x.response.bodyRef)?.descriptor.sha256:null;
        if(x.response.bodyRef && expectedHash!==x.response.bodyHash)add('UI_RESPONSE_HASH_MISMATCH',['integrity','network'],[x.entryId]);
        const fingerprint=await digestJson({service:x.logicalServiceKey,origin:x.request.origin,method:x.request.method,path:x.request.path,
            query:x.request.query,bodyHash:x.request.bodyRef?descriptorMap.get(x.request.bodyRef)?.descriptor.sha256??null:null,
            businessHeadersHash:x.request.businessHeadersRef?descriptorMap.get(x.request.businessHeadersRef)?.descriptor.sha256??null:null});
        const context=canonicalJson({documentId:x.documentId,navigationId:x.navigationId,stepId:x.stepId,fingerprint});
        const responseKey=canonicalJson({status:x.response.status,bodyHash:x.response.bodyHash,headersHash:x.response.headersRef?descriptorMap.get(x.response.headersRef)?.descriptor.sha256??null:null});
        const group=groups.get(context)??[];group.push({responseKey,entryId:x.entryId});groups.set(context,group);
        matchingEntries.push({entryId:x.entryId,requestFingerprint:fingerprint,documentId:x.documentId,navigationId:x.navigationId,stepId:x.stepId,consumption:x.consumption,correlationBasis:x.correlationBasis});
    }
    for(const group of groups.values())if(new Set(group.map(g=>g.responseKey)).size>1)add('UI_MATCH_AMBIGUOUS',['network'],group.map(g=>g.entryId));
    if(profile.bootstrap.mode==='UNAVAILABLE')add('UI_BOOTSTRAP_UNAVAILABLE',['bootstrap']);
    if(!source.capture.descriptor.sourceBuildRef)add('SOURCE_BUILD_UNKNOWN',['provenance']);
    if(!checkpoints.length)add('UI_NO_CHECKPOINT',['semantic','visual']);
    for(const cp of checkpoints) {
        if(cp.modalities.semantic==='AVAILABLE')expectKind(cp.semanticRef,'SEMANTIC_JSON',cp.checkpointId,'semantic');else add('UI_SEMANTIC_CHECKPOINT_UNAVAILABLE',['semantic'],[cp.checkpointId]);
        if(cp.modalities.functional==='AVAILABLE')expectKind(cp.functionalRef,'SEMANTIC_JSON',cp.checkpointId,'semantic');
        if(cp.modalities.visual==='AVAILABLE')expectKind(cp.screenshotRef,'SCREENSHOT_PNG',cp.checkpointId,'visual');else add('UI_VISUAL_CHECKPOINT_UNAVAILABLE',['visual'],[cp.checkpointId]);
    }
    const documentIds=[...new Set(actions.map(a=>a.documentId))].sort();
    const checkpointDocuments=new Set(checkpoints.map(c=>c.documentId));
    for(const doc of documentIds)if(!checkpointDocuments.has(doc))add('UI_DOCUMENT_WITHOUT_CHECKPOINT',['semantic','visual'],[doc]);
    const observedIssues=[...new Set([...source.capture.descriptor.issues,...source.capture.completion.issues,
        ...source.events.filter(e=>e.kind==='GAP').map(e=>(e.payload as {code:string}).code),...interactions.flatMap(i=>i.issues),...checkpoints.flatMap(c=>c.issues)])].sort();
    for(const code of observedIssues) {
        if(INFO_CODES.has(code)) {add(code,[],[],'INFO');continue;}
        if(code==='UI_DATA_ASSET_NOT_CAPTURED')add(code,['visual']);
        else if(code==='SOURCE_BUILD_UNKNOWN')add(code,['provenance']);
        else if(code==='INITIAL_DOCUMENT_ALREADY_LOADED')add(code,['bootstrap']);
        else if(code==='UI_CACHE_BODY_UNAVAILABLE')add(code,['network']);
        else if(code==='UI_AUTOCHECKPOINT_UNAVAILABLE' || code.startsWith('UI_VISUAL_'))add(code,['semantic','visual']);
        else if(code.startsWith('UI_PRIVATE_') || code==='UI_VALUE_NOT_AUTHORIZED')add(code,['actions']);
        else add(code,['actions','network','semantic']); // Unknown capture gaps must not silently become READY.
    }
    if(observedIssues.length>64)add('UI_BUNDLE_ISSUE_COUNT_LIMIT',['integrity']);
    if(source.capture.status==='ABORTED')add('UI_CAPTURE_ABORTED',['actions','network','semantic']);
    if(actions.length>500 || interactions.length>1000 || checkpoints.length>128)add('UI_BUNDLE_CONTRACT_COUNT_LIMIT',['integrity']);
    if(source.capture.descriptor.dataOrigin==='OBSERVED_SANITIZED' && !(source.capture.descriptor.capturePolicy?.publicTextSelectors.length))add('UI_SEMANTIC_TEXT_NOT_AUTHORIZED',['semantic']);
    const dimensionNames:Dimension[]=['integrity','actions','network','bootstrap','provenance','semantic','visual'];
    const available:Record<Dimension,boolean>={integrity:verified.size===refIds.length,actions:actions.length>0,network:interactions.length>0,bootstrap:profile.bootstrap.mode!=='UNAVAILABLE',provenance:!!source.capture.descriptor.sourceBuildRef,semantic:checkpoints.some(c=>!!c.semanticRef&&verified.has(c.semanticRef)),visual:checkpoints.some(c=>!!c.screenshotRef&&verified.has(c.screenshotRef))};
    const dimensions:Record<string,DimensionResult>={};
    for(const dimension of dimensionNames) {
        const codes=[...new Set(issues.filter(i=>i.dimensions.includes(dimension)&&i.severity==='BLOCKER').map(i=>i.code))].sort();
        dimensions[dimension]={status:!available[dimension]?'UNAVAILABLE':codes.length?'PARTIAL':'READY',reasonCodes:codes};
    }
    const required:Dimension[]=['integrity','actions','network','bootstrap','provenance','semantic'];
    const ready=required.every(d=>dimensions[d].status==='READY');
    let journey:Record<string,unknown>|null=null,bundle:Record<string,unknown>|null=null;
    const integrityReady=dimensions.integrity.status==='READY';
    if(integrityReady) {
        const journeyContent={contractVersion:CONTRACTS.journey,canonicalizerVersion:CANONICAL_VERSION,journeyId:ids.journeyId,journeyVersionId:ids.journeyVersionId,
            scope:ref.scope,captureId:ref.captureId,dataOrigin:source.capture.descriptor.dataOrigin,title:'Jornada '+ref.captureId,
            objective:'Reproduzir as ações observadas no escopo declarado; nenhuma execução foi realizada nesta montagem.',entryUrl:source.capture.descriptor.entryUrl,
            sourceBuildRef:source.capture.descriptor.sourceBuildRef,renderProfileRef:renderProfiles.length?String(renderProfiles[0].artifactId):null,
            actions,checkpoints,issues:observedIssues,manifestHash:''};
        const {manifestHash:_,...jc}=journeyContent;journey={...jc,manifestHash:await digestJson(jc)};
        const bundleContent={contractVersion:CONTRACTS.bundle,canonicalizerVersion:CANONICAL_VERSION,bundleId:ids.bundleId,bundleVersionId:ids.bundleVersionId,journeyVersionId:ids.journeyVersionId,
            scope:ref.scope,captureId:ref.captureId,dataOrigin:source.capture.descriptor.dataOrigin,sourceBuildRef:source.capture.descriptor.sourceBuildRef,
            captureCompleteness:ready?'COMPLETE_FOR_DECLARED_SCOPE':'PARTIAL',declaredScope:{profile:'CSR_REST_JSON_SINGLE_TAB',businessOrigins:source.capture.origins,limitations:observedIssues},
            bootstrap:profile.bootstrap,matchPolicyVersion:MATCH_VERSION,interactions,checkpointRefs:checkpoints.map(c=>c.checkpointId),artifacts:artifactRefs,issues:observedIssues};
        bundle={...bundleContent,manifestHash:await digestJson(bundleContent)};
        await validateManifest(journey);await validateManifest(bundle);
    }
    issues.sort((a,b)=>a.code.localeCompare(b.code)||canonicalJson(a.dimensions).localeCompare(canonicalJson(b.dimensions)));
    const content={contractVersion:ASSEMBLY_VERSION,canonicalizerVersion:CANONICAL_VERSION,builderVersion:BUILDER_VERSION,...ids,source:ref,profile,
        manifestState:integrityReady?'SEALED':'DIAGNOSTIC',journey,bundle,
        diagnostic:integrityReady?null:{actions,interactions,checkpoints,artifactResults},
        matching:{version:MATCH_VERSION,queryPairs:'PRESERVE_ORDER_AND_DUPLICATES',requestBody:'EXACT_STORED_BYTES_SHA256',businessHeaders:'EXACT_STORED_BYTES_SHA256',
            context:'DOCUMENT_NAVIGATION_STEP',globalArrivalOrder:'NOT_A_MATCH_RULE',liveBusinessFallback:false,entries:matchingEntries},
        applicationResources:{strategy:'EXECUTE_TARGET_BUILD',observedCssJsAreFixtures:false},renderProfiles,
        qualification:{overall:ready?'READY':'NEEDS_ATTENTION',requiredDimensions:required,dimensions,issues,
            eligibleModes:ready?['FUNCTIONAL','SEMANTIC',...(dimensions.visual.status==='READY'?['VISUAL']:[])]:[],
            coverage:{documentOccurrences:documentIds.length,documentOccurrencesWithCheckpoint:documentIds.filter(d=>checkpointDocuments.has(d)).length},
            counts:{actions:actions.length,interactions:interactions.length,checkpoints:checkpoints.length,referencedArtifacts:refIds.length,verifiedArtifacts:verified.size},
            meaning:'QUALIFIED_FOR_REPLAY_ATTEMPT_NOT_EXECUTED',uiTestPassed:false,apiEvidencePromoted:false}};
    return {envelope:{...content,manifestHash:await digestJson(content)},artifactIds:[...verified].sort()};
}
