import test from 'node:test';
import assert from 'node:assert/strict';
import {checkVisibility,measureMention} from './visibility-check.mjs';
test('neutral question excludes own brand and private fields; actual citation determines mention',async()=>{
 const result=await checkVisibility({'visibility-service':'keukenrenovatie','visibility-region':'Friesland','visibility-brand':'NoordNed','visibility-domain':'https://keukenrenovatienoordned.nl','private':'SECRET'},{env:{OPENAI_API_KEY:'test'},fetchImpl:async(_,o)=>{const b=JSON.parse(o.body);assert(!JSON.stringify(b).includes('NoordNed'));assert(!JSON.stringify(b).includes('SECRET'));return{ok:true,json:async()=>({status:'completed',output:[{type:'web_search_call',status:'completed'},{content:[{type:'output_text',text:'NoordNed is een gevonden aanbieder.',annotations:[{type:'url_citation',url:'https://keukenrenovatienoordned.nl/'}]}]}]})};}});
 assert.equal(result.nameMentioned,true);assert.equal(result.domainCited,true);
});
test('lookalike domains do not count and absent company is not a claim about all AI apps',()=>{assert.deepEqual(measureMention('Andere aanbieders',['https://keukenrenovatienoordned.nl.example.com/'],'NoordNed','keukenrenovatienoordned.nl'),{nameMentioned:false,domainCited:false});});
test('no sources or failed web call cannot become a successful measurement',async()=>{await assert.rejects(checkVisibility({'visibility-service':'renovatie','visibility-region':'Friesland','visibility-brand':'Naam','visibility-domain':'https://example.com'},{env:{},fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[]})})}),/webzoektest/);});
