import test from 'node:test';
import assert from 'node:assert/strict';
import { guardTapShutdown } from './guardtap-shutdown.mjs';
function invoke(path) {
  let next = false;
  const result = { status: 200 };
  const res = { set(){return this;}, status(value){result.status=value;return this;},json(value){result.body=value;return this;} };
  guardTapShutdown({path},res,()=>{next=true;});
  return {...result,next};
}
test('GuardTap payment and SOS paths cannot reach original handlers',()=>{
  for(const path of ['/api/pay','/api/pay/','/mollie/create-payment','/mollie/return','/api/sos','/api/subscribe','/api/affiliate-payout','/api/referrals/test']){
    const r=invoke(path); assert.equal(r.status,410,path); assert.equal(r.next,false,path);
  }
});
test('old GuardTap webhooks cannot create subscriptions',()=>{
  for(const path of ['/api/webhook','/mollie/webhook','/api/subscription-webhook']){
    const r=invoke(path); assert.equal(r.status,200); assert.equal(r.next,false);assert.equal(r.body.disabled,true);
  }
});
test('shared Amcinova functions are unaffected',()=>{
  for(const path of ['/health','/api/amcinova/payments/webhook','/api/amcinova/sitebuilder/checkout','/api/customer/login','/api/agent/track','/api/meta/webhook']) assert.equal(invoke(path).next,true,path);
});
test('public status confirms shutdown',()=>assert.equal(invoke('/api/guardtap/status').body.enabled,false));
