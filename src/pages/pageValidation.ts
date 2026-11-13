import { canonicalJson, fail, parseJsonStrict } from '../contracts/canonical';
import type { Metadata, PageProjectionChunk } from './pageTypes';
import { PAGE_PROJECTION_LIMITS as L, PAGE_PROJECTION_VERSION } from './pageTypes';
const invalid = (): never => fail('UI_PAGE_CONTRACT_INVALID', 400);
const encoder = new TextEncoder();
const keys = {
    documents: ['documentId','frameId','parentDocumentId','initialNavigationId','initialUrl','origin','observedSequence','startedOffsetUs','sourceHtmlRef','metadata'],
    resources: ['resourceId','documentId','interactionEventId','sourceKind','resourceType','resourceUrl','requestId','requestSequence','redirectHop','observedSequence','startedOffsetUs','endedOffsetUs','method','responseStatus','mimeType','bodyRef','bodyState','bodySource','metadata'],
    states: ['stateId','documentId','navigationId','checkpointEventId','checkpointId','stateSequence','observedSequence','pageUrl','triggerKind','captureStartedUs','captureFinishedUs','stability','domRef','htmlRef','layoutRef','formStateRef','resourceManifestRef','screenshotRef','mhtmlRef','metadata'],
    stateResources: ['stateId','resourceId','usageIndex','role','requiredForArchive','metadata'],
} as const;
function object(v: unknown, allowed: readonly string[]): Record<string, unknown> {
    if (!v || Array.isArray(v) || typeof v !== 'object') return invalid();
    const r = v as Record<string, unknown>;
    if (Object.keys(r).length !== allowed.length || allowed.some(k => !Object.hasOwn(r, k)) || Object.keys(r).some(k => !allowed.includes(k))) return invalid();
    return r;
}
export function pageId(v: unknown): string {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(v)) return invalid();
    return v;
}
function idOrNull(v: unknown): void { if (v !== null) pageId(v); }
export function pageOrdinal(v: unknown): number {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return invalid();
    return v;
}
function nullableOrdinal(v: unknown): void { if (v !== null) pageOrdinal(v); }
function member(v: unknown, values: readonly string[]): void { if (typeof v !== 'string' || !values.includes(v)) invalid(); }
function url(v: unknown): URL {
    if (typeof v !== 'string' || !v || v.length > 8192 || /[\x00-\x20\x7f]/.test(v)) return invalid();
    let parsed: URL; try { parsed = new URL(v); } catch { return invalid(); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return invalid();
    return parsed;
}
function metadata(v: unknown): Metadata {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid();
    if (encoder.encode(canonicalJson(v)).byteLength > L.metadataBytes) fail('UI_PAGE_METADATA_LIMIT', 413);
    return v as Metadata;
}
/** Strict internal envelope with a defensive deep copy. Sanitization and artifact-kind
 * validation stay at the existing/future ingest boundary; this is not an HTML sanitizer.
 * No recordHash, createdAt or tenant fields are accepted from the input records. */
export function validateProjectionChunk(input: unknown): PageProjectionChunk {
    const raw = object(input, ['version','documents','resources','states','stateResources']);
    if (raw.version !== PAGE_PROJECTION_VERSION) fail('UI_PAGE_PROJECTION_VERSION_UNSUPPORTED', 400);
    let count = 0;
    for (const key of Object.keys(keys)) {
        if (!Array.isArray(raw[key])) return invalid();
        count += (raw[key] as unknown[]).length;
    }
    if (count > L.recordsPerChunk) fail('UI_PAGE_CHUNK_LIMIT', 413);
    const text = canonicalJson(raw);
    if (encoder.encode(text).byteLength > L.chunkBytes) fail('UI_PAGE_CHUNK_LIMIT', 413);
    const chunk = parseJsonStrict(text) as unknown as PageProjectionChunk;
    for (const entity of Object.keys(keys) as (keyof typeof keys)[]) {
        for (const record of chunk[entity]) {
            const r = object(record, keys[entity]);
            metadata(r.metadata);
            for (const k of keys[entity]) if (k.endsWith('Id')) idOrNull(r[k]);
            for (const k of keys[entity]) if (k.endsWith('Ref')) idOrNull(r[k]);
        }
    }
    for (const d of chunk.documents) {
        pageId(d.documentId); pageId(d.frameId); pageId(d.initialNavigationId);
        if (d.parentDocumentId === d.documentId || url(d.initialUrl).origin !== d.origin) invalid();
        pageOrdinal(d.observedSequence); pageOrdinal(d.startedOffsetUs);
    }
    for (const r of chunk.resources) {
        pageId(r.resourceId); pageId(r.documentId);
        member(r.sourceKind,['NETWORK','INLINE','CSSOM','BLOB','DATA_URI']);
        member(r.resourceType,['DOCUMENT','STYLESHEET','SCRIPT','IMAGE','FONT','MEDIA','XHR','FETCH','OTHER']);
        member(r.bodyState,['COMPLETE','EMPTY','MISSING','OMITTED','TRUNCATED']);
        member(r.bodySource,['NETWORK','CACHE','CSSOM','INLINE','BLOB','DATA_URI','UNAVAILABLE']);
        if (r.resourceUrl !== null) url(r.resourceUrl); // blob/data bytes belong in an artifact, not a URL column.
        pageOrdinal(r.redirectHop); pageOrdinal(r.observedSequence); pageOrdinal(r.startedOffsetUs);
        nullableOrdinal(r.requestSequence); nullableOrdinal(r.endedOffsetUs);
        if (r.endedOffsetUs !== null && r.endedOffsetUs < r.startedOffsetUs) invalid();
        if (r.method !== null && (typeof r.method !== 'string' || !/^[A-Z!#$%&'*+.^_`|~-]{1,32}$/.test(r.method))) invalid();
        if (r.responseStatus !== null && (!Number.isInteger(r.responseStatus) || r.responseStatus < 100 || r.responseStatus > 599)) invalid();
        if (r.mimeType !== null && (typeof r.mimeType !== 'string' || !r.mimeType.length || r.mimeType.length > 255 || /[\r\n\x00]/.test(r.mimeType))) invalid();
        if (r.sourceKind === 'NETWORK' && (r.interactionEventId === null || r.requestId === null || r.requestSequence === null || r.method === null)) invalid();
        if (['COMPLETE','TRUNCATED'].includes(r.bodyState) !== (r.bodyRef !== null)) invalid();
        if (r.bodyRef !== null && r.bodySource === 'UNAVAILABLE') invalid();
    }
    for (const s of chunk.states) {
        for (const k of ['stateId','documentId','navigationId','checkpointEventId','checkpointId'] as const) pageId(s[k]);
        pageOrdinal(s.stateSequence); pageOrdinal(s.observedSequence); pageOrdinal(s.captureStartedUs); pageOrdinal(s.captureFinishedUs);
        if (s.captureFinishedUs < s.captureStartedUs) invalid();
        url(s.pageUrl); member(s.triggerKind,['INITIAL','NAVIGATION','ACTION','DOM_CHANGE','MANUAL','STOP']);
        member(s.stability,['STABLE','UNSTABLE','INTERRUPTED']);
    }
    for (const link of chunk.stateResources) {
        pageId(link.stateId); pageId(link.resourceId); pageOrdinal(link.usageIndex);
        member(link.role,['DOCUMENT','APPEARANCE','APP_CODE','DATA','FONT','MEDIA','OTHER']);
        if (typeof link.requiredForArchive !== 'boolean') invalid();
    }
    return chunk;
}
