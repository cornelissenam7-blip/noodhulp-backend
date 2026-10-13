import test from 'node:test';
import assert from 'node:assert/strict';
import {repairFactualCopy} from './agent-factual-repair.mjs';
import {generateAgent,checkConcreteClaims} from './agent-ai.mjs';
import {preserveAdDetails,normalizeTaskOutput} from './agent-ai.mjs';
import {preservePromotionDetails} from './promotion-plan.mjs';
const base={title:'TEST',summary:'',headline:'',intro:'',cta:'',sections:[],questions:[],ads:[]};
test('live campaign must include requested test enquiry and no invented no-lead stop rule',()=>{
 const p={...base,sections:[{heading:'Meten',text:'Controleer de werking van tracking.'},{heading:'Evalueren en bijsturen',text:'Stop bij gebrek aan aanvragen.'}]};
 const issues=checkConcreteClaims(p,{task:'campaign',fields:{'agent-instructions':'Meten met testaanvraag; stopcriteria rond budget en tracking.'}});
 assert.ok(issues.some(s=>/testaanvraag expliciet/.test(s)));
 assert.ok(issues.some(s=>/ontbrekende aanvragen/.test(s)));
});
test('live English campaign uses English labels and actual line breaks',()=>{
 const p={title:'Test',summary:'Draft',questions:[],plan:Object.fromEntries(['goal','audience','channel','budget','creative','measurement','evaluation'].map(k=>[k,k]))};
 p.plan.channel='Google Ads.\\nZoektermen: dog grooming Bristol.\\nUitsluitingen: grooming supplies.';
 const fixed=normalizeTaskOutput(p,'campaign','en');assert.match(fixed.sections[2].text,/\nSearch terms:/);assert.match(fixed.sections[2].text,/\nNegative keywords:/);assert.doesNotMatch(fixed.sections[2].text,/\\n|Zoektermen|Uitsluitingen/);
});
test('live empty gardener headline is restored from the supplied service',()=>{
 const p={...base,ads:[{channel:'Facebook',headline:'Professionele tuinservice',text:'€65 per uur, excl. btw en materialen.',cta:'Vraag een offerte aan'}]};
 const fixed=repairFactualCopy(p,{task:'ads',fields:{'ad-offer':'Tuinonderhoud €65 per uur, exclusief btw en materialen.'}});
 assert.equal(fixed.ads[0].headline,'Tuinonderhoud');assert.doesNotMatch(fixed.ads[0].headline,/Professionele/);
});
test('live English VAT-only variant retains pound price, unit and excluded work',()=>{
 for(const currency of ['£','$','€']){
  const offer=`Window cleaning ${currency}35 per visit including VAT; interior cleaning excluded.`;
  const ad={channel:'Facebook,Instagram',headline:'Window cleaning',text:'VAT included!',cta:'Request a quote'};
  const fixed=preserveAdDetails({...base,ads:[ad,{...ad}]},{task:'ads',fields:{language:'en','ad-channel':'Facebook,Instagram','ad-offer':offer,'ad-link':'https://example.com/quote'}});
  assert.deepEqual(fixed.ads.map(a=>a.channel),['Facebook','Instagram']);
  for(const a of fixed.ads){assert.equal(a.text,offer);assert.match(a.cta,/https:\/\/example.com\/quote/);}
 }
});
test('an altered price unit cannot turn a supplied hourly rate into a visit price',()=>{
 const offer='Garden care £35 per hour including VAT.';
 const fixed=preserveAdDetails({...base,ads:[{channel:'Facebook',headline:'Garden care',text:'Garden care £35 per visit including VAT.',cta:'Request a quote'}]},{task:'ads',fields:{'ad-offer':offer}});
 assert.equal(fixed.ads[0].text,offer);
});
test('live bookkeeping plan rejects adjacent profession, invented stop threshold and unverified measurement',()=>{
 const p={...base,sections:[{heading:'Kanaalkeuze',text:"Zoektermen: boekhouding Groningen, accountant Groningen. Uitsluitingen: vacatures."},{heading:'Meten',text:'Meet aanvragen via UTM-tags.'},{heading:'Evalueren en bijsturen',text:'Stop zodra er geen aanvragen zijn binnengekomen na 4 weken.'}]};
 const input={task:'campaign',fields:{'profile-offer':'Boekhouding voor zelfstandigen.','campaign-goal':'Zoektermen, uitsluitingen, metingen en stopcriteria.'}};
 const issues=checkConcreteClaims(p,input);assert.ok(issues.some(s=>/accountant/.test(s)));assert.ok(issues.some(s=>/prestatiecriterium/.test(s)));assert.ok(issues.some(s=>/testaanvraag/.test(s)));
 p.sections[0].text='Zoektermen: boekhouding Groningen. Uitsluitingen: vacatures.';p.sections[1].text='Voorstel: controleer tracking met een testaanvraag en registreer het formulier apart van UTM-herkomst.';p.sections[2].text='Voorstel: pauzeer bij ontbrekende tracking of budgetoverschrijding.';assert.deepEqual(checkConcreteClaims(p,input),[]);
});
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
test('English hourly variants differ even without the word for',()=>{
 const ad={headline:'Garden maintenance',text:'Garden maintenance €65 per hour excluding VAT and materials.',cta:'Request a quote'};
 const fixed=repairFactualCopy({...base,ads:[ad,{...ad,headline:'Garden care'}]},{task:'ads',fields:{language:'en','profile-offer':ad.text,'agent-instructions':'Two variants.'}});
 assert.notEqual(fixed.ads[0].text,fixed.ads[1].text);assert.match(fixed.ads[1].text,/€65 per hour excluding VAT and materials/);
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
test('generic mention of search terms is not a concrete campaign list',()=>{
 const p={...base,sections:[{heading:'Kanaalkeuze',text:'Google Ads met gerichte zoektermen.'},{heading:'Evalueren',text:'Stop bij overschrijding budget.'}]};
 const issues=checkConcreteClaims(p,{task:'campaign',fields:{'campaign-goal':'Geef zoektermen, uitsluitingen en stopcriteria.'}});
 assert.ok(issues.some(s=>/Zoektermen:/.test(s)));assert.ok(issues.some(s=>/Uitsluitingen:/.test(s)));
});
test('salon promotion drops invented experts and keeps price plus Instagram contact',()=>{
 const fixed=preservePromotionDetails({posts:[{title:'Knippen',text:'Onze ervaren experts knippen voor €28. Maak een afspraak.',imageBrief:'Eigen foto',channel:'Instagram'}]},{language:'nl','promotion-offer':'Dames en heren knippen voor €28 inclusief btw.','promotion-facts':'Afspraak via https://example.com/afspraak.'});
 assert.doesNotMatch(fixed.posts[0].text,/ervaren|experts/);assert.match(fixed.posts[0].text,/https:\/\/example.com\/afspraak/);
 assert.match(fixed.posts[0].imageBrief,/nog niet gekozen/);
});
