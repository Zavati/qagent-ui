const path = require('node:path');
const build = process.env.QAGENT_UI_BUILD;
const c = require(path.join(build, 'src/contracts/canonical.js'));
const pc = require(path.join(build, 'src/contracts/uiPageCopy.js'));
const source = require(path.join(build, 'src/contracts/pageSource.js'));
const protocol = require(path.join(build, 'src/protocol.js'));
const { assemblePageEvidence } = require(path.join(build, 'src/services/pageEvidence.js'));
const support = require('./support.cjs');

async function fixture(options = {}) {
  const scope = { organizationId: 'org_observed', projectId: 'prj_observed', environmentId: 'env_test' };
  const captureId = 'uic_observed_sample', doc = 'doc_observed', nav = 'nav_observed';
  const artifacts = [], bytes = new Map(), events = [];
  const policy = { version: 'qagent.ui-capture-policy.v1', mode: 'FULL_TEST', acknowledgeTestData: true,
    networkPaths: ['/'], businessHeaderNames: ['accept'], publicTextSelectors: ['main'], valueSelectors: [],
    screenshotSelectors: [], maskSelectors: [], startMode: 'NEXT_NAVIGATION' };
  const descriptor = { contractVersion: pc.PAGE_CONTRACTS.capture, operationId: 'op_start', dataOrigin: 'OBSERVED_SANITIZED',
    documentId: doc, entryUrl: 'https://app.example.test/items', sourceBuildRef: options.sourceBuildRef ?? null,
    issues: options.sourceBuildRef ? [] : ['SOURCE_BUILD_UNKNOWN'], capturePolicy: policy,
    limitsSnapshot: { artifactBytes: 16777216, artifactsPerCapture: 512, captureArtifactBytes: 268435456 } };
  const completion = { contractVersion: pc.PAGE_CONTRACTS.capture, operationId: 'op_stop', outcome: 'PARTIAL', issues: ['UI_VISUAL_CHECKPOINT_UNAVAILABLE'] };
  async function artifact(kind, value, name, mime = 'application/json') {
    const binary = value instanceof Uint8Array;
    const data = binary ? Buffer.from(value) : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    const artifactId = name ?? 'uia_' + artifacts.length;
    const d = { contractVersion: pc.PAGE_CONTRACTS.artifact, operationId: 'op_' + artifactId, kind,
      contentType: mime, originalContentType: mime, storedEncoding: 'identity', representation: binary ? 'BINARY' : mime === 'application/json' ? 'STRUCTURED_JSON' : 'UTF8_TEXT',
      captureMethod: ['HTTP_REQUEST_BODY', 'HTTP_RESPONSE_BODY', 'HEADERS_JSON'].includes(kind) ? 'NETWORK_BODY' : kind === 'SCREENSHOT_PNG' ? 'SCREENSHOT' : kind === 'RESOURCE_MANIFEST_JSON' ? 'MANIFEST' : 'DOM_SNAPSHOT',
      completeness: 'COMPLETE', byteLength: data.length, sha256: await c.sha256(new Uint8Array(data)),
      privacy: { policyVersion: pc.PAGE_OBSERVED_PRIVACY, dataOrigin: 'OBSERVED_SANITIZED', transformations: [] } };
    artifacts.push({ artifactId, descriptor: d, status: 'FINALIZED' }); bytes.set(artifactId, data);
    return { artifactId, descriptor: d, bytes: data };
  }
  function add(kind, payload, name) {
    const sequence = events.length;
    const event = { eventId: name ?? 'uie_' + sequence, sequence, kind, payload: { ...payload }, contentHash: '' };
    if (['ACTION', 'CHECKPOINT'].includes(kind)) event.payload.sequence = sequence;
    events.push(event); return event;
  }
  const common = (ordinal, time = ordinal * 10000) => ({ documentId: doc, navigationId: nav, frameId: 'frame_main', stepId: 'step_nav',
    observedSequence: ordinal, relativeTimeUs: time, relativeTimeMs: Math.floor(time / 1000) });
  add('ACTION', { contractVersion: pc.PAGE_CONTRACTS.action, ...common(0), actionId: 'act_nav', type: 'NAVIGATE',
    destination: descriptor.entryUrl, stateBeforeId: null, stateAfterId: options.checkpoint ? 'state_one' : null });
  const body = await artifact('HTTP_RESPONSE_BODY', options.body ?? { error: 'Invalid request', code: 'BAD_DATA' }, 'uia_body');
  const headers = await artifact('HEADERS_JSON', [['content-type', 'application/json']], 'uia_headers');
  const network = add('INTERACTION', { contractVersion: pc.PAGE_CONTRACTS.interaction, ...common(1), entryId: 'entry_one',
    requestId: 'request_one', logicalServiceKey: 'captured_origin', requestSequence: 0, redirectHop: 0, resourceId: 'res_one',
    resourceType: 'XHR', classification: 'BUSINESS_API', startedOffsetUs: 10000, finishedOffsetUs: 11000,
    request: { method: 'GET', origin: 'https://app.example.test', path: '/api/items', query: [['tag', 'one'], ['tag', 'two']], bodyRef: null, businessHeadersRef: null },
    response: { status: options.status ?? 400, networkStatus: options.status ?? 400, replayStatus: options.status ?? 400,
      bodyRef: body.artifactId, bodyHash: body.descriptor.sha256, headersRef: headers.artifactId, completeness: 'COMPLETE',
      bodyState: 'COMPLETE', bodySource: 'NETWORK', cacheEvidence: null },
    consumption: { required: true, minimum: 1, maximum: 1 }, correlationBasis: 'NAVIGATION_AND_STEP_WINDOW', issues: [] }, 'uie_network');
  let dom, checkpoint;
  if (options.checkpoint) {
    dom = await artifact('DOM_SNAPSHOT_JSON', { contractVersion: 'qagent.ui-dom-snapshot.v1', documentId: doc,
      nodes: [{ nodeId: 'node_main', parentId: null, nodeType: 1, name: 'MAIN', attributes: [], text: '' }] }, 'uia_dom');
    checkpoint = add('CHECKPOINT', { contractVersion: pc.PAGE_CONTRACTS.checkpoint, ...common(2, 29000), checkpointId: 'check_one',
      stability: { kind: 'DOM_QUIET', durationMs: 500 }, functionalRef: dom.artifactId, semanticRef: dom.artifactId,
      screenshotRef: null, modalities: { functional: 'AVAILABLE', semantic: 'AVAILABLE', visual: 'UNAVAILABLE' },
      issues: ['UI_VISUAL_CHECKPOINT_UNAVAILABLE'], pageCapture: { contractVersion: 'qagent.ui-page-state.v1', stateId: 'state_one',
        stateSequence: 0, observedSequence: 2, triggerKind: 'DOM_CHANGE', url: descriptor.entryUrl, captureStartedUs: 29000, captureFinishedUs: 30000,
        stability: options.unstable ? 'UNSTABLE' : 'STABLE', domRef: dom.artifactId, htmlRef: null, layoutRef: null,
        formStateRef: null, resourceManifestRef: null, screenshotRef: null, mhtmlRef: null, missing: ['UI_VISUAL_CHECKPOINT_UNAVAILABLE'] } });
  }
  let root, ref, parts;
  async function rehash() {
    let chain = '0'.repeat(64);
    for (let i = 0; i < events.length; i++) {
      const e = events[i]; e.sequence = i;
      if (['ACTION', 'CHECKPOINT'].includes(e.kind)) e.payload.sequence = i;
      const { contentHash, ...raw } = e; e.contentHash = await c.digestJson(raw); chain = await c.digestJson([chain, e.sequence, e.contentHash]);
    }
    const revision = await c.digestJson(completion);
    const reachable = new Set();
    function walk(id) {
      if (reachable.has(id)) return; reachable.add(id);
      const a = artifacts.find(a => a.artifactId === id);
      if (a?.descriptor.kind === 'RESOURCE_MANIFEST_JSON') {
        const m = JSON.parse(bytes.get(id)); m.parts.forEach(walk); m.artifacts.forEach(a => walk(a.artifactId));
      }
    }
    events.flatMap(pc.pageEventRefs).forEach(walk);
    parts = [];
    for (const [kind, items] of [['ARTIFACTS', artifacts], ['EVENTS', events]]) {
      if (!items.length) continue;
      const data = { contractVersion: source.PAGE_PART_VERSION, scope, captureId, sourceRevision: revision, kind, index: 0, items };
      parts.push(data);
    }
    const partRefs = [];
    for (const p of parts) partRefs.push({ kind: p.kind, index: p.index, sha256: await c.digestJson(p),
      byteLength: Buffer.byteLength(c.canonicalJson(p)), count: p.items.length });
    root = { contractVersion: source.PAGE_SOURCE_VERSION, exporterVersion: source.PAGE_OBSERVED_EXPORTER_VERSION, scope, captureId,
      sourceRevision: revision, capture: { descriptor, completion, status: completion.outcome, createdAt: 1700000000000,
        completedAt: 1700000010000, origins: ['https://app.example.test'] }, ingestion: { expectedEvents: events.length,
        lastSequence: events.length - 1, eventChainHash: chain }, parts: partRefs, reachableArtifactIds: [...reachable].sort(),
      counts: { events: events.length, artifacts: artifacts.length, referencedArtifacts: reachable.size } };
    ref = { contractVersion: source.PAGE_SOURCE_REF_VERSION, exporterVersion: source.PAGE_OBSERVED_EXPORTER_VERSION,
      scope, captureId, sourceRevision: revision, sourceHash: await c.digestJson(root) };
    return ref;
  }
  await rehash();
  const data = { scope, captureId, doc, nav, policy, descriptor, completion, artifacts, bytes, events, body, headers, dom, network, checkpoint, add, common, artifact, rehash,
    get root() { return root; }, get ref() { return ref; }, get parts() { return parts; },
    async assemble() { return assemblePageEvidence(root, ref, protocol.DEFAULT_PROFILE,
      i => source.validatePagePart(parts[i], root.parts[i], root), async id => new Uint8Array(bytes.get(id))); },
    async cache304() {
      const p = structuredClone(network.payload); p.entryId = 'entry_cached'; p.requestId = 'request_cached'; p.resourceId = 'res_cached';
      p.observedSequence = events.length; p.requestSequence = 1; p.relativeTimeUs = 40000; p.relativeTimeMs = 40; p.startedOffsetUs = 40000; p.finishedOffsetUs = 41000;
      p.response = { ...p.response, status: 304, networkStatus: 304, replayStatus: 200, bodySource: 'CACHE',
        cacheEvidence: { representationId: network.eventId, bodySha256: p.response.bodyHash, matchKeySha256: await pc.pageCacheMatchKey(captureId, p) } };
      const e = add('INTERACTION', p, 'uie_cached'); await rehash(); return e;
    },
  };
  return data;
}

