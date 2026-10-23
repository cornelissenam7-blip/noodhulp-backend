import {lookup} from 'node:dns/promises';
import {get} from 'node:https';
import {isIP} from 'node:net';
const fail=m=>Object.assign(Error(m),{status:400});
export function publicIPv4(ip){
 if(isIP(ip)!==4)return false;const [a,b,c]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function websiteURL(raw){let u;try{u=new URL(raw);}catch{throw fail('Vul een volledige openbare HTTPS-website in.');}if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hostname.length>253||!u.hostname.includes('.')||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||isIP(u.hostname)&&!publicIPv4(u.hostname))throw fail('Gebruik een openbare HTTPS-website zonder aanmeldgegevens of afwijkende poort.');u.hash='';return u;}
export function websiteText(html){
 return html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g,s=>({'&nbsp;':' ','&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[s])).replace(/\s+/g,' ').trim().slice(0,6000);
}
function requestHTML(u,address){return new Promise((resolve,reject)=>{
 const req=get(u,{lookup:(_host,options,cb)=>options?.all?cb(null,[{address,family:4}]):cb(null,address,4),headers:{'User-Agent':'Amcinova-WebsitePreview/1.0','Accept':'text/html'},timeout:12000},res=>{
  if([301,302,303,307,308].includes(res.statusCode)){res.resume();return resolve({redirect:res.headers.location});}
  if(res.statusCode!==200||!/^text\/html\b/i.test(res.headers['content-type']||'')){res.resume();return reject(fail('De website gaf geen openbare HTML-pagina terug.'));}
  let bytes=0;const chunks=[];res.on('data',chunk=>{bytes+=chunk.length;if(bytes>1000000){res.destroy();reject(fail('De webpagina is te groot om hier veilig te lezen.'));}else chunks.push(chunk);});res.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));res.on('error',reject);
 });req.on('timeout',()=>req.destroy(fail('De website reageert niet op tijd.')));req.on('error',reject);
 });}
export async function previewWebsite(raw,{resolve=lookup,request=requestHTML}={}){
 let u=websiteURL(raw);const original=u.href;
 for(let count=0;count<4;count++){
  const addresses=isIP(u.hostname)?[{address:u.hostname}]:await resolve(u.hostname,{all:true,family:4});
  if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw fail('Dit websiteadres kan niet als openbare website worden gelezen.');
  const response=await request(u,addresses[0].address);
  if(response.redirect){u=websiteURL(new URL(response.redirect,u).href);continue;}
  if(typeof response.html!=='string')throw fail('Geen websitetekst ontvangen.');const text=websiteText(response.html);if(text.length<30)throw fail('Er is te weinig leesbare tekst gevonden. Plak de bedrijfsinformatie zelf in het feitenvak.');
  const title=websiteText(response.html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]||'').slice(0,140);
  const links=[];
  for(const match of response.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)){
   try{const target=new URL(match[1].replace(/&amp;/g,'&'),u);if(target.origin!==u.origin||target.username||target.password||/wp-admin|wp-login|logout/i.test(target.pathname)||Array.from(target.searchParams.keys()).some(k=>/token|nonce|password|secret|^key$|^code$/i.test(k)))continue;
    const label=websiteText(match[2]).slice(0,140);if(label&&!links.some(l=>l.url===target.href))links.push({label,url:target.href});if(links.length===30)break;
   }catch{}
  }
  const images=[];
  for(const match of response.html.matchAll(/<img\b[^>]*>/gi)){
   const src=match[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1],alt=match[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1]||'';
   try{const target=websiteURL(new URL(src,u).href);if(target.origin!==u.origin||!src||/logo|icon|avatar|pixel|tracking/i.test(src+' '+alt)||target.search||images.some(i=>i.url===target.href))continue;
    images.push({url:target.href,alt:websiteText(alt).slice(0,200)});if(images.length===12)break;
   }catch{}
  }
  return {requestedURL:original,sourceURL:u.href,fetchedAt:new Date().toISOString(),title,text,links,images,confirmed:false,note:'Gelezen brontekst, nog niet bevestigd. Controleer en selecteer de feiten voordat je ze in je bedrijfsprofiel gebruikt.'};
 }throw fail('De website verwijst te vaak door.');
}
function requestImage(u,address){return new Promise((resolve,reject)=>{
 const req=get(u,{lookup:(_host,options,cb)=>options?.all?cb(null,[{address,family:4}]):cb(null,address,4),headers:{'User-Agent':'Amcinova-WebsitePreview/1.0','Accept':'image/jpeg,image/png,image/webp'},timeout:12000},res=>{
  if(res.statusCode!==200||!/^image\/(?:jpeg|png|webp)\b/i.test(res.headers['content-type']||'')){res.resume();return reject(fail('De bron gaf geen bruikbare productafbeelding terug.'));}
  let length=0;const chunks=[];res.on('data',chunk=>{length+=chunk.length;if(length>650000){res.destroy();reject(fail('De productafbeelding is groter dan 650 kB.'));}else chunks.push(chunk);});res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);
 });req.on('timeout',()=>req.destroy(fail('De productafbeelding reageert niet op tijd.')));req.on('error',reject);
 });}
export async function websiteImage(raw,origin,{resolve=lookup,request=requestImage}={}){
 const u=websiteURL(raw);if(u.origin!==new URL(origin).origin||u.search)throw fail('Gebruik alleen een aangetroffen afbeelding van deze website.');
 const addresses=await resolve(u.hostname,{all:true,family:4});if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw fail('Geen openbare productafbeelding.');
 const bytes=await request(u,addresses[0].address);if(!Buffer.isBuffer(bytes)||bytes.length>650000)throw fail('Geen bruikbare productafbeelding.');
 const type=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'webp':null;
 if(!type)throw fail('De bron bevat geen ondersteund afbeeldingsbestand.');
 return {image:'data:image/'+type+';base64,'+bytes.toString('base64'),sourceURL:u.href,illustration:false};
}
