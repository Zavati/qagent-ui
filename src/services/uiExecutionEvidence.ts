import type { UiBundleEnv } from '../env';
import type { Scope } from '../contracts/uiCapture';
import type { DesignSource } from '../contracts/uiTestDesign';
import type { ObservedPlanSpecification } from '../contracts/uiObservedPlan';
import { validateUiObservedPlanShape } from '../contracts/uiObservedPlan';
import { object, hash, id, validateScope } from '../contracts/uiCapture';
import { canonicalJson, digestJson, fail, sha256, UiError } from '../contracts/canonical';
import { sameScope } from '../protocol';
import { Repository } from '../storage/repository';
import { readEnvelope } from './buildService';
import { validateDesignEnvelope } from './uiTestDesignCompiler';
import { compileObservedPlan } from './uiObservedPlan';
import { SourceClient } from './sourceClient';

export const EXECUTION_SOURCE_VERSION = 'qagent.ui-execution-source.v1';
export const EXECUTION_EVIDENCE_TIMEOUT_MS = 45000;

interface ExecutionInput {
  scope: Scope;
  source: DesignSource;
  specification: ObservedPlanSpecification;
  specificationHash: string;
  artifactId?: string;
}

function input(value: unknown, artifact: boolean): ExecutionInput {
  const v = object(value, ['scope', 'source', 'specification', 'specificationHash'], artifact ? ['artifactId'] : []);
  validateScope(v.scope);
  const source = object(v.source, ['scope', 'captureId', 'bundleVersionId', 'sourceHash', 'manifestHash']);
  validateScope(source.scope); id(source.captureId); id(source.bundleVersionId); hash(source.sourceHash); hash(source.manifestHash);
  validateUiObservedPlanShape(v.specification); hash(v.specificationHash);
  if (!sameScope(v.scope, source.scope) || !sameScope(v.scope, v.specification.scope)
      || canonicalJson(source) !== canonicalJson(v.specification.source)) fail('UI_EXECUTION_SOURCE_SCOPE_MISMATCH', 403);
  if (artifact) id(v.artifactId);
  return v as ExecutionInput;
}

/** Bound the entire manifest/artifact operation, including bindings that ignore abort.
 * No timeout becomes an empty source or an unverified successful artifact. */
async function bounded<T>(signal: AbortSignal | undefined, run: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const reason = () => new UiError(504, 'UI_EXECUTION_EVIDENCE_TIMEOUT');
  const cancel = () => controller.abort(signal?.reason instanceof UiError ? signal.reason : reason());
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(reason()), EXECUTION_EVIDENCE_TIMEOUT_MS);
  let rejectAbort!: (error: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  try {
    check();
    return await Promise.race([run(controller.signal, check), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

async function pinned(env: UiBundleEnv, v: ExecutionInput, signal: AbortSignal, check: () => void) {
  check();
  if (await digestJson(v.specification) !== v.specificationHash) fail('UI_EXECUTION_SPECIFICATION_HASH_MISMATCH', 409);
  check();
  const repository = new Repository(env.UI_DB);
  const row = await repository.version(v.scope, v.source.bundleVersionId); check();
  if (row.capture_id !== v.source.captureId || row.source_hash !== v.source.sourceHash || row.manifest_hash !== v.source.manifestHash)
    fail('UI_EXECUTION_SOURCE_CHANGED', 409);
  const envelope = await readEnvelope(env, row); check();
  const source = await validateDesignEnvelope(envelope); check();
  if (canonicalJson(source) !== canonicalJson(v.source)) fail('UI_EXECUTION_SOURCE_CHANGED', 409);
  const client = new SourceClient(env);
  await client.checkAccess(envelope.source, { signal }); check();
  // Recompile the compact reference recipe only. This proves the supplied plan belongs
  // to this exact manifest/profile; it does not rerun generation or read artifact bodies.
  const expected = await compileObservedPlan(envelope, v.specification.profile, signal); check();
  if (expected.specificationHash !== v.specificationHash) fail('UI_EXECUTION_SPECIFICATION_SOURCE_MISMATCH', 409);
  return { envelope, source, client, repository };
}

async function accessAgain(v: ExecutionInput, p: Awaited<ReturnType<typeof pinned>>, signal: AbortSignal, check: () => void) {
  await p.client.checkAccess(p.envelope.source, { signal }); check();
  const row = await p.repository.version(v.scope, v.source.bundleVersionId); check();
  if (row.capture_id !== v.source.captureId || row.source_hash !== v.source.sourceHash || row.manifest_hash !== v.source.manifestHash)
    fail('UI_EXECUTION_SOURCE_CHANGED', 409);
}

/** Full values are exposed only to the authenticated execution adapter, never through
 * UI previews. The caller Gateway supplies the frozen admitted design, not a Runner URL. */
export async function readExecutionSource(env: UiBundleEnv, value: unknown, signal?: AbortSignal) {
  const v = input(value, false);
  return bounded(signal, async (active, check) => {
    const p = await pinned(env, v, active, check);
    await accessAgain(v, p, active, check);
    return { contractVersion: EXECUTION_SOURCE_VERSION, source: p.source, specificationHash: v.specificationHash, envelope: p.envelope };
  });
}

export async function readExecutionArtifact(env: UiBundleEnv, value: unknown, signal?: AbortSignal) {
  const v = input(value, true);
  return bounded(signal, async (active, check) => {
    const p = await pinned(env, v, active, check);
    const ref = p.envelope.bundle.artifacts.find((entry: any) => entry.artifactId === v.artifactId);
    if (!ref) fail('UI_BUNDLE_ARTIFACT_NOT_REFERENCED', 403);
    const bytes = await p.client.artifact(p.envelope.source, v.artifactId!, { signal: active, maxBytes: ref.byteLength }); check();
    if (bytes.length !== ref.byteLength || await sha256(bytes) !== ref.sha256) fail('UI_BUNDLE_ARTIFACT_HASH_MISMATCH', 409);
    check(); await accessAgain(v, p, active, check);
    return { bytes, ref };
  });
}
