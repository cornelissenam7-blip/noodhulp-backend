import {proposeQuote} from './quote-ai.mjs';
import {registerAgentRoutes} from './agent-ai.mjs';
import {createHmac, timingSafeEqual, randomUUID} from 'node:crypto';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds=['Keukenrenovatie','Schilderwerk','Stukadoorswerk','Timmerwerk','Overige werkzaamheden'];
const fields=['job','customer','company','quoteNumber','quoteEmail','quotePhone','quoteAddress','quoteNotes','basis','hours','rate','area','areaRate','markup','vat','frontModel','frontRate','kitchenVat'];
const brandFields=['id','name','address','postcode','phone','email','website','kvk','vat','iban','color','logo','terms'];
const fault=(status,message)=>Object.assign(new Error(message),{status});
const text=(v,max=250)=>{if(typeof v!=='string'||v.length>max)throw fault(400,'Ongeldige tekst of te lange invoer.');return v};
const num=(v,max=100000)=>{if(typeof v!=='number'&&typeof v!=='string')throw fault(400,'Ongeldig bedrag of aantal.');const n=Number(v);if(!Number.isFinite(n)||n<0||n>max)throw fault(400,'Bedragen en aantallen moeten binnen het toegestane bereik liggen.');return n};
const cents=n=>Math.round((n+Number.EPSILON)*100);
const rows=(v,width)=>{if(!Array.isArray(v)||v.length>200||v.some(r=>!Array.isArray(r)||r.length!==width))throw fault(400,'Ongeldige offerteregels.');return v};
function aiState(input){
 if(input==null)return null;
 const description=text(input.description,6000);let proposal=null;
 if(input.proposal!=null){const p=input.proposal;
 const list=v=>{if(!Array.isArray(v)||v.length>100)throw fault(400,'Ongeldig AI-voorstel.');return v};
 proposal={summary:text(p.summary,500),questions:list(p.questions).map(v=>text(v,500)),suggestions:list(p.suggestions||[]).map(v=>text(v,500)),lines:list(p.lines).map(l=>({catalogId:text(l.catalogId,40),quantity:l.quantity===null?null:num(l.quantity),heightMm:l.heightMm===null?null:num(l.heightMm),widthMm:l.widthMm===null?null:num(l.widthMm),detail:text(l.detail,240)}))};
 }
 return{description,proposal};
}

