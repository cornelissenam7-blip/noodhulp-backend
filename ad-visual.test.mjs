import test from 'node:test';import assert from 'node:assert/strict';
import {createAdVisual,adVisualInput} from './ad-visual.mjs';
import {customerAIScope} from './customer-ai-scope.mjs';
const brief={company:'KRNN',offer:'Keukenfronten vervangen',headline:'Nieuwe fronten',scene:'Een stijlvolle keuken met eiken fronten'};
test('visuals require AdMaker access regardless of client product labels',()=>{assert.deepEqual(customerAIScope('admaker-visual',{product:'sitebuilder',user_id:'other'}),{product:'admaker',kind:'visual'});});
test('missing subject, huge input and unavailable key cannot start generation',async()=>{
 assert.throws(()=>adVisualInput({...brief,scene:''}),{status:400});assert.throws(()=>adVisualInput({...brief,scene:'x'.repeat(2001)}),{status:400});await assert.rejects(createAdVisual(brief,{env:{}}),{status:503});
});
test('one bounded relevant image excludes private fields, invented copy and logos',async()=>{
 const result=await createAdVisual({...brief,email:'PRIVATE',customer:'PRIVATE'},{env:{OPENAI_API_KEY:'test'},fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/images/generations');const body=JSON.parse(options.body);assert.equal(body.n,1);assert.equal(body.quality,'medium');assert.equal(body.output_format,'jpeg');assert.equal(body.size,'1024x1024');assert.match(body.prompt,/Keukenfronten/);assert.match(body.prompt,/No text, logos/);assert.ok(!body.prompt.includes('PRIVATE'));return {ok:true,json:async()=>({data:[{b64_json:Buffer.from([255,216,255,0]).toString('base64')}]})};}});
 assert.match(result.image,/^data:image\/jpeg;base64,/);assert.equal(result.illustration,true);
});
test('provider failures and non-image output fail without a fabricated image',async()=>{
 await assert.rejects(createAdVisual(brief,{env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>({ok:false})}),{status:503});
 await assert.rejects(createAdVisual(brief,{env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>({ok:true,json:async()=>({data:[{b64_json:Buffer.from('not image').toString('base64')}]})})}),{status:502});
});
