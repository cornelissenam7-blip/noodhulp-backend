import {createHmac} from 'node:crypto';
const day=86400000;
export function normalizeAttribution(a){
 if(!a)return {available:false,reason:'Nog geen aankoopkoppeling ontvangen.'};
 if(a.version!==1||a.model!=='consented-package-origin-7-days'||a.complete!==true||a.needsReview)return {available:false,reason:'Aankoopkoppeling ontbreekt of vereist controle; geen nulmeting.'};
 const fields=['paidOrders','refundedOrders','grossItemsCents','refundedItemsCents','netItemsCents'];
 const rows=(list,product=false)=>{if(!Array.isArray(list)||list.length>40)throw Error('growth-invalid-attribution');return list.map(r=>{if(!/^[A-Z]{3}$/.test(r.currency)||!fields.every(k=>Number.isSafeInteger(r[k])&&r[k]>=0)||r.refundedOrders>r.paidOrders||r.refundedItemsCents>r.grossItemsCents||r.netItemsCents!==r.grossItemsCents-r.refundedItemsCents||(product&&![69,70].includes(r.productId)))throw Error('growth-invalid-attribution');return Object.fromEntries([...(product?['productId']:[]),'currency',...fields].map(k=>[k,r[k]]));});};
 const currencies=rows(a.currencies),products=rows(a.products,true);
 if(new Set(currencies.map(r=>r.currency)).size!==currencies.length||new Set(products.map(r=>r.productId+'|'+r.currency)).size!==products.length)throw Error('growth-duplicate-attribution');
 for(const c of currencies)for(const key of ['grossItemsCents','refundedItemsCents','netItemsCents'])if(products.filter(p=>p.currency===c.currency).reduce((s,p)=>s+p[key],0)!==c[key])throw Error('growth-attribution-mismatch');
 if(products.some(p=>!currencies.some(c=>c.currency===p.currency)))throw Error('growth-attribution-mismatch');
 return {available:true,model:a.model,startedAt:typeof a.startedAt==='string'&&Number.isFinite(Date.parse(a.startedAt))?a.startedAt:null,currencies,products};
}
export function cycleWindows(now=Date.now()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const end=Date.parse(today)-day,iso=n=>new Date(n).toISOString().slice(0,10);
 return [{start:iso(end-13*day),end:iso(end-7*day)},{start:iso(end-6*day),end:iso(end)}];
}
export function normalizeCycle(data,{start,end}){
 const c=data?.growthCycle;
 if(data?.host!=='shop.amcinova.com'||data.complete!==true||data.needsReview||data.start!==start||data.end!==end||c?.version!==1||c.start!==start||c.end!==end||!c.metrics||Array.isArray(c.metrics))throw Error('growth-report-incomplete');
 const metrics={};
 for(const [key,n] of Object.entries(c.metrics)){
  if(!/^(package_view|read_(compact|full)|download_(compact|full)|offer_(69|70)|feedback_(used|viewed)_[1-4]_(clear|help|unclear)_(none|instructions|space|duration|difficulty))$/.test(key))continue;
  if(!Number.isSafeInteger(n)||n<0||n>1e9)throw Error('growth-invalid-count');metrics[key]=n;
 }
 if(!Array.isArray(data.currencies)||data.currencies.length>20)throw Error('growth-invalid-sales');
 const currencies=data.currencies.map(r=>{if(!/^[A-Z]{3}$/.test(r.currency)||!['paidOrders','refundedOrders','grossItemsCents','refundedItemsCents','netItemsCents'].every(k=>Number.isSafeInteger(r[k]))||r.paidOrders<0||r.refundedOrders<0||r.refundedOrders>r.paidOrders||r.grossItemsCents<0||r.refundedItemsCents<0||r.netItemsCents!==r.grossItemsCents-r.refundedItemsCents)throw Error('growth-invalid-sales');return Object.fromEntries(['currency','paidOrders','refundedOrders','grossItemsCents','refundedItemsCents','netItemsCents'].map(k=>[k,r[k]]));});
 const startedAt=typeof c.startedAt==='string'&&Number.isFinite(Date.parse(c.startedAt))?c.startedAt:null;
 const startedDay=startedAt?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(startedAt)):null;
 const attribution=normalizeAttribution(c.attribution),attributionDay=attribution.startedAt?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(attribution.startedAt)):null;
 attribution.measured=attribution.available&&!!attributionDay&&start>attributionDay;
 return {start,end,metrics,currencies,attribution,startedAt,measured:!!startedDay&&start>startedDay,complete:true,source:'signed-webshop-aggregates',fetchedAt:data.fetchedAt};
}
export async function readCycleWindow({secret,start,end},{fetcher=fetch,clock=Date.now}={}){
 if(typeof secret!=='string'||secret.length<24||![start,end].every(v=>/^\d{4}-\d{2}-\d{2}$/.test(v||''))||start>end||Date.parse(end)-Date.parse(start)>34*day||Date.parse(end)+day>clock())throw Error('growth-not-configured');
 const ts=String(Math.floor(clock()/1000)),sig=createHmac('sha256',secret).update('metrics-v1.'+ts+'.'+start+'.'+end).digest('hex');
 const url=new URL('https://shop.amcinova.com/wp-json/amcinova/v1/growth-summary');url.searchParams.set('start',start);url.searchParams.set('end',end);
 const r=await fetcher(url,{redirect:'error',headers:{'X-Amcinova-Timestamp':ts,'X-Amcinova-Metrics-Signature':sig},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('growth-source-unavailable');return normalizeCycle(await r.json(),{start,end});
}
export function evaluateCycle(windows,now=Date.now()){
 const sorted=windows.filter(w=>w.complete).sort((a,b)=>a.end.localeCompare(b.end)),current=sorted.at(-1),prior=sorted.at(-2),m=current?.metrics||{},feedback={used:0,viewed:0,needsHelp:0,improvements:{},missions:{}};
 for(const [key,n]of Object.entries(m)){const f=/^feedback_(used|viewed)_([1-4])_(clear|help|unclear)_(none|instructions|space|duration|difficulty)$/.exec(key);if(!f)continue;feedback[f[1]]+=n;if(f[1]!=='used')continue;if(f[3]!=='clear')feedback.needsHelp+=n;feedback.improvements[f[4]]=(feedback.improvements[f[4]]||0)+n;feedback.missions[f[2]]=(feedback.missions[f[2]]||0)+n;}
 const actions=[];
 const attribution=current?.attribution;
 if(attribution?.available&&attribution.measured){const orders=attribution.currencies.reduce((s,c)=>s+c.paidOrders,0);actions.push({code:'package-attribution',priority:2,title:'Beoordeel verkopen via het proefpakket',reason:orders+' betaalde bestellingen met expliciete proefpakkettoestemming binnen zeven dagen. Terugbetalingen zijn verrekend.',next:orders<10?'Verzamel eerst meer gegevens. Kleine aantallen bewijzen geen winnaar of oorzakelijk effect.':'Vergelijk de boektotalen en feedback en test één verbetering tegelijk. Controleer vergelijkbare perioden en het aandeel bezoekers dat meetoestemming gaf; geen automatische uitgaven.'});}
 else if(attribution?.available)actions.push({code:'attribution-baseline',priority:2,title:'Aankoopkoppeling gestart',reason:'De aankoopkoppeling is beschikbaar, maar deze periode begon vóór de start van de meting.',next:'Wacht op volledige meetdagen. Oudere verkopen worden niet achteraf toegeschreven.'});
 else actions.push({code:'attribution-unavailable',priority:2,title:'Aankooptoeschrijving nog niet bevestigd',reason:attribution?.reason||'Deze periode bevat nog geen gekoppelde aankoopgegevens.',next:'Gebruik sitebrede omzet niet als proefpakketomzet; controleer de toestemming en de meetkoppeling.'});
 if(current&&current.measured!==true)actions.push({code:'instrumentation-baseline',priority:1,title:'De proefpakketmeting is nieuw',reason:current.startedAt?'Metingen gestart op '+current.startedAt+'. Oudere perioden zijn nog niet gemeten.':'De startdatum van de meting is nog niet bevestigd.',next:'Verzamel eerst volledige meetdagen. Historische webshopomzet blijft apart zichtbaar; oude pakketmetingen worden niet als nul ingevuld.'});
 if(!current)actions.push({code:'repair-measurement',priority:1,title:'Herstel eerst de meetkoppeling',reason:'Geen volledig afgeronde meetperiode beschikbaar.',next:'Controleer de bron voordat je een resultaat of verbetering claimt.'});
 else{
  if(feedback.used>=10&&feedback.needsHelp/feedback.used>=.3)actions.push({code:'clarify-mission',priority:1,title:'Maak de start van de missie duidelijker',reason:feedback.needsHelp+' van '+feedback.used+' proefreacties melden extra uitleg of onduidelijkheid.',next:'De pakketpagina toont automatisch extra starthulp zodra deze grens in de laatste 14 dagen wordt bereikt. Controleer daarna dezelfde feedbackvraag; wijzig de meetdefinitie niet.'});
  if(feedback.used<10)actions.push({code:'collect-feedback',priority:2,title:'Verzamel meer echte gebruiksfeedback',reason:feedback.used+' reacties van mensen die een missie echt probeerden; bekeken pakketten staan apart.',next:'Laat ouders, begeleiders en leerkrachten één missie proberen. Vergelijk pas vanaf tien echte gebruiksreacties.'});
  if((m.package_view||0)>=100&&(m.read_compact||0)+(m.read_full||0)+(m.download_compact||0)+(m.download_full||0)<10)actions.push({code:'improve-package-entry',priority:1,title:'Onderzoek uitval vóór het proefpakket',reason:'Veel gemeten paginaopeningen en weinig lees- of downloadhandelingen.',next:'Test één duidelijkere leesknop. Het zijn interactietellingen, geen unieke bezoekers of conversieratio.'});
  const paid=current.currencies.reduce((n,c)=>n+c.paidOrders,0);
  if(!paid)actions.push({code:'validate-sales-path',priority:2,title:'Controleer aansluiting op het vervolgaanbod',reason:'Geen betaalde webshopbestellingen in deze meetperiode.',next:'Gebruik de optionele boekkaarten met actuele webshopprijzen. Controleer productpagina en afrekenen; een proefpakket is geen verplichte aankoop.'});
  else actions.push({code:'review-real-sales',priority:2,title:'Beoordeel echte webshopomzet',reason:paid+' betaalde webshopbestellingen ontvangen.',next:'Deze omzet is sitebreed. Schrijf haar pas aan het proefpakket toe als daarvoor afzonderlijk bewijs is; omzet is geen winst.'});
  if(!prior||(m.package_view||0)<100||feedback.used<10)actions.push({code:'baseline',priority:3,title:'Nog geen bewezen verbetering',reason:'Er zijn nog onvoldoende vergelijkbare gegevens.',next:'Behoud dezelfde vragen en meetdefinities en vergelijk twee afgeronde weken. Geen automatische uitgaven of winnaar.'});
 }
 return {version:1,campaign:'speurmaatjes-proefpakket-v1',host:'shop.amcinova.com',evaluatedAt:new Date(now).toISOString(),windows:sorted,current:current||null,prior:prior||null,feedback,actions:actions.sort((a,b)=>a.priority-b.priority),automatic:{aggregateRefresh:true,contextualStartHelp:true,budgetChanges:false,paidPublishing:false},notice:'Aankooptoeschrijving telt alleen de twee vervolgboeken, met expliciete toestemming, binnen zeven dagen en na terugbetalingen. Dit bewijst een gevolgde route, geen oorzakelijk effect. Sitebrede omzet en anonieme feedback blijven apart. Geen automatische budgetwijziging.'};
}
export function registerGrowthCycle(app,{wrap,identity,requireProduct,env,fetcher=fetch,clock=Date.now}){
 let cached;
 async function readForOwner(u){
  if(!env.AMCINOVA_SHOP_SALES_OWNER||u.id!==env.AMCINOVA_SHOP_SALES_OWNER)throw Object.assign(Error('Deze webshop is niet aan jouw account gekoppeld.'),{status:403});
  if(cached&&cached.expires>clock())return cached.cycle;
  let windows;try{windows=await Promise.all(cycleWindows(clock()).map(w=>readCycleWindow({...w,secret:env.AMCINOVA_SHOP_SALES_SECRET},{fetcher,clock})));}catch{throw Object.assign(Error('De proefpakketmetingen konden niet volledig worden opgehaald. Er worden geen ontbrekende cijfers als nul ingevuld.'),{status:503});}
  const cycle=evaluateCycle(windows,clock());cached={expires:clock()+60000,cycle};return cycle;
 }
 app.get('/api/customer/growth-cycle',wrap(async(req,res)=>{const u=await identity(req);await requireProduct(u,'campaign');res.json({ok:true,cycle:await readForOwner(u)});}));
 return async(u,website)=>{
  if(u.id!==env.AMCINOVA_SHOP_SALES_OWNER||!/^https:\/\/shop\.amcinova\.com(?:\/|$)/.test(website||''))return null;
  try{const c=await readForOwner(u);return {evaluatedAt:c.evaluatedAt,feedback:c.feedback,measurementWindows:c.windows.map(w=>({start:w.start,end:w.end,measured:w.measured,attribution:w.attribution})),actions:c.actions,notice:c.notice};}catch{return {notice:'De resultatenbron is nu niet bereikbaar. Claim geen gemeten resultaat of verbetering; behoud de eerdere uitgangspunten.'};}
 };
}
