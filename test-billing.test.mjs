import test from 'node:test';import assert from 'node:assert/strict';
import {testBillingRequest as request,verifyTestTopup as verify,startTestTopup,testBillingAllowed} from './test-billing.mjs';
const user={id:'11111111-1111-4111-8111-111111111111'},id='22222222-2222-4222-8222-222222222222';
const row=request({id,product:'campaign',units:25,amount_cents:1,user_id:id,status:'paid'},user);
const payment={id:'tr_TEST123',mode:'test',status:'paid',amount:{currency:'EUR',value:'10.89'},metadata:{source:'amcinova',amcinovaTest:true,purpose:'credit-topup-test',requestId:id,userId:user.id,product:'campaign',units:25}};
test('price, owner and mode are fixed server-side',()=>{assert.equal(row.user_id,user.id);assert.equal(row.status,'TEST');assert.equal(row.amount_cents,1089);assert.equal(request({id,product:'admaker',units:100},user).amount_cents,3509);assert.throws(()=>request({id,product:'admin',units:25},user));assert.throws(()=>request({id,product:'campaign',units:10},user));});
test('no live payment, forged owner, wrong price, product, units or refunded payment accepted',()=>{
 for(const patch of [{mode:'live'},{amount:{currency:'EUR',value:'0.01'}},{metadata:{...payment.metadata,userId:id}},{metadata:{...payment.metadata,product:'sitebuilder'}},{metadata:{...payment.metadata,units:100}},{amountRefunded:{value:'1.00'}},{amountChargedBack:{value:'1.00'}},{status:'unknown'}])assert.throws(()=>verify({...payment,...patch},row,user));
 assert.throws(()=>verify(payment,{...row,payment_id:'tr_OTHER'},user));assert.throws(()=>verify(payment,{...row,user_id:id},user));
 assert.equal(verify(payment,row,user).mode,'test');assert.equal(verify({...payment,status:'pending'},row,user).status,'pending');
});
test('existing payment is reused without creating or saving a second one',async()=>{await startTestTopup({row:{...row,payment_id:payment.id},user,payments:{get:async()=>payment,create:()=>assert.fail('duplicate')},save:()=>assert.fail('duplicate')});});
test('provider creation is idempotent and persists only verified id',async()=>{let saved;await startTestTopup({row,user,payments:{create:async c=>{assert.equal(c.idempotencyKey,'amcinova-topup-'+id);assert.equal(c.amount.value,'10.89');assert.equal(c.metadata.userId,user.id);return payment;}},save:async p=>{saved=p;}});assert.equal(saved,payment.id);});
test('only expressly enabled allowlisted account can use test billing',()=>{const env={AMCINOVA_TEST_BILLING_ENABLED:'true',AMCINOVA_TEST_ACCESS_USERS:user.id};assert.equal(testBillingAllowed(env,user),true);assert.equal(testBillingAllowed({...env,AMCINOVA_TEST_BILLING_ENABLED:'false'},user),false);assert.equal(testBillingAllowed(env,{id}),false);});
