
function priceTotals({items,bundleDiscount,discount,terms,method,service=0}){
 if(!Array.isArray(items)||!items.length)throw Error('Kies minimaal één product.');
 if(items.some(p=>p.code==='promotie'))items=items.filter(p=>p.code!=='admaker');
 const amount=n=>Number.isFinite(n)&&n>=0&&n<=100000;
 if(items.some(p=>!amount(p.once)||!amount(p.monthly))||!amount(service))throw Error('Vul bedragen tussen 0 en 100.000 in.');
 if(![bundleDiscount,discount].every(n=>Number.isFinite(n)&&n>=0&&n<=50))throw Error('Vul kortingen tussen 0 en 50% in.');
 if(![3,6,12].includes(terms)||!['once','spread'].includes(method))throw Error('Kies een geldige betaalwijze en termijn.');
 const cents=n=>Math.round(n*100),vat=n=>Math.round(n*1.21),rawOnce=items.reduce((n,p)=>n+cents(p.once),0),rawMonthly=items.reduce((n,p)=>n+cents(p.monthly),cents(service));
 const rate=items.length>=2?bundleDiscount:0,onceNet=Math.round(rawOnce*(100-rate)/100),monthNet=Math.round(rawMonthly*(100-rate)/100),directNet=Math.round(onceNet*(100-discount)/100),spreadGross=vat(onceNet),directGross=vat(directNet);
 const net=method==='once'?directNet:onceNet,gross=method==='once'?directGross:spreadGross,monthGross=vat(monthNet),part=Math.floor(spreadGross/terms),last=spreadGross-part*(terms-1);
 return {rawOnce,rawMonthly,rate,onceNet,monthNet,directNet,spreadGross,directGross,net,gross,monthGross,part,last,first:monthGross+(method==='once'?gross:part),year:gross+12*monthGross};
}
const TestCart={totals:priceTotals,catalog:[
 {code:'offertetool',name:'Offertetool',once:179,monthly:0},
 {code:'sitebuilder',name:'Sitebuilder zelfbouw/export',once:119,monthly:0},
 {code:'planner',name:'Woning- en keukenplanner',once:99,monthly:0},
 {code:'shophulp',name:'Shop-hulp',once:0,monthly:19},
 {code:'campaign',name:'Campaign Agent',once:0,monthly:19},
 {code:'admaker',name:'AdMaker',once:0,monthly:19},
 {code:'promotie',name:'Promotie-agent inclusief AdMaker',once:0,monthly:29}
],parse(value){return [...new Set(String(value||'').split(','))].filter(code=>this.catalog.some(p=>p.code===code));}};
export function testOrder(input,user){
 if(!input||typeof input.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id))throw Error('Ongeldige testaanvraag.');
 if(!Array.isArray(input.selected)||!input.selected.length||input.selected.length>7||input.selected.some(c=>!TestCart.catalog.some(p=>p.code===c)))throw Error('Kies geldige producten.');
 const selected=[...new Set(input.selected)];
 if(![0,19].includes(input.quoteService)||![0,12,39].includes(input.siteService))throw Error('Ongeldige servicekeuze.');
 const service=(selected.includes('offertetool')?input.quoteService:0)+(selected.includes('sitebuilder')?input.siteService:0);
 const estimate=priceTotals({items:selected.map(c=>TestCart.catalog.find(p=>p.code===c)),bundleDiscount:10,discount:5,terms:input.terms,method:input.method,service});
 return {id:input.id,user_id:user.id,email:user.email,status:'TEST',selected,payment_method:input.method,terms:input.terms,estimate:{...estimate,quoteService:input.quoteService,siteService:input.siteService,priceVersion:'test-20261007',notice:'Niet bindend; geen betaling of producttoegang.'}};
}

