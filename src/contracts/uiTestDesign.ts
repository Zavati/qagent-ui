/** UI-TD-1: finite, declarative characterization; never JavaScript or inferred business rules. */
import { canonicalJson, fail } from './canonical';
import { object, type Scope } from './uiCapture';
export const TEST_DESIGN_VERSION = 'qagent.ui-test-design.v1' as const;
export const COMPILATION_VERSION = 'qagent.ui-test-design-compilation.v1' as const;
export const COMPILER_VERSION = 'qagent_ui_test_design_compiler_v1' as const;
export const TEMPLATE_VERSION = 'qagent_ui_observed_templates_v1' as const;
export const ADAPTER_VERSION = 'qagent_ui_page_evidence_adapter_v1' as const;
export const COMPARISON_VERSION = 'qagent_ui_observed_comparison_v1' as const;
export const TD_PROFILE_VERSION = 'qagent.ui-test-design-profile.v1' as const;
export const ACTION_OPERATORS = ['CLICK','FILL','SELECT','CHECK','NAVIGATE','SCROLL'] as const;
export const ASSERTION_OPERATORS = ['ELEMENT_PRESENT','ATTRIBUTE_EQUALS','TEXT_EQUALS','FORM_VALUE_EQUALS','CHECKED_EQUALS','BOUNDS_WITHIN_TOLERANCE','STYLE_EQUALS','URL_MATCHES','REQUEST_MATCHES','FIXTURE_CONSUMPTION_MATCHES'] as const;
export type ActionOperator = typeof ACTION_OPERATORS[number];
export type AssertionOperator = typeof ASSERTION_OPERATORS[number];
export type Mode = 'UI_REPLAY'|'UI_LIVE';
export interface TestDesignProfile {
  contractVersion: typeof TD_PROFILE_VERSION;
  revision: 1;
  comparisonPolicyVersion: typeof COMPARISON_VERSION;
  layoutTolerancePx: number;
  maxChecks: number;
  maxNodes: number;
  maxArtifactBytes: number;
}
export const DEFAULT_TEST_DESIGN_PROFILE: TestDesignProfile = Object.freeze({
  contractVersion:TD_PROFILE_VERSION,revision:1,comparisonPolicyVersion:COMPARISON_VERSION,
  layoutTolerancePx:2,maxChecks:2000,maxNodes:25000,maxArtifactBytes:33554432,
});
/** The entire profile is normalized into the specification hash. Unknown fields never disappear. */
export function validateTestDesignProfile(value:unknown=DEFAULT_TEST_DESIGN_PROFILE):TestDesignProfile {
  const p=object(value,['contractVersion','revision','comparisonPolicyVersion','layoutTolerancePx','maxChecks','maxNodes','maxArtifactBytes']);
  if(p.contractVersion!==TD_PROFILE_VERSION||p.revision!==1||p.comparisonPolicyVersion!==COMPARISON_VERSION)fail('UI_TEST_DESIGN_PROFILE_UNSUPPORTED');
  if(typeof p.layoutTolerancePx!=='number'||!Number.isFinite(p.layoutTolerancePx)||p.layoutTolerancePx<0||p.layoutTolerancePx>20)fail('UI_TEST_DESIGN_PROFILE_INVALID');
  for(const [key,min,max] of [['maxChecks',1,5000],['maxNodes',1,50000],['maxArtifactBytes',1024,67108864]] as const)
    if(!Number.isSafeInteger(p[key])||p[key]<min||p[key]>max)fail('UI_TEST_DESIGN_PROFILE_INVALID');
  return JSON.parse(canonicalJson(p)) as TestDesignProfile;
}
export interface DesignSource {scope:Scope;captureId:string;bundleVersionId:string;sourceHash:string;manifestHash:string;}
export interface Context {documentId:string;navigationId:string;frameId:string;stepId:string|null;}
export interface Locator {strategy:'TEST_ID'|'CSS';value:string;observedMatchCount:1;sourceNodeId:string|null;}
export interface ExpectedSource {artifactId:string|null;sha256:string;byteLength:number|null;jsonPointer:string;}
export interface Assertion {
  assertionId:string;operator:AssertionOperator;checkpointId:string|null;stateId:string|null;
  context:Context;locator:Locator|null;expected:unknown;expectedSource:ExpectedSource;
  parameters:Record<string,unknown>;policies:{UI_REPLAY:'FIXED';UI_LIVE:'OBSERVED_DIFF'};required:true;
}
export interface Step {
  stepId:string;operator:ActionOperator;sourceEventId:string;observedSequence:number;context:Context;
  target:Record<string,unknown>|null;input:{artifactId:string;sha256:string;value:unknown}|null;
  destination:string|null;checked:boolean|null;position:unknown;scrollTarget:unknown;clickCount:number|null;
  stateBeforeId:string|null;stateAfterId:string|null;availability:'SUPPORTED'|'UNSUPPORTED';reasonCodes:string[];
}
export interface Exclusion {kind:'ACTION'|'CHECKPOINT'|'NODE'|'OPERATOR'|'CAPABILITY';sourceId:string;reasonCode:string;count:number;}
export interface ModeReadiness {status:'READY'|'REQUIRES_CONFIGURATION'|'BLOCKED';reasonCodes:string[];}
export interface TestDesignSpecification {
  contractVersion:typeof TEST_DESIGN_VERSION;compilerVersion:typeof COMPILER_VERSION;
  templateVersion:typeof TEMPLATE_VERSION;adapterVersion:typeof ADAPTER_VERSION;canonicalizerVersion:string;
  scope:Scope;source:DesignSource;profile:TestDesignProfile;executionModes:['UI_REPLAY','UI_LIVE'];
  entryUrl:string;sourceBuildRef:string|null;preparation:Record<string,unknown>;
  steps:Step[];checkpoints:Record<string,any>[];
  timeline:{kind:'ACTION'|'CHECKPOINT';id:string;observedSequence:number;causalProof:false}[];
  assertions:Assertion[];bindings:[];network:Record<string,any>;evidence:Record<string,any>;
  coverage:Record<string,number>;exclusions:Exclusion[];limitations:string[];
  readiness:{UI_REPLAY:ModeReadiness;UI_LIVE:ModeReadiness};executionPerformed:false;
}
export interface Compilation {
  contractVersion:typeof COMPILATION_VERSION;compilerVersion:typeof COMPILER_VERSION;
  outcome:'COMPILED'|'NO_DESIGN';source:DesignSource;
  specification:TestDesignSpecification|null;specificationHash:string|null;
  summary:{coverage:Record<string,number>;limitations:string[];reasonCodes:string[]};executionPerformed:false;
}
