import http from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { monthlyMandatePayment, monthlySubscriptionRequest, nextMonthlyCharge, verifiedMonthlyRenewal } from './offertetool-monthly.mjs';

const key = (process.env.AMCINOVA_MOLLIE_TEST_API_KEY || '').trim();
const operator = process.env.OFFERTETOOL_QA_OPERATOR_TOKEN || '';
const origin = 'https://offertetool-maandincasso-qa.onrender.com';
const keyReady = /^test_[A-Za-z0-9]+$/.test(key);
const digest = value => createHash('sha256').update(value).digest();
const canOperate = req => operator.length >= 32 &&
 timingSafeEqual(digest(req.headers.authorization || ''), digest('Bearer ' + operator));
const reply = (res, code, result) => {
 res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
 res.end(JSON.stringify(result));
};
const idPattern = /^(?:cst|tr|mdt|sub)_[A-Za-z0-9]+$/;
const verifiedId = (value, prefix) => {
 if (!idPattern.test(value || '') || !value.startsWith(prefix + '_')) throw new Error('Mollie returned an invalid ID.');
 return value;
};

async function mollie(path, method = 'GET', body, operation) {
 const response = await fetch('https://api.mollie.com/v2' + path, {
  method,
  headers: {
   Authorization: 'Bearer ' + key,
   ...(body && { 'Content-Type': 'application/json' }),
   ...(operation && { 'Idempotency-Key': state.id + '-' + operation }),
  },
  body: body && JSON.stringify(body),
  redirect: 'error',
  signal: AbortSignal.timeout(10000),
 });
 if (!response.ok) throw new Error('Mollie HTTP ' + response.status);
 return response.status === 204 ? null : response.json();
}

let state;
let busy = false;
const subscriptionPath = () => '/customers/' + state.customerId + '/subscriptions';
const subscriptionUrl = () => subscriptionPath() + '/' + state.subscriptionId;
async function restoreScheduledRun() {
 if (state?.subscriptionId) return true;
 const result = await mollie('/subscriptions?limit=250');
 const matches = (result._embedded?.subscriptions || []).filter(s =>
  s.mode === 'test' && s.startDate === '2026-11-18' &&
  s.amount?.currency === 'EUR' && s.amount?.value === '22.99' &&
  s.metadata?.source === 'amcinova-offertetool-monthly' &&
  s.metadata?.userId === 'offertetool-isolated-qa' &&
  typeof s.metadata?.orderId === 'string');
 if (matches.length !== 1) return false;
 const [subscription] = matches;
 state = {
  id: subscription.metadata.orderId, mode: 'test', userId: subscription.metadata.userId,
  customerId: verifiedId(subscription.customerId, 'cst'),
  subscriptionId: verifiedId(subscription.id, 'sub'),
  initialPaidThrough: subscription.startDate, paidThrough: subscription.startDate,
 };
 return true;
}
const loadTestPayment = async id => {
 const payment = await mollie('/payments/' + verifiedId(id, 'tr'));
 if (payment.mode !== 'test') throw new Error('Expected a Mollie test payment.');
 return payment;
};
const validCheckout = link => {
 const url = new URL(link);
 if (url.protocol !== 'https:' || !/(^|\.)mollie\.com$/.test(url.hostname)) throw new Error('Unexpected checkout host.');
 return url.href;
};

async function start() {
 if (await restoreScheduledRun()) throw new Error('The scheduled QA run already exists.');
 state ??= { id: randomUUID(), userId: 'offertetool-isolated-qa', mode: 'test', consentAt: new Date().toISOString() };
 if (!state.customerId) {
  const customer = await mollie('/customers', 'POST', { name: 'Offertetool maandincasso QA' }, 'customer');
  state.customerId = verifiedId(customer.id, 'cst');
 }
 if (!state.firstPaymentId) {
  const payment = await mollie('/payments', 'POST',
   monthlyMandatePayment(state, origin + '/health', origin + '/webhook'), 'first');
  if (payment.mode !== 'test') throw new Error('Expected a Mollie test payment.');
  state.firstPaymentId = verifiedId(payment.id, 'tr');
  state.checkout = validCheckout(payment._links.checkout.href);
 }
 return { checkout: state.checkout };
}

