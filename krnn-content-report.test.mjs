import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {registerKrnnContentReport} from './krnn-content-report.mjs';
test('content summary requires existing admin access and never exposes the website key or contact fields',async()=>{
 const app=express();let reads=0;registerKrnnContentReport(app,{adminAccess:req=>req.headers['x-admin-key']==='local-admin',env:{KNN_LEADS_READ_KEY:'Bearer local-site-key'},fetchImpl:async(url,options)=>{
  reads++;assert.equal(url,'https://keukenrenovatienoordned.nl/leads-api.php?view=content');assert.equal(options.headers['X-KNN-Key'],'Bearer local-site-key');assert.equal(options.redirect,'error');
  return{ok:true,json:async()=>({leads:[{contact:{email:'private@example.com'}}],contentReport:{rows:[{source:'dot',id:'fb-post-1',channel:'facebook',views:4,testViews:1,leads:1,quotes:0,orders:0,contact:'never expose'}]}})};
 }});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/admin/krnn-content-report';
 try{assert.equal((await fetch(base)).status,401);assert.equal(reads,0);assert.equal((await fetch(base+'?key=local-admin',{headers:{'x-admin-key':'local-admin'}})).status,401);assert.equal(reads,0);
  const r=await fetch(base,{headers:{'x-admin-key':'local-admin'}});assert.equal(r.status,200);const text=await r.text();assert.ok(!text.includes('contact'));assert.ok(!text.includes('local-site-key'));assert.ok(!text.includes('private@example.com'));assert.equal(JSON.parse(text).rows[0].leads,1);
 }finally{await new Promise(r=>server.close(r));}
});
test('unconfigured bridge returns an explicit unavailable state instead of zero results',async()=>{
 const app=express();registerKrnnContentReport(app,{adminAccess:()=>true,env:{},fetchImpl:()=>{throw Error('must not fetch');}});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/krnn-content-report');assert.equal(r.status,503);assert.ok(!(await r.json()).rows);}finally{await new Promise(r=>server.close(r));}
});
