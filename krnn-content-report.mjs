// KRNN website credentials remain on the server. Only aggregate content counts leave this route.
export function registerKrnnContentReport(app,{adminAccess,env=process.env,fetchImpl=fetch}) {
 app.get('/api/admin/krnn-content-report',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(req.query?.key||!adminAccess(req))return res.status(401).json({ok:false,error:'Meld je aan in beheer.'});
  if(!env.KNN_LEADS_READ_KEY)return res.status(503).json({ok:false,error:'De koppeling met het NoordNed-aanvraagoverzicht is nog niet geactiveerd.'});
  try{
   const response=await fetchImpl('https://keukenrenovatienoordned.nl/leads-api.php?view=content',{
    headers:{'X-KNN-Key':env.KNN_LEADS_READ_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('upstream');
   const data=await response.json(),report=data.contentReport;
   if(!report||!Array.isArray(report.rows)||report.rows.length>50000)throw Error('schema');
   const number=v=>Number.isSafeInteger(v)&&v>=0?v:0;
   const rows=report.rows.filter(r=>['soro','dot'].includes(r.source)&&/^[a-z0-9][a-z0-9_-]{0,159}$/.test(r.id)).map(r=>({
    source:r.source,id:r.id,channel:['facebook','instagram','blog'].includes(r.channel)?r.channel:'unknown',
    views:number(r.views),testViews:number(r.testViews),leads:number(r.leads),quotes:number(r.quotes),orders:number(r.orders)}));
   res.json({ok:true,checkedAt:new Date().toISOString(),periodDays:90,rows});
  }catch{res.status(503).json({ok:false,error:'Geen actuele NoordNed-meting beschikbaar. Probeer later opnieuw.'});}
 });
}
