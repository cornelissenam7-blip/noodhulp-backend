import {randomUUID,createHash} from 'node:crypto';
const fail=(status,message)=>Object.assign(Error(message),{status});
export function materialLibrary(input){
 if(!input||typeof input.companyId!=='string'||!input.companyId.trim()||input.companyId.length>100||!Array.isArray(input.items)||input.items.length>200)throw fail(400,'Controleer je bedrijf en materialenlijst (maximaal 200 artikelen).');
 const ids=new Set();const items=input.items.map(m=>{
  const s=(key,max)=>{if(typeof m?.[key]!=='string'||m[key].length>max)throw fail(400,'Controleer de materiaalgegevens.');return m[key].trim();};
  const id=s('id',80),name=s('name',180),code=s('code',100),supplier=s('supplier',100),detail=s('detail',240);
  if(!id||ids.has(id)||!name||!['stuk','m','m2','post','uur'].includes(m.unit)||!['incl','excl'].includes(m.priceBasis)||![0,9,21].includes(m.vat)||typeof m.price!=='number'||!Number.isFinite(m.price)||m.price<0||m.price>100000||Math.abs(m.price*100-Math.round(m.price*100))>0.00001)throw fail(400,'Controleer naam, eenheid, prijs en btw van het materiaal.');
  ids.add(id);return{id,name,code,supplier,detail,unit:m.unit,price:m.price,priceBasis:m.priceBasis,vat:m.vat};
 });return{companyId:input.companyId.trim(),items};
}
export function registerCustomerMaterials(app,{json,identity,db,requireProduct,wrap}){
 const latest=async(u,company)=>{const rows=await db(u,'amcinova_customer_documents','?user_id=eq.'+u.id+'&product_code=eq.offertetool&payload->materialLibrary->>companyId=eq.'+encodeURIComponent(company)+'&select=project_id,revision,payload&order=created_at.desc&limit=1');return rows[0]||null;};
 app.get('/api/customer/materials',wrap(async(req,res)=>{
  const u=await identity(req);await requireProduct(u,'offertetool');const company=materialLibrary({companyId:req.query.company,items:[]}).companyId;
  const saved=await latest(u,company);res.json({ok:true,library:saved?.payload?.materialLibrary||{companyId:company,items:[]},revision:saved?.revision||0});
 }));
 app.post('/api/customer/materials',json({limit:'200kb'}),wrap(async(req,res)=>{
  const u=await identity(req);await requireProduct(u,'offertetool');const library=materialLibrary(req.body?.library);
  if(!Number.isSafeInteger(req.body?.revision)||req.body.revision<0)throw fail(400,'Haal eerst je materialenlijst op.');
  const saved=await latest(u,library.companyId);if((saved?.revision||0)!==req.body.revision)throw fail(409,'Je materialenlijst is elders gewijzigd. Haal de nieuwste lijst op voordat je verdergaat.');
  const key=createHash('sha256').update('material-library:'+u.id+':'+library.companyId).digest('hex');
  const projectId=[key.slice(0,8),key.slice(8,12),'4'+key.slice(13,16),'8'+key.slice(17,20),key.slice(20,32)].join('-');
  const revision=req.body.revision+1,row={id:randomUUID(),user_id:u.id,product_code:'offertetool',project_id:saved?.project_id||projectId,revision,name:'Eigen materialen',payload:{materialLibrary:library}};
  await db(u,'amcinova_customer_documents','',row);res.json({ok:true,library,revision});
 }));
}
