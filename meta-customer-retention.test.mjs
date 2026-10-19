import test from 'node:test';
import assert from 'node:assert/strict';
import {purgeExpiredMetaLogins,startMetaLoginRetention} from './meta-customer-retention.mjs';
test('expired login cleanup removes expired temporary login and reply context records',async()=>{const calls=[];await purgeExpiredMetaLogins(async(t,o)=>{calls.push([t,o]);return [];},Date.parse('2026-10-15T12:00:00Z'));assert.deepEqual(calls.map(c=>c[0]),['amcinova_meta_states','amcinova_meta_grants','amcinova_meta_reply_contexts']);for(const [,o]of calls){assert.equal(o.method,'DELETE');assert.equal(decodeURIComponent(o.query),'?expires_at=lt.2026-10-15T12:00:00.000Z');}});
test('cleanup fails on unavailable storage and stays disabled until activation',async()=>{await assert.rejects(purgeExpiredMetaLogins(async()=>null));let called=false;const stop=startMetaLoginRetention({env:{},adminDb:async()=>{called=true;}});stop();assert.equal(called,false);});
