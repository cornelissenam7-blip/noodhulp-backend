import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbookMailAdapter} from './workbook-mail.mjs';
import {createWorkbookRelayTransport} from './workbook-relay.mjs';
import {validateWorkbook} from './workbook-routes.mjs';
import {fileURLToPath} from 'node:url';
const id='12345678-1234-4123-8123-123456789abc';
test('English delivery uses English subject, attachment name and signed locale',async()=>{
 let message,payload;
 const relay=createWorkbookRelayTransport({env:{WORKBOOK_RELAY_URL:'https://amcinova.com/workbook-relay.php',WORKBOOK_RELAY_SECRET:'test'.repeat(8),WORKBOOK_MAIL_FROM:'info@amcinova.com'},fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,text:async()=>JSON.stringify({accepted:true,messageId:'workbook-'+id})}}});
 const mail=createWorkbookMailAdapter({from:'info@amcinova.com',transport:{requiresDurableLease:true,send:async m=>{message=m;return relay.send(m)}}});
 const result=await mail.send({to:'TEST-language@example.invalid',requestId:id,language:'en',file:fileURLToPath(new URL('./Amcinova-from-idea-to-online-customers.pdf',import.meta.url))});
 assert.equal(result.accepted,true);assert.equal(message.subject,'Your Amcinova workbook');assert.match(message.text,/does not subscribe/);assert.equal(message.attachments[0].filename,'Amcinova-from-idea-to-online-customers.pdf');assert.equal(payload.language,'en');
});
test('English request retains locale; legacy Dutch validation remains compatible',()=>{
 const body={name:'TEST',email:'test@example.invalid',proposal:false,requestId:id};
 assert.equal(validateWorkbook({...body,language:'en'}).language,'en');assert.equal(Object.hasOwn(validateWorkbook(body),'language'),false);
});
