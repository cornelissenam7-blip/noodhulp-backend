import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createWorkbookRelayTransport} from './workbook-relay.mjs';
const env={WORKBOOK_RELAY_URL:'https://amcinova.com/workbook-relay.php',WORKBOOK_RELAY_SECRET:'x'.repeat(32),WORKBOOK_MAIL_FROM:'info@amcinova.com'};
const id='12345678-1234-4123-8123-123456789abc';
test('relay rejects unapproved destination and missing key',()=>{
 for(const patch of [{WORKBOOK_RELAY_URL:'https://other.invalid'},{WORKBOOK_RELAY_SECRET:''},{WORKBOOK_RELAY_SECRET:'x'.repeat(31)},{WORKBOOK_MAIL_FROM:'other@example.invalid'}])assert.equal(createWorkbookRelayTransport({env:{...env,...patch}}),undefined);
});
test('relay signs exact payload, forbids redirects and checks matching receipt',async()=>{
 const transport=createWorkbookRelayTransport({env,now:()=>100000,fetchImpl:async(url,options)=>{
  assert.equal(url,env.WORKBOOK_RELAY_URL);assert.equal(options.redirect,'error');
  assert.equal(options.headers['X-Amcinova-Signature'],createHmac('sha256',env.WORKBOOK_RELAY_SECRET).update('100\n'+options.body).digest('hex'));
  assert.deepEqual(JSON.parse(options.body),{id,to:'info@amcinova.com'});
  return {ok:true,text:async()=>JSON.stringify({accepted:true,messageId:'workbook-'+id})};
 }});
 assert.equal((await transport.send({to:'info@amcinova.com',idempotencyKey:'amcinova-workbook-v3-'+id})).accepted,true);
});
test('lost response and inconsistent receipt stay uncertain',async()=>{
 for(const fetchImpl of [async()=>{throw Error('timeout');},async()=>({ok:true,text:async()=>'{"accepted":true,"messageId":"wrong"}'})]){
  const result=await createWorkbookRelayTransport({env,fetchImpl}).send({to:'info@amcinova.com',idempotencyKey:'amcinova-workbook-v3-'+id});assert.equal(result.accepted,false);assert.notEqual(result.definitive,true);
 }
});
