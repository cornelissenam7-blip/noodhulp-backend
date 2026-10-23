const decode=value=>value.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi,e=>{const names={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};if(names[e.toLowerCase()])return names[e.toLowerCase()];const n=e[2]?.toLowerCase()==='x'?parseInt(e.slice(3,-1),16):parseInt(e.slice(2,-1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
const plain=value=>decode(value.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const attributes=tag=>Object.fromEntries([...tag.matchAll(/\b([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3]??m[4])]));
const secret=/^(?:token|key|code|nonce|password|secret|authorization|access_token|api_key|_wpnonce)$/i;
function observedURL(raw,base){try{const u=new URL(raw,base);if(u.origin!==base.origin||u.protocol!=='https:'||u.username||u.password||[...u.searchParams.keys()].some(k=>secret.test(k)))return null;return u.href;}catch{return null;}}
// Public markup is evidence only: no requests, scripts, CSS execution or guessed product routes.
export function extractWebsiteProducts(html,sourceURL){
 if(typeof html!=='string'||html.length>2000000)return [];
 let source;try{source=new URL(sourceURL);}catch{return [];}if(source.protocol!=='https:'||source.username||source.password)return [];
 const safe=html.replace(/<!--[^]*?-->/g,' ').replace(/<(script|style|template|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi,' ');
 const tags=/<\/?(?:section|article)\b[^>]*>/gi,stack=[],blocks=[];let match;
 while((match=tags.exec(safe))){const closing=/^<\//.test(match[0]),type=match[0].match(/(?:section|article)/i)[0].toLowerCase();if(!closing){stack.push({type,start:match.index,content:tags.lastIndex,attrs:attributes(match[0])});}else{const index=stack.map(x=>x.type).lastIndexOf(type);if(index<0)continue;const block=stack[index];stack.length=index;blocks.push({...block,end:match.index,html:safe.slice(block.content,match.index)});}}
 // Inner product cards win over containing shop sections.
 blocks.sort((a,b)=>(a.end-a.start)-(b.end-b.start));const products=[],seen=new Set(),accepted=[];
 for(const block of blocks){if(accepted.some(b=>block.start<=b.start&&block.end>=b.end))continue;
  const heading=block.html.match(/<h[23]\b[^>]*>([^]*?)<\/h[23]\s*>/i);if(!heading)continue;const name=plain(heading[1]).slice(0,240);if(!name)continue;
  let purchaseURL=null;for(const anchor of block.html.matchAll(/<a\b[^>]*>/gi)){const attr=attributes(anchor[0]),url=observedURL(attr.href||'',source);if(!url)continue;const parsed=new URL(url);if(parsed.searchParams.has('add-to-cart')&&/^\d{1,20}$/.test(parsed.searchParams.get('add-to-cart'))||/\/product\/[a-z0-9][^/]*(?:\/|$)/i.test(parsed.pathname)){purchaseURL=url;break;}}
  if(!purchaseURL||seen.has(purchaseURL))continue;
  let imageURL='';for(const image of block.html.matchAll(/<img\b[^>]*>/gi)){const attr=attributes(image[0]);const url=observedURL(attr.src||'',source);if(url){imageURL=url;break;}}
  const landing=new URL(source.href);if(block.attrs.id&&/^[\p{L}\p{N}_-]{1,200}$/u.test(block.attrs.id))landing.hash=block.attrs.id;
  products.push({name,text:plain(block.html).slice(0,1800),purchaseURL,landingURL:landing.href,imageURL});seen.add(purchaseURL);accepted.push(block);if(products.length===8)break;
 }
 return products.sort((a,b)=>safe.indexOf(a.name)-safe.indexOf(b.name));
}
