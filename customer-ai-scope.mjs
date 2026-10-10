const fault=()=>Object.assign(Error('Dit voorstel hoort niet bij je product.'),{status:403});
// The server decides the product; neither user_id nor a client product label grants access.
export function customerAIScope(mode,body={}){
 if(mode==='proposal'||mode==='drawing')return {product:'offertetool',kind:mode};
 const task=body.task,fields=body.fields||{},research=fields['research-mode']||'',support=fields['support-mode']||'';
 if(mode==='generate'){
  if(!['site','advice','review'].includes(task)||research==='ui-translation'||research==='promotion-plan')throw fault();
  if(research&&!['suppliers','digital-problems','digital-solution','visibility-check','product-brand'].includes(research))throw fault();
  return {product:'sitebuilder',kind:'generate'};
 }
 if(mode==='admaker'&&task==='ads'&&!research&&!support)return {product:'admaker',kind:'generate'};
 if(mode==='campaign'&&task==='campaign'&&!research&&!support)return {product:'campaign',kind:'generate'};
 if(mode==='promotie'&&task==='advice'&&research==='promotion-plan'&&!support)return {product:'promotie',kind:'generate'};
 if(mode==='shophulp'&&task==='advice'&&support==='webshop'&&!research)return {product:'shophulp',kind:'generate'};
 throw fault();
}
