/** Pure artifact verification shared by Observation and the UI reader.
 * Format checks supplement the authorized FULL_TEST scope, never prove universal sanitization.
 * No execution, URL fetching, rewriting, or logging of captured bytes is permitted here. */
import { decodeJson, fail } from './canonical';
import { checkedUrl, SENSITIVE_KEY, keyName, SAFE_HEADERS, type ObservedPrivacyMode } from './observedPrivacy';
import { object, id, validateCapturePolicy, type CapturePolicy } from './uiCapture';
import { validateResourceManifest, isEnvironmentManagedPolicy, PAGE_ENVIRONMENT_ORIGIN, type PageArtifactInput } from './uiPageCopy';

function failFormat():never{return fail('UI_PAGE_ARTIFACT_FORMAT_INVALID',422);}
function text(bytes:Uint8Array):string {try {const s=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(s.includes('\0'))failFormat();return s;}catch{return failFormat();}}
function prefix(b:Uint8Array,s:number[]):boolean{return s.every((n,i)=>b[i]===n);}
function magic(type:string,b:Uint8Array):void {
    let ok=false;
    switch(type){
      case 'image/png':ok=b.length>=24&&prefix(b,[137,80,78,71,13,10,26,10])&&new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(8)===13&&text(b.slice(12,16))==='IHDR';break;
      case 'image/jpeg':ok=b.length>=4&&prefix(b,[255,216,255])&&b[b.length-2]===255&&b[b.length-1]===217;break;
      case 'image/gif':ok=b.length>=14&&['GIF87a','GIF89a'].includes(text(b.slice(0,6)))&&b[b.length-1]===59;break;
      case 'image/webp':ok=b.length>=20&&text(b.slice(0,4))==='RIFF'&&text(b.slice(8,12))==='WEBP';break;
      case 'font/woff':ok=b.length>=44&&text(b.slice(0,4))==='wOFF';break;
      case 'font/woff2':ok=b.length>=48&&text(b.slice(0,4))==='wOF2';break;
      case 'font/otf':ok=b.length>=12&&text(b.slice(0,4))==='OTTO';break;
      case 'font/ttf':ok=b.length>=12&&prefix(b,[0,1,0,0]);break;
      case 'application/octet-stream':ok=b.length>0;break;
    }
    if(!ok)failFormat();
}
/** Reject obvious credential material in synthetic fixtures as defense in depth.
 * This is deliberately NOT advertised as an observed HTML/JS sanitization pipeline. */
