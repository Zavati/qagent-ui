import { CANONICAL_VERSION, canonicalJson, fail, verifyManifestHash } from './canonical';
export const CAPABILITY_REVISION = '08.2-A.1.r1' as const;
export const OBSERVED_REVISION = '08.2-A.2.r1' as const;
export const OBSERVED_PRIVACY_VERSION = 'qagent.ui-observed-allowlist.v1' as const;
export const PRIVACY_VERSION = 'qagent.ui-json-sanitized.v1' as const;
export const CONTRACTS = Object.freeze({
    capture: 'qagent.ui-capture.v1', events: 'qagent.ui-capture-events.v1', artifact: 'qagent.ui-artifact.v1',
    action: 'qagent.ui-action.v1', checkpoint: 'qagent.ui-checkpoint.v1', interaction: 'qagent.ui-interaction.v1',
    journey: 'qagent.ui-journey.v1', bundle: 'qagent.ui-replay-bundle.v1', capabilities: 'qagent.ui-capabilities.v1'
});
export const UI_LIMITS = Object.freeze({ artifactBytes: 1048576, artifactsPerCapture: 128, captureArtifactBytes: 67108864,
    eventBytes: 32768, batchBytes: 262144, batchEvents: 100, captureEvents: 2000, captureEventBytes: 8388608,
    controlBytes: 32768, sessionSeconds: 900 });
export const ARTIFACT_KINDS = ['REQUEST_JSON', 'RESPONSE_JSON', 'HEADERS_JSON', 'ACTION_VALUE_JSON', 'SEMANTIC_JSON', 'SCREENSHOT_PNG'] as const;
export type ArtifactKind = typeof ARTIFACT_KINDS[number];
export type DataOrigin = 'SYNTHETIC_CONTROL' | 'OBSERVED_SANITIZED' | 'OBSERVED_ENVIRONMENT_MANAGED';
export interface Scope {
    organizationId: string;
    projectId: string;
    environmentId: string;
}
export interface ArtifactInput {
    contractVersion: string;
    operationId: string;
    kind: ArtifactKind;
    contentType: 'application/json' | 'image/png';
    byteLength: number;
    sha256: string;
    privacy: {
        policyVersion: typeof PRIVACY_VERSION | typeof OBSERVED_PRIVACY_VERSION;
        representation: 'SANITIZED_JSON' | 'MASKED_PNG';
        visual?: VisualPolicy;
        dataOrigin: DataOrigin;
        transformations: {
            kind: 'REDACTED' | 'PSEUDONYMIZED';
            path: string;
        }[];
    };
}
export interface ArtifactRef {
    artifactId: string;
    sha256: string;
    byteLength: number;
    contentType: 'application/json' | 'image/png';
    privacyPolicyVersion: typeof PRIVACY_VERSION | typeof OBSERVED_PRIVACY_VERSION;
    completeness: 'COMPLETE';
    dataOrigin: DataOrigin;
}
export interface CaptureStart {
    contractVersion: string;
    operationId: string;
    dataOrigin: DataOrigin;
    documentId: string;
    entryUrl: string;
    sourceBuildRef: string | null;
    issues: string[];
    capturePolicy?: CapturePolicy;
}
export interface CaptureComplete {
    contractVersion: string;
    operationId: string;
    outcome: 'RECORDED' | 'PARTIAL' | 'ABORTED';
    issues: string[];
}
export interface Locator {
    strategy: 'TEST_ID' | 'ROLE' | 'TEXT' | 'CSS';
    value: string;
}
export interface Target {
    primaryLocator: Locator;
    candidateLocators: Locator[];
    observedMatchCount: number;
    framePath: string[];
}
export interface Action {
    contractVersion: string;
    actionId: string;
    stepId: string;
    sequence: number;
    documentId: string;
    navigationId: string;
    relativeTimeMs: number;
    type: 'CLICK' | 'FILL' | 'SELECT' | 'CHECK' | 'NAVIGATE' | 'SCROLL';
    target?: Target;
    input?: {
        source: DataOrigin;
        valueRef: string;
    };
    checked?: boolean;
    destination?: string;
    position?: {
        x: number;
        y: number;
    };
}
export interface Checkpoint {
    contractVersion: string;
    checkpointId: string;
    stepId: string;
    sequence: number;
    documentId: string;
    navigationId: string;
    relativeTimeMs: number;
    stability: {
        kind: 'DOM_QUIET' | 'NETWORK_QUIET' | 'EXPLICIT_CONDITION';
        durationMs: number;
    };
    functionalRef: string | null;
    semanticRef: string | null;
    screenshotRef: string | null;
    modalities: {
        functional: 'AVAILABLE' | 'UNAVAILABLE';
        semantic: 'AVAILABLE' | 'UNAVAILABLE';
        visual: 'AVAILABLE' | 'UNAVAILABLE';
    };
    issues: string[];
}
export interface Interaction {
    contractVersion: string;
    entryId: string;
    requestId: string;
    stepId: string | null;
    documentId: string;
    navigationId: string;
    relativeTimeMs: number;
    logicalServiceKey: string;
    request: {
        method: string;
        origin: string;
        path: string;
        query: [
            string,
            string
        ][];
        bodyRef: string | null;
        businessHeadersRef: string | null;
        /** Explicit PAGE-COPY r2 only; v1 validation continues to reject this field. */
        observedHeadersRef?: string | null;
    };
    response: {
        status: number | null;
        bodyRef: string | null;
        headersRef: string | null;
        bodyHash: string | null;
        completeness: 'COMPLETE' | 'OMITTED' | 'PARTIAL';
    };
    consumption: {
        required: boolean;
        minimum: number;
        maximum: number;
    };
    correlationBasis: 'NAVIGATION_AND_STEP_WINDOW' | 'TEMPORAL_ONLY';
    issues: string[];
}
export interface UiEvent {
    eventId: string;
    sequence: number;
    kind: 'ACTION' | 'INTERACTION' | 'CHECKPOINT' | 'GAP';
    payload: Action | Interaction | Checkpoint | {
        code: string;
        documentId: string | null;
        stepId: string | null;
    };
    contentHash: string;
}
export interface EventsInput {
    contractVersion: string;
    operationId: string;
    events: UiEvent[];
}
type Obj = Record<string, any>;
export function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Obj {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail();
    const v = value as Obj;
    if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => ![...required, ...optional].includes(k)))
        fail();
    return v;
}
export function text(v: unknown, max = 256): asserts v is string {
    if (typeof v !== 'string' || !v.length || v.length > max || /[\u0000-\u001f\u007f]/.test(v))
        fail();
}
export function id(v: unknown): asserts v is string { text(v, 180); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,179}$/.test(v))
    fail(); }
