const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, h } = require('./test-design-support.cjs');
const build = process.env.QAGENT_UI_BUILD;
const worker = require(path.join(build, 'src/index.js')).default;
const { compileObservedPlan } = require(path.join(build, 'src/services/uiObservedPlan.js'));
const { readExecutionSource, readExecutionArtifact, EXECUTION_EVIDENCE_TIMEOUT_MS } = require(path.join(build, 'src/services/uiExecutionEvidence.js'));
const { Repository } = require(path.join(build, 'src/storage/repository.js'));
const SECRET = 'synthetic-execution-evidence-secret-tests-only';

async function deployed(options = {}) {
  const d = await fixture(options);
  const ui = await h.environment(d.base);
  ui.env.UI_EXECUTION_SECRET = SECRET;
  await ui.consume(await h.protocol.makeMessage(d.base.ref, h.protocol.DEFAULT_PROFILE, h.support.SECRET));
  const { row, envelope } = ui.stored();
  assert.ok(row, 'test bundle must be built before testing execution reads');
  const plan = await compileObservedPlan(envelope);
  const input = { scope: d.scope, source: plan.source, specification: plan.specification, specificationHash: plan.specificationHash };
  return { d, ui, row, envelope, plan, input };
}
async function request(env, op, input, secret = SECRET, principal = 'execution') {
  const req = await h.protocol.signedRequest('https://ui.internal/internal/ui/v1/execution/' + op, input, secret, principal);
  return worker.fetch(req, env);
}
async function code(response) { return (await response.json()).code; }

test('execution source is the complete immutable manifest and is separate from Console preview', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed({ body: { value: 'full-observed-value-' + 'x'.repeat(4000) } });
  try {
    const response = await request(c.ui.env, 'source', c.input);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.contractVersion, 'qagent.ui-execution-source.v1');
    assert.deepEqual(result.envelope, c.envelope);
    assert.deepEqual(result.source, c.plan.source);
    assert.equal(result.specificationHash, c.plan.specificationHash);
    assert.equal(result.envelope.previewOnly, undefined);
    assert.equal(result.envelope.bundle.artifacts.length, c.envelope.bundle.artifacts.length);
  } finally { c.ui.close(); }
});

test('artifact route returns all bytes, verified length/hash and authenticated content headers', async t => {
  t.mock.method(console, 'info', () => {});
  const value = 'a'.repeat(4000) + 'final-observed-value';
  const c = await deployed({ body: { value } });
  try {
    const artifactId = c.d.body.artifactId;
    const response = await request(c.ui.env, 'artifact', { ...c.input, artifactId });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(bytes, c.d.bytes.get(artifactId));
    assert.equal(JSON.parse(bytes).value, value);
    assert.equal(response.headers.get('X-QAgent-SHA256'), await h.c.sha256(bytes));
    assert.equal(Number(response.headers.get('Content-Length')), bytes.length);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  } finally { c.ui.close(); }
});

test('execution reads require their own configured HMAC principal and reject public access', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    for (const [secret, principal] of [[h.support.OPS, 'operator'], [SECRET, 'test-design'], ['incorrect-execution-secret-for-tests-only', 'execution']]) {
      assert.equal((await request(c.ui.env, 'source', c.input, secret, principal)).status, 401);
    }
    const publicRequest = await h.protocol.signedRequest('https://ui.internal/v1/qagent-ui/execution/source', c.input, SECRET, 'execution');
    assert.equal((await worker.fetch(publicRequest, c.ui.env)).status, 404);
    delete c.ui.env.UI_EXECUTION_SECRET;
    const response = await request(c.ui.env, 'source', c.input);
    assert.equal(response.status, 503);
    assert.equal(await code(response), 'UI_EXECUTION_NOT_CONFIGURED');
  } finally { c.ui.close(); }
});

test('scope, source identity and the exact specification hash are all enforced', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    assert.equal((await request(c.ui.env, 'source', { ...c.input, scope: { ...c.input.scope, environmentId: 'env_other' } })).status, 403);
    let response = await request(c.ui.env, 'source', { ...c.input, specificationHash: '0'.repeat(64) });
    assert.equal(response.status, 409);
    assert.equal(await code(response), 'UI_EXECUTION_SPECIFICATION_HASH_MISMATCH');
    const changed = structuredClone(c.input);
    changed.source.sourceHash = changed.specification.source.sourceHash = '0'.repeat(64);
    changed.specificationHash = await h.c.digestJson(changed.specification);
    response = await request(c.ui.env, 'source', changed);
    assert.equal(response.status, 409);
    assert.equal(await code(response), 'UI_EXECUTION_SOURCE_CHANGED');
  } finally { c.ui.close(); }
});

