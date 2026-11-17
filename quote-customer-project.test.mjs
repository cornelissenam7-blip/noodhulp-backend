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
test('Beheer removal requires admin and targets one selected quote ID',async()=>{
 const app=express(),calls=[];
 registerQuoteRoutes(app,{json:express.json,env:{ADMIN_KEY:'test-only',SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'},fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method,body:JSON.parse(options.body)});
  return {ok:true,status:200,json:async()=>calls.length===1?2:0};
 }});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const root='http://127.0.0.1:'+server.address().port+'/api/agent/quotes/customer/';
  const options={method:'DELETE',headers:{'x-admin-key':'test-only'}};
  assert.equal((await fetch(root+owner,{method:'DELETE'})).status,401);
  assert.equal((await fetch(root+'bad-id',options)).status,400);
  assert.equal(calls.length,0);
  assert.deepEqual(await (await fetch(root+owner,options)).json(),{ok:true,deleted:2});
  assert.deepEqual(calls[0],{url:'https://test.invalid/rest/v1/rpc/amcinova_delete_online_quote',method:'POST',body:{p_latest_id:owner}});
  assert.equal((await fetch(root+owner,options)).status,409);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Beheer private PDF archive preserves original bytes and rejects a different PDF for the same number',async()=>{
 const app=express();let stored;
 const value=data=>({ok:true,status:200,json:async()=>data});
 registerQuoteRoutes(app,{json:express.json,env:{ADMIN_KEY:'test-only',SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'},fetchImpl:async(url,options)=>{
  assert.match(url,/amcinova_invoice_pdf_archive/);
  if(options.method==='POST'){stored={id:owner,...JSON.parse(options.body)};return value([stored]);}
  if(url.includes('pdf_base64'))return value(stored?[stored]:[]);
  if(!stored)return value([]);
  const {pdf_base64,...meta}=stored;return value([meta]);
 }});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const url='http://127.0.0.1:'+server.address().port+'/api/agent/quotes/invoice-pdfs';
  const headers={'x-admin-key':'test-only','Content-Type':'application/json'};
  const pdf=Buffer.from('%PDF-1.7\noriginal\n%%EOF').toString('base64');
  const post=(pdf,auth=headers)=>fetch(url,{method:'POST',headers:auth,body:JSON.stringify({number:'QA-1',filename:'Factuur.pdf',pdf})});
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url+'/'+owner)).status,401);
  assert.equal((await post(pdf,{'Content-Type':'application/json'})).status,401);
  assert.equal((await post('not-a-PDF')).status,400);
  assert.equal((await post(pdf)).status,201);
  assert.equal((await post(pdf)).status,200);
  assert.equal((await post(Buffer.from('%PDF-1.7\nother\n%%EOF').toString('base64'))).status,409);
  const listed=await (await fetch(url,{headers})).json();
  assert.ok(!Object.hasOwn(listed.invoices[0],'pdf_base64'));
  const opened=await (await fetch(url+'/'+owner,{headers})).json();
  assert.equal(opened.invoice.pdf_base64,pdf);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
