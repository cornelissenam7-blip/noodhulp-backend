import {verifyCartPayment} from './cart-test-payment.mjs';
// Deliberately separate from commercial purchase fulfillment.
export async function activateTestAccess({env=process.env,order,user,payment,fetchImpl=fetch}){
 const verified=verifyCartPayment(payment,order,user);
 const allowed=String(env.AMCINOVA_TEST_ACCESS_USERS||'').split(',').map(x=>x.trim());
 if(env.AMCINOVA_TEST_ACCESS_ENABLED!=='true'||!allowed.includes(user.id)||verified.status!=='paid')return [];
 if(payment.id!==order.estimate.testPaymentId||Number(payment.amountRefunded?.value||0)>0||Number(payment.amountChargedBack?.value||0)>0)throw Object.assign(Error('Testbetaling is niet geldig voor proeftoegang.'),{status:409});
 if(!env.SUPABASE_SERVICE_ROLE_KEY||!env.SUPABASE_URL)throw Object.assign(Error('Proeftoegang is nog niet beschikbaar.'),{status:503});
 const result=[];
 for(const product of order.selected.filter(p=>['sitebuilder','offertetool'].includes(p))){
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  const r=await fetchImpl(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/amcinova_activate_test_access',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_user:user.id,p_product:product,p_payment:payment.id}),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Object.assign(Error('Proeftoegang kon niet worden bevestigd. Controleer dezelfde testbetaling opnieuw.'),{status:503});
  result.push({product,...await r.json()});
 }
 return result;
}
