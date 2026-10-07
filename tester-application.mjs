const codes=new Set(['sitebuilder','offertetool','planner','shophulp','campaign','admaker','promotie']);
export function testerApplication(body,email,now=new Date()){
 const bad=()=>{throw Object.assign(new Error('Kies één product, beschrijf je testdoel (maximaal 1500 tekens) en bevestig dat we je over deze testgroep mogen benaderen.'),{status:400});};
 if(!body||!codes.has(body.product)||typeof body.goal!=='string'||!body.goal.trim()||body.goal.length>1500||body.contactConsent!==true)bad();
 return {product:body.product,goal:body.goal.trim(),email,contactConsent:true,noticeVersion:'20261007',status:'interest',updatedAt:now.toISOString()};
}
