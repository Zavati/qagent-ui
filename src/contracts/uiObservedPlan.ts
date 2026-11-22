import type { DesignSource, ModeReadiness } from './uiTestDesign';
import type { Scope } from './uiCapture';
export { UI_OBSERVED_COMPILER_VERSION, UI_OBSERVED_COMPILATION_VERSION, UI_OBSERVED_SPECIFICATION_VERSION, UI_OBSERVED_DEFAULT_PROFILE,
  UI_OBSERVED_RULE_SET_VERSION, UI_OBSERVED_SECTIONS, validateUiObservedProfileShape, validateUiObservedPlanShape, validateUiObservedPlanPageShape } from './uiObservedPlanGuard.js';
export interface ObservedPlanProfile {contractVersion:'qagent.ui-test-design-profile.v2';revision:2;comparisonPolicyVersion:'qagent_ui_observed_comparison_v1';layoutTolerancePx:number;coveragePolicy:'ALL_OBSERVED';}
export interface ObservedPlanSection {section:string;pointer:string;count:number;rule:string;}
export interface ObservedPlanSpecification {
  contractVersion:'qagent.ui-test-design.v2';compilerVersion:'qagent_ui_test_design_compiler_v2';templateVersion:'qagent_ui_observed_templates_v2';adapterVersion:'qagent_ui_page_evidence_adapter_v1';canonicalizerVersion:'qagent.ui-canonical-json.v1';
  scope:Scope;source:DesignSource;profile:ObservedPlanProfile;executionModes:['UI_REPLAY','UI_LIVE'];entryUrl:string;sourceBuildRef:string|null;
  preparation:Record<string,unknown>;
  plan:{contractVersion:'qagent.ui-observed-validation-plan.v1';ruleSetVersion:'qagent_ui_observed_validation_rules_v1';selection:'ALL_OBSERVED';expectedValues:'IMMUTABLE_SOURCE_REFERENCES';expansion:'PAGED';unknownData:'PENDING_WITH_REASON';unstableEvidence:'PENDING_WITH_REASON';silentOmissionAllowed:false;completion:'ALL_SECTIONS_AND_ARTIFACT_CONTENT';pendingCannotPass:true;sections:ObservedPlanSection[];};
  evidenceVerification:{manifest:'VERIFIED';artifactBytes:'VERIFIED_AT_BUNDLE_ASSEMBLY';artifactBytesRecheckedDuringCompilation:false};
  coverage:Record<string,number>;limitations:string[];readiness:{UI_REPLAY:ModeReadiness;UI_LIVE:ModeReadiness};executionPerformed:false;
}
export interface ObservedPlanCompilation {contractVersion:'qagent.ui-test-design-compilation.v2';compilerVersion:'qagent_ui_test_design_compiler_v2';outcome:'COMPILED';source:DesignSource;specification:ObservedPlanSpecification;specificationHash:string;summary:{coverage:Record<string,number>;limitations:string[];reasonCodes:string[]};executionPerformed:false;}
export interface ObservedPlanItem {index:number;id:string;sourceRef:{manifestHash:string;pointer:string;artifactId:string|null;sha256:string|null;byteLength:number|null};validation:{rule:string;status:'PLANNED'|'PENDING';reasonCodes:string[]};preview:Record<string,unknown>;}
export interface ObservedPlanPage {contractVersion:'qagent.ui-test-design-plan-page.v1';source:DesignSource;specificationHash:string;section:string;artifactId:string|null;items:ObservedPlanItem[];totalItems:number;nextCursor:string|null;executionPerformed:false;}
