import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {readTracking} from './tracking-links.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
export function salesSignature(raw,timestamp,secret){return createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');}
export function verifySale(raw,headers,{shops,env,now=Date.now()}){
 const shop=shops[headers['x-amcinova-shop']],stamp=headers['x-amcinova-timestamp'],signature=headers['x-amcinova-signature'];
 if(!shop?.secret||!/^\d{10,13}$/.test(stamp||'')||Math.abs(now-Number(stamp)*1000)>300000)throw fail(401,'Ongeldige winkelbevestiging.');
 const expected=Buffer.from(salesSignature(raw,stamp,shop.secret)),actual=Buffer.from(signature||'');
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw fail(401,'Ongeldige winkelbevestiging.');
 let b;try{b=JSON.parse(raw);}catch{throw fail(400,'Ongeldige bestelling.');}
 const allowed=['orderId','revision','paidCents','refundedCents','currency','test','token','consent'];
 if(Object.keys(b).some(k=>!allowed.includes(k))||!/^\d{1,20}$/.test(b.orderId)||!Number.isSafeInteger(b.revision)||b.revision<1||b.revision>2147483647||!Number.isSafeInteger(b.paidCents)||b.paidCents<0||b.paidCents>1000000000||!Number.isSafeInteger(b.refundedCents)||b.refundedCents<0||b.refundedCents>b.paidCents||b.currency!=='EUR'||typeof b.test!=='boolean'||b.consent!==true)throw fail(400,'Ongeldige verkoopgegevens.');
 const link=readTracking(b.token,env);
 if(link.owner!==shop.owner||link.origin!==shop.origin)throw fail(403,'Campagne hoort niet bij deze winkel.');
 const orderKey=createHash('sha256').update(headers['x-amcinova-shop']+':'+b.orderId).digest('hex');
 return {id:orderKey+':'+b.revision,orderKey,revision:b.revision,owner:link.owner,trackingId:link.id,paidCents:b.paidCents,refundedCents:b.refundedCents,currency:'EUR',test:b.test||link.test===true,receivedAt:new Date(now).toISOString()};
}
export function salesReport(events){const orders=new Map();for(const e of events){const old=orders.get(e.orderKey);if(!old||e.revision>old.revision)orders.set(e.orderKey,e);}const totals={orders:0,grossCents:0,refundCents:0,netCents:0,testOrders:0};for(const e of orders.values()){if(e.test){totals.testOrders++;continue;}if(e.paidCents>0)totals.orders++;totals.grossCents+=e.paidCents;totals.refundCents+=e.refundedCents;totals.netCents+=e.paidCents-e.refundedCents;}return totals;}
// store.putUnique MUST atomically persist id and reject conflicting payloads; return false for exact duplicates.
// store.list MUST enforce owner filtering in storage. Do not use a process-local Map in production.
export function registerMarketingSales(app,{json,shops,env,store,identity,wrap,requireProduct}){
 app.post('/api/marketing/sales',json({limit:'8kb',verify(req,_res,buffer){req.salesRaw=buffer.toString('utf8');}}),async(req,res)=>{try{const event=verifySale(req.salesRaw,req.headers,{shops,env});const inserted=await store.putUnique(event);res.json({ok:true,duplicate:inserted===false});}catch(e){res.status(e.status||503).json({ok:false,error:e.status?e.message:'Opslaan tijdelijk niet beschikbaar.'});}});
 app.get('/api/customer/marketing-sales',wrap(async(req,res)=>{const user=await identity(req);await requireProduct(user,'campaign');const events=await store.list(user.id);res.json({ok:true,limited:events.limited===true,totals:salesReport(events),campaigns:salesByCampaign(events),events});}));
}

export function saleEventUUID(event){const hash=createHash('sha256').update('amcinova-sale-v1:'+event.id).digest('hex');return hash.slice(0,8)+'-'+hash.slice(8,12)+'-5'+hash.slice(13,16)+'-'+((parseInt(hash[16],16)&3)|8).toString(16)+hash.slice(17,20)+'-'+hash.slice(20,32);}
const stableSale=e=>JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>k!=='receivedAt').sort(([a],[b])=>a.localeCompare(b))));
// eventType must be verified against the actual table CHECK constraint before enabling.
// No SQL schema was supplied with this repository: deliberately no silent visit/lead fallback.
export function campaignSalesStore(adminDb,{verifiedSchema=false,eventType}={}){
 if(!verifiedSchema||!['purchase','sale_snapshot'].includes(eventType))throw fail(503,'Verkoopopslag vereist bevestiging van het databaseschema.');
 const table='amcinova_campaign_events';
 return {
  async putUnique(event){
   const eventId=saleEventUUID(event),body={event_id:eventId,site:'amcinova-sales',event_type:eventType,source:'woocommerce',medium:'server',campaign:null,page_url:null,referrer:null,user_agent:null,metadata:{sales:event},created_at:event.receivedAt};
   try{await adminDb(table,{method:'POST',body,prefer:'return=minimal'});return true;}catch(error){
    if(!/409|23505|duplicate/i.test(String(error.message)))throw error;
    const rows=await adminDb(table,{method:'GET',query:'?event_id=eq.'+eventId+'&select=metadata&limit=1'});
    if(!rows[0]?.metadata?.sales||stableSale(rows[0].metadata.sales)!==stableSale(event))throw fail(409,'Een bestelversie bevat tegenstrijdige gegevens.');
    return false;
   }
  },
  async list(owner){
   if(!/^[a-f0-9-]{36}$/i.test(owner))throw fail(400,'Ongeldige eigenaar.');
   const events=[];
   for(let offset=0;offset<10000;offset+=1000){const rows=await adminDb(table,{method:'GET',query:'?metadata->sales->>owner=eq.'+owner+'&event_type=eq.'+eventType+'&select=metadata&order=event_id.asc&limit=1000&offset='+offset});events.push(...rows.map(r=>r.metadata?.sales).filter(e=>e?.owner===owner));if(rows.length<1000)return events;}
   throw fail(503,'Verkooprapport overschrijdt de rapportlimiet; totalen zijn niet volledig.');
  }
 };
}

