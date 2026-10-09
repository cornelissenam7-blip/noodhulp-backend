import {createHmac} from 'node:crypto';
export function createWorkbookRelayTransport({env=process.env,fetchImpl=globalThis.fetch,now=Date.now}={}){
 const url=env.WORKBOOK_RELAY_URL||'',secret=env.WORKBOOK_RELAY_SECRET||'';
 if(url!=='https://amcinova.com/workbook-relay.php'||secret.length<32||env.WORKBOOK_MAIL_FROM!=='info@amcinova.com')return undefined;
 return {requiresDurableLease:true,async send(message){
  const id=message.idempotencyKey?.replace(/^amcinova-workbook-v3-/,'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||''))return {accepted:false,definitive:true};
  const body=JSON.stringify({id,to:message.to});const stamp=String(Math.floor(now()/1000));
  const signature=createHmac('sha256',secret).update(stamp+'\n'+body).digest('hex');
  try{
   const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:message.signal,headers:{'Content-Type':'application/json','X-Amcinova-Time':stamp,'X-Amcinova-Signature':signature},body});
   const raw=await response.text();if(raw.length>2048)return {accepted:false};
   const receipt=JSON.parse(raw);
   if(response.ok&&receipt.accepted===true&&receipt.messageId==='workbook-'+id)return {accepted:true,messageId:receipt.messageId};
   return {accepted:false,definitive:receipt.state==='rejected'&&[400,401,409,422,503].includes(response.status)};
  }catch{return {accepted:false};}
 }};
}