function guardText(s:string):void {
    if(/(?:Bearer\s+\S+|-----BEGIN [^-]*PRIVATE KEY-----|\bq(?:ps|og|os|ug|us|ag)_\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i.test(s))fail('UI_PRIVACY_REJECTED',422);
    if(/(?:password|passwd|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key)["'\s]*[:=][\s"']*(?!\[REDACTED\]|\[OMITTED\]|null)([A-Za-z0-9_\-]{6,})/i.test(s))fail('UI_PRIVACY_REJECTED',422);
}
function guardJson(value:unknown,observed:boolean,body=false):void {
    const sensitive=/^(?:authorization|proxyauthorization|cookie|setcookie|password|passwd|pwd|token|accesstoken|refreshtoken|idtoken|secret|clientsecret|apikey|xapikey|csrftoken|xcsrftoken|privatekey|storagestate|localstorage|sessionstorage)$/i;
    const redacted=(v:unknown)=>v===null||v==='[REDACTED]'||v==='[OMITTED]';
    function visit(v:unknown,key='',depth=0):void {
        if(depth>48||sensitive.test(keyName(key))&&!redacted(v))fail('UI_PRIVACY_REJECTED',422);
        if(typeof v==='string'){guardText(v);if(!body&&/<[a-z!/][^>]*>/i.test(v))fail('UI_PRIVACY_REJECTED',422);if(/^https?:\/\//i.test(v)){if(observed)checkedUrl(v,'FULL_TEST');else{let u:URL;try{u=new URL(v);}catch{fail('UI_PRIVACY_REJECTED',422);}if(u.username||u.password)fail('UI_PRIVACY_REJECTED',422);for(const [k,x] of u.searchParams)visit(x,k,depth+1);if(/(?:token|secret|password|session)[=:]/i.test(u.hash))fail('UI_PRIVACY_REJECTED',422);}}}
        else if(Array.isArray(v)){if(v.length===2&&typeof v[0]==='string'&&sensitive.test(keyName(v[0]))&&!redacted(v[1]))fail('UI_PRIVACY_REJECTED',422);v.forEach(x=>visit(x,'',depth+1));}
        else if(v&&typeof v==='object'){const o=v as Record<string,unknown>;if(typeof o.name==='string'&&sensitive.test(keyName(o.name))&&'value' in o&&!redacted(o.value))fail('UI_PRIVACY_REJECTED',422);for(const [k,x] of Object.entries(o))visit(x,k,depth+1);}
    }
    visit(value);
}
/** Same credential-key policy as the PC.3 producer's preparePageBytes. FULL_TEST
 * business fields such as state/nonce are not reclassified as credentials by name.
 * HTML strings in HTTP JSON remain inert JSON data; no parsing/execution is performed. */
function guardObservedBody(value:unknown):void {
    const privateKey=/(?:password|passwd|(?:^|[_-])pwd|token|secret|authorization|credential|cookie|(?:^|[_-])otp|api[_-]?key)/i;
    let count=0;
    function visit(v:unknown,key='',depth=0):void {
        if(++count>100000||depth>48)fail('UI_JSON_COMPLEXITY_LIMIT',413);
        if(privateKey.test(key)&&v!==null&&v!=='[REDACTED]'&&v!=='[OMITTED]')fail('UI_PRIVACY_REJECTED',422);
        if(typeof v==='string')guardText(v);
        else if(Array.isArray(v))for(const x of v)visit(x,'',depth+1);
        else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))visit(x,k,depth+1);
    }
    visit(value);
}
const privateAttribute=/(?:password|passwd|(?:^|[_-])pwd|token|secret|authorization|credential|credit.?card|cvv|(?:^|[_-])otp)/i;
function guardAttribute(tag:string,name:string,value:string):void {
    const key=name.toLowerCase();guardText(value);
    if(key.startsWith('on')||['value','nonce','srcdoc','srcset','data-private','data-qagent-private','data-sensitive'].includes(key)||privateAttribute.test(key)||tag.toLowerCase()==='meta'&&key==='content')fail('UI_PRIVACY_REJECTED',422);
    if(['href','src','action','poster','formaction','xlink:href'].includes(key))checkedUrl(value,'FULL_TEST');
    if(key==='style'&&/url\s*\(\s*["']?(?:data|javascript|vbscript):/i.test(value))fail('UI_PRIVACY_REJECTED',422);
    if(['id','name','autocomplete','aria-label'].includes(key)&&privateAttribute.test(value))fail('UI_PRIVACY_REJECTED',422);
    if(key==='type'&&['password','hidden','file'].includes(value.toLowerCase())||key==='contenteditable'&&value.toLowerCase()==='true')fail('UI_PRIVACY_REJECTED',422);
}
function attributeText(value:string):string {
    return value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi,entity=>{
        const key=entity.slice(1,-1).toLowerCase();const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
        if(named[key])return named[key];const point=key.startsWith('#x')?parseInt(key.slice(2),16):Number(key.slice(1));
        if(!Number.isSafeInteger(point)||point<1||point>0x10ffff)failFormat();return String.fromCodePoint(point);
    });
}
/** Accept the producer's serialized shape. This is a refusal check, not an HTML rewriter.
 * Even accepted markup is served as an attachment under sandbox/default-src none. */
function inspectObservedHtml(descriptor:PageArtifactInput,html:string):void {
    guardText(attributeText(html));
    if(!descriptor.privacy.transformations.some(t=>t.kind==='REDACTED'&&t.path==='/html/active-and-private-content'))fail('UI_PAGE_HTML_POLICY_REQUIRED',422);
    if(/<!--|<\?|<!\[|<![^d]/i.test(html))failFormat();
    for(const m of html.matchAll(/<(script|noscript|iframe|object|textarea)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi))if(m[2].trim())fail('UI_PRIVACY_REJECTED',422);
    for(const m of html.matchAll(/<[^>]*>/g)){
        if(/^<!DOCTYPE [a-z0-9_-]+>$/i.test(m[0])||/^<\/[a-z][a-z0-9:_.-]*>$/.test(m[0]))continue;
        const open=/^<([a-z][a-z0-9:_.-]*)([\s\S]*?)>$/.exec(m[0]);if(!open)failFormat();
        let rest=open[2];while(rest){const attr=/^ ([a-z_:][a-z0-9_:.-]*)="([^"]*)"/.exec(rest);if(!attr)failFormat();guardAttribute(open[1],attr[1],attributeText(attr[2]));rest=rest.slice(attr[0].length);}
    }
}
/** r2 retains private test data. This check only verifies the producer's inert
 * DOM serialization; HTTP bodies remain passive, exact response/request bytes. */
function inertAttribute(tag:string,name:string,value:string):void {
    const key=name.toLowerCase();
    if(key.startsWith('on')||key==='srcdoc'||tag.toLowerCase()==='meta'&&key==='http-equiv'&&value.trim().toLowerCase()==='refresh')fail('UI_PAGE_HTML_ACTIVE_CONTENT',422);
    if(['href','src','action','poster','formaction','xlink:href'].includes(key))checkedUrl(value,'ENVIRONMENT_MANAGED');
    if(key==='style'&&/url\s*\(\s*["']?(?:data|javascript|vbscript):/i.test(value))fail('UI_PAGE_HTML_ACTIVE_CONTENT',422);
}
function inspectInertHtml(html:string):void {
    if(/<!--|<\?|<!\[|<![^d]/i.test(html))failFormat();
    for(const m of html.matchAll(/<(script|noscript|iframe|object)\b[^>]*>/gi))if(!new RegExp('^\\s*</'+m[1]+'\\s*>','i').test(html.slice(m.index!+m[0].length)))fail('UI_PAGE_HTML_ACTIVE_CONTENT',422);
    for(const m of html.matchAll(/<[^>]*>/g)){
        if(/^<!DOCTYPE [a-z0-9_-]+>$/i.test(m[0])||/^<\/[a-z][a-z0-9:_.-]*>$/.test(m[0]))continue;
        const open=/^<([a-z][a-z0-9:_.-]*)([\s\S]*?)>$/.exec(m[0]);if(!open)failFormat();
        let rest=open[2];while(rest){const attr=/^ ([a-z_:][a-z0-9_:.-]*)="([^"]*)"/.exec(rest);if(!attr)failFormat();inertAttribute(open[1],attr[1],attributeText(attr[2]));rest=rest.slice(attr[0].length);}
    }
}
export function inspectPageArtifactBytes(descriptor:PageArtifactInput,bytes:Uint8Array,mode:ObservedPrivacyMode='PROTECTED',policy?:CapturePolicy):void {
    const observed=descriptor.privacy.dataOrigin==='OBSERVED_SANITIZED',environment=descriptor.privacy.dataOrigin===PAGE_ENVIRONMENT_ORIGIN;
    if(environment&&(mode!=='ENVIRONMENT_MANAGED'||!isEnvironmentManagedPolicy(policy)))fail('UI_POLICY_PROFILE_MISMATCH',422);
    if(observed){if(mode!=='FULL_TEST'||!policy||validateCapturePolicy(policy).mode!=='FULL_TEST')fail('UI_PAGE_FULL_TEST_REQUIRED',422);}
    if(descriptor.representation==='BINARY'){if(observed&&descriptor.contentType==='application/octet-stream')fail('UI_PAGE_BINARY_UNSUPPORTED',415);magic(descriptor.contentType,bytes);if(observed)guardText(new TextDecoder().decode(bytes));return;}
    const s=text(bytes);if(!environment)guardText(s);
    if(descriptor.representation==='UTF8_TEXT'){
        if(observed&&descriptor.contentType==='text/html')inspectObservedHtml(descriptor,s);
        else if(observed&&!['text/plain','text/css','text/javascript','application/javascript'].includes(descriptor.contentType))fail('UI_PAGE_ARTIFACT_FORMAT_INVALID',422);
        if(environment&&['DOCUMENT_HTML','RENDERED_HTML'].includes(descriptor.kind))inspectInertHtml(s);
        return; // Always private archival bytes, never executable Console content.
    }
    const value=decodeJson(bytes),body=observed&&['HTTP_REQUEST_BODY','HTTP_RESPONSE_BODY'].includes(descriptor.kind);if(!environment)guardJson(value,observed,body);
    if(body||observed&&descriptor.kind==='ACTION_VALUE_JSON')guardObservedBody(value);
    if(descriptor.kind==='RESOURCE_MANIFEST_JSON'){
        validateResourceManifest(value);return;
    }
    if(descriptor.kind==='DOM_SNAPSHOT_JSON'){
        const v=object(value,['contractVersion','documentId','nodes']);if(v.contractVersion!=='qagent.ui-dom-snapshot.v1'||!Array.isArray(v.nodes)||v.nodes.length>10000)failFormat();id(v.documentId);
        const nodes=new Set<string>(),opaqueNodes=new Set<string>();for(const n of v.nodes){object(n,['nodeId','parentId','nodeType','name','attributes','text']);id(n.nodeId);if(n.parentId!==null&&!nodes.has(n.parentId))failFormat();if(nodes.has(n.nodeId))failFormat();nodes.add(n.nodeId);
            if((observed||environment)&&n.parentId!==null&&opaqueNodes.has(n.parentId))fail(environment?'UI_PAGE_HTML_ACTIVE_CONTENT':'UI_PRIVACY_REJECTED',422);
            if(![1,3,8,9,10,11].includes(n.nodeType)||typeof n.name!=='string'||n.name.length>256||typeof n.text!=='string'||!Array.isArray(n.attributes)||n.attributes.length>128)failFormat();
            for(const p of n.attributes){if(!Array.isArray(p)||p.length!==2||p.some((x:unknown)=>typeof x!=='string'))failFormat();if(observed)guardAttribute(n.name,p[0],p[1]);if(environment)inertAttribute(n.name,p[0],p[1]);}
            if(observed&&(['script','noscript','iframe','object','embed','textarea'].includes(n.name.toLowerCase())||n.attributes.some((a:string[])=>a[0]==='data-qagent-redacted'&&a[1]==='true')))opaqueNodes.add(n.nodeId);
            if(environment&&['script','noscript','iframe','object','embed'].includes(n.name.toLowerCase())){opaqueNodes.add(n.nodeId);if(n.text.trim())fail('UI_PAGE_HTML_ACTIVE_CONTENT',422);}
            if(observed&&(n.nodeType===8||['script','noscript'].includes(n.name.toLowerCase())&&n.text.trim()))failFormat();}
    } else if(descriptor.kind==='LAYOUT_JSON'){
        const v=object(value,['contractVersion','documentId','viewport','entries']);if(v.contractVersion!=='qagent.ui-layout.v1'||!Array.isArray(v.entries)||v.entries.length>10000)failFormat();id(v.documentId);object(v.viewport,['width','height','deviceScaleFactor','scrollX','scrollY']);
        if(!Object.values(v.viewport).every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0))failFormat();
        for(const e of v.entries){object(e,['nodeId','bounds','styles']);id(e.nodeId);if(!Array.isArray(e.bounds)||e.bounds.length!==4||!e.bounds.every((x:unknown)=>typeof x==='number'&&Number.isFinite(x)))failFormat();if(!e.styles||typeof e.styles!=='object'||Array.isArray(e.styles)||Object.keys(e.styles).length>256)failFormat();for(const x of Object.values(e.styles))if(typeof x!=='string')failFormat();}
    } else if(descriptor.kind==='FORM_STATE_JSON'){
        const v=object(value,['contractVersion','documentId','fields','scroll']);if(v.contractVersion!=='qagent.ui-form-state.v1'||!Array.isArray(v.fields)||v.fields.length>2048||!Array.isArray(v.scroll)||v.scroll.length>2048)failFormat();id(v.documentId);
        for(const f of v.fields){object(f,['nodeId','type','value','checked']);id(f.nodeId);if(!(environment?['text','search','email','number','checkbox','radio','select','textarea','date','password','hidden','tel','url','time','datetime-local','month','week','range','color','button','submit','reset','image']:['text','search','email','number','checkbox','radio','select','textarea','date']).includes(f.type)||typeof f.value!=='string'||typeof f.checked!=='boolean')failFormat();}
        for(const p of v.scroll){object(p,['nodeId','x','y']);id(p.nodeId);if(![p.x,p.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0))failFormat();}
    } else if(descriptor.kind==='HEADERS_JSON'){
        if(!Array.isArray(value)||value.some(p=>!Array.isArray(p)||p.length!==2||p.some(x=>typeof x!=='string')))failFormat();
        if(environment&&(value as string[][]).length>256)fail('UI_HEADER_FORMAT_INVALID',422);
        if(environment)for(const pair of value as string[][])if(!/^(?:[!#$%&'*+.^_`|~0-9a-z-]{1,80}|:(?:authority|method|path|scheme|status))$/.test(pair[0])||pair[1].length>2048||/[\r\n]/.test(pair[1]))fail('UI_HEADER_FORMAT_INVALID',422);
        if(observed)for(const pair of value as string[][]){if(![...SAFE_HEADERS,...(policy?.businessHeaderNames??[])].includes(pair[0]))fail('UI_HEADER_NOT_AUTHORIZED',403);if(!/^[a-z][a-z0-9-]{0,79}$/.test(pair[0])||SENSITIVE_KEY.test(keyName(pair[0]))||pair[1].length>2048||/[\r\n]/.test(pair[1]))fail('UI_HEADER_PRIVACY_OMITTED',422);}
    } else if(descriptor.kind==='ACTION_VALUE_JSON'){const v=object(value,['value']);if(!['string','number','boolean'].includes(typeof v.value)&&v.value!==null)failFormat();}
}
