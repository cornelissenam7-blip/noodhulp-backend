import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {generateAgent as rawGenerateAgent,cleanAgentInput,registerAgentRoutes as rawRegisterAgentRoutes} from './agent-ai.mjs';
const require=createRequire(new URL('./package.json',import.meta.url));const express=require('express');
const result={title:'Keukenrenovatie',summary:'Concept op basis van ingevoerde gegevens',sections:[{heading:'Aanpak',text:'Vraag maten op.'}],questions:[],headline:'Vernieuw je keuken',intro:'Renovatie op maat',cta:'Vraag een offerte',ads:[{channel:'Google',headline:'Keuken vernieuwen',text:'Bespreek de mogelijkheden voor jouw keuken.',cta:'Vraag offerte'}]};
const campaignResult={title:'Campagne keukenfronten',summary:'Voorgesteld plan',questions:[],plan:{goal:'Offerteaanvragen',audience:'Huiseigenaren Groningen',channel:'Voorstel: Google zoeken',budget:'Budget onbekend; bepaal bedrag en periode voor de start.',creative:'Vergelijk fronten met werkbladen als invalshoek.',measurement:'Stel offerteaanvragen als gebeurtenis in en controleer de werking.',evaluation:'Vergelijk de aanvragen per variant voor bijsturing.'}};
const providerResponse=(value=result)=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]})});
const response=(value=result)=>providerResponse(value);
const verifiedFetch=fn=>fn;
const generateAgent=(body,opts)=>rawGenerateAgent(body,{...opts,...(opts?.fetchImpl?{fetchImpl:verifiedFetch(opts.fetchImpl)}:{})});
const registerAgentRoutes=(app,opts)=>rawRegisterAgentRoutes(app,{...opts,fetchImpl:verifiedFetch(opts.fetchImpl)});
test('campaign has mandatory plan fields and normalizes to frontend sections',async()=>{
const p=await generateAgent({task:'campaign',fields:{}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async(u,o)=>{const body=JSON.parse(o.body);assert.equal(body.text.format.schema.properties.ads,undefined);assert.deepEqual(body.text.format.schema.properties.plan.required,['goal','audience','channel','budget','creative','measurement','evaluation']);assert.match(body.instructions,/geen webpagina/);return response(campaignResult);}});
assert.deepEqual(p.ads,[]);assert.equal(p.sections.length,7);assert.equal(p.sections[3].heading,'Budget');assert.equal(p.headline,'');
await assert.rejects(generateAgent({task:'campaign',fields:{}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>response(result)}),/campagneplan/);
});
test('website cannot leak irrelevant ads',async()=>{const p=await generateAgent({task:'site',fields:{}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>response({...result,ads:[{...result.ads[0],headline:'x'.repeat(60)}]})});assert.deepEqual(p.ads,[]);});
test('social posts can use complete captions while Google keeps its short schema',async()=>{
 const offer='Wij vervangen keukenfronten en grepen. De bestaande keukenopstelling blijft behouden.';
 const caption=offer+' '+offer;
 const social={title:'Post',summary:'Concept',questions:[],ads:[{channel:'Facebook',headline:'Nieuwe fronten voor jouw bestaande keuken',text:caption,cta:'Bekijk mogelijkheden'}]};
 const p=await generateAgent({task:'ads',fields:{'ad-format':'social-post','ad-channel':'Facebook,Instagram','ad-offer':offer}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async(url,args)=>{const b=JSON.parse(args.body);assert.equal(b.text.format.schema.properties.ads.items.properties.text.maxLength,2200);assert.match(b.instructions,/socialmediaposts/);return response(social);}});
 assert.ok(p.ads[0].text.length>90);
 await generateAgent({task:'ads',fields:{'ad-format':'social-post','ad-channel':'google','ad-offer':offer}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async(url,args)=>{const b=JSON.parse(args.body);assert.equal(b.text.format.schema.properties.ads.items.properties.text.maxLength,90);return response({title:'Ad',summary:'Concept',questions:[],ads:[{channel:'Google',headline:'Keukenfronten vervangen',text:'Wij vervangen keukenfronten en grepen.',cta:'Bekijk mogelijkheden'}]});}});
});
test('UTM-only measurement is repaired before presenting a campaign',async()=>{
 let calls=0;const p=await generateAgent({task:'campaign',fields:{}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>{calls++;return response(calls===1?{...campaignResult,plan:{...campaignResult.plan,measurement:'Installeer UTM-tags voor conversies en controleer de tracking.'}}:campaignResult);}});
 assert.equal(calls,2);assert.match(p.sections.find(s=>s.heading==='Meten').text,/gebeurtenis/);
});
test('all agents send structured requests without embedding the key in input',async()=>{for(const task of ['site','advice','review','campaign','ads']){await generateAgent({task,fields:{'agent-instructions':'Keukenrenovatie in Groningen','review-content':'Wij vervangen keukenfronten.'}},{env:{OPENAI_API_KEY:'test-key'},fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.input.includes('test-key'),false);assert.equal(JSON.parse(body.input).task,task);return response(task==='campaign'?campaignResult:result);}});}});
test('URL-only review, oversized input, missing key and refused provider responses fail clearly',async()=>{assert.throws(()=>cleanAgentInput({task:'review',fields:{'review-url':'https://example.org'}}),/Plak/);assert.throws(()=>cleanAgentInput({task:'ads',fields:{offer:'x'.repeat(16001)}}));await assert.rejects(generateAgent({task:'ads',fields:{}},{env:{}}),/sleutel/);await assert.rejects(generateAgent({task:'site',fields:{}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[]})})}),/bruikbaar/);});
test('agent tokens are scoped, expire and generation never needs a database',async()=>{let time=Date.now(),calls=0;const app=express();registerAgentRoutes(app,{json:express.json,env:{ADMIN_KEY:'only-test',OPENAI_API_KEY:'fake'},now:()=>time,fetchImpl:async()=>{calls++;return response();}});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/agent/ai';const post=(path,body={},headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});try{
assert.equal((await post('/session')).status,401);assert.equal((await post('/generate',{task:'site',fields:{}})).status,401);assert.equal(calls,0);
const s=await(await post('/session',{}, {'x-admin-key':'only-test'})).json();const h={Authorization:'Bearer '+s.token};assert.equal((await post('/generate',{task:'site',fields:{}},h)).status,200);assert.equal(calls,1);
assert.equal((await post('/generate',{task:'review',fields:{'review-url':'https://example.org'}},h)).status,400);assert.equal(calls,1);
time+=3600001;assert.equal((await post('/generate',{task:'site',fields:{}},h)).status,401);
}finally{await new Promise(r=>server.close(r));}});


