export const customerCatalog = [
 {code:'sitebuilder',name:'Sitebuilder',description:'Maak een website of voorbeeldshop met teksten en passende beelden.',kind:'Tool'},
 {code:'offertetool',name:'Offertetool',description:'Bereken materialen, uren en tarieven en stel offertes samen.',kind:'Tool'},
 {code:'planner',name:'Woning- en keukenplanner',description:'Werk indelingen, materialen en een zichtbaar ruimtevoorbeeld uit.',kind:'Tool'},
 {code:'shophulp',name:'Shop-hulp',description:'Ondersteuning bij het opzetten en aanvullen van je webshop.',kind:'Agent'},
 {code:'campaign',name:'Campaign Agent',description:'Werk campagnes en de boodschap voor je doelgroep uit.',kind:'Agent'},
 {code:'admaker',name:'AdMaker',description:'Maak advertentieconcepten met tekst en beeld.',kind:'Agent'},
 {code:'promotie',name:'Promotie-agent',description:'Bereid content en een promotieplanning voor. Automatisch publiceren volgt later.',kind:'Agent'}
];
export const customerBundles = [
 {name:'Website en zichtbaarheid',products:['sitebuilder','promotie']},
 {name:'Vakman en verbouwing',products:['sitebuilder','offertetool','planner']},
 {name:'Webshop en marketing',products:['sitebuilder','shophulp','campaign','admaker','promotie']}
];
export function validateSelection(value){
 if(!Array.isArray(value)||value.length>customerCatalog.length||value.some(code=>!customerCatalog.some(p=>p.code===code)))throw Object.assign(new Error('Kies alleen producten uit het aanbod.'),{status:400});
 return [...new Set(value)];
}
