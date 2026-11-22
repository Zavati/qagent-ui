import { PAGE_SOURCE_REF_VERSION, validatePageRoot, validatePagePart, type PageSourceRoot } from '../contracts/pageSource';
import { PAGE_LIMITS } from '../contracts/uiPageCopy';
import type { UiBundleEnv } from '../env';
import type { Scope } from '../contracts/uiCapture';
import { decodeJson, fail } from '../contracts/canonical';
import { SOURCE_PREFIX,MAX_SOURCE_BYTES,internalFetch,limitedResponse,validateSourceRef,validateSnapshot,type SourceRef,type BuildMessage } from '../protocol';
import { fetchSourceBytes,fetchSourceStatus } from './sourceIo';
export interface StageDiagnostics {httpStatus:number|null;}
export interface SourceArtifactReadOptions {signal?:AbortSignal;maxBytes?:number;}
export type StageRunner = <T>(stage:string,run:()=>Promise<T>,diagnostics?:StageDiagnostics)=>Promise<T>;
const directStage:StageRunner=(_stage,run)=>run();
export class SourceClient {
    constructor(private env:UiBundleEnv) {}
    private fetch(path:string,body:unknown,onResponse?:(status:number)=>void):Promise<Response> {
        const binding=this.env.OBSERVATION_SERVICE;
        // Observe the actual response before internalFetch translates upstream errors.
        // A local signing/transport failure has no HTTP status to report.
        const observed:Fetcher|undefined=onResponse&&binding?{
            fetch:async(input,init)=>{const response=await binding.fetch(input,init);onResponse(response.status);return response;},
            connect:(address,options)=>binding.connect(address,options)
        }:binding;
        return internalFetch(observed,SOURCE_PREFIX+path,body,this.env.UI_BUNDLE_SOURCE_SECRET);
    }
    async resolve(scope:Scope,captureId:string):Promise<SourceRef> {
        const r=await this.fetch('resolve',{scope,captureId});const v=decodeJson(await limitedResponse(r,32768)) as any;
        return validateSourceRef(v.source);
    }
    async load(source:SourceRef) {return validateSnapshot(decodeJson(await limitedResponse(await this.fetch('snapshot',source),MAX_SOURCE_BYTES)),source);}
    async loadPage(source:SourceRef,runStage:StageRunner=directStage):Promise<PageSourceRoot> {
        if(source.contractVersion!==PAGE_SOURCE_REF_VERSION)fail('UI_BUNDLE_SOURCE_VERSION_UNSUPPORTED');
        const diagnostics:StageDiagnostics={httpStatus:null};
        const response=await runStage('source.page_root.fetch',()=>this.fetch('snapshot',source,status=>{diagnostics.httpStatus=status;}),diagnostics);
        const bytes=await runStage('source.page_root.read',()=>limitedResponse(response,PAGE_LIMITS.sourcePartBytes),diagnostics);
        const root=await runStage('source.page_root.decode',async()=>decodeJson(bytes),diagnostics);
        return runStage('source.page_root.contract',()=>validatePageRoot(root,source),diagnostics);
    }
    async pagePart(source:SourceRef,root:PageSourceRoot,index:number):Promise<any[]> {
        if(!Number.isSafeInteger(index)||index<0||index>=root.parts.length)fail('UI_PAGE_PART_NOT_FOUND',404);
        const bytes=await limitedResponse(await this.fetch('source-part',{source,index}),PAGE_LIMITS.sourcePartBytes);
        if(bytes.length!==root.parts[index].byteLength)fail('UI_PAGE_PART_HASH_MISMATCH',409);
        return validatePagePart(decodeJson(bytes),root.parts[index],root);
    }
    async checkAccess(source:SourceRef,options:Pick<SourceArtifactReadOptions,'signal'>={}):Promise<void> {
        await fetchSourceStatus(this.env.OBSERVATION_SERVICE,SOURCE_PREFIX+'status',source,this.env.UI_BUNDLE_SOURCE_SECRET,options.signal);
    }
    async artifact(source:SourceRef,artifactId:string,options:SourceArtifactReadOptions={}):Promise<Uint8Array> {
        const contractLimit=source.contractVersion===PAGE_SOURCE_REF_VERSION?PAGE_LIMITS.artifactBytes:1048576;
        const max=options.maxBytes===undefined?contractLimit:Math.min(contractLimit,options.maxBytes);
        return fetchSourceBytes(this.env.OBSERVATION_SERVICE,SOURCE_PREFIX+'artifact',{source,artifactId},this.env.UI_BUNDLE_SOURCE_SECRET,max,options.signal);
    }
    async pin(source:SourceRef,bundleVersionId:string,artifactIds:string[]):Promise<void> {
        if(source.contractVersion===PAGE_SOURCE_REF_VERSION && artifactIds.length>128){for(let i=0;i<artifactIds.length;i+=128)await this.pin(source,bundleVersionId,artifactIds.slice(i,i+128));return;}
        const response=await this.fetch('pin',{source,bundleVersionId,artifactIds});
        const r=decodeJson(await limitedResponse(response,32768)) as any;
        const returned=[...(Array.isArray(r.pinnedArtifactIds)?r.pinnedArtifactIds:[]),...(Array.isArray(r.unavailableArtifactIds)?r.unavailableArtifactIds:[])].sort();
        if(r.status!=='ok' || r.pinned!==r.pinnedArtifactIds?.length || returned.length!==artifactIds.length || new Set(returned).size!==returned.length || returned.some((id,i)=>id!==[...artifactIds].sort()[i]))fail('UI_BUNDLE_PIN_RECEIPT_INVALID',409);
    }
    async ack(message:BuildMessage,bundleVersionId:string|null,disposition:'COMPLETED'|'REJECTED'):Promise<void> {
        await this.fetch('ack',{source:message.source,buildId:message.buildId,bundleVersionId,disposition});
    }
}
