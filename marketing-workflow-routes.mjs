import {randomUUID} from 'node:crypto';
import {previewWebsite} from './marketing-website.mjs';
import {newWorkflow,workflowFromWebsite,workflowId,workflowInput,confirmWorkflow,startWorkflowStep,finishWorkflowStep,approveWorkflowStep,workflowReadiness,workflowSigner} from './marketing-workflow.mjs';
const fail=(s,m)=>Object.assign(Error(m),{status:s});
export function registerMarketingWorkflow(app,{json,env,identity,db,requireProduct,wrap,credits,generateAgent,fetchImpl,previewSite=previewWebsite}){
 const prefix='/api/customer/marketing-projects',table='amcinova_customer_documents';
 const generationLimits=new Map();
 const signing=()=>workflowSigner(env.MARKETING_WORKFLOW_SECRET||env.AGENT_SIGNING_SECRET||env.SUPABASE_SERVICE_ROLE_KEY);
 const enabled=()=>{if(env.AMCINOVA_MARKETING_WORKFLOW_ENABLED!=='true')throw fail(503,'De centrale proefroute is nog niet vrijgegeven voor gebruik.');};
 async function load(u,id){workflowId(id);await requireProduct(u,'campaign');const rows=await db(u,table,'?user_id=eq.'+u.id+'&product_code=eq.campaign&project_id=eq.'+id+'&order=revision.desc&limit=1');if(!rows[0])throw fail(404,'Project niet gevonden.');const p=signing().open(rows[0].payload,u.id);if(p.id!==id||p.revision!==rows[0].revision)throw fail(409,'Ongeldige projectversie.');return p;}
 async function save(u,p,revision){const next={...p,revision,updatedAt:new Date().toISOString()};const row={id:randomUUID(),user_id:u.id,product_code:'campaign',project_id:p.id,revision,name:p.name,payload:signing().seal(next,u.id)};const rows=await db(u,table,'',row);if(rows[0]?.id!==row.id)throw fail(503,'Opslaan van de processtap niet bevestigd. Haal de status op voordat je opnieuw begint.');return next;}
 const reply=(res,p)=>res.json({ok:true,project:p,readiness:workflowReadiness(p)});
 const revision=(p,b)=>{if(b?.revision!==p.revision)throw fail(409,'Het project is gewijzigd. Haal eerst de laatste versie op.');};
 app.post(prefix,json({limit:'24kb'}),wrap(async(req,res)=>{enabled();const u=await identity(req);await requireProduct(u,'campaign');const p=newWorkflow(req.body);reply(res,await save(u,p,1));}));
 const websiteLimits=new Map();
 function claimWebsite(u){const now=Date.now(),bucket=websiteLimits.get(u.id);if(bucket&&bucket.until>now&&bucket.count>=5)throw fail(429,'Maximaal vijf websitecontroles per uur.');for(const [id,b]of websiteLimits)if(b.until<=now)websiteLimits.delete(id);if(websiteLimits.size>5000)throw fail(429,'Websitecontrole is tijdelijk bezet.');websiteLimits.set(u.id,{count:bucket?.until>now?bucket.count+1:1,until:bucket?.until>now?bucket.until:now+3600000});}
 app.post(prefix+'/from-website',json({limit:'3kb'}),wrap(async(req,res)=>{
  enabled();const u=await identity(req);await requireProduct(u,'campaign');claimWebsite(u);
  const source=await previewSite(req.body?.website),p=workflowFromWebsite(source);
  reply(res,await save(u,p,1));
 }));
 app.post(prefix+'/website-preview',json({limit:'3kb'}),wrap(async(req,res)=>{enabled();const u=await identity(req);await requireProduct(u,'campaign');const now=Date.now(),bucket=websiteLimits.get(u.id);if(bucket&&bucket.until>now&&bucket.count>=5)throw fail(429,'Maximaal vijf websitecontroles per uur.');for(const [id,b]of websiteLimits)if(b.until<=now)websiteLimits.delete(id);if(websiteLimits.size>5000)throw fail(429,'Websitecontrole is tijdelijk bezet.');websiteLimits.set(u.id,{count:bucket?.until>now?bucket.count+1:1,until:bucket?.until>now?bucket.until:now+3600000});res.json({ok:true,source:await previewWebsite(req.body?.website)});}));
 app.get(prefix+'/:id',wrap(async(req,res)=>{enabled();reply(res,await load(await identity(req),req.params.id));}));
 app.post(prefix+'/:id/confirm',json({limit:'1kb'}),wrap(async(req,res)=>{enabled();const u=await identity(req),p=await load(u,req.params.id);revision(p,req.body);if(req.body.confirmed!==true)throw fail(400,'Bevestig de bedrijfsgegevens.');if(p.confirmed)return reply(res,p);reply(res,await save(u,confirmWorkflow(p),p.revision+1));}));
 app.post(prefix+'/:id/steps/:step/approve',json({limit:'1kb'}),wrap(async(req,res)=>{enabled();const u=await identity(req),p=await load(u,req.params.id);revision(p,req.body);if(req.body.confirmed!==true)throw fail(400,'Bevestig het concept.');reply(res,await save(u,approveWorkflowStep(p,req.params.step),p.revision+1));}));
 app.post(prefix+'/:id/steps/:step/run',json({limit:'2kb'}),wrap(async(req,res)=>{
  enabled();const u=await identity(req),p=await load(u,req.params.id),step=req.params.step,requestId=workflowId(req.body?.requestId);
  const previous=p.attempts.find(a=>a.id===requestId);if(previous){if(previous.step!==step)throw fail(409,'Aanvraagcode hoort bij een andere stap.');return reply(res,p);}
  revision(p,req.body);const input=workflowInput(p,step);await requireProduct(u,step);
  if(credits.enabled===false)throw fail(503,'AI-aanvragen zijn voor dit account nog niet beschikbaar. Je website en project zijn wel opgeslagen.');
  const now=Date.now();for(const [id,b]of generationLimits)if(b.until<=now)generationLimits.delete(id);const bucket=generationLimits.get(u.id);if((bucket?.count||0)>=30||generationLimits.size>=5000)throw fail(429,'Het uurlimiet voor de centrale proefroute is bereikt.');
  if(p.attempts.length>=100)throw fail(409,'Dit proefproject heeft de maximale geschiedenis bereikt. Bewaar het en start een nieuw project.');
  // Unique project revision in Postgres claims this step across processes before charging/provider work.
  const running=await save(u,startWorkflowStep(p,step,requestId),p.revision+1);
  generationLimits.set(u.id,{count:(bucket?.count||0)+1,until:bucket?.until||now+3600000});
  try{const saved=await credits.run(u.id,step,requestId,async()=>{const result=await generateAgent(input,{env,fetchImpl});const current=await load(u,p.id);if(current.revision!==running.revision)throw fail(409,'Project gewijzigd tijdens de aanvraag. Controleer de status.');return save(u,finishWorkflowStep(current,step,requestId,result),current.revision+1);});reply(res,saved);}
  catch(e){
   const current=await load(u,p.id);if(current.revision===running.revision){const failed={...current,steps:{...current.steps,[step]:{status:'failed',message:'Deze stap is niet bevestigd. Bekijk de status voordat je opnieuw probeert.'}},attempts:current.attempts.map(a=>a.id===requestId?{...a,status:'uncertain'}:a)};await save(u,failed,current.revision+1);}
   throw e;
  }
 }));
 // Deliberately no enable-live, publish, charge or contact-sending endpoint.
}
