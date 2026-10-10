import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creditClient} from './ai-credits.mjs';
const env={CUSTOMER_AI_CREDITS_ENABLED:'true',SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-only'};
test('disabled rollout never permits unmetered generation',async()=>{const c=creditClient({env:{},fetchImpl:()=>{throw Error('unexpected');}});await assert.rejects(c.run('a','sitebuilder','id',()=>assert.fail('unmetered provider call')),{status:503});await c.refund('id');});
test('missing service credential fails closed',async()=>{await assert.rejects(creditClient({env:{...env,SUPABASE_SERVICE_ROLE_KEY:''}}).reserve('a','sitebuilder','id'),{status:503});});
test('empty credit returns payment-required without generation',async()=>{await assert.rejects(creditClient({env,fetchImpl:async()=>({ok:true,json:async()=>false})}).reserve('a','sitebuilder','id'),{status:402});});
test('reservation and refund use only verified server arguments',async()=>{const calls=[];const c=creditClient({env,fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>true};}});await c.reserve('owner','offertetool','request');await c.refund('request');assert.deepEqual(calls.map(c=>c.body),[{p_user:'owner',p_product:'offertetool',p_request:'request'},{p_request:'request'}]);});
test('database rejection is not treated as unlimited balance',async()=>{await assert.rejects(creditClient({env,fetchImpl:async()=>({ok:false})}).reserve('a','sitebuilder','id'),{status:503});});

test('malformed database balance never authorizes generation',async()=>{
 for(const value of [null,{},[],1,'true','false']){
  await assert.rejects(creditClient({env,fetchImpl:async()=>({ok:true,json:async()=>value})}).reserve('a','sitebuilder','id'),{status:503});
 }
});
test('successful generation consumes reservation without refund',async()=>{
 const calls=[];const c=creditClient({env,fetchImpl:async url=>{calls.push(url.split('/').at(-1));return{ok:true,json:async()=>true};}});
 assert.equal(await c.run('owner','sitebuilder','id',async()=>42),42);
 assert.deepEqual(calls,['amcinova_credit_reserve','amcinova_credit_complete']);
});
test('provider failure returns reserved unit and preserves original error',async()=>{
 const calls=[],failure=Error('provider unavailable');const c=creditClient({env,fetchImpl:async url=>{calls.push(url.split('/').at(-1));return{ok:true,json:async()=>true};}});
 await assert.rejects(c.run('owner','sitebuilder','id',async()=>{throw failure;}),e=>e===failure);
 assert.deepEqual(calls,['amcinova_credit_reserve','amcinova_credit_refund']);
});
test('uncertain reservation is refunded without calling provider',async()=>{
 const calls=[];const c=creditClient({env,fetchImpl:async url=>{calls.push(url.split('/').at(-1));if(calls.length===1)throw Error('connection lost after commit');return{ok:true,json:async()=>true};}});
 await assert.rejects(c.run('owner','sitebuilder','id',()=>assert.fail('provider started')));
 assert.deepEqual(calls,['amcinova_credit_reserve','amcinova_credit_refund']);
});
test('no balance does not generate or refund nonexistent reservation',async()=>{
 let count=0;const c=creditClient({env,fetchImpl:async()=>{count++;return{ok:true,json:async()=>false};}});
 await assert.rejects(c.run('owner','sitebuilder','id',()=>assert.fail('provider started')),{status:402});assert.equal(count,1);
});
