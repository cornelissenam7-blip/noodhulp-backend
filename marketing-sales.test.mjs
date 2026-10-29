import test from 'node:test';
import assert from 'node:assert/strict';
import {signTracking} from './tracking-links.mjs';
import {salesSignature,verifySale,salesReport} from './marketing-sales.mjs';
const owner='12345678-1234-1234-1234-123456789012',env={AMCINOVA_TRACKING_SECRET:'unit-tracking'},shops={shop:{owner,origin:'https://shop.example.com',secret:'unit-shop'}},now=1800000000000;
const token=signTracking({id:owner,url:shops.shop.origin,source:'youtube',medium:'organic',campaign:'book',ad:'a'},owner,env);
function event(patch={},options={}){const raw=JSON.stringify({orderId:'76',revision:1,paidCents:1085,refundedCents:0,currency:'EUR',test:false,token,consent:true,...patch}),stamp=String(now/1000);return verifySale(raw,{'x-amcinova-shop':'shop','x-amcinova-timestamp':stamp,'x-amcinova-signature':salesSignature(raw,stamp,shops.shop.secret)},{shops,env,now,...options});}
test('paid webhook has owner binding and no raw order identifier',()=>{const e=event();assert.equal(e.owner,owner);assert.equal(e.paidCents,1085);assert.equal('orderId' in e,false);assert.equal(e.id,event().id);});
test('refund snapshots deduplicate and out of order cannot inflate revenue',()=>{const paid=event(),partial=event({revision:501,refundedCents:500}),full=event({revision:1086,refundedCents:1085});assert.deepEqual(salesReport([full,partial,paid,full]),{orders:1,grossCents:1085,refundCents:1085,netCents:0,testOrders:0});});
test('test orders never enter sales totals',()=>{assert.equal(salesReport([event({test:true})]).netCents,0);});
test('stale delivery denied, fresh signed retry keeps same dedup id',()=>{assert.throws(()=>event({}, {now:now+301000}),/Ongeldige/);assert.equal(event().id,event().id);});
test('unknown PII, missing consent and excessive refunds rejected',()=>{for(const patch of [{email:'private@example.com'},{consent:false},{refundedCents:2000}])assert.throws(()=>event(patch));});
test('different shop origin or owner cannot claim a campaign',()=>{assert.throws(()=>event({}, {shops:{shop:{...shops.shop,origin:'https://other.example.com'}}}),/Campagne/);assert.throws(()=>event({}, {shops:{shop:{...shops.shop,owner:'22345678-1234-1234-1234-123456789012'}}}),/Campagne/);});
test('modified amount without merchant signature is denied',()=>{const raw=JSON.stringify({orderId:'76'}),stamp=String(now/1000);assert.throws(()=>verifySale(raw,{'x-amcinova-shop':'shop','x-amcinova-timestamp':stamp,'x-amcinova-signature':'0'.repeat(64)},{shops,env,now}),/Ongeldige/);});

import {campaignSalesStore,saleEventUUID} from './marketing-sales.mjs';
test('adapter refuses an unverified table schema',()=>{assert.throws(()=>campaignSalesStore(()=>{}),/databaseschema/);});
test('existing events table adapter uses UUID, owner filter, durable duplicates and conflict rejection',async()=>{
 const rows=new Map(),calls=[];
 const db=async(table,request)=>{assert.equal(table,'amcinova_campaign_events');calls.push(request);if(request.method==='POST'){if(rows.has(request.body.event_id))throw Error('409 duplicate');rows.set(request.body.event_id,request.body);return [];}if(request.query.includes('event_id=eq.'))return [rows.get(request.query.split('event_id=eq.')[1].split('&')[0])];assert.match(request.query,new RegExp('owner=eq.'+owner));return [...rows.values()];};
 const store=campaignSalesStore(db,{verifiedSchema:true,eventType:'sale_snapshot'}),paid=event(),partial=event({revision:501,refundedCents:500}),full=event({revision:1086,refundedCents:1085});
 assert.match(saleEventUUID(paid),/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 await store.putUnique(full);await store.putUnique(paid);await store.putUnique(partial);assert.equal(await store.putUnique({...paid,receivedAt:'2026-01-01T00:00:00Z'}),false);
 await assert.rejects(()=>store.putUnique({...paid,paidCents:999}),/tegenstrijdige/);
 assert.equal(salesReport(await store.list(owner)).netCents,0);
 assert.equal(calls[0].body.metadata.tracking,undefined);
});
import {customerDocumentsSalesStore,salesByCampaign} from './marketing-sales.mjs';
test('customer document adapter exact duplicate and conflict, owner filtering and separate test revenue',async()=>{
 const rows=new Map();const db=async(table,r)=>{assert.equal(table,'amcinova_customer_documents');if(r.method==='POST'){if(rows.has(r.body.id))throw Error('409');rows.set(r.body.id,r.body);return [];}assert.match(r.query,new RegExp('user_id=eq.'+owner));return [...rows.values()].filter(row=>!r.query.includes('&id=eq.')||r.query.includes('&id=eq.'+row.id));};
 const s=customerDocumentsSalesStore(db,{proofSecret:"server-secret-not-shop-secret"}),paid=event();await s.putUnique(paid);assert.equal(await s.putUnique({...paid,receivedAt:'later'}),false);await assert.rejects(()=>s.putUnique({...paid,paidCents:100}),/tegenstrijdige/);const list=await s.list(owner);assert.equal(list.length,1);assert.equal(list.limited,false);const campaign=salesByCampaign([event({test:true})])[0];assert.equal(campaign.netCents,0);assert.equal(campaign.testNetCents,1085);
});
test('untrusted customer document saleEvent never counts as verified revenue',async()=>{
 const forged=event(),store=customerDocumentsSalesStore(async()=>[{payload:{saleEvent:forged,salesPayloadProof:'0'.repeat(64)}}],{proofSecret:'server-secret-not-shop-secret'});
 assert.equal((await store.list(owner)).length,0);
 const unsigned=customerDocumentsSalesStore(async()=>[{payload:{saleEvent:forged}}],{proofSecret:'server-secret-not-shop-secret'});assert.equal((await unsigned.list(owner)).length,0);
});


test('foreign-key database conflict is not misreported as duplicate sale',async()=>{
 let reads=0;const store=customerDocumentsSalesStore(async(_t,r)=>{if(r.method==='GET'){reads++;return [];}throw Error('Supabase POST failed: 409 {"code":"23503","message":"redacted","details":"Key (user_id)=(private) is not present"}');},{proofSecret:'server-secret-not-shop-secret'});
 await assert.rejects(()=>store.putUnique(event()),e=>e.status===503&&/23503, veld user_id/.test(e.message)&&!e.message.includes("private"));assert.equal(reads,0);
});
test('missing conflicting row is an unavailable store, not a contradictory order',async()=>{
 const store=customerDocumentsSalesStore(async(_t,r)=>{if(r.method==='GET')return [];throw Error('409 duplicate');},{proofSecret:'server-secret-not-shop-secret'});await assert.rejects(()=>store.putUnique(event()),e=>e.status===503&&/zonder bestaande/.test(e.message));
});
