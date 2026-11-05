/** QAgent UI canonical JSON v1. Not an assertion of RFC 8785 compliance.
 * Sorted UTF-16 keys; JSON number encoding; arrays/duplicate query pairs retained.
 * Raw artifact digests ALWAYS cover uploaded UTF-8 bytes, not this projection.
 */
export const CANONICAL_VERSION = "qagent.ui-canonical-json.v1" as const;
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export class UiError extends Error {
    constructor(public status: number, public code: string) { super(code); this.name = "UiError"; }
}
export function fail(code = "UI_CONTRACT_INVALID", status = 400): never { throw new UiError(status, code); }
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
function validString(s: string): string {
    // Reject unpaired surrogates, including those introduced by JSON escapes.
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const n = s.charCodeAt(++i);
            if (!(n >= 0xdc00 && n <= 0xdfff))
                fail();
        }
        else if (c >= 0xdc00 && c <= 0xdfff)
            fail();
    }
    return s;
}
/** Duplicate object keys are refused before privacy checks; JSON.parse alone loses them. */
export function parseJsonStrict(text: string): Json {
    let pos = 0, nodes = 0;
    const ws = () => { while (/[\x20\t\r\n]/.test(text[pos] ?? "!") && pos < text.length)
        pos++; };
    function str(): string {
        const start = pos++;
        while (pos < text.length) {
            const c = text[pos++];
            if (c === '"') {
                try {
                    return validString(JSON.parse(text.slice(start, pos)));
                }
                catch {
                    return fail();
                }
            }
            if (c === "\\")
                pos++;
        }
        return fail();
    }
    function value(depth: number): Json {
        if (depth > 48 || ++nodes > 100000)
            fail("UI_JSON_COMPLEXITY_LIMIT", 413);
        ws();
        const c = text[pos];
        if (c === '"')
            return str();
        if (c === '{') {
            pos++;
            const result: {
                [key: string]: Json;
            } = Object.create(null);
            ws();
            if (text[pos] === '}') {
                pos++;
                return result;
            }
            while (pos < text.length) {
                ws();
                if (text[pos] !== '"')
                    fail();
                const key = str();
                ws();
                if (forbiddenKeys.has(key) || Object.hasOwn(result, key))
                    fail("UI_JSON_DUPLICATE_OR_UNSAFE_KEY");
                if (text[pos++] !== ':')
                    fail();
                result[key] = value(depth + 1);
                ws();
                const end = text[pos++];
                if (end === '}')
                    return result;
                if (end !== ',')
                    fail();
            }
            return fail();
        }
        if (c === '[') {
            pos++;
            const result: Json[] = [];
            ws();
            if (text[pos] === ']') {
                pos++;
                return result;
            }
            while (pos < text.length) {
                result.push(value(depth + 1));
                ws();
                const end = text[pos++];
                if (end === ']')
                    return result;
                if (end !== ',')
                    fail();
            }
            return fail();
        }
        for (const [word, result] of [["true", true], ["false", false], ["null", null]] as const) {
            if (text.startsWith(word, pos)) {
                pos += word.length;
                return result;
            }
        }
        const match = text.slice(pos).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (!match)
            return fail();
        pos += match[0].length;
        const num = Number(match[0]);
        if (!Number.isFinite(num))
            fail();
        return num;
    }
    const result = value(0);
    ws();
    if (pos !== text.length)
        fail();
    return result;
}
export function canonicalJson(input: unknown): string {
    let nodes = 0;
    function visit(v: unknown, depth: number): string {
        if (depth > 48 || ++nodes > 100000)
            fail("UI_JSON_COMPLEXITY_LIMIT", 413);
        if (v === null || typeof v === 'boolean')
            return JSON.stringify(v);
        if (typeof v === 'string')
            return JSON.stringify(validString(v));
        if (typeof v === 'number' && Number.isFinite(v))
            return JSON.stringify(v);
        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++)
                if (!Object.hasOwn(v, i))
                    fail();
            return '[' + v.map(x => visit(x, depth + 1)).join(',') + ']';
        }
        if (typeof v === 'object' && v && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
            return '{' + Object.keys(v).sort().map(k => {
                if (forbiddenKeys.has(k))
                    fail();
                return JSON.stringify(validString(k)) + ':' + visit((v as Record<string, unknown>)[k], depth + 1);
            }).join(',') + '}';
        }
        return fail();
    }
    return visit(input, 0);
}
export async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export async function digestJson(value: unknown): Promise<string> { return sha256(new TextEncoder().encode(canonicalJson(value))); }
export async function verifyManifestHash(value: Record<string, unknown>): Promise<void> {
    if (value.canonicalizerVersion !== CANONICAL_VERSION)
        fail("UI_CANONICAL_VERSION_UNSUPPORTED");
    const { manifestHash, ...content } = value;
    if (typeof manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifestHash) || await digestJson(content) !== manifestHash)
        fail("UI_MANIFEST_HASH_MISMATCH");
}
export async function readBytes(request: Request, max: number): Promise<Uint8Array> {
    if (request.headers.has('content-encoding'))
        fail('UI_CONTENT_ENCODING_UNSUPPORTED', 415);
    const raw = request.headers.get('content-length');
    if (raw !== null && (!/^\d+$/.test(raw) || Number(raw) > max))
        fail('UI_PAYLOAD_TOO_LARGE', 413);
    if (!request.body)
        return new Uint8Array();
    const reader = request.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            size += part.value.byteLength;
            if (size > max) {
                await reader.cancel();
                fail('UI_PAYLOAD_TOO_LARGE', 413);
            }
            parts.push(part.value);
        }
    }
    catch (error) {
        if (error instanceof UiError)
            throw error;
        fail('UI_UPLOAD_INTERRUPTED', 400);
    }
    finally {
        reader.releaseLock();
    }
    if (raw !== null && Number(raw) !== size)
        fail('UI_SIZE_MISMATCH');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
}
export function decodeJson(bytes: Uint8Array): Json {
    try {
        return parseJsonStrict(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    catch (error) {
        if (error instanceof UiError)
            throw error;
        return fail('UI_INVALID_UTF8');
    }
}
export async function readJson(request: Request, max: number): Promise<unknown> {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? ''))
        fail('UI_MEDIA_TYPE_UNSUPPORTED', 415);
    return decodeJson(await readBytes(request, max));
}
