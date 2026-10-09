import {readFile} from 'node:fs/promises';
const email=/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
// Contract for a future approved provider implementation. No provider, credentials,
// network destination or sender is invented here. Native provider idempotency is required.
export function createWorkbookMailAdapter({from='',transport,timeoutMs=15000}={}){
 const ready=()=>email.test(from)&&from.length<=254&&(transport?.supportsIdempotency===true||transport?.requiresDurableLease===true)&&typeof transport.send==='function';
 return {
  get ready(){return ready();},
  async send({to,file,requestId}){
   if(!ready())return {accepted:false,state:'unconfigured'};
   if(!email.test(to)||to.length>254)return {accepted:false,state:'rejected'};
   let bytes;try{bytes=await readFile(file);if(bytes.length>10*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')return {accepted:false,state:'rejected'};}catch{return {accepted:false,state:'rejected'};}
   let timer;
   try{
    const timeout=Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=15000?timeoutMs:15000;
    const receipt=await Promise.race([transport.send({from,to,subject:'Je Amcinova-werkboek',text:'Hier is het door jou aangevraagde werkboek Van idee naar online klanten. Je vindt de PDF in de bijlage. Deze aanvraag schrijft je niet in voor marketingmails.',attachments:[{filename:'Amcinova-van-idee-naar-online-klanten.pdf',contentType:'application/pdf',content:bytes}],idempotencyKey:'amcinova-workbook-v3-'+requestId,signal:AbortSignal.timeout(timeout)}),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeout);})]);
    if(receipt?.accepted===true&&typeof receipt.messageId==='string'&&receipt.messageId.length>0&&receipt.messageId.length<=200)return {accepted:true,state:'accepted',messageId:receipt.messageId};
    return {accepted:false,state:receipt?.accepted===false&&receipt?.definitive===true?'rejected':'uncertain'};
   }catch{return {accepted:false,state:'uncertain'};}finally{clearTimeout(timer);}
  }
 };
}