export function hash(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    fail('UI_HASH_INVALID'); }
function number(v: unknown, min = 0, max = 86400000): asserts v is number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    fail(); }
function enumValue(v: unknown, allowed: readonly unknown[]): void { if (!allowed.includes(v))
    fail(); }
function boolean(v: unknown): void { if (typeof v !== 'boolean')
    fail(); }
function list(v: unknown, max: number, check: (x: any) => void): asserts v is any[] { if (!Array.isArray(v) || v.length > max)
    fail(); v.forEach(check); }
function version(v: unknown, expected: string): void { if (v !== expected)
    fail('UI_CONTRACT_VERSION_UNSUPPORTED'); }
function nullableId(v: unknown): void { if (v !== null)
    id(v); }
function issues(v: unknown): void { list(v, 64, (x) => { text(x, 80); if (!/^[A-Z][A-Z0-9_]+$/.test(x))
    fail(); }); }
export function origin(v: unknown): void { text(v, 2048); try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol) || u.origin !== v || u.username || u.password)
        fail();
}
catch {
    fail('UI_ORIGIN_INVALID');
} }
export function safeUrl(v: unknown): void { text(v, 4096); try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
        fail();
}
catch {
    fail('UI_URL_INVALID');
} }
export function validateScope(value: unknown): Scope { const v = object(value, ['organizationId', 'projectId', 'environmentId']); Object.values(v).forEach(id); return v as Scope; }
export function validateCaptureStart(value: unknown): CaptureStart {
    const v = object(value, ['contractVersion', 'operationId', 'dataOrigin', 'documentId', 'entryUrl', 'sourceBuildRef', 'issues'], ['capturePolicy']);
    version(v.contractVersion, CONTRACTS.capture);
    id(v.operationId);
    id(v.documentId);
    safeUrl(v.entryUrl);
    enumValue(v.dataOrigin, ['SYNTHETIC_CONTROL', 'OBSERVED_SANITIZED']);
    if (v.sourceBuildRef !== null)
        id(v.sourceBuildRef);
    issues(v.issues);
    if (v.sourceBuildRef === null && !v.issues.includes('SOURCE_BUILD_UNKNOWN'))
        fail();
    if (v.dataOrigin === 'OBSERVED_SANITIZED') { validateCapturePolicy(v.capturePolicy); if(v.capturePolicy.dataProtection!==undefined)fail('UI_POLICY_PROFILE_MISMATCH'); }
    else if (v.capturePolicy !== undefined) fail();
    return v as CaptureStart;
}
export function validateCaptureComplete(value: unknown): CaptureComplete {
    const v = object(value, ['contractVersion', 'operationId', 'outcome', 'issues']);
    version(v.contractVersion, CONTRACTS.capture);
    id(v.operationId);
    enumValue(v.outcome, ['RECORDED', 'PARTIAL', 'ABORTED']);
    issues(v.issues);
    if (v.outcome !== 'RECORDED' && !v.issues.length)
        fail();
    return v as CaptureComplete;
}
export function validateArtifactInput(value: unknown): ArtifactInput {
    const v = object(value, ['contractVersion', 'operationId', 'kind', 'contentType', 'byteLength', 'sha256', 'privacy']);
    version(v.contractVersion, CONTRACTS.artifact);
    id(v.operationId);
    enumValue(v.kind, ARTIFACT_KINDS);
    enumValue(v.contentType, ['application/json', 'image/png']);
    number(v.byteLength, 1, UI_LIMITS.artifactBytes);
    hash(v.sha256);
    const p = object(v.privacy, ['policyVersion', 'representation', 'dataOrigin', 'transformations'], ['visual']);
    enumValue(p.policyVersion, [PRIVACY_VERSION, OBSERVED_PRIVACY_VERSION]);
    enumValue(p.representation, ['SANITIZED_JSON', 'MASKED_PNG']);
    if (p.dataOrigin === 'OBSERVED_SANITIZED' && p.policyVersion !== OBSERVED_PRIVACY_VERSION) fail('UI_PRIVACY_POLICY_REQUIRED');
    if (v.contentType === 'image/png') {
        if (v.kind !== 'SCREENSHOT_PNG' || p.dataOrigin !== 'OBSERVED_SANITIZED' || p.representation !== 'MASKED_PNG') fail();
        validateVisualPolicy(p.visual);
    } else if (v.kind === 'SCREENSHOT_PNG' || p.visual || p.representation !== 'SANITIZED_JSON') fail();
    enumValue(p.dataOrigin, ['SYNTHETIC_CONTROL', 'OBSERVED_SANITIZED']);
    list(p.transformations, 64, x => { const t = object(x, ['kind', 'path']); enumValue(t.kind, ['REDACTED', 'PSEUDONYMIZED']); text(t.path, 512); });
    return v as ArtifactInput;
}
export function validateArtifactRef(value: unknown): ArtifactRef {
    const v = object(value, ['artifactId', 'sha256', 'byteLength', 'contentType', 'privacyPolicyVersion', 'completeness', 'dataOrigin']);
    id(v.artifactId);
    hash(v.sha256);
    number(v.byteLength, 1, UI_LIMITS.artifactBytes);
    enumValue(v.contentType, ['application/json', 'image/png']);
    enumValue(v.privacyPolicyVersion, [PRIVACY_VERSION, OBSERVED_PRIVACY_VERSION]);
    enumValue(v.completeness, ['COMPLETE']);
    enumValue(v.dataOrigin, ['SYNTHETIC_CONTROL', 'OBSERVED_SANITIZED']);
    return v as ArtifactRef;
}
function locator(value: unknown): void { const v = object(value, ['strategy', 'value']); enumValue(v.strategy, ['TEST_ID', 'ROLE', 'TEXT', 'CSS']); text(v.value, 512); }
function target(value: unknown): void {
    const v = object(value, ['primaryLocator', 'candidateLocators', 'observedMatchCount', 'framePath']);
    locator(v.primaryLocator);
    list(v.candidateLocators, 8, locator);
    number(v.observedMatchCount, 0, 100000);
    list(v.framePath, 0, id);
}
export function validateAction(value: unknown): Action {
    const v = object(value, ['contractVersion', 'actionId', 'stepId', 'sequence', 'documentId', 'navigationId', 'relativeTimeMs', 'type'], ['target', 'input', 'checked', 'destination', 'position']);
    version(v.contractVersion, CONTRACTS.action);
    [v.actionId, v.stepId, v.documentId, v.navigationId].forEach(id);
    number(v.sequence, 0, 100000);
    number(v.relativeTimeMs);
    enumValue(v.type, ['CLICK', 'FILL', 'SELECT', 'CHECK', 'NAVIGATE', 'SCROLL']);
    const extra: Record<string, string[]> = { CLICK: ['target'], FILL: ['target', 'input'], SELECT: ['target', 'input'], CHECK: ['target', 'checked'], NAVIGATE: ['destination'], SCROLL: ['position'] };
    const expected = extra[v.type];
    for (const k of ['target', 'input', 'checked', 'destination', 'position'])
        if (Object.hasOwn(v, k) !== expected.includes(k))
            fail();
    if (v.target)
        target(v.target);
    if (v.input) {
        const i = object(v.input, ['source', 'valueRef']);
        enumValue(i.source, ['SYNTHETIC_CONTROL', 'OBSERVED_SANITIZED']);
        id(i.valueRef);
    }
    if (v.type === 'CHECK')
        boolean(v.checked);
    if (v.destination)
        safeUrl(v.destination);
    if (v.position) {
        const p = object(v.position, ['x', 'y']);
        number(p.x, 0, 10000000);
        number(p.y, 0, 10000000);
    }
    return v as Action;
}
export function validateCheckpoint(value: unknown): Checkpoint {
    const v = object(value, ['contractVersion', 'checkpointId', 'stepId', 'sequence', 'documentId', 'navigationId', 'relativeTimeMs', 'stability', 'functionalRef', 'semanticRef', 'screenshotRef', 'modalities', 'issues']);
    version(v.contractVersion, CONTRACTS.checkpoint);
    [v.checkpointId, v.stepId, v.documentId, v.navigationId].forEach(id);
    number(v.sequence, 0, 100000);
    number(v.relativeTimeMs);
    const s = object(v.stability, ['kind', 'durationMs']);
    enumValue(s.kind, ['DOM_QUIET', 'NETWORK_QUIET', 'EXPLICIT_CONDITION']);
    number(s.durationMs, 0, 60000);
    const m = object(v.modalities, ['functional', 'semantic', 'visual']);
    for (const [k, ref] of [['functional', 'functionalRef'], ['semantic', 'semanticRef'], ['visual', 'screenshotRef']]) {
        enumValue(m[k], ['AVAILABLE', 'UNAVAILABLE']);
        nullableId(v[ref]);
        if ((m[k] === 'AVAILABLE') !== (v[ref] !== null))
            fail();
    }
    issues(v.issues);
    return v as Checkpoint;
}
export function validateInteraction(value: unknown): Interaction {
    const v = object(value, ['contractVersion', 'entryId', 'requestId', 'stepId', 'documentId', 'navigationId', 'relativeTimeMs', 'logicalServiceKey', 'request', 'response', 'consumption', 'correlationBasis', 'issues']);
    version(v.contractVersion, CONTRACTS.interaction);
    [v.entryId, v.requestId, v.documentId, v.navigationId, v.logicalServiceKey].forEach(id);
    nullableId(v.stepId);
    number(v.relativeTimeMs);
    const req = object(v.request, ['method', 'origin', 'path', 'query', 'bodyRef', 'businessHeadersRef']);
    enumValue(req.method, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
    origin(req.origin);
    text(req.path, 4096);
    if (!req.path.startsWith('/') || req.path.startsWith('//') || /[?#]/.test(req.path))
        fail();
    list(req.query, 256, p => { if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || p[0].length > 2048 || p[1].length > 4096)
        fail(); });
    nullableId(req.bodyRef);
    nullableId(req.businessHeadersRef);
    const res = object(v.response, ['status', 'bodyRef', 'headersRef', 'bodyHash', 'completeness']);
    if (res.status !== null)
        number(res.status, 100, 599);
    nullableId(res.bodyRef);
    nullableId(res.headersRef);
    if (res.bodyHash !== null)
        hash(res.bodyHash);
    enumValue(res.completeness, ['COMPLETE', 'OMITTED', 'PARTIAL']);
    const emptyBodyAllowed = req.method === 'HEAD' || [204, 205, 304].includes(res.status);
    if (res.completeness === 'COMPLETE' && (res.status === null || (!emptyBodyAllowed && (res.bodyRef === null || res.bodyHash === null))))
        fail();
    if ((res.bodyRef === null) !== (res.bodyHash === null))
        fail();
    const c = object(v.consumption, ['required', 'minimum', 'maximum']);
    boolean(c.required);
    number(c.minimum, 0, 100);
    number(c.maximum, 1, 100);
    if (c.minimum > c.maximum || c.required !== (c.minimum > 0))
        fail();
    enumValue(v.correlationBasis, ['NAVIGATION_AND_STEP_WINDOW', 'TEMPORAL_ONLY']);
    issues(v.issues);
    return v as Interaction;
}
export function validateEvents(value: unknown): EventsInput {
    const v = object(value, ['contractVersion', 'operationId', 'events']);
    version(v.contractVersion, CONTRACTS.events);
    id(v.operationId);
    const ids = new Set<string>(), seqs = new Set<number>();
    list(v.events, UI_LIMITS.batchEvents, (x) => {
        const e = object(x, ['eventId', 'sequence', 'kind', 'payload', 'contentHash']);
        id(e.eventId);
        number(e.sequence, 0, 100000);
        hash(e.contentHash);
        if (ids.has(e.eventId) || seqs.has(e.sequence))
            fail('UI_EVENT_CONFLICT', 409);
        ids.add(e.eventId);
        seqs.add(e.sequence);
        switch (e.kind) {
            case 'ACTION':
                validateAction(e.payload);
                break;
            case 'CHECKPOINT':
                validateCheckpoint(e.payload);
                break;
            case 'INTERACTION':
                validateInteraction(e.payload);
                break;
            case 'GAP': {
                const p = object(e.payload, ['code', 'documentId', 'stepId']);
                issues([p.code]);
                nullableId(p.documentId);
                nullableId(p.stepId);
                break;
            }
            default: fail();
        }
        if (['ACTION', 'CHECKPOINT'].includes(e.kind) && e.sequence !== e.payload.sequence)
            fail();
        if (new TextEncoder().encode(canonicalJson(e)).length > UI_LIMITS.eventBytes)
            fail('UI_EVENT_TOO_LARGE', 413);
    });
    if (!v.events.length)
        fail();
    return v as EventsInput;
}
function unique(list: any[], key: string): void { if (new Set(list.map(x => x[key])).size !== list.length)
    fail('UI_DUPLICATE_IDENTITY'); }
export function validateJourney(value: unknown): Record<string, unknown> {
    const v = object(value, ['contractVersion', 'canonicalizerVersion', 'journeyId', 'journeyVersionId', 'scope', 'captureId', 'dataOrigin', 'title', 'objective', 'entryUrl', 'sourceBuildRef', 'renderProfileRef', 'actions', 'checkpoints', 'issues', 'manifestHash']);
    version(v.contractVersion, CONTRACTS.journey);
    version(v.canonicalizerVersion, CANONICAL_VERSION);
    [v.journeyId, v.journeyVersionId, v.captureId].forEach(id);
    validateScope(v.scope);
    enumValue(v.dataOrigin, ['SYNTHETIC_CONTROL', 'OBSERVED_SANITIZED']);
    text(v.title, 160);
    text(v.objective, 1024);
    safeUrl(v.entryUrl);
    nullableId(v.sourceBuildRef);
    nullableId(v.renderProfileRef);
    list(v.actions, 500, validateAction);
    list(v.checkpoints, 128, validateCheckpoint);
    unique(v.actions, 'actionId');
    unique(v.checkpoints, 'checkpointId');
    issues(v.issues);
    hash(v.manifestHash);
    if (v.sourceBuildRef === null && !v.issues.includes('SOURCE_BUILD_UNKNOWN'))
        fail();
    return v;
}
export function validateBundle(value: unknown): Record<string, unknown> {
    const v = object(value, ['contractVersion', 'canonicalizerVersion', 'bundleId', 'bundleVersionId', 'journeyVersionId', 'scope', 'captureId', 'dataOrigin', 'sourceBuildRef', 'captureCompleteness', 'declaredScope', 'bootstrap', 'matchPolicyVersion', 'interactions', 'checkpointRefs', 'artifacts', 'issues', 'manifestHash']);
    version(v.contractVersion, CONTRACTS.bundle);
    version(v.canonicalizerVersion, CANONICAL_VERSION);
    [v.bundleId, v.bundleVersionId, v.journeyVersionId, v.captureId, v.matchPolicyVersion].forEach(id);
    validateScope(v.scope);
    enumValue(v.dataOrigin, ['SYNTHETIC_CONTROL', 'OBSERVED_SANITIZED']);
    nullableId(v.sourceBuildRef);
    enumValue(v.captureCompleteness, ['COMPLETE_FOR_DECLARED_SCOPE', 'PARTIAL']);
    const s = object(v.declaredScope, ['profile', 'businessOrigins', 'limitations']);
    enumValue(s.profile, ['CSR_REST_JSON_SINGLE_TAB']);
    list(s.businessOrigins, 16, origin);
    issues(s.limitations);
    const b = object(v.bootstrap, ['mode', 'authProfileRef']);
    enumValue(b.mode, ['NONE', 'CONTROLLED_SESSION', 'UNAVAILABLE']);
    nullableId(b.authProfileRef);
    if ((b.mode === 'CONTROLLED_SESSION') !== (b.authProfileRef !== null))
        fail();
    list(v.interactions, 1000, validateInteraction);
    unique(v.interactions, 'entryId');
    list(v.checkpointRefs, 128, id);
    list(v.artifacts, UI_LIMITS.artifactsPerCapture, validateArtifactRef);
    unique(v.artifacts, 'artifactId');
    issues(v.issues);
    hash(v.manifestHash);
    const refs = new Map<string, ArtifactRef>(v.artifacts.map((r: ArtifactRef) => [r.artifactId, r]));
    for (const x of v.interactions as Interaction[]) {
        if (!s.businessOrigins.includes(x.request.origin))
            fail('UI_ORIGIN_NOT_AUTHORIZED', 403);
        for (const rid of [x.request.bodyRef, x.request.businessHeadersRef, x.response.bodyRef, x.response.headersRef])
            if (rid !== null && !refs.has(rid))
                fail('UI_ARTIFACT_REF_MISSING');
        if (x.response.bodyRef && refs.get(x.response.bodyRef)?.sha256 !== x.response.bodyHash)
            fail('UI_HASH_INVALID');
        if (v.captureCompleteness === 'COMPLETE_FOR_DECLARED_SCOPE' && x.response.completeness !== 'COMPLETE')
            fail('UI_BUNDLE_INCOMPLETE');
    }
    if (v.sourceBuildRef === null && !v.issues.includes('SOURCE_BUILD_UNKNOWN'))
        fail();
    if (v.captureCompleteness === 'COMPLETE_FOR_DECLARED_SCOPE' && b.mode === 'UNAVAILABLE')
        fail('UI_BUNDLE_INCOMPLETE');
    return v;
}
export async function validateManifest(value: unknown): Promise<Record<string, unknown>> {
    const v = value as Record<string, unknown>;
    const parsed = v?.contractVersion === CONTRACTS.journey ? validateJourney(v) : validateBundle(v);
    await verifyManifestHash(parsed);
    return parsed;
}
/** Direct artifact references only. Does not interpret arbitrary strings as code. */
export function eventArtifactRefs(event: UiEvent): string[] {
    const p: any = event.payload;
    if (event.kind === 'ACTION')
        return p.input ? [p.input.valueRef] : [];
    if (event.kind === 'CHECKPOINT')
        return [p.functionalRef, p.semanticRef, p.screenshotRef].filter((x): x is string => x !== null);
    if (event.kind === 'INTERACTION')
        return [p.request.bodyRef, p.request.businessHeadersRef, p.response.bodyRef, p.response.headersRef].filter((x): x is string => x !== null);
    return [];
}


/** Narrow, explicit data-use scope. It is not authorization to execute business requests. */
export type CapturePolicyMode = 'PROTECTED' | 'FULL_TEST';
export function isEnvironmentManagedPolicy(value:unknown):value is CapturePolicy & {mode:'FULL_TEST';dataProtection:'ENVIRONMENT_MANAGED'} {const v=value as CapturePolicy|undefined;return v?.mode==='FULL_TEST'&&v?.dataProtection==='ENVIRONMENT_MANAGED';}
export interface CapturePolicy {
    version: 'qagent.ui-capture-policy.v1';
    mode?: CapturePolicyMode;
    dataProtection?: 'ENVIRONMENT_MANAGED';
    acknowledgeTestData: true;
    networkPaths: string[];
    businessHeaderNames?: string[];
    publicTextSelectors: string[];
    valueSelectors: string[];
    screenshotSelectors: string[];
    maskSelectors: string[];
    startMode: 'NEXT_NAVIGATION' | 'CURRENT_DOCUMENT';
}
export interface PixelRect { x: number; y: number; width: number; height: number; }
export interface VisualPolicy {
    width: number; height: number;
    allowed: PixelRect[]; masked: PixelRect[];
    background: 'SOLID_32';
}
export function validateVisualPolicy(value: unknown): VisualPolicy {
    const v = object(value, ['width','height','allowed','masked','background']);
    number(v.width, 1, 4096); number(v.height, 1, 4096);
    if (v.width * v.height > 4194304 || v.background !== 'SOLID_32') fail('UI_VISUAL_LIMIT');
    for (const key of ['allowed', 'masked']) list(v[key], 256, r => {
        const x = object(r, ['x','y','width','height']);
        number(x.x,0,v.width); number(x.y,0,v.height);
        number(x.width,1,v.width); number(x.height,1,v.height);
        if(x.x+x.width>v.width || x.y+x.height>v.height) fail('UI_VISUAL_RECT_INVALID');
    });
    if (!v.allowed.length) fail('UI_VISUAL_ALLOWLIST_REQUIRED');
    return v as VisualPolicy;
}
export function validateCapturePolicy(value: unknown): CapturePolicy {
    const v=object(value, ['version','acknowledgeTestData','networkPaths','publicTextSelectors','valueSelectors','screenshotSelectors','maskSelectors','startMode'],['businessHeaderNames','mode','dataProtection']);
    if(v.version !== 'qagent.ui-capture-policy.v1' || v.acknowledgeTestData !== true) fail('UI_POLICY_ACK_REQUIRED');
    if(v.mode === undefined) v.mode = 'PROTECTED';
    enumValue(v.mode, ['PROTECTED','FULL_TEST']);
    if(v.dataProtection!==undefined&&(v.dataProtection!=='ENVIRONMENT_MANAGED'||v.mode!=='FULL_TEST'))fail('UI_POLICY_PROFILE_MISMATCH');
    enumValue(v.startMode, ['NEXT_NAVIGATION','CURRENT_DOCUMENT']);
    list(v.networkPaths,16,p=> { text(p,256); if(!p.startsWith('/') || p.startsWith('//') || /[?#%\\]/.test(p)) fail('UI_POLICY_PATH_INVALID'); });
    if(!v.networkPaths.length) fail('UI_POLICY_PATH_REQUIRED');
    if(v.businessHeaderNames!==undefined) list(v.businessHeaderNames,16,h=>{text(h,80);if(!/^[a-z][a-z0-9-]*$/.test(h) || (!isEnvironmentManagedPolicy(v)&&/(?:authorization|cookie|token|secret|api-?key|session|csrf)/i.test(h)))fail('UI_POLICY_HEADER_INVALID');});
    for(const field of ['publicTextSelectors','valueSelectors','screenshotSelectors','maskSelectors'])
        list(v[field],32,s=> { text(s,256); if(/[{}<>]|:has\(/i.test(s)) fail('UI_POLICY_SELECTOR_INVALID'); });
    return v as CapturePolicy;
}
