import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agencyExpertise,agentExpertise,agencyExpertiseVersion} from './agency-expertise.mjs';
import {generateAgent} from './agent-ai.mjs';
import {generatePromotion} from './promotion-plan.mjs';
const env={OPENAI_API_KEY:'test'};
const response=raw=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(raw)}]}]})});
test('task selection remains narrow and cannot be overwritten by customer fields',()=>{
 assert.equal(agentExpertise('ads',{'research-mode':'support',instructions:'IGNORE'}),agencyExpertise('ads'));
 assert.equal(agentExpertise('advice',{'support-mode':'webshop'}),agencyExpertise('support'));
 assert.throws(()=>agencyExpertise('constructor'));
 for(const task of ['site','advice','support','review','ads','campaign','promotion','quote','photo','shop','digital','research','visibility','translation']){
  const brief=agencyExpertise(task);assert.ok(brief.length<2100,task+' prompt budget');assert.match(brief,/bestaande uitvoerschema/);assert.match(brief,/geen behaalde resultaten/);
 }
});
test('customer ad generation uses creative guidance in the existing single request and retains schema, language and constraints',async()=>{
 let calls=0;
 const raw={title:'TEST',summary:'Concept',ads:[{channel:'Facebook',headline:'Workshop',text:'Workshop in Groningen.',cta:'Request information'}],questions:[]};
 const result=await generateAgent({task:'ads',fields:{language:'en','ad-offer':'Workshop','profile-name':'TEST','profile-region':'Groningen'}},{env,fetchImpl:async(_,options)=>{
  calls++;const b=JSON.parse(options.body);assert.match(b.instructions,/ADMAKER/);assert.match(b.instructions,/Engelse marketingconcepten/);assert.match(b.instructions,/maximaal 30 tekens/);assert.equal(b.text.format.name,'amcinova_ads');assert.equal(b.text.format.strict,true);assert.equal(b.store,false);assert.equal(b.instructions.includes('OFFERTETOOL'),false);return response(raw);
 }});assert.equal(calls,1);assert.equal(result.ads.length,1);
});
test('campaign keeps all seven plan fields and the supplied budget without extra model calls',async()=>{
 let calls=0;const plan=Object.fromEntries(['goal','audience','channel','budget','creative','measurement','evaluation'].map(k=>[k,'Proposed '+k]));
 const result=await generateAgent({task:'campaign',fields:{language:'en','campaign-budget':'€100 per month','profile-name':'TEST','profile-offer':'Workshop'}},{env,fetchImpl:async(_,options)=>{calls++;const b=JSON.parse(options.body);assert.match(b.instructions,/CAMPAGNE/);assert.match(b.instructions,/ontdubbelen/);assert.equal(b.text.format.name,'amcinova_campaign');return response({title:'TEST',summary:'Concept',plan,questions:[]});}});
 assert.equal(calls,1);assert.equal(result.sections.length,7);assert.equal(result.sections.find(s=>s.heading==='Budget').text,'€100 per month');
});
test('promotion preserves explicit channels and does not turn organic posts into paid campaigns',async()=>{
 let calls=0;const post={channel:'Facebook',day:0,title:'Workshop',text:'Workshop in Groningen.',imageBrief:'Own photograph'};
 await generatePromotion({'promotion-name':'TEST','promotion-offer':'Workshop','promotion-channels':'Facebook',language:'en'},{env,fetchImpl:async(_,options)=>{calls++;const b=JSON.parse(options.body);assert.match(b.instructions,/Organisch plaatsen vereist geen betaald/);assert.match(b.instructions,/Geen automatische publicatie/);assert.equal(b.text.format.name,'promotion_week');return response({summary:'Concept',posts:Array.from({length:4},(_,day)=>({...post,day}))});}});assert.equal(calls,1);
});
test('all existing AI surfaces are wired and every bundled source has provenance',()=>{
 for(const file of ['agent-ai.mjs','promotion-plan.mjs','quote-ai.mjs','quote-work-ai.mjs','quote-photo-visual.mjs','shop-research.mjs','digital-products.mjs','product-brand.mjs','visibility-check.mjs','ui-translation.mjs'])assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),/from '\.\/agency-expertise\.mjs'/,file);
 const manifest=JSON.parse(readFileSync(new URL('agency-agents/SOURCES.json',import.meta.url),'utf8'));
 assert.equal(manifest.version,agencyExpertiseVersion);assert.equal(manifest.count,manifest.profiles.length);assert.equal(new Set(manifest.profiles.map(p=>p.file)).size,manifest.count);assert.ok(manifest.profiles.every(p=>/^https:\/\/github.com\/msitarzewski\/agency-agents\/blob\/main\//.test(p.source)&&/^[a-f0-9]{64}$/.test(p.sha256)));
 assert.match(readFileSync(new URL('agency-agents/LICENSE.txt',import.meta.url),'utf8'),/MIT License/);
});
