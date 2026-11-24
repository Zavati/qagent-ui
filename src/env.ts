export interface UiBundleEnv {
    UI_DB: D1Database;
    UI_BUNDLES: R2Bucket;
    OBSERVATION_SERVICE: Fetcher;
    UI_BUNDLE_BUILD_QUEUE: Queue;
    UI_BUNDLE_SOURCE_SECRET?: string;
    UI_BUNDLE_OPERATOR_SECRET?: string;
    /** HMAC for scoped Test Design service calls; never the public operator credential. */
    UI_TEST_DESIGN_SECRET?: string;
    /** Dedicated service-to-service execution evidence authority; never a browser/CI token. */
    UI_EXECUTION_SECRET?: string;
    UI_BUNDLE_BUILD_ENABLED?: string;
    UI_BUNDLE_QUEUE_NAME?: string;
    UI_BUNDLE_DLQ_NAME?: string;
}