async function schedule() {
 if (!state.firstPaymentId) throw new Error('Start the first payment before scheduling.');
 if (!state.subscriptionId) {
  const first = await loadTestPayment(state.firstPaymentId);
  const mandateId = verifiedId(first.mandateId, 'mdt');
  const mandate = await mollie('/customers/' + state.customerId + '/mandates/' + mandateId);
  const terms = monthlySubscriptionRequest(state, first, mandate, origin + '/webhook');
  // Bring the first renewal forward in QA only. Treat its due date as the end of the test period.
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  terms.startDate = tomorrow.toISOString().slice(0, 10);
  const subscription = await mollie(subscriptionPath(), 'POST', terms, 'subscription');
  if (subscription.mode !== 'test' || subscription.customerId !== state.customerId) throw new Error('Unexpected subscription.');
  state.subscriptionId = verifiedId(subscription.id, 'sub');
  state.initialPaidThrough = state.paidThrough = terms.startDate;
 }
 return status();
}

async function status() {
 const subscription = await mollie(subscriptionUrl());
 if (subscription.mode !== 'test' || subscription.id !== state.subscriptionId) throw new Error('Unexpected subscription.');
 const payments = await mollie(subscriptionUrl() + '/payments');
 const candidates = (payments._embedded?.payments || []).filter(p => p.mode === 'test' && p.subscriptionId === state.subscriptionId);
 for (const payment of candidates) recordRenewal(payment);
 const awaiting = candidates.find(p => p._links?.changePaymentState?.href && ['open', 'pending'].includes(p.status));
 return {
  subscriptionStatus: subscription.status,
  nextPaymentDate: subscription.nextPaymentDate ?? null,
  initialPaidThrough: state.initialPaidThrough,
  paidThrough: state.paidThrough,
  renewal: state.renewal ?? null,
  ...(awaiting && { testPaymentStateUrl: validCheckout(awaiting._links.changePaymentState.href) }),
 };
}

function recordRenewal(payment) {
 if (!verifiedMonthlyRenewal(state, payment)) return;
 const through = nextMonthlyCharge(payment.paidAt);
 if (through > state.paidThrough) {
  state.paidThrough = through;
  state.renewal = { amount: payment.amount.value, paidAt: payment.paidAt };
 }
}

async function callback(req) {
 let body = '';
 for await (const part of req) {
  body += part;
  if (body.length > 2048) throw new Error('Unexpected webhook body.');
 }
 const id = new URLSearchParams(body).get('id');
 if (!/^tr_[A-Za-z0-9]+$/.test(id || '') || !await restoreScheduledRun()) return;
 const payment = await loadTestPayment(id);
 recordRenewal(payment);
}

http.createServer(async (req, res) => {
 if (req.method === 'GET' && req.url === '/health') {
  return reply(res, 200, { ok: true, mode: 'test', testKeyConfigured: keyReady, operatorConfigured: operator.length >= 32 });
 }
 if (!keyReady) return reply(res, 503, { error: 'Test API key required.' });
 if (req.method === 'POST' && req.url === '/webhook') {
  try { await callback(req); return reply(res, 200, { ok: true }); }
  catch { return reply(res, 503, { ok: false }); }
 }
 if (!canOperate(req)) return reply(res, 404, { ok: false });
 if (busy) return reply(res, 409, { error: 'Another operation is in progress.' });
 busy = true;
 try {
  if (req.method === 'POST' && req.url === '/start') return reply(res, 200, await start());
  if (!state?.subscriptionId) await restoreScheduledRun();
  if (!state) return reply(res, 409, { error: 'Start the QA run first.' });
  if (req.method === 'POST' && req.url === '/schedule') return reply(res, 200, await schedule());
  if (!state.subscriptionId) return reply(res, 409, { error: 'Schedule the test subscription first.' });
  if (req.method === 'POST' && req.url === '/cancel') {
   const before = await status();
   if (before.subscriptionStatus !== 'canceled') await mollie(subscriptionUrl(), 'DELETE');
   return reply(res, 200, await status());
  }
  if (req.method === 'GET' && req.url === '/status') return reply(res, 200, await status());
  return reply(res, 404, { ok: false });
 } catch (error) {
  const message = /^Mollie HTTP \d{3}$/.test(error.message) ? error.message : 'The QA operation could not be verified.';
  return reply(res, 502, { error: message });
 } finally {
  busy = false;
 }
}).listen(Number(process.env.PORT) || 10000, '0.0.0.0');
