import test from 'node:test';
import assert from 'node:assert/strict';
import {registerMetaPublishing,publishScopes} from './meta-publishing.mjs';
import {tokenBox} from './meta-customer.mjs';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const box=tokenBox('12'.repeat(32)),config={appId:'123',secret:'synthetic',box};
function setup({rows=[],expired=false,scopes=publishScopes,instagram=true,authorized=true,metadataFailure=false}={}){
 const routes={},calls=[],connections=structuredClone(rows);
 const storage=async(table,o)=>{assert.equal(table,'amcinova_meta_connections');const q=new URLSearchParams((o.query||'').slice(1));const found=connections.filter(row=>[...q].every(([k,v])=>k==='select'||v.startsWith('eq.')&&String(row[k])===v.slice(3)));
  if(o.method==='GET')return structuredClone(found);
  if(o.method==='PATCH'){found.forEach(r=>Object.assign(r,o.body));return structuredClone(found);}
  if(o.method==='POST'){if(connections.some(r=>r.page_id===o.body.page_id))throw Object.assign(Error('duplicate'),{code:'23505'});connections.push(structuredClone(o.body));return [o.body];}
  throw Error('Unexpected write');};
 const app={get:(p,...h)=>routes['GET '+p]=h.at(-1),post:(p,...h)=>routes['POST '+p]=h.at(-1)};
 registerMetaPublishing(app,{json:()=>()=>{},env:{AMCINOVA_META_PUBLISH_LOGIN_CONFIG_ID:'999'},access:async req=>({id:req.owner||owner,product:'admaker'}),storage,config:()=>config,
  grant:async()=>{if(expired)throw Object.assign(Error('Sign in again'),{status:409});return 'fresh-user-token';},
  pages:async()=>authorized?[{id:'987',name:'Fresh Page',access_token:'page-token',tasks:['CREATE_CONTENT']}]:[],
  graph:async(c,path)=>{calls.push(path);if(path==='debug_token')return {data:{is_valid:true,app_id:'123',scopes}};if(path==='987'){if(metadataFailure)throw Error('provider rejected');return {name:'Fresh Page',...(instagram?{instagram_business_account:{id:'654',username:'freshinstagram'}}:{})};}throw Error('Unexpected Graph mutation '+path);}});
 return {calls,connections,async call(method,path,body={},who=owner){let status=200,value;const res={set(){return this;},status(s){status=s;return this;},json(v){value=v;return this;}};await routes[method+' /api/customer/meta/publishing/'+path]({body,owner:who},res);return {status,value};}};
}
test('new customer discovers and saves its own Page and Instagram without Messenger',async()=>{
 const s=setup(),discovery=await s.call('GET','pages');assert.equal(discovery.status,200);assert.equal(discovery.value.pages[0].connected,false);assert.equal(discovery.value.pages[0].instagram.username,'freshinstagram');assert.equal(s.connections.length,0);
 const result=await s.call('POST','connect',{pageId:'987'});assert.equal(result.status,200);assert.equal(s.connections[0].status,'publishing');assert.equal(box.open(s.connections[0].publishing_token_cipher,owner+':987'),'page-token');assert.ok(!JSON.stringify(result).includes('page-token'));assert.ok(!s.calls.some(p=>p.includes('subscribed_apps')));
 const persisted=await s.call('GET','pages');assert.equal(persisted.value.pages[0].connected,true);assert.equal(persisted.value.pages[0].instagram.username,'freshinstagram');
});
test('another customer cannot discover, claim or decrypt the reserved Page',async()=>{
 const initial={tenant_id:other,page_id:'987',status:'connected',token_cipher:box.seal('other-token',other+':987')},s=setup({rows:[initial]});assert.equal((await s.call('GET','pages')).value.pages.length,0);assert.equal((await s.call('POST','connect',{pageId:'987'})).status,409);assert.deepEqual(s.connections,[initial]);
});
test('renewing publishing rights preserves the existing Messenger token and routing',async()=>{
 const initial={tenant_id:owner,page_id:'987',page_name:'Old',status:'connected',token_cipher:box.seal('messenger-token',owner+':987')},s=setup({rows:[initial]});assert.equal((await s.call('POST','connect',{pageId:'987'})).status,200);assert.equal(s.connections[0].token_cipher,initial.token_cipher);assert.equal(s.connections[0].status,'connected');assert.equal(box.open(s.connections[0].publishing_token_cipher,owner+':987'),'page-token');
});
test('a Facebook Page without Instagram is not reported as Instagram ready',async()=>{const s=setup({instagram:false}),r=await s.call('GET','pages');assert.equal(r.value.pages[0].instagram,null);assert.equal((await s.call('POST','connect',{pageId:'987'})).status,200);});
test('missing Meta approval or consent cannot be treated as working publication access',async()=>{const s=setup({scopes:['pages_show_list']}),r=await s.call('GET','pages');assert.equal(r.value.pages[0].facebook,false);assert.equal(r.value.pages[0].instagramAllowed,false);assert.equal((await s.call('POST','connect',{pageId:'987'})).status,409);assert.equal(s.connections.length,0);});
test('expired authorization and invented Page IDs cannot create connections',async()=>{const s=setup({expired:true});assert.equal((await s.call('GET','pages')).value.pages.length,0);assert.equal((await s.call('POST','connect',{pageId:'987'})).status,409);assert.equal(s.connections.length,0);const denied=setup({authorized:false});assert.equal((await denied.call('POST','connect',{pageId:'987'})).status,403);assert.equal(denied.connections.length,0);});
test('concurrent first connections cannot overwrite the other customer reservation',async()=>{const s=setup();const results=await Promise.all([s.call('POST','connect',{pageId:'987'}),s.call('POST','connect',{pageId:'987'},other)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(s.connections.length,1);});
test('failed real metadata lookup is never reported as a verified ready connection',async()=>{const s=setup({metadataFailure:true});assert.equal((await s.call('GET','pages')).status,502);assert.equal((await s.call('POST','connect',{pageId:'987'})).status,502);assert.equal(s.connections.length,0);});
