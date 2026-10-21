import {testOrder} from './test-order-model.mjs';
import {customerCatalog} from './customer-catalog.mjs';
const allowed=['offertetool','sitebuilder','campaign','admaker','promotie'];
export function consultationOffer(products){
 if(!Array.isArray(products)||products.length>5||products.some(p=>!allowed.includes(p)))throw Error('Ongeldige productkeuze.');
 const selected=[...new Set(products)].filter(p=>p!=='admaker'||!products.includes('promotie'));if(!selected.length)return null;
 const order=testOrder({id:'00000000-0000-4000-8000-000000000001',selected,priceVersion:'proposal-20261010-quote',sitePackage:'self',campaignPlan:'setup',siteService:0,quoteService:0,terms:3,method:'once'},{id:'00000000-0000-4000-8000-000000000002',email:'test@example.com'});
 return {kind:'test-proposal',selected,products:selected.map(code=>({code,name:customerCatalog.find(p=>p.code===code).name})),estimate:order.estimate,assumptions:[...(selected.includes('offertetool')?['Offertetool: eenmalige tool; geen aanvullende hulp- of opslagservice gekozen.']:[]),...(selected.includes('sitebuilder')?['Sitebuilder: zelfbouw/export; geen aanvullende websiteservice.']:[]),...(selected.includes('campaign')?['Campagne: eenmalige opzet; geen maand- of jaarplan.']:[]),'Eenmalig betalen als rekenkeuze; dit start geen betaling.','Bestaande testkortingen uit de prijsberekening zijn inbegrepen.',...(selected.includes('promotie')?['AdMaker is inbegrepen bij Promotie en wordt niet dubbel berekend.']:[])],checkoutEnabled:false,activation:'Alleen bestaande toegelaten testers kunnen via hun account de gecontroleerde testroute doorlopen. Een voorstel geeft geen toegang.',url:'https://agents.amcinova.com/winkelmand.html?producten='+selected.join(',')+'&lang=nl'};
}
