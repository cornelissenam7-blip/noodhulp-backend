import test from 'node:test';
import assert from 'node:assert/strict';
import {registerOwnerTracking,ownerTrackingId} from './owner-tracking.mjs';
import {readTracking} from './tracking-links.mjs';
const env={AMCINOVA_TRACKING_SECRET:'test-only',SUPABASE_URL:'https://database.example',SUPABASE_SERVICE_ROLE_KEY:'test-service'};
function setup(events=[]){
 const routes=new Map(),calls=[];
 registerOwnerTracking({post(path,...handlers){routes.set(path,handlers.at(-1));}},{json:()=>()=>{},env,
  authorize:req=>{if(req.headers.authorization!=='Bearer existing-owner-grant')throw Object.assign(Error('Unauthorized'),{status:401});},
  handle:fn=>fn,fetchImpl:async(url,options)=>{calls.push({url:new URL(url),options});return {ok:true,json:async()=>events};}});
 return {calls,async invoke(path,body,authorized=true){let data;await routes.get('/api/agent/ai/tracking/'+path)({body,headers:{authorization:authorized?'Bearer existing-owner-grant':'Bearer customer-token'}},{json:value=>{data=value;}});return data;}};
}
const input={product:'campaign',url:'https://keukenrenovatienoordned.nl/',source:'google',medium:'cpc',campaign:'KRNN',ad:'variant-a'};
test('owner access cannot be replaced by a customer token and fails before database calls',async()=>{
 const s=setup();await assert.rejects(s.invoke('link',input,false),{status:401});await assert.rejects(s.invoke('report',{links:[]},false),{status:401});assert.equal(s.calls.length,0);
});
test('owner link is signed with the owner workspace; caller cannot select another owner',async()=>{
 const {link}=await setup().invoke('link',{...input,owner:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
 const payload=readTracking(new URL(link.trackingUrl).searchParams.get('amc_track'),env);
 assert.equal(payload.owner,ownerTrackingId);assert.equal(payload.id,link.id);assert.equal(payload.origin,'https://keukenrenovatienoordned.nl');
});
test('owner report queries only owner data, deduplicates leads, and does not treat budget as spend',async()=>{
 const {link}=await setup().invoke('link',input);
 const metadata={tracking:{id:link.id,reference:'request-123',owner:ownerTrackingId}};
 const s=setup([{event_id:'first',event_type:'lead',metadata},{event_id:'second',event_type:'lead',metadata},{event_id:'test',event_type:'lead',metadata:{tracking:{...metadata.tracking,test:true,reference:'test-123'}}}]);
 const result=await s.invoke('report',{links:[{...link,budget:500}]});
 assert.equal(result.links[0].leads,1);assert.equal(result.links[0].costPerLeadCents,null);
 assert.equal(s.calls[0].url.searchParams.get('metadata->tracking->>owner'),'eq.'+ownerTrackingId);
 assert.equal(s.calls[0].options.headers.Authorization,'Bearer test-service');
});
test('invalid spend and oversized reports are rejected before queries',async()=>{
 const {link}=await setup().invoke('link',input),s=setup();
 await assert.rejects(s.invoke('report',{links:[{...link,costCents:-1}]}),{status:400});
 await assert.rejects(s.invoke('report',{links:Array(201).fill(link)}),{status:400});assert.equal(s.calls.length,0);
});
