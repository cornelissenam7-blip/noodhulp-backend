// SMTP does not provide native deduplication. The route must acquire its durable
// database lease before calling send; uncertain outcomes must never auto-retry.
export function createWorkbookSmtpTransport({env=process.env,createTransport}={}) {
 const host=env.WORKBOOK_SMTP_HOST||'',port=Number(env.WORKBOOK_SMTP_PORT),user=env.WORKBOOK_SMTP_USER||'',pass=env.WORKBOOK_SMTP_PASSWORD||'';
 if(!/^[a-z0-9.-]+$/i.test(host)||![465,587].includes(port)||user!=='info@amcinova.com'||!pass||env.WORKBOOK_MAIL_FROM!=='info@amcinova.com')return undefined;
 return {requiresDurableLease:true,async send(message){
  if(message.signal?.aborted)return {accepted:false};
  const factory=createTransport||(await import('nodemailer')).default.createTransport;
  const smtp=factory({host,port,secure:port===465,requireTLS:true,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user,pass},pool:false,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:14000,dnsTimeout:10000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
  const stop=()=>smtp.close();message.signal?.addEventListener('abort',stop,{once:true});
  try {
   const receipt=await smtp.sendMail({from:message.from,to:message.to,subject:message.subject,text:message.text,attachments:message.attachments,messageId:'<'+message.idempotencyKey+'@amcinova.com>'});
   const accepted=receipt.accepted?.some(address=>String(address).toLowerCase()===message.to.toLowerCase());
   return accepted?{accepted:true,messageId:receipt.messageId}:{accepted:false,definitive:true};
  } catch(error) {
   // A response explicitly rejecting the single-recipient SMTP transaction is
   // safe to report as rejected. Connection failures/timeouts remain uncertain.
   return {accepted:false,definitive:Number(error.responseCode)>=400&&Number(error.responseCode)<=599};
  } finally {message.signal?.removeEventListener('abort',stop);smtp.close();}
 }};
}
