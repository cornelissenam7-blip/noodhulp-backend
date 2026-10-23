(()=>{'use strict';let context,version='',renderNumber=0;const el=(tag,value)=>{const n=document.createElement(tag);n.textContent=value||'';return n;};
const money=c=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(c/100);
function download(data,name){const a=el('a');a.href=data;a.download=name;a.click();}
function blobDownload(blob,name){const url=URL.createObjectURL(blob);download(url,name);setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function run(fn){context.lock(true);try{await fn();}catch(e){context.status(e.message);}finally{context.lock(false);}}
async function results(box){const p=context.project();try{const r=await context.call('/'+p.id+'/results');box.replaceChildren(el('h3','Verkoopterugkoppeling'),el('p',r.totals.orders+' gewone betaalde bestellingen · '+money(r.totals.netCents)+' na terugbetalingen'),el('p',r.totals.testOrders+' proefbestellingen — apart van de omzet'));for(const c of r.campaigns||[])if(c.testOrders)box.append(el('p','Proefomzet ontvangen: '+money(c.testNetCents)));for(const note of r.recommendations||[])box.append(el('p',note));if(r.limited)box.append(el('p','Dit rapport is begrensd; niet alle oudere bestellingen zijn inbegrepen.'));}catch(e){box.replaceChildren(el('h3','Verkoopterugkoppeling'),el('p',e.message));}}
async function render(project){
 if(!context)return;const host=document.getElementById('delivery');if(!host)return;host.hidden=false;
 if(version===project.id+':'+project.revision)return;version=project.id+':'+project.revision;const current=++renderNumber;host.replaceChildren(el('h2','Van concept naar een echte verkoopproef'));
 const prepare=el('button',project.delivery?'Proefpakket opnieuw voorbereiden':'Maak privé proefpakket met echte productbeelden');prepare.onclick=()=>run(async()=>{context.status('Productbeeld ophalen en ondertekende proeflinks voorbereiden…');context.update(await context.call('/'+project.id+'/package',{revision:project.revision}));context.status('Privé proefpakket opgeslagen. Er is niets gepubliceerd.');});host.append(prepare);
 if(!project.delivery){host.append(el('p','Na de vier agentstappen worden productbeelden, berichten en campagnelinks hier samengebracht.'));return;}
 const bundle=project.delivery.bundle,assets=project.delivery.assets;
 host.append(el('p','Privé voorbeeld · geen advertentiebudget besteed · geen openbare publicatie'),el('p','Het productbeeld komt van de eigen website. De opmaak wordt door AdMaker samengesteld.'));
 const grid=el('div');grid.className='delivery-grid';host.append(grid);
 for(const v of bundle.variants){
  if(current!==renderNumber)return;const card=el('article');card.className='delivery-card';card.append(el('small',v.channel+' · '+v.id),el('h3',v.headline));grid.append(card);
  const source=assets[v.assetRef]?.image;let poster=source;
  if(source){try{poster=await window.AmcinovaMarketingVisual.render({image:source,headline:v.visual.headline||v.headline,subtitle:v.visual.subtitle,company:project.name,format:'portrait'});}catch(e){card.append(el('p','Opmaak nog niet afgerond: '+e.message));}
   const image=el('img');image.src=poster;image.alt='Advertentievoorbeeld '+v.headline;card.append(image);const save=el('button','Afbeelding downloaden');save.onclick=()=>download(poster,'amcinova-'+v.id+'.jpg');card.append(save);
  }
  const details=el('details');details.append(el('summary',v.requiresVideoRender?'Videoscript en begeleidende tekst':'Berichttekst'),el('pre',v.caption));card.append(details);
  if(v.requiresVideoRender)card.append(el('p','Videoscript gereed; video en eventuele stem zijn nog niet gemaakt of goedgekeurd.'));
  for(const warning of v.warnings||[])card.append(el('small',warning));
  const link=el('a','Open deze proefroute naar de webshop');link.href=v.trackingURL;link.target='_blank';link.rel='noopener noreferrer';card.append(link);
 }
 const exportButton=el('button','Privé pakket downloaden (HTML)');exportButton.onclick=()=>run(async()=>{
  const session=await window.AmcinovaSession.get(),response=await fetch(context.api+'/api/customer/marketing-projects/'+project.id+'/package/export',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});if(!response.ok)throw Error('Export kon niet worden opgehaald.');blobDownload(await response.blob(),'amcinova-prive-proefpakket.html');
 });host.append(exportButton);
 const report=el('section'),refresh=el('button','Controleer verkopen uit deze campagne');refresh.onclick=()=>run(()=>results(report));host.append(refresh,report);await results(report);
}
window.AmcinovaDelivery={configure:options=>{context=options;},render};})();
