import test from 'node:test';import assert from 'node:assert/strict';
import {adminTestPayment} from './admin-test-payment.mjs';import {testOrder} from './test-order-model.mjs';
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'TEST@example.invalid'};
const order=testOrder({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',selected:['sitebuilder'],method:'once',terms:6,quoteService:0,siteService:0},user);
test('admin reports only verified test payments and rejects unrelated or live payments',async()=>{
 assert.deepEqual(await adminTestPayment(order,{}),{state:'not_started'});
 const row={...order,estimate:{...order.estimate,testPaymentId:'tr_TEST'}};
 const payment={id:'tr_TEST',mode:'test',status:'paid',amount:{currency:'EUR',value:'136.79'},metadata:{source:'amcinova',amcinovaTest:true,orderId:order.id,userId:user.id}};
 for(const status of ['paid','failed','canceled','open','expired']){
  const got=await adminTestPayment(row,{ready:true,get:async()=>({...payment,status})});assert.equal(got.state,'verified');assert.equal(got.status,status);assert.equal(got.productAccessGranted,false);
 }
 for(const bad of [{...payment,mode:'live'},{...payment,metadata:{...payment.metadata,userId:'other'}},{...payment,amount:{currency:'EUR',value:'0.01'}}])assert.equal((await adminTestPayment(row,{ready:true,get:async()=>bad})).state,'unavailable');
 assert.equal((await adminTestPayment(row,{ready:true,get:async()=>{throw Error('offline');}})).state,'unavailable');
});
