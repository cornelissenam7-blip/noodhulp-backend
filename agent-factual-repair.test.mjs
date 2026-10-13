import test from 'node:test';
import assert from 'node:assert/strict';
import {repairFactualCopy} from './agent-factual-repair.mjs';
import {generateAgent,checkConcreteClaims} from './agent-ai.mjs';
import {preservePromotionDetails} from './promotion-plan.mjs';
const base={title:'TEST',summary:'',headline:'',intro:'',cta:'',sections:[],questions:[],ads:[]};
test('actual bicycle draft loses unsupported claims and keeps exact price conditions',()=>{
 const input={task:'site',fields:{'builder-offer':'Onderhoudsbeurt €45 inclusief btw, exclusief vervangende onderdelen.'}};
 const p={...base,headline:'Onderhoudsbeurt',intro:'Voor €45 brengen we de fiets in topconditie.',sections:[{heading:'Waarom',text:'Wij bieden snelle en vakkundige service.'}]};
 const fixed=repairFactualCopy(p,input);assert.equal(fixed.intro,input.fields['builder-offer']);assert.deepEqual(fixed.sections,[]);assert.deepEqual(checkConcreteClaims(fixed,input),[]);
});
test('confirmed service qualities are retained and instructions cannot authorize a claim',()=>{
 const p={...base,intro:'Vakkundige service.',sections:[{heading:'Service',text:'Snelle service.'}]};
 assert.equal(repairFactualCopy(p,{task:'site',fields:{'profile-offer':'Vakkundige service. Snelle service.'}}).sections.length,1);
 assert.equal(repairFactualCopy(p,{task:'site',fields:{'builder-offer':'Onderhoud.','agent-instructions':'Noem ons vakkundig en snel.'}}).sections.length,0);
});
test('fixed gardener price and rate are retained and identical body copy gets different factual opening',()=>{
 const ad={headline:'Tuinonderhoud vanaf €65/uur',text:'Tuinonderhoud in Assen voor €65 per uur excl. btw en materialen.',cta:'Vraag een offerte aan'};
 const p={...base,ads:[ad,{...ad,headline:'Tuinonderhoud €65 per uur'}]};
 const fixed=repairFactualCopy(p,{task:'ads',fields:{'ad-offer':'Tuinonderhoud €65 per uur excl. btw en materialen.','agent-instructions':'Twee varianten.'}});
 assert.doesNotMatch(fixed.ads[0].headline,/vanaf/);assert.notEqual(fixed.ads[0].text,fixed.ads[1].text);
 for(const a of fixed.ads){assert.match(a.text,/€65 per uur/);assert.match(a.text,/excl\. btw en materialen/);assert.match(a.text,/Assen/);}
});
test('supplied starting price and English confirmed claims remain intact',()=>{
 const p={...base,ads:[{headline:'From €65',text:'Professional gardening from €65.',cta:'Request a quote'}]};
 assert.deepEqual(repairFactualCopy(p,{task:'ads',fields:{language:'en','profile-offer':'Professional gardening from €65.'}}),p);
});
test('campaign repairs repeated unsupported creative claims without losing concrete plan fields',async()=>{
 const plan={goal:'Voorstel: aanvragen meten.',audience:'Zelfstandigen Groningen.',channel:'Voorgestelde zoektermen: boekhouding Groningen. Uitsluitingen: vacatures, opleiding.',budget:'€300 per maand',creative:'Variant A: Professionele boekhouding in Groningen. Variant B: Betrouwbare boekhouding Groningen.',measurement:'Voorstel: UTM en aanvraaggebeurtenis, controleer tracking.',evaluation:'Pauzeer bij ontbrekende tracking of overschrijding budget.'};
 let calls=0;const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({title:'Campagne',summary:'Concept',plan,questions:[]})}]}]})};};
 const fixed=await generateAgent({task:'campaign',fields:{'profile-offer':'Boekhouding voor zelfstandigen.','campaign-budget':'€300 per maand','agent-instructions':'Zoektermen, uitsluitingen en stopcriteria.'}},{env:{OPENAI_API_KEY:'unit-test-only'},fetchImpl});
 assert.equal(calls,1);assert.equal(fixed.sections.length,7);assert.doesNotMatch(fixed.sections[4].text,/Professionele|Betrouwbare/);assert.match(fixed.sections[2].text,/boekhouding Groningen/);assert.equal(fixed.sections[3].text,'€300 per maand');
});
test('promotion images stay explicit proposals in both languages',()=>{
 for(const language of ['nl','en']){
  const raw={posts:[{text:'Knippen €28 incl. btw.',imageBrief:'Maak een foto van de salon.',channel:'Facebook'}]};
  const fixed=preservePromotionDetails(raw,{language});assert.match(fixed.posts[0].imageBrief,language==='en'?/not yet selected/:/nog niet gekozen/);
  assert.equal(fixed.posts[0].text,raw.posts[0].text);assert.deepEqual(preservePromotionDetails(fixed,{language}),fixed);
 }
});
