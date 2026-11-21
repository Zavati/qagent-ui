// Real services/contracts and SQLite; synthetic R2/Queue transports. No Cloudflare calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const support = require('./support.cjs');
const observed = require('./observed-support.cjs');
const uiBuild = process.env.QAGENT_UI_BUILD, uiRoot = process.env.QAGENT_UI_ROOT;
const obsBuild = process.env.QAGENT_OBSERVATION_BUILD, obsRoot = process.env.QAGENT_OBSERVATION_ROOT;
const { Repository } = require(path.join(uiBuild, 'src/storage/repository.js'));
const PREVIOUS = 'qagent_ui_bundle_builder_v4', CURRENT = 'qagent_ui_bundle_builder_v5';

async function signedMessage(protocol, source, profile, builder = PREVIOUS) {
  const unsigned = { contractVersion: protocol.BUILD_REQUEST_VERSION, source, profile,
    buildId: (await protocol.identityForBuilder(source, profile, builder)).buildId };
  return { ...unsigned, signature: crypto.createHmac('sha256', support.SECRET)
    .update('QAGENT_UI_BUNDLE_QUEUE_V1\n' + observed.c.canonicalJson(unsigned)).digest('hex') };
}
function insertAttempt(obs, message, builder, status = 'REJECTED', time = 1) {
  const s = message.source.scope;
  obs.db.sql.prepare('INSERT INTO ui_bundle_export_attempts(build_id,capture_id,organization_id,project_id,environment_id,source_hash,builder_version,profile_revision,status,published_at,acknowledged_at,reason_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(message.buildId, message.source.captureId, s.organizationId, s.projectId, s.environmentId,
      message.source.sourceHash, builder, message.profile.revision, status, time, time,
      status === 'REJECTED' ? 'UI_BUNDLE_BUILD_REJECTED' : null);
}
async function fixture(t) {
  const data = await observed.fixture({ environmentManaged: true, checkpoint: true });
  data.descriptor.segment = { logicalJourneyId: 'uij_recovery_fixture', segmentIndex: 0, previousCaptureId: null };
  const manifest = await data.artifact('RESOURCE_MANIFEST_JSON', {
    contractVersion: 'qagent.ui-resource-manifest.v1', parts: [], artifacts: [], resources: [], stateResources: [],
    documents: [{ documentId: data.doc, frameId: 'frame_main', parentDocumentId: null,
      initialNavigationId: data.nav, initialUrl: data.descriptor.entryUrl,
      origin: new URL(data.descriptor.entryUrl).origin, observedSequence: 0,
      startedOffsetUs: 0, sourceHtmlRef: null, metadata: {} }]
  });
  data.checkpoint.payload.pageCapture.resourceManifestRef = manifest.artifactId;
  await data.rehash();
  const obs = support.observationEnvironment(obsBuild, obsRoot);
  t.after(() => obs.close());
  for (const name of ['0017_ui_page_copy_foundation.sql', '0018_ui_artifact_v2_capacity.sql', '0019_ui_logical_page_segments.sql']) {
    obs.db.sql.exec('BEGIN;\n' + fs.readFileSync(path.join(obsRoot, 'migrations', name), 'utf8') + '\nCOMMIT;');
  }
  await support.seedObservation(obs.db, obs.bucket, obs.p, {
    snapshot: { ...data.root, events: data.events, artifacts: data.artifacts }, bytes: data.bytes
  });
  await obs.service.discoverBundleExports(obs.env);
  const ref = await obs.service.ensureBundleSource(obs.env, data.scope, data.captureId);
  const ui = support.uiEnvironment(uiBuild, uiRoot, await support.sample(support.production(uiBuild)));
  t.after(() => ui.close());
  ui.env.OBSERVATION_SERVICE = { fetch: request => obs.service.routeBundleSource(request, obs.env) };
  const legacy = await signedMessage(ui.p.protocol, ref, ui.p.protocol.DEFAULT_PROFILE);
  obs.db.sql.prepare("UPDATE ui_bundle_export_outbox SET status='NEEDS_ATTENTION',active_build_id=?,active_builder_version=?,acknowledged_at=?,next_dispatch_at=0,last_error=NULL WHERE capture_id=?")
    .run(legacy.buildId, PREVIOUS, Date.now(), ref.captureId);
  insertAttempt(obs, legacy, PREVIOUS);
  const repo = new Repository(ui.db);
  await repo.admit(legacy);
  await repo.quarantine('historical_failure', legacy.buildId, 'UI_CONTRACT_INVALID', await observed.c.digestJson(legacy));
  const outbox = () => obs.db.sql.prepare('SELECT * FROM ui_bundle_export_outbox WHERE capture_id=?').get(ref.captureId);
  return { obs, ui, ref, legacy, repo, data, outbox };
}
async function consume(ui, body) {
  const delivery = support.delivery(body);
  await ui.services.consumeBuilds({ queue: ui.p.protocol.MAIN_QUEUE, messages: [delivery] }, ui.env);
  return delivery;
}
async function sourceAck(x, message, disposition) {
  const body = { source: message.source, buildId: message.buildId, bundleVersionId: null, disposition };
  const req = await x.ui.p.protocol.signedRequest('https://source.test/internal/ui-bundles/v1/ack', body, support.SECRET, 'source');
  return x.obs.service.routeBundleSource(req, x.obs.env);
}
async function addTerminalCandidate(x, index, profileRevision = 1) {
  const root = structuredClone(x.data.root), captureId = 'uic_current_candidate_' + index;
  root.captureId = captureId;
  root.capture.descriptor.operationId = 'op_candidate_start_' + index;
  root.capture.descriptor.segment.logicalJourneyId = 'uij_candidate_' + index;
  root.capture.completion.operationId = 'op_candidate_stop_' + index;
  root.sourceRevision = await observed.c.digestJson(root.capture.completion);
  root.ingestion = { expectedEvents: 0, lastSequence: -1, eventChainHash: '0'.repeat(64) };
  root.parts = []; root.reachableArtifactIds = [];
  root.counts = { events: 0, artifacts: 0, referencedArtifacts: 0 };
  await support.seedObservation(x.obs.db, x.obs.bucket, x.obs.p, {
    snapshot: { ...root, events: [], artifacts: [] }, bytes: new Map()
  });
  const bytes = Buffer.from(observed.c.canonicalJson(root)), key = 'recovery-fixture/' + captureId + '.json';
  const ref = { ...x.ref, captureId, sourceRevision: root.sourceRevision, sourceHash: await observed.c.digestJson(root) };
  x.obs.bucket.data.set(key, bytes);
  const profile = { ...x.ui.p.protocol.DEFAULT_PROFILE, revision: profileRevision };
  const message = await signedMessage(x.ui.p.protocol, ref, profile, CURRENT);
  const s = ref.scope;
  x.obs.db.sql.prepare('INSERT INTO ui_bundle_export_outbox(capture_id,organization_id,project_id,environment_id,source_revision,exporter_version,source_hash,object_key,byte_length,status,created_at,acknowledged_at,next_dispatch_at,active_build_id,active_builder_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(captureId, s.organizationId, s.projectId, s.environmentId, ref.sourceRevision, ref.exporterVersion,
      ref.sourceHash, key, bytes.length, 'NEEDS_ATTENTION', 1, index + 1, 0, message.buildId, CURRENT);
  insertAttempt(x.obs, message, CURRENT);
  return { ref, message, profile };
}

