-- Dedicated qagent-ui DB; never apply this migration to OBSERVATION_DB or QAGENT_DB.
CREATE TABLE ui_bundle_builds (
 build_id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 environment_id TEXT NOT NULL,
 capture_id TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 message_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','BUILDING','COMPLETE','FAILED')),
 bundle_version_id TEXT,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 next_dispatch_at INTEGER NOT NULL,
 last_error TEXT
);
CREATE INDEX ui_bundle_builds_dispatch ON ui_bundle_builds(status,next_dispatch_at,lease_until);
CREATE TABLE ui_journeys (
 journey_id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 environment_id TEXT NOT NULL,
 capture_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(organization_id,project_id,environment_id,capture_id)
);
CREATE TABLE ui_bundle_versions (
 bundle_version_id TEXT PRIMARY KEY,
 bundle_id TEXT NOT NULL,
 journey_id TEXT NOT NULL REFERENCES ui_journeys(journey_id),
 journey_version_id TEXT NOT NULL,
 build_id TEXT NOT NULL UNIQUE REFERENCES ui_bundle_builds(build_id),
 organization_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 environment_id TEXT NOT NULL,
 capture_id TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 builder_version TEXT NOT NULL,
 manifest_state TEXT NOT NULL CHECK(manifest_state IN ('SEALED','DIAGNOSTIC')),
 qualification_state TEXT NOT NULL CHECK(qualification_state IN ('READY','NEEDS_ATTENTION')),
 qualification_json TEXT NOT NULL,
 manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),
 object_sha256 TEXT NOT NULL CHECK(length(object_sha256)=64),
 object_key TEXT NOT NULL UNIQUE,
 byte_length INTEGER NOT NULL CHECK(byte_length>0),
 created_at INTEGER NOT NULL
);
CREATE INDEX ui_bundles_scope ON ui_bundle_versions(organization_id,project_id,environment_id,capture_id,bundle_version_id);
CREATE TABLE ui_bundle_access (
 bundle_version_id TEXT PRIMARY KEY REFERENCES ui_bundle_versions(bundle_version_id),
 state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','REVOKED')),
 updated_at INTEGER NOT NULL
);
CREATE TABLE ui_bundle_deadletters (
 message_id TEXT PRIMARY KEY,
 build_id TEXT,
 reason_code TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE ui_bundle_audit (
 audit_id TEXT PRIMARY KEY,
 bundle_version_id TEXT NOT NULL REFERENCES ui_bundle_versions(bundle_version_id),
 event TEXT NOT NULL,
 reason_code TEXT,
 created_at INTEGER NOT NULL
);
-- @statement
CREATE TRIGGER ui_bundle_versions_immutable BEFORE UPDATE ON ui_bundle_versions BEGIN
 SELECT RAISE(ABORT,'UI_BUNDLE_VERSION_IMMUTABLE');
END;
-- @statement
CREATE TRIGGER ui_bundle_versions_no_delete BEFORE DELETE ON ui_bundle_versions BEGIN
 SELECT RAISE(ABORT,'UI_BUNDLE_EXPLICIT_RETENTION_REQUIRED');
END;