export function customerDocumentsSalesStore(adminDb,{proofSecret}={}){
 if(typeof proofSecret!=='string'||proofSecret.length<16)throw fail(503,'Verkoopbewijs is nog niet geconfigureerd.');
 const table='amcinova_customer_documents';
 return {
  async putUnique(event){const id=saleEventUUID(event),projectId=saleEventUUID({id:event.orderKey}),body={id,user_id:event.owner,product_code:'campaign',project_id:projectId,revision:event.revision,name:'Verkoopbevestiging',payload:{saleEvent:event,salesPayloadProof:salesProof(event,proofSecret)}};
   try{await adminDb(table,{method:'POST',body,prefer:'return=minimal'});return true;}catch(error){if(!/409|23505|duplicate/i.test(String(error.message)))throw error;const rows=await adminDb(table,{method:'GET',query:'?user_id=eq.'+event.owner+'&id=eq.'+id+'&select=payload&limit=1'});if(!verifiedSalesPayload(rows[0]?.payload,proofSecret)||stableSale(rows[0].payload.saleEvent)!==stableSale(event))throw fail(409,'Een bestelversie bevat tegenstrijdige gegevens.');return false;}
  },
  async list(owner){if(!/^[a-f0-9-]{36}$/i.test(owner))throw fail(400,'Ongeldige eigenaar.');const rows=await adminDb(table,{method:'GET',query:'?user_id=eq.'+owner+'&product_code=eq.campaign&payload->saleEvent=not.is.null&select=payload&order=created_at.desc&limit=1000'});const events=rows.filter(r=>verifiedSalesPayload(r.payload,proofSecret)).map(r=>r.payload.saleEvent).filter(e=>e?.owner===owner);events.limited=rows.length===1000;return events;}
 };
}
export function salesByCampaign(events){const groups=new Map();for(const e of events){if(!groups.has(e.trackingId))groups.set(e.trackingId,[]);groups.get(e.trackingId).push(e);}return [...groups].map(([trackingId,rows])=>({trackingId,...salesReport(rows),testNetCents:salesReport(rows.filter(e=>e.test).map(e=>({...e,test:false}))).netCents}));}

function salesProof(event,secret){return createHmac('sha256',secret).update('amcinova-verified-sale-v1:'+stableSale(event)).digest('hex');}
function verifiedSalesPayload(payload,secret){if(!payload?.saleEvent||typeof payload.salesPayloadProof!=='string')return false;const expected=Buffer.from(salesProof(payload.saleEvent,secret)),actual=Buffer.from(payload.salesPayloadProof);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