async function environment(data) {
  const ui = support.uiEnvironment(build, process.env.QAGENT_UI_ROOT, await support.sample(support.production(build)));
  const ack = [], pins = new Set();
  ui.env.OBSERVATION_SERVICE = { fetch: async req => {
    try {
      const body = await protocol.authenticate(req, support.SECRET, 'source'), op = new URL(req.url).pathname.split('/').pop();
      const ref = ['snapshot', 'status'].includes(op) ? body : body.source;
      if (!protocol.sameScope(ref.scope, data.scope) || ref.captureId !== data.captureId) c.fail('UI_BUNDLE_SOURCE_NOT_FOUND', 404);
      if (ref.sourceHash !== data.ref.sourceHash) c.fail('UI_BUNDLE_SOURCE_HASH_MISMATCH', 409);
      if (op === 'snapshot') return protocol.json(data.root);
      if (op === 'source-part') return protocol.json(data.parts[body.index]);
      if (op === 'status') return protocol.json({ status: 'ok' });
      if (op === 'artifact') return new Response(data.bytes.get(body.artifactId));
      if (op === 'pin') { body.artifactIds.forEach(x => pins.add(x)); return protocol.json({ status: 'ok', pinned: body.artifactIds.length, pinnedArtifactIds: body.artifactIds, unavailableArtifactIds: [] }); }
      if (op === 'ack') { ack.push(body); return protocol.json({ status: 'ok' }); }
      return new Response(null, { status: 404 });
    } catch (e) { return protocol.safeFailure(e); }
  } };
  return { ...ui, ack, pins, async consume(message) { const m = support.delivery(message); await ui.services.consumeBuilds({ queue: protocol.MAIN_QUEUE, messages: [m] }, ui.env); return m; },
    stored() { const row = ui.db.sql.prepare('SELECT * FROM ui_bundle_versions').get(); return { row, envelope: row ? JSON.parse(ui.bucket.data.get(row.object_key)) : null }; } };
}
module.exports = { fixture, environment, c, pc, source, protocol, support };
