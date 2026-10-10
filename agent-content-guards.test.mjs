import test from 'node:test';
import assert from 'node:assert/strict';
import {checkConcreteClaims,preserveAdDetails} from './agent-ai.mjs';
import {validatePromotion} from './promotion-plan.mjs';
const result=text=>({title:'TEST',summary:'',headline:'',intro:'',cta:'',sections:[],ads:[{headline:'Boswandeling',text,cta:'Boek een boswandeling'}]});
test('duplicate exact and alternative booking calls rejected',()=>{
 for(const text of ['In Friesland. Boek een boswandeling.','In Friesland. Boek nu.'])assert.ok(checkConcreteClaims(result(text),{task:'ads',fields:{}}).length);
 assert.deepEqual(checkConcreteClaims(result('Begeleide boswandeling in Friesland.'),{task:'ads',fields:{}}),[]);
});
const fields={'promotion-offer':'Boswandeling €20 per gezin, exclusief materialen.','promotion-facts':'Boekingslink https://example.com/boeken?test=amcinova.'};
const week=text=>({summary:'TEST',posts:Array.from({length:4},(_,day)=>({channel:'Facebook',day,title:'TEST',text,imageBrief:'Eigen foto'}))});
test('price conditions and supplied Facebook booking link must survive',()=>{
 assert.throws(()=>validatePromotion(week('€20 per gezin. https://example.com/boeken?test=amcinova'),['Facebook'],fields),/prijsvoorwaarde/);
 assert.throws(()=>validatePromotion(week('€20 per gezin, exclusief materialen.'),['Facebook'],fields),/link ontbreekt/);
 assert.equal(validatePromotion(week('€20 per gezin, exclusief materialen. https://example.com/boeken?test=amcinova'),['Facebook'],fields).posts.length,4);
});
test('English ads retain supplied link and have only one call to action',()=>{
 const input={task:'ads',fields:{'ad-link':'https://example.invalid/book'}};
 assert.ok(checkConcreteClaims(result('Workshop. Book now!'),input).length);
 const ad=result('Nature workshop.');ad.ads[0].cta='Book: https://example.invalid/book';
 assert.deepEqual(checkConcreteClaims(ad,input),[]);
});
test('campaign cannot propose testimonials that have not been verified',()=>{
 const proposal={...result(''),ads:[],sections:[{heading:'Creative',text:'Video with testimonials from previous participants.'}]};
 assert.ok(checkConcreteClaims(proposal,{task:'campaign',fields:{}}).length);
 proposal.sections[0].text='Video demonstrating the workshop activity.';
 assert.deepEqual(checkConcreteClaims(proposal,{task:'campaign',fields:{}}),[]);
});
test('English promotion price conditions remain mandatory',()=>{
 const english={'promotion-offer':'Workshop €80 excluding materials.','promotion-facts':''};
 assert.throws(()=>validatePromotion(week('Workshop €80.'),['Facebook'],english),/prijsvoorwaarde/);
 assert.equal(validatePromotion(week('Workshop €80 excluding materials.'),['Facebook'],english).posts.length,4);
});
test('actual English duplicate-call draft retains a literal offer and supplied CTA link',()=>{
 const input={task:'ads',fields:{'ad-offer':'Nature walk workshop €80 excluding materials. No reviews.','ad-link':'https://example.invalid/book'}};
 const draft=result('Join our nature walk workshop for €80 plus materials. Book now!');
 draft.ads[0].cta='Request a quote';
 const corrected=preserveAdDetails(draft,input);
 assert.equal(corrected.ads[0].text,'Nature walk workshop €80 excluding materials');
 assert.match(corrected.ads[0].cta,/https:\/\/example.invalid\/book/);
 assert.deepEqual(checkConcreteClaims(corrected,input),[]);
});
