import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerOffertetoolMonthly } from './offertetool-monthly-routes.mjs';

test('monthly checkout activates only after a paid mandate, renews and cancels without a charge', async () => {
 const app = express();
 const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'qa@example.invalid' };
 let order, firstPayment, renewal;
 let creates = 0, cancellations = 0;
 registerOffertetoolMonthly(app, {
  json: express.json, form: express.urlencoded,
  env: { AMCINOVA_OFFERTETOOL_MONTHLY_TEST_ENABLED: 'true', AMCINOVA_MOLLIE_TEST_API_KEY: 'test_mock', AMCINOVA_TEST_ACCESS_USERS: user.id },
  identity: async () => user,
  db: async () => [{source:'trial'}],
  wrap: fn => async (req, res) => {
   try { await fn(req, res); } catch (error) { res.status(error.status ?? 500).json({error:error.message}); }
  },
  adminDb: async (_table, request) => {
   if (request.method === 'POST') order = request.body;
   if (request.method === 'PATCH') order = {...order,...request.body};
   return order ? [order] : [];
  },
  fetchImpl: async (url, request) => {
   assert.equal(request.headers.Authorization,'Bearer test_mock');
   if (url.endsWith('/customers')) return Response.json({id:'cst_QA'});
   if (url.endsWith('/payments')) {
    const body = JSON.parse(request.body);
    assert.deepEqual(body.amount,{currency:'EUR',value:'22.99'});
    assert.equal(body.sequenceType,'first');
    firstPayment = {...body,id:'tr_First',mode:'test',status:'open',_links:{checkout:{href:'https://www.mollie.com/checkout/test'}}};
    return Response.json(firstPayment);
   }
   if (url.endsWith('/tr_First')) return Response.json(firstPayment);
   if (url.endsWith('/tr_Renewal')) return Response.json(renewal);
   if (url.endsWith('/mandates/mdt_QA')) return Response.json({id:'mdt_QA',status:'valid'});
   if (url.endsWith('/subscriptions')) {
    const body = JSON.parse(request.body);
    assert.equal(body.interval,'1 month');
    assert.equal(body.startDate,'2026-02-28');
    creates++;
    return Response.json({id:'sub_QA',mode:'test',customerId:'cst_QA'});
   }
   if (url.endsWith('/subscriptions/sub_QA') && request.method === 'DELETE') {
    cancellations++;
    return new Response(null,{status:204});
   }
   assert.fail('Unexpected Mollie request ' + url);
  },
 });
 const server = app.listen(0,'127.0.0.1');
 await new Promise(resolve => server.once('listening',resolve));
 const root = 'http://127.0.0.1:' + server.address().port + '/api/customer/offertetool-monthly';
 const begin = consent => fetch(root+'?mode=test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({monthlyConsent:consent})});
 const notice = id => fetch(root+'/webhook?mode=test',{method:'POST',body:new URLSearchParams({id})});
 try {
  assert.equal((await begin(false)).status,400);
  assert.equal((await fetch(root)).status,503);
  const start = await (await begin(true)).json();
  assert.equal(start.state,'awaiting_payment');
  assert.equal(start.checkoutUrl,'https://www.mollie.com/checkout/test');
  assert.equal((await notice('tr_First')).status,200);
  assert.equal(creates,0);
  firstPayment = {...firstPayment, status:'paid',paidAt:'2026-01-31T10:00:00Z',mandateId:'mdt_QA'};
  assert.equal((await notice('tr_First')).status,200);
  assert.equal((await notice('tr_First')).status,200);
  assert.equal(creates,1);
  renewal = {...firstPayment,id:'tr_Renewal',sequenceType:'recurring',subscriptionId:'sub_QA',paidAt:'2026-02-28T12:00:00Z'};
  assert.equal((await notice('tr_Renewal')).status,200);
  const ended = await (await fetch(root+'/cancel?mode=test',{method:'POST'})).json();
  assert.equal(ended.state,'cancelled');
  assert.equal(ended.paidThrough,'2026-03-28');
  assert.equal((await fetch(root+'/cancel?mode=test',{method:'POST'})).status,200);
  assert.equal(cancellations,1);
 } finally {
  await new Promise(resolve => server.close(resolve));
 }
});
