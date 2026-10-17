import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeQuote,checkAIInput,checkAIProposal} from './quote-ai.mjs';
const body={description:'7 fronten en afzuigkap en inductiekookplaat plus werkblad',kind:'Keukenrenovatie',catalog:[{id:'front',name:'Fronten',unit:'m2',price:350},{id:'item-0',name:'Apparatuur',unit:'stuk',price:500}],existingLines:[{catalogId:'front',quantity:2,heightMm:600,widthMm:500,detail:'wit'}]};
const line={sourceId:'existing-0',catalogId:'front',quantity:7,heightMm:600,widthMm:500,detail:'wit'};
const raw=lines=>({summary:'Keuken aanpassen',questions:[],lines});
const reply=proposal=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(proposal)}]}]})});
test('request constrains references and corrects a wrong link once',async()=>{
 const sent=[]; const result=await proposeQuote(body,{env:{OPENAI_API_KEY:'fake'},fetchImpl:async(u,o)=>{const p=JSON.parse(o.body);sent.push(p);return reply(raw([{...line,sourceId:sent.length===1?'front':'existing-0'}]));}});
 assert.equal(sent.length,2); assert.deepEqual(sent[0].text.format.schema.properties.lines.items.properties.sourceId.enum,[null,'existing-0']);
 assert.deepEqual(sent[0].text.format.schema.properties.lines.items.properties.catalogId.enum,['front','item-0']);
 assert.match(sent[1].instructions,/Herstel de verwijzingen/); assert.equal(result.lines[0].quantity,7); assert.equal(result.lines.length,1);
});
test('repeated invalid links give a blocking question and preserve original values',async()=>{
 let calls=0; const result=await proposeQuote(body,{env:{OPENAI_API_KEY:'fake'},fetchImpl:async()=>{calls++;return reply(raw([{...line,sourceId:'item-0'}]));}});
 assert.equal(calls,2);assert.equal(result.lines.length,1);assert.equal(result.lines[0].quantity,2);assert.equal(result.lines[0].heightMm,600);assert.match(result.questions[0],/behouden/);
});
test('duplicate or wrong-category references are still rejected by validation',()=>{
 const input=checkAIInput(body);
 for(const lines of [[line,line],[{...line,catalogId:'item-0'}]]) assert.throws(()=>checkAIProposal(raw(lines),input),e=>e.code==='QUOTE_ROW_LINK');
});
test('ordinary API failures do not get retried',async()=>{
 let calls=0;await assert.rejects(proposeQuote(body,{env:{OPENAI_API_KEY:'fake'},fetchImpl:async()=>{calls++;return {ok:false};}}),/geen voorstel/);assert.equal(calls,1);
});
test('new appliances stay new and existing fronts remain',async()=>{
 const result=await proposeQuote(body,{env:{OPENAI_API_KEY:'fake'},fetchImpl:async()=>reply(raw([{sourceId:null,catalogId:'item-0',quantity:1,heightMm:null,widthMm:null,detail:'Afzuigkap'}]))});
 assert.equal(result.lines.length,2);assert.equal(result.lines.find(l=>l.catalogId==='front').quantity,2);
});
test('user case cannot silently omit appliances or default a worktop to one metre',()=>{
 const data=checkAIInput({...body,catalog:[...body.catalog,{id:'item-1',name:'Werkblad',unit:'m',price:300}]});
 const p=checkAIProposal(raw([{...line,quantity:2},{sourceId:null,catalogId:'item-1',quantity:1,heightMm:null,widthMm:null,detail:''}]),data);
 assert.ok(p.questions.some(q=>q.includes('7 fronten')));
 assert.ok(p.questions.some(q=>q.includes('afzuigkap')));
 assert.ok(p.questions.some(q=>q.includes('kookplaat')));
 assert.ok(p.questions.some(q=>q.includes('lengte in meters')));
 assert.equal(p.lines.find(l=>l.catalogId==='item-1').quantity,null);
});
test('explicit measured work remains usable',()=>{
 const data=checkAIInput({...body,description:'Werkblad van 2,5 meter',existingLines:[],catalog:[{id:'item-1',name:'Werkblad',unit:'m',price:300}]});
 const p=checkAIProposal(raw([{sourceId:null,catalogId:'item-1',quantity:2.5,heightMm:null,widthMm:null,detail:''}]),data);
 assert.equal(p.lines[0].quantity,2.5);assert.deepEqual(p.questions,[]);
});
