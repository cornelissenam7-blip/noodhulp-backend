import {createHash} from 'node:crypto';
export const packageChannels=['Facebook','Instagram','YouTube','TikTok','Pinterest','Snapchat','LinkedIn','X'];
const fault=message=>Object.assign(Error(message),{status:400});
const text=(v,max=10000)=>typeof v==='string'?v.slice(0,max).trim():'';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function https(value){let url;try{url=new URL(value);}catch{throw fault('Gebruik een geldige HTTPS-bestemming.');}if(url.protocol!=='https:'||url.username||url.password)throw fault('Gebruik een HTTPS-bestemming zonder aanmeldgegevens.');return url.href;}
function channel(value){const match=packageChannels.find(c=>c.toLowerCase()===text(value).toLowerCase());if(!match)throw fault('Onbekend publicatiekanaal.');return match;}
function assetFor(assets,id){const a=assets.find(x=>x.variantId===id);if(!a)return null;const image=a.image||'';if(image&&(!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)||image.length>1500000))throw fault('Gebruik een geldige, begrensde rasterafbeelding.');return {image,sourceURL:a.sourceURL?https(a.sourceURL):'',illustration:a.illustration===true,origin:text(a.origin||'supplied',100)};}
// This creates a private publication package, never a provider publication or owner approval.
export async function buildMarketingPackage(project,{trackingLink,assets=[],now=()=>new Date().toISOString()}={}){
 if(!project?.id||!Number.isInteger(project.revision)||!project.brief)throw fault('Ongeldig marketingproject.');
 if(JSON.stringify(project).length>1200000)throw fault('Marketingproject is te groot.');
 const channels=[...new Set((project.brief.channels||[]).map(channel))];if(!channels.length)throw fault('Kies minstens één kanaal.');
 const ads=project.steps?.admaker?.result?.ads||[],posts=project.steps?.promotie?.result?.posts||[];
 if(!ads.length&&!posts.length)throw fault('Maak eerst advertentie- en promotieconcepten.');
 const destinationURL=https(project.brief.website),variants=[];
 const add=async(item,kind,index)=>{const selected=channel(item.channel);if(!channels.includes(selected))throw fault('Concept bevat een niet gekozen kanaal.');
  if(variants.length>=8)return;
  const id=kind+'-'+index,trackingURL=trackingLink?https(await trackingLink(destinationURL,{channel:selected,source:selected.toLowerCase(),medium:'organic',variantId:id,campaign:(project.mode==='test'?'TEST-':'')+project.id,test:project.mode==='test'})):'';
  const copy=text(item.text,12000),cta=text(item.cta,1000),url=trackingURL||destinationURL;
  // Replace observed homepage links before adding a single destination; preserve other product links.
  let caption=copy.split(destinationURL).join(url);if(cta&&!caption.includes(cta))caption+='\n\n'+cta.split(destinationURL).join(url);if(!caption.includes(url))caption+='\n\n'+url;
  const video=['YouTube','TikTok','Snapchat'].includes(selected),visual=item.visual||{};
  variants.push({id,channel:selected,kind,format:video?'video-script':'image-post',headline:text(item.headline||item.title,160),caption:caption.trim(),cta,destinationURL,trackingURL,day:Number.isInteger(item.day)?item.day:null,visual:{headline:text(visual.headline||item.headline||item.title,160),subtitle:text(visual.subtitle,200),scene:text(visual.scene||item.imageBrief,4000),style:visual.style==='photo'?'photo':'editorial'},asset:assetFor(assets,id),requiresVideoRender:video,publicationStatus:'private-preview',warnings:[...(!trackingURL?['Geen ondertekende trackinglink gekoppeld.']:[]),...(selected==='Instagram'?['Een URL in een Instagram-caption is niet klikbaar; controleer de profiel- of storylink.']:[]),...(video?['Dit is een videoscript; nog geen gerenderde video.']:[])]});
 };
 for(const [i,item]of ads.entries())await add(item,'ad',i);
 for(const [i,item]of posts.entries())await add(item,'promotion',i);
 for(const variant of variants){variant.format=variant.requiresVideoRender?'video_script':'still_image';variant.asset=variant.asset||assetFor(assets,'shared');variant.assetStatus=variant.asset?.image?'embedded-image-present':variant.asset?.sourceURL?'source-only-not-embedded':'missing';}
 const result=project.steps?.sitebuilder?.result||{};
 return {kind:'marketing-package-v1',id:createHash('sha256').update(project.id+':'+project.revision).digest('hex').slice(0,24),projectId:project.id,projectRevision:project.revision,createdAt:now(),mode:'private-preview',published:false,channels,variants,landing:{title:text(result.title||project.name,200),headline:text(result.headline,500),intro:text(result.intro,4000),sections:(result.sections||[]).slice(0,20).map(s=>({heading:text(s.heading,300),text:text(s.text,6000)})),cta:text(result.cta,1000),url:destinationURL},conversionGoal:'purchase',assetEvidence:{embedded:variants.filter(v=>v.assetStatus==='embedded-image-present').length,missing:variants.filter(v=>v.assetStatus!=='embedded-image-present').length},omittedVariants:Math.max(0,ads.length+posts.length-variants.length),limitations:['Geen publicatie uitgevoerd.','Geen advertentiebudget besteed.','Een publicatiepakket bewijst nog geen verkoop of werkende attributie.']};
}
export function renderMarketingPackageHTML(bundle){
 if(bundle?.kind!=='marketing-package-v1'||!Array.isArray(bundle.variants))throw fault('Ongeldig publicatiepakket.');
 const paragraphs=s=>escape(s).replace(/\n/g,'<br>');
 const cards=bundle.variants.map(v=>{channel(v.channel);const src=v.asset?.image||'';if(src&&!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src))throw fault('Ongeldig voorbeeldbeeld.');return '<article><small>'+escape(v.channel)+' · '+escape(v.id)+'</small><h2>'+escape(v.headline)+'</h2>'+(src?'<img alt="Voorbeeldbeeld" src="'+escape(src)+'">':'<p class="pending">'+(v.requiresVideoRender?'Videoscript — video nog te maken':'Beeld nog toe te voegen')+'</p>')+'<p>'+paragraphs(v.caption)+'</p><p><b>Beeldbrief:</b> '+paragraphs(v.visual?.scene||'')+'</p><ul>'+(v.warnings||[]).map(w=>'<li>'+escape(w)+'</li>').join('')+'</ul></article>';}).join('');
 const landing=bundle.landing||{};
 return '<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>'+escape(landing.title)+'</title><style>body{font:17px/1.6 system-ui;background:#f4f2e9;color:#173b32;max-width:1080px;margin:40px auto;padding:24px}article,section{background:white;border:1px solid #d5ded3;border-radius:18px;padding:28px;margin:22px 0}img{max-width:100%;max-height:600px;object-fit:contain}small,.pending{color:#536b60}h1,h2{line-height:1.2}header{border-bottom:3px solid #728d48}</style><header><small>Privé proefpakket · niets gepubliceerd</small><h1>'+escape(landing.title)+'</h1></header>'+cards+'<section><small>Landingspagina — privé inhoudsvoorbeeld</small><h2>'+escape(landing.headline)+'</h2><p>'+paragraphs(landing.intro)+'</p>'+(landing.sections||[]).map(s=>'<h3>'+escape(s.heading)+'</h3><p>'+paragraphs(s.text)+'</p>').join('')+'<p>'+escape(landing.cta)+'</p></section></html>';
}
