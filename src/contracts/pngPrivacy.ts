import { fail } from './canonical';
import { validateVisualPolicy, type VisualPolicy } from './uiCapture';
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function crc(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++)
        c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
} return (c ^ 0xffffffff) >>> 0; }
function chunks(bytes: Uint8Array) {
    if (!SIGNATURE.every((x, i) => bytes[i] === x))
        fail('UI_PNG_INVALID', 422);
    const out: {
        type: string;
        data: Uint8Array;
        raw: Uint8Array;
    }[] = [];
    let p = 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (p + 12 <= bytes.length) {
        const n = view.getUint32(p);
        if (n > bytes.length - p - 12)
            fail('UI_PNG_INVALID', 422);
        const type = new TextDecoder().decode(bytes.slice(p + 4, p + 8));
        if (crc(bytes.subarray(p + 4, p + 8 + n)) !== view.getUint32(p + 8 + n))
            fail('UI_PNG_INVALID', 422);
        out.push({ type, data: bytes.slice(p + 8, p + 8 + n), raw: bytes.slice(p, p + n + 12) });
        p += n + 12;
        if (type === 'IEND')
            break;
        if (out.length > 2048)
            fail('UI_PNG_INVALID', 422);
    }
    if (p !== bytes.length || out[0]?.type !== 'IHDR' || out.at(-1)?.type !== 'IEND' || out.at(-1)!.data.length !== 0 || out.filter(x => x.type === 'IHDR').length !== 1)
        fail('UI_PNG_INVALID', 422);
    return out;
}
/** Remove ancillary metadata BEFORE hashing. Pixels still come from the captured tab. */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
    const c = chunks(bytes);
    if (c.some(x => !['IHDR', 'IDAT', 'IEND'].includes(x.type) && x.type[0] === x.type[0].toUpperCase()))
        fail('UI_PNG_UNSUPPORTED', 422);
    const selected = c.filter(x => ['IHDR', 'IDAT', 'IEND'].includes(x.type));
    const out = new Uint8Array(8 + selected.reduce((n, x) => n + x.raw.length, 0));
    out.set(SIGNATURE);
    let p = 8;
    for (const x of selected) {
        out.set(x.raw, p);
        p += x.raw.length;
    }
    return out;
}
function paeth(a: number, b: number, c: number) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
/** Validate masking again on the server. No OCR or claim of universal PII classification. */
export async function inspectMaskedPng(bytes: Uint8Array, policy: VisualPolicy): Promise<void> {return inspectPng(bytes,policy,true);}
/** Environment-managed test screenshots retain their actual pixels; only encoding and bounds are checked.
 * The internal full-frame geometry is not a privacy declaration and is never persisted. */
export async function inspectUnmaskedPng(bytes:Uint8Array):Promise<void> {
    const cs=chunks(bytes),header=cs[0].data;if(header.length!==13)fail('UI_PNG_INVALID',422);
    const d=new DataView(header.buffer,header.byteOffset,header.byteLength),width=d.getUint32(0),height=d.getUint32(4);
    return inspectPng(bytes,{width,height,allowed:[{x:0,y:0,width,height}],masked:[],background:'SOLID_32'},false);
}
async function inspectPng(bytes: Uint8Array, policy: VisualPolicy,verifyMask:boolean): Promise<void> {
    const v = validateVisualPolicy(policy), cs = chunks(bytes);
    if (cs.some(x => !['IHDR', 'IDAT', 'IEND'].includes(x.type)))
        fail('UI_PNG_METADATA_FORBIDDEN', 422);
    const h = cs[0].data;
    const d = new DataView(h.buffer, h.byteOffset, h.byteLength);
    if (h.length !== 13 || d.getUint32(0) !== v.width || d.getUint32(4) !== v.height || h[8] !== 8 || ![2, 6].includes(h[9]) || h[10] || h[11] || h[12])
        fail('UI_PNG_UNSUPPORTED', 422);
    const channels = h[9] === 6 ? 4 : 3, stride = v.width * channels, size = (stride + 1) * v.height;
    const data = cs.filter(x => x.type === 'IDAT');
    if (!data.length)
        fail('UI_PNG_INVALID', 422);
    const packed = new Uint8Array(data.reduce((n, x) => n + x.data.length, 0));
    let p = 0;
    for (const c of data) {
        packed.set(c.data, p);
        p += c.data.length;
    }
    const stream = new Blob([packed.buffer]).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader(), raw = new Uint8Array(size);
    let used = 0;
    try {
        while (true) {
            const r = await reader.read();
            if (r.done)
                break;
            if (used + r.value.length > size) {
                await reader.cancel();
                fail('UI_PNG_DECODE_LIMIT', 422);
            }
            raw.set(r.value, used);
            used += r.value.length;
        }
    }
    catch (e) {
        if ((e as any)?.code)
            throw e;
        fail('UI_PNG_INVALID', 422);
    }
    finally {
        reader.releaseLock();
    }
    if (used !== size)
        fail('UI_PNG_INVALID', 422);
    let prev = new Uint8Array(stride), row = new Uint8Array(stride);
    for (let y = 0; y < v.height; y++) {
        const filter = raw[y * (stride + 1)];
        if (filter > 4)
            fail('UI_PNG_INVALID', 422);
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? row[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
            const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
            row[x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
        }
        if(!verifyMask){[prev,row]=[row,prev];continue;}
        const allowed = new Uint8Array(v.width);
        for (const r of v.allowed)
            if (y >= r.y && y < r.y + r.height)
                allowed.fill(1, r.x, r.x + r.width);
        for (const r of v.masked)
            if (y >= r.y && y < r.y + r.height)
                allowed.fill(0, r.x, r.x + r.width);
        for (let x = 0; x < v.width; x++)
            if (!allowed[x]) {
                const i = x * channels;
                if (row[i] !== 32 || row[i + 1] !== 32 || row[i + 2] !== 32 || (channels === 4 && row[i + 3] !== 255))
                    fail('UI_PNG_MASK_VIOLATION', 422);
            }
        [prev, row] = [row, prev];
    }
}
