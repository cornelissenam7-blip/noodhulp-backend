// Amcinova testing is isolated from the existing GuardTap payment client.
export function createAmcinovaTestPayments({env=process.env,createClient}={}) {
 const key=(env.AMCINOVA_MOLLIE_TEST_API_KEY||'').trim();
 const ready=/^test_[A-Za-z0-9]{10,}$/.test(key);
 const client=ready?createClient({apiKey:key}):null;
 const unavailable=()=>Object.assign(new Error('Amcinova test payments are not configured.'),{status:503});
 return {
  ready,mode:ready?'test':'unconfigured',
  async create(config){
   if(!client)throw unavailable();
   return client.payments.create({...config,metadata:{...config.metadata,source:'amcinova',amcinovaTest:true}});
  },
  async get(id){
   if(!client)throw unavailable();
   if(typeof id!=='string'||!/^tr_[A-Za-z0-9]+$/.test(id))throw Object.assign(new Error('Invalid payment ID.'),{status:400});
   const payment=await client.payments.get(id);
   if(payment.mode!=='test'||payment.metadata?.source!=='amcinova'||payment.metadata?.amcinovaTest!==true)
    throw Object.assign(new Error('This payment does not belong to Amcinova testing.'),{status:404});
   return payment;
  }
 };
}
