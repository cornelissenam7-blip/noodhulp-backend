(()=>{
 const dashboard=document.querySelector('[data-admin-dashboard]');if(!dashboard)return;
 const section=document.createElement('section');section.className='admin-panel';section.id='workbook-requests';
 const heading=document.createElement('h2');heading.textContent='Werkboekaanvragen';const status=document.createElement('p');status.setAttribute('role','status');
 const explanation=document.createElement('p');explanation.textContent='Zonder daadwerkelijk vervolg: zes kalendermaanden vanaf de aanvraagdatum. Voorstel gewenst is geen vervolgstatus. Markeer alleen daadwerkelijk gestart vervolg en controleer dat uiterlijk binnen zes maanden opnieuw. Dit overzicht verwijdert geen gegevens.';
 const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Werkboekaanvragen vernieuwen';const next=document.createElement('button');next.type='button';next.textContent='Volgende pagina';next.hidden=true;
 const table=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr'),body=document.createElement('tbody');for(const label of ['Naam','E-mail','Hulpvraag','Voorstel gewenst','Aangemaakt','Bron','Maildienst','Vervolg','Termijn / controle','Beheer']){const th=document.createElement('th');th.textContent=label;tr.append(th);}head.append(tr);table.append(head,body);const scroll=document.createElement('div');scroll.style.overflowX='auto';scroll.append(table);section.append(heading,explanation,refresh,status,scroll,next);dashboard.append(section);
 const nav=document.querySelector('nav[aria-label="Admin navigatie"]');if(nav){const a=document.createElement('a');a.href='#workbook-requests';a.textContent='Werkboek';nav.append(a);}
 let offset=0,nextOffset=null,generation=0;
 function clear(){generation++;body.replaceChildren();next.hidden=true;status.textContent='';}
 const date=value=>value?new Date(value).toLocaleString('nl-NL'):'-';
 const deliveryLabels={pending:'Nog niet geaccepteerd',unconfigured:'Maildienst ontbreekt',sending:'Bezig / nog niet bevestigd',accepted:'Geaccepteerd door maildienst; inbox niet bevestigd',rejected:'Niet geaccepteerd',uncertain:'Onzeker: providercontrole nodig',not_recorded:'Geen bezorgingsstatus'};
 async function update(item,active,button){
  const key=window.localStorage.getItem('amcinovaAdminKey');if(!key||dashboard.hidden){clear();return;}
  let note='';if(active){note=window.prompt('Beschrijf het daadwerkelijk gestarte vervolg. Deel geen gevoelige persoonsgegevens.',item.followUpNote||'');if(note===null)return;if(!note.trim()||note.length>400){status.textContent='Beschrijf het vervolg in maximaal 400 tekens.';return;}}
  else if(!window.confirm('Vervolg stoppen? De oorspronkelijke termijn vanaf '+date(item.retention.startsAt)+' geldt weer. Er wordt nu niets verwijderd.'))return;
  button.disabled=true;const current=generation;
  try{const r=await fetch('https://api.amcinova.com/api/admin/workbook/'+encodeURIComponent(item.id)+'/follow-up',{method:'PATCH',headers:{'x-admin-key':key,'Content-Type':'application/json'},cache:'no-store',credentials:'omit',body:JSON.stringify({status:active?'active':'none',note,revision:item.revision})}),data=await r.json();if(current!==generation||dashboard.hidden)return;if(!r.ok||!data.ok)throw Error(data.error||'Wijziging mislukt.');await load(offset);}
  catch(e){if(current===generation)status.textContent=e.message;}finally{button.disabled=false;}
 }
 async function load(page=0){const key=window.localStorage.getItem('amcinovaAdminKey');if(!key||dashboard.hidden){clear();return;}const current=++generation;body.replaceChildren();next.hidden=true;status.textContent='Werkboekaanvragen ophalen.';refresh.disabled=true;
  try{const r=await fetch('https://api.amcinova.com/api/admin/workbook?offset='+page,{headers:{'x-admin-key':key},cache:'no-store',credentials:'omit'}),data=await r.json();if(current!==generation||dashboard.hidden)return;if(!r.ok||!data.ok)throw Error(data.error||'Opvragen mislukt.');offset=page;nextOffset=data.nextOffset;
   for(const item of data.requests){const row=document.createElement('tr'),retention=item.retention;const retentionText=retention.needsVerification?'Herkomst of vervolgstatus moet eerst worden geverifieerd; geen verwijderadvies.':retention.followUpStatus==='active'?(retention.reviewOverdue?'Controle achterstallig: ':'Vervolg controleren uiterlijk: ')+date(retention.followUpReviewAt):(retention.eligible?'Termijn verstreken; kandidaat voor latere verwijdercontrole: ':'Zonder vervolg bewaren tot: ')+date(retention.eligibleAt);
    for(const value of [item.name,item.email,item.help,item.proposalRequested?'Ja':'Nee',date(item.createdAt),item.source,deliveryLabels[item.deliveryStatus]||'Onbekend',retention.followUpStatus==='active'?'Actief vervolg: '+item.followUpNote:'Geen daadwerkelijk vervolg',retentionText]){const cell=document.createElement('td');cell.textContent=String(value||'-');row.append(cell);}
    const cell=document.createElement('td'),active=retention.followUpStatus==='active',mark=document.createElement('button');mark.type='button';mark.textContent=active?'Vervolg controleren / bevestigen':'Daadwerkelijk vervolg markeren';mark.disabled=!item.revision;mark.addEventListener('click',()=>update(item,true,mark));cell.append(mark);
    if(active){const stop=document.createElement('button');stop.type='button';stop.textContent='Vervolg stoppen';stop.addEventListener('click',()=>update(item,false,stop));cell.append(stop);}row.append(cell);body.append(row);
   }
   status.textContent=data.requests.length+' aanvragen op deze pagina. Automatische verwijdering staat uit.';next.hidden=nextOffset===null;
  }catch(e){if(current===generation){body.replaceChildren();status.textContent=e.message;}}finally{refresh.disabled=false;}
 }
 refresh.addEventListener('click',()=>load(0));next.addEventListener('click',()=>load(nextOffset));document.querySelector('[data-admin-refresh]')?.addEventListener('click',()=>load(0));document.querySelector('[data-admin-logout]')?.addEventListener('click',clear);
 new MutationObserver(()=>{if(dashboard.hidden)clear();else load(0);}).observe(dashboard,{attributes:true,attributeFilter:['hidden']});if(!dashboard.hidden)load(0);
})();
