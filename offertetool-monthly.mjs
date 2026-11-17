export const monthlyServiceAmount = Object.freeze({ currency: 'EUR', value: '22.99' });
const source = 'amcinova-offertetool-monthly';
const validCustomerId = /^cst_[A-Za-z0-9]{1,80}$/;
const validSubscriptionId = /^sub_[A-Za-z0-9]{1,80}$/;
const validPaymentId = /^tr_[A-Za-z0-9]{1,80}$/;

export function nextMonthlyCharge(date) {
 const original = new Date(date);
 if (!Number.isFinite(original.valueOf())) throw new Error('Invalid payment date.');
 const year = original.getUTCFullYear();
 const month = original.getUTCMonth();
 const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
 return new Date(Date.UTC(year, month + 1, Math.min(original.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

function matchingPayment(order, payment) {
 return validCustomerId.test(order?.customerId) && validPaymentId.test(payment?.id)
  && payment.mode === order.mode && payment.customerId === order.customerId
  && payment.amount?.currency === monthlyServiceAmount.currency
  && payment.amount?.value === monthlyServiceAmount.value
  && payment.metadata?.source === source && payment.metadata?.orderId === order.id
  && payment.metadata?.userId === order.userId;
}

function settledPayment(payment) {
 return payment.status === 'paid' && Number.isFinite(Date.parse(payment.paidAt))
  && (!payment.amountRefunded || payment.amountRefunded.value === '0.00')
  && (!payment.amountChargedBack || payment.amountChargedBack.value === '0.00');
}

export function monthlyMandatePayment(order, redirectUrl, webhookUrl) {
 if (!order.consentAt || !Number.isFinite(Date.parse(order.consentAt)) || !validCustomerId.test(order.customerId)) {
  throw new Error('Monthly billing requires recorded customer consent and a Mollie customer.');
 }
 return {
  customerId: order.customerId, sequenceType: 'first', amount: monthlyServiceAmount,
  description: 'Amcinova Offertetool maandservice', redirectUrl, webhookUrl,
  metadata: { source, orderId: order.id, userId: order.userId },
 };
}

export function monthlySubscriptionRequest(order, firstPayment, mandate, webhookUrl) {
 if (!matchingPayment(order, firstPayment) || !settledPayment(firstPayment)
  || firstPayment.id !== order.firstPaymentId || firstPayment.sequenceType !== 'first'
  || !/^mdt_[A-Za-z0-9]{1,80}$/.test(firstPayment.mandateId)
  || mandate?.id !== firstPayment.mandateId || mandate.status !== 'valid') {
  throw new Error('A confirmed first payment and a valid mandate are required.');
 }
 return {
  mandateId: mandate.id, amount: monthlyServiceAmount, interval: '1 month',
  startDate: nextMonthlyCharge(firstPayment.paidAt),
  description: 'Amcinova Offertetool maandservice', webhookUrl, metadata: firstPayment.metadata,
 };
}

export function verifiedMonthlyRenewal(order, payment) {
 return matchingPayment(order, payment) && settledPayment(payment)
  && validSubscriptionId.test(order.subscriptionId) && order.subscriptionId === payment.subscriptionId
  && payment.sequenceType === 'recurring';
}
