import { canonicalJson,digestJson,sha256,decodeJson,verifyManifestHash,UiError,fail } from '../contracts/canonical';
import { eventArtifactRefs,type Scope } from '../contracts/uiCapture';
import { MAIN_QUEUE,DLQ,MAX_MANIFEST_BYTES,identity,validateMessage,makeMessage,errorCode,log,type BuildMessage,type AssemblyProfile } from '../protocol';
import type { UiBundleEnv } from '../env';
import { Repository,type VersionRow } from '../storage/repository';
import { SourceClient } from './sourceClient';
import { assemble } from './assembler';

const buildStages = new WeakMap<object,string>();
function markStage(error:unknown,stage:string):unknown {
    if(error && (typeof error==='object' || typeof error==='function')) buildStages.set(error as object,stage);
    return error;
}
function stageOf(error:unknown):string {
    return error && (typeof error==='object' || typeof error==='function') ? (buildStages.get(error as object) ?? 'unknown') : 'unknown';
}
async function atStage<T>(stage:string,fn:()=>Promise<T>):Promise<T> {
    try { return await fn(); } catch(error) { throw markStage(error,stage); }
}

export async function readEnvelope(env:UiBundleEnv,v:VersionRow,checkSource=true):Promise<Record<string,any>> {
    const obj=await env.UI_BUNDLES.get(v.object_key);
    if(!obj || obj.size!==v.byte_length || obj.size>MAX_MANIFEST_BYTES)fail('UI_BUNDLE_MANIFEST_UNAVAILABLE',409);
    const bytes=new Uint8Array(await obj.arrayBuffer());
    if(await sha256(bytes)!==v.object_sha256)fail('UI_BUNDLE_MANIFEST_INTEGRITY_FAILED',409);
    const envelope=decodeJson(bytes) as Record<string,any>;await verifyManifestHash(envelope);
    if(envelope.manifestHash!==v.manifest_hash || envelope.bundleVersionId!==v.bundle_version_id)fail('UI_BUNDLE_MANIFEST_INTEGRITY_FAILED',409);
    if(checkSource)await new SourceClient(env).checkAccess(envelope.source);
    return envelope;
}
async function writeManifest(env:UiBundleEnv,envelope:Record<string,any>):Promise<{key:string;hash:string;bytes:number}> {
    const bytes=new TextEncoder().encode(canonicalJson(envelope));if(bytes.length>MAX_MANIFEST_BYTES)fail('UI_BUNDLE_MANIFEST_TOO_LARGE',413);
    const hash=await sha256(bytes),scopeHash=await digestJson(envelope.source.scope);
    const key=`ui-bundles/v1/${scopeHash}/${envelope.bundleVersionId}/${hash}.json`;
    await env.UI_BUNDLES.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},sha256:hash,httpMetadata:{contentType:'application/json'},customMetadata:{sha256:hash,contract:envelope.contractVersion}});
    const after=await env.UI_BUNDLES.get(key);
    if(!after || after.size!==bytes.length || await sha256(new Uint8Array(await after.arrayBuffer()))!==hash)fail('UI_BUNDLE_MANIFEST_INTEGRITY_FAILED',409);
    return {key,hash,bytes:bytes.length};
}
export async function processBuild(env:UiBundleEnv,m:BuildMessage):Promise<void> {
    if(env.UI_BUNDLE_BUILD_ENABLED==='false')fail('UI_BUNDLE_BUILD_DISABLED',503);
    const repo=new Repository(env.UI_DB),source=new SourceClient(env),job=await atStage('db.admit',()=>repo.admit(m));
    if(job.status==='COMPLETE') {
        const v=await atStage('db.version',()=>repo.version(m.source.scope,job.bundle_version_id!,true));
        if(v.access_state==='ACTIVE') { try { await atStage('manifest.read',()=>readEnvelope(env,v)); } catch(e) { if(!(e instanceof UiError && e.code==='UI_BUNDLE_SOURCE_REVOKED'))throw e; } }
        try {await atStage('source.ack',()=>source.ack(m,v.bundle_version_id,'COMPLETED'));} catch(e) {if(!(e instanceof UiError && e.code==='UI_BUNDLE_SOURCE_REVOKED'))throw e;}
        log('build.duplicate',{buildId:m.buildId,captureId:m.source.captureId,bundleVersionId:v.bundle_version_id});return;
    }
    if(job.status==='FAILED')fail('UI_BUNDLE_BUILD_FAILED',409);
    const token=await atStage('db.lease',()=>repo.lease(m.buildId));if(!token)fail('UI_BUNDLE_BUILD_BUSY',503);
    try {
        const snapshot=await atStage('source.snapshot',()=>source.load(m.source)),ids=await atStage('build.identity',()=>identity(m.source,m.profile));
        const available=new Set(snapshot.artifacts.filter(a=>a.status==='FINALIZED').map(a=>a.artifactId));
        const pinIds=[...new Set(snapshot.events.flatMap(eventArtifactRefs))].filter(id=>available.has(id)).sort();
        await atStage('source.pin',()=>source.pin(m.source,ids.bundleVersionId,pinIds));
        let lastHeartbeat=Date.now();
        const built=await assemble(snapshot,m.source,m.profile,async artifactId=>{
            if(Date.now()-lastHeartbeat>15000){await atStage('db.heartbeat',()=>repo.heartbeat(m.buildId,token));lastHeartbeat=Date.now();}
            return atStage('source.artifact',()=>source.artifact(m.source,artifactId));
        });
        await atStage('db.heartbeat',()=>repo.heartbeat(m.buildId,token));
        const object=await atStage('manifest.persist',()=>writeManifest(env,built.envelope));
        const version=await atStage('db.commit',()=>repo.commit(m,token,built.envelope,object.key,object.hash,object.bytes));
        await atStage('source.ack',()=>source.ack(m,version.bundle_version_id,'COMPLETED'));
        log('bundle.persisted',{captureId:m.source.captureId,buildId:m.buildId,bundleVersionId:version.bundle_version_id,
            manifestState:version.manifest_state,qualification:version.qualification_state,manifestHash:version.manifest_hash});
    } catch(error) {
        log('build.stage_failed',{buildId:m.buildId,captureId:m.source.captureId,stage:stageOf(error),code:errorCode(error)});
        await repo.release(m.buildId,token,errorCode(error));throw error;
    }
}
export async function consumeBuilds(batch:MessageBatch<unknown>,env:UiBundleEnv):Promise<void> {
    const main=env.UI_BUNDLE_QUEUE_NAME??MAIN_QUEUE,dlq=env.UI_BUNDLE_DLQ_NAME??DLQ;
    if(batch.queue!==main && batch.queue!==dlq)throw new Error('UI_BUNDLE_UNEXPECTED_QUEUE');
    const repo=new Repository(env.UI_DB);
    for(const message of batch.messages) {
        let parsed:BuildMessage|null=null;
        try {
            parsed=await validateMessage(message.body,env.UI_BUNDLE_SOURCE_SECRET);
            if(batch.queue===dlq) {
                const job=await repo.getBuild(parsed.buildId);
                if(job?.status==='COMPLETE') {
                    const v=await repo.version(parsed.source.scope,job.bundle_version_id!,true);if(v.access_state==='ACTIVE') { try { await readEnvelope(env,v); } catch(e) { if(!(e instanceof UiError && e.code==='UI_BUNDLE_SOURCE_REVOKED'))throw e; } }
                    try {await new SourceClient(env).ack(parsed,v.bundle_version_id,'COMPLETED');} catch(e) {if(!(e instanceof UiError && e.code==='UI_BUNDLE_SOURCE_REVOKED'))throw e;}
                } else {
                    if(job?.status==='BUILDING' && job.lease_until>Date.now())fail('UI_BUNDLE_BUILD_BUSY',503);
                    // Persist quarantine first. Do not acknowledge a failed receipt before its disposition is durable.
                    await repo.quarantine(message.id,parsed.buildId,job?.last_error??'UI_BUNDLE_RETRIES_EXHAUSTED',await digestJson(parsed));
                    await new SourceClient(env).ack(parsed,null,'REJECTED');
                }
                log('build.dead_letter',{buildId:parsed.buildId,captureId:parsed.source.captureId});
            } else await processBuild(env,parsed);
            message.ack();
        } catch(error) {
            if(batch.queue===dlq && !parsed && error instanceof UiError && error.status<500) {
                // Only safe hashes and code are retained; never persist a malformed arbitrary payload.
                try {await repo.quarantine(message.id,null,error.code,await digestJson({messageId:message.id}));message.ack();continue;}catch{}
            }
            log('build.retry',{buildId:parsed?.buildId??null,code:errorCode(error),stage:stageOf(error),attempt:message.attempts});
            message.retry({delaySeconds:Math.min(300,5*2**Math.min(message.attempts,6))});
        }
    }
}
/** Explicit operator requests allow a reviewed bootstrap reference and a new immutable assembly revision. */
export async function requestBuild(env:UiBundleEnv,scope:Scope,captureId:string,profile:AssemblyProfile):Promise<Record<string,unknown>> {
    if(env.UI_BUNDLE_BUILD_ENABLED==='false')fail('UI_BUNDLE_BUILD_DISABLED',409);
    const source=await new SourceClient(env).resolve(scope,captureId);
    const message=await makeMessage(source,profile,env.UI_BUNDLE_SOURCE_SECRET),repo=new Repository(env.UI_DB),job=await repo.admit(message);
    if(job.status==='COMPLETE')return {status:'ok',buildId:message.buildId,bundleVersionId:job.bundle_version_id,state:'COMPLETE'};
    if(job.status==='FAILED')fail('UI_BUNDLE_NEW_ASSEMBLY_REVISION_REQUIRED',409);
    await env.UI_BUNDLE_BUILD_QUEUE.send(message);
    await env.UI_DB.prepare("UPDATE ui_bundle_builds SET next_dispatch_at=? WHERE build_id=? AND status IN ('PENDING','BUILDING')").bind(Date.now()+900000,message.buildId).run();
    return {status:'accepted',buildId:message.buildId,state:job.status,durability:'QUEUE_PUBLISHED'};
}
export async function recoverBuilds(env:UiBundleEnv):Promise<void> {
    if(env.UI_BUNDLE_BUILD_ENABLED==='false')return;
    const now=Date.now(),rows=await env.UI_DB.prepare("SELECT * FROM ui_bundle_builds WHERE status IN ('PENDING','BUILDING') AND lease_until<=? AND next_dispatch_at<=? ORDER BY next_dispatch_at LIMIT 10").bind(now,now).all<{build_id:string;message_json:string}>();
    for(const row of rows.results??[]) {
        const claimed=await env.UI_DB.prepare("UPDATE ui_bundle_builds SET next_dispatch_at=? WHERE build_id=? AND next_dispatch_at<=? AND status IN ('PENDING','BUILDING') AND lease_until<=?").bind(now+60000,row.build_id,now,now).run();
        if(!claimed.meta.changes)continue;
        try {
            const message=await validateMessage(JSON.parse(row.message_json),env.UI_BUNDLE_SOURCE_SECRET);
            await env.UI_BUNDLE_BUILD_QUEUE.send(message);
            await env.UI_DB.prepare("UPDATE ui_bundle_builds SET next_dispatch_at=? WHERE build_id=? AND status IN ('PENDING','BUILDING')").bind(Date.now()+900000,row.build_id).run();
            log('build.republished',{buildId:row.build_id});
        }catch(e){log('build.republish_failed',{buildId:row.build_id,code:errorCode(e)});}
    }
}
