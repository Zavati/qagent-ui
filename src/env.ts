export interface UiBundleEnv {
    UI_DB: D1Database;
    UI_BUNDLES: R2Bucket;
    OBSERVATION_SERVICE: Fetcher;
    UI_BUNDLE_BUILD_QUEUE: Queue;
    UI_BUNDLE_SOURCE_SECRET?: string;
    UI_BUNDLE_OPERATOR_SECRET?: string;
    UI_BUNDLE_BUILD_ENABLED?: string;
    UI_BUNDLE_QUEUE_NAME?: string;
    UI_BUNDLE_DLQ_NAME?: string;
}
