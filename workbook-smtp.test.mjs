import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbookSmtpTransport} from './workbook-smtp.mjs';
const env={WORKBOOK_SMTP_HOST:'smtp.example.invalid',WORKBOOK_SMTP_PORT:'465',WORKBOOK_SMTP_USER:'info@amcinova.com',WORKBOOK_SMTP_PASSWORD:'fixture-only',WORKBOOK_MAIL_FROM:'info@amcinova.com'};
const message={from:'info@amcinova.com',to:'recipient@example.invalid',subject:'Test',text:'Fixture',attachments:[],idempotencyKey:'fixture',signal:new AbortController().signal};
test('SMTP remains disabled without complete settings or approved mailbox',()=>{
 for(const patch of [{WORKBOOK_SMTP_PASSWORD:''},{WORKBOOK_SMTP_PORT:'25'},{WORKBOOK_SMTP_HOST:'bad/host'},{WORKBOOK_MAIL_FROM:'other@example.invalid'},{WORKBOOK_SMTP_USER:'other@example.invalid'}])assert.equal(createWorkbookSmtpTransport({env:{...env,...patch}}),undefined);
});
test('SMTP uses TLS, no private debug logs, one recipient and closes connection',async()=>{
 let options,sent,closed=0;const transport=createWorkbookSmtpTransport({env,createTransport:o=>{options=o;return{sendMail:async m=>{sent=m;return{accepted:[m.to],messageId:'fixture-receipt'};},close:()=>closed++};}});
 assert.equal(transport.supportsIdempotency,undefined);assert.equal(transport.requiresDurableLease,true);
 assert.deepEqual(await transport.send(message),{accepted:true,messageId:'fixture-receipt'});assert.equal(options.secure,true);assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.debug,false);assert.equal(sent.to,message.to);assert.equal(sent.messageId,'<fixture@amcinova.com>');assert.equal(closed,1);
});
test('SMTP timeout stays uncertain; explicit SMTP rejection is definitive',async()=>{
 for(const [error,definitive] of [[new Error('private fixture'),false],[Object.assign(new Error('rejected'),{responseCode:550}),true]]){
  const transport=createWorkbookSmtpTransport({env:{...env,WORKBOOK_SMTP_PORT:'587'},createTransport:o=>{assert.equal(o.secure,false);assert.equal(o.requireTLS,true);return{sendMail:async()=>{throw error;},close(){}};}});
  assert.deepEqual(await transport.send(message),{accepted:false,definitive});
 }
});
