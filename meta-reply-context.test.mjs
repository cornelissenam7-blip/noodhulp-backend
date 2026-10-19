import test from 'node:test';
import assert from 'node:assert/strict';
import {saveReplyContext} from './meta-reply-context.mjs';
import {tokenBox} from './meta-customer.mjs';
const now=Date.now(),env={AMCINOVA_META_REPLY_ENABLED:'true',AMCINOVA_META_TOKEN_KEY:'12'.repeat(32)};
const receipt={tenantId:'11111111-1111-4111-8111-111111111111',platform:'facebook',accountId:'987',messageId:'opaque+/mid==',senderId:'555',messageText:'Private testvraag',receivedAt:new Date(now-1000).toISOString()};
test('verified receipt produces encrypted, expiring context and duplicate-safe key',async()=>{
 const calls=[];const db=async(t,o)=>{calls.push([t,o]);return [];};
 await saveReplyContext(db,env,receipt,now);await saveReplyContext(db,env,receipt,now);
 assert.equal(calls[0][0],'amcinova_meta_reply_contexts');const body=calls[0][1].body;
 assert.equal(body.reply_key,calls[1][1].body.reply_key);assert.equal(Date.parse(body.expires_at)-Date.parse(body.message_at),86400000);
 assert.ok(!JSON.stringify(body).includes('Private testvraag'));assert.ok(!JSON.stringify(body).includes('555'));
 const box=tokenBox(env.AMCINOVA_META_TOKEN_KEY),owner=receipt.tenantId+':987:'+body.reply_key;
 assert.deepEqual(JSON.parse(box.open(body.context_cipher,owner)),{recipient:'555',text:'Private testvraag'});
 assert.throws(()=>box.open(body.context_cipher,'other-owner'));
});
test('disabled, Instagram, old and future events never persist reply targets',async()=>{
 const db=async()=>{throw Error('must not write');};
 await saveReplyContext(db,{},receipt,now);
 for(const change of [{platform:'instagram'},{receivedAt:new Date(now-86400000).toISOString()},{receivedAt:new Date(now+1).toISOString()}])await saveReplyContext(db,env,{...receipt,...change},now);
});
test('context persistence failure propagates so Meta can retry webhook delivery',async()=>{
 await assert.rejects(saveReplyContext(async()=>null,env,receipt,now));
});
