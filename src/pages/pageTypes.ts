/** PC.1 internal projection types. These are NOT browser/wire v2 contracts.
 * Caller must derive Scope from existing authority. No HTTP endpoint is added.
 * Metadata is a bounded index; document/resource bytes remain in ui_artifacts/R2.
 */
import type { Json } from '../contracts/canonical';
export const PAGE_PROJECTION_VERSION = 'qagent.ui-page-projection.v1' as const;
export const PAGE_PROJECTION_LIMITS = Object.freeze({
    recordsPerChunk: 128, chunkBytes: 512 * 1024, metadataBytes: 32768,
    statementsPerBatch: 20, readLimit: 50, maxReadLimit: 100,
});
export type Metadata = { [key: string]: Json };
export type ResourceSource = 'NETWORK' | 'INLINE' | 'CSSOM' | 'BLOB' | 'DATA_URI';
export type ResourceType = 'DOCUMENT' | 'STYLESHEET' | 'SCRIPT' | 'IMAGE' | 'FONT' | 'MEDIA' | 'XHR' | 'FETCH' | 'OTHER';
export type BodyState = 'COMPLETE' | 'EMPTY' | 'MISSING' | 'OMITTED' | 'TRUNCATED';
export type BodySource = 'NETWORK' | 'CACHE' | 'CSSOM' | 'INLINE' | 'BLOB' | 'DATA_URI' | 'UNAVAILABLE';
export interface PageDocument {
    documentId: string; frameId: string; parentDocumentId: string | null;
    initialNavigationId: string; initialUrl: string; origin: string;
    observedSequence: number; startedOffsetUs: number;
    sourceHtmlRef: string | null; metadata: Metadata;
}
export interface PageResource {
    resourceId: string; documentId: string; interactionEventId: string | null;
    sourceKind: ResourceSource; resourceType: ResourceType; resourceUrl: string | null;
    requestId: string | null; requestSequence: number | null; redirectHop: number;
    observedSequence: number; startedOffsetUs: number; endedOffsetUs: number | null;
    method: string | null; responseStatus: number | null; mimeType: string | null;
    bodyRef: string | null; bodyState: BodyState; bodySource: BodySource; metadata: Metadata;
}
export interface PageState {
    stateId: string; documentId: string; navigationId: string;
    checkpointEventId: string; checkpointId: string; stateSequence: number; observedSequence: number;
    pageUrl: string; triggerKind: 'INITIAL' | 'NAVIGATION' | 'ACTION' | 'DOM_CHANGE' | 'MANUAL' | 'STOP';
    captureStartedUs: number; captureFinishedUs: number; stability: 'STABLE' | 'UNSTABLE' | 'INTERRUPTED';
    domRef: string | null; htmlRef: string | null; layoutRef: string | null;
    formStateRef: string | null; resourceManifestRef: string | null;
    screenshotRef: string | null; mhtmlRef: string | null; metadata: Metadata;
}
export interface PageStateResource {
    stateId: string; resourceId: string; usageIndex: number;
    role: 'DOCUMENT' | 'APPEARANCE' | 'APP_CODE' | 'DATA' | 'FONT' | 'MEDIA' | 'OTHER';
    requiredForArchive: boolean; metadata: Metadata;
}
export interface PageProjectionChunk {
    version: typeof PAGE_PROJECTION_VERSION;
    documents: PageDocument[]; resources: PageResource[];
    states: PageState[]; stateResources: PageStateResource[];
}
export type PageEntity = 'documents' | 'resources' | 'states' | 'stateResources';
export interface ProjectionCounts { documents: number; resources: number; states: number; stateResources: number; }
export interface ProjectionReceipt {
    status: 'PERSISTED'; projectionVersion: typeof PAGE_PROJECTION_VERSION;
    captureId: string; chunkHash: string; counts: ProjectionCounts;
    /** Means these records match D1, NOT that the whole capture has been projected. */
    coverage: 'THIS_CHUNK_ONLY';
}
export interface PageCursor { order: number; id: string; }
export interface PageQuery { limit?: number; after?: PageCursor; }
export interface PageResult<T> { items: T[]; nextCursor: PageCursor | null; }
export type Stored<T> = T & { recordHash: string; createdAt: number };
export interface ActionRecord {
    eventId: string; persistedSequence: number; observedSequence: number | null;
    orderBasis: 'OBSERVED' | 'LEGACY_PERSISTED'; event: Json;
}
export interface NetworkRecord extends Stored<PageResource> { event: Json; }
export interface StateResourceRecord extends Stored<PageStateResource> {
    resource: Stored<PageResource>;
    artifact: { artifactId: string; sha256: string; byteLength: number; status: string } | null;
}
