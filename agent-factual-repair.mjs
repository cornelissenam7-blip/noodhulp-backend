// Repair concrete unsupported marketing embellishments using supplied facts.
// No extra model call, fabricated business facts or generic successful-plan fallback.
const unsupported=/\b(?:professioneel|professionele|professional|professionals|expert|experts|expertise|vakkundig|vakkundige|deskundig|deskundige|ervaren|experienced|betaalbaar|betaalbare|affordable|betrouwbaar|betrouwbare|reliable|gratis|free|vrijblijvend(?:e)?|no-obligation|snelle|snel|fast|quick|topconditie|topvorm|top-notch|perfect|perfecte|beste|best|veilig|veilige|veiligheid|safe|safety|geweldig|geweldige|top|kwaliteit|quality|zonder zorgen|met zorg en aandacht|effici[eë]nt|efficient)\b/gi;
const affirmative=s=>s.split(/[.!?\n]+/).filter(part=>! /\b(?:no|not|unknown|unconfirmed|geen|niet|onbekend)\b/i.test(part)).join(' ');
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function repairFactualCopy(p,input){
 if(!['site','ads','campaign'].includes(input.task))return p;
 const fields=input.fields;
 const facts=affirmative(Object.entries(fields).filter(([k])=>k.startsWith('profile-')||['builder-offer','ad-offer','ad-benefit'].includes(k)).map(([,v])=>v).join('\n'));
 const offer=(fields['profile-offer']||fields['ad-offer']||fields['builder-offer']||'').trim();
 const fixedPrice=!/\b(?:vanaf|from|starting|minimum|ongeveer|circa|about)\b/i.test(offer);
 const clean=text=>{
  if(typeof text!=='string')return text;
  // Whole unsupported promise sentences are omitted, not reworded as facts.
  const sentences=text.split(/(?<=[.!?])\s+/).filter(s=>!([...s.matchAll(unsupported)].some(m=>!new RegExp('\\b'+escape(m[0])+'\\b','i').test(facts))));
  let value=sentences.join(' ').replace(unsupported,claim=>new RegExp('\\b'+escape(claim)+'\\b','i').test(facts)?claim:'');
  if(fixedPrice)value=value.replace(/\b(?:vanaf|from|starting (?:at|from))\s*(?=[€$£]|\d)/gi,'');
  return value.replace(/\s{2,}/g,' ').replace(/\s+([,.!?:;])/g,'$1').trim();
 };
 const next={...p,title:clean(p.title),summary:clean(p.summary),headline:clean(p.headline),intro:clean(p.intro),ads:p.ads.map(a=>({...a,headline:clean(a.headline),text:clean(a.text)})),sections:p.sections.map(s=>({...s,text:fields.language==='nl'?s.text.replace(/\bzelfändige\b/gi,'zelfstandige'):s.text}))};
 if(input.task==='site'){
  // Additional site paragraphs containing an unsupported claim are discarded.
  next.sections=next.sections.filter(s=>![...s.text.matchAll(unsupported)].some(m=>!new RegExp('\\b'+escape(m[0])+'\\b','i').test(facts)));
  if(!next.intro&&offer)next.intro=offer;
  if(!next.headline&&offer)next.headline=offer;
  if(!affirmative(fields['profile-facts']||'').trim()){
   const normalize=s=>s.toLowerCase().replace(/[.!?]+/g,' ').replace(/\s+/g,' ').trim();
   next.sections=next.sections.filter(s=>normalize(facts).includes(normalize(s.text)));
  }
  if(!next.summary)next.summary=fields.language==='en'?'Draft based on your supplied offer.':'Concept op basis van je opgegeven aanbod.';
 }
 if(input.task==='campaign')next.sections=next.sections.map(s=>{
  if(/Meten|Measurement/i.test(s.heading)&&/\b(?:ingesteld|ingericht|configured|enabled|tracking is functioning)\b/i.test(s.text)&&! /\b(?:ingesteld|ingericht|configured|enabled|tracking is functioning)\b/i.test(affirmative(fields['profile-facts']||'')))return {...s,text:fields.language==='en'?'Proposed measurement — not yet configured or verified: register a submitted enquiry form as a separate event. UTM parameters identify the source; a click alone is not an enquiry. Submit a test enquiry and check that both the enquiry and its source are recorded before starting the campaign.':'Voorgestelde meting — nog niet ingericht of gecontroleerd: registreer een verzonden aanvraagformulier als aparte gebeurtenis. UTM-parameters geven de herkomst; alleen een klik is geen aanvraag. Voer een testaanvraag uit en controleer of zowel de aanvraag als de herkomst worden geregistreerd voordat de campagne start.'};
  if(!/Advertentievoorstel|Ad proposal/i.test(s.heading))return s;
  const embellishment=[...s.text.matchAll(unsupported)].some(m=>!new RegExp('\\b'+escape(m[0])+'\\b','i').test(facts))||/\b(?:expertise|effici[eë]nt|op maat)\b/i.test(s.text)&&! /\b(?:expertise|effici[eë]nt|op maat)\b/i.test(facts);
  if(!embellishment||!offer)return {...s,text:clean(s.text)};
  const literalOffer=offer.split(/(?<=[.!?])\s+/)[0];
  return {...s,text:fields.language==='en'?`Proposed variant A: ${literalOffer} Request more information.\nProposed variant B: ${literalOffer} Discuss the possibilities.\nCompare only the call to action; keep the message, audience, image, landing page, budget allocation and evaluation period the same. No winner has been measured.`:`Voorstel variant A: ${literalOffer} Vraag meer informatie aan.\nVoorstel variant B: ${literalOffer} Bespreek de mogelijkheden.\nVergelijk alleen de oproep tot actie; houd basistekst, doelgroep, beeld, landingspagina, budgetverdeling en meetperiode gelijk. Er is nog geen winnaar gemeten.`};
 });
 // A repair can merge two formerly different ad headlines. Keep the rate untouched
 // and use a factual location/service opening rather than artificial synonyms.
 if(input.task==='ads'){
  const literalService=offer.split(/\b(?:voor|for)\s*[€$£]|[€$£]/i)[0].trim().replace(/[:—-]+$/,'').trim();
  const fallback=literalService||fields['profile-name']||offer;
  for(const ad of next.ads)if(!ad.headline.trim())ad.headline=fallback.length<=30?fallback:fallback.slice(0,30).replace(/\s+\S*$/,'').trim();
 }
 if(input.task==='ads'&&/varianten|variants/i.test(fields['agent-instructions']||'')&&next.ads.length>1){
  const first=next.ads[0];
  for(let i=1;i<next.ads.length;i++){
   const ad=next.ads[i];
   if(ad.text===first.text&&ad.headline===first.headline){
    const service=offer.split(/\b(?:voor|for)\s*[€$£]|[€$£]/i)[0].trim().replace(/[:—-]+$/,'').trim();
    if(service&&service.length<=30)ad.headline=service;
   }
   if(ad.text===first.text){
    const area=(fields['ad-region']||fields['profile-region']||'').trim();
    if(area&&ad.text.includes(area)){
     const rest=ad.text.replace(new RegExp('\\s+(?:in|voor|for)\\s+'+escape(area)+'\\b','i'),'').trim();
     const alternate=area+': '+rest.charAt(0).toLowerCase()+rest.slice(1);
     if(alternate!==first.text&&alternate.length<=90)ad.text=alternate;
    }
    if(ad.text===first.text){
     const match=ad.text.match(/^(.*?)\s+(?:(?:voor|for)\s+)?([€$£].*?)\.?$/i);
     if(match){const alternate=match[2]+' — '+match[1].charAt(0).toLowerCase()+match[1].slice(1)+'.';if(alternate.length<=90)ad.text=alternate;}
    }
   }
  }
 }
 return next;
}
