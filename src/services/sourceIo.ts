import { fail, UiError } from '../contracts/canonical';
import { INTERNAL_MAX_BYTES, signedRequest } from '../protocol';

const SOURCE_READ_TIMEOUT_MS = 15000;

/** One deadline owns signing, response headers and the complete response body.
 * The explicit race also bounds bindings or streams that ignore AbortSignal.
 * Cancellation is best effort and cannot extend the deadline itself. */
async function sourceResponse<T>(binding:Fetcher|undefined,path:string,body:unknown,secret:string|undefined,
    consume:(read:(max:number)=>Promise<Uint8Array>,discard:()=>Promise<void>)=>Promise<T>,parentSignal?:AbortSignal):Promise<T> {
    if(!binding)fail('UI_BUNDLE_SOURCE_UNAVAILABLE',503);
    if(parentSignal?.aborted)throw parentSignal.reason;
    const controller=new AbortController();
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    let complete=false,cancellation:Promise<void>|undefined,rejectAbort:(reason:unknown)=>void=()=>{};
    const interrupted=new Promise<never>((_resolve,reject)=>{rejectAbort=reject;});
    const cancel=():Promise<void>=>{
        if(complete)return Promise.resolve();
        if(cancellation)return cancellation;
        try {
            const pending=reader?reader.cancel(controller.signal.reason):response?.body?.cancel(controller.signal.reason);
            if(pending)cancellation=Promise.resolve(pending).catch(()=>{});
        } catch { /* A failed cleanup cannot replace the original failure. */ }
        return cancellation??Promise.resolve();
    };
    const abort=(reason:unknown)=>{
        if(controller.signal.aborted)return;
        controller.abort(reason);rejectAbort(controller.signal.reason);void cancel();
    };
    const onParentAbort=()=>abort(parentSignal!.reason);
    parentSignal?.addEventListener('abort',onParentAbort,{once:true});
    const timer=setTimeout(()=>abort(new UiError(504,'UI_BUNDLE_SOURCE_READ_TIMEOUT')),SOURCE_READ_TIMEOUT_MS);
    const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
    const read=async(max:number):Promise<Uint8Array>=>{
        check();
        const length=response!.headers.get('content-length');
        if(length&&(!/^\d+$/.test(length)||Number(length)>max))fail('UI_BUNDLE_UPSTREAM_TOO_LARGE',413);
        if(!response!.body){complete=true;return new Uint8Array();}
        const active=response!.body.getReader();reader=active;
        const parts:Uint8Array[]=[];let size=0;
        try {
            while(true){
                const part=await active.read();check();
                if(part.done){complete=true;break;}
                size+=part.value.byteLength;
                if(size>max)fail('UI_BUNDLE_UPSTREAM_TOO_LARGE',413);
                parts.push(part.value);
            }
            const bytes=new Uint8Array(size);let offset=0;
            for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
            return bytes;
        } finally {
            if(!complete)void cancel();
            active.releaseLock();if(reader===active)reader=undefined;
        }
    };
    const run=async():Promise<T>=>{
        const request=await signedRequest('https://qagent.internal'+path,body,secret,'source');check();
        response=await binding.fetch(new Request(request,{signal:controller.signal}));
        // A transport may return after the race has already rejected. Release it too.
        if(controller.signal.aborted){void cancel();check();}
        if(!response.ok){
            let code='UI_BUNDLE_UPSTREAM_UNAVAILABLE';
            // Preserve internalFetch's HTTP status and safe upstream error-code rules.
            try {
                const parsed=JSON.parse(new TextDecoder().decode(await read(INTERNAL_MAX_BYTES)));
                if(typeof parsed.code==='string'&&/^[A-Z][A-Z0-9_]{2,100}$/.test(parsed.code))code=parsed.code;
            } catch {check();}
            fail(code,response.status);
        }
        return consume(read,async()=>{await cancel();check();complete=true;});
    };
    try {return await Promise.race([run(),interrupted]);}
    finally {
        clearTimeout(timer);parentSignal?.removeEventListener('abort',onParentAbort);
        if(!complete)void cancel();
    }
}

export function fetchSourceBytes(binding:Fetcher|undefined,path:string,body:unknown,secret:string|undefined,max:number,signal?:AbortSignal):Promise<Uint8Array> {
    if(!Number.isSafeInteger(max)||max<0)fail('UI_BUNDLE_READ_LIMIT_INVALID');
    return sourceResponse(binding,path,body,secret,read=>read(max),signal);
}

/** Status has no payload contract. Cancel its body without leaving an open stream. */
export async function fetchSourceStatus(binding:Fetcher|undefined,path:string,body:unknown,secret:string|undefined,signal?:AbortSignal):Promise<void> {
    await sourceResponse(binding,path,body,secret,(_read,discard)=>discard(),signal);
}