const niches=[
 {name:'Kleurhuis',offer:'Binnenschilderwerk',audience:'Particuliere woningeigenaren',region:'Zwolle',prices:''},
 {name:'Gladwand',offer:'Binnenmuren stucen',audience:'Particuliere woningeigenaren',region:'Assen',prices:'25 euro per m² inclusief btw'},
 {name:'Papierwinkel',offer:'A5-notitieboeken',audience:'Consumenten',region:'Nederland',prices:'6 euro per stuk inclusief btw'},
 {name:'Keukenbedrijf',offer:'Keukenfronten vervangen',audience:'Huiseigenaren',region:'Groningen',prices:''}
];
for(const niche of niches)for(const task of ['site','ads','campaign'])test(`${niche.name}: ${task} permits supported short copy without a critic`,async()=>{
 const fields=Object.fromEntries(Object.entries(niche).map(([k,v])=>['profile-'+k,v]));fields['campaign-budget']='300 euro voor 30 dagen';
 const output=task==='campaign'?campaignResult:{...result,title:niche.name,headline:niche.offer,intro:niche.offer+' in '+niche.region,ads:[{channel:'Google',headline:'Vraag een offerte',text:niche.offer+'.',cta:'Vraag offerte'}]};
 let calls=0;const p=await rawGenerateAgent({task,fields},{env:{OPENAI_API_KEY:'test'},fetchImpl:async(u,o)=>{calls++;const req=JSON.parse(o.body);assert.notEqual(req.text.format.name,'amcinova_fact_check');assert.equal(JSON.parse(req.input).fields['profile-region'],niche.region);return response(output);}});
 assert.equal(calls,1);if(task==='campaign')assert.equal(p.sections.find(x=>x.heading==='Budget').text,fields['campaign-budget']);
});
test('invented monetary amounts get corrected once using original draft',async()=>{
 let calls=0;const p=await rawGenerateAgent({task:'site',fields:{'profile-prices':'25 euro per m² inclusief btw'}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async(u,o)=>{calls++;if(calls===2)assert.ok(JSON.parse(JSON.parse(o.body).input).previousDraft);return response({...result,intro:calls===1?'Vanaf €99':'25 euro per m² inclusief btw'});}});assert.equal(calls,2);assert.match(p.intro,/25/);
});
test('repeated invented price remains blocked',async()=>{let calls=0;await assert.rejects(rawGenerateAgent({task:'ads',fields:{}},{env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>{calls++;return response({...result,ads:[{channel:'Google',headline:'Slechts €999',text:'Vraag offerte',cta:'Vraag offerte'}]});}}),/niet betrouwbaar/);assert.equal(calls,2);});

