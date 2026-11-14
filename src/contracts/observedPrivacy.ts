import { canonicalJson, fail, sha256 } from './canonical';
import { UI_LIMITS, type ArtifactInput } from './uiCapture';
export const SENSITIVE_KEY = /(?:authorization|password|passwd|privatekey|clientsecret|apikey|csrftoken|accesstoken|refreshtoken|idtoken|sessionid|cookie|secret|^pwd$|^token$|^tx$|^nonce$|^state$|storage)/i;
export const PERSONAL_KEY = /(?:email|phone|mobile|firstname|lastname|fullname|givenname|familyname|address|birth|ssn|taxid|passport)/i;
export const keyName = (s: string) => s.replace(/[^a-z0-9]/gi, '');
export type ObservedPrivacyMode = 'PROTECTED' | 'FULL_TEST' | 'ENVIRONMENT_MANAGED';
export function unsafeText(s: string, mode: ObservedPrivacyMode = 'PROTECTED'): boolean {
    if(mode==='ENVIRONMENT_MANAGED')return false;
    let x = s;
    try {
        x = decodeURIComponent(s);
    }
    catch { /* encoded syntax is data */ }
    const hard = /(?:Bearer\s+\S+|-----BEGIN .*PRIVATE KEY-----|\bq(?:ps|og|os|ug|us|ag)_\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|<[a-z!/][^>]*>)/i;
    if (hard.test(x)) return true;
    return mode === 'PROTECTED' && /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\d[ .()-]?){10,}\b)/i.test(x);
}
export function checkedUrl(raw: string, mode: ObservedPrivacyMode = 'PROTECTED'): URL {
    let u: URL;
    try {
        u = new URL(raw);
    }
    catch {
        return fail('UI_URL_UNAVAILABLE');
    }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || raw.length > 4096 || unsafeText(u.pathname, mode))
        fail('UI_URL_PRIVACY_OMITTED');
    if(mode==='ENVIRONMENT_MANAGED')return u;
    for (const [k, v] of u.searchParams)
        if (SENSITIVE_KEY.test(keyName(k)) || (mode === 'PROTECTED' && PERSONAL_KEY.test(keyName(k))) || unsafeText(k, mode) || unsafeText(v, mode))
            fail('UI_URL_PRIVACY_OMITTED');
    // Fragments can be SPA routes: discard only a safe empty fragment; don't conceal dependencies.
    if (u.hash && (unsafeText(u.hash, mode) || /(?:token|password|secret|session)[=:]/i.test(u.hash)))
        fail('UI_URL_PRIVACY_OMITTED');
    return u;
}
export function networkPathAllowed(path: string, paths: string[],mode:ObservedPrivacyMode='PROTECTED'): boolean {
    if (mode!=='ENVIRONMENT_MANAGED'&&/(?:^|\/)(?:login|signin|signout|logout|auth|oauth2?|sso|selfasserted|token)(?:\/|$)/i.test(path))
        return false;
    return paths.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'));
}
export const SAFE_HEADERS = ['accept', 'accept-language', 'content-type', 'content-language', 'x-api-version', 'x-requested-with'];
export function observedHeaders(raw: unknown, extraNames: string[] = [], mode: ObservedPrivacyMode = 'PROTECTED'): [
    string,
    string
][] {
    if (!raw || typeof raw !== 'object')
        return [];
    const out: [
        string,
        string
    ][] = [];
    for (const [name, value] of Object.entries(raw)) {
        const k = name.toLowerCase();
        if(mode==='ENVIRONMENT_MANAGED'){
            if(typeof value!=='string'||value.includes('\r'))fail('UI_HEADER_PRIVACY_OMITTED');
            if(!/^(?:[!#$%&'*+.^_`|~0-9a-z-]{1,80}|:(?:authority|method|path|scheme|status))$/.test(k)||value.length>256*2049)fail('UI_HEADER_FORMAT_INVALID');
            // CDP joins repeated header fields with LF. Preserve each value as a
            // separate pair; never treat the separator as part of a field value.
            for(const part of value.split('\n')){if(part.length>2048||out.length>=256)fail('UI_HEADER_FORMAT_INVALID');out.push([k,part]);}
            continue;
        }
        if (!SAFE_HEADERS.includes(k) && !extraNames.includes(k))
            continue;
        if (SENSITIVE_KEY.test(keyName(k)))
            fail('UI_HEADER_PRIVACY_OMITTED');
        if (typeof value !== 'string' || value.length > 2048 || unsafeText(value, mode) || /[\r\n]/.test(value))
            fail('UI_HEADER_PRIVACY_OMITTED');
        out.push([k, value]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]));
}
/** Revalidation conditions do not select a representation. Every other captured
 * header, including credentials and Vary inputs, stays in the variant evidence. */
export function environmentVariantHeaders(pairs:readonly [string,string][]):[string,string][] {
    return pairs.filter(([name])=>!['if-none-match','if-modified-since'].includes(name.toLowerCase()));
}
/** Only approved test-data paths enter here. Heuristics supplement, not replace that scope. */
export async function sanitizeObservedJson(raw: string, salt: string, mode: ObservedPrivacyMode = 'PROTECTED'): Promise<{
    bytes: Uint8Array;
    transformations: ArtifactInput['privacy']['transformations'];
}> {
    if (new TextEncoder().encode(raw).length > UI_LIMITS.artifactBytes)
        fail('UI_BODY_TOO_LARGE');
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return fail('UI_BODY_NOT_JSON');
    }
    let visited = 0;
    const transformations = new Map<string, 'REDACTED' | 'PSEUDONYMIZED'>();
    const mark = (kind: 'REDACTED' | 'PSEUDONYMIZED', path: string) => { transformations.set(path, kind); if (transformations.size > 64)
        fail('UI_TRANSFORMATION_LIMIT'); };
    const visit = async (v: any, key = '', path = '$', depth = 0): Promise<any> => {
        if (++visited > 50000) fail('UI_JSON_NODE_LIMIT');
        if (depth > 40)
            fail('UI_JSON_DEPTH_LIMIT');
        if (mode!=='ENVIRONMENT_MANAGED'&&SENSITIVE_KEY.test(keyName(key))) {
            mark('REDACTED', path);
            return '[REDACTED]';
        }
        if ((mode === 'PROTECTED' && PERSONAL_KEY.test(keyName(key))) || (typeof v === 'string' && unsafeText(v, mode))) {
            mark('PSEUDONYMIZED', path);
            if (v === null)
                return null;
            return 'ui_' + (await sha256(new TextEncoder().encode(salt + '\n' + canonicalJson(v)))).slice(0, 20);
        }
        if (typeof v === 'string') {
            if (v.length > UI_LIMITS.artifactBytes)
                fail('UI_BODY_TOO_LARGE');
            return v;
        }
        if (Array.isArray(v)) {
            const values: unknown[] = [];
            // Sequential bounded traversal avoids hundreds of thousands of pending promises.
            for (const x of v) values.push(await visit(x, '', path + '[*]', depth + 1));
            return values;
        }
        if (v && typeof v === 'object') {
            const out: Record<string, unknown> = Object.create(null);
            for (const k of Object.keys(v)) {
                if (k.length > 128 || unsafeText(k, mode) || /[\u0000-\u001f]/.test(k))
                    fail('UI_JSON_KEY_PRIVATE');
                out[k] = await visit(v[k], k, path + '.' + k, depth + 1);
            }
            return out;
        }
        return v;
    };
    const clean = await visit(parsed);
    // Preserve exact decoded body when it did not require a privacy transformation.
    const bytes = new TextEncoder().encode(transformations.size ? JSON.stringify(clean) : raw);
    if (bytes.length > UI_LIMITS.artifactBytes)
        fail('UI_BODY_TOO_LARGE');
    return { bytes, transformations: [...transformations].map(([path, kind]) => ({ path, kind })) };
}
export function assertObservedJson(value: unknown, mode: ObservedPrivacyMode = 'PROTECTED'): void {
    let visited = 0;
    const visit = (v: any, key = '', depth = 0): void => {
        if (++visited > 50000) fail('UI_JSON_NODE_LIMIT', 422);
        if (depth > 48)
            fail('UI_PRIVACY_REJECTED', 422);
        if (((mode!=='ENVIRONMENT_MANAGED'&&SENSITIVE_KEY.test(keyName(key))) || (mode === 'PROTECTED' && PERSONAL_KEY.test(keyName(key)))) && v !== null && v !== '[REDACTED]' && v !== '[OMITTED]' && !(typeof v === 'string' && /^ui_[a-f0-9]{20}$/.test(v)))
            fail('UI_PRIVACY_REJECTED', 422);
        if (typeof v === 'string' && unsafeText(v, mode))
            fail('UI_PRIVACY_REJECTED', 422);
        if (Array.isArray(v))
            v.forEach(x => visit(x, '', depth + 1));
        else if (v && typeof v === 'object')
            for (const [k, x] of Object.entries(v)) {
                if (unsafeText(k, mode))
                    fail('UI_PRIVACY_REJECTED', 422);
                visit(x, k, depth + 1);
            }
    };
    visit(value);
}
