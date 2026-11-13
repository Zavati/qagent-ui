import { id,object,validateScope } from './contracts/uiCapture';
import { sha256,fail,UiError } from './contracts/canonical';
import { UI_PREFIX,SOURCE_VERSION,BUILD_REQUEST_VERSION,ASSEMBLY_VERSION,BUILDER_VERSION,OBSERVED_BUILDER_VERSION,EXPORTER_VERSION,DEFAULT_PROFILE,
    authenticate,validateProfile,json,safeFailure,errorCode,log } from './protocol';
import type { UiBundleEnv } from './env';
import { Repository } from './storage/repository';
import { consumeBuilds,recoverBuilds,requestBuild,readEnvelope } from './services/buildService';
import { SourceClient } from './services/sourceClient';
import { PAGE_EXPORTER_VERSION,PAGE_OBSERVED_EXPORTER_VERSION } from './contracts/pageSource';

// Public operator mount; internal Service Binding routes remain unchanged.
// Authenticate the ORIGINAL request URL so the signature binds the actual wire path.
const PUBLIC_PREFIX = '/v1/qagent-ui/';

export async function route(request:Request,env:UiBundleEnv):Promise<Response> {
    const path=new URL(request.url).pathname;
    if((path==='/health' || path===PUBLIC_PREFIX+'health') && request.method==='GET')return json({status:'ok',service:'qagent-ui',version:'0.1.6',stage:'08.2-PC.3'});
    const isPublic=path.startsWith(PUBLIC_PREFIX);
    if(!isPublic && !path.startsWith(UI_PREFIX))return json({status:'error',code:'UI_BUNDLE_ROUTE_NOT_FOUND'},404);
    const op=path.slice((isPublic?PUBLIC_PREFIX:UI_PREFIX).length),repo=new Repository(env.UI_DB);
    if(op==='capabilities' && !isPublic) {
        await authenticate(request,env.UI_BUNDLE_SOURCE_SECRET,'source');await repo.ready();await env.UI_BUNDLES.head('_qagent_ui_bundle/readiness');
        return json({status:'ok',sourceVersion:SOURCE_VERSION,buildRequestVersion:BUILD_REQUEST_VERSION,assemblyVersion:ASSEMBLY_VERSION,builderVersion:BUILDER_VERSION,
            supportedSourceExporters:[EXPORTER_VERSION,PAGE_EXPORTER_VERSION,PAGE_OBSERVED_EXPORTER_VERSION],
            supportedBuilderVersions:[BUILDER_VERSION,OBSERVED_BUILDER_VERSION],observedEvidenceVersion:'qagent.ui-page-evidence.v2',
            ready:env.UI_BUNDLE_BUILD_ENABLED!=='false'&&!!env.OBSERVATION_SERVICE&&!!env.UI_BUNDLE_BUILD_QUEUE,executionSupported:false});
    }
    if(!['build','list','read','artifact','inspect','revoke','build-status'].includes(op))return json({status:'error',code:'UI_BUNDLE_ROUTE_NOT_FOUND'},404);
    const input=await authenticate(request,env.UI_BUNDLE_OPERATOR_SECRET,'operator');
    if(op==='build') {
        const v=object(input,['scope','captureId'],['profile']);const scope=validateScope(v.scope);id(v.captureId);
        const result=await requestBuild(env,scope,v.captureId,validateProfile(v.profile??DEFAULT_PROFILE));return json(result,result.status==='accepted'?202:200);
    }
    if(op==='build-status') {
        const v=object(input,['scope','buildId']);const scope=validateScope(v.scope);id(v.buildId);
        const r=await repo.getBuild(v.buildId);
        if(!r||r.organization_id!==scope.organizationId||r.project_id!==scope.projectId||r.environment_id!==scope.environmentId)fail('UI_BUNDLE_NOT_FOUND',404);
        return json({buildId:r.build_id,status:r.status,bundleVersionId:r.bundle_version_id,attempts:r.attempts,reasonCode:r.last_error});
    }
    if(op==='list') {
        const v=object(input,['scope'],['captureId','cursor','limit']);const scope=validateScope(v.scope);if(v.captureId)id(v.captureId);if(v.cursor)id(v.cursor);
        const limit=v.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail('UI_BUNDLE_LIMIT_INVALID');
        return json(await repo.list(scope,v.captureId??null,v.cursor??'',limit));
    }
    const v=object(input,['scope','bundleVersionId'],op==='artifact'?['artifactId']:[]);
    const scope=validateScope(v.scope);id(v.bundleVersionId);
    if(op==='revoke') {await repo.revoke(scope,v.bundleVersionId);return json({status:'ok',bundleVersionId:v.bundleVersionId,access:'REVOKED',artifactsDeleted:false});}
    const version=await repo.version(scope,v.bundleVersionId),envelope=await readEnvelope(env,version);
    if(op==='read')return json(envelope);
    const source=new SourceClient(env);
    if(op==='artifact') {
        id(v.artifactId);
        const refs=envelope.bundle?.artifacts??[];const ref=refs.find((r:any)=>r.artifactId===v.artifactId);
        if(!ref)fail('UI_BUNDLE_ARTIFACT_NOT_REFERENCED',403);
        const bytes=await source.artifact(envelope.source,v.artifactId);
        if(bytes.length!==ref.byteLength || await sha256(bytes)!==ref.sha256)fail('UI_BUNDLE_ARTIFACT_HASH_MISMATCH',409);
        return new Response(bytes.slice().buffer,{headers:{'Content-Type':ref.contentType,'Content-Disposition':`attachment; filename="${v.artifactId}.${ref.contentType==='image/png'?'png':ref.contentType==='application/json'?'json':'bin'}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
    }
    const checks=[];
    for(const ref of envelope.bundle?.artifacts??[]) {
        try {const bytes=await source.artifact(envelope.source,ref.artifactId);checks.push({artifactId:ref.artifactId,status:bytes.length===ref.byteLength&&await sha256(bytes)===ref.sha256?'VERIFIED':'HASH_MISMATCH'});}
        catch(error) {if(error instanceof UiError&&error.status<500)checks.push({artifactId:ref.artifactId,status:'UNAVAILABLE',code:error.code});else throw error;}
    }
    const valid=envelope.manifestState==='SEALED'&&checks.every(c=>c.status==='VERIFIED');
    await repo.audit(v.bundleVersionId,'DEPENDENCIES_CHECKED',valid?null:'UI_BUNDLE_DEPENDENCY_UNAVAILABLE');
    return json({bundleVersionId:v.bundleVersionId,manifestVerified:true,checkedAt:new Date().toISOString(),dependenciesAvailable:valid,checks,
        qualificationAtAssembly:envelope.qualification.overall,executionPerformed:false});
}
export default {
    async fetch(request:Request,env:UiBundleEnv):Promise<Response> {try{return await route(request,env);}catch(e){return safeFailure(e);}},
    async queue(batch:MessageBatch<unknown>,env:UiBundleEnv):Promise<void> {await consumeBuilds(batch,env);},
    async scheduled(_event:ScheduledController,env:UiBundleEnv,ctx:ExecutionContext):Promise<void> {
        ctx.waitUntil(recoverBuilds(env).catch(e=>log('recovery.unavailable',{code:errorCode(e)})));
    }
} satisfies ExportedHandler<UiBundleEnv>;
