import {createHmac, timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(x);
// Transport/storage ceiling chosen by this adapter, not a claimed Meta limit.
// Message IDs are opaque: preserve punctuation and never use as URL/file paths.
const validMessageId=x=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x,'utf8')<=1024&&!/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(x)&&x.trim().length>0;
export function verifyChallenge(query,verifyToken){
 if(typeof verifyToken!=='string'||verifyToken.length<16)throw fail(503,'Webhook not configured');
 if(query?.['hub.mode']!=='subscribe'||typeof query['hub.verify_token']!=='string'||!equal(query['hub.verify_token'],verifyToken))throw fail(403,'Invalid challenge');
 const challenge=query['hub.challenge'];if(typeof challenge!=='string'||!/^[0-9]{1,100}$/.test(challenge))throw fail(400,'Invalid challenge');return challenge;
}
export function verifyRawBody(raw,signature,appSecret,maxBytes=262144){
 if(!Buffer.isBuffer(raw))throw fail(400,'Raw Buffer required');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>1048576)throw fail(503,'Invalid size limit');
 if(raw.length>maxBytes)throw fail(413,'Payload too large');
 if(typeof appSecret!=='string'||appSecret.length<16)throw fail(503,'Webhook not configured');
 if(typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))throw fail(403,'Invalid signature');
 const expected='sha256='+createHmac('sha256',appSecret).update(raw).digest('hex');
 if(!equal(expected,signature))throw fail(403,'Invalid signature');
 try{return JSON.parse(raw.toString('utf8'));}catch{throw fail(400,'Invalid JSON');}
}
// store.insertReceiptOnce MUST atomically persist the receipt and enforce unique
// (tenantId, platform, accountId, messageId). Return true=inserted, false=duplicate.
// Do not implement this contract with a process-local Set or check-then-insert.
export function createDmWebhook({appSecret,conversationSecret,accounts,store,maxBytes=262144,resolveConfirmedPost,replyContextEnabled=false}){
 if(typeof conversationSecret!=='string'||conversationSecret.length<32||!Array.isArray(accounts)||!store||typeof store.insertReceiptOnce!=='function')throw fail(503,'Adapter not configured');
 const mapping=new Map();for(const a of accounts){
  if(!['facebook','instagram'].includes(a.platform)||!validId(a.accountId)||!validId(a.tenantId))throw fail(503,'Invalid mapping');
  const k=a.platform+':'+a.accountId;if(mapping.has(k))throw fail(503,'Ambiguous mapping');mapping.set(k,{...a,allowedPostIds:new Set(a.allowedPostIds||[])});
 }
 return async function receive(raw,signature){
  const payload=verifyRawBody(raw,signature,appSecret,maxBytes);
  const platform=payload?.object==='page'?'facebook':payload?.object==='instagram'?'instagram':null;
  if(!platform||!Array.isArray(payload.entry)||payload.entry.length>100)throw fail(400,'Unsupported envelope');
  const pending=[];
  for(const entry of payload.entry){
   const accountId=entry?.id;if(!validId(accountId))throw fail(400,'Invalid account');
   const account=mapping.get(platform+':'+accountId);if(!account)throw fail(403,'Unknown account');
   if(entry.messaging!==undefined&&!Array.isArray(entry.messaging))throw fail(400,'Invalid messaging');
   for(const event of entry.messaging||[]){
    if(pending.length>=500)throw fail(413,'Too many messages');
    const message=event?.message;
    if(!message||message.is_echo||event.delivery||event.read)continue;
    if(!validMessageId(message.mid)||!validId(event.sender?.id)||event.recipient?.id!==accountId||!Number.isSafeInteger(event.timestamp)||event.timestamp<0||event.timestamp>8640000000000000)throw fail(400,'Invalid message envelope');
    const conversationKey=createHmac('sha256',conversationSecret).update(JSON.stringify([account.tenantId,platform,accountId,event.sender.id])).digest('hex');
    let postId=null;
    if(resolveConfirmedPost){
     // Resolver must inspect an explicitly documented platform context. A general
     // referral/URL, user text, timestamp or sender identity is NOT post proof.
     const resolved=await resolveConfirmedPost({platform,accountId,tenantId:account.tenantId,event});
     if(resolved?.evidence==='confirmed_platform_context'&&typeof resolved.postId==='string'&&account.allowedPostIds.has(resolved.postId))postId=resolved.postId;
    }
    pending.push({tenantId:account.tenantId,platform,accountId,messageId:message.mid,conversationKey,receivedAt:new Date(event.timestamp).toISOString(),kind:'inbound_dm',qualifiedLead:false,postId,postEvidence:postId?'confirmed_platform_context':'unknown',...(replyContextEnabled?{senderId:event.sender.id,messageText:message.text}:{})});
   }
  }
  let inserted=0,duplicates=0;for(const receipt of pending){const result=await store.insertReceiptOnce(receipt);if(result===true)inserted++;else if(result===false)duplicates++;else throw fail(503,'Invalid persistent store result');}
  return {accepted:true,inserted,duplicates};
 };
}
