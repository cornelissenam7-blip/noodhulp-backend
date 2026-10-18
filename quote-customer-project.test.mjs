import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {customerDocument} from './customer-routes.mjs';
import {registerQuoteRoutes} from './quote-routes.mjs';
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
test('quote payload retains authoritative project identity and front/handle rows',()=>{
 const row=customerDocument({product:'offertetool',projectId:project,revision:3,name:'TEST',payload:{kind:'Keukenrenovatie',values:{frontRate:'100',kitchenVat:'21'},materials:[],fronts:[['720','596','7']],items:[['Grepen','stuk','12','7','128 mm']],brand:{},customerProject:{projectId:owner,revision:99}}},owner);
 assert.deepEqual(row.payload.customerProject,{projectId:project,revision:3});
 assert.deepEqual(row.payload.fronts,[['720','596','7']]);
 assert.deepEqual(row.payload.items,[['Grepen','stuk','12','7','128 mm']]);
});
test('Beheer tablet list requires admin and exposes metadata only',async()=>{
 const app=express();let calls=0;
 registerQuoteRoutes(app,{json:express.json,env:{ADMIN_KEY:'test-only',SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'},fetchImpl:async(url,options)=>{
  calls++;assert.match(url,/amcinova_customer_documents\?product_code=eq.offertetool&payload->numberReservation=is.null&select=id,user_id,project_id,revision,name,created_at&/);assert.ok(!url.includes('select=payload'));assert.equal(options.method,'GET');return {ok:true,status:200,json:async()=>[{id:owner,project_id:project,revision:3,name:'TEST'}]};
 }});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const url='http://127.0.0.1:'+server.address().port+'/api/agent/quotes/customer';
  assert.equal((await fetch(url)).status,401);assert.equal(calls,0);
  assert.equal((await fetch(url+'?offset=-1',{headers:{'x-admin-key':'test-only'}})).status,400);assert.equal(calls,0);
  const response=await fetch(url,{headers:{'x-admin-key':'test-only'}});assert.equal(response.status,200);const data=await response.json();assert.equal(data.documents[0].project_id,project);assert.equal(data.nextOffset,null);assert.equal(calls,1);
 }finally{await new Promise(r=>server.close(r));}
});
