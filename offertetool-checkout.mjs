
export const offertetoolPrice = Object.freeze({ currency: 'EUR', value: '240.79' });
const product = 'offertetool';
const source = 'amcinova-offertetool';
const orders = 'amcinova_offertetool_orders';
const paymentIdPattern = /^tr_[a-zA-Z0-9]{1,80}$/;
const orderIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });

export function verifyOffertetoolPayment(order, payment, mode) {
 const metadata = payment?.metadata;
 if (!order || order.mode !== mode || payment?.mode !== mode
   || !paymentIdPattern.test(payment.id) || (order.payment_id && order.payment_id !== payment.id)
   || metadata?.source !== source || metadata.product !== product
   || metadata.orderId !== order.id || metadata.userId !== order.user_id
   || payment.amount?.currency !== offertetoolPrice.currency || payment.amount?.value !== offertetoolPrice.value) {
  throw fail(409, 'De betaling hoort niet bij deze bestelling.');
 }
 return payment.status === 'paid'
   && (!payment.amountRefunded || payment.amountRefunded.value === '0.00')
   && (!payment.amountChargedBack || payment.amountChargedBack.value === '0.00');
}

export function registerOffertetoolCheckout(app, { json, form, env, identity, wrap, adminDb, fetchImpl }) {
 const liveKey = (env.AMCINOVA_MOLLIE_LIVE_API_KEY || '').trim();
 const testKey = (env.AMCINOVA_MOLLIE_TEST_API_KEY || '').trim();
 const allowedTestUsers = new Set((env.AMCINOVA_TEST_ACCESS_USERS || '').split(',').map(value => value.trim()));
 const liveEnabled = typeof adminDb === 'function' && env.AMCINOVA_OFFERTETOOL_CHECKOUT_ENABLED === 'true' && /^live_[a-zA-Z0-9]+$/.test(liveKey);
 const testEnabled = typeof adminDb === 'function' && env.AMCINOVA_OFFERTETOOL_CHECKOUT_TEST_ENABLED === 'true' && /^test_[a-zA-Z0-9]+$/.test(testKey);
 async function mollie(mode, path, body, idempotencyKey) {
  const key = mode === 'live' && liveEnabled ? liveKey : mode === 'test' && testEnabled ? testKey : null;
  if (!key) throw fail(503, 'Deze betaalroute is niet beschikbaar.');
  const response = await fetchImpl('https://api.mollie.com/v2/payments' + path, {
   method: body ? 'POST' : 'GET',
   headers: { Authorization: 'Bearer ' + key, ...(body && {
    'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey,
   }) },
   body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000), redirect: 'error',
  });
  if (!response.ok) throw fail(503, 'Mollie is tijdelijk niet beschikbaar.');
  return response.json();
 }
 const select = (query) => adminDb(orders, { method: 'GET', query: '?' + query + '&limit=1' });
 async function complete(order, payment) {
  const paid = verifyOffertetoolPayment(order, payment, order.mode);
  if (!paid) return false;
  if (!order.payment_id) throw fail(503, 'De betaalkoppeling wordt nog opgeslagen.');
  if (order.mode === 'test') {
   if (!testEnabled || !allowedTestUsers.has(order.user_id)) return false;
   const trial = await adminDb('rpc/amcinova_activate_test_access', {
    method: 'POST', body: { p_user: order.user_id, p_product: product, p_payment: payment.id },
   });
   return ['trial', 'already-created'].includes(trial?.status) && Date.parse(trial.expiresAt) > Date.now();
  }
  const purchase = await adminDb('rpc/amcinova_activate_offertetool', {
   method: 'POST',
   body: { p_order: order.id, p_payment: payment.id },
  });
  if (typeof purchase !== 'string' || !orderIdPattern.test(purchase)) throw fail(503, 'Toegang kon nog niet worden bevestigd.');
  return true;
 }
 app.post('/api/customer/offertetool-checkout', json({ limit: '2kb' }), wrap(async (req, res) => {
  const user = await identity(req);
  const mode = req.body?.test === true ? 'test' : 'live';
  if (mode === 'test' ? !testEnabled || !allowedTestUsers.has(user.id) : !liveEnabled) {
   throw fail(503, 'Deze betaalroute is niet beschikbaar.');
  }
  const id = req.body?.orderId;
  if (typeof id !== 'string' || !orderIdPattern.test(id)) throw fail(400, 'Ongeldig bestelnummer.');
  const query = 'id=eq.' + id + '&user_id=eq.' + user.id + '&mode=eq.' + mode;
  let [order] = await select(query);
  if (!order) {
   const rows = await adminDb(orders, { method: 'POST', query: '?on_conflict=id',
    body: { id, user_id: user.id, mode }, prefer: 'resolution=ignore-duplicates,return=representation' });
   order = rows?.[0] || (await select(query))[0];
  }
  if (!order) throw fail(409, 'Bestelling kon niet worden bevestigd.');
  const payment = order.payment_id ? await mollie(mode, '/' + order.payment_id) : await mollie(mode, '', {
   amount: offertetoolPrice, description: 'Amcinova Offertetool',
   redirectUrl: 'https://agents.amcinova.com/winkelmand.html?offertetoolorder=' + id
    + '&lang=' + (req.body?.language === 'en' ? 'en' : 'nl') + (mode === 'test' ? '&offertetooltest=1' : ''),
   webhookUrl: 'https://api.amcinova.com/api/customer/offertetool-checkout/webhook?mode=' + mode,
   metadata: { source, product, orderId: id, userId: user.id },
  }, 'amcinova-offertetool-' + mode + '-' + id);
  verifyOffertetoolPayment(order, payment, mode);
  if (!order.payment_id) {
   const updated = await adminDb(orders, { method: 'PATCH', query: '?' + query + '&payment_id=is.null',
    body: { payment_id: payment.id }, prefer: 'return=representation' });
   order = updated?.[0] || (await select(query))[0];
   if (order?.payment_id !== payment.id) throw fail(503, 'De betaalkoppeling kon niet worden opgeslagen.');
  }
  const checkoutUrl = ['open', 'pending'].includes(payment.status) ? payment._links?.checkout?.href : null;
  if (['open', 'pending'].includes(payment.status) && !/^https:\/\/(?:[a-z0-9-]+\.)?mollie\.com\//i.test(checkoutUrl || '')) throw fail(503, 'Ongeldige betaalpagina.');
  res.json({ ok: true, orderId: order.id, status: payment.status, checkoutUrl, accessGranted: await complete(order, payment) });
 }));
 app.get('/api/customer/offertetool-checkout/:id', wrap(async (req, res) => {
  const user = await identity(req);
  if (!orderIdPattern.test(req.params.id)) throw fail(400, 'Ongeldig bestelnummer.');
  if (!liveEnabled && !testEnabled) throw fail(503, 'Deze betaalroute is niet beschikbaar.');
  const [order] = await select('id=eq.' + req.params.id + '&user_id=eq.' + user.id);
  if (!order?.payment_id) throw fail(404, 'Betaling nog niet gevonden.');
  const payment = await mollie(order.mode, '/' + order.payment_id);
  res.json({ ok: true, status: payment.status, mode: order.mode, accessGranted: await complete(order, payment) });
 }));
 if (form) app.post('/api/customer/offertetool-checkout/webhook', form({ extended: false, limit: '2kb' }), wrap(async (req, res) => {
  const id = req.body?.id;
  if (typeof id !== 'string' || !paymentIdPattern.test(id)) throw fail(400, 'Ongeldig betalingsnummer.');
  const mode = req.query.mode === 'test' ? 'test' : 'live';
  if (mode === 'test' ? !testEnabled : !liveEnabled) throw fail(503, 'Deze betaalroute is niet beschikbaar.');
  const [order] = await select('payment_id=eq.' + id + '&mode=eq.' + mode);
  if (!order) throw fail(503, 'De betaalkoppeling wordt nog opgeslagen.');
  await complete(order, await mollie(mode, '/' + id));
  res.sendStatus(200);
 }));
 return { liveEnabled, testEnabled };
}
