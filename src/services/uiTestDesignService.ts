import type { UiBundleEnv } from '../env';
import { Repository } from '../storage/repository';
import { readEnvelope } from './buildService';
import { SourceClient } from './sourceClient';
import { canonicalJson, decodeJson, fail, UiError } from '../contracts/canonical';
import { hash, id, validateScope, type Scope } from '../contracts/uiCapture';
import { sameScope, scoped } from '../protocol';
import { compileObservedBundle, validateDesignEnvelope } from './uiTestDesignCompiler';
import { COMPILER_VERSION, type Compilation, type DesignSource } from '../contracts/uiTestDesign';

async function sourceEnvelope(env:UiBundleEnv,scope:Scope,bundleVersionId:string,expectedManifestHash?:string){
  validateScope(scope);id(bundleVersionId);if(expectedManifestHash!==undefined)hash(expectedManifestHash);
  const row=await new Repository(env.UI_DB).version(scope,bundleVersionId),envelope=await readEnvelope(env,row),source=await validateDesignEnvelope(envelope);
  if(!sameScope(source.scope,scope)||source.bundleVersionId!==bundleVersionId||source.captureId!==row.capture_id||source.sourceHash!==row.source_hash||source.manifestHash!==row.manifest_hash)fail('UI_TEST_DESIGN_SOURCE_CONTEXT_MISMATCH',409);
  if(expectedManifestHash!==undefined&&expectedManifestHash!==source.manifestHash)fail('UI_TEST_DESIGN_SOURCE_CHANGED',409);
  return {envelope,source,row};
}
export async function inspectTestDesignSource(env:UiBundleEnv,scope:Scope,bundleVersionId:string,expectedManifestHash?:string){
  const {source,envelope}=await sourceEnvelope(env,scope,bundleVersionId,expectedManifestHash);
  return {contractVersion:'qagent.ui-page-evidence.v2',source,qualification:{integrity:envelope.qualification.dimensions.integrity.status,counts:envelope.qualification.counts},executionPerformed:false};
}
export async function compileTestDesign(env:UiBundleEnv,scope:Scope,bundleVersionId:string,compilerVersion:string,profile?:unknown):Promise<Compilation>{
  if(compilerVersion!==COMPILER_VERSION)fail('UI_TEST_DESIGN_COMPILER_UNSUPPORTED',422);
  const {envelope}=await sourceEnvelope(env,scope,bundleVersionId),client=new SourceClient(env);
  const result=await compileObservedBundle(envelope,id=>client.artifact(envelope.source,id),profile);
  // A source revoked while bytes were being read is not admitted to publication.
  await client.checkAccess(envelope.source);await new Repository(env.UI_DB).version(scope,bundleVersionId);
  return result;
}
interface Cursor {version:1;scope:Scope;captureId:string|null;after:string;ceiling:string;}
function cursorEncode(v:Cursor):string{return btoa(canonicalJson(v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function cursorDecode(s:string):Cursor{
  if(typeof s!=='string'||s.length>2048||!/^[a-zA-Z0-9_-]+$/.test(s))fail('UI_TEST_DESIGN_CURSOR_INVALID');
  try{const v=decodeJson(new TextEncoder().encode(atob(s.replace(/-/g,'+').replace(/_/g,'/')))) as unknown as Cursor;
    if(!v||v.version!==1||Object.keys(v).sort().join(',')!=='after,captureId,ceiling,scope,version')fail('UI_TEST_DESIGN_CURSOR_INVALID');validateScope(v.scope);id(v.after);id(v.ceiling);if(v.captureId!==null)id(v.captureId);return v;
  }catch{fail('UI_TEST_DESIGN_CURSOR_INVALID');}
}
/** Keyset traversal bounded by a fixed lexical ceiling. It is NOT an inventory snapshot:
 * additions at earlier lexical keys may require a new traversal. That fact is returned explicitly. */
export async function listTestDesignSources(env:UiBundleEnv,scope:Scope,captureId:string|null,cursor:string|undefined,limit:number){
  validateScope(scope);if(captureId!==null)id(captureId);if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail('UI_BUNDLE_LIMIT_INVALID');
  let position:Cursor;
  const where=`v.organization_id=? AND v.project_id=? AND v.environment_id=? AND (? IS NULL OR v.capture_id=?) AND v.manifest_state='SEALED' AND json_valid(v.qualification_json) AND json_extract(v.qualification_json,'$.meaning')='OBSERVED_PAGE_EVIDENCE_WITH_FIXTURES_NOT_EXECUTED' AND json_extract(v.qualification_json,'$.dimensions.integrity.status')='READY'`;
  if(cursor){position=cursorDecode(cursor);if(!sameScope(position.scope,scope)||position.captureId!==captureId)fail('UI_TEST_DESIGN_CURSOR_SCOPE_MISMATCH',403);}
  else {const last=await env.UI_DB.prepare(`SELECT MAX(v.bundle_version_id) AS id FROM ui_bundle_versions v WHERE ${where}`).bind(...scoped(scope),captureId,captureId).first<{id:string|null}>();
    if(!last?.id)return {items:[],nextCursor:null,diagnostics:[],pagination:{order:'BUNDLE_VERSION_ID_ASC',inventoryComplete:false,concurrentInsertionsRequireNewTraversal:true}};
    position={version:1,scope,captureId,after:'',ceiling:last.id};}
  const result=await env.UI_DB.prepare(`SELECT v.bundle_version_id,v.capture_id,v.builder_version,v.created_at,v.manifest_hash FROM ui_bundle_versions v WHERE ${where} AND v.bundle_version_id>? AND v.bundle_version_id<=? ORDER BY v.bundle_version_id LIMIT ?`).bind(...scoped(scope),captureId,captureId,position.after,position.ceiling,limit+1).all<any>();
  const candidates=(result.results??[]).slice(0,limit),items:Record<string,unknown>[]=[],diagnostics:Record<string,unknown>[]=[];
  for(const row of candidates){try{const {source,envelope}=await sourceEnvelope(env,scope,row.bundle_version_id);
      items.push({captureId:source.captureId,bundleVersionId:source.bundleVersionId,sourceHash:source.sourceHash,manifestHash:source.manifestHash,builderVersion:row.builder_version,createdAt:row.created_at,
        qualificationState:envelope.qualification.overall,qualification:{overall:envelope.qualification.overall,integrity:envelope.qualification.dimensions.integrity.status,counts:envelope.qualification.counts},eligibility:'OBSERVED_SOURCE_AVAILABLE',executionPerformed:false});
    }catch(error){if(!(error instanceof UiError))throw error;diagnostics.push({captureId:row.capture_id,bundleVersionId:row.bundle_version_id,code:error.code,retryable:error.status>=500});}}
  const more=(result.results??[]).length>limit,nextCursor=more?cursorEncode({...position,after:candidates[candidates.length-1].bundle_version_id}):null;
  return {items,nextCursor,diagnostics,pagination:{order:'BUNDLE_VERSION_ID_ASC',inventoryComplete:false,concurrentInsertionsRequireNewTraversal:true,scannedCandidates:candidates.length}};
}
