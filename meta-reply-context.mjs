import {createHash} from 'node:crypto';
import {tokenBox} from './meta-customer.mjs';
// Called only after webhook signature and connected-page ownership validation.
export async function saveReplyContext(adminDb,env,receipt,now=Date.now()){
 if(env.AMCINOVA_META_REPLY_ENABLED!=='true'||receipt.platform!=='facebook')return;
 const age=now-Date.parse(receipt.receivedAt);
 if(!Number.isFinite(age)||age<0||age>=86400000)return;
 if(typeof receipt.senderId!=='string'||!/^\d{1,40}$/.test(receipt.senderId))throw Error('Invalid reply sender');
 const replyKey=createHash('sha256').update(JSON.stringify([receipt.tenantId,receipt.accountId,receipt.messageId])).digest('hex');
 const context={recipient:receipt.senderId,text:typeof receipt.messageText==='string'?receipt.messageText.slice(0,2000):'[Bijlage]'};
 const cipher=tokenBox(env.AMCINOVA_META_TOKEN_KEY).seal(JSON.stringify(context),receipt.tenantId+':'+receipt.accountId+':'+replyKey);
 const rows=await adminDb('amcinova_meta_reply_contexts',{method:'POST',query:'?on_conflict=reply_key',prefer:'resolution=ignore-duplicates,return=representation',body:{reply_key:replyKey,tenant_id:receipt.tenantId,page_id:receipt.accountId,context_cipher:cipher,message_at:receipt.receivedAt,expires_at:new Date(Date.parse(receipt.receivedAt)+86400000).toISOString()}});
 if(!Array.isArray(rows))throw Error('Reply storage unavailable');
}
