import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerAgentRoutes} from './agent-ai.mjs';
test('library accepts only existing signed, unexpired admin grants',async()=>{
 const routes=new Map();let now=1000;
 registerAgentRoutes({post(path,...handlers){routes.set(path,handlers.at(-1));},get(path,handler){routes.set(path,handler);}},{json:()=>()=>{},env:{ADMIN_KEY:'local-test-only'},now:()=>now,fetchImpl:()=>{throw Error('No external calls expected');}});
 const call=async(path,headers={})=>{const res={code:200,set(){return this},status(n){this.code=n;return this},json(data){this.data=data;return this}};await routes.get('/api/agent/ai'+path)({headers},res);return res;};
 assert.equal((await call('/library-access')).code,401);
 const login=await call('/session',{'x-admin-key':'local-test-only'});assert.ok(login.data.token);
 const authorization='Bearer '+login.data.token;
 assert.equal((await call('/library-access',{authorization})).data.workspace,'amcinova-admin');
 assert.equal((await call('/library-access',{authorization:authorization+'x'})).code,401);
 now+=3600001;assert.equal((await call('/library-access',{authorization})).code,401);
});
