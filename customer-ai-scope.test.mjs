import test from 'node:test';
import assert from 'node:assert/strict';
import {customerAIScope as scope} from './customer-ai-scope.mjs';
test('each agent maps to its own entitlement and meter',()=>{
 for(const [mode,task,fields,product] of [
  ['generate','site',{},'sitebuilder'],['admaker','ads',{},'admaker'],['campaign','campaign',{},'campaign'],
  ['promotie','advice',{'research-mode':'promotion-plan'},'promotie'],
  ['shophulp','advice',{'support-mode':'webshop'},'shophulp']
 ])assert.equal(scope(mode,{task,fields,product:'sitebuilder',user_id:'forged'}).product,product);
 assert.equal(scope('drawing').product,'offertetool');assert.equal(scope('proposal').product,'offertetool');
});
test('cross-product and administrative research bypasses are rejected',()=>{
 for(const [mode,task,fields] of [
  ['generate','ads',{}],['generate','campaign',{}],['generate','advice',{'research-mode':'promotion-plan'}],
  ['generate','advice',{'research-mode':'ui-translation'}],
  ['admaker','advice',{}],['campaign','ads',{}],['promotie','site',{'research-mode':'promotion-plan'}],
  ['shophulp','advice',{'support-mode':'webshop','research-mode':'ui-translation'}],['unknown','site',{}]
 ])assert.throws(()=>scope(mode,{task,fields}),e=>e.status===403);
});
