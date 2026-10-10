import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmcinovaTestPayments} from './amcinova-test-payments.mjs';
test('Amcinova never falls back to GuardTap or a live key',async()=>{
 for(const key of ['', 'live_abcdefghijklmnop','test_bad key']){
  let calls=0;const service=createAmcinovaTestPayments({env:{MOLLIE_API_KEY:'live_guardtap',AMCINOVA_MOLLIE_TEST_API_KEY:key},createClient:()=>{calls++;}});
  assert.equal(service.ready,false);assert.equal(calls,0);await assert.rejects(service.create({}),{status:503});
 }
});
test('separate test key and server-owned source marker are used',async()=>{
 let seen,config;const service=createAmcinovaTestPayments({env:{MOLLIE_API_KEY:'live_guardtap',AMCINOVA_MOLLIE_TEST_API_KEY:'test_abcdefghijklmnop'},createClient:options=>{seen=options.apiKey;return {payments:{create:async c=>{config=c;return {id:'tr_test'}}}}}});
 await service.create({amount:{currency:'EUR',value:'7.00'},metadata:{source:'guardtap',amcinovaTest:false}});
 assert.equal(seen,'test_abcdefghijklmnop');assert.deepEqual(config.metadata,{source:'amcinova',amcinovaTest:true});assert.equal(config.amount.value,'7.00');
});
test('webhook rejects live, unrelated and invalid payments',async()=>{
 for(const payment of [{mode:'live',metadata:{source:'amcinova',amcinovaTest:true}},{mode:'test',metadata:{source:'guardtap'}},{mode:'test',metadata:{source:'amcinova'}}]){
  const service=createAmcinovaTestPayments({env:{AMCINOVA_MOLLIE_TEST_API_KEY:'test_abcdefghijklmnop'},createClient:()=>({payments:{get:async()=>payment}})});
  await assert.rejects(service.get('tr_example'),{status:404});await assert.rejects(service.get('../../anything'),{status:400});
 }
 const payment={mode:'test',status:'paid',metadata:{source:'amcinova',amcinovaTest:true}};
 const service=createAmcinovaTestPayments({env:{AMCINOVA_MOLLIE_TEST_API_KEY:'test_abcdefghijklmnop'},createClient:()=>({payments:{get:async()=>payment}})});
 assert.equal(await service.get('tr_example'),payment);
});
