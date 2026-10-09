import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {statSync,openSync,readSync,closeSync} from 'node:fs';
import path from 'node:path';
import {createWorkbookMailAdapter} from './workbook-mail.mjs';
import {sixMonthsAfter,retentionView} from './workbook-retention.mjs';
const origins=new Set(['https://amcinova.com','https://agents.amcinova.com']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fault=(status,message)=>Object.assign(new Error(message),{status});
export function validateWorkbook(body){
 if(!body||typeof body.name!=='string'||body.name.length>120||/[\x00-\x1f]/.test(body.name))throw fault(400,'Gebruik maximaal 120 tekens voor je naam.');
 if(typeof body.email!=='string'||body.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(body.email)||/[\x00-\x1f<>]/.test(body.email))throw fault(400,'Vul een geldig e-mailadres in voor de bezorging.');
 if(typeof body.proposal!=='boolean'||!uuid.test(body.requestId))throw fault(400,'Ongeldige aanvraag. Vernieuw de pagina.');
 if(body.marketing===true)throw fault(400,'Deze route bevat geen marketinginschrijving.');
 if(body.proposal&&(typeof body.help!=='string'||body.help.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.help)))throw fault(400,'Gebruik maximaal 1000 tekens voor je hulpvraag.');
 return {name:body.name.trim(),email:body.email.trim().toLowerCase(),proposal:body.proposal,help:body.proposal?body.help.trim():'',...(body.language==='en'?{language:'en'}:{})};
}
export function registerWorkbookRoutes(app,{json,env=process.env,fetchImpl=fetch,now=Date.now,hasAdminAccess=()=>false,mailTransport}={}){
 const base=(env.SUPABASE_URL||'').replace(/\/$/,''),key=env.SUPABASE_SERVICE_ROLE_KEY||'',file=env.WORKBOOK_FILE||'',privacy=env.WORKBOOK_PRIVACY_URL||'';
 const mailer=createWorkbookMailAdapter({from:env.WORKBOOK_MAIL_FROM||'',transport:mailTransport});
 const fileReady=()=>{let fd;try{if(!path.isAbsolute(file)||!statSync(file).isFile()||statSync(file).size>10*1024*1024)return false;fd=openSync(file,'r');const signature=Buffer.alloc(5);return readSync(fd,signature,0,5,0)===5&&signature.toString()==='%PDF-';}catch{return false;}finally{if(fd!==undefined)closeSync(fd);}};
 const databaseReady=()=>base.startsWith('https://')&&!!key;
 const signature=(purpose,value)=>createHmac('sha256',key).update('amcinova-workbook-'+purpose+':'+JSON.stringify(value)).digest('base64url');
 const sameSignature=(a,b)=>typeof a==='string'&&/^[A-Za-z0-9_-]{43}$/.test(a)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
 const originProof=row=>signature('origin',[row.lead_id,row.metadata.fingerprint,new Date(row.created_at).toISOString()]);
 const verifiedOrigin=row=>row?.metadata?.kind==='workbook'&&sameSignature(row.metadata.originProof,originProof(row));
 const followUpProof=(row,meta)=>signature('follow-up',[row.lead_id,meta.followUpStatus,meta.followUpStartedAt,meta.followUpStatusChangedAt,meta.followUpReviewAt,meta.followUpNote]);
 const view=row=>{const followUpAuthorized=sameSignature(row.metadata?.followUpProof,followUpProof(row,row.metadata||{})),needsVerification=!verifiedOrigin(row)||(row.metadata?.followUpStatus==='active'&&!followUpAuthorized);const result=retentionView(row,now(),{followUpAuthorized});return {...result,needsVerification,...(needsVerification?{eligible:false}:{})};};
 const enabled=()=>env.WORKBOOK_ENABLED==='true'&&env.WORKBOOK_STORAGE_REVIEWED==='true'&&!!env.WORKBOOK_PRIVACY_VERSION&&databaseReady()&&/^https:\/\/(agents\.)?amcinova\.com\//.test(privacy)&&fileReady();
 const limits=new Map();
 app.use(['/api/workbook','/api/admin/workbook'],(req,res,next)=>{
  res.set('Cache-Control','no-store');res.set('Vary','Origin');const origin=req.headers.origin;
  if(origin&&!origins.has(origin))return res.status(403).json({ok:false,error:'Deze aanvraagbron is niet toegestaan.'});
  const admin=req.originalUrl?.startsWith('/api/admin/workbook');
  if(origin){res.set('Access-Control-Allow-Origin',origin);res.set('Access-Control-Allow-Methods',admin?'GET, PATCH, OPTIONS':'GET, POST, OPTIONS');res.set('Access-Control-Allow-Headers',admin?'Content-Type, x-admin-key':'Content-Type');}
  if(req.method==='OPTIONS')return res.status(origin?204:403).end();next();
 });
 const parse=json({limit:'4kb'});
 const parseBody=(req,res,next)=>parse(req,res,error=>{if(error)return res.status(error.type==='entity.too.large'?413:400).json({ok:false,error:error.type==='entity.too.large'?'De aanvraag is te groot.':'Ongeldige aanvraag.'});next();});
 const protect=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){res.status(e.status||503).json({ok:false,error:e.status?e.message:'Opslag tijdelijk niet beschikbaar. Probeer opnieuw.'});}};
 const requireAdmin=(req,res,next)=>{if(!hasAdminAccess(req))return res.status(401).json({ok:false,error:'Meld je aan bij de bestaande admin.'});next();};
 async function db(query,{method='GET',body}={}){
  if(!databaseReady())throw fault(503,'Opslag tijdelijk niet beschikbaar.');
  const r=await fetchImpl(base+'/rest/v1/amcinova_campaign_leads'+query,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:method==='POST'?'resolution=ignore-duplicates,return=minimal':'return=representation'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw fault(503,'Opslag tijdelijk niet beschikbaar. Probeer opnieuw.');return method==='POST'||r.status===204?null:r.json();
 }
 async function read(id){const rows=await db('?lead_id=eq.'+id+'&metadata->>kind=eq.workbook&select=lead_id,name,email,status,metadata,created_at&limit=1');return verifiedOrigin(rows?.[0])?rows[0]:undefined;}
 async function change(row,metadata){
  if(!uuid.test(row.metadata?.revision||''))throw fault(409,'Deze aanvraag heeft nog geen beheerbare versie. Controleer de migratie.');
  const rows=await db('?lead_id=eq.'+row.lead_id+'&metadata->>kind=eq.workbook&metadata->>revision=eq.'+row.metadata.revision,{method:'PATCH',body:{metadata:{...metadata,revision:randomUUID()},updated_at:new Date(now()).toISOString()}});
  if(rows?.length!==1)throw fault(409,'De aanvraag is ondertussen gewijzigd. Vernieuw het overzicht.');return rows[0];
 }
 function deliveryResponse(res,delivery,recorded=true){
  const accepted=delivery?.status==='accepted';return res.status(accepted?200:202).json({ok:true,saved:true,emailAccepted:accepted,acceptanceRecorded:accepted&&recorded,deliveryStatus:delivery?.status||'pending',...(!accepted?{message:'Je aanvraag is veilig opgeslagen. De e-mailbezorging is nog niet bevestigd. Probeer later opnieuw met dezelfde aanvraag.'}:{message:'Je aanvraag is opgeslagen en de maildienst heeft de werkboekmail geaccepteerd. Controleer ook je spammap; inboxontvangst is nog niet bevestigd.'})});
 }
 app.get('/api/workbook/config',(_req,res)=>res.json({ok:true,enabled:enabled()&&mailer.ready,...(enabled()&&mailer.ready?{privacyUrl:privacy,nameRequired:false,emailRequired:true,delivery:'email'}:{})}));
 app.post('/api/workbook/request',parseBody,protect(async(req,res)=>{
  if(!enabled())throw fault(503,'De werkboekaanvraag wordt voorbereid. Probeer later opnieuw.');
  if(!origins.has(req.headers.origin))throw fault(403,'Deze aanvraagbron is niet toegestaan.');
  const v=validateWorkbook(req.body),time=now(),ip=req.ip||'unknown';
  for(const [k,r] of limits)if(time-r.start>=3600000)limits.delete(k);
  let limit=limits.get(ip);if(!limit){if(limits.size>=10000)throw fault(429,'Probeer later opnieuw.');limit={start:time,count:0};limits.set(ip,limit);}if(++limit.count>20)throw fault(429,'Te veel pogingen. Probeer later opnieuw.');
  const fingerprint=createHash('sha256').update(JSON.stringify(v)).digest('hex'),id=req.body.requestId,created=new Date(time).toISOString();
  await db('?on_conflict=lead_id',{method:'POST',body:{lead_id:id,site:'amcinova.com',source:'workbook',medium:'website',campaign:'werkboek',name:v.name||null,email:v.email,phone:null,message:v.help||null,status:v.proposal?'new':'workbook_requested',metadata:{kind:'workbook',version:3,proposalRequested:v.proposal,...(v.language?{language:v.language}:{}),marketingConsent:false,privacyUrl:privacy,privacyVersion:env.WORKBOOK_PRIVACY_VERSION,fingerprint,originProof:signature('origin',[id,fingerprint,created]),consentVersion:'workbook-email-v1',revision:randomUUID(),followUpStatus:'none',followUpStartedAt:null,retentionStartsAt:created,deleteEligibleAt:sixMonthsAfter(created),delivery:{status:'pending'}},created_at:created,updated_at:created}});
  let row=await read(id);if(!row)throw fault(503,'Opslaan kon niet worden bevestigd. Probeer opnieuw.');
  if(row.metadata?.fingerprint!==fingerprint)throw fault(409,'Deze aanvraagcode is al gebruikt. Vernieuw de pagina.');
  const delivery=row.metadata.delivery||{status:'pending'};
  if(delivery.status==='accepted')return deliveryResponse(res,delivery);
  if(!mailer.ready)return deliveryResponse(res,{status:'unconfigured'});
  if(view(row).eligible)throw fault(410,'Deze aanvraag is verlopen. Start een nieuwe aanvraag.');
  if(delivery.status==='uncertain')return deliveryResponse(res,delivery);
  if(delivery.status==='sending'){
   if(Date.parse(delivery.leaseUntil)>time)return deliveryResponse(res,delivery);
   try{row=await change(row,{...row.metadata,delivery:{...delivery,status:'uncertain'}});}catch{}
   return deliveryResponse(res,{status:'uncertain'});
  }
  try{row=await change(row,{...row.metadata,delivery:{...delivery,status:'sending',leaseUntil:new Date(time+60000).toISOString(),attemptedAt:created}});}catch(e){return deliveryResponse(res,{status:e.status===409?'sending':'pending'});}
  const receipt=await mailer.send({to:v.email,file:v.language==='en'?path.join(path.dirname(file),'Amcinova-from-idea-to-online-customers.pdf'):file,language:v.language||'nl',requestId:id}),finalDelivery={status:receipt.state,acceptedAt:receipt.accepted?new Date(now()).toISOString():null,...(receipt.messageId?{providerMessageId:receipt.messageId}:{})};
  let recorded=false;
  for(let attempt=0;attempt<3;attempt++)try{row=await change(row,{...row.metadata,delivery:finalDelivery});recorded=true;break;}catch(e){if(e.status!==409)break;try{row=await read(id);}catch{break;}if(!row)break;}
  return deliveryResponse(res,finalDelivery,recorded);
 }));
 app.get('/api/admin/workbook',requireAdmin,protect(async(req,res)=>{
  const offset=Number(req.query?.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw fault(400,'Ongeldige pagina.');
  const rows=await db('?metadata->>kind=eq.workbook&select=lead_id,name,email,message,created_at,source,metadata&order=created_at.desc,lead_id.asc&limit=50&offset='+offset);
  res.json({ok:true,deletionEnabled:false,requests:(rows||[]).map(r=>({id:r.lead_id,name:r.name,email:r.email,help:r.message||'',proposalRequested:r.metadata?.proposalRequested===true,createdAt:r.created_at,source:r.source,revision:verifiedOrigin(r)?r.metadata?.revision||null:null,deliveryStatus:r.metadata?.delivery?.status==='sending'&&Date.parse(r.metadata.delivery.leaseUntil)<=now()?'uncertain':r.metadata?.delivery?.status||'not_recorded',followUpNote:r.metadata?.followUpNote||'',retention:view(r)})),nextOffset:rows?.length===50?offset+50:null});
 }));
 app.patch('/api/admin/workbook/:id/follow-up',requireAdmin,parseBody,protect(async(req,res)=>{
  const body=req.body;if(!uuid.test(req.params.id)||!uuid.test(body?.revision)||!['none','active'].includes(body?.status))throw fault(400,'Ongeldige beheerwijziging.');
  if(body.status==='active'&&(typeof body.note!=='string'||!body.note.trim()||body.note.length>400||/[\x00-\x1f]/.test(body.note)))throw fault(400,'Beschrijf het daadwerkelijke vervolg (maximaal 400 tekens).');
  const row=await read(req.params.id);if(!row)throw fault(404,'Werkboekaanvraag niet gevonden.');if(row.metadata.revision!==body.revision)throw fault(409,'De aanvraag is ondertussen gewijzigd. Vernieuw het overzicht.');
  const started=new Date(now()).toISOString(),active=body.status==='active';
  const metadata={...row.metadata,followUpStatus:body.status,followUpStatusChangedAt:started,followUpStartedAt:active?(row.metadata.followUpStartedAt||started):row.metadata.followUpStartedAt||null,followUpReviewAt:active?sixMonthsAfter(started):null,followUpNote:active?body.note.trim():'',followUpPolicyVersion:'six-calendar-months-v1'};metadata.followUpProof=followUpProof(row,metadata);
  const changed=await change(row,metadata);
  res.json({ok:true,revision:changed.metadata.revision,retention:view(changed),deletionEnabled:false});
 }));
 // Deliberately no deletion route, retention scheduler or direct public PDF download.
}
