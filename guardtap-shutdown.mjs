// GuardTap was withdrawn by the owner. Shared Amcinova routes stay available.
const stoppedPaths = new Set([
  '/api/pay', '/mollie/create-payment', '/mollie/return',
  '/api/sos', '/api/subscribe', '/api/affiliate-payout',
]);
const legacyWebhooks = new Set(['/api/webhook', '/api/subscription-webhook', '/mollie/webhook']);
export function guardTapShutdown(req, res, next) {
  const route = req.path.replace(/\/+$/, '') || '/';
  if (route === '/api/guardtap/status') {
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, service: 'GuardTap', enabled: false, newPaymentsEnabled: false });
  }
  if (legacyWebhooks.has(route)) {
    // Acknowledge old notifications without creating new subscriptions/access.
    return res.status(200).json({ ok: true, service: 'GuardTap', disabled: true });
  }
  if (stoppedPaths.has(route) || /^\/api\/(?:referrals\/|guardtap(?:\/|$))/.test(route)) {
    res.set('Cache-Control', 'no-store');
    return res.status(410).json({
      ok: false, code: 'GUARDTAP_STOPPED',
      error: 'GuardTap is buiten gebruik. Aanmelden, betalen en SOS-verzoeken via GuardTap zijn uitgeschakeld. Bel bij direct gevaar 112.',
    });
  }
  return next();
}
