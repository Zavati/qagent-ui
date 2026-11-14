const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, environment, c, pc, source, protocol, support } = require('./observed-support.cjs');

async function replaceBytes(x, item, value) {
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
  x.bytes.set(item.artifactId, bytes); item.descriptor.byteLength = bytes.length;
  item.descriptor.sha256 = await c.sha256(new Uint8Array(bytes));
  if (x.network.payload.response.bodyRef === item.artifactId) x.network.payload.response.bodyHash = item.descriptor.sha256;
  await x.rehash();
}
function png() {
  const { deflateSync } = require('node:zlib');
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let n = 0; n < 8; n++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  function chunk(type, data) { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; }
  const h = Buffer.alloc(13); h.writeUInt32BE(1, 0); h.writeUInt32BE(1, 4); h[8] = 8; h[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 33, 77, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

test('r2 preserves environment-managed test data in JSON, headers, query, DOM, form and action values', async () => {
  const body = { password: 'fixture-password', token: 'fixture-token', email: 'tester@example.test', state: 'SP' };
  const x = await fixture({ environmentManaged: true, checkpoint: true, body });
  x.policy.businessHeaderNames = ['authorization', 'cookie'];
  x.network.payload.request.query = [['token', 'fixture-token'], ['email', 'tester@example.test']];
  await replaceBytes(x, x.headers, [['authorization', 'Bearer fixture-token'], ['set-cookie', 'session=fixture-cookie']]);
  await replaceBytes(x, x.dom, { contractVersion: 'qagent.ui-dom-snapshot.v1', documentId: x.doc,
    nodes: [{ nodeId: 'node_password', parentId: null, nodeType: 1, name: 'INPUT',
      attributes: [['type', 'password'], ['data-private', 'true'], ['value', 'fixture-password']], text: '' }] });
  const form = await x.artifact('FORM_STATE_JSON', { contractVersion: 'qagent.ui-form-state.v1', documentId: x.doc,
    fields: [{ nodeId: 'node_password', type: 'password', value: 'fixture-password', checked: false },
      { nodeId: 'node_hidden', type: 'hidden', value: 'fixture-csrf', checked: false }], scroll: [] }, 'uia_form');
  x.checkpoint.payload.pageCapture.formStateRef = form.artifactId;
  const value = await x.artifact('ACTION_VALUE_JSON', { value: 'fixture-password' }, 'uia_value');
  x.add('ACTION', { contractVersion: pc.PAGE_CONTRACTS.action, ...x.common(3, 40000), actionId: 'act_fill', type: 'FILL',
    target: { primaryLocator: { strategy: 'CSS', value: 'input[type="password"]' }, candidateLocators: [], observedMatchCount: 1, framePath: [] },
    input: { source: pc.PAGE_ENVIRONMENT_ORIGIN, valueRef: value.artifactId }, stateBeforeId: 'state_one', stateAfterId: null }, 'uie_fill');
  await x.rehash(); const { envelope } = await x.assemble(), f = envelope.bundle.fixtures[0];
  assert.equal(envelope.builderVersion, protocol.ENVIRONMENT_BUILDER_VERSION);
  assert.equal(envelope.qualification.dataProtection, 'ENVIRONMENT_MANAGED');
  assert.equal(envelope.qualification.dataRedactionApplied, false);
  assert.equal(envelope.qualification.dataResponsibility, 'CAPTURE_ENVIRONMENT');
  assert.equal(envelope.qualification.dataOrigin, pc.PAGE_ENVIRONMENT_ORIGIN);
  assert.equal(envelope.qualification.privacyPolicyVersion, pc.PAGE_ENVIRONMENT_PRIVACY);
  assert.equal(f.availability, 'READY'); assert.equal(f.response.networkStatus, 400); assert.equal(f.testPassed, false);
  assert.deepEqual(f.request.query, x.network.payload.request.query);
  assert.deepEqual(JSON.parse(x.bytes.get(x.body.artifactId)), body);
  assert.deepEqual(JSON.parse(x.bytes.get(x.headers.artifactId)), [['authorization', 'Bearer fixture-token'], ['set-cookie', 'session=fixture-cookie']]);
  assert.equal(envelope.pageIndex.states[0].formStateRef, form.artifactId);
  assert.equal(envelope.journey.actions[1].inputValueRef, value.artifactId);
  assert.equal(envelope.qualification.uiTestPassed, false); assert.deepEqual(envelope.qualification.eligibleModes, []);
  assert.deepEqual(envelope.journey.assertions, []); assert.equal(envelope.bundle.matching.liveBusinessFallback, false);
  assert.ok(envelope.bundle.artifacts.every(a => a.dataOrigin === pc.PAGE_ENVIRONMENT_ORIGIN && a.privacyPolicyVersion === pc.PAGE_ENVIRONMENT_PRIVACY));
});

test('r2 raw HTTP HTML remains an inert attachment; rendered HTML is a separate passive serialization', async t => {
  const x = await fixture({ environmentManaged: true, checkpoint: true }), markup = '<main data-private="true"><input type="password" value="fixture-password"><script>globalThis.fixtureExecuted=true</script></main>';
  x.body.descriptor.contentType = x.body.descriptor.originalContentType = 'text/html';
  x.body.descriptor.representation = 'UTF8_TEXT';
  await replaceBytes(x, x.body, Buffer.from(markup));
  const passive = '<main data-private="true"><input type="password" value="fixture-password"><script></script></main>';
  const html = await x.artifact('RENDERED_HTML', passive, 'uia_html', 'text/html');
  html.descriptor.captureMethod = 'DOM_SERIALIZATION';
  x.checkpoint.payload.pageCapture.htmlRef = html.artifactId; await x.rehash();
  const ui = await environment(x); t.after(() => ui.close());
  const message = await protocol.makeMessage(x.ref, protocol.DEFAULT_PROFILE, support.SECRET);
  assert.equal((await ui.consume(message)).acked, true); const first = ui.stored();
  assert.equal(first.row.builder_version, protocol.ENVIRONMENT_BUILDER_VERSION);
  assert.equal(first.envelope.qualification.dataProtection, 'ENVIRONMENT_MANAGED');
  assert.equal(ui.ack[0].buildId, message.buildId); assert.equal(ui.ack[0].bundleVersionId, first.row.bundle_version_id);
  assert.equal(ui.pins.size, x.root.counts.referencedArtifacts);
  const request = await protocol.signedRequest('https://ui.example.test/internal/ui/v1/artifact',
    { scope: x.scope, bundleVersionId: first.row.bundle_version_id, artifactId: x.body.artifactId }, support.OPS, 'operator');
  const response = await ui.routes.route(request, ui.env);
  assert.equal(response.status, 200); assert.equal(await response.text(), markup);
  assert.ok(response.headers.get('content-disposition').startsWith('attachment;'));
  assert.equal(response.headers.get('content-security-policy'), "sandbox; default-src 'none'");
  assert.equal(globalThis.fixtureExecuted, undefined);
  assert.deepEqual(html.descriptor.privacy.transformations, []);
  assert.equal(x.bytes.get(html.artifactId).toString(), passive);
  assert.equal((await ui.consume(message)).acked, true);
  assert.equal(ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n, 1);
  assert.equal(ui.stored().row.manifest_hash, first.row.manifest_hash);
});

test('r2 screenshots keep unmasked pixels while PNG integrity and dimensions remain mandatory', async () => {
  for (const corrupt of [false, true]) {
    const x = await fixture({ environmentManaged: true, checkpoint: true }), data = png();
    if (corrupt) data[data.length - 1] ^= 1;
    const shot = await x.artifact('SCREENSHOT_PNG', data, 'uia_shot', 'image/png');
    x.checkpoint.payload.screenshotRef = shot.artifactId; x.checkpoint.payload.modalities.visual = 'AVAILABLE';
    x.checkpoint.payload.issues = []; x.checkpoint.payload.pageCapture.screenshotRef = shot.artifactId; x.checkpoint.payload.pageCapture.missing = [];
    await x.rehash();
    if (corrupt) await assert.rejects(x.assemble(), e => e.code === 'UI_PNG_INVALID');
    else {
      const { envelope } = await x.assemble();
      assert.equal(envelope.qualification.uses.visualReference.status, 'READY');
      assert.equal(shot.descriptor.privacy.visual, undefined); assert.equal(envelope.qualification.uiTestPassed, false);
    }
  }
});

test('r2 rendered HTML still refuses active code and event attributes without censoring test values', async () => {
  for (const markup of ['<main><script>execute()</script></main>', '<main onclick="execute()">test</main>',
    '<a href="javascript:execute()">test</a>']) {
    const x = await fixture({ environmentManaged: true, checkpoint: true });
    const html = await x.artifact('RENDERED_HTML', markup, 'uia_active_html', 'text/html');
    html.descriptor.captureMethod = 'DOM_SERIALIZATION';
    x.checkpoint.payload.pageCapture.htmlRef = html.artifactId; await x.rehash();
    await assert.rejects(x.assemble());
  }
});

test('r2 profile cannot mix origins, claim sanitization or bypass structural validation and scope', async () => {
  for (const change of [x => delete x.policy.dataProtection,
    x => x.body.descriptor.privacy.dataOrigin = 'OBSERVED_SANITIZED',
    x => x.body.descriptor.privacy.policyVersion = pc.PAGE_OBSERVED_PRIVACY,
    x => x.body.descriptor.privacy.transformations.push({ kind: 'REDACTED', path: '/body' })]) {
    const x = await fixture({ environmentManaged: true }); change(x); await x.rehash(); await assert.rejects(x.assemble());
  }
  const x = await fixture({ environmentManaged: true });
  await assert.rejects(source.validatePageRoot(x.root, { ...x.ref, scope: { ...x.scope, environmentId: 'env_other' } }));
  await replaceBytes(x, x.headers, [['authorization', 'fixture\r\ninjected']]);
  await assert.rejects(x.assemble(), e => e.code === 'UI_HEADER_FORMAT_INVALID');
  const y = await fixture({ environmentManaged: true }); y.bytes.set(y.body.artifactId, Buffer.alloc(y.body.bytes.length, 32));
  await assert.rejects(y.assemble(), e => e.code === 'UI_BUNDLE_ARTIFACT_HASH_MISMATCH');
});

test('r2 cache replay preserves 304 and needs a prior same-profile NETWORK200 representation', async () => {
  const x = await fixture({ environmentManaged: true, status: 200 }), cached = await x.cache304();
  const { envelope } = await x.assemble(), f = envelope.bundle.fixtures[1];
  assert.equal(f.response.networkStatus, 304); assert.equal(f.response.replayStatus, 200);
  assert.equal(f.response.cacheEvidenceVerified, true); assert.equal(f.consumption.maximum, 1);
  assert.equal(f.consumption.reuseAfterExhaustion, false); assert.equal(f.consumption.liveFallback, false);
  cached.payload.response.cacheEvidence.matchKeySha256 = await pc.pageCacheMatchKey(x.captureId, cached.payload, 'OBSERVED_SANITIZED');
  await x.rehash(); await assert.rejects(x.assemble(), e => e.code === 'UI_PAGE_CACHE_EVIDENCE_INVALID');
  const missing = await fixture({ environmentManaged: true });
  Object.assign(missing.network.payload.response, { status: 304, networkStatus: 304, replayStatus: 304,
    bodyState: 'MISSING', bodySource: 'UNAVAILABLE', bodyRef: null, bodyHash: null, completeness: 'PARTIAL' });
  await missing.rehash(); const m = (await missing.assemble()).envelope.bundle.fixtures[0];
  assert.equal(m.availability, 'UNAVAILABLE'); assert.equal(m.response.networkStatus, 304); assert.equal(m.response.cacheEvidenceVerified, false);
});

test('r2 has a new builder identity and cannot consume forged historical builder identities', async () => {
  const x = await fixture({ environmentManaged: true }), message = await protocol.makeMessage(x.ref, protocol.DEFAULT_PROFILE, support.SECRET);
  assert.equal(x.ref.exporterVersion, source.PAGE_ENVIRONMENT_EXPORTER_VERSION);
  assert.equal(await protocol.messageBuilderVersion(message), protocol.ENVIRONMENT_BUILDER_VERSION);
  for (const version of [protocol.LEGACY_BUILDER_VERSION, protocol.BUILDER_VERSION, protocol.OBSERVED_BUILDER_VERSION]) {
    const wrong = await protocol.identityForBuilder(x.ref, protocol.DEFAULT_PROFILE, version);
    assert.notEqual(wrong.buildId, message.buildId);
    assert.equal(await protocol.messageBuilderVersion({ ...message, buildId: wrong.buildId }), null);
  }
});

test('r2 cache keeps complete request headers while matching normalized nonconditional headers', async () => {
  const x = await fixture({ environmentManaged: true, status: 200 });
  const pairs = [['accept', 'application/json'], ['authorization', 'Bearer fixture-token'], ['x-values', 'first'], ['x-values', 'second']];
  const normalized = await x.artifact('HEADERS_JSON', pairs, 'uia_variant_headers');
  const raw200 = await x.artifact('HEADERS_JSON', pairs, 'uia_observed_200');
  const raw304 = await x.artifact('HEADERS_JSON', [...pairs.slice(0, 2), ['if-modified-since', 'Mon, 01 Jan 2024 00:00:00 GMT'],
    ['if-none-match', '"fixture-representation"'], ...pairs.slice(2)], 'uia_observed_304');
  x.network.payload.request.businessHeadersRef = normalized.artifactId;
  x.network.payload.request.observedHeadersRef = raw200.artifactId;
  const cached = await x.cache304(); cached.payload.request.observedHeadersRef = raw304.artifactId;
  await x.rehash();
  const { envelope } = await x.assemble(), [first, second] = envelope.bundle.fixtures;
  assert.equal(first.availability, 'READY'); assert.equal(second.availability, 'READY');
  assert.equal(second.response.networkStatus, 304); assert.equal(second.response.replayStatus, 200);
  assert.equal(second.response.cacheEvidenceVerified, true);
  assert.equal(first.request.businessHeadersRef, normalized.artifactId);
  assert.equal(second.request.businessHeadersRef, normalized.artifactId);
  assert.equal(first.request.observedHeadersRef, raw200.artifactId);
  assert.equal(second.request.observedHeadersRef, raw304.artifactId);
  assert.equal(first.request.observedHeadersSha256, raw200.descriptor.sha256);
  assert.equal(second.request.observedHeadersSha256, raw304.descriptor.sha256);
  assert.notEqual(first.request.observedHeadersSha256, second.request.observedHeadersSha256);
  assert.equal(first.match.requestFingerprint, second.match.requestFingerprint);
  assert.deepEqual(envelope.bundle.fixtures.map(f => f.match.occurrenceIndex), [0, 1]);
  assert.equal(envelope.pageIndex.interactions[1].request.observedHeadersRef, raw304.artifactId);
  assert.equal(envelope.bundle.artifacts.filter(a => [raw200.artifactId, raw304.artifactId].includes(a.artifactId)).length, 2);
  assert.ok(envelope.bundle.fixtures.every(f => f.consumption.maximum === 1 && !f.consumption.liveFallback));
  x.bytes.set(raw304.artifactId, Buffer.alloc(raw304.bytes.length, 32));
  await assert.rejects(x.assemble(), e => e.code === 'UI_BUNDLE_ARTIFACT_HASH_MISMATCH');
  await replaceBytes(x, raw304, [...JSON.parse(raw304.bytes), ['cookie', 'session=another-fixture']]);
  await assert.rejects(x.assemble(), e => e.code === 'UI_PAGE_REQUEST_HEADERS_MISMATCH');
});

test('r1 source, build and manifest hashes match immutable fix1 baseline vectors', async () => {
  // Vectors produced by compiling and running the unchanged fix1 checkout before this patch.
  for (const [options, sourceHash, buildId, manifestHash] of [
    [{}, '2565195418f20f316dace0d830088fe03a6c1cf63b8890ca7a974c990d163817', 'uib_4df2aed5c14b244e0f9a744fb61969d527a94a233b514fa36b00e362f26ed808', '9a38e2dfaba4bd839ae6772e25310bd4e784e668549f7d34b257ecc2f985b824'],
    [{ checkpoint: true }, '6af4cc410f2db964e0265bf531e1feaf68189f458deeedccf80973c826877c98', 'uib_492f62201d0d736385698698b145c67b5b805a552c8fdd8cb8c46729f149fcad', 'd11610592e9fef3e76bc988dd28bafa4bb50e5b9a8282ab68ee8c173af620a6e'],
  ]) {
    const x = await fixture(options), { envelope } = await x.assemble();
    assert.equal(x.ref.sourceHash, sourceHash); assert.equal(envelope.buildId, buildId); assert.equal(envelope.manifestHash, manifestHash);
    assert.equal(envelope.qualification.dataProtection, undefined); assert.equal(envelope.builderVersion, protocol.OBSERVED_BUILDER_VERSION);
    assert.equal(Object.hasOwn(envelope.bundle.fixtures[0].request, 'observedHeadersRef'), false);
  }
  const blocked = await fixture({ body: { password: 'fixture-password' } });
  await assert.rejects(blocked.assemble(), e => e.code === 'UI_PRIVACY_REJECTED');
});
