const fault=(status,message)=>Object.assign(Error(message),{status});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const products=new Set(['sitebuilder','offertetool','planner','shophulp','campaign','admaker','promotie']);
export const testPacks=Object.freeze([{units:25,netCents:900,grossCents:1089},{units:100,netCents:2900,grossCents:3509}]);
// This model deliberately cannot create a commercial purchase or subscription.
export function testBillingRequest(body,user){
 if(!uuid.test(body?.id)||!products.has(body?.product))throw fault(400,'Kies een geldig product en aanvraagnummer.');
 const pack=testPacks.find(p=>p.units===body.units);if(!pack)throw fault(400,'Kies 25 of 100 testaanvragen.');
 return {id:body.id,user_id:user.id,product_code:body.product,units:pack.units,amount_cents:pack.grossCents,currency:'EUR',policy:'test-topup-20261010',status:'TEST',payment_id:null};
}
export function verifyTestTopup(payment,row,user){
 const canonical=testBillingRequest({id:row.id,product:row.product_code,units:row.units},user);
 if(row.user_id!==user.id||row.policy!==canonical.policy||row.amount_cents!==canonical.amount_cents||row.currency!=='EUR')throw fault(409,'Deze testaanvraag komt niet overeen.');
 const m=payment.metadata;
 if(payment.mode!=='test'||m?.source!=='amcinova'||m.amcinovaTest!==true||m.purpose!=='credit-topup-test'||m.requestId!==row.id||m.userId!==user.id||m.product!==row.product_code||m.units!==row.units||payment.amount?.currency!=='EUR'||payment.amount.value!==(row.amount_cents/100).toFixed(2)||!/^tr_[A-Za-z0-9]+$/.test(payment.id)||row.payment_id&&row.payment_id!==payment.id)throw fault(409,'Testbetaling hoort niet bij deze tegoedaanvraag.');
 if(!['open','pending','paid','failed','canceled','expired','authorized'].includes(payment.status))throw fault(503,'Onbekende betaalstatus.');
 if(Number(payment.amountRefunded?.value||0)>0||Number(payment.amountChargedBack?.value||0)>0)throw fault(409,'Teruggedraaide testbetaling geeft geen extra tegoed.');
 return {id:payment.id,status:payment.status,mode:'test',units:row.units,amount:payment.amount};
}
export async function startTestTopup({row,user,payments,save}){
 if(row.payment_id){const payment=await payments.get(row.payment_id);verifyTestTopup(payment,row,user);return payment;}
 const canonical=testBillingRequest({id:row.id,product:row.product_code,units:row.units},user);
 if(row.user_id!==user.id||row.policy!==canonical.policy||row.amount_cents!==canonical.amount_cents)throw fault(409,'Testbedrag wijkt af.');
 const payment=await payments.create({amount:{currency:'EUR',value:(canonical.amount_cents/100).toFixed(2)},description:'TEST Amcinova AI-tegoed '+row.id,idempotencyKey:'amcinova-topup-'+row.id,redirectUrl:'https://agents.amcinova.com/account.html?testtopup='+row.id,metadata:{purpose:'credit-topup-test',requestId:row.id,userId:user.id,product:row.product_code,units:row.units}});
 verifyTestTopup(payment,row,user);await save(payment.id);return payment;
}
export function testBillingAllowed(env,user){return env.AMCINOVA_TEST_BILLING_ENABLED==='true'&&String(env.AMCINOVA_TEST_ACCESS_USERS||'').split(',').map(s=>s.trim()).includes(user.id);}
