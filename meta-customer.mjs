import {randomBytes,createHash,createCipheriv,createDecipheriv,createHmac} from 'node:crypto';
const fail=(status,message)=>Object.assign(Error(message),{status});
const hash=x=>createHash('sha256').update(x).digest('hex');
const id=x=>typeof x==='string'&&/^\d{1,40}$/.test(x);
const scopes=['pages_show_list','pages_manage_metadata','pages_messaging'];
export function tokenBox(key){
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key))throw fail(503,'Facebook koppelen is nog niet ingesteld.');
 const k=Buffer.from(key,'hex');
 return {seal(value,owner){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',k,iv);c.setAAD(Buffer.from(owner));const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return ['v1',iv.toString('base64url'),c.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');},open(value,owner){const [v,iv,tag,data,...rest]=value.split('.');if(v!=='v1'||rest.length)throw Error('Invalid encrypted token');const d=createDecipheriv('aes-256-gcm',k,Buffer.from(iv,'base64url'));d.setAAD(Buffer.from(owner));d.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString('utf8');}};
}
export function metaCustomerConfig(env){
 const origin=env.AMCINOVA_META_PUBLIC_ORIGIN;
 if(env.AMCINOVA_META_CUSTOMER_ENABLED!=='true'||!id(env.AMCINOVA_META_APP_ID)||!id(env.AMCINOVA_META_LOGIN_CONFIG_ID)||!origin||new URL(origin).origin!==origin||!origin.startsWith('https://')||!env.AMCINOVA_META_APP_SECRET)throw fail(503,'Facebook koppelen wordt voorbereid. Je bestaande gegevens blijven bewaard.');
 return {origin,appId:env.AMCINOVA_META_APP_ID,configId:env.AMCINOVA_META_LOGIN_CONFIG_ID,secret:env.AMCINOVA_META_APP_SECRET,version:'v26.0',callback:origin+'/api/customer/meta/callback',box:tokenBox(env.AMCINOVA_META_TOKEN_KEY)};
}
export function registerMetaCustomer(app,{json,env,adminDb,identity,requireProduct,wrap,fetchImpl=fetch}){
 const access=async req=>{const u=await identity(req),product=req.body?.product||req.query?.product;if(!['campaign','admaker','promotie'].includes(product))throw fail(400,'Kies Campagne, AdMaker of Promotie.');await requireProduct(u,product);return {...u,product};};
 const storage=async(table,options)=>{const rows=await adminDb(table,options);if(!Array.isArray(rows))throw Error('Storage unavailable');return rows;};
 const graph=async(c,path,token,params={},method='GET')=>{
  const url=new URL('https://graph.facebook.com/'+c.version+'/'+path),values=new URLSearchParams(params);
  if(token){values.set('appsecret_proof',createHmac('sha256',c.secret).update(token).digest('hex'));}
  if(method==='GET')url.search=values.toString();
  let r,d;try{r=await fetchImpl(url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:values}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});d=await r.json();}catch{throw fail(503,'Facebook is tijdelijk niet bereikbaar. Probeer opnieuw.');}
  if(!r.ok||d.error)throw fail(502,'Facebook heeft de koppeling niet bevestigd. Controleer je paginatoegang en toestemming.');return d;
 };
 const grant=async(u,c)=>{const [g]=await storage('amcinova_meta_grants',{method:'GET',query:'?tenant_id=eq.'+u.id+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=*'});if(!g)throw fail(409,'Log opnieuw in bij Facebook om je pagina te kiezen.');return c.box.open(g.token_cipher,u.id);};
 const pages=async(c,token)=>{const all=[];let after;for(let n=0;n<10;n++){const d=await graph(c,'me/accounts',token,{fields:'id,name,access_token,tasks',limit:'100',...(after?{after}:{})});if(!Array.isArray(d.data))throw Error('Invalid pages');all.push(...d.data.filter(p=>id(p.id)&&typeof p.name==='string'&&typeof p.access_token==='string'&&p.tasks?.includes('MESSAGING')));after=d.paging?.cursors?.after;if(!d.paging?.next)return all;if(typeof after!=='string'||after.length>2000)throw Error('Invalid paging');}throw fail(409,'Te veel pagina’s. Beperk bij Facebook de gekozen pagina’s en probeer opnieuw.');};
 app.post('/api/customer/meta/start',json({limit:'2kb'}),wrap(async(req,res)=>{
  const u=await access(req),c=metaCustomerConfig(env),state=randomBytes(32).toString('base64url');
  await storage('amcinova_meta_states',{method:'DELETE',query:'?tenant_id=eq.'+u.id,prefer:'return=representation'});
  await storage('amcinova_meta_states',{method:'POST',body:{state_hash:hash(state),binding_hash:null,tenant_id:u.id,product:u.product,expires_at:new Date(Date.now()+600000).toISOString()},prefer:'return=representation'});
  res.json({ok:true,url:c.origin+'/api/customer/meta/begin?state='+state});
 }));
 // A top-level navigation sets the binding cookie, avoiding third-party cookies
 // and credentialed CORS between the customer website and the API host.
 app.get('/api/customer/meta/begin',async(req,res)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});try{
  const c=metaCustomerConfig(env),state=req.query.state,binding=randomBytes(32).toString('base64url');
  if(typeof state!=='string'||!/^[\w-]{43}$/.test(state))throw Error('Invalid state');
  const rows=await storage('amcinova_meta_states',{method:'PATCH',query:'?state_hash=eq.'+hash(state)+'&binding_hash=is.null&expires_at=gt.'+encodeURIComponent(new Date().toISOString()),body:{binding_hash:hash(binding)},prefer:'return=representation'});if(rows.length!==1)throw Error('Expired start');
  res.cookie('__Host-amcinova-meta',binding,{secure:true,httpOnly:true,sameSite:'lax',path:'/',maxAge:600000});
  const url=new URL('https://www.facebook.com/'+c.version+'/dialog/oauth');url.search=new URLSearchParams({client_id:c.appId,config_id:c.configId,redirect_uri:c.callback,state,response_type:'code',override_default_response_type:'true'}).toString();res.redirect(303,url.href);
 }catch{res.status(400).type('text/plain').send('De aanmelding is verlopen. Start opnieuw vanuit Amcinova.');}});
 app.get('/api/customer/meta/callback',async(req,res)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  try{
   const c=metaCustomerConfig(env),state=req.query.state,binding=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-amcinova-meta='))?.slice(21);
   if(typeof state!=='string'||!/^[\w-]{43}$/.test(state)||!binding)throw Error('Invalid callback');
   // DELETE RETURNING is the single-use claim, including concurrent callbacks.
   const [s]=await storage('amcinova_meta_states',{method:'DELETE',query:'?state_hash=eq.'+hash(state)+'&binding_hash=eq.'+hash(binding)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()),prefer:'return=representation'});
   if(!s||req.query.error||typeof req.query.code!=='string'||req.query.code.length>4096)throw Error('Denied or expired');
   const token=await graph(c,'oauth/access_token',null,{client_id:c.appId,client_secret:c.secret,redirect_uri:c.callback,code:req.query.code},'POST');
   if(typeof token.access_token!=='string')throw Error('Missing token');
   const permissions=await graph(c,'me/permissions',token.access_token);
   if(!scopes.every(p=>permissions.data?.some(x=>x.permission===p&&x.status==='granted')))throw Error('Missing permission');
   await storage('amcinova_meta_grants',{method:'POST',query:'?on_conflict=tenant_id',prefer:'resolution=merge-duplicates,return=representation',body:{tenant_id:s.tenant_id,token_cipher:c.box.seal(token.access_token,s.tenant_id),expires_at:new Date(Date.now()+600000).toISOString()}});
   res.clearCookie('__Host-amcinova-meta',{secure:true,httpOnly:true,sameSite:'lax',path:'/'});res.redirect(303,c.origin+'/social-connect.html#ready');
  }catch{res.status(400).type('text/plain').send('Facebook koppelen is niet voltooid. Sluit dit venster en probeer opnieuw vanuit Mijn Amcinova.');}
 });
 app.get('/api/customer/meta/pages',wrap(async(req,res)=>{const u=await access(req),c=metaCustomerConfig(env);res.json({ok:true,pages:(await pages(c,await grant(u,c))).map(p=>({id:p.id,name:p.name}))});}));
 app.post('/api/customer/meta/connect',json({limit:'2kb'}),wrap(async(req,res)=>{
  const u=await access(req),c=metaCustomerConfig(env);if(!id(req.body.pageId))throw fail(400,'Kies een Facebookpagina.');
  const page=(await pages(c,await grant(u,c))).find(p=>p.id===req.body.pageId);if(!page)throw fail(403,'Je hebt geen berichtentoegang tot deze pagina.');
  // Global unique page ID reserves ownership before touching Meta. No cross-tenant upsert.
  const existing=await storage('amcinova_meta_connections',{method:'GET',query:'?page_id=eq.'+page.id+'&select=tenant_id'});
  if(existing.length&&existing[0].tenant_id!==u.id)throw fail(409,'Deze pagina is al gekoppeld. Neem contact op met Amcinova.');
  const row={tenant_id:u.id,page_id:page.id,page_name:page.name.slice(0,200),token_cipher:c.box.seal(page.access_token,u.id+':'+page.id),status:'pending',attempt:randomBytes(16).toString('hex')};
  await storage('amcinova_meta_connections',{method:existing.length?'PATCH':'POST',query:existing.length?'?page_id=eq.'+page.id+'&tenant_id=eq.'+u.id:'',body:row,prefer:'return=representation'});
  const result=await graph(c,page.id+'/subscribed_apps',page.access_token,{subscribed_fields:'messages'},'POST');if(result.success!==true)throw fail(502,'Facebook heeft de aanmelding niet bevestigd.');
  const check=await graph(c,page.id+'/subscribed_apps',page.access_token,{fields:'id,subscribed_fields'});if(!check.data?.some(a=>a.id===c.appId&&a.subscribed_fields?.includes('messages')))throw fail(502,'De berichtkoppeling kon niet worden gecontroleerd.');
  const confirmed=await storage('amcinova_meta_connections',{method:'PATCH',query:'?page_id=eq.'+page.id+'&tenant_id=eq.'+u.id+'&status=eq.pending&attempt=eq.'+row.attempt,body:{status:'connected'},prefer:'return=representation'});if(confirmed.length!==1)throw fail(409,'De koppeling is ondertussen gewijzigd. Haal de status opnieuw op.');
  await storage('amcinova_meta_grants',{method:'DELETE',query:'?tenant_id=eq.'+u.id,prefer:'return=representation'});res.json({ok:true});
 }));
 app.get('/api/customer/meta/status',wrap(async(req,res)=>{
  const u=await access(req);const connections=await storage('amcinova_meta_connections',{method:'GET',query:'?tenant_id=eq.'+u.id+'&select=page_id,page_name,status'});
  const receipts=await storage('amcinova_social_dm_receipts',{method:'GET',query:'?tenant_id=eq.'+u.id+'&platform=eq.facebook&message_id=not.like.amcinova-*&select=account_id,received_at&order=received_at.desc&limit=1000'});
  res.json({ok:true,connections,receiptCount:receipts.length,limited:receipts.length===1000,lastReceivedAt:receipts[0]?.received_at||null,qualifiedLeads:0,postAttribution:'unknown'});
 }));
 app.post('/api/customer/meta/disconnect',json({limit:'2kb'}),wrap(async(req,res)=>{
  const u=await access(req),c=metaCustomerConfig(env);if(!id(req.body.pageId))throw fail(400,'Kies een pagina.');
  const [row]=await storage('amcinova_meta_connections',{method:'PATCH',query:'?tenant_id=eq.'+u.id+'&page_id=eq.'+req.body.pageId,body:{status:'disconnected',attempt:randomBytes(16).toString('hex')},prefer:'return=representation'});if(!row)throw fail(404,'Koppeling niet gevonden.');
  const result=await graph(c,row.page_id+'/subscribed_apps',c.box.open(row.token_cipher,u.id+':'+row.page_id),{},'DELETE');if(result.success!==true)throw fail(502,'Ontvangst is gestopt; Facebook ontkoppelen moet opnieuw worden geprobeerd.');
  const removed=await storage('amcinova_meta_connections',{method:'DELETE',query:'?tenant_id=eq.'+u.id+'&page_id=eq.'+row.page_id+'&status=eq.disconnected&attempt=eq.'+row.attempt,prefer:'return=representation'});if(removed.length!==1)throw fail(409,'De koppeling is ondertussen gewijzigd. Controleer de status.');res.json({ok:true});
 }));
}
