import { canonicalJson,digestJson,fail } from '../contracts/canonical';
import type { Scope } from '../contracts/uiCapture';
import { scoped,type BuildMessage } from '../protocol';
export interface BuildRow {build_id:string;organization_id:string;project_id:string;environment_id:string;capture_id:string;source_hash:string;request_hash:string;message_json:string;status:'PENDING'|'BUILDING'|'COMPLETE'|'FAILED';bundle_version_id:string|null;lease_token:string|null;lease_until:number;attempts:number;created_at:number;updated_at:number;next_dispatch_at:number;last_error:string|null;}
export interface VersionRow {bundle_version_id:string;bundle_id:string;journey_id:string;journey_version_id:string;build_id:string;organization_id:string;project_id:string;environment_id:string;capture_id:string;source_hash:string;builder_version:string;manifest_state:string;qualification_state:string;qualification_json:string;manifest_hash:string;object_sha256:string;object_key:string;byte_length:number;created_at:number;access_state?:string;}
const WHERE='organization_id=? AND project_id=? AND environment_id=?';
export class Repository {
    constructor(readonly db:D1Database){}
    async ready():Promise<void> {await this.db.prepare('SELECT build_id,lease_token FROM ui_bundle_builds WHERE 0').all();await this.db.prepare('SELECT bundle_version_id,manifest_hash FROM ui_bundle_versions WHERE 0').all();}
    async getBuild(buildId:string):Promise<BuildRow|null> {return this.db.prepare('SELECT * FROM ui_bundle_builds WHERE build_id=?').bind(buildId).first<BuildRow>();}
    async admit(m:BuildMessage):Promise<BuildRow> {
        const {signature,...content}=m;const h=await digestJson(content),now=Date.now();
        await this.db.prepare(`INSERT INTO ui_bundle_builds(build_id,organization_id,project_id,environment_id,capture_id,source_hash,request_hash,message_json,created_at,updated_at,next_dispatch_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(build_id) DO NOTHING`)
            .bind(m.buildId,...scoped(m.source.scope),m.source.captureId,m.source.sourceHash,h,canonicalJson(m),now,now,now).run();
        const r=(await this.getBuild(m.buildId))!;if(r.request_hash!==h)fail('UI_BUNDLE_IDEMPOTENCY_CONFLICT',409);return r;
    }
    async lease(buildId:string):Promise<string|null> {
        const now=Date.now(),token=crypto.randomUUID();
        const r=await this.db.prepare(`UPDATE ui_bundle_builds SET status='BUILDING',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE build_id=? AND status IN ('PENDING','BUILDING') AND lease_until<=?`)
            .bind(token,now+180000,now,buildId,now).run();return r.meta.changes?token:null;
    }
    async heartbeat(buildId:string,token:string):Promise<void> {
        const now=Date.now(),r=await this.db.prepare(`UPDATE ui_bundle_builds SET lease_until=?,updated_at=? WHERE build_id=? AND lease_token=? AND status='BUILDING' AND lease_until>?`).bind(now+180000,now,buildId,token,now).run();
        if(!r.meta.changes)fail('UI_BUNDLE_LEASE_LOST',503);
    }
    async release(buildId:string,token:string,code:string):Promise<void> {await this.db.prepare(`UPDATE ui_bundle_builds SET status='PENDING',lease_token=NULL,lease_until=0,last_error=?,updated_at=?,next_dispatch_at=? WHERE build_id=? AND lease_token=? AND status='BUILDING'`).bind(code,Date.now(),Date.now()+60000,buildId,token).run();}
    async version(scope:Scope,id:string,allowRevoked=false):Promise<VersionRow> {
        const v=await this.db.prepare(`SELECT v.*,a.state AS access_state FROM ui_bundle_versions v JOIN ui_bundle_access a USING(bundle_version_id) WHERE v.organization_id=? AND v.project_id=? AND v.environment_id=? AND v.bundle_version_id=?`).bind(...scoped(scope),id).first<VersionRow>();
        if(!v)fail('UI_BUNDLE_NOT_FOUND',404);if(v.access_state!=='ACTIVE' && !allowRevoked)fail('UI_BUNDLE_ACCESS_REVOKED',410);return v;
    }
    async commit(m:BuildMessage,token:string,envelope:Record<string,any>,objectKey:string,objectHash:string,byteLength:number):Promise<VersionRow> {
        const now=Date.now(),s=m.source.scope;
        const valid=`EXISTS(SELECT 1 FROM ui_bundle_builds WHERE build_id=? AND lease_token=? AND status='BUILDING' AND lease_until>?)`;
        await this.db.batch([
            this.db.prepare(`INSERT INTO ui_journeys(journey_id,organization_id,project_id,environment_id,capture_id,created_at) SELECT ?,?,?,?,?,? WHERE ${valid} ON CONFLICT(journey_id) DO NOTHING`)
                .bind(envelope.journeyId,...scoped(s),m.source.captureId,now,m.buildId,token,now),
            this.db.prepare(`INSERT INTO ui_bundle_versions(bundle_version_id,bundle_id,journey_id,journey_version_id,build_id,organization_id,project_id,environment_id,capture_id,source_hash,builder_version,manifest_state,qualification_state,qualification_json,manifest_hash,object_sha256,object_key,byte_length,created_at)
                SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${valid} ON CONFLICT(bundle_version_id) DO NOTHING`)
                .bind(envelope.bundleVersionId,envelope.bundleId,envelope.journeyId,envelope.journeyVersionId,m.buildId,...scoped(s),m.source.captureId,m.source.sourceHash,envelope.builderVersion,envelope.manifestState,envelope.qualification.overall,canonicalJson(envelope.qualification),envelope.manifestHash,objectHash,objectKey,byteLength,now,m.buildId,token,now),
            this.db.prepare(`INSERT INTO ui_bundle_access(bundle_version_id,state,updated_at) SELECT ?,'ACTIVE',? WHERE EXISTS(SELECT 1 FROM ui_bundle_versions WHERE bundle_version_id=?) ON CONFLICT(bundle_version_id) DO NOTHING`).bind(envelope.bundleVersionId,now,envelope.bundleVersionId),
            this.db.prepare(`UPDATE ui_bundle_builds SET status='COMPLETE',bundle_version_id=?,lease_token=NULL,lease_until=0,last_error=NULL,updated_at=? WHERE build_id=? AND lease_token=? AND status='BUILDING' AND lease_until>? AND EXISTS(SELECT 1 FROM ui_bundle_versions WHERE bundle_version_id=? AND manifest_hash=?)`)
                .bind(envelope.bundleVersionId,now,m.buildId,token,now,envelope.bundleVersionId,envelope.manifestHash)
        ]);
        const completed=await this.getBuild(m.buildId);if(completed?.status!=='COMPLETE')fail('UI_BUNDLE_LEASE_OR_COMMIT_CONFLICT',503);
        const v=await this.version(s,envelope.bundleVersionId);if(v.manifest_hash!==envelope.manifestHash)fail('UI_BUNDLE_IDEMPOTENCY_CONFLICT',409);return v;
    }
    async list(scope:Scope,captureId:string|null,after:string,limit:number):Promise<{items:Record<string,unknown>[];nextCursor:string|null}> {
        const r=await this.db.prepare(`SELECT v.bundle_version_id,v.bundle_id,v.journey_id,v.capture_id,v.builder_version,v.manifest_state,v.qualification_state,v.created_at,a.state AS access_state FROM ui_bundle_versions v JOIN ui_bundle_access a USING(bundle_version_id) WHERE v.organization_id=? AND v.project_id=? AND v.environment_id=? AND (? IS NULL OR v.capture_id=?) AND v.bundle_version_id>? ORDER BY v.bundle_version_id LIMIT ?`)
            .bind(...scoped(scope),captureId,captureId,after,limit+1).all<Record<string,unknown>>();
        const all=r.results??[],more=all.length>limit,items=all.slice(0,limit);return {items,nextCursor:more?String(items[items.length-1].bundle_version_id):null};
    }
    async audit(versionId:string,event:string,code:string|null=null):Promise<void> {await this.db.prepare('INSERT INTO ui_bundle_audit(audit_id,bundle_version_id,event,reason_code,created_at) VALUES(?,?,?,?,?)').bind('audit_'+crypto.randomUUID(),versionId,event,code,Date.now()).run();}
    async revoke(scope:Scope,id:string):Promise<void> {
        const exists=await this.db.prepare(`SELECT bundle_version_id FROM ui_bundle_versions WHERE ${WHERE} AND bundle_version_id=?`).bind(...scoped(scope),id).first();
        if(!exists)fail('UI_BUNDLE_NOT_FOUND',404);
        await this.db.batch([this.db.prepare("UPDATE ui_bundle_access SET state='REVOKED',updated_at=? WHERE bundle_version_id=?").bind(Date.now(),id),
            this.db.prepare("INSERT INTO ui_bundle_audit(audit_id,bundle_version_id,event,created_at) VALUES(?,?,'ACCESS_REVOKED',?)").bind('audit_'+crypto.randomUUID(),id,Date.now())]);
    }
    async supersede(buildId:string):Promise<void> {
        await this.db.prepare("UPDATE ui_bundle_builds SET status='FAILED',last_error='UI_BUNDLE_BUILD_SUPERSEDED',updated_at=?,lease_token=NULL,lease_until=0 WHERE build_id=? AND status<>'COMPLETE' AND lease_until<=?").bind(Date.now(),buildId,Date.now()).run();
    }
    async quarantine(messageId:string,buildId:string|null,code:string,payloadHash:string):Promise<void> {
        await this.db.prepare('INSERT INTO ui_bundle_deadletters(message_id,build_id,reason_code,payload_hash,created_at) VALUES(?,?,?,?,?) ON CONFLICT(message_id) DO NOTHING').bind(await digestJson(messageId),buildId,code,payloadHash,Date.now()).run();
        if(buildId)await this.db.prepare("UPDATE ui_bundle_builds SET status='FAILED',last_error=?,updated_at=?,lease_token=NULL,lease_until=0 WHERE build_id=? AND status<>'COMPLETE' AND lease_until<=?").bind(code,Date.now(),buildId,Date.now()).run();
    }
}
