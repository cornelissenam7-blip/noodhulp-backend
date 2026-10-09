import test from 'node:test';
import assert from 'node:assert/strict';
import {checkConcreteClaims} from './agent-ai.mjs';
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