test('v4 failure reopens through PENDING and v5 attempt, completes and deduplicates without rewriting evidence', async t => {
  const x = await fixture(t), oldJob = await x.repo.getBuild(x.legacy.buildId);
  const before = x.outbox(), sourceBytes = Buffer.from(x.obs.bucket.data.get(before.object_key));
  const oldAttempt = x.obs.db.sql.prepare('SELECT * FROM ui_bundle_export_attempts WHERE build_id=?').get(x.legacy.buildId);
  const send = x.obs.queue.send.bind(x.obs.queue); let pendingSeen = false;
  x.obs.queue.send = async body => { assert.equal(x.outbox().status, 'PENDING'); pendingSeen = true; return send(body); };
  await x.obs.service.recoverBundleExports(x.obs.env);
  assert.equal(pendingSeen, true);
  assert.equal(x.obs.queue.messages.length, 1);
  const message = x.obs.queue.messages[0].body;
  assert.notEqual(message.buildId, x.legacy.buildId);
  assert.equal(message.profile.revision, 1);
  assert.equal(message.buildId, (await x.ui.p.protocol.identity(x.ref, message.profile)).buildId);
  assert.equal(x.outbox().active_build_id, message.buildId);
  assert.equal(x.outbox().active_builder_version, CURRENT);
  assert.equal(x.outbox().status, 'PUBLISHED');
  assert.deepEqual(x.obs.db.sql.prepare('SELECT * FROM ui_bundle_export_attempts WHERE build_id=?').get(x.legacy.buildId), oldAttempt);
  const result = await consume(x.ui, message);
  assert.equal(result.acked, true); assert.equal(result.retried, false);
  assert.equal(x.outbox().status, 'DELIVERED');
  const attempt = x.obs.db.sql.prepare('SELECT * FROM ui_bundle_export_attempts WHERE build_id=?').get(message.buildId);
  assert.equal(attempt.status, 'DELIVERED'); assert.equal(attempt.builder_version, CURRENT);
  const version = x.ui.db.sql.prepare('SELECT * FROM ui_bundle_versions').get();
  assert.equal(version.builder_version, CURRENT); assert.equal(version.manifest_state, 'SEALED');
  assert.equal(version.source_hash, before.source_hash);
  assert.deepEqual(await x.repo.getBuild(x.legacy.buildId), oldJob);
  assert.deepEqual(x.obs.bucket.data.get(before.object_key), sourceBytes);
  assert.equal(x.outbox().source_hash, before.source_hash);
  const complete = await x.repo.getBuild(message.buildId), puts = x.ui.bucket.puts;
  const pins = x.obs.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_artifact_pins').get().n;
  await x.repo.supersede(message.buildId);
  assert.deepEqual(await x.repo.getBuild(message.buildId), complete);
  assert.equal((await consume(x.ui, message)).acked, true);
  assert.equal(x.ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n, 1);
  assert.equal(x.ui.bucket.puts, puts);
  assert.equal(x.obs.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_artifact_pins').get().n, pins);
});

test('v4 ACK after v5 activation is stale before and after the v5 completion', async t => {
  const x = await fixture(t);
  await x.obs.service.recoverBundleExports(x.obs.env);
  const message = x.obs.queue.messages[0].body;
  const early = await sourceAck(x, x.legacy, 'REJECTED');
  assert.equal(early.status, 200); assert.equal((await early.json()).applied, false);
  assert.equal(x.outbox().status, 'PUBLISHED'); assert.equal(x.outbox().active_build_id, message.buildId);
  assert.equal((await consume(x.ui, message)).acked, true);
  const late = await sourceAck(x, x.legacy, 'REJECTED');
  assert.equal((await late.json()).applied, false);
  assert.equal(x.outbox().status, 'DELIVERED'); assert.equal(x.outbox().active_build_id, message.buildId);
});

test('historical v4 messages require authentication and leave FAILED diagnostics unchanged', async t => {
  const x = await fixture(t), before = await x.repo.getBuild(x.legacy.buildId);
  for (const protocol of [x.obs.p.protocol, x.ui.p.protocol]) {
    assert.equal(await protocol.messageBuilderVersion(x.legacy), PREVIOUS);
    await protocol.validateMessage(x.legacy, support.SECRET);
    await assert.rejects(protocol.validateMessage({ ...x.legacy, signature: '0'.repeat(64) }, support.SECRET),
      error => error.code === 'UI_BUNDLE_AUTH_INVALID');
  }
  const result = await consume(x.ui, x.legacy);
  assert.equal(result.acked, true); assert.equal(result.retried, false);
  assert.deepEqual(await x.repo.getBuild(x.legacy.buildId), before);
  assert.equal(x.ui.db.sql.prepare('SELECT COUNT(*) n FROM ui_bundle_versions').get().n, 0);
  assert.equal(x.outbox().status, 'NEEDS_ATTENTION');
});

test('DELIVERED v4 export is not reopened by the builder release', async t => {
  const x = await fixture(t);
  x.obs.db.sql.prepare("UPDATE ui_bundle_export_outbox SET status='DELIVERED' WHERE capture_id=?").run(x.ref.captureId);
  const before = x.outbox();
  await x.obs.service.recoverBundleExports(x.obs.env);
  assert.deepEqual(x.outbox(), before);
  assert.equal(x.obs.queue.messages.length, 0);
});

test('twenty current terminal failures do not hide a later v4 builder candidate', async t => {
  const x = await fixture(t), blocked = [];
  for (let i = 0; i < 20; i++) blocked.push(await addTerminalCandidate(x, i));
  await x.obs.service.recoverBundleExports(x.obs.env);
  assert.equal(x.obs.queue.messages.length, 1);
  assert.equal(x.obs.queue.messages[0].body.source.captureId, x.ref.captureId);
  assert.equal(x.outbox().active_builder_version, CURRENT);
  for (const b of blocked) {
    const row = x.obs.db.sql.prepare('SELECT status,active_build_id FROM ui_bundle_export_outbox WHERE capture_id=?').get(b.ref.captureId);
    assert.equal(row.status, 'NEEDS_ATTENTION'); assert.equal(row.active_build_id, b.message.buildId);
  }
});

test('a different profile revision remains eligible behind twenty current terminal failures', async t => {
  const x = await fixture(t);
  x.obs.db.sql.prepare("UPDATE ui_bundle_export_outbox SET status='DELIVERED' WHERE capture_id=?").run(x.ref.captureId);
  for (let i = 0; i < 20; i++) await addTerminalCandidate(x, i);
  const previousProfile = await addTerminalCandidate(x, 25, 2);
  await x.obs.service.recoverBundleExports(x.obs.env);
  assert.equal(x.obs.queue.messages.length, 1);
  const message = x.obs.queue.messages[0].body;
  assert.equal(message.source.captureId, previousProfile.ref.captureId);
  assert.equal(message.profile.revision, 1);
  assert.notEqual(message.buildId, previousProfile.message.buildId);
});

test('current v5 rejection stays terminal and producer failures/revocations are not reopened', async t => {
  const x = await fixture(t);
  await x.obs.service.recoverBundleExports(x.obs.env);
  const message = x.obs.queue.messages[0].body;
  assert.equal((await sourceAck(x, message, 'REJECTED')).status, 200);
  await x.obs.service.recoverBundleExports(x.obs.env);
  assert.equal(x.obs.queue.messages.length, 1);
  assert.equal(x.outbox().status, 'NEEDS_ATTENTION');
  x.obs.db.sql.prepare("UPDATE ui_bundle_export_outbox SET active_build_id=?,active_builder_version=?,last_error='UI_CONTRACT_INVALID' WHERE capture_id=?")
    .run(x.legacy.buildId, PREVIOUS, x.ref.captureId);
  await x.obs.service.recoverBundleExports(x.obs.env);
  assert.equal(x.obs.queue.messages.length, 1);
  x.obs.db.sql.prepare('UPDATE ui_bundle_export_outbox SET last_error=NULL,revoked_at=1 WHERE capture_id=?').run(x.ref.captureId);
  await x.obs.service.recoverBundleExports(x.obs.env);
  assert.equal(x.obs.queue.messages.length, 1);
});

test('source route failure logs only safe operation/code/status and deployed release metadata', async t => {
  const x = await fixture(t), records = [], original = console.info;
  console.info = line => records.push(JSON.parse(line));
  try {
    const request = await x.obs.p.protocol.signedRequest('https://source.test/internal/ui-bundles/v1/snapshot',
      { ...x.ref, unexpected: 'https://private.invalid/DO_NOT_LOG_SECRET' }, support.SECRET, 'source');
    const response = await x.obs.service.routeBundleSource(request, x.obs.env);
    assert.equal(response.status, 400);
    const event = records.find(row => row.event === 'source.route_failed');
    assert.equal(event.operation, 'snapshot'); assert.equal(event.code, 'UI_CONTRACT_INVALID');
    assert.equal(event.httpStatus, 400); assert.equal(event.service, 'qagent-observation');
    assert.equal(event.serviceVersion, '0.1.18'); assert.equal(event.release, 'qagent-page-root-recovery-2.0.26-fix1');
    assert.equal(JSON.stringify(records).includes('DO_NOT_LOG_SECRET'), false);
    assert.equal(JSON.stringify(records).includes('private.invalid'), false);
  } finally { console.info = original; }
});
