import test from 'node:test';
import assert from 'node:assert/strict';
import {activateTestAccess} from './test-access.mjs';
import {testOrder} from './test-order-model.mjs';
const user={id:'f6622a5e-014f-4c7b-bca4-9943caf123b0',email:'test@example.invalid'};
const order=testOrder({id:'c4ddfb0d-1371-4b9f-b3ed-b9b4167b47f4',selected:['offertetool'],method:'once',terms:12,quoteService:0,siteService:0,priceVersion:'proposal-20261010-quote'},user);
order.estimate.testPaymentId='tr_TEST123';
const payment={id:'tr_TEST123',mode:'test',status:'paid',amount:{currency:'EUR',value:(order.estimate.first/100).toFixed(2)},metadata:{source:'amcinova',amcinovaTest:true,orderId:order.id,userId:user.id}};
const env={AMCINOVA_TEST_ACCESS_ENABLED:'true',AMCINOVA_TEST_ACCESS_USERS:user.id,SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'};
test('disabled and unlisted accounts never call the privileged RPC',async()=>{
 for(const e of [{...env,AMCINOVA_TEST_ACCESS_ENABLED:'false'},{...env,AMCINOVA_TEST_ACCESS_USERS:''}])assert.deepEqual(await activateTestAccess({env:e,user,order,payment,fetchImpl:()=>{throw Error('must not call');}}),[]);
});
test('pending payment grants nothing',async()=>assert.deepEqual(await activateTestAccess({env,user,order,payment:{...payment,status:'pending'}}),[]));
test('live, wrong id, refunded and wrong amount rejected',async()=>{
 for(const patch of [{mode:'live'},{id:'tr_WRONG'},{amountRefunded:{value:'1.00'}},{amount:{currency:'EUR',value:'0.01'}}])await assert.rejects(activateTestAccess({env,user,order,payment:{...payment,...patch}}));
});
test('verified paid test invokes only the bounded trial RPC',async()=>{
 let count=0;
 const r=await activateTestAccess({env,user,order,payment,fetchImpl:async(url,options)=>{
 count++;assert.ok(url.endsWith('/rpc/amcinova_activate_test_access'));
 assert.deepEqual(JSON.parse(options.body),{p_user:user.id,p_product:'offertetool',p_payment:'tr_TEST123'});
 return {ok:true,json:async()=>({status:'trial',credits:5})};
 }});
 assert.equal(count,1);assert.equal(r[0].credits,5);
});
test('promotion trial includes AdMaker once only after expanded rollout is enabled',async()=>{
 const promo=testOrder({id:order.id,selected:['promotie'],method:'once',terms:12,quoteService:0,siteService:0,priceVersion:'proposal-20261010-quote'},user);promo.estimate.testPaymentId=payment.id;
 const paid={...payment,amount:{currency:'EUR',value:(promo.estimate.first/100).toFixed(2)}};const called=[];
 await activateTestAccess({env,user,order:promo,payment:paid,fetchImpl:()=>assert.fail('expanded rollout disabled')});
 await activateTestAccess({env:{...env,AMCINOVA_CUSTOMER_AGENTS_ENABLED:'true'},user,order:promo,payment:paid,fetchImpl:async(_url,o)=>{called.push(JSON.parse(o.body).p_product);return {ok:true,json:async()=>({status:'trial'})};}});
 assert.deepEqual(called,['promotie','admaker']);
});
