-- Read-only validation for the existing capture and both build revisions.
-- Run from qagent-ui:
-- npx wrangler d1 execute qagent-ui-dev --remote --json --file=tools/sql/validate-page-root-recovery-2.0.26-fix1.sql

WITH builds AS (
  SELECT b.capture_id, b.build_id, b.status AS build_status, b.last_error,
         b.created_at, b.bundle_version_id AS build_bundle_id,
         v.bundle_version_id, v.builder_version, v.manifest_state, v.qualification_state,
         CASE WHEN json_valid(b.message_json) THEN b.message_json ELSE '{}' END AS m,
         CASE WHEN json_valid(v.qualification_json) THEN v.qualification_json ELSE '{}' END AS q
  FROM ui_bundle_builds b
  LEFT JOIN ui_bundle_versions v
         ON v.build_id=b.build_id AND v.capture_id=b.capture_id
        AND v.organization_id=b.organization_id AND v.project_id=b.project_id
        AND v.environment_id=b.environment_id
  WHERE b.capture_id='uic_d314dfa9-986e-4532-ac30-202f2cf72640'
    AND b.organization_id='org_0eb1725f-7e9a-49ad-a562-59364919e966'
    AND b.project_id='prj_d1904281-5d4c-4d7c-8999-c45126e87322'
    AND b.environment_id='env_a4ca2ef4-c65e-4778-9bdd-d74e5bfc2ec0'
)
SELECT capture_id, build_id, build_status, last_error, builder_version,
       datetime(created_at/1000.0,'unixepoch') AS created_utc,
       build_id='uib_893e2d5a19cbbc420ec3a0fb94cb1d235a06f5fca0efe825d6bc319fb4c8b27b' AS expected_v5_build,
       json_extract(m,'$.source.sourceHash')='7451d67ec14b8b384d550685299acb62ac27fb43eae9ed59f8bd03786189a711' AS source_hash_preserved,
       bundle_version_id, build_bundle_id=bundle_version_id AS bundle_pointer_matches,
       manifest_state, qualification_state,
       json_extract(q,'$.dimensions.integrity.status') AS integrity_state,
       json_extract(q,'$.counts.referencedArtifacts') AS referenced_artifacts,
       json_extract(q,'$.counts.verifiedArtifacts') AS verified_artifacts,
       json_extract(q,'$.counts.businessFixtures') AS business_fixtures,
       json_extract(q,'$.counts.usableFixtures') AS usable_fixtures,
       json_extract(q,'$.counts.unavailableFixtures') AS unavailable_fixtures,
       json_extract(q,'$.uses.fixtureMocks.status') AS fixture_mocks_state,
       json_extract(q,'$.uses.journeyExecution.status') AS journey_execution_state,
       json_extract(q,'$.meaning') AS qualification_meaning,
       json_extract(q,'$.uiTestPassed') AS ui_test_passed,
       json_extract(q,'$.reasonCodes') AS reason_codes
FROM builds
ORDER BY created_at DESC, build_id;
