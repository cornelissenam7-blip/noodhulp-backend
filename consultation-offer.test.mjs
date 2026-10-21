import test from 'node:test';import assert from 'node:assert/strict';import {consultationOffer} from './consultation-offer.mjs';
test('testvoorstel rekent met bestaande testprijzen en verdubbelt AdMaker niet',()=>{
 const single=consultationOffer(['sitebuilder']);assert.equal(single.estimate.rawOnce,19900);assert.equal(single.checkoutEnabled,false);assert.match(single.url,/producten=sitebuilder&/);
 const a=consultationOffer(['promotie','admaker']),b=consultationOffer(['promotie']);assert.deepEqual(a,b);assert.equal(a.estimate.rawMonthly,2900);assert.equal(a.estimate.monthGross,3509);
 assert.equal(consultationOffer([]),null);assert.throws(()=>consultationOffer(['admin']));assert.throws(()=>consultationOffer('sitebuilder'));
});

test('Offertetool kan zelfstandig en met gewenste website worden voorgesteld',()=>{const a=consultationOffer(['offertetool']);assert.equal(a.estimate.rawOnce,19900);assert.equal(a.checkoutEnabled,false);assert.deepEqual(a.selected,['offertetool']);assert.ok(!a.assumptions.some(x=>x.includes('AdMaker')));const b=consultationOffer(['offertetool','sitebuilder']);assert.equal(b.estimate.rawOnce,39800);assert.deepEqual(b.selected,['offertetool','sitebuilder']);});
