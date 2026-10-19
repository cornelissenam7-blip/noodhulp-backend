export async function purgeExpiredMetaLogins(adminDb,now=Date.now()){
 const query='?expires_at=lt.'+encodeURIComponent(new Date(now).toISOString());
 for(const table of ['amcinova_meta_states','amcinova_meta_grants']){const rows=await adminDb(table,{method:'DELETE',query,prefer:'return=representation'});if(!Array.isArray(rows))throw Error('Login cleanup unavailable');}
 const contexts=await adminDb('amcinova_meta_reply_contexts',{method:'DELETE',query,prefer:'return=representation'});if(!Array.isArray(contexts))throw Error('Reply cleanup unavailable');
}
export function startMetaLoginRetention({env,adminDb,log=console.log}){
 if(env.AMCINOVA_META_CUSTOMER_ENABLED!=='true')return ()=>{};
 let running=false;
 const run=async()=>{if(running)return;running=true;try{await purgeExpiredMetaLogins(adminDb);}catch{log('[meta-login] expired login cleanup failed');}finally{running=false;}};
 const initial=setTimeout(run,1000),periodic=setInterval(run,600000);initial.unref?.();periodic.unref?.();return ()=>{clearTimeout(initial);clearInterval(periodic);};
}
