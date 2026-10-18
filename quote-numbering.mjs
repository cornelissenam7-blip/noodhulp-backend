import {createHash,randomUUID} from 'node:crypto';
const fault=(status,message)=>Object.assign(new Error(message),{status});
const scopeId=year=>{const h=createHash('sha256').update('krnn-number-register-v1:'+year).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
export async function saveNumberedQuote(row,user,db,now=new Date()){
 if(row.product_code!=='offertetool'||user.email.toLowerCase()!=='cornelissenam7@gmail.com')return (await db(user,'amcinova_customer_documents','',row))[0];
 const v=row.payload.values;
 if(v.krnnJobStatus!=='accepted')return (await db(user,'amcinova_customer_documents','',row))[0];
 const entered=(v.quoteNumber||'').trim(),match=/^KRNN[ -]+(20\d{2})-(\d{3,6})$/i.exec(entered);
 if(entered&&!match)throw fault(400,'Gebruik KRNN 2026-001, of maak het nummerveld leeg voor automatische nummering.');
 const year=match?Number(match[1]):Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Amsterdam',year:'numeric'}).format(now));
 const project=scopeId(year),query=`?user_id=eq.${user.id}&product_code=eq.offertetool&project_id=eq.${project}`;
 for(let attempt=0;attempt<10;attempt++){
  let number;
  if(match)number=Number(match[2]);
  else {const latest=await db(user,'amcinova_customer_documents',query+'&select=revision&order=revision.desc&limit=1');number=Math.max(year===2026?3:0,latest[0]?.revision||0)+1;}
  if(number<1||number>999999)throw fault(400,'Ongeldig KRNN-volgnummer.');
  const previous=await db(user,'amcinova_customer_documents',query+'&revision=eq.'+number+'&select=payload&limit=1');
  if(previous[0]&&previous[0].payload.numberReservation?.projectId!==row.project_id){if(!match)continue;throw fault(409,'Dit KRNN-nummer is al gebruikt voor een andere klus. Kies een ander nummer.');}
  const numbered={...row,name:`KRNN ${year}-${String(number).padStart(3,'0')}`,payload:{...row.payload,values:{...v,quoteNumber:`KRNN ${year}-${String(number).padStart(3,'0')}`}}};
  // A single PostgREST bulk insert is transactional. The existing unique project/revision
  // constraint reserves the number and saves the quote together, also across server instances.
  const reservation={id:randomUUID(),user_id:user.id,product_code:'offertetool',project_id:project,revision:number,name:'KRNN nummerregister',payload:{tracking:{kind:'quote-number-register'},numberReservation:{projectId:row.project_id,year,number}}};
  try {const saved=await db(user,'amcinova_customer_documents','',previous[0]?numbered:[reservation,numbered]);return saved.find(r=>r.id===row.id);}
  catch(e){if(e.status!==409||match)throw e;}
 }
 throw fault(409,'Er werd tegelijk opgeslagen. Probeer de offerte opnieuw op te slaan.');
}
