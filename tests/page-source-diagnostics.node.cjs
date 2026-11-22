const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, environment, protocol, pc, support } = require('./observed-support.cjs');
const build = process.env.QAGENT_UI_BUILD;
const { SourceClient } = require(path.join(build, 'src/services/sourceClient.js'));
const release = require(path.join(build, 'src/release.js'));
const { route } = require(path.join(build, 'src/index.js'));

const privateValue = 'NEVER_LOG_RESPONSE_BODY_OR_HEADER_VALUE';
const failureCases = [
  { name: 'upstream HTTP 400', stage: 'fetch', httpStatus: 400, errorStatus: 400, code: 'UI_CONTRACT_INVALID',
    response: () => protocol.json({ status: 'error', code: 'UI_CONTRACT_INVALID', detail: privateValue }, 400) },
  { name: 'oversized HTTP 200 response', stage: 'read', httpStatus: 200, errorStatus: 413, code: 'UI_BUNDLE_UPSTREAM_TOO_LARGE',
    response: () => new Response('{}', { status: 200, headers: { 'content-length': String(pc.PAGE_LIMITS.sourcePartBytes + 1), 'x-private-test': privateValue } }) },
  { name: 'invalid JSON in HTTP 200', stage: 'decode', httpStatus: 200, errorStatus: 400, code: 'UI_CONTRACT_INVALID',
    response: () => new Response('{"value":"' + privateValue + '"', { status: 200 }) },
  { name: 'invalid contract in HTTP 200', stage: 'contract', httpStatus: 200, errorStatus: 400, code: 'UI_CONTRACT_INVALID',
    response: data => protocol.json({ ...data.root, unsupportedField: privateValue }) },
];

for (const scenario of failureCases) {
  test('build diagnostics distinguish ' + scenario.name, async () => {
    const data = await fixture({ environmentManaged: true, checkpoint: true });
    const ui = await environment(data);
    const originalFetch = ui.env.OBSERVATION_SERVICE.fetch;
    const calls = [];
    ui.env.OBSERVATION_SERVICE.fetch = async request => {
      const operation = new URL(request.url).pathname.split('/').pop();
      calls.push(operation);
      return operation === 'snapshot' ? scenario.response(data) : originalFetch(request);
    };
    const logs = [], originalInfo = console.info;
    try {
      const message = await protocol.makeMessage(data.ref, protocol.DEFAULT_PROFILE, support.SECRET);
      console.info = text => logs.push(JSON.parse(text));
      let delivery;
      try { delivery = await ui.consume(message); }
      finally { console.info = originalInfo; }
      assert.equal(delivery.retried, true);
      assert.equal(delivery.acked, false);
      assert.deepEqual(calls, ['snapshot']);
      assert.equal(ui.stored().row ?? null, null);
      const job = ui.db.sql.prepare('SELECT status,last_error FROM ui_bundle_builds WHERE build_id=?').get(message.buildId);
      assert.equal(job.status, 'PENDING');
      assert.equal(job.last_error, scenario.code);
      for (const event of ['build.stage_failed', 'build.retry']) {
        const log = logs.find(item => item.event === event);
        assert.ok(log, event);
        assert.equal(log.stage, 'source.page_root.' + scenario.stage);
        assert.equal(log.code, scenario.code);
        assert.equal(log.httpStatus, scenario.httpStatus);
        assert.equal(log.errorStatus, scenario.errorStatus);
        assert.equal(log.service, release.SERVICE_NAME);
        assert.equal(log.serviceVersion, release.SERVICE_VERSION);
        assert.equal(log.release, release.RELEASE_ID);
        for (const forbidden of ['source', 'payload', 'headers', 'body', 'message']) assert.equal(Object.hasOwn(log, forbidden), false);
      }
      const serialized = JSON.stringify(logs);
      for (const sensitive of [privateValue, support.SECRET, data.descriptor.entryUrl]) assert.equal(serialized.includes(sensitive), false);
    } finally {
      console.info = originalInfo;
      ui.close();
    }
  });
}

test('page source fetch does not label a local signing failure as an HTTP response', async () => {
  const data = await fixture({ environmentManaged: true });
  let calls = 0;
  const client = new SourceClient({ UI_BUNDLE_SOURCE_SECRET: 'too-short', OBSERVATION_SERVICE: { fetch: async () => { calls++; return protocol.json(data.root); } } });
  const failed = [];
  await assert.rejects(client.loadPage(data.ref, async (stage, run, diagnostics) => {
    try { return await run(); }
    catch (error) { failed.push({ stage, httpStatus: diagnostics.httpStatus, errorStatus: error.status, code: error.code }); throw error; }
  }), error => error.code === 'UI_BUNDLE_AUTH_UNAVAILABLE');
  assert.equal(calls, 0);
  assert.deepEqual(failed, [{ stage: 'source.page_root.fetch', httpStatus: null, errorStatus: 503, code: 'UI_BUNDLE_AUTH_UNAVAILABLE' }]);
});

test('loadPage remains compatible without a StageRunner and preserves segment data', async () => {
  const data = await fixture({ environmentManaged: true, checkpoint: true });
  data.descriptor.segment = { logicalJourneyId: 'uij_diagnostic_test', segmentIndex: 0, previousCaptureId: null };
  await data.rehash();
  const ui = await environment(data);
  try {
    const root = await new SourceClient(ui.env).loadPage(data.ref);
    assert.deepEqual({ ...root.capture.descriptor.segment }, data.descriptor.segment);
    assert.equal(root.counts.referencedArtifacts, data.root.counts.referencedArtifacts);
  } finally { ui.close(); }
});

test('both health routes identify the release, package version and active environment builder', async () => {
  // The compiler helper intentionally replaces package.json in its output directory.
  // Compare the release marker against the original project package instead.
  const pkg = JSON.parse(fs.readFileSync(path.join(process.env.QAGENT_UI_ROOT, 'package.json'), 'utf8'));
  assert.equal(release.SERVICE_NAME, 'qagent-ui');
  assert.equal(release.SERVICE_VERSION, pkg.version);
  assert.equal(release.RELEASE_ID, 'qagent-ui-test-design-td1-0.2.0');
  for (const pathname of ['/health', '/v1/qagent-ui/health']) {
    const response = await route(new Request('https://ui.test' + pathname), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.version, pkg.version);
    assert.equal(body.service, release.SERVICE_NAME);
    assert.equal(body.release, release.RELEASE_ID);
    assert.equal(body.builderVersion, protocol.ENVIRONMENT_BUILDER_VERSION);
    assert.equal(body.capabilities.pageCaptureSegments, true);
  }
});
