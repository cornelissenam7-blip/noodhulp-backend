import test from 'node:test';
import assert from 'node:assert/strict';
import {purgeExpiredDmReceipts,startMetaDmRetention} from './meta-dm-retention.mjs';
test('retention only removes receipts strictly older than 90 days of storage', async () => {
  const now=Date.parse('2026-10-15T12:00:00.000Z');
  const cutoff=now-90*86400000;
  const records=[{received_at:cutoff-1},{received_at:cutoff},{received_at:cutoff+1}];
  const deleted=await purgeExpiredDmReceipts(async(table,options)=>{
    assert.equal(table,'amcinova_social_dm_receipts');
    assert.equal(options.method,'DELETE');
    assert.equal(options.prefer,'return=representation');
    const threshold=Date.parse(decodeURIComponent(options.query.replace('?received_at=lt.','')));
    assert.equal(threshold,cutoff);
    return records.filter(r=>r.received_at<threshold);
  },now);
  assert.equal(deleted,1);
});
test('unavailable storage is not reported as a successful purge', async()=>{
  await assert.rejects(purgeExpiredDmReceipts(async()=>null));
  await assert.rejects(purgeExpiredDmReceipts(async()=>{throw Error('private');}));
});
test('disabled collection never starts retention',()=>{
  const stop=startMetaDmRetention({env:{},adminDb:()=>{throw Error('must not run');}});
  stop();
});
