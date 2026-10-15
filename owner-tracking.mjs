import {randomUUID} from 'node:crypto';
import {trackingConfig,signTracking,trackingURL,trackingReport} from './tracking-links.mjs';

// The existing Beheer grant represents one private owner workspace, never a customer.
export const ownerTrackingId='9016fa82-943d-4bc1-9dc9-2266e4f63b60';
export function registerOwnerTracking(app,{json,env,authorize,handle,fetchImpl}){
 const prefix='/api/agent/ai/tracking';
 app.post(prefix+'/link',json({limit:'8kb'}),handle(async(req,res)=>{
  authorize(req);
  const link={...trackingConfig(req.body),id:randomUUID()};
  res.json({ok:true,link:{...link,trackingUrl:trackingURL(link,signTracking(link,ownerTrackingId,env))}});
 }));
 app.post(prefix+'/report',json({limit:'256kb'}),handle(async(req,res)=>{
  authorize(req);
  if(!Array.isArray(req.body?.links)||req.body.links.length>200)throw Object.assign(Error('Maximaal 200 trackinglinks per overzicht.'),{status:400});
  const links=req.body.links.map(input=>{
   const clean=trackingConfig(input);
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.id))throw Object.assign(Error('Ongeldige trackinglink.'),{status:400});
   if(!Number.isSafeInteger(input.costCents)||input.costCents<0||input.costCents>100000000)throw Object.assign(Error('Controleer de kosten.'),{status:400});
   return {...clean,id:input.id,costCents:input.costCents,costScope:input.costScope==='all-recorded-events'?'all-recorded-events':null};
  });
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Object.assign(Error('Resultatenopslag niet aangesloten.'),{status:503});
  const url=new URL('/rest/v1/amcinova_campaign_events',env.SUPABASE_URL);
  url.searchParams.set('metadata->tracking->>owner','eq.'+ownerTrackingId);
  url.searchParams.set('order','created_at.desc');url.searchParams.set('limit','1000');
  const response=await fetchImpl(url,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Object.assign(Error('Campagneresultaten tijdelijk niet beschikbaar.'),{status:503});
  const events=await response.json();
  if(!Array.isArray(events))throw Object.assign(Error('Ongeldige resultatenrespons.'),{status:503});
  res.json({ok:true,limited:events.length===1000,links:trackingReport(links.map(tracking=>({payload:{tracking}})),events).map(link=>({...link,trackingUrl:trackingURL(link,signTracking(link,ownerTrackingId,env))}))});
 }));
}
