import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {registerWorkbookRoutes} from './workbook-routes.mjs';
const require=createRequire('file:///C:/Users/amcor/OneDrive/Bureaublad/RESQ/amcinova-samenvoeging/backend-actueel/package.json'),express=require('express');
test('CORS, JSON limits, admin preflight and disabled default: real HTTP',async()=>{
 const app=express();registerWorkbookRoutes(app,{json:express.json,env:{},hasAdminAccess:()=>false});app.use((_req,res)=>{res.set('Access-Control-Allow-Origin','*');res.status(404).end();});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{let r=await fetch(base+'/api/workbook/config');assert.equal((await r.json()).enabled,false);assert.equal(r.headers.get('cache-control'),'no-store');r=await fetch(base+'/api/admin/workbook');assert.equal(r.status,401);
 r=await fetch(base+'/api/workbook/config',{headers:{Origin:'https://evil.example'}});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
 r=await fetch(base+'/api/workbook/request',{method:'OPTIONS',headers:{Origin:'https://agents.amcinova.com'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://agents.amcinova.com');assert.equal(r.headers.get('access-control-allow-headers'),'Content-Type');
 r=await fetch(base+'/api/admin/workbook/id/follow-up',{method:'OPTIONS',headers:{Origin:'https://amcinova.com'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-headers'),'Content-Type, x-admin-key');assert.equal(r.headers.get('access-control-allow-methods'),'GET, PATCH, OPTIONS');
 r=await fetch(base+'/api/workbook/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(5000)})});assert.equal(r.status,413);assert.equal((await r.json()).error,'De aanvraag is te groot.');
 r=await fetch(base+'/api/workbook/request',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"email":"fixture@example.invalid"'});assert.equal(r.status,400);assert.equal((await r.text()).includes('fixture@example.invalid'),false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
