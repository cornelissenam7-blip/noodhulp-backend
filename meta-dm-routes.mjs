import {createDmWebhook,verifyChallenge,verifyRawBody} from './meta-dm-webhook.mjs';
const path='/api/integrations/meta/webhook';
const unavailable=()=>Object.assign(new Error('Webhook unavailable'),{status:503});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createMetaReceiptStore(adminDb){
 return {async insertReceiptOnce(r){
  const rows=await adminDb('amcinova_social_dm_receipts',{method:'POST',query:'?on_conflict=tenant_id,platform,account_id,message_id',prefer:'resolution=ignore-duplicates,return=representation',body:{tenant_id:r.tenantId,platform:r.platform,account_id:r.accountId,message_id:r.messageId,conversation_key:r.conversationKey,message_at:r.receivedAt,kind:r.kind,qualified_lead:false,post_id:null,post_evidence:'unknown'}});
  if(!Array.isArray(rows)||rows.length>1)throw unavailable();
  if(rows.length===1&&(!rows[0]||typeof rows[0]!=='object'))throw unavailable();
  return rows.length===1;
 }};
}
function receiver(env,adminDb){
 if(env.AMCINOVA_META_DM_ENABLED!=='true'||typeof adminDb!=='function')throw unavailable();
 if(typeof env.AMCINOVA_META_APP_SECRET!=='string'||env.AMCINOVA_META_APP_SECRET.length<16)throw unavailable();
 let accounts;try{accounts=JSON.parse(env.AMCINOVA_META_ACCOUNTS);}catch{throw unavailable();}
 if(!Array.isArray(accounts)||!accounts.length||accounts.length>100||accounts.some(a=>!a||!uuid.test(a.tenantId)))throw unavailable();
 return createDmWebhook({appSecret:env.AMCINOVA_META_APP_SECRET,conversationSecret:env.AMCINOVA_META_CONVERSATION_SECRET,accounts,store:createMetaReceiptStore(adminDb)});
}
export function registerMetaDmRoutes(app,{raw,env,adminDb}){
 const noStore=(_req,res,next)=>{res.set('Cache-Control','no-store');next();};
 const error=(e,_req,res,_next)=>{const status=[400,403,413,415,503].includes(e.status)?e.status:503;res.status(status).json({ok:false,error:status===503?'Webhook unavailable':'Webhook request rejected'});};
 app.get(path,noStore,(req,res)=>{try{res.type('text/plain').send(verifyChallenge(req.query,env.AMCINOVA_META_VERIFY_TOKEN));}catch(e){error(e,req,res);}});
 app.post(path,noStore,(req,res,next)=>{try{if(env.AMCINOVA_META_CUSTOMER_ENABLED==='true'){if(env.AMCINOVA_META_DM_ENABLED!=='true'||typeof adminDb!=='function')throw unavailable();}else req.metaDmReceiver=receiver(env,adminDb);next();}catch(e){error(e,req,res);}},raw({type:()=>true,limit:262144,inflate:false}),async(req,res)=>{try{
  if(env.AMCINOVA_META_CUSTOMER_ENABLED==='true'){
   // Authenticate bytes before consulting account ownership. Database mappings replace
   // legacy environment mappings in customer mode, including disconnected pages.
   const payload=verifyRawBody(req.body,req.get('x-hub-signature-256'),env.AMCINOVA_META_APP_SECRET);
   // Instagram customer OAuth is a separate rollout. Preserve the existing
   // explicit Instagram allowlist without allowing a Facebook fallback.
   if(payload?.object==='instagram'){const result=await receiver(env,adminDb)(req.body,req.get('x-hub-signature-256'));return res.json(result);}
   if(payload?.object!=='page'||!Array.isArray(payload.entry)||payload.entry.length>100)throw Object.assign(Error('Invalid envelope'),{status:400});
   const ids=[...new Set(payload.entry.map(e=>e?.id))];if(ids.some(v=>typeof v!=='string'||!/^\d{1,40}$/.test(v)))throw Object.assign(Error('Invalid page'),{status:400});
   const rows=ids.length?await adminDb('amcinova_meta_connections',{method:'GET',query:'?page_id=in.('+ids.join(',')+')&status=eq.connected&select=page_id,tenant_id'}):[];
   if(!Array.isArray(rows)||rows.some(r=>!uuid.test(r.tenant_id)))throw unavailable();
   req.metaDmReceiver=createDmWebhook({appSecret:env.AMCINOVA_META_APP_SECRET,conversationSecret:env.AMCINOVA_META_CONVERSATION_SECRET,accounts:rows.map(r=>({platform:'facebook',accountId:r.page_id,tenantId:r.tenant_id})),store:createMetaReceiptStore(adminDb)});
  }
  const result=await req.metaDmReceiver(req.body,req.get('x-hub-signature-256'));res.json(result);
 }catch(e){error(e,req,res);}},error);
}
