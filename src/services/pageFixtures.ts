/** Derived observed evidence only. This module never fetches an application, evaluates captured
 * markup, synthesizes responses, executes a test, or changes its source/baseline. */
import { canonicalJson, digestJson, fail } from '../contracts/canonical';
import { type UiEvent } from '../contracts/uiCapture';
import { PAGE_OBSERVED_PRIVACY, type PageArtifactInput, type ResourceManifest } from '../contracts/uiPageCopy';
import { validateObservedPageEvidence } from '../contracts/pageObservedEvidence';
import { type PageSourceRoot } from '../contracts/pageSource';
import { type AssemblyProfile, type SourceRef } from '../protocol';

export const OBSERVED_FIXTURE_POLICY = 'qagent_ui_observed_fixture_match_v1';
type Payload = Record<string, any>;
type Status = 'READY' | 'PARTIAL' | 'UNAVAILABLE';
interface Dimension { status: Status; reasonCodes: string[]; }
interface Context { documentId: string; navigationId: string; frameId: string; stepId: string | null; }
export interface ObservedPageInput {
  root: PageSourceRoot; ref: SourceRef; profile: AssemblyProfile; events: UiEvent[];
  descriptors: Map<string, { descriptor: PageArtifactInput; status: string }>;
  verified: Set<string>; manifests: Map<string, ResourceManifest>;
  documentArtifacts: Map<string, string>;
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const unique = (values: string[]): string[] => [...new Set(values)].sort(compare);
const context = (p: Payload): Context => ({ documentId: p.documentId, navigationId: p.navigationId, frameId: p.frameId, stepId: p.stepId });
const dimension = (available: number, total: number, reasons: string[]): Dimension => ({
  status: available === 0 ? 'UNAVAILABLE' : available === total && reasons.length === 0 ? 'READY' : 'PARTIAL',
  reasonCodes: unique(reasons),
});
const bounded = (size: number): void => { if (size > 10000) fail('UI_PAGE_DERIVED_INDEX_LIMIT', 413); };
function insertSame(map: Map<string, Payload>, key: string, value: Payload, code: string): void {
  const before = map.get(key);
  if (before && canonicalJson(before) !== canonicalJson(value)) fail(code, 409);
  if (!before) { map.set(key, value); bounded(map.size); }
}

/** A cache claim is not proof by itself. Independently bind the representation to a completed
 * NETWORK 200 interaction in this immutable capture, before the revalidation was dispatched. */
export async function verifyObservedCacheEvidence(captureId: string, events: UiEvent[]): Promise<Map<string, UiEvent>> {
  await validateObservedPageEvidence(captureId, events);
  const byId = new Map(events.map(e => [e.eventId, e]));
  const sources = new Map<string, UiEvent>();
  for (const e of events) {
    if (e.kind !== 'INTERACTION') continue;
    const p = e.payload as Payload, response = p.response;
    if (response.bodySource !== 'CACHE') continue;
    // Physical persistence order is not request dispatch order; the shared validator
    // verifies requestSequence and completion time, plus matching context and bytes.
    sources.set(e.eventId, byId.get(response.cacheEvidence.representationId)!);
  }
  return sources;
}

export async function observedPageIndex(input: ObservedPageInput): Promise<Record<string, any>> {
  const { root, ref, profile, events, descriptors, verified, manifests, documentArtifacts } = input;
  const artifact = (artifactId: string | null): Payload | null => {
    if (artifactId === null) return null;
    const row = descriptors.get(artifactId);
    if (!row || row.status !== 'FINALIZED' || !verified.has(artifactId)) fail('UI_PAGE_ARTIFACT_REF_UNAVAILABLE', 409);
    const d = row.descriptor;
    if (d.privacy.dataOrigin !== 'OBSERVED_SANITIZED' || d.privacy.policyVersion !== PAGE_OBSERVED_PRIVACY)
      fail('UI_PAGE_SOURCE_ORIGIN_MISMATCH', 409);
    return { artifactId, kind: d.kind, sha256: d.sha256, byteLength: d.byteLength, contentType: d.contentType,
      representation: d.representation, completeness: d.completeness, transformations: d.privacy.transformations.length };
  };
  const cacheSources = await verifyObservedCacheEvidence(root.captureId, events);
  const eventById = new Map(events.map(e => [e.eventId, e]));
  const documents = new Map<string, Payload>(), resources = new Map<string, Payload>(), links = new Map<string, Payload>();
  for (const m of manifests.values()) {
    for (const d of m.documents) {
      if (!root.capture.origins.includes(d.origin)) fail('UI_PAGE_DOCUMENT_SCOPE_MISMATCH', 409);
      insertSame(documents, d.documentId, { documentId: d.documentId, frameId: d.frameId, parentDocumentId: d.parentDocumentId,
        initialNavigationId: d.initialNavigationId, initialUrl: d.initialUrl, origin: d.origin,
        observedSequence: d.observedSequence, startedOffsetUs: d.startedOffsetUs, sourceHtmlRef: d.sourceHtmlRef,
        evidenceSource: 'RESOURCE_MANIFEST' }, 'UI_PAGE_DOCUMENT_CONFLICT');
      if (d.sourceHtmlRef !== null && artifact(d.sourceHtmlRef)?.kind !== 'DOCUMENT_HTML') fail('UI_PAGE_MANIFEST_KIND_MISMATCH', 409);
    }
    for (const r of m.resources) {
      const record = { resourceId: r.resourceId, documentId: r.documentId, interactionEventId: r.interactionEventId,
        sourceKind: r.sourceKind, resourceType: r.resourceType, resourceUrl: r.resourceUrl, requestId: r.requestId,
        requestSequence: r.requestSequence, redirectHop: r.redirectHop, observedSequence: r.observedSequence,
        startedOffsetUs: r.startedOffsetUs, endedOffsetUs: r.endedOffsetUs, method: r.method, responseStatus: r.responseStatus,
        mimeType: r.mimeType, bodyRef: r.bodyRef, bodyState: r.bodyState, bodySource: r.bodySource };
      insertSame(resources, r.resourceId, record, 'UI_PAGE_RESOURCE_CONFLICT');
      if (r.bodyRef !== null) artifact(r.bodyRef);
      if (r.sourceKind === 'NETWORK') {
        const e = eventById.get(r.interactionEventId), p = e?.payload as Payload | undefined;
        if (!e || e.kind !== 'INTERACTION' || !p || p.resourceId !== r.resourceId || p.documentId !== r.documentId
          || p.requestId !== r.requestId || p.requestSequence !== r.requestSequence || p.request.method !== r.method
          || p.redirectHop !== r.redirectHop || p.resourceType !== r.resourceType || p.observedSequence !== r.observedSequence
          || p.startedOffsetUs !== r.startedOffsetUs || p.finishedOffsetUs !== r.endedOffsetUs
          || p.response.networkStatus !== r.responseStatus || p.response.bodyRef !== r.bodyRef
          || p.response.bodyState !== r.bodyState || p.response.bodySource !== r.bodySource)
          fail('UI_PAGE_RESOURCE_EVENT_MISMATCH', 409);
        if (r.resourceUrl !== null) {
          const url = new URL(r.resourceUrl);
          if (url.origin !== p.request.origin || url.pathname !== p.request.path
            || canonicalJson([...url.searchParams]) !== canonicalJson(p.request.query)) fail('UI_PAGE_RESOURCE_EVENT_MISMATCH', 409);
        }
      }
    }
    for (const l of m.stateResources) insertSame(links, canonicalJson([l.stateId, l.usageIndex, l.resourceId]), {
      stateId: l.stateId, resourceId: l.resourceId, usageIndex: l.usageIndex, role: l.role,
      requiredForArchive: l.requiredForArchive, association: 'OBSERVED_RESOURCE_IN_DOCUMENT_WINDOW', causalProof: false,
    }, 'UI_PAGE_STATE_RESOURCE_CONFLICT');
  }
  const actionEvents = events.filter(e => e.kind === 'ACTION');
  const interactionEvents = events.filter(e => e.kind === 'INTERACTION')
    .sort((a, b) => (a.payload as Payload).requestSequence - (b.payload as Payload).requestSequence || compare(a.eventId, b.eventId));
  const checkpointEvents = events.filter(e => e.kind === 'CHECKPOINT');
  const states = new Map<string, Payload>();
  for (const e of checkpointEvents) {
    const p = e.payload as Payload, page = p.pageCapture;
    if (states.has(page.stateId)) fail('UI_PAGE_STATE_CONFLICT', 409);
    for (const id of [page.domRef, page.layoutRef, page.formStateRef]) {
      if (id !== null && documentArtifacts.get(id) !== p.documentId) fail('UI_PAGE_STATE_ARTIFACT_CONTEXT_MISMATCH', 409);
    }
    const reasons = [...page.missing];
    if (!page.domRef) reasons.push('UI_PAGE_DOM_REFERENCE_MISSING');
    if (page.stability !== 'STABLE') reasons.push('UI_PAGE_STATE_UNSTABLE');
    states.set(page.stateId, { stateId: page.stateId, checkpointId: p.checkpointId, checkpointEventId: e.eventId,
      ...context(p), stateSequence: page.stateSequence, observedSequence: page.observedSequence, url: page.url,
      triggerKind: page.triggerKind ?? null,
      captureStartedUs: page.captureStartedUs, captureFinishedUs: page.captureFinishedUs, stability: page.stability,
      domRef: page.domRef, htmlRef: page.htmlRef, layoutRef: page.layoutRef, formStateRef: page.formStateRef,
      resourceManifestRef: page.resourceManifestRef, screenshotRef: page.screenshotRef,
      structuralReference: { status: page.domRef ? 'AVAILABLE' : 'UNAVAILABLE', stable: page.stability === 'STABLE' },
      visualReference: { status: page.screenshotRef ? 'AVAILABLE' : 'UNAVAILABLE', stable: page.stability === 'STABLE' },
      reasonCodes: unique(reasons), assertionsGenerated: false });
  }
  for (const l of links.values()) {
    const state = states.get(l.stateId), resource = resources.get(l.resourceId);
    if (!state || !resource || state.documentId !== resource.documentId) fail('UI_PAGE_STATE_RESOURCE_MISMATCH', 409);
  }
  // Document identity observed in events remains useful even when no checkpoint was collected.
  // No URL, HTML, screenshot or state is invented for these incomplete occurrences.
  for (const e of events) {
    const p = e.payload as Payload;
    if (e.kind === 'GAP' || documents.has(p.documentId)) continue;
    const initial = p.documentId === root.capture.descriptor.documentId;
    documents.set(p.documentId, { documentId: p.documentId, frameId: p.frameId, parentDocumentId: null,
      initialNavigationId: null, initialUrl: initial ? root.capture.descriptor.entryUrl : null,
      origin: initial ? new URL(root.capture.descriptor.entryUrl).origin : null, observedSequence: null,
      startedOffsetUs: null, sourceHtmlRef: null, evidenceSource: initial ? 'CAPTURE_DESCRIPTOR_AND_EVENTS' : 'EVENT_CONTEXT_ONLY' });
  }
  const actions = actionEvents.map(e => {
    const p = e.payload as Payload, reasons: string[] = [];
    if (['CLICK', 'FILL', 'SELECT', 'CHECK'].includes(p.type) && p.target?.observedMatchCount !== 1) reasons.push('UI_LOCATOR_NOT_UNIQUE');
    if (p.target?.framePath?.length) reasons.push('UI_FRAME_PATH_UNSUPPORTED');
    if (['FILL', 'SELECT'].includes(p.type) && !p.input?.valueRef) reasons.push('UI_ACTION_VALUE_UNAVAILABLE');
    if (!p.stateBeforeId && !p.stateAfterId) reasons.push('UI_ACTION_STATE_LINK_UNAVAILABLE');
    for (const id of [p.stateBeforeId, p.stateAfterId]) {
      if (id && !states.has(id)) reasons.push('UI_ACTION_STATE_REFERENCE_MISSING');
    }
    return { actionId: p.actionId, eventId: e.eventId, persistedSequence: e.sequence, observedSequence: p.observedSequence,
      ...context(p), relativeTimeUs: p.relativeTimeUs, type: p.type, target: p.target ?? null,
      destination: p.destination ?? null, inputValueRef: p.input?.valueRef ?? null, checked: p.checked ?? null,
      position: p.position ?? null, scrollTarget: p.scrollTarget ?? null, clickCount: p.clickCount ?? null,
      stateBeforeId: p.stateBeforeId, stateAfterId: p.stateAfterId, reasonCodes: unique(reasons), observedOnly: true };
  });
  const occurrences = new Map<string, number>(), fixtures: Payload[] = [], interactions: Payload[] = [];
  for (const e of interactionEvents) {
    const p = e.payload as Payload;
    if (!root.capture.origins.includes(p.request.origin)) fail('UI_PAGE_INTERACTION_SCOPE_MISMATCH', 409);
    const requestBody = artifact(p.request.bodyRef), requestHeaders = artifact(p.request.businessHeadersRef);
    const responseBody = artifact(p.response.bodyRef), networkHeaders = artifact(p.response.headersRef);
    const source = cacheSources.get(e.eventId), representation = source ? source.payload as Payload : p;
    const responseHeaders = source ? artifact(representation.response.headersRef) : networkHeaders;
    const request = { logicalServiceKey: p.logicalServiceKey, method: p.request.method, origin: p.request.origin,
      path: p.request.path, query: p.request.query, bodyRef: p.request.bodyRef, bodySha256: requestBody?.sha256 ?? null,
      businessHeadersRef: p.request.businessHeadersRef, businessHeadersSha256: requestHeaders?.sha256 ?? null };
    const fingerprint = await digestJson({ service: p.logicalServiceKey, origin: request.origin, method: request.method,
      path: request.path, query: request.query, bodyHash: request.bodySha256, businessHeadersHash: request.businessHeadersSha256 });
    const matchingContext = { ...context(p), requestFingerprint: fingerprint };
    const occurrenceKey = await digestJson({ scope: ref.scope, captureId: root.captureId, ...matchingContext });
    const occurrence = occurrences.get(occurrenceKey) ?? 0;
    if (p.classification === 'BUSINESS_API') occurrences.set(occurrenceKey, occurrence + 1);
    const reasons: string[] = [];
    if (!['COMPLETE', 'EMPTY'].includes(p.response.bodyState)) reasons.push('UI_FIXTURE_RESPONSE_' + p.response.bodyState);
    if (p.response.replayStatus === null) reasons.push('UI_FIXTURE_STATUS_UNAVAILABLE');
    if (p.response.networkStatus === 304 && !source) reasons.push('UI_CACHE_BODY_UNAVAILABLE');
    if (p.issues.includes('UI_REQUEST_BODY_UNAVAILABLE')) reasons.push('UI_FIXTURE_REQUEST_BODY_UNAVAILABLE');
    if (requestBody?.completeness !== undefined && requestBody.completeness !== 'COMPLETE') reasons.push('UI_FIXTURE_REQUEST_BODY_INCOMPLETE');
    if (p.consumption.maximum !== 1 || p.consumption.minimum > 1) reasons.push('UI_FIXTURE_CONSUMPTION_NOT_SINGLE_OCCURRENCE');
    const shared = { eventId: e.eventId, entryId: p.entryId, requestId: p.requestId, resourceId: p.resourceId,
      requestSequence: p.requestSequence, observedSequence: p.observedSequence, redirectHop: p.redirectHop,
      ...context(p), classification: p.classification, resourceType: p.resourceType,
      startedOffsetUs: p.startedOffsetUs, finishedOffsetUs: p.finishedOffsetUs, correlationBasis: p.correlationBasis,
      request, response: { networkStatus: p.response.networkStatus, replayStatus: p.response.replayStatus,
        bodyState: p.response.bodyState, bodySource: p.response.bodySource, bodyRef: p.response.bodyRef,
        bodySha256: p.response.bodyHash, byteLength: responseBody?.byteLength ?? (p.response.bodyState === 'EMPTY' ? 0 : null), contentType: responseBody?.contentType ?? null,
        headersRef: responseHeaders?.artifactId ?? null, headersSha256: responseHeaders?.sha256 ?? null,
        networkHeadersRef: networkHeaders?.artifactId ?? null, cacheEvidence: p.response.cacheEvidence,
        representationEventId: source?.eventId ?? e.eventId, cacheEvidenceVerified: !!source },
      observedIssueCodes: unique(p.issues) };
    interactions.push(shared);
    if (!resources.has(p.resourceId)) {
      resources.set(p.resourceId, { resourceId: p.resourceId, documentId: p.documentId, interactionEventId: e.eventId,
        sourceKind: 'NETWORK', resourceType: p.resourceType, resourceUrl: null, requestId: p.requestId,
        requestSequence: p.requestSequence, redirectHop: p.redirectHop, observedSequence: p.observedSequence,
        startedOffsetUs: p.startedOffsetUs, endedOffsetUs: p.finishedOffsetUs, method: p.request.method,
        responseStatus: p.response.networkStatus, mimeType: responseBody?.contentType ?? null,
        bodyRef: p.response.bodyRef, bodyState: p.response.bodyState, bodySource: p.response.bodySource });
      bounded(resources.size);
    }
    if (p.classification !== 'BUSINESS_API') continue;
    fixtures.push({ fixtureId: 'uif_' + await digestJson({ captureId: root.captureId, eventId: e.eventId, policy: OBSERVED_FIXTURE_POLICY }),
      ...shared, match: { policyVersion: OBSERVED_FIXTURE_POLICY, ...matchingContext, occurrenceKey,
        occurrenceIndex: occurrence, orderBasis: 'OBSERVED_REQUEST_DISPATCH', causalProof: false },
      consumption: { ...p.consumption, reuseAfterExhaustion: false, liveFallback: false },
      availability: reasons.length === 0 ? 'READY' : 'UNAVAILABLE', reasonCodes: unique(reasons),
      meaning: 'OBSERVED_RESPONSE_FIXTURE_NOT_AN_EXPECTED_BUSINESS_RULE', testPassed: false });
  }
  const allReasons = unique([...root.capture.descriptor.issues, ...root.capture.completion.issues,
    ...events.filter(e => e.kind === 'GAP').map(e => (e.payload as Payload).code)]);
  const fixtureReasons = unique(fixtures.flatMap(f => f.reasonCodes));
  if (!fixtures.length) fixtureReasons.push('UI_NO_NETWORK_FIXTURES');
  const actionReasons = unique(actions.flatMap(a => a.reasonCodes));
  if (!actions.length) actionReasons.push('UI_NO_ACTIONS');
  const stateList = [...states.values()].sort((a, b) => a.stateSequence - b.stateSequence || compare(a.stateId, b.stateId));
  const structural = stateList.filter(s => s.structuralReference.status === 'AVAILABLE');
  const stable = structural.filter(s => s.structuralReference.stable);
  const visual = stateList.filter(s => s.visualReference.status === 'AVAILABLE' && s.visualReference.stable);
  const documentsWithState = new Set(stateList.map(s => s.documentId));
  const documentsWithoutState = [...documents.keys()].filter(id => !documentsWithState.has(id)).sort(compare);
  const stateReasons = unique(stateList.flatMap(s => s.reasonCodes.filter((c: string) => !c.includes('VISUAL') && !c.includes('SCREENSHOT'))));
  if (!stateList.length) stateReasons.push('UI_NO_CHECKPOINT');
  if (documentsWithoutState.length) stateReasons.push('UI_DOCUMENT_WITHOUT_CHECKPOINT');
  const visualReasons = unique(stateList.flatMap(s => s.reasonCodes.filter((c: string) => c.includes('VISUAL') || c.includes('SCREENSHOT'))));
  if (visual.length < stateList.length || !stateList.length) visualReasons.push('UI_VISUAL_CHECKPOINT_UNAVAILABLE');
  const bootstrapReasons = profile.bootstrap.mode === 'UNAVAILABLE' ? ['UI_BOOTSTRAP_UNAVAILABLE'] : [];
  const provenanceReasons = root.capture.descriptor.sourceBuildRef ? [] : ['SOURCE_BUILD_UNKNOWN'];
  const readyFixtures = fixtures.filter(f => f.availability === 'READY').length;
  const dimensions = { integrity: { status: 'READY', reasonCodes: [] },
    actions: dimension(actions.filter(a => !a.reasonCodes.length).length, actions.length, actionReasons),
    network: dimension(readyFixtures, fixtures.length, fixtureReasons),
    bootstrap: dimension(bootstrapReasons.length ? 0 : 1, 1, bootstrapReasons),
    provenance: dimension(provenanceReasons.length ? 0 : 1, 1, provenanceReasons),
    semantic: dimension(stable.length, stateList.length, stateReasons),
    visual: dimension(visual.length, stateList.length, visualReasons) };
  const orderedDocuments = [...documents.values()].sort((a, b) => compare(a.documentId, b.documentId));
  const orderedResources = [...resources.values()].sort((a, b) => (a.observedSequence - b.observedSequence) || compare(a.resourceId, b.resourceId));
  const orderedLinks = [...links.values()].sort((a, b) => compare(a.stateId, b.stateId) || a.usageIndex - b.usageIndex || compare(a.resourceId, b.resourceId));
  return { documents: orderedDocuments, states: stateList, resources: orderedResources, stateResources: orderedLinks,
    actions, interactions, fixtures,
    matching: { version: OBSERVED_FIXTURE_POLICY, queryPairs: 'PRESERVE_ORDER_AND_DUPLICATES', requestBody: 'EXACT_STORED_BYTES_SHA256',
      businessHeaders: 'EXACT_STORED_BYTES_SHA256', context: 'DOCUMENT_NAVIGATION_FRAME_STEP',
      occurrence: 'OBSERVED_REQUEST_SEQUENCE_WITHIN_CONTEXT', unmatchedRequest: 'BLOCK', exhaustedFixture: 'BLOCK', liveBusinessFallback: false },
    applicationResources: { strategy: 'EXECUTE_TARGET_BUILD', observedCssJsAreFixtures: false, archiveExecutionAllowed: false },
    qualification: { overall: 'NEEDS_ATTENTION', dimensions,
      uses: { archiveInspection: { status: 'READY', reasonCodes: [], meaning: 'REFERENCED_BYTES_VERIFIED_NOT_RENDERED' },
        fixtureMocks: dimensions.network, structuralReference: dimension(structural.length, stateList.length,
          structural.length ? [] : ['UI_PAGE_DOM_REFERENCE_MISSING']), visualReference: dimensions.visual,
        testDesignEvidence: { status: actions.length || fixtures.length || stateList.length ? 'PARTIAL' : 'UNAVAILABLE',
          reasonCodes: ['UI_TEST_DESIGN_NOT_GENERATED'], assertionsGenerated: false },
        journeyExecution: { status: 'UNAVAILABLE', reasonCodes: unique(['UI_PAGE_REPLAY_NOT_IMPLEMENTED', ...actionReasons,
          ...fixtureReasons, ...stateReasons, ...bootstrapReasons, ...provenanceReasons]) } },
      reasonCodes: unique(['UI_PAGE_REPLAY_NOT_IMPLEMENTED', ...allReasons, ...fixtureReasons, ...actionReasons,
        ...stateReasons, ...visualReasons, ...bootstrapReasons, ...provenanceReasons]),
      counts: { actions: actions.length, interactions: interactions.length, checkpoints: stateList.length,
        referencedArtifacts: verified.size, verifiedArtifacts: verified.size, businessFixtures: fixtures.length,
        usableFixtures: readyFixtures, unavailableFixtures: fixtures.length - readyFixtures },
      coverage: { documentOccurrences: documents.size, documentOccurrencesWithCheckpoint: documentsWithState.size,
        documentsWithoutCheckpoint: documentsWithoutState, stableCheckpoints: stable.length,
        incompleteCheckpoints: stateList.filter(s => s.stability !== 'STABLE' || s.reasonCodes.length).length,
        unreferencedArtifacts: descriptors.size - verified.size,
        pendingArtifacts: [...descriptors.values()].filter(a => a.status !== 'FINALIZED').length },
      limitations: { evidenceOnly: true, temporalAssociationIsNotCausality: true, fullApplicationCoverageProven: false,
        bootstrapReferenceVerified: false, baselineIsNotBusinessSpecification: true },
      eligibleModes: [], meaning: 'OBSERVED_PAGE_EVIDENCE_WITH_FIXTURES_NOT_EXECUTED',
      uiTestPassed: false, apiEvidencePromoted: false } };
}
