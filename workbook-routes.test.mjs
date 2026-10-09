import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {registerWorkbookRoutes,validateWorkbook} from './workbook-routes.mjs';
import {sixMonthsAfter,retentionView} from './workbook-retention.mjs';
import {createWorkbookMailAdapter} from './workbook-mail.mjs';
const require=createRequire(import.meta.url),express=require('express');
const valid={requestId:'0a2f65b9-4e20-4bb1-8de8-ecaf84c0dfc9',name:'',email:'fixture@example.invalid',proposal:false,help:''};
async function harness(overrides={}){
 const dir=mkdtempSync(path.join(tmpdir(),'amcinova-workbook-email-test-')),file=path.join(dir,'fixture.pdf');writeFileSync(file,'%PDF-1.4\nexplicit temporary fixture, not the workbook');
 let time=Date.parse('2026-10-09T00:00:00Z'),fail=false,failPatch=false,mailState='accepted',mails=0,calls=0,failRecord=false,sendHook=null;const rows=new Map(),sent=[];
 const env={WORKBOOK_ENABLED:'true',WORKBOOK_PRIVACY_VERSION:'test-privacy-v2',WORKBOOK_STORAGE_REVIEWED:'true',WORKBOOK_FILE:file,WORKBOOK_MAIL_FROM:'sender@example.invalid',WORKBOOK_PRIVACY_URL:'https://amcinova.com/privacy-test-only',SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake-test-key',...overrides.env};
 const transport={supportsIdempotency:true,send:async message=>{mails++;sent.push(message);if(sendHook)await sendHook();if(mailState==='throw')throw Error('secret fixture@example.invalid');if(mailState==='rejected')return{accepted:false,definitive:true};return{accepted:true,messageId:'mock-receipt-'+message.idempotencyKey};}};
 const app=express();registerWorkbookRoutes(app,{json:express.json,env,now:()=>time,hasAdminAccess:req=>!req.query?.key&&req.headers['x-admin-key']==='fixture-admin',mailTransport:overrides.noMail?undefined:transport,fetchImpl:async(url,options)=>{
  calls++;if(fail||failPatch&&options.method==='PATCH')throw Error('secret fixture@example.invalid');const query=new URL(url).searchParams,id=query.get('lead_id')?.slice(3);const body=options.body?JSON.parse(options.body):null;if(failRecord&&options.method==='PATCH'&&body.metadata.delivery.status!=='sending')throw Error('fixture write fail');
  if(options.method==='POST'){if(!rows.has(body.lead_id))rows.set(body.lead_id,structuredClone(body));return{ok:true,status:204};}
  if(options.method==='PATCH'){const row=rows.get(id);if(!row||row.metadata.revision!==query.get('metadata->>revision')?.slice(3))return{ok:true,status:200,json:async()=>[]};Object.assign(row,body);return{ok:true,status:200,json:async()=>[structuredClone(row)]};}
  const result=id?(rows.has(id)?[rows.get(id)]:[]):[...rows.values()].slice(Number(query.get('offset')||0),Number(query.get('offset')||0)+50);return{ok:true,status:200,json:async()=>structuredClone(result)};
 }});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 async function call(route='/api/workbook/request',body=valid,extra={}){const response=await fetch(base+route,{method:body?'POST':'GET',headers:{Origin:'https://agents.amcinova.com',...(body?{'Content-Type':'application/json'}:{}),...extra.headers},...(body?{body:JSON.stringify(body)}:{}),...extra});const data=await response.json().catch(()=>null);return{code:response.status,body:data,headers:response.headers};}
 return {call,rows,sent,base,file,get mails(){return mails;},get calls(){return calls;},set mailState(v){mailState=v;},set fail(v){fail=v;},set failPatch(v){failPatch=v;},set failRecord(v){failRecord=v;},set sendHook(v){sendHook=v;},advanceTo:v=>{time=Date.parse(v);},close:async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}};
}
test('email required, name optional, explicit proposal and optional help; no marketing',()=>{
 assert.equal(validateWorkbook(valid).name,'');assert.equal(validateWorkbook({...valid,proposal:true,help:''}).proposal,true);
 for(const v of [{...valid,email:''},{...valid,email:'bad'},{...valid,email:'x@example.invalid\r\nBcc:evil'},{...valid,name:'x'.repeat(121)},{...valid,proposal:'true'},{...valid,proposal:true,help:'x'.repeat(1001)},{...valid,marketing:true},{...valid,requestId:'bad'}])assert.throws(()=>validateWorkbook(v));
 assert.equal(validateWorkbook({...valid,help:'discard without proposal'}).help,'');
});
test('safe mail adapter stays unconfigured without approved transport/from; attachments immutable',async()=>{
 assert.equal(createWorkbookMailAdapter({from:'sender@example.invalid'}).ready,false);assert.equal(createWorkbookMailAdapter({from:'bad',transport:{supportsIdempotency:true,send(){}}}).ready,false);
 const h=await harness();try{const before=await import('node:fs/promises').then(fs=>fs.readFile(h.file));await h.call();assert.deepEqual(h.sent[0].attachments[0].content,before);assert.equal(h.sent[0].from,'sender@example.invalid');assert.equal(h.sent[0].to,valid.email);assert.equal(h.sent[0].idempotencyKey,'amcinova-workbook-v3-'+valid.requestId);}finally{await h.close();}
});
test('provider timeout is uncertain and emits no accepted claim',async()=>{const h=await harness();try{const mailer=createWorkbookMailAdapter({from:'sender@example.invalid',timeoutMs:5,transport:{supportsIdempotency:true,send:()=>new Promise(()=>{})}});const result=await mailer.send({to:valid.email,file:h.file,requestId:valid.requestId});assert.equal(result.accepted,false);assert.equal(result.state,'uncertain');}finally{await h.close();}});
test('concurrent duplicate saves one row, sends once and accepted retry does not resend',async()=>{
 const h=await harness();try{const results=await Promise.all([h.call(),h.call()]);assert.equal(h.rows.size,1);assert.equal(h.mails,1);assert.ok(results.some(r=>r.body.emailAccepted===true));const again=await h.call();assert.equal(again.body.emailAccepted,true);assert.equal(h.mails,1);assert.equal(again.body.downloadPath,undefined);assert.equal(JSON.stringify(again.body).includes(valid.email),false);assert.equal((await h.call('/api/workbook/request',{...valid,name:'Changed'})).code,409);}finally{await h.close();}
});
test('missing provider yields saved but not accepted; config hides unavailable form',async()=>{
 const h=await harness({noMail:true});try{assert.equal((await h.call('/api/workbook/config',null)).body.enabled,false);const r=await h.call();assert.equal(r.code,202);assert.equal(r.body.saved,true);assert.equal(r.body.emailAccepted,false);assert.equal(r.body.deliveryStatus,'unconfigured');assert.equal(h.mails,0);}finally{await h.close();}
});
test('definite rejection can retry; ambiguous provider failure never auto-resends',async()=>{
 const h=await harness();try{h.mailState='rejected';let r=await h.call();assert.equal(r.body.saved,true);assert.equal(r.body.emailAccepted,false);assert.equal(r.body.deliveryStatus,'rejected');h.mailState='accepted';r=await h.call();assert.equal(r.body.emailAccepted,true);assert.equal(h.mails,2);
 const other={...valid,requestId:randomUUID()};h.mailState='throw';r=await h.call('/api/workbook/request',other);assert.equal(r.body.deliveryStatus,'uncertain');const count=h.mails;h.mailState='accepted';r=await h.call('/api/workbook/request',other);assert.equal(r.body.emailAccepted,false);assert.equal(h.mails,count);}finally{await h.close();}
});
test('storage failure never sends; post-save state failure is reported without simulated success',async()=>{
 const h=await harness();try{h.fail=true;const r=await h.call();assert.equal(r.code,503);assert.equal(r.body.saved,undefined);assert.equal(h.mails,0);assert.equal(JSON.stringify(r.body).includes(valid.email),false);h.fail=false;h.failPatch=true;const partial=await h.call();assert.equal(partial.body.saved,true);assert.equal(partial.body.emailAccepted,false);assert.equal(h.mails,0);}finally{await h.close();}
});
test('accepted receipt with failed status recording is distinguished; stale send is never resent',async()=>{
 const h=await harness();try{h.failRecord=true;const r=await h.call();assert.equal(r.body.saved,true);assert.equal(r.body.emailAccepted,true);assert.equal(r.body.acceptanceRecorded,false);assert.equal(h.mails,1);h.failRecord=false;h.advanceTo('2026-10-09T00:02:00Z');const retry=await h.call();assert.equal(retry.body.deliveryStatus,'uncertain');assert.equal(retry.body.emailAccepted,false);assert.equal(h.mails,1);}finally{await h.close();}
});
test('concurrent authorized follow-up is preserved when delivery status completes',async()=>{
 const h=await harness();try{h.sendHook=async()=>{const headers={'x-admin-key':'fixture-admin','Content-Type':'application/json',Origin:'https://amcinova.com'},list=await h.call('/api/admin/workbook',null,{headers}),item=list.body.requests[0];const changed=await h.call('/api/admin/workbook/'+item.id+'/follow-up',{status:'active',note:'Vervolg daadwerkelijk afgesproken',revision:item.revision},{method:'PATCH',headers});assert.equal(changed.code,200);};const r=await h.call();assert.equal(r.body.emailAccepted,true);const meta=h.rows.get(valid.requestId).metadata;assert.equal(meta.followUpStatus,'active');assert.equal(meta.followUpNote,'Vervolg daadwerkelijk afgesproken');assert.equal(meta.delivery.status,'accepted');}finally{await h.close();}
});
test('missing privacy/PDF/review prevents collection',async()=>{
 for(const env of [{WORKBOOK_FILE:''},{WORKBOOK_PRIVACY_VERSION:''},{WORKBOOK_PRIVACY_URL:''},{WORKBOOK_STORAGE_REVIEWED:'false'},{WORKBOOK_ENABLED:'false'}]){const h=await harness({env});try{assert.equal((await h.call()).code,503);assert.equal(h.calls,0);assert.equal(h.mails,0);}finally{await h.close();}}
});
test('six calendar months clamp end-of-month and proposal opt-in gives no exception',()=>{
 assert.equal(sixMonthsAfter('2026-08-31T12:00:00Z'),'2027-02-28T12:00:00.000Z');assert.equal(sixMonthsAfter('2027-08-31T12:00:00Z'),'2028-02-29T12:00:00.000Z');
 const row={created_at:'2026-10-09T00:00:00Z',metadata:{proposalRequested:true}};assert.equal(retentionView(row,Date.parse('2027-04-09T00:00:00Z')).eligible,true);
});
test('admin status changes require authorization, revision and evidence; do not delete or extend original clock',async()=>{
 const h=await harness();try{await h.call('/api/workbook/request',{...valid,proposal:true,help:'Website hulp'});assert.equal((await h.call('/api/admin/workbook',null)).code,401);const headers={'x-admin-key':'fixture-admin','Content-Type':'application/json',Origin:'https://amcinova.com'};
 let list=await h.call('/api/admin/workbook',null,{headers});let item=list.body.requests[0];assert.equal(item.retention.followUpStatus,'none');assert.equal(item.retention.eligibleAt,'2027-04-09T00:00:00.000Z');assert.equal(list.body.deletionEnabled,false);
 const patch=(body,custom=headers)=>h.call('/api/admin/workbook/'+item.id+'/follow-up',body,{method:'PATCH',headers:custom});
 assert.equal((await patch({status:'active',note:'',revision:item.revision})).code,400);assert.equal((await patch({status:'active',note:'Actual contact',revision:item.revision},{'Content-Type':'application/json'})).code,401);
 h.advanceTo('2027-03-09T00:00:00Z');let r=await patch({status:'active',note:'Vervolg afgesproken',revision:item.revision});assert.equal(r.code,200);assert.equal(r.body.retention.followUpStartedAt,'2027-03-09T00:00:00.000Z');assert.equal(r.body.retention.followUpReviewAt,'2027-09-09T00:00:00.000Z');assert.equal(r.body.retention.eligibleAt,'2027-04-09T00:00:00.000Z');assert.equal((await patch({status:'none',revision:item.revision})).code,409);
 h.advanceTo('2027-10-09T00:00:00Z');list=await h.call('/api/admin/workbook',null,{headers});item=list.body.requests[0];assert.equal(item.retention.reviewOverdue,true);assert.equal(item.retention.eligible,false);r=await patch({status:'none',revision:item.revision});assert.equal(r.body.retention.eligible,true);assert.equal(h.rows.size,1);assert.equal(h.rows.get(item.id).metadata.proposalRequested,true);assert.equal(h.rows.get(item.id).metadata.delivery.status,'accepted');
 const denied=await fetch(h.base+'/api/admin/workbook/'+item.id,{method:'DELETE',headers});assert.equal(denied.status,404);assert.equal(h.rows.size,1);
 }finally{await h.close();}
});
test('privacy version and consent persist; no public read/admin elevation; rate limit',async()=>{
 const h=await harness();try{await h.call();const row=h.rows.get(valid.requestId);assert.equal(row.metadata.privacyVersion,'test-privacy-v2');assert.equal(row.metadata.marketingConsent,false);assert.equal(row.metadata.consentVersion,'workbook-email-v1');assert.equal(row.metadata.retentionStartsAt,row.created_at);
 assert.equal((await h.call('/api/admin/workbook?key=fixture-admin',null)).code,401);const response=await fetch(h.base+'/api/workbook/'+valid.requestId);assert.equal(response.status,404);let latest;for(let i=0;i<20;i++)latest=await h.call();assert.equal(latest.code,429);assert.equal(h.mails,1);
 }finally{await h.close();}
});
test('untrusted public metadata cannot grant follow-up exemption or postpone retention',async()=>{
 const h=await harness();try{await h.call();const row=h.rows.get(valid.requestId);row.metadata.followUpStatus='active';row.metadata.followUpStartedAt='2099-01-01T00:00:00Z';row.metadata.retentionStartsAt='2099-01-01T00:00:00Z';h.advanceTo('2027-04-10T00:00:00Z');const list=await h.call('/api/admin/workbook',null,{headers:{'x-admin-key':'fixture-admin'}});const retention=list.body.requests[0].retention;assert.equal(retention.followUpStatus,'none');assert.equal(retention.startsAt,'2026-10-09T00:00:00.000Z');assert.equal(retention.needsVerification,true);assert.equal(retention.eligible,false);
 row.metadata.originProof='invalid';const r=await h.call();assert.equal(r.code,503);assert.equal(h.mails,1);const invalid=await h.call('/api/admin/workbook',null,{headers:{'x-admin-key':'fixture-admin'}});assert.equal(invalid.body.requests[0].revision,null);assert.equal(invalid.body.requests[0].retention.needsVerification,true);
 }finally{await h.close();}
});
export {harness,valid};

