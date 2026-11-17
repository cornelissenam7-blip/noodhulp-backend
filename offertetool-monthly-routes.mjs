import { randomUUID } from 'node:crypto';
import { monthlyServiceAmount, monthlyMandatePayment, monthlySubscriptionRequest, verifiedMonthlyRenewal, nextMonthlyCharge } from './offertetool-monthly.mjs';

const table = 'amcinova_offertetool_monthly';
const route = '/api/customer/offertetool-monthly';
const fault = (status, message) => Object.assign(new Error(message), { status });
const validId = (value, prefix) => typeof value === 'string' && value.startsWith(prefix + '_') && /^[A-Za-z0-9]{1,80}$/.test(value.slice(prefix.length + 1));

export function registerOffertetoolMonthly(app, { json, form, env, identity, db, wrap, adminDb, fetchImpl }) {
 const keys = {
  live: (env.AMCINOVA_MOLLIE_LIVE_API_KEY || '').trim(),
  test: (env.AMCINOVA_MOLLIE_TEST_API_KEY || '').trim(),
 };
 const testers = new Set((env.AMCINOVA_TEST_ACCESS_USERS || '').split(',').map(id => id.trim()));
 const enabled = mode => typeof adminDb === 'function' && (mode === 'test'
  ? env.AMCINOVA_OFFERTETOOL_MONTHLY_TEST_ENABLED === 'true' && /^test_[A-Za-z0-9]+$/.test(keys.test)
  : env.AMCINOVA_OFFERTETOOL_MONTHLY_ENABLED === 'true' && /^live_[A-Za-z0-9]+$/.test(keys.live));
 const modeOf = req => req.query.mode === 'test' ? 'test' : 'live';
 const read = async filter => (await adminDb(table, { method: 'GET', query: '?' + filter + '&order=created_at.desc&limit=1' }))?.[0];
 const ownerFilter = (user, mode) => 'user_id=eq.' + user.id + '&mode=eq.' + mode;
 async function patch(order, condition, body) {
  const rows = await adminDb(table, { method: 'PATCH', query: '?id=eq.' + order.id + '&' + condition,
   body, prefer: 'return=representation' });
  return rows?.[0] ?? read('id=eq.' + order.id);
 }
 async function mollie(mode, path, { method = 'GET', body, idempotency } = {}) {
  if (!enabled(mode)) throw fault(503, 'De maandservice is niet beschikbaar.');
  const response = await fetchImpl('https://api.mollie.com/v2' + path, {
   method, headers: { Authorization: 'Bearer ' + keys[mode], ...(body && { 'Content-Type': 'application/json' }),
    ...(idempotency && { 'Idempotency-Key': idempotency }) },
   body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000), redirect: 'error',
  });
  // Repeated cancellation may find that a subscription has already disappeared.
  if (method === 'DELETE' && response.status === 404) return null;
  if (!response.ok) throw fault(503, 'Mollie kon de wijziging nog niet bevestigen.');
  return response.status === 204 ? null : response.json();
 }
 const model = order => ({
  id: order.id, mode: order.mode, userId: order.user_id, customerId: order.customer_id,
  consentAt: order.consent_at, firstPaymentId: order.first_payment_id, subscriptionId: order.subscription_id,
 });
 const webhook = mode => 'https://api.amcinova.com' + route + '/webhook?mode=' + mode;
 const summary = order => order ? {
  state: order.cancelled_at ? 'cancelled' : order.subscription_id ? 'subscribed' : 'awaiting_payment',
  paidThrough: order.paid_through,
 } : { state: 'none', paidThrough: null };
 async function customer(req, mode) {
  const user = await identity(req);
  if (!enabled(mode) || (mode === 'test' && !testers.has(user.id))) throw fault(503, 'De maandservice is niet beschikbaar.');
  return user;
 }
 async function bind(order, field, value) {
  const updated = await patch(order, field + '=is.null&cancelled_at=is.null', { [field]: value });
  if (updated?.[field] !== value) throw fault(503, 'De koppeling kon nog niet worden opgeslagen.');
  return updated;
 }
 async function completeFirst(order, payment) {
  if (order.cancelled_at || order.subscription_id || payment.status !== 'paid') return order;
  if (!validId(payment.mandateId, 'mdt')) throw fault(503, 'Mollie heeft de incassomachtiging nog niet bevestigd.');
  const path = '/customers/' + order.customer_id;
  const mandate = await mollie(order.mode, path + '/mandates/' + payment.mandateId);
  if (mandate.status !== 'valid') throw fault(503, 'Mollie heeft de incassomachtiging nog niet bevestigd.');
  const body = monthlySubscriptionRequest(model(order), payment, mandate, webhook(order.mode));
  const subscription = await mollie(order.mode, path + '/subscriptions', {
   method: 'POST', body, idempotency: 'offertetool-monthly-subscription-' + order.id,
  });
  if (!validId(subscription.id, 'sub') || subscription.customerId !== order.customer_id
   || subscription.mode !== order.mode) throw fault(503, 'Mollie bevestigde het abonnement nog niet.');
  const result = await patch(order, 'subscription_id=is.null&cancelled_at=is.null',
   { subscription_id: subscription.id, paid_through: body.startDate });
  if (result?.subscription_id !== subscription.id) {
   // A cancellation racing this first payment must not leave a future charge scheduled.
   await mollie(order.mode, path + '/subscriptions/' + subscription.id, { method: 'DELETE' });
   throw fault(409, 'De maandservice is inmiddels gestopt.');
  }
  return result;
 }
 app.get(route, wrap(async (req, res) => {
  const mode = modeOf(req);
  const user = await customer(req, mode);
  let order = await read(ownerFilter(user, mode));
  if (order?.first_payment_id && !order.cancelled_at && !order.subscription_id) {
   const payment = await mollie(mode, '/payments/' + order.first_payment_id);
   order = await completeFirst(order, payment);
  }
  res.json({ ok: true, ...summary(order) });
 }));
 app.post(route, json({ limit: '2kb' }), wrap(async (req, res) => {
  const mode = modeOf(req);
  const user = await customer(req, mode);
  if (req.body?.monthlyConsent !== true) throw fault(400, 'Geef toestemming voor €22,99 per maand.');
  const owned = await db(user, 'amcinova_customer_access', '?product_code=eq.offertetool&status=eq.active&select=source,expires_at');
  const access = owned[0];
  if (!access || (mode === 'live' && access.source !== 'purchase')
   || (access.expires_at && Date.parse(access.expires_at) <= Date.now())) throw fault(403, 'Open eerst een actief Offertetool-account.');
  const filter = ownerFilter(user, mode) + '&cancelled_at=is.null';
  let order = await read(filter);
  if (!order) {
   const inserted = await adminDb(table, { method: 'POST', body: {
    id: randomUUID(), user_id: user.id, mode, consent_at: new Date().toISOString(),
   }, prefer: 'resolution=ignore-duplicates,return=representation' });
   order = inserted?.[0] ?? await read(filter);
  }
  if (!order) throw fault(503, 'De bestelling kon nog niet worden opgeslagen.');
  if (order.subscription_id) return res.json({ ok: true, ...summary(order) });
  if (!order.customer_id) {
   const remote = await mollie(mode, '/customers', {
    method: 'POST', body: { email: user.email }, idempotency: 'offertetool-monthly-customer-' + order.id,
   });
   if (!validId(remote.id, 'cst')) throw fault(503, 'Mollie bevestigde de klant nog niet.');
   order = await bind(order, 'customer_id', remote.id);
  }
  let payment;
  if (order.first_payment_id) {
   payment = await mollie(mode, '/payments/' + order.first_payment_id);
   if (['failed', 'expired', 'canceled'].includes(payment.status)) {
    await patch(order, 'subscription_id=is.null&cancelled_at=is.null', { cancelled_at: new Date().toISOString() });
    throw fault(409, 'De vorige betaling is gestopt. Probeer opnieuw om een nieuwe betaalpagina te openen.');
   }
  } else {
   const lang = req.body.language === 'en' ? 'en' : 'nl';
   const returnUrl = 'https://agents.amcinova.com/winkelmand.html?producten=offertetool&monthlyreturn=1&lang=' + lang
    + (mode === 'test' ? '&offertetooltest=1' : '');
   payment = await mollie(mode, '/payments', { method: 'POST',
    body: monthlyMandatePayment(model(order), returnUrl, webhook(mode)),
    idempotency: 'offertetool-monthly-first-' + order.id,
   });
   if (!validId(payment.id, 'tr') || payment.mode !== mode) throw fault(503, 'Mollie bevestigde de betaling nog niet.');
   order = await bind(order, 'first_payment_id', payment.id);
  }
  const updated = await completeFirst(order, payment);
  const checkoutUrl = ['open', 'pending'].includes(payment.status) ? payment._links?.checkout?.href : null;
  if (checkoutUrl && !/^https:\/\/(?:[a-z0-9-]+\.)?mollie\.com\//i.test(checkoutUrl)) throw fault(503, 'Ongeldige betaalpagina.');
  res.json({ ok: true, ...summary(updated), checkoutUrl });
 }));
 app.post(route + '/cancel', wrap(async (req, res) => {
  const mode = modeOf(req);
  const user = await customer(req, mode);
  const order = await read(ownerFilter(user, mode));
  if (!order || order.cancelled_at) return res.json({ ok: true, ...summary(order) });
  // Require completion of the first payment flow before cancelling an active subscription.
  if (!order.subscription_id) throw fault(409, 'Er is nog geen actief abonnement om op te zeggen.');
  await mollie(mode, '/customers/' + order.customer_id + '/subscriptions/' + order.subscription_id, { method: 'DELETE' });
  const stopped = await patch(order, 'cancelled_at=is.null', { cancelled_at: new Date().toISOString() });
  res.json({ ok: true, ...summary(stopped) });
 }));
 if (form) app.post(route + '/webhook', form({ extended: false, limit: '2kb' }), wrap(async (req, res) => {
  const mode = modeOf(req);
  const id = req.body?.id;
  if (!validId(id, 'tr')) throw fault(400, 'Ongeldig betalingsnummer.');
  const payment = await mollie(mode, '/payments/' + id);
  if (payment.metadata?.source !== 'amcinova-offertetool-monthly') return res.sendStatus(200);
  if (payment.sequenceType === 'first') {
   const order = await read('first_payment_id=eq.' + id + '&mode=eq.' + mode);
   if (!order) throw fault(503, 'De maandservice wordt nog opgeslagen.');
   await completeFirst(order, payment);
  } else if (validId(payment.subscriptionId, 'sub')) {
   const order = await read('subscription_id=eq.' + payment.subscriptionId + '&mode=eq.' + mode);
   if (!order) throw fault(503, 'De maandservice wordt nog opgeslagen.');
   if (verifiedMonthlyRenewal(model(order), payment)) {
    const through = nextMonthlyCharge(payment.paidAt);
    await patch(order, 'or=(paid_through.is.null,paid_through.lt.' + through + ')', { paid_through: through });
   }
  }
  res.sendStatus(200);
 }));
 return { liveEnabled: enabled('live'), testEnabled: enabled('test'), amount: monthlyServiceAmount };
}
