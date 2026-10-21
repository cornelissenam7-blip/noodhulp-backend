import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stages=['nieuw','benaderd','afspraak','voorstel','klant','afgezien'];
const topics=['website','campagne','advertentie','promotie','weet-nog-niet'];
const origins=new Set(['https://amcinova.com','https://agents.amcinova.com','https://api.amcinova.com']);
const fail=(status,message)=>Object.assign(Error(message),{status});
const clean=(v,max)=>typeof v==='string'&&v.trim().length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/.test(v)?v.trim():null;
export function validateConsultation(b){
 if(!b||!uuid.test(b.requestId)||b.privacy!==true||b.websiteTrap)throw fail(400,'Controleer je aanvraag en privacybevestiging.');
 const name=clean(b.name,120),company=clean(b.company,160),help=clean(b.help,1500),email=clean(b.email,254)?.toLowerCase();
 if(!name||!company||!help||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!topics.includes(b.topic))throw fail(400,'Vul je naam, bedrijf, e-mailadres, onderwerp en hulpvraag in.');
 const attribution={};for(const key of ['source','medium','campaign','content']){const v=clean(b.attribution?.[key]||'',120);if(v&&/^[\p{L}\p{N} ._~:/-]+$/u.test(v))attribution[key]=v;}
 return {name,company,email,help,topic:b.topic,privacyVersion:'consultation-v1',attribution};
}
export function registerConsultationRoutes(app,{json,db,adminAccess,env=process.env,now=Date.now,allowedOrigins=origins}={}){
 const secret=env.SUPABASE_SERVICE_ROLE_KEY||'';
 const sign=(id,metadata)=>createHmac('sha256',secret).update('amcinova-consultation-v1:'+id+':'+metadata.fingerprint).digest('hex');
 const verified=r=>{const s=r?.metadata?.proof;if(!secret||!r?.metadata?.fingerprint||typeof s!=='string'||!/^[a-f0-9]{64}$/.test(s))return false;return timingSafeEqual(Buffer.from(s),Buffer.from(sign(r.lead_id,r.metadata)));};
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){res.status(e.status||503).json({ok:false,error:e.status?e.message:'Opslaan is tijdelijk niet beschikbaar. Probeer dezelfde aanvraag opnieuw.'});}};
 const admin=(req,res,next)=>!req.query?.key&&adminAccess(req)?next():res.status(401).json({ok:false,error:'Meld je aan als beheerder.'});
 app.use(['/api/consultations','/api/admin/consultations'],(req,res,next)=>{
  res.set('Cache-Control','no-store');res.set('Vary','Origin');const o=req.headers.origin;
  if(o&&!allowedOrigins.has(o))return res.status(403).json({ok:false,error:'Aanvraagbron niet toegestaan.'});
  if(o){res.set('Access-Control-Allow-Origin',o);res.set('Access-Control-Allow-Headers','Content-Type, x-admin-key');res.set('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');}
  if(req.method==='OPTIONS')return res.sendStatus(204);next();
 });
 const parser=json({limit:'6kb'}),parse=(req,res,next)=>parser(req,res,e=>e?res.status(e.type==='entity.too.large'?413:400).json({ok:false,error:'De aanvraag is te groot of ongeldig.'}):next());
 const buckets=new Map();
 const query='?metadata->>kind=eq.consultation';
 const read=async id=>{const rows=await db('amcinova_campaign_leads',{method:'GET',query:query+'&lead_id=eq.'+id+'&select=*&limit=1'});if(!Array.isArray(rows))throw fail(503,'De aanvraagopslag is nog niet beschikbaar.');return rows[0];};
 app.post('/api/consultations',parse,wrap(async(req,res)=>{
  if(!secret)throw fail(503,'Aanvragen ontvangen is nog niet ingesteld.');
  const input=validateConsultation(req.body),id=req.body.requestId,fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const old=await read(id);if(old){if(!verified(old)||old.metadata.fingerprint!==fingerprint)throw fail(409,'Deze aanvraagcode hoort bij andere gegevens. Start een nieuwe aanvraag.');return res.json({ok:true,requestId:id,duplicate:true});}
  const time=now();for(const [k,v] of buckets)if(v.until<time)buckets.delete(k);const hash=v=>createHash('sha256').update(v).digest('hex');
  const limits=[['ip:'+hash(req.ip||'unknown'),100],['email:'+hash(input.email),3]];
  if(buckets.size>=10000||limits.some(([k,max])=>(buckets.get(k)?.count||0)>=max))throw fail(429,'Te veel aanvragen. Probeer het later opnieuw of mail info@amcinova.com.');
  for(const [k]of limits){const b=buckets.get(k)||{count:0,until:time+3600000};b.count++;buckets.set(k,b);}
  const created=new Date(time).toISOString(),metadata={kind:'consultation',...input,fingerprint,revision:randomUUID(),stage:'nieuw',note:'',nextActionAt:null,history:[],marketingConsent:false};metadata.proof=sign(id,metadata);
  await db('amcinova_campaign_leads',{method:'POST',query:'?on_conflict=lead_id',prefer:'resolution=ignore-duplicates,return=minimal',body:{lead_id:id,site:'amcinova.com',source:input.attribution.source||'direct',medium:input.attribution.medium||'website',campaign:input.attribution.campaign||'kennismaking',name:input.name,email:input.email,phone:null,message:input.help,status:'new',metadata,created_at:created,updated_at:created}});
  const stored=await read(id);if(!verified(stored)||stored.metadata.fingerprint!==fingerprint)throw fail(409,'De aanvraag kon niet met dezelfde gegevens worden bevestigd.');
  res.json({ok:true,requestId:id});
 }));
 app.get('/api/admin/consultations',admin,wrap(async(req,res)=>{
  const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw fail(400,'Ongeldige pagina.');
  const rows=await db('amcinova_campaign_leads',{method:'GET',query:query+'&select=*&order=created_at.desc,lead_id.asc&limit=50&offset='+offset});
  res.json({ok:true,requests:rows.map(r=>({id:r.lead_id,createdAt:r.created_at,...r.metadata,proof:undefined,fingerprint:undefined,verified:verified(r)})),nextOffset:rows.length===50?offset+50:null});
 }));
 app.patch('/api/admin/consultations/:id',admin,parse,wrap(async(req,res)=>{
  const b=req.body;if(!uuid.test(req.params.id)||!uuid.test(b?.revision)||!stages.includes(b.stage)||clean(b.note,1200)===null)throw fail(400,'Controleer status en notitie.');
  const due=b.nextActionAt?new Date(b.nextActionAt):null;if(due&&(!Number.isFinite(due.getTime())||due.getUTCFullYear()<2020||due.getUTCFullYear()>2100))throw fail(400,'Ongeldige vervolgdatum.');
  const row=await read(req.params.id);if(!row||!verified(row))throw fail(404,'Aanvraag niet gevonden of herkomst niet bevestigd.');if(row.metadata.revision!==b.revision)throw fail(409,'De aanvraag is ondertussen gewijzigd. Vernieuw het overzicht.');
  const stamp=new Date(now()).toISOString(),metadata={...row.metadata,stage:b.stage,note:clean(b.note,1200),nextActionAt:due?.toISOString()||null,revision:randomUUID(),history:[...(row.metadata.history||[]),{stage:b.stage,at:stamp}].slice(-100)};
  const changed=await db('amcinova_campaign_leads',{method:'PATCH',query:query+'&lead_id=eq.'+req.params.id+'&metadata->>revision=eq.'+b.revision,prefer:'return=representation',body:{metadata,updated_at:stamp}});
  if(changed.length!==1)throw fail(409,'De aanvraag is ondertussen gewijzigd. Vernieuw het overzicht.');res.json({ok:true});
 }));
}
