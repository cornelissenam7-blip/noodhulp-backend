import test from 'node:test';import assert from 'node:assert/strict';
import {testOrder} from './test-order-model.mjs';import {verifiedPurchase,fulfillPurchase} from './purchase-fulfillment.mjs';import {commercialReadiness} from './commercial-readiness.mjs';
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'TEST-purchase@example.invalid'};
const order={...testOrder({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',selected:['offertetool'],method:'once',terms:12,siteService:0,quoteService:0,priceVersion:'proposal-20261010-quote'},user),provider_payment_id:'tr_PREPARED'};
const payment={id:'tr_PREPARED',mode:'live',status:'paid',amount:{currency:'EUR',value:'228.75'},metadata:{source:'amcinova-commercial',userId:user.id,orderId:order.id,product:'offertetool'}};
test('verified purchase has server-owned amount, owner and starting quota',()=>{const row=verifiedPurchase(order,payment,user);assert.equal(row.p_units,50);assert.equal(row.p_amount,22875);assert.equal(row.p_user,user.id);});
test('test, unpaid, forged, refunded and wrong-owner payments never activate',()=>{
 for(const changed of [{mode:'test'},{status:'open'},{status:'failed'},{status:'canceled'},{id:'other'},{amount:{currency:'EUR',value:'0.01'}},{metadata:{...payment.metadata,userId:'other'}},{amountRefunded:{value:'1.00'}},{amountChargedBack:{value:'1.00'}}])assert.throws(()=>verifiedPurchase(order,{...payment,...changed},user));
 assert.throws(()=>verifiedPurchase(order,payment,{...user,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}));
});
test('activation disabled by default even with live key, provider is never called',async()=>{
 assert.equal(commercialReadiness({AMCINOVA_MOLLIE_LIVE_API_KEY:'live_123456789012345'}).realPaymentsEnabled,false);
 await assert.rejects(fulfillPurchase({order,user,provider:{get:()=>assert.fail()},activate:()=>assert.fail()}),{status:503});
});
test('approved activation fetches current provider payment before atomic RPC',async()=>{let calls=0;await fulfillPurchase({order,user,approved:true,provider:{get:async id=>{assert.equal(id,order.provider_payment_id);return payment;}},activate:async row=>{calls++;assert.equal(row.p_product,'offertetool');}});assert.equal(calls,1);});
