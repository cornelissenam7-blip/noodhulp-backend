import {startCartPayment,verifyCartPayment} from './cart-test-payment.mjs';
import {customerCatalog,customerBundles,validateSelection} from './customer-catalog.mjs';
import {generateAgent} from './agent-ai.mjs';
import {proposeQuote} from './quote-ai.mjs';
import {proposeDrawing} from './drawing-ai.mjs';
import {randomUUID} from 'node:crypto';
import {creditClient} from './ai-credits.mjs';
import {testOrder} from './test-order-model.mjs';
import {testerApplication} from './tester-application.mjs';
import {validateSnapshot} from './quote-routes.mjs';
const products=new Set(customerCatalog.map(p=>p.code));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fault=(status,message)=>Object.assign(new Error(message),{status});
export function websitePlan(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fault(400,'Vul een websiteplan in.');
 const plan={};for(const key of ['name','audience','offer','style','pages','action']){
 if(typeof input[key]!=='string'||input[key].length>2000)throw fault(400,'Vul elk onderdeel in met maximaal 2000 tekens.');plan[key]=input[key].trim();}
 if(!plan.name)throw fault(400,'Geef je plan een naam.');return plan;
}
export function customerDocument(input,userId){
 if(!input||!products.has(input.product)||!uuid.test(input.projectId)||!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>1000000)throw fault(400,'Ongeldig project of versienummer.');
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>200)throw fault(400,'Vul een projectnaam in van maximaal 200 tekens.');
 let payload=input.payload;
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Buffer.byteLength(JSON.stringify(payload))>1700000)throw fault(400,'Ongeldige of te grote projectinhoud.');
 if(input.product==='offertetool')payload=validateSnapshot(payload).snapshot;
 return {id:randomUUID(),user_id:userId,product_code:input.product,project_id:input.projectId,revision:input.revision,name:input.name.trim(),payload};
}
export function isPublicKey(key){
 if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))return true;
 try{return JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='anon';}catch{return false;}
}
export function registerCustomerRoutes(app,{json,env=process.env,fetchImpl=fetch,adminAccess=()=>false,adminDb,testPayments,planAdvisor=generateAgent}={}){
 const credits=creditClient({env,fetchImpl});
 const base=(env.SUPABASE_URL||'').replace(/\/$/,''),key=env.SUPABASE_ANON_KEY||(base==='https://cmcnzcyfkqecisuujhey.supabase.co'?'sb_publishable__uS3FVuahHQPH1w5u0EnDA_w7D65zsq':'');
 const enabled=()=>env.CUSTOMER_ACCOUNTS_ENABLED!=='false'&&base.startsWith('https://')&&isPublicKey(key);
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{if(!enabled())throw fault(503,'Klantaccounts worden voorbereid. De bestaande beheerdersomgeving blijft beschikbaar.');await fn(req,res);}catch(e){res.status(e.status||503).json({ok:false,error:e.status?e.message:'Accountopslag tijdelijk niet beschikbaar. Probeer opnieuw.'});}};
 async function identity(req){
  const token=String(req.headers.authorization||'');
  if(!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(token))throw fault(401,'Meld je aan met je eigen klantaccount.');
  const r=await fetchImpl(base+'/auth/v1/user',{headers:{apikey:key,Authorization:token},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw fault(r.status===401||r.status===403?401:503,'Je aanmelding kon niet worden gecontroleerd. Meld je opnieuw aan.');
  const user=await r.json();if(!uuid.test(user.id))throw fault(401,'Ongeldige aanmelding.');return{id:user.id,email:user.email||'',token};
 }
 async function db(user,table,query='',body,upsert=false){
  // Public key + verified customer JWT: RLS remains active, never a service-role fallback.
  const r=await fetchImpl(base+'/rest/v1/'+table+query,{method:body?'POST':'GET',headers:{apikey:key,Authorization:user.token,'Content-Type':'application/json',Prefer:upsert?'resolution=merge-duplicates,return=representation':'return=representation'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw fault(r.status===409?409:r.status===403?403:503,r.status===409?'Deze versie bestaat al. Haal de nieuwste versie op.':r.status===403?'Je hebt geen actieve toegang tot dit product.':'De klantopslag is nog niet beschikbaar.');return r.status===204?[]:r.json();
 }
 async function requireProduct(u,product){
  if(!products.has(product))throw fault(400,'Onbekend product.');
  const access=await db(u,'amcinova_customer_access','?user_id=eq.'+u.id+'&product_code=eq.'+product+'&select=*');
  const a=access[0];if(!a||a.status!=='active'||(a.expires_at&&Date.parse(a.expires_at)<=Date.now()))throw fault(403,'Je hebt geen actieve toegang tot dit product.');
  if(a.source==='purchase'){const p=await db(u,'amcinova_customer_purchases','?user_id=eq.'+u.id+'&id=eq.'+a.purchase_id+'&product_code=eq.'+product+'&status=eq.paid&select=id,verified_at');if(!p[0]?.verified_at)throw fault(403,'Voor dit product is geen bevestigde aankoop gevonden.');}
 }
 app.get('/api/customer/access/:product',wrap(async(req,res)=>{const u=await identity(req);await requireProduct(u,req.params.product);res.json({ok:true,user:{id:u.id,email:u.email},product:req.params.product});}));
 let aiBusy=false,aiStart=0,aiCount=0;
 const helpLimits=new Map();
 app.post('/api/customer/website-plan/help',json({limit:'20kb'}),wrap(async(req,res)=>{
  const u=await identity(req),plan=websitePlan(req.body?.plan),question=req.body?.question;
  if(typeof question!=='string'||!question.trim()||question.length>1000||Buffer.byteLength(JSON.stringify(plan))>6000)throw fault(400,'Vul een hulpvraag in (maximaal 1000 tekens) en houd je plan beknopt.');
  const now=Date.now();for(const [id,limit] of helpLimits)if(limit.until<=now)helpLimits.delete(id);
  const limit=helpLimits.get(u.id)||{count:0,until:now+3600000};
  if(now-aiStart>3600000){aiStart=now;aiCount=0;}
  if(aiBusy||aiCount>=30||limit.count>=3)throw fault(429,'De agent is bezig of het gratis hulplimiet is bereikt (3 vragen per uur). Probeer later opnieuw.');
  aiBusy=true;aiCount++;limit.count++;helpLimits.set(u.id,limit);
  try{
   const result=await planAdvisor({task:'advice',fields:{'profile-name':plan.name,'profile-audience':plan.audience,'profile-offer':plan.offer,'builder-style':plan.style,'builder-pages':plan.pages,'builder-action':plan.action,'agent-instructions':'Geef beknopt advies bij dit websiteplan en beantwoord deze klantvraag: '+question.trim()+'. Maximaal drie korte adviessecties. Dit is gratis advies, geen uitvoering of persoonlijke ondersteuning. Claim geen wijzigingen, publicatie, bestelling of toezegging. Vraag nooit wachtwoorden.'}},{env,fetchImpl});
   const help={question:question.trim(),createdAt:new Date().toISOString(),plan,result:{title:result.title,summary:result.summary,sections:result.sections,questions:result.questions}};
   const saved={...plan,help};if(Buffer.byteLength(JSON.stringify(saved))>=16000)throw fault(502,'Het advies is te uitgebreid om te bewaren. Stel een specifiekere vraag.');
   await db(u,'amcinova_customer_profiles','?on_conflict=user_id',{user_id:u.id,website_plan:saved},true);
   res.json({ok:true,help});
  }finally{aiBusy=false;}
 }));
 app.post('/api/customer/ai/:mode',json({limit:'100kb'}),wrap(async(req,res)=>{
  const u=await identity(req),mode=req.params.mode;
  if(!['generate','proposal','drawing'].includes(mode))throw fault(400,'Onbekend voorstel.');
  const product=mode==='generate'?'sitebuilder':'offertetool';await requireProduct(u,product);
  if(mode==='generate'&&!['site','advice','review'].includes(req.body?.task))throw fault(403,'Dit voorstel hoort niet bij je product.');
  if(Date.now()-aiStart>3600000){aiStart=Date.now();aiCount=0;}if(aiBusy||aiCount>=30)throw fault(429,'De agent is bezig of het uurlimiet is bereikt. Probeer later opnieuw.');
  aiBusy=true;const requestId=randomUUID();
  try{const result=await credits.run(u.id,product,requestId,async()=>{aiCount++;return(mode==='generate'?generateAgent:mode==='drawing'?proposeDrawing:proposeQuote)(req.body,{env,fetchImpl});});res.json({ok:true,[mode==='generate'?'result':'proposal']:result});}finally{aiBusy=false;}
 }));
 app.get('/api/customer/credits',wrap(async(req,res)=>{
  const u=await identity(req);
  if(!credits.enabled)return res.json({ok:true,enabled:false,balances:[],topupEnabled:false});
  const grants=await db(u,'amcinova_ai_credit_grants','?user_id=eq.'+u.id+'&select=product_code,remaining,expires_at');
  const balances=customerCatalog.map(p=>({product:p.code,name:p.name,remaining:grants.filter(g=>g.product_code===p.code&&(!g.expires_at||Date.parse(g.expires_at)>Date.now())).reduce((n,g)=>n+g.remaining,0)}));
  res.json({ok:true,enabled:true,balances,topupEnabled:false,testTopupEnabled:true,testPacks:[10,25,100]});
 }));
 app.post('/api/customer/credits/test-request',json({limit:'5kb'}),wrap(async(req,res)=>{
  const u=await identity(req);
  if(!credits.enabled)throw fault(503,'AI-tegoeden zijn nog niet geactiveerd.');
  const {id,product,units}=req.body||{};
  if(!uuid.test(id)||!products.has(product)||![10,25,100].includes(units))throw fault(400,'Kies een geldig testpakket.');
  await requireProduct(u,product);
  const row={id,user_id:u.id,product_code:product,units,status:'TEST'},query='?user_id=eq.'+u.id+'&id=eq.'+id;
  let rows=await db(u,'amcinova_ai_topup_requests',query);
  if(!rows.length){try{rows=await db(u,'amcinova_ai_topup_requests','',row);}catch(e){if(e.status!==409)throw e;rows=await db(u,'amcinova_ai_topup_requests',query);}}
  if(!rows[0]||rows[0].product_code!==product||rows[0].units!==units)throw fault(409,'Dit aanvraagnummer hoort bij een andere keuze.');
  res.json({ok:true,request:rows[0],notice:'Testaanvraag opgeslagen. Geen betaling, geen extra tegoed toegekend.'});
 }));
 app.get('/api/admin/ai-credits/:userId',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!adminAccess(req))return res.status(401).json({ok:false,error:'Meld je aan als beheerder.'});
  if(!uuid.test(req.params.userId))return res.status(400).json({ok:false,error:'Ongeldig klantaccount.'});
  if(!credits.enabled)return res.json({ok:true,enabled:false,grants:[],usage:[]});
  try{
   const owner='?user_id=eq.'+req.params.userId;
   const [grants,usage,requests]=await Promise.all([
    adminDb('amcinova_ai_credit_grants',{method:'GET',query:owner+'&select=id,product_code,units,remaining,source,reference,expires_at,created_at&order=created_at.desc&limit=100'}),
    adminDb('amcinova_ai_credit_usage',{method:'GET',query:owner+'&select=request_id,product_code,grant_id,status,created_at&order=created_at.desc&limit=100'}),
    adminDb('amcinova_ai_topup_requests',{method:'GET',query:owner+'&select=id,product_code,units,status,created_at&order=created_at.desc&limit=100'})
   ]);
   res.json({ok:true,enabled:true,grants,usage,requests,limit:100});
  }catch{res.status(503).json({ok:false,error:'AI-tegoeden konden niet worden geladen.'});}
 });
 app.get('/api/customer/config',(_req,res)=>{res.set('Cache-Control','no-store');res.json({ok:true,enabled:enabled(),...(enabled()?{authUrl:base,publicKey:key}:{}),checkoutEnabled:false,aiCreditsEnabled:credits.enabled});});
 app.get('/api/customer/tester-application',wrap(async(req,res)=>{const u=await identity(req);const rows=await db(u,'amcinova_customer_profiles','?user_id=eq.'+u.id+'&select=tester_application');res.json({ok:true,application:rows[0]?.tester_application||null});}));
 app.post('/api/customer/tester-application',json({limit:'10kb'}),wrap(async(req,res)=>{const u=await identity(req),application=testerApplication(req.body,u.email);await db(u,'amcinova_customer_profiles','?on_conflict=user_id',{user_id:u.id,tester_application:application},true);res.json({ok:true,application});}));
 app.get('/api/admin/tester-applications',async(req,res)=>{res.set('Cache-Control','no-store');if(!adminAccess(req))return res.status(401).json({ok:false,error:'Meld je aan als beheerder.'});try{const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return res.status(400).json({ok:false,error:'Ongeldige pagina.'});const rows=await adminDb('amcinova_customer_profiles',{method:'GET',query:'?select=user_id,tester_application&tester_application=not.is.null&order=user_id&limit=50&offset='+offset});res.json({ok:true,applications:rows,nextOffset:rows.length===50?offset+50:null});}catch{res.status(503).json({ok:false,error:'Aanmeldingen konden niet worden geladen.'});}});
 app.post('/api/customer/test-orders',json({limit:'10kb'}),wrap(async(req,res)=>{const u=await identity(req);let row;try{row=testOrder(req.body,u);}catch(e){throw fault(400,e.message);}const query='?user_id=eq.'+u.id+'&id=eq.'+row.id;let rows=await db(u,'amcinova_test_orders',query);if(!rows.length){try{rows=await db(u,'amcinova_test_orders','',row);}catch(e){if(e.status!==409)throw e;rows=await db(u,'amcinova_test_orders',query);}}if(!rows[0])throw fault(409,'Testaanvraag niet bevestigd.');res.json({ok:true,order:rows[0]});}));

 async function ownedTestOrder(req,u){
  if(!uuid.test(req.params.id))throw fault(400,'Ongeldige testaanvraag.');
  const rows=await db(u,'amcinova_test_orders','?user_id=eq.'+u.id+'&id=eq.'+req.params.id);
  if(!rows[0])throw fault(404,'Testaanvraag niet gevonden.');return rows[0];
 }
 app.post('/api/customer/test-orders/:id/payment',json({limit:'2kb'}),wrap(async(req,res)=>{
  const u=await identity(req),order=await ownedTestOrder(req,u);
  if(!testPayments?.ready||!adminDb)throw fault(503,'Testbetalingen zijn nog niet beschikbaar.');
  const payment=await startCartPayment({order,user:u,payments:testPayments,save:async estimate=>{
   const rows=await adminDb('amcinova_test_orders',{method:'PATCH',query:'?id=eq.'+order.id+'&user_id=eq.'+u.id,body:{estimate},prefer:'return=representation'});
   if(!rows?.length)throw fault(503,'Testbetaling kon niet worden opgeslagen. Probeer dezelfde aanvraag opnieuw.');
  }});
  const checkoutUrl=payment.getCheckoutUrl();
  if(!/^https:\/\/(?:[a-z0-9-]+\.)?mollie\.com\//i.test(checkoutUrl||''))throw fault(503,'Betaalpagina niet beschikbaar.');
  res.json({ok:true,payment:verifyCartPayment(payment,order,u),checkoutUrl});
 }));
 app.get('/api/customer/test-orders/:id/payment',wrap(async(req,res)=>{
  const u=await identity(req),order=await ownedTestOrder(req,u);
  if(!order.estimate.testPaymentId)throw fault(404,'Nog geen testbetaling gestart.');
  const payment=await testPayments.get(order.estimate.testPaymentId);
  res.json({ok:true,order,payment:verifyCartPayment(payment,order,u)});
 }));
 app.get('/api/admin/test-orders',async(req,res)=>{res.set('Cache-Control','no-store');if(!adminAccess(req))return res.status(401).json({ok:false,error:'Meld je aan als beheerder.'});try{const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return res.status(400).json({ok:false,error:'Ongeldige pagina.'});const orders=await adminDb('amcinova_test_orders',{method:'GET',query:'?select=*&order=created_at.desc,id.desc&limit=50&offset='+offset});res.json({ok:true,orders,nextOffset:orders.length===50?offset+50:null});}catch{res.status(503).json({ok:false,error:'Testaanvragen konden niet worden geladen.'});}});
 app.get('/api/customer/website-plan',wrap(async(req,res)=>{const u=await identity(req);const rows=await db(u,'amcinova_customer_profiles','?user_id=eq.'+u.id+'&select=website_plan');res.json({ok:true,plan:rows[0]?.website_plan||null});}));
 app.post('/api/customer/website-plan',json({limit:'20kb'}),wrap(async(req,res)=>{const u=await identity(req),plan=websitePlan(req.body?.plan);await db(u,'amcinova_customer_profiles','?on_conflict=user_id',{user_id:u.id,website_plan:plan},true);res.json({ok:true,plan});}));
 app.get('/api/customer/selection',wrap(async(req,res)=>{const u=await identity(req);const rows=await db(u,'amcinova_customer_profiles','?user_id=eq.'+u.id+'&select=selected_products');res.json({ok:true,selected:rows[0]?.selected_products||[],catalog:customerCatalog,bundles:customerBundles});}));
 app.post('/api/customer/selection',json({limit:'10kb'}),wrap(async(req,res)=>{const u=await identity(req),selected=validateSelection(req.body?.selected);await db(u,'amcinova_customer_profiles','?on_conflict=user_id',{user_id:u.id,selected_products:selected},true);res.json({ok:true,selected});}));
 app.get('/api/customer/me',wrap(async(req,res)=>{const u=await identity(req);const owner='?user_id=eq.'+u.id;const [access,purchases,catalog]=await Promise.all([db(u,'amcinova_customer_access',owner+'&select=product_code,status,source,expires_at,purchase_id'),db(u,'amcinova_customer_purchases',owner+'&select=id,product_code,status,amount_cents,currency,created_at&order=created_at.desc&limit=100'),db(u,'amcinova_products','?select=code,name,price_cents,currency,checkout_enabled')]);const availableProducts=[];for(const p of catalog){try{await requireProduct(u,p.code);availableProducts.push(p.code);}catch(e){if(e.status!==403)throw e;}}res.json({ok:true,user:{id:u.id,email:u.email},access,purchases,products:catalog,availableProducts});}));
 app.get('/api/customer/documents',wrap(async(req,res)=>{const u=await identity(req),product=req.query.product;if(!products.has(product))throw fault(400,'Kies een geldig product.');const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw fault(400,'Ongeldige pagina.');const rows=await db(u,'amcinova_customer_documents',`?user_id=eq.${u.id}&product_code=eq.${product}&select=id,project_id,revision,name,created_at&order=created_at.desc,id.asc&limit=50&offset=${offset}`);res.json({ok:true,documents:rows,nextOffset:rows.length===50?offset+50:null});}));
 app.get('/api/customer/documents/:id',wrap(async(req,res)=>{const u=await identity(req);if(!uuid.test(req.params.id))throw fault(400,'Ongeldig document.');const rows=await db(u,'amcinova_customer_documents',`?user_id=eq.${u.id}&id=eq.${req.params.id}&select=*&limit=1`);if(!rows.length)throw fault(404,'Document niet gevonden.');res.json({ok:true,document:rows[0]});}));
 app.post('/api/customer/documents',json({limit:'1800kb'}),wrap(async(req,res)=>{const u=await identity(req),row=customerDocument(req.body,u.id);await requireProduct(u,row.product_code);const result=await db(u,'amcinova_customer_documents','',row);res.status(201).json({ok:true,document:result[0]});}));
}
