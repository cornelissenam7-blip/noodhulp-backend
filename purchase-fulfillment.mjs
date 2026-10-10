// Prepared for one-time self-build/quote purchases only. Not wired to a live route.
// The saved order is server-owned; provider data must be re-fetched by payment ID.
import {testOrder} from './test-order-model.mjs';
import {commercialPolicy} from './commercial-readiness.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reject=message=>{throw Object.assign(Error(message),{status:409});};
export function verifiedPurchase(order,payment,user){
 if(!uuid.test(user?.id)||order?.user_id!==user.id||!uuid.test(order?.id))reject('Order owner is not verified.');
 if(order.selected?.length!==1||!['sitebuilder','offertetool'].includes(order.selected[0])||order.payment_method!=='once'||order.estimate?.siteService!==0||order.estimate?.quoteService!==0||(order.selected[0]==='sitebuilder'&&order.estimate.sitePackage!=='self'))reject('This purchase requires a separate service agreement.');
 const canonical=testOrder({id:order.id,selected:order.selected,method:'once',terms:order.terms,siteService:0,quoteService:0,sitePackage:'self',campaignPlan:'setup',priceVersion:order.estimate.priceVersion},user);
 const product=order.selected[0],amount=(canonical.estimate.gross/100).toFixed(2);
 if(order.estimate.priceVersion!=='proposal-20261010-quote'||order.estimate.gross!==canonical.estimate.gross||payment?.mode!=='live'||payment.status!=='paid'||payment.id!==order.provider_payment_id||payment.amount?.currency!=='EUR'||payment.amount?.value!==amount||payment.metadata?.source!=='amcinova-commercial'||payment.metadata?.userId!==user.id||payment.metadata?.orderId!==order.id||payment.metadata?.product!==product)reject('Payment does not match this live purchase.');
 if(payment.amountRefunded&&payment.amountRefunded.value!=='0.00'||payment.amountChargedBack&&payment.amountChargedBack.value!=='0.00')reject('Refunded or charged-back payments cannot activate access.');
 return {p_user:user.id,p_product:product,p_payment:payment.id,p_amount:canonical.estimate.gross,p_units:commercialPolicy.products[product].startCredits,p_policy:commercialPolicy.version};
}
export async function fulfillPurchase({order,user,provider,activate,approved=false}){
 if(approved!==true)throw Object.assign(Error('Commercial activation is not enabled.'),{status:503});
 const payment=await provider.get(order.provider_payment_id);
 const verified=verifiedPurchase(order,payment,user);
 return activate(verified); // Must be the atomic, idempotent SQL RPC, never client-side writes.
}
