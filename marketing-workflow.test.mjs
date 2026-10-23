import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {newWorkflow,workflowFromWebsite,workflowInput,confirmWorkflow,startWorkflowStep,finishWorkflowStep,approveWorkflowStep,workflowReadiness,workflowSigner,workflowSteps} from './marketing-workflow.mjs';
import {registerMarketingWorkflow} from './marketing-workflow-routes.mjs';
const brief={company:'Amcinova',offer:'Software voor zelfstandigen',goal:'Aanvragen via chat',facts:'Geen telefoonteam',website:'https://amcinova.com',channels:['YouTube'],language:'nl',currency:'EUR'};
const make=()=>newWorkflow({name:'Amcinova praktijkproef',brief});
test('only a confirmed shared brief can drive agents; HTTPS links without credentials',()=>{
 assert.throws(()=>workflowInput(make(),'campaign'),/Bevestig/);
 for(const website of ['http://amcinova.com','https://user:secret@amcinova.com','javascript:alert(1)'])assert.throws(()=>newWorkflow({brief:{...brief,website}}));
 assert.throws(()=>newWorkflow({brief:{...brief,channels:['unknown']}}));
});
test('complete content chain retains company facts, order and source approval without public actions',()=>{
 let p=confirmWorkflow(make());const inputs=[];
 for(const step of workflowSteps){
  const input=workflowInput(p,step);inputs.push(input);const id=randomUUID();p=startWorkflowStep(p,step,id);
  assert.throws(()=>workflowInput(p,step),/bezig/);
  p=finishWorkflowStep(p,step,id,{summary:'Approved strategy '+step,sections:[],ads:[],posts:[]});
  if(step!=='sitebuilder')assert.throws(()=>workflowInput(p,workflowSteps[workflowSteps.indexOf(step)+1]),/voorgaande/);
  p=approveWorkflowStep(p,step);
 }
 assert.match(inputs[1].fields['agent-instructions'],/Approved strategy campaign/);
 assert.equal(inputs[1].fields['ad-channel'],'YouTube');assert.match(inputs[0].fields['agent-instructions'],/Selected channels: YouTube/);
 assert.match(inputs[2].fields['promotion-goal'],/Approved strategy admaker/);
 assert.match(inputs[3].fields['agent-instructions'],/Approved strategy promotie/);
 assert.equal(inputs[2].fields['promotion-channels'],'YouTube');
 assert.equal(inputs[3].fields['profile-facts'],'Geen telefoonteam\nhttps://amcinova.com/');
 const r=workflowReadiness(p);assert.equal(r.liveEnabled,false);assert.equal(r.readyForLive,false);assert.equal(r.checks.filter(c=>c.passed).length,4);
 const id=randomUUID();p=finishWorkflowStep(startWorkflowStep(p,'campaign',id),'campaign',id,{summary:'Changed strategy'});p=approveWorkflowStep(p,'campaign');assert.equal(p.steps.admaker.status,'pending');assert.equal(p.steps.promotie.status,'pending');
});
test('client cannot forge completed work or enable a live workflow',()=>{
 const p=make(),s=workflowSigner('test-secret'),sealed=s.seal(p);assert.deepEqual(s.open(sealed),p);
 const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
 assert.deepEqual(s.open(reorder(sealed)),p);
 assert.throws(()=>s.open(s.seal(p,'owner-one'),'owner-two'));
 const tampered=structuredClone(sealed);tampered.workflow.steps.campaign={status:'approved'};assert.throws(()=>s.open(tampered));
 assert.throws(()=>s.open({workflow:p,workflowProof:'x'}));assert.equal(workflowReadiness({...p,mode:'live',liveEnabled:true}).liveEnabled,false);
});
test('one URL feeds all agents without pretending owner approval or discarding checkout',()=>{
 let p=workflowFromWebsite({sourceURL:'https://shop.example.com/',title:'Ontdekboeken',fetchedAt:'2026-10-23T10:00:00Z',text:'Digitale ontdekboeken voor ouders en kinderen, 32 pagina’s voor EUR 10,85.',links:[{label:'Koop de PDF',url:'https://shop.example.com/cart?add-to-cart=71'}]});
 assert.equal(p.confirmed,false);assert.equal(p.source.confirmed,false);assert.equal(p.automaticDrafts,true);
 for(const step of workflowSteps){const input=workflowInput(p,step);assert.match(input.fields['agent-instructions']||input.fields['promotion-goal'],/untrusted source material/);const id=randomUUID();p=finishWorkflowStep(startWorkflowStep(p,step,id),step,id,{summary:'Draft from '+step});}
 assert.ok(workflowSteps.every(s=>p.steps[s].status==='draft'));
 assert.match(workflowInput(p,'admaker').fields['agent-instructions'],/Draft from campaign/);
 assert.match(workflowInput(p,'sitebuilder').fields['agent-instructions'],/Reuse the observed purchase links/);
 assert.match(p.brief.facts,/add-to-cart=71/);assert.equal(workflowReadiness(p).liveEnabled,false);
 p=approveWorkflowStep(p,'campaign');assert.equal(p.steps.admaker.status,'draft');
 p=startWorkflowStep(p,'campaign',randomUUID());assert.equal(p.steps.admaker.status,'pending');
});
function harness(options={}){
 const routes=new Map(),rows=[],u={id:randomUUID()},inputs=[],charges=[];let calls=0,rejected=false;
 const app={post:(path,...handlers)=>routes.set('POST '+path,handlers.at(-1)),get:(path,...handlers)=>routes.set('GET '+path,handlers.at(-1))};
 const db=async(user,table,q,body)=>{assert.equal(table,'amcinova_customer_documents');if(body){if(rows.some(r=>r.user_id===body.user_id&&r.project_id===body.project_id&&r.revision===body.revision))throw Object.assign(Error('conflict'),{status:409});rows.push(structuredClone(body));return [body];}const project=q.match(/project_id=eq\.([^&]+)/)?.[1];return rows.filter(r=>r.user_id===user.id&&r.project_id===project).sort((a,b)=>b.revision-a.revision).slice(0,1);};
 registerMarketingWorkflow(app,{json:express.json,env:{AMCINOVA_MARKETING_WORKFLOW_ENABLED:'true',MARKETING_WORKFLOW_SECRET:'test-secret'},identity:async req=>req.user||u,db,previewSite:async website=>({sourceURL:website,title:'Kleine Ontdekkers',fetchedAt:'2026-10-23T10:00:00Z',text:'Digitale ontdekboeken voor kinderen, samen met ouders en leerkrachten.'}),requireProduct:async(user,product)=>{if(product==='admaker'&&user.denied)throw Object.assign(Error('denied'),{status:403});},wrap:fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||503).json({error:e.message});}},credits:{run:async(user,product,id,fn)=>{charges.push(id);return fn();}},generateAgent:async input=>{calls++;if(options.rejectOnce&&!rejected){rejected=true;throw Object.assign(Error('Bekende uitvoervalidatie mislukt'),{status:502});}inputs.push(input);return {summary:'Strategy '+calls,sections:[],ads:[],posts:[]};}});
 async function request(method,route,body={},params={},user){const res={statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}};await routes.get(method+' /api/customer/marketing-projects'+route)({body,params,user},res);return res;}
 return {request,rows,inputs,charges,u,get calls(){return calls;}};
}
test('API stores revisions, prevents duplicate provider work and blocks stale and cross-owner mutations',async()=>{
 const h=harness();let r=await h.request('POST','',{name:'One project',brief});assert.equal(r.statusCode,200);let p=r.data.project;
 assert.equal((await h.request('GET','/:id',{}, {id:p.id},{id:randomUUID()})).statusCode,404);
 r=await h.request('POST','/:id/confirm',{revision:p.revision,confirmed:true},{id:p.id});p=r.data.project;
 const confirmedRevision=p.revision,storedVersions=h.rows.length;
 r=await h.request('POST','/:id/confirm',{revision:p.revision,confirmed:true},{id:p.id});
 assert.equal(r.data.project.revision,confirmedRevision);assert.equal(h.rows.length,storedVersions);
 const id=randomUUID(),params={id:p.id,step:'campaign'},body={revision:p.revision,requestId:id};
 const pair=await Promise.all([h.request('POST','/:id/steps/:step/run',body,params),h.request('POST','/:id/steps/:step/run',body,params)]);
 assert.equal(h.calls,1);assert.equal(h.charges.length,1);assert.ok(pair.some(x=>x.data.project?.steps.campaign.status==='draft'));
 r=await h.request('POST','/:id/steps/:step/run',body,params);assert.equal(h.calls,1);p=r.data.project;
 assert.equal((await h.request('POST','/:id/steps/:step/approve',{revision:1,confirmed:true},params)).statusCode,409);
 r=await h.request('POST','/:id/steps/:step/approve',{revision:p.revision,confirmed:true},params);p=r.data.project;
 const blocked=await h.request('POST','/:id/steps/:step/run',{revision:p.revision,requestId:randomUUID()},{id:p.id,step:'admaker'},{...h.u,denied:true});assert.equal(blocked.statusCode,403);assert.equal(h.calls,1);
});