test('even a newly hashed edited plan cannot invent its relation to the source', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    const changed = structuredClone(c.input);
    changed.specification.limitations = [...changed.specification.limitations, 'UI_INVENTED_TEST_LIMITATION'];
    changed.specificationHash = await h.c.digestJson(changed.specification);
    const response = await request(c.ui.env, 'source', changed);
    assert.notEqual(response.status, 200);
  } finally { c.ui.close(); }
});

test('unknown artifacts and tampered observed bytes cannot enter an execution', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    let response = await request(c.ui.env, 'artifact', { ...c.input, artifactId: 'uia_unreferenced' });
    assert.equal(response.status, 403);
    assert.equal(await code(response), 'UI_BUNDLE_ARTIFACT_NOT_REFERENCED');
    const artifactId = c.d.body.artifactId;
    const bytes = Buffer.from(c.d.bytes.get(artifactId));
    bytes[0] ^= 1;
    c.d.bytes.set(artifactId, bytes);
    response = await request(c.ui.env, 'artifact', { ...c.input, artifactId });
    assert.equal(response.status, 409);
    assert.equal(await code(response), 'UI_BUNDLE_ARTIFACT_HASH_MISMATCH');
  } finally { c.ui.close(); }
});

test('revocation before a read blocks source and artifact access', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    await new Repository(c.ui.db).revoke(c.d.scope, c.row.bundle_version_id);
    assert.equal((await request(c.ui.env, 'source', c.input)).status, 410);
    assert.equal((await request(c.ui.env, 'artifact', { ...c.input, artifactId: c.d.body.artifactId })).status, 410);
  } finally { c.ui.close(); }
});

test('revocation while bytes are in flight prevents releasing them', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    const original = c.ui.env.OBSERVATION_SERVICE.fetch;
    c.ui.env.OBSERVATION_SERVICE = { fetch: async req => {
      const response = await original(req);
      if (new URL(req.url).pathname.endsWith('/artifact')) await new Repository(c.ui.db).revoke(c.d.scope, c.row.bundle_version_id);
      return response;
    } };
    const response = await request(c.ui.env, 'artifact', { ...c.input, artifactId: c.d.body.artifactId });
    assert.equal(response.status, 410);
    assert.equal(await code(response), 'UI_BUNDLE_ACCESS_REVOKED');
  } finally { c.ui.close(); }
});

test('whole-operation deadline bounds a binding that ignores cancellation', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    const schedule = globalThis.setTimeout;
    t.mock.method(globalThis, 'setTimeout', (fn, delay, ...args) => schedule(fn, delay === EXECUTION_EVIDENCE_TIMEOUT_MS ? 20 : delay, ...args));
    c.ui.env.UI_BUNDLES = { get: async () => new Promise(() => {}) };
    await assert.rejects(readExecutionSource(c.ui.env, c.input), e => e.code === 'UI_EXECUTION_EVIDENCE_TIMEOUT' && e.status === 504);
  } finally { c.ui.close(); }
});

test('parent abort interrupts reads without manufacturing an empty source', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readExecutionSource(c.ui.env, c.input, controller.signal), e => e.code === 'UI_EXECUTION_EVIDENCE_TIMEOUT');
    await assert.rejects(readExecutionArtifact(c.ui.env, { ...c.input, artifactId: c.d.body.artifactId }, controller.signal), e => e.code === 'UI_EXECUTION_EVIDENCE_TIMEOUT');
  } finally { c.ui.close(); }
});

test('legacy v1 and unknown request fields are not silently interpreted as v2', async t => {
  t.mock.method(console, 'info', () => {});
  const c = await deployed();
  try {
    const legacy = structuredClone(c.input);
    legacy.specification.contractVersion = 'qagent.ui-test-design.v1';
    legacy.specificationHash = await h.c.digestJson(legacy.specification);
    assert.notEqual((await request(c.ui.env, 'source', legacy)).status, 200);
    assert.notEqual((await request(c.ui.env, 'source', { ...c.input, sourceUrl: 'https://external.example.test' })).status, 200);
  } finally { c.ui.close(); }
});
