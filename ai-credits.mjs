// Only the backend may reserve or return credits. Never expose its service key.
export function creditClient({env=process.env,fetchImpl=fetch}={}){
 const enabled=env.CUSTOMER_AI_CREDITS_ENABLED==='true';
 async function rpc(name,body){
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)throw Object.assign(Error('AI-tegoed is tijdelijk niet beschikbaar.'),{status:503});
  const r=await fetchImpl(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Object.assign(Error('AI-tegoed kon niet worden gecontroleerd. Er is geen nieuwe AI-aanvraag gestart.'),{status:503});
  return r.json();
 }
 const client={enabled,async reserve(user,product,id){
  if(!enabled)throw Object.assign(Error('AI-generatie voor klantaccounts wacht op activering van gebruikslimieten. Je invoer en gewone berekeningen blijven beschikbaar.'),{status:503});
  const ok=await rpc('amcinova_credit_reserve',{p_user:user,p_product:product,p_request:id});
  if(ok!==true&&ok!==false)throw Object.assign(Error('AI-tegoed gaf een ongeldige reactie. Er is geen nieuwe AI-aanvraag gestart.'),{status:503});
  if(!ok)throw Object.assign(Error('Je AI-tegoed is op. Je bewaarde projecten blijven beschikbaar. Extra tegoed is binnenkort aan te vragen via Mijn Amcinova.'),{status:402});
 },async refund(id){if(enabled)await rpc('amcinova_credit_refund',{p_request:id});},
 async complete(id){if(enabled)await rpc('amcinova_credit_complete',{p_request:id});}};
 client.run=async(user,product,id,operation)=>{
  try{await client.reserve(user,product,id);}catch(e){
   // A timed-out reservation may have committed. No provider has started yet.
   if(enabled&&e.status!==402)try{await client.refund(id);}catch{console.error('AI credit reservation requires reconciliation',id);}
   throw e;
  }
  let result;
  try{result=await operation();}catch(e){
   try{await client.refund(id);}catch{console.error('AI credit refund requires reconciliation',id);}
   throw e;
  }
  // A successful generation must not become free if its accounting update fails.
  try{await client.complete(id);}catch{console.error('AI credit completion requires reconciliation',id);}
  return result;
 };
 return client;
}