export function validateSnapshot(input){
  if(!input||typeof input!=='object'||!kinds.includes(input.kind)||!input.values||typeof input.values!=='object')throw fault(400,'Ongeldige offerte.');
  const values={};for(const key of fields)if(input.values[key]!==undefined)values[key]=text(input.values[key],key==='quoteNotes'?2500:250);
  const materials=rows(input.materials,2).map(([n,p])=>[text(n,180),String(num(p,10000000))]);
  const fronts=rows(input.fronts,3).map(r=>r.map((v,i)=>{const n=num(v,i===2?10000:100000);if(!Number.isInteger(n))throw fault(400,'Frontmaten en aantallen moeten hele getallen zijn.');return String(n)}));
  const items=rows(input.items,5).map(([name,unit,price,qty,detail])=>{if(!['stuk','m','post'].includes(unit))throw fault(400,'Ongeldige eenheid.');const q=num(qty);if(unit==='stuk'&&!Number.isInteger(q))throw fault(400,'Een aantal stuks moet een geheel getal zijn.');return[text(name,180),unit,String(num(price)),String(q),text(detail,240)]});
  const brand={};for(const k of brandFields)if(input.brand?.[k]!==undefined)brand[k]=text(input.brand[k],k==='logo'?1400000:k==='terms'?1500:250);
  if(brand.logo&&!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(brand.logo)&&brand.logo!=='static/krnn-logo.png')throw fault(400,'Ongeldig logo.');
  if(brand.color&&!/^#[\da-f]{6}$/i.test(brand.color))throw fault(400,'Ongeldige huiskleur.');
  let totalCents;
  if(input.kind==='Keukenrenovatie'){
    const rate=num(values.frontRate);const area=fronts.reduce((s,[h,w,q])=>s+Number(h)*Number(w)*Number(q)/1000000,0);
    totalCents=cents(area*rate)+items.reduce((s,[,,p,q])=>s+cents(Number(p)*Number(q)),0);
    if(![0,9,21].includes(num(values.kitchenVat)))throw fault(400,'Ongeldig btw-percentage.');
  }else{
    if(!['hours','area'].includes(values.basis))throw fault(400,'Kies uren of vierkante meters.');
    const labor=cents(num(values.basis==='area'?values.area:values.hours)*num(values.basis==='area'?values.areaRate:values.rate));
    const material=materials.reduce((s,[,p])=>s+cents(Number(p)),0),markup=num(values.markup,1000),vat=num(values.vat);
    if(![0,9,21].includes(vat))throw fault(400,'Ongeldig btw-percentage.');
    const subtotal=labor+material+Math.round(material*markup/100);totalCents=subtotal+Math.round(subtotal*vat/100);
  }
  if(!Number.isSafeInteger(totalCents)||totalCents>100000000000)throw fault(400,'Offertebedrag is te groot.');
  return {snapshot:{kind:input.kind,values,materials,fronts,items,brand,ai:aiState(input.ai)},totalCents};
}

export function registerQuoteRoutes(app,{json,env=process.env,fetchImpl=fetch,now=()=>Date.now()}={}){
  if(!json)throw Error('Pass express.json as json.');
  registerAgentRoutes(app,{json,env,fetchImpl,now});
  const prefix='/api/agent/quotes';
  const dbUrl=(env.SUPABASE_URL||'').replace(/\/$/,''),dbKey=env.SUPABASE_SERVICE_ROLE_KEY||'',adminKey=(env.ADMIN_KEY||'').trim();
  const secret=env.QUOTE_SIGNING_SECRET||adminKey;
  const eq=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
  const admin=req=>!!adminKey&&eq(String(req.headers['x-admin-key']||'').trim(),adminKey);
  const sign=data=>{const body=Buffer.from(JSON.stringify(data)).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')};
  function grant(req,id){const raw=String(req.headers.authorization||'');if(!raw.startsWith('Bearer ')||!secret)throw fault(401,'Open deze offerte opnieuw vanuit Beheer.');const token=raw.slice(7);if(token.length>4096)throw fault(401,'Ongeldige toegang.');const [body,sig,...extra]=token.split('.');if(extra.length||!body||!sig||!eq(sig,createHmac('sha256',secret).update(body).digest('base64url')))throw fault(401,'Ongeldige toegang.');let data;try{data=JSON.parse(Buffer.from(body,'base64url').toString())}catch{throw fault(401,'Ongeldige toegang.')};if(data.aud!=='amcinova-quote'||data.id!==id||!Number.isFinite(data.exp)||data.exp<=now())throw fault(401,'De toegang is verlopen. Open de offerte opnieuw vanuit Beheer.');return data}
  async function db(query,{method='GET',body,table='amcinova_quotes'}={}){if(!dbUrl||!dbKey)throw fault(503,'Online offerteopslag is nog niet ingesteld.');let response;try{response=await fetchImpl(`${dbUrl}/rest/v1/${table}${query}`,{method,headers:{apikey:dbKey,...(dbKey.startsWith('eyJ')?{Authorization:`Bearer ${dbKey}`} : {}),'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)})}catch{throw fault(503,'De database is niet bereikbaar. Je invoer blijft in beeld.')}if(!response.ok){if(response.status===409)throw fault(409,'Deze offerte is inmiddels gewijzigd. Open de nieuwste versie vanuit Beheer.');throw fault(503,'De database kan de offerte niet verwerken. Controleer of het project actief is en de offertetabel is aangemaakt.')}return response.status===204?[]:response.json()}
  const handle=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res)}catch(e){res.status(e.status||500).json({ok:false,error:e.status?e.message:'Offerteverwerking mislukt.'})}};
  const requireAdmin=req=>{if(!admin(req))throw fault(401,'Log in via het bestaande beheer.');};
  let aiWindow=0,aiCount=0,aiBusy=false;
  app.post(prefix+'/:id/proposal',json({limit:'40kb'}),handle(async(req,res)=>{
    grant(req,req.params.id);
    if(now()-aiWindow>=3600000){aiWindow=now();aiCount=0;}
    if(aiBusy||aiCount>=30)throw fault(429,'Even wachten: de AI is bezig of het uurlimiet is bereikt.');
    aiBusy=true;aiCount++;
    try{res.json({ok:true,proposal:await proposeQuote(req.body,{env,fetchImpl})});}finally{aiBusy=false;}
  }));
  app.post(prefix+'/session',json({limit:'8kb'}),handle(async(req,res)=>{
    requireAdmin(req);if(!secret)throw fault(503,'Offerteopslag is nog niet ingesteld.');
    let id,leadId=null,row=null;
    if(req.body.quoteId){if(!uuid.test(req.body.quoteId))throw fault(400,'Ongeldig offertenummer.');id=req.body.quoteId;row=(await db(`?id=eq.${id}&select=*`))[0];if(!row)throw fault(404,'Offerte niet gevonden.');leadId=row.lead_id;}
    else{id=randomUUID();if(req.body.leadId){leadId=text(req.body.leadId,150);const lead=(await db(`?id=eq.${encodeURIComponent(leadId)}&select=id&limit=1`,{table:'amcinova_campaign_leads'}))[0];if(!lead)throw fault(404,'Aanvraag niet gevonden.');}else await db('?select=id&limit=1');}
    const expiresAt=now()+60*60*1000;res.json({ok:true,id,revision:row?.revision||0,leadId,token:sign({aud:'amcinova-quote',id,leadId,exp:expiresAt}),expiresAt,snapshot:row?.snapshot||null});
  }));
  app.get(prefix,handle(async(req,res)=>{requireAdmin(req);const offset=Number(req.query.offset||0);if(!Number.isInteger(offset)||offset<0||offset>100000)throw fault(400,'Ongeldige pagina.');const data=await db(`?select=id,lead_id,revision,quote_number,customer_name,company_name,total_cents,updated_at&order=updated_at.desc,id.asc&limit=100&offset=${offset}`);res.json({ok:true,quotes:data,nextOffset:data.length===100?offset+100:null})}));
  app.get(prefix+'/:id',handle(async(req,res)=>{if(!uuid.test(req.params.id))throw fault(400,'Ongeldig offerte-ID.');if(!admin(req))grant(req,req.params.id);const row=(await db(`?id=eq.${req.params.id}&select=*`))[0];if(!row)throw fault(404,'Offerte niet gevonden.');res.json({ok:true,quote:row})}));
  app.put(prefix+'/:id',json({limit:'1600kb'}),handle(async(req,res)=>{
    const id=req.params.id;if(!uuid.test(id))throw fault(400,'Ongeldig offerte-ID.');const scope=grant(req,id),revision=req.body.revision;if(!Number.isSafeInteger(revision)||revision<0||revision>1000000)throw fault(400,'Ongeldige offerteversie.');
    const {snapshot,totalCents}=validateSnapshot(req.body.snapshot);const row={lead_id:scope.leadId,revision:revision+1,quote_number:snapshot.values.quoteNumber||'',customer_name:snapshot.values.customer||'',company_name:snapshot.brand.name||snapshot.values.company||'',total_cents:totalCents,snapshot,updated_at:new Date(now()).toISOString()};
    const result=revision===0?await db('',{method:'POST',body:{id,...row}}):await db(`?id=eq.${id}&revision=eq.${revision}`,{method:'PATCH',body:row});
    if(!result?.length)throw fault(409,'Deze offerte is inmiddels gewijzigd. Open de nieuwste versie vanuit Beheer.');res.json({ok:true,id,revision:result[0].revision,totalCents,updatedAt:result[0].updated_at});
  }));
}
