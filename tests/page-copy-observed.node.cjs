const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, environment, c, pc, source, protocol, support } = require('./observed-support.cjs');

async function replaceBytes(x, item, value) {
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
  x.bytes.set(item.artifactId, bytes); item.descriptor.byteLength = bytes.length;
  item.descriptor.sha256 = await c.sha256(new Uint8Array(bytes));
  if (x.network.payload.response.bodyRef === item.artifactId) x.network.payload.response.bodyHash = item.descriptor.sha256;
  await x.rehash();
}
function png(pixel) {
  const { deflateSync } = require('node:zlib');
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let n = 0; n < 8; n++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  function chunk(type, data) { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; }
  const h = Buffer.alloc(13); h.writeUInt32BE(1, 0); h.writeUInt32BE(1, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h),
    chunk('IDAT', deflateSync(Buffer.from([0, pixel, pixel, pixel, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
async function withManifest(x, change = () => {}) {
  const p = x.network.payload;
  const value = { contractVersion: 'qagent.ui-resource-manifest.v1', parts: [],
    artifacts: [{ artifactId: x.body.artifactId, kind: x.body.descriptor.kind, sha256: x.body.descriptor.sha256 }],
    documents: [{ documentId: x.doc, frameId: p.frameId, parentDocumentId: null, initialNavigationId: x.nav,
      initialUrl: x.descriptor.entryUrl, origin: p.request.origin, observedSequence: 0, startedOffsetUs: 0, sourceHtmlRef: null, metadata: {} }],
    resources: [{ resourceId: p.resourceId, documentId: x.doc, interactionEventId: x.network.eventId, sourceKind: 'NETWORK',
      resourceType: p.resourceType, resourceUrl: 'https://app.example.test/api/items?tag=one&tag=two', requestId: p.requestId,
      requestSequence: p.requestSequence, redirectHop: 0, observedSequence: p.observedSequence, startedOffsetUs: p.startedOffsetUs,
      endedOffsetUs: p.finishedOffsetUs, method: p.request.method, responseStatus: p.response.networkStatus,
      mimeType: x.body.descriptor.contentType, bodyRef: p.response.bodyRef, bodyState: p.response.bodyState, bodySource: p.response.bodySource, metadata: {} }],
    stateResources: [{ stateId: 'state_one', resourceId: p.resourceId, usageIndex: 0, role: 'DATA', requiredForArchive: true, metadata: {} }] };
  change(value);
  const m = await x.artifact('RESOURCE_MANIFEST_JSON', value, 'uia_manifest'); x.checkpoint.payload.pageCapture.resourceManifestRef = m.artifactId;
  await x.rehash(); return m;
}

test('an observed HTTP 400 is an available exact fixture; absent provenance/bootstrap/checkpoints limit other uses', async () => {
  const x = await fixture(), { envelope } = await x.assemble(), f = envelope.bundle.fixtures[0];
  assert.equal(envelope.contractVersion, 'qagent.ui-page-evidence.v2'); assert.equal(f.availability, 'READY');
  assert.equal(f.response.networkStatus, 400); assert.equal(f.response.replayStatus, 400);
  assert.equal(envelope.qualification.uses.fixtureMocks.status, 'READY');
  assert.equal(envelope.qualification.dimensions.provenance.status, 'UNAVAILABLE');
  assert.equal(envelope.qualification.dimensions.bootstrap.status, 'UNAVAILABLE');
  assert.equal(envelope.qualification.uses.journeyExecution.status, 'UNAVAILABLE');
  assert.equal(envelope.qualification.counts.checkpoints, 0); assert.equal(envelope.qualification.uiTestPassed, false);
  assert.deepEqual(envelope.qualification.eligibleModes, []); assert.deepEqual(envelope.journey.assertions, []);
  assert.equal(envelope.bundle.applicationResources.observedCssJsAreFixtures, false);
  assert.ok(!JSON.stringify(envelope).includes(x.body.bytes.toString()));
});
test('observed source uses builder v3 while v1 and synthetic PC2 retain builder v2', async () => {
  const x = await fixture(), message = await protocol.makeMessage(x.ref, protocol.DEFAULT_PROFILE, support.SECRET);
  assert.equal(protocol.builderVersionForSource(x.ref), protocol.OBSERVED_BUILDER_VERSION);
  assert.equal(await protocol.messageBuilderVersion(message), protocol.OBSERVED_BUILDER_VERSION);
  assert.notEqual(message.buildId, (await protocol.identityForBuilder(x.ref, protocol.DEFAULT_PROFILE, protocol.BUILDER_VERSION)).buildId);
  const synthetic = { ...x.ref, exporterVersion: source.PAGE_EXPORTER_VERSION };
  assert.equal(protocol.builderVersionForSource(synthetic), 'qagent_ui_bundle_builder_v2');
  const legacy = { ...x.ref, contractVersion: protocol.SOURCE_REF_VERSION, exporterVersion: protocol.EXPORTER_VERSION };
  assert.deepEqual(await protocol.identity(legacy, protocol.DEFAULT_PROFILE), await protocol.identityForBuilder(legacy, protocol.DEFAULT_PROFILE, 'qagent_ui_bundle_builder_v2'));
});
test('checkpoint structure is usable independently of an unavailable screenshot', async () => {
  const x = await fixture({ checkpoint: true }), { envelope } = await x.assemble();
  assert.equal(envelope.pageIndex.states[0].triggerKind, 'DOM_CHANGE');
  assert.equal(envelope.qualification.uses.structuralReference.status, 'READY');
  assert.equal(envelope.qualification.uses.visualReference.status, 'UNAVAILABLE');
  assert.equal(envelope.qualification.uses.fixtureMocks.status, 'READY');
  assert.deepEqual(envelope.qualification.coverage.documentsWithoutCheckpoint, []);
});
test('unstable checkpoint stays archived and does not invalidate the complete HTTP body', async () => {
  const x = await fixture({ checkpoint: true, unstable: true }), { envelope } = await x.assemble();
  assert.equal(envelope.pageIndex.states[0].stability, 'UNSTABLE');
  assert.notEqual(envelope.qualification.dimensions.semantic.status, 'READY');
  assert.equal(envelope.bundle.fixtures[0].availability, 'READY');
});
test('missing response has an explicit unavailable fixture, no fabricated body', async () => {
  const x = await fixture(); Object.assign(x.network.payload.response, { bodyState: 'MISSING', bodySource: 'UNAVAILABLE', bodyRef: null, bodyHash: null, completeness: 'PARTIAL' });
  await x.rehash(); const { envelope } = await x.assemble(), f = envelope.bundle.fixtures[0];
  assert.equal(f.availability, 'UNAVAILABLE'); assert.ok(f.reasonCodes.includes('UI_FIXTURE_RESPONSE_MISSING')); assert.equal(f.response.bodyRef, null);
});
test('request body loss blocks matching despite a complete response', async () => {
  const x = await fixture(); x.network.payload.request.method = 'POST'; x.network.payload.issues.push('UI_REQUEST_BODY_UNAVAILABLE');
  await x.rehash(); const { envelope } = await x.assemble();
  assert.equal(envelope.bundle.fixtures[0].availability, 'UNAVAILABLE');
  assert.ok(envelope.bundle.fixtures[0].reasonCodes.includes('UI_FIXTURE_REQUEST_BODY_UNAVAILABLE'));
});
test('304 without representation evidence stays missing and keeps its network status', async () => {
  const x = await fixture(); Object.assign(x.network.payload.response, { status: 304, networkStatus: 304, replayStatus: 304,
    bodyState: 'MISSING', bodySource: 'UNAVAILABLE', bodyRef: null, bodyHash: null, completeness: 'PARTIAL' });
  await x.rehash(); const { envelope } = await x.assemble(), f = envelope.bundle.fixtures[0];
  assert.equal(f.response.networkStatus, 304); assert.equal(f.response.replayStatus, 304);
  assert.equal(f.availability, 'UNAVAILABLE'); assert.equal(f.response.cacheEvidenceVerified, false);
});
test('304 can reference the same previously verified NETWORK200 bytes without rewriting the source event', async () => {
  const x = await fixture({ status: 200 }), cached = await x.cache304(), { envelope } = await x.assemble();
  const f = envelope.bundle.fixtures[1]; assert.equal(f.response.networkStatus, 304); assert.equal(f.response.replayStatus, 200);
  assert.equal(f.availability, 'READY'); assert.equal(f.response.cacheEvidenceVerified, true);
  assert.equal(f.response.bodyRef, x.body.artifactId); assert.equal(f.response.representationEventId, x.network.eventId);
  assert.equal(cached.payload.response.status, 304); assert.equal(f.consumption.maximum, 1); assert.equal(f.consumption.liveFallback, false);
});
test('cache proof cannot point to a missing, different-context or unfinished representation', async () => {
  for (const mutate of [x => x.cached.payload.response.cacheEvidence.representationId = 'uie_missing',
    x => x.cached.payload.navigationId = 'nav_other', x => x.network.payload.finishedOffsetUs = 42000]) {
    const x = await fixture({ status: 200 }); x.cached = await x.cache304(); mutate(x); await x.rehash();
    await assert.rejects(x.assemble(), e => e.code === 'UI_PAGE_CACHE_EVIDENCE_INVALID');
  }
});
test('cache proof cannot promote an error400 or another cache hit to a representation200', async () => {
  const x = await fixture({ status: 400 }); await x.cache304(); await assert.rejects(x.assemble(), e => e.code === 'UI_PAGE_CACHE_EVIDENCE_INVALID');
});
test('repeated identical requests have deterministic occurrence indices and one permitted consumption each', async () => {
  const x = await fixture(), p = structuredClone(x.network.payload);
  p.requestId = 'request_two'; p.entryId = 'entry_two'; p.resourceId = 'res_two'; p.requestSequence = 1; p.observedSequence = 2;
  p.startedOffsetUs = 20000; p.finishedOffsetUs = 21000; p.relativeTimeUs = 20000; p.relativeTimeMs = 20;
  x.add('INTERACTION', p, 'uie_two'); await x.rehash();
  const a = (await x.assemble()).envelope, b = (await x.assemble()).envelope;
  assert.equal(a.manifestHash, b.manifestHash); assert.deepEqual(a.bundle.fixtures.map(f => f.match.occurrenceIndex), [0, 1]);
  assert.equal(a.bundle.fixtures[0].match.requestFingerprint, a.bundle.fixtures[1].match.requestFingerprint);
  assert.deepEqual(a.bundle.fixtures[0].request.query, [['tag', 'one'], ['tag', 'two']]);
  assert.ok(a.bundle.fixtures.every(f => f.consumption.maximum === 1 && !f.consumption.reuseAfterExhaustion));
});
test('body corruption is an integrity failure, never a superficially usable partial fixture', async () => {
  const x = await fixture(); x.bytes.set(x.body.artifactId, Buffer.alloc(x.body.bytes.length, 32));
  await assert.rejects(x.assemble(), e => e.code === 'UI_BUNDLE_ARTIFACT_HASH_MISMATCH');
});
test('checkpoint cannot borrow a DOM from another document even when its bytes and hash are valid', async () => {
  const x = await fixture({ checkpoint: true }), data = JSON.parse(x.bytes.get(x.dom.artifactId)); data.documentId = 'doc_other';
  const bytes = Buffer.from(JSON.stringify(data)); x.bytes.set(x.dom.artifactId, bytes); x.dom.descriptor.byteLength = bytes.length; x.dom.descriptor.sha256 = await c.sha256(new Uint8Array(bytes));
  await x.rehash(); await assert.rejects(x.assemble(), e => e.code === 'UI_PAGE_STATE_ARTIFACT_CONTEXT_MISMATCH');
});
test('source scopes and observed/synthetic origins cannot be mixed', async () => {
  const x = await fixture(); await assert.rejects(source.validatePageRoot(x.root, { ...x.ref, scope: { ...x.scope, environmentId: 'env_other' } }));
  x.body.descriptor.privacy = { policyVersion: pc.PAGE_PRIVACY, dataOrigin: 'SYNTHETIC_CONTROL', transformations: [] };
  await x.rehash(); await assert.rejects(x.assemble(), e => e.code === 'UI_PAGE_SOURCE_ORIGIN_MISMATCH');
});
test('observed reader refuses credential JSON and unauthorized headers even with valid source and byte hashes', async () => {
  const x = await fixture({ body: { password: 'example-test-secret' } });
  await assert.rejects(x.assemble(), e => e.code === 'UI_PRIVACY_REJECTED');
  const y = await fixture(); await replaceBytes(y, y.headers, [['x-unapproved', 'example']]);
  await assert.rejects(y.assemble(), e => e.code === 'UI_HEADER_NOT_AUTHORIZED');
});
test('observed DOM payload shape and canonical checkpoint references are independently checked', async () => {
  const x = await fixture({ checkpoint: true }); await replaceBytes(x, x.dom, { contractVersion: 'qagent.ui-dom-snapshot.v1', documentId: x.doc, nodes: [{ arbitrary: true }] });
  await assert.rejects(x.assemble(), e => e.code === 'UI_CONTRACT_INVALID');
  const y = await fixture({ checkpoint: true }); delete y.checkpoint.payload.pageCapture.triggerKind; await y.rehash();
  await assert.rejects(y.assemble(), e => e.code === 'UI_PAGE_TRIGGER_REQUIRED');
});
test('observed HTML requires the redaction evidence and refuses active content; accepted HTML remains an artifact reference', async () => {
  for (const [markup, marker, code] of [
    ['<main>Example</main>', false, 'UI_PAGE_HTML_POLICY_REQUIRED'],
    ['<script>execute()</script>', true, 'UI_PRIVACY_REJECTED'],
    ['<main>Example</main>', true, null],
  ]) {
    const x = await fixture({ checkpoint: true }), html = await x.artifact('RENDERED_HTML', markup, 'uia_html', 'text/html');
    if (marker) html.descriptor.privacy.transformations = [{ kind: 'REDACTED', path: '/html/active-and-private-content' }];
    x.checkpoint.payload.pageCapture.htmlRef = html.artifactId; await x.rehash();
    if (code) await assert.rejects(x.assemble(), e => e.code === code);
    else { const { envelope } = await x.assemble(); assert.equal(envelope.pageIndex.states[0].htmlRef, html.artifactId); assert.ok(!JSON.stringify(envelope).includes(markup)); }
  }
});
test('observed PNG bytes are decoded and masking checked again before visual-reference qualification', async () => {
  for (const pixel of [32, 255]) {
    const x = await fixture({ checkpoint: true }), screenshot = await x.artifact('SCREENSHOT_PNG', png(pixel), 'uia_screenshot', 'image/png');
    screenshot.descriptor.privacy.visual = { width: 1, height: 1, background: 'SOLID_32', allowed: [{ x: 0, y: 0, width: 1, height: 1 }], masked: [{ x: 0, y: 0, width: 1, height: 1 }] };
    x.checkpoint.payload.screenshotRef = screenshot.artifactId; x.checkpoint.payload.modalities.visual = 'AVAILABLE';
    x.checkpoint.payload.issues = []; x.checkpoint.payload.pageCapture.screenshotRef = screenshot.artifactId; x.checkpoint.payload.pageCapture.missing = [];
    await x.rehash();
    if (pixel !== 32) await assert.rejects(x.assemble(), e => e.code === 'UI_PNG_MASK_VIOLATION');
    else { const { envelope } = await x.assemble(); assert.equal(envelope.qualification.uses.visualReference.status, 'READY'); assert.equal(envelope.qualification.uiTestPassed, false); }
  }
});
test('resource manifest remains a typed reference index and cannot contradict the captured interaction or state', async () => {
  const valid = await fixture({ checkpoint: true }); await withManifest(valid); const { envelope } = await valid.assemble();
  assert.equal(envelope.pageIndex.documents[0].evidenceSource, 'RESOURCE_MANIFEST');
  assert.equal(envelope.pageIndex.stateResources[0].causalProof, false);
  for (const [change, code] of [
    [m => m.resources[0].resourceUrl = 'https://app.example.test/api/other', 'UI_PAGE_RESOURCE_EVENT_MISMATCH'],
    [m => m.resources[0].bodySource = 'CACHE', 'UI_PAGE_RESOURCE_EVENT_MISMATCH'],
    [m => m.resources[0].unexpected = true, 'UI_PAGE_CONTRACT_INVALID'],
    [m => m.stateResources[0].stateId = 'state_missing', 'UI_PAGE_STATE_RESOURCE_MISMATCH'],
  ]) {
    const x = await fixture({ checkpoint: true }); await withManifest(x, change);
    await assert.rejects(x.assemble(), e => e.code === code);
  }
});
test('real consumer + SQLite commits an immutable observed version then ACKs; duplicate delivery reuses it', async t => {
  const x = await fixture({ checkpoint: true }), ui = await environment(x); t.after(() => ui.close());
  const message = await protocol.makeMessage(x.ref, protocol.DEFAULT_PROFILE, support.SECRET);
  assert.equal((await ui.consume(message)).acked, true); const first = ui.stored();
  assert.equal(first.envelope.contractVersion, 'qagent.ui-page-evidence.v2'); assert.equal(first.row.builder_version, protocol.OBSERVED_BUILDER_VERSION);
  assert.equal(ui.ack[0].buildId, message.buildId); assert.equal(ui.ack[0].bundleVersionId, first.row.bundle_version_id);
  assert.equal((await ui.consume(message)).acked, true); assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n, 1);
  assert.equal(ui.stored().row.manifest_hash, first.row.manifest_hash); assert.equal(ui.pins.size, x.root.counts.referencedArtifacts);
});
test('storage outage remains retryable and cannot create a partial observed manifest or ACK', async t => {
  const x = await fixture(), ui = await environment(x); t.after(() => ui.close()); ui.bucket.fail = true;
  const message = await protocol.makeMessage(x.ref, protocol.DEFAULT_PROFILE, support.SECRET);
  assert.equal((await ui.consume(message)).retried, true); assert.equal(ui.stored().row, undefined); assert.equal(ui.ack.length, 0);
  ui.bucket.fail = false; assert.equal((await ui.consume(message)).acked, true);
});
