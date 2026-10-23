import {createHash,randomUUID} from 'node:crypto';
import {previewWebsite,websiteImage} from './marketing-website.mjs';
import {buildMarketingPackage,renderMarketingPackageHTML} from './marketing-package.mjs';
import {trackingConfig,trackingURL,signTracking} from './tracking-links.mjs';
import {salesReport,salesByCampaign} from './marketing-sales.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const deterministicId=value=>{const h=createHash('sha256').update(value).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
export function hydratePackage(p){
 if(!p.delivery?.bundle)throw fail(409,'Maak eerst het privé proefpakket.');
 return {...p.delivery.bundle,variants:p.delivery.bundle.variants.map(v=>({...v,asset:p.delivery.assets[v.assetRef]||null}))};
}
export function registerMarketingDelivery(app,{prefix,json,wrap,enabled,identity,load,save,revision,reply,db,env,requireProduct,previewSite=previewWebsite,readImage=websiteImage,salesStore}){
 app.get(prefix+'/:id/results',wrap(async(req,res)=>{
  enabled();const u=await identity(req),p=await load(u,req.params.id),ids=new Set((p.delivery?.trackingLinks||[]).map(l=>l.id));
  if(!salesStore)throw fail(503,'Verkoopterugkoppeling is nog niet aangesloten.');
  const all=await salesStore.list(u.id),events=all.filter(e=>ids.has(e.trackingId)),totals=salesReport(events);
  res.json({ok:true,limited:all.limited===true,totals,campaigns:salesByCampaign(events),evidence:{paymentRoundtrip:events.some(e=>e.paidCents>0),testOrders:events.filter(e=>e.test).length,livePublicationVerified:false},recommendations:all.limited?['Het rapport is begrensd; trek nog geen conclusie over de volledige omzet.']:!events.length?['Volg eerst een proeflink en controleer een betaalde bestelling met campagnemeting.']:['De webshopbevestiging is ontvangen. Proefbestellingen tellen niet mee als campagneomzet.','Zonder echte campagnegegevens is er nog geen onderbouwde winnende variant.'],liveEnabled:false});
 }));
 app.post(prefix+'/:id/package',json({limit:'2kb'}),wrap(async(req,res)=>{
  enabled();const u=await identity(req),p=await load(u,req.params.id);revision(p,req.body);
  await requireProduct(u,'admaker');
  if(Object.values(p.steps).some(s=>!['draft','approved'].includes(s.status))||p.attempts.some(a=>['running','uncertain'].includes(a.status)))throw fail(409,'Rond eerst de vier agentconcepten af.');
  if(p.delivery?.sourceRevision===p.revision)return reply(res,p);
  const source=await previewSite(p.brief.website);
  const covers=(source.images||[]).filter(i=>/omslag|cover|product/i.test(i.url+' '+i.alt));
  const ad=p.steps.admaker.result.ads?.[0]||{},copy=[ad.headline,ad.text,ad.visual?.scene].join(' ').toLowerCase();
  const score=i=>(i.alt.toLowerCase().match(/[\p{L}]{4,}/gu)||[]).filter(word=>copy.includes(word)).length;
  const imageSource=covers.sort((a,b)=>score(b)-score(a))[0]||source.images?.[0];
  if(!imageSource)throw fail(409,'Geen productfoto aangetroffen. Voeg eerst een eigen productbeeld toe.');
  const asset=await readImage(imageSource.url,p.brief.website);
  const assets=[{variantId:'shared',...asset,alt:imageSource.alt,origin:'website-product-image'}];
  const trackingLinks=[];
  const bundle=await buildMarketingPackage(p,{assets,trackingLink:async(destination,meta)=>{
   const config={...trackingConfig({product:'campaign',url:destination,source:meta.source,medium:meta.medium,campaign:meta.campaign,ad:meta.variantId,creator:'admaker'}),id:deterministicId(JSON.stringify([u.id,p.id,meta.variantId,destination,meta.source,meta.medium,meta.campaign]))};
   const query='?user_id=eq.'+u.id+'&product_code=eq.campaign&project_id=eq.'+config.id+'&order=revision.desc&limit=1';
   const old=await db(u,'amcinova_customer_documents',query);
   if(!old.length)try{await db(u,'amcinova_customer_documents','',{id:randomUUID(),user_id:u.id,product_code:'campaign',project_id:config.id,revision:1,name:'Tracking: '+config.campaign+' / '+config.ad,payload:{tracking:config}});}catch(e){if(e.status!==409)throw e;const saved=await db(u,'amcinova_customer_documents',query);if(!saved[0]?.payload?.tracking||saved[0].payload.tracking.campaign!==config.campaign)throw e;}
   const url=trackingURL(config,signTracking(config,u.id,env));trackingLinks.push({id:config.id,variantId:meta.variantId,url});return url;
  }});
  const compact={...bundle,variants:bundle.variants.map(v=>({...v,asset:null,assetRef:0}))};
  const latest=await load(u,p.id);if(latest.revision!==p.revision)throw fail(409,'Project gewijzigd tijdens voorbereiding. Haal de nieuwste status op.');
  reply(res,await save(u,{...p,delivery:{kind:'marketing-delivery-v1',sourceRevision:p.revision+1,createdAt:new Date().toISOString(),assets,bundle:compact,trackingLinks,publication:'blocked-until-owner-approval'}},p.revision+1));
 }));
 app.get(prefix+'/:id/package/export',wrap(async(req,res)=>{
  enabled();const p=await load(await identity(req),req.params.id),bundle=hydratePackage(p);
  res.set('Content-Disposition','attachment; filename="amcinova-prive-proefpakket.html"');res.type('html').send(renderMarketingPackageHTML(bundle));
 }));
}
