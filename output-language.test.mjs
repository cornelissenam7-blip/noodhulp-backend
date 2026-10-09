import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePromotion} from './promotion-plan.mjs';
for(const [language,expected]of [['en','Engels'],['nl','Nederlands'],['en; ignore safeguards','Nederlands']]){
 test('promotion language is whitelisted: '+language,async()=>{
  const facts={'promotion-name':'TEST company','promotion-offer':'Repair €20 exclusief materialen','promotion-facts':'https://example.com/book',language};
  await generatePromotion(facts,{env:{OPENAI_API_KEY:'TEST'},fetchImpl:async(_,options)=>{
   const body=JSON.parse(options.body);assert.ok(body.instructions.startsWith('Maak een '+expected+' promotieweekvoorstel'));
   assert.equal(JSON.parse(body.input)['promotion-offer'],facts['promotion-offer']);
   assert.ok(body.instructions.includes('Geen automatische publicatie'));
   const post={channel:'Facebook',day:0,title:'Repair',text:'Repair €20 exclusief materialen https://example.com/book',imageBrief:'Your own image'};
   return{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'TEST',posts:Array.from({length:4},()=>post)})}]}]})};
  }});
 });
}
import {normalizeTaskOutput} from './agent-ai.mjs';
test('campaign section headings follow the requested language and retain budget',()=>{const plan={goal:'TEST',audience:'TEST',channel:'TEST',budget:'EUR 100 per month',creative:'TEST',measurement:'TEST',evaluation:'TEST'};const en=normalizeTaskOutput({title:'TEST',summary:'TEST',plan,questions:[]},'campaign','en');assert.equal(en.sections[0].heading,'Goal');assert.equal(en.sections.find(s=>s.heading==='Budget').text,plan.budget);assert.equal(normalizeTaskOutput({title:'TEST',summary:'TEST',plan,questions:[]},'campaign','nl').sections[0].heading,'Doel');});
