import {testOrder} from './test-order-model.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function cartPaymentAmount(order,user){
 if(order.user_id!==user.id||order.status!=='TEST')throw fail(404,'Testaanvraag niet gevonden.');
 const canonical=testOrder({id:order.id,selected:order.selected,method:order.payment_method,terms:order.terms,quoteService:order.estimate.quoteService,siteService:order.estimate.siteService},user);
 if(order.estimate.priceVersion!==canonical.estimate.priceVersion||order.estimate.first!==canonical.estimate.first)throw fail(409,'De opgeslagen proefprijs wijkt af. Maak een nieuwe testaanvraag.');
 if(canonical.estimate.first<1)throw fail(400,'Geen testbedrag om te betalen.');
 return {currency:'EUR',value:(canonical.estimate.first/100).toFixed(2)};
}
export function verifyCartPayment(payment,order,user){
 const amount=cartPaymentAmount(order,user);
 if(payment.mode!=='test'||payment.metadata?.source!=='amcinova'||payment.metadata?.amcinovaTest!==true||payment.metadata?.orderId!==order.id||payment.metadata?.userId!==user.id||payment.amount?.currency!==amount.currency||payment.amount?.value!==amount.value)throw fail(409,'Testbetaling komt niet overeen met deze winkelmand.');
 if(!['open','pending','paid','failed','canceled','expired','authorized'].includes(payment.status))throw fail(503,'Betaalstatus nog niet beschikbaar.');
 return {id:payment.id,status:payment.status,mode:'test',amount,productAccessGranted:false};
}
export async function startCartPayment({order,user,payments,save}){
 const amount=cartPaymentAmount(order,user);
 if(order.estimate.testPaymentId){const payment=await payments.get(order.estimate.testPaymentId);verifyCartPayment(payment,order,user);return payment;}
 const payment=await payments.create({amount,description:'TEST Amcinova winkelmand '+order.id,idempotencyKey:'amcinova-cart-'+order.id,redirectUrl:'https://agents.amcinova.com/winkelmand.html?testorder='+order.id,webhookUrl:'https://api.amcinova.com/api/amcinova/payments/webhook',metadata:{orderId:order.id,userId:user.id}});
 verifyCartPayment(payment,order,user);
 // Provider idempotency protects concurrent requests and retries after a failed database write.
 await save({...order.estimate,testPaymentId:payment.id});
 return payment;
}
