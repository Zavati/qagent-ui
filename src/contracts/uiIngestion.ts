import { validateEventsAny, validateCompleteAny } from './uiPageCopy';
import type { ObservedPrivacyMode } from './observedPrivacy';
import { digestJson, fail } from './canonical';
import { object, id, hash, UI_LIMITS, validateCaptureComplete, validateEvents, type CaptureComplete, type EventsInput, type UiEvent } from './uiCapture';

/** Additive protocol. Receipt means durable publication, NOT successful processing. */
export const INGESTION_VERSION = 'qagent.ui-ingestion.v1' as const;
export const INGESTION_HEADER = 'X-QAgent-UI-Ingestion' as const;
export const RECEIPT_VERSION = 'qagent.ui-ingestion-receipt.v1' as const;
export const MESSAGE_VERSION = 'qagent.ui-ingestion-message.v1' as const;
export const EMPTY_EVENT_CHAIN = '0'.repeat(64);
export type IngestionKind = 'EVENTS' | 'SEAL' | 'INTERRUPT';
export interface SealInput {
    contractVersion: typeof INGESTION_VERSION;
    operationId: string;
    expectedEvents: number;
    lastSequence: number;
    eventChainHash: string;
    completion: CaptureComplete;
}
export interface InterruptInput {
    contractVersion: typeof INGESTION_VERSION;
    operationId: string;
    reason: 'UI_WORKER_RESTART_GAP';
}
export interface IngestionReceipt {
    contractVersion: typeof RECEIPT_VERSION;
    status: 'accepted';
    durability: 'QUEUE_PUBLISHED';
    captureId: string;
    receiptId: string;
    operationId: string;
    kind: IngestionKind;
    payloadHash: string;
    receivedEvents: number;
    firstSequence: number | null;
    lastSequence: number | null;
    processing: 'PENDING' | 'PROCESSED' | 'FAILED';
}
export function batchBounds(input: EventsInput, mode:ObservedPrivacyMode='FULL_TEST'): { first: number; last: number; count: number } {
    validateEventsAny(input,mode);
    const first = input.events[0].sequence;
    if (input.events.some((e, i) => e.sequence !== first + i) || first + input.events.length > UI_LIMITS.captureEvents)
        fail('UI_SEQUENCE_RANGE_INVALID', 409);
    return { first, last: first + input.events.length - 1, count: input.events.length };
}
export async function nextEventChain(previous: string, event: Pick<UiEvent, 'sequence' | 'contentHash'>): Promise<string> {
    return digestJson([previous, event.sequence, event.contentHash]);
}
export function validateSeal(value: unknown): SealInput {
    const v = object(value, ['contractVersion', 'operationId', 'expectedEvents', 'lastSequence', 'eventChainHash', 'completion']);
    if (v.contractVersion !== INGESTION_VERSION) fail('UI_CONTRACT_VERSION_UNSUPPORTED');
    id(v.operationId); hash(v.eventChainHash);
    if (!Number.isSafeInteger(v.expectedEvents) || v.expectedEvents < 0 || v.expectedEvents > UI_LIMITS.captureEvents || v.lastSequence !== v.expectedEvents - 1)
        fail('UI_SEQUENCE_RANGE_INVALID', 409);
    validateCompleteAny(v.completion);
    if (v.operationId !== v.completion.operationId) fail('UI_IDEMPOTENCY_CONFLICT', 409);
    return v as SealInput;
}
export function validateInterrupt(value: unknown): InterruptInput {
    const v = object(value, ['contractVersion', 'operationId', 'reason']);
    if (v.contractVersion !== INGESTION_VERSION || v.reason !== 'UI_WORKER_RESTART_GAP') fail('UI_CONTRACT_VERSION_UNSUPPORTED');
    id(v.operationId); return v as InterruptInput;
}
export async function assertReceipt(value: unknown, captureId: string, kind: IngestionKind, input: EventsInput | SealInput | InterruptInput, mode:ObservedPrivacyMode='FULL_TEST'): Promise<IngestionReceipt> {
    const r = object(value, ['contractVersion', 'status', 'durability', 'captureId', 'receiptId', 'operationId', 'kind', 'payloadHash', 'receivedEvents', 'firstSequence', 'lastSequence', 'processing']);
    const b = kind === 'EVENTS' ? batchBounds(input as EventsInput,mode) : null;
    id(r.receiptId);
    if (r.contractVersion !== RECEIPT_VERSION || r.status !== 'accepted' || r.durability !== 'QUEUE_PUBLISHED'
        || r.captureId !== captureId || r.operationId !== input.operationId || r.kind !== kind
        || r.payloadHash !== await digestJson(input) || r.receivedEvents !== (b?.count ?? 0)
        || r.firstSequence !== (b?.first ?? null) || r.lastSequence !== (b?.last ?? null)
        || !['PENDING', 'PROCESSED', 'FAILED'].includes(r.processing)) fail('UI_DURABLE_ACK_MISMATCH', 409);
    return r as IngestionReceipt;
}
