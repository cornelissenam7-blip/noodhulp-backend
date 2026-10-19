// One shared message makes a CTA-only comparison mechanically reproducible.
const ctas=['Vraag een offerte aan.','Vraag meer informatie aan.','Bespreek de mogelijkheden.','Request a quote.','Request more information.','Discuss the possibilities.'];
export const campaignCreativeSchema={type:'object',additionalProperties:false,required:['body','ctaA','ctaB'],properties:{body:{type:'string'},ctaA:{type:'string',enum:ctas},ctaB:{type:'string',enum:ctas}}};
export function normalizeCampaignCreative(value,en=false){
 if(typeof value==='string')return value; // Saved/legacy provider fixtures remain readable.
 if(!value||['body','ctaA','ctaB'].some(k=>typeof value[k]!=='string'||!value[k].trim()||value[k].length>3000))throw Object.assign(Error('AI heeft geen volledig advertentievoorstel gemaakt.'),{status:502});
 if(!ctas.includes(value.ctaA)||!ctas.includes(value.ctaB))throw Object.assign(Error('De oproep tot actie bevat niet-bevestigde voorwaarden.'),{status:502});
 if(value.ctaA.trim().toLowerCase()===value.ctaB.trim().toLowerCase())throw Object.assign(Error('De twee oproepen tot actie moeten verschillen.'),{status:502});
 const body=value.body.trim().split(/(?<=[.!?])\s+/).filter(s=>!/^(?:bezoek|vraag|neem contact|bel|klik|ontdek|bekijk|stuur|visit|request|contact|call|click|discover|learn more|get in touch)\b/i.test(s)).join(' ');
 if(!body)throw Object.assign(Error('De basistekst over het aanbod ontbreekt.'),{status:502});
 value={...value,body};
 return en?`Proposed variant A: ${value.body.trim()} ${value.ctaA.trim()}\nProposed variant B: ${value.body.trim()} ${value.ctaB.trim()}\nTest factor: only the call to action changes. Keep the message, audience, image, landing page, budget allocation and evaluation period the same. No winner has been measured.`:`Voorstel variant A: ${value.body.trim()} ${value.ctaA.trim()}\nVoorstel variant B: ${value.body.trim()} ${value.ctaB.trim()}\nTestfactor: alleen de oproep tot actie verandert. Houd basistekst, doelgroep, beeld, landingspagina, budgetverdeling en meetperiode gelijk. Er is nog geen winnaar gemeten.`;
}
export function completeCampaignPlan(p,input){
 if(input.task!=='campaign')return p;
 const f=input.fields,en=f.language==='en';
 const sections=p.sections.map(s=>({...s}));
 const find=pattern=>sections.find(s=>pattern.test(s.heading));
 const budget=find(/^Budget$/i),raw=(f['campaign-budget']||'').trim();
 const unknown=!raw||/nog niet vastgesteld|nog niet bepaald|onbekend|not (?:yet )?(?:set|confirmed|determined)|unknown|tbd/i.test(raw)&&!/(?:[€$£]|\b(?:EUR|USD|GBP)\b)\s*\d|\d\s*(?:euro|dollar|pound)/i.test(raw);
 if(budget)budget.text=unknown?(en?'Advertising budget and campaign period have not been agreed. Before starting a trial, agree the total spending cap, start and end dates and allocation between variants. Advertising spend, platform charges and Amcinova service or AI costs are separate; their amounts have not been supplied.':'Advertentiebudget en campagneperiode zijn nog niet afgesproken. Bepaal vóór een proef het totale bestedingsplafond, de start- en einddatum en de verdeling tussen varianten. Advertentiebudget, eventuele platformkosten en Amcinova-dienstverlening of AI-kosten staan apart; de bedragen zijn niet aangeleverd.'):(raw||budget.text);
 const supplied=[f['campaign-link'],f['profile-website'],f['profile-facts'],f['agent-instructions']].filter(Boolean).join('\n');
 const links=[...supplied.matchAll(/https?:\/\/[^\s<>"']+/g)].map(m=>m[0].replace(/[.,;!?)]+$/,''));
 const valid=links.filter(link=>{try{const u=new URL(link);return !u.username&&!u.password;}catch{return false;}});
 const link=valid.find(x=>/(?:#|\/)(?:contact|offerte|quote|aanvraag|enquir|inquir)/i.test(x))||valid[0];
 const channel=find(/Kanaalkeuze|Channel selection/i);
 if(channel&&link&&!channel.text.includes(link))channel.text+='\n'+(en?'Supplied landing/contact page: ':'Aangeleverde landings-/contactpagina: ')+link;
 if(channel)channel.text+='\n'+(en?'Search terms and negative keywords are proposals, not measured demand. Check real search queries before applying exclusions; do not block a broad relevant category without evidence.':'Zoektermen en uitsluitingen zijn voorstellen, geen gemeten vraag. Controleer echte zoekopdrachten vóór je uitsluitingen toepast; sluit zonder bewijs geen brede relevante categorie uit.');
 const creative=find(/Advertentievoorstel|Ad proposal/i);
 if(creative)creative.text=creative.text.replace(/\s*(Voorstel variant [AB]:|Proposed variant [AB]:|Testfactor:|Test factor:)/g,'\n$1').trim();
 const measurement=find(/Meten|Measurement/i);
 if(measurement)measurement.text+='\n'+(en?'Measurement checklist, still to configure and test: distinguish website visits, successfully submitted enquiries, qualified enquiries and paid customers. Use UTM parameters for source attribution, not as proof of an enquiry or sale. Deduplicate using an enquiry ID and link a confirmed paid order to that enquiry. Submit a recognisable test enquiry, exclude tests from campaign results and verify the source and event in administration. Record unknown attribution as unknown; do not claim causality.':'Meetchecklist, nog in te richten en te testen: onderscheid websitebezoeken, succesvol verzonden aanvragen, gekwalificeerde aanvragen en betaalde klanten. Gebruik UTM-parameters voor herkomst, niet als bewijs van een aanvraag of verkoop. Ontdubbel met een aanvraagnummer en koppel een bevestigde betaalde opdracht aan die aanvraag. Doe een herkenbare testaanvraag, sluit tests uit van campagneresultaten en controleer herkomst en gebeurtenis in Beheer. Noteer onbekende herkomst als onbekend; claim geen oorzakelijk verband.');
 const evaluation=find(/Evalueren|Evaluation/i);
 if(evaluation&&!/(?:onvoldoende|weinig|gebrek|insufficient|few|lack).{0,40}(?:aanvragen|leads|enquiries|inquiries|customers)/i.test(f['campaign-goal']||''))evaluation.text=evaluation.text.split(/(?<=[.!?])\s+/).filter(s=>!(/stop|pauz|pause|suspend/i.test(s)&&/(?:onvoldoende|weinig|gebrek|insufficient|few|lack).{0,40}(?:aanvragen|leads|enquiries|inquiries|customers)/i.test(s))).join(' ');
 if(evaluation)evaluation.text+='\n'+(en?'Before starting, agree an evaluation period and who will assess enquiry quality and confirmed paid orders. Do not invent a minimum number of clicks, enquiries or customers. With little data, report uncertainty and do not declare a winning variant. Pause on broken measurement, exceeding the agreed spending cap or an incorrect audience.':'Spreek vóór de start de meetperiode af en wie de kwaliteit van aanvragen en bevestigde betaalde opdrachten beoordeelt. Verzin geen minimumaantal klikken, aanvragen of klanten. Rapporteer bij weinig gegevens de onzekerheid en wijs geen winnende variant aan. Pauzeer bij een defecte meting, overschrijding van het afgesproken budgetplafond of een verkeerde doelgroep.');
 return {...p,sections};
}