test('URL-only endpoint persists source and the entire automatic draft chain under verified ownership',async()=>{
 const h=harness();let r=await h.request('POST','/from-website',{website:'https://shop.example.com/'});assert.equal(r.statusCode,200);let p=r.data.project;
 assert.equal(p.confirmed,false);assert.equal(p.source.sourceURL,'https://shop.example.com/');
 for(const step of workflowSteps){r=await h.request('POST','/:id/steps/:step/run',{revision:p.revision,requestId:randomUUID()},{id:p.id,step});assert.equal(r.statusCode,200);p=r.data.project;}
 assert.equal(h.calls,4);assert.equal(h.charges.length,4);assert.ok(workflowSteps.every(s=>p.steps[s].status==='draft'));assert.equal(p.confirmed,false);
 assert.equal((await h.request('GET','/:id',{}, {id:p.id},{id:randomUUID()})).statusCode,404);
});

test('known provider validation failure is terminal failed and an explicit new attempt can recover',async()=>{
 const h=harness({rejectOnce:true});let r=await h.request('POST','/from-website',{website:'https://shop.example.com/'}),p=r.data.project;
 r=await h.request('POST','/:id/steps/:step/run',{revision:p.revision,requestId:randomUUID()},{id:p.id,step:'campaign'});assert.equal(r.statusCode,502);
 r=await h.request('GET','/:id',{}, {id:p.id});p=r.data.project;assert.equal(p.attempts.at(-1).status,'failed');assert.equal(p.steps.campaign.status,'failed');
 r=await h.request('POST','/:id/steps/:step/run',{revision:p.revision,requestId:randomUUID()},{id:p.id,step:'campaign'});assert.equal(r.statusCode,200);assert.equal(r.data.project.steps.campaign.status,'draft');assert.equal(h.calls,2);
});
