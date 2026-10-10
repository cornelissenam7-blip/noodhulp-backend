import {verifyCartPayment} from './cart-test-payment.mjs';
export async function adminTestPayment(order,payments){
 if(!order.estimate?.testPaymentId)return {state:'not_started'};
 if(!payments?.ready)return {state:'unavailable'};
 try{
  const payment=await payments.get(order.estimate.testPaymentId);
  return {state:'verified',...verifyCartPayment(payment,order,{id:order.user_id})};
 }catch{return {state:'unavailable'};}
}
