import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {registerCustomerRoutes} from './customer-routes.mjs';
const user={id:'11111111-1111-4111-8111-111111111111'},id='22222222-2222-4222-8222-222222222222',grant='33333333-3333-4333-8333-333333333333';
const headers={Authorization:'Bearer '+'a'.repeat(30),'Content-Type':'application/json'};
test('topup routes reuse payment, verify owner, delay grant until paid and cancel only own test lease',async()=>{
 let row,creates=0,grants=0,status='open';const app=express();
 const payment=()=>({id:'tr_TEST123',mode:'test',status,amount:{currency:'EUR',value:'10.89'},metadata:{source:'amcinova',amcinovaTest:true,purpose:'credit-topup-test',requestId:id,userId:user.id,product:'campaign',units:25},getCheckoutUrl:()=> 'https://www.mollie.com/checkout/test'});
 registerCustomerRoutes(app,{json:express.json,env:{SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'sb_publishable_TEST',AMCINOVA_TEST_BILLING_ENABLED:'true',AMCINOVA_TEST_ACCESS_USERS:user.id},testPayments:{ready:true,create:async()=>{creates++;return payment();},get:async()=>payment()},fetchImpl:async(url)=>{
  if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>user};
  assert.ok(url.includes('user_id=eq.'+user.id));return {ok:true,json:async()=>url.includes('customer_access')?[{status:'active',source:'trial'}]:row?[row]:[]};
 },adminDb:async(table,o)=>{
  if(table==='rpc/amcinova_create_test_topup'){assert.equal(o.body.p_user,user.id);row={id,user_id:user.id,product_code:'campaign',units:25,amount_cents:1089,currency:'EUR',policy:'test-topup-20261010',status:'TEST',payment_id:null};return row;}
  if(table==='amcinova_test_credit_payments'){assert.ok(o.query.includes('user_id=eq.'+user.id));row.payment_id=o.body.payment_id;return[row];}
  assert.equal(o.body.p_user,user.id);
  if(table==='rpc/amcinova_complete_test_topup'){grants++;return grant;}
  if(table==='rpc/amcinova_test_service'){assert.equal(o.body.p_product,'campaign');assert.equal(o.body.p_cancel,true);return {mode:'test',cancel_at_period_end:true};}
  assert.fail(table);
 }});
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));const base='http://127.0.0.1:'+s.address().port;
 try{
  const post=()=>fetch(base+'/api/customer/test-topups',{method:'POST',headers,body:JSON.stringify({id,product:'campaign',units:25,user_id:id,amount_cents:1})});
  assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal(creates,1);
  let r=await fetch(base+'/api/customer/test-topups/'+id+'/payment',{headers});assert.equal((await r.json()).credited,false);assert.equal(grants,0);
  for(const unpaid of ['pending','canceled','failed','expired']){status=unpaid;r=await fetch(base+'/api/customer/test-topups/'+id+'/payment',{headers});const d=await r.json();assert.equal(d.credited,false);assert.equal(grants,0);}
  status='paid';r=await fetch(base+'/api/customer/test-topups/'+id+'/payment',{headers});assert.equal((await r.json()).credited,true);assert.equal(grants,1);
  r=await fetch(base+'/api/customer/test-services/campaign',{method:'POST',headers,body:JSON.stringify({cancel:true,user_id:id})});assert.equal(r.status,200);
 }finally{await new Promise(r=>s.close(r));}
});
