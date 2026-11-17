import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerOffertetoolCheckout } from './offertetool-checkout.mjs';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const orderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const purchaseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('Offertetool checkout uses €240.79 and only a verified live payment activates access', async () => {
 const app = express();
 let order, payment, creates = 0;
 const purchases = new Set();
 const activationCalls = [];
 registerOffertetoolCheckout(app, {
  json: express.json,
  form: express.urlencoded,
  env: { AMCINOVA_OFFERTETOOL_CHECKOUT_ENABLED: 'true', AMCINOVA_MOLLIE_LIVE_API_KEY: 'live_mockonly' },
  identity: async req => ({ id: req.get('authorization') === 'own' ? userId : purchaseId }),
  wrap: fn => async (req, res) => {
   try { await fn(req, res); } catch (error) { res.sendStatus(error.status || 500); }
  },
  adminDb: async (table, request) => {
   if (table === 'rpc/amcinova_activate_offertetool') {
    activationCalls.push(request.body);
    purchases.add(request.body.p_payment);
    return purchaseId;
   }
   assert.equal(table, 'amcinova_offertetool_orders');
   if (request.method === 'POST') return [order = request.body];
   if (request.method === 'PATCH') return [order = { ...order, ...request.body }];
   return order && !request.query.includes('user_id=eq.' + purchaseId) ? [order] : [];
  },
  fetchImpl: async (url, request) => {
   assert.match(url, /^https:\/\/api\.mollie\.com\/v2\/payments/);
   assert.equal(request.headers.Authorization, 'Bearer live_mockonly');
   if (request.method === 'POST') {
    creates++;
    const body = JSON.parse(request.body);
    assert.deepEqual(body.amount, { currency: 'EUR', value: '240.79' });
    assert.match(request.headers['Idempotency-Key'], new RegExp(orderId + '$'));
    payment = { id: 'tr_Mock123', mode: 'live', status: 'open', amount: body.amount,
     metadata: body.metadata, _links: { checkout: { href: 'https://www.mollie.com/checkout/mock' } } };
   }
   return { ok: true, json: async () => payment };
  },
 });
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 const url = 'http://127.0.0.1:' + server.address().port + '/api/customer/offertetool-checkout';
 try {
  const start = () => fetch(url, { method: 'POST', headers: { authorization: 'own', 'content-type': 'application/json' },
   body: JSON.stringify({ orderId, amount: '0.01', userId: purchaseId }) });
  const webhook = () => fetch(url + '/webhook?mode=live', {
   method: 'POST', body: new URLSearchParams({ id: payment.id }),
  });
  assert.equal((await (await start()).json()).accessGranted, false);
  assert.equal((await start()).status, 200);
  assert.equal(creates, 1);
  assert.equal((await webhook()).status, 200);
  assert.equal(purchases.size, 0);
  const amount = payment.amount;
  payment = { ...payment, status: 'paid', amount: { currency: 'EUR', value: '0.01' } };
  assert.equal((await webhook()).status, 409);
  assert.equal(purchases.size, 0);
  payment.amount = amount;
  assert.equal((await fetch(url + '/' + orderId, { headers: { authorization: 'other' } })).status, 404);
  assert.equal((await webhook()).status, 200);
  assert.equal((await (await fetch(url + '/' + orderId, { headers: { authorization: 'own' } })).json()).accessGranted, true);
  assert.deepEqual(activationCalls, Array(2).fill({ p_order: orderId, p_payment: payment.id }));
  assert.equal(purchases.size, 1);
 } finally {
  await new Promise(resolve => server.close(resolve));
 }
});
