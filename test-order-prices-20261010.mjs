import {legacyTestOrder} from './test-order-legacy.mjs';

function priceTotals({items,bundleDiscount,discount,terms,method,service=0,annualService=0}){
 if(!Array.isArray(items)||!items.length)throw Error('Kies minimaal één product.');
 if(items.some(p=>p.code==='promotie'))items=items.filter(p=>p.code!=='admaker');
 const amount=n=>Number.isFinite(n)&&n>=0&&n<=100000;
 if(items.some(p=>!amount(p.once)||!amount(p.monthly))||!amount(service)||!amount(annualService))throw Error('Vul bedragen tussen 0 en 100.000 in.');
 if(![bundleDiscount,discount].every(n=>Number.isFinite(n)&&n>=0&&n<=50))throw Error('Vul kortingen tussen 0 en 50% in.');
 if(![3,6,12].includes(terms)||!['once','spread'].includes(method))throw Error('Kies een geldige betaalwijze en termijn.');
 const cents=n=>Math.round(n*100),vat=n=>Math.round(n*1.21),rawOnce=items.reduce((n,p)=>n+cents(p.once),0),rawMonthly=items.reduce((n,p)=>n+cents(p.monthly),cents(service));
 const rate=items.length>=2?bundleDiscount:0,onceNet=Math.round(rawOnce*(100-rate)/100),monthNet=Math.round(rawMonthly*(100-rate)/100),directNet=Math.round(onceNet*(100-discount)/100),spreadGross=vat(onceNet),directGross=vat(directNet);
 const net=method==='once'?directNet:onceNet,gross=method==='once'?directGross:spreadGross,monthGross=vat(monthNet),part=Math.floor(spreadGross/terms),last=spreadGross-part*(terms-1);
 const annualNet=cents(annualService),annualGross=vat(annualNet);
 return {annualNet,annualGross,rawOnce,rawMonthly,rate,onceNet,monthNet,directNet,spreadGross,directGross,net,gross,monthGross,part,last,first:annualGross+monthGross+(method==='once'?gross:part),year:annualGross+gross+12*monthGross};
}
const TestCart={totals:priceTotals,catalog:[
 {code:'offertetool',name:'Offertetool',once:179,monthly:0},
 {code:'sitebuilder',name:'Sitebuilder zelfbouw/export',once:199,monthly:0},
 {code:'planner',name:'Woning- en keukenplanner',once:99,monthly:0},
 {code:'shophulp',name:'Shop-hulp',once:0,monthly:19},
 {code:'campaign',name:'Campaign Agent',once:399,monthly:0},
 {code:'admaker',name:'AdMaker',once:0,monthly:19},
 {code:'promotie',name:'Promotie-agent inclusief AdMaker',once:399,monthly:29}
],parse(value){return [...new Set(String(value||'').split(','))].filter(code=>this.catalog.some(p=>p.code===code));}};
TestCart.items=function(selected,sitePackage='self',campaignPlan='setup'){return selected.map(code=>{const p={...this.catalog.find(x=>x.code===code)};if(code==='sitebuilder')p.once={self:199,landing:399,extended:999}[sitePackage];if(code==='campaign')p.monthly=campaignPlan==='monthly'?99:0;return p;});};

export function previousTestOrder(input,user){
 if(input?.priceVersion && !['test-20261007','proposal-20261010'].includes(input.priceVersion))throw Error('Onbekende prijsversie.');
 if(input?.priceVersion!=='proposal-20261010')return legacyTestOrder(input,user);
 legacyTestOrder({...input,siteService:0},user);
 const sitePackage=input.sitePackage||'self',campaignPlan=input.campaignPlan||'setup';
 if(!['self','landing','extended'].includes(sitePackage)||!['setup','monthly','annual'].includes(campaignPlan)||![0,19,49].includes(input.siteService))throw Error('Ongeldige pakketkeuze.');
 const selected=[...new Set(input.selected)];
 const service=(selected.includes('offertetool')?input.quoteService:0)+(selected.includes('sitebuilder')?input.siteService:0);
 const annualService=selected.includes('campaign')&&campaignPlan==='annual'?990:0;
 const estimate=priceTotals({items:TestCart.items(selected,sitePackage,campaignPlan),bundleDiscount:10,discount:5,terms:input.terms,method:input.method,service,annualService});
 return {id:input.id,user_id:user.id,email:user.email,status:'TEST',selected,payment_method:input.method,terms:input.terms,estimate:{...estimate,quoteService:input.quoteService,siteService:input.siteService,sitePackage,campaignPlan,priceVersion:'proposal-20261010',notice:'Richtprijs; niet bindend, geen echte betaling of producttoegang.'}};
}
