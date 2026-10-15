import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {registerTrackingCustomer,trackingConfig,signTracking,trackingEvent,trackingReport,readTracking} from './tracking-links.mjs';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',env={SUPABASE_SERVICE_ROLE_KEY:'local-test-only'};
test('Dot/Facebook and Soro/blog are signed with the owner; test receipts stay separate',()=>{
 const c={...trackingConfig({product:'admaker',url:'https://example.com/contact',creator:'dot',source:'facebook',medium:'social',campaign:'fronts',ad:'post-1'}),id:other},token=signTracking(c,owner,env);
 assert.equal(readTracking(token,env).creator,'dot');
 const event=(type,reference,isTest,n)=>trackingEvent({token,eventId:`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`,type,reference,test:isTest,page:c.url},env,'https://example.com');
 const report=trackingReport([{payload:{tracking:c}}],[event('visit',undefined,true,1),event('lead','receipt-test-1',true,2),event('lead','receipt-test-1',true,3),event('lead','receipt-real-1',false,4)]);
 assert.equal(report[0].creator,'dot');assert.equal(report[0].testVisits,1);assert.equal(report[0].testLeads,1);assert.equal(report[0].visits,0);assert.equal(report[0].leads,1);assert.ok(report[0].lastReceivedAt);
 const blog={...trackingConfig({...c,creator:'soro',source:'blog',medium:'article'}),id:other};assert.equal(readTracking(signTracking(blog,owner,env),env).creator,'soro');
});
test('two customer accounts cannot list or change one another\u2019s links; product entitlement is required',async()=>{
 const app=express(),docs=[];let eventQueries=[];registerTrackingCustomer(app,{json:express.json,env,adminAccess:()=>false,
 identity:async req=>{const id=req.headers.authorization?.slice(7);if(![owner,other].includes(id))throw Object.assign(Error('login'),{status:401});return{id};},
 requireProduct:async(u,p)=>{if(u.id===other||!['admaker','promotie'].includes(p))throw Object.assign(Error('product'),{status:403});},
 db:async(u,table,q,body)=>{if(body){assert.equal(body.user_id,u.id);docs.push(body);return[body];}assert.ok(q.includes('user_id=eq.'+u.id));return docs.filter(d=>d.user_id===u.id&&(!q.includes('product_code=eq.')||q.includes('product_code=eq.'+d.product_code))&&(!q.includes('project_id=eq.')||q.includes('project_id=eq.'+d.project_id)));},
 adminDb:async(table,options)=>{eventQueries.push(options.query);return[];},
 wrap:fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.message});}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const headers=id=>({Authorization:'Bearer '+id,'Content-Type':'application/json'});
 try{
  const created=await fetch(base+'/api/customer/tracking-links',{method:'POST',headers:headers(owner),body:JSON.stringify({product:'admaker',url:'https://example.com',creator:'dot',source:'instagram',medium:'social',campaign:'autumn',ad:'post-1',user_id:other})});assert.equal(created.status,200);const link=(await created.json()).link;assert.equal(docs[0].user_id,owner);
  assert.equal((await fetch(base+'/api/customer/tracking-links?product=admaker',{headers:headers(owner)})).status,200);assert.ok(eventQueries[0].includes('owner=eq.'+owner));
  assert.equal((await fetch(base+'/api/customer/tracking-links?product=admaker',{headers:headers(other)})).status,403);
  const otherList=await(await fetch(base+'/api/customer/tracking-links',{headers:headers(other)})).json();assert.equal(otherList.links.length,0);assert.ok(eventQueries[1].includes('owner=eq.'+other));
  assert.equal((await fetch(base+'/api/customer/tracking-links/'+link.id+'/cost',{method:'POST',headers:headers(other),body:JSON.stringify({costCents:100})})).status,404);
  assert.equal((await fetch(base+'/api/customer/tracking-links?product=sitebuilder',{headers:headers(owner)})).status,400);
  const promotion=await(await fetch(base+'/api/customer/tracking-links?product=promotie',{headers:headers(owner)})).json();assert.equal(promotion.links.length,0);
 }finally{await new Promise(r=>server.close(r));}
});
