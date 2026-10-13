import test from 'node:test';
import assert from 'node:assert/strict';
import {checkConcreteClaims,preserveAdDetails} from './agent-ai.mjs';
import {validatePromotion} from './promotion-plan.mjs';
const result=text=>({title:'TEST',summary:'',headline:'',intro:'',cta:'',sections:[],ads:[{headline:'Boswandeling',text,cta:'Boek een boswandeling'}]});
test('live bookkeeper campaign cannot invent free or professional service in creative sections',()=>{
 const p={...result(''),ads:[],sections:[{heading:'Advertentievoorstel en test',text:'Professionele boekhouding. Gratis kennismaking.'}]};
 const input={task:'campaign',fields:{'profile-offer':'Boekhouding voor zzp’ers.','profile-facts':'Geen klantreviews, zoekvolumes, conversiecijfers of garanties bekend.'}};
 const issues=checkConcreteClaims(p,input);assert.ok(issues.some(s=>/gratis/i.test(s)));assert.ok(issues.some(s=>/professionele/i.test(s)));
 assert.deepEqual(checkConcreteClaims(p,{task:'campaign',fields:{'profile-offer':'Professionele boekhouding met gratis kennismaking.'}}),[]);
});
test('gardener variants must differ when explicitly requested and summaries cannot invent sharp pricing',()=>{
 const p={...result('Tuinonderhoud voor €65 per uur.'),summary:'Tuinonderhoud voor een scherpe prijs.'};p.ads.push({...p.ads[0],channel:'Instagram'});
 const input={task:'ads',fields:{'ad-offer':'Tuinonderhoud voor €65 per uur.','agent-instructions':'Maak twee varianten.'}};
 assert.ok(checkConcreteClaims(p,input).some(s=>/scherpe prijs/.test(s)));assert.ok(checkConcreteClaims(p,input).some(s=>/identiek/.test(s)));
 p.summary='Tuinonderhoud';p.ads[1].headline='Onderhoud van je tuin';assert.deepEqual(checkConcreteClaims(p,input),[]);
});
test('campaign must cover requested search terms, exclusions and stop criteria',()=>{
 const p={...result(''),ads:[],sections:[{heading:'Kanaalkeuze',text:'Google Ads.'},{heading:'Evalueren en bijsturen',text:'Evalueer na 30 dagen.'}]};
 const input={task:'campaign',fields:{'agent-instructions':'Geef zoektermen, uitsluitingen en stopcriteria.'}};
 assert.equal(checkConcreteClaims(p,input).length,3);
 p.sections[0].text='Voorgestelde zoektermen: boekhouder zzp Groningen. Uitsluitingen: vacatures, opleiding.';
 p.sections[1].text='Pauzeer als tracking niet werkt of het budget wordt overschreden.';
 assert.deepEqual(checkConcreteClaims(p,input),[]);
});
test('live painting regression removes second English contact sentence and rejects invented expert claims',()=>{
 const input={task:'ads',fields:{'ad-offer':'Interior wall painting for homes.','profile-facts':'No professional experience is supplied.'}};
 const draft=result('Interior wall painting for homes. Get in touch!');
 assert.equal(preserveAdDetails(draft,input).ads[0].text,'Interior wall painting for homes.');
 for(const invitation of ['Inquire now!','Enquire today!','Ask for details.','Discover more.','Send a message.','Get in touch!','Get started now!','Enhance your space today!'])assert.equal(preserveAdDetails(result('Interior wall painting for homes. '+invitation),input).ads[0].text,'Interior wall painting for homes.');
 assert.ok(checkConcreteClaims(result('Expert interior wall painting.'),input).some(s=>/expert/i.test(s)));
 assert.ok(checkConcreteClaims(result('Professional interior wall painting.'),input).some(s=>s.includes('Professional')));
 assert.deepEqual(checkConcreteClaims(result('Expert interior wall painting.'),{task:'ads',fields:{'ad-offer':'Expert interior wall painting.'}}),[]);
});
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
