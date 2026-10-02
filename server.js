const express=require('express');const path=require('path');const fs=require('fs');const jwt=require('jsonwebtoken');
const app=express();const PORT=process.env.PORT||8080;
const JWT_SECRET=process.env.JWT_SECRET||'klido_v115_final_2026_gerencia';
const VERIFY_TOKEN='klido123';
const ENV_TOKEN=process.env.WHATSAPP_TOKEN||process.env.META_TOKEN||process.env.WHATSAPP_ACCESS_TOKEN||'';
const ENV_PHONE_ID=process.env.WA_PHONE_ID||process.env.PHONE_ID||'1338474282683914';
let fetchFn=global.fetch;if(!fetchFn){try{fetchFn=require('node-fetch')}catch{}}
console.log(`[KLIDO v120.2 FIX 200 GARANTIZADO] PHONE=${ENV_PHONE_ID}`);
app.get('/webhook',(req,res)=>{const m=req.query['hub.mode'];const t=req.query['hub.verify_token'];const c=req.query['hub.challenge'];if(m==='subscribe'&&t===VERIFY_TOKEN)return res.status(200).send(c);res.sendStatus(403);});
app.post('/webhook',express.json({limit:'15mb'}),(req,res)=>{try{const v=req.body.entry?.[0]?.changes?.[0]?.value;const pid=v?.metadata?.phone_number_id;const msgs=v?.messages;const contacts=v?.contacts;if(pid&&msgs){const DD=path.join(__dirname,'data');const EF=path.join(DD,'empresas.json');const MD=path.join(DD,'mensajes');if(!fs.existsSync(MD))fs.mkdirSync(MD,{recursive:true});let emps=[];try{emps=JSON.parse(fs.readFileSync(EF,'utf8'))}catch{};const idx=emps.findIndex(e=>e.waPhoneId===pid||e.waPhoneId===ENV_PHONE_ID);if(idx!==-1){const emp=emps[idx];if(!emp.contactos)emp.contactos=[];const file=path.join(MD,`${emp.id}.json`);let m=[];if(fs.existsSync(file))try{m=JSON.parse(fs.readFileSync(file,'utf8'))}catch{};msgs.forEach(mm=>{const from=mm.from;const name=contacts?.[0]?.profile?.name||'Cliente '+from.slice(-4);if(!emp.contactos.find(c=>c.phone===from))emp.contactos.push({id:from,nombre:name,phone:from,tag:'Nuevo',fecha:new Date().toISOString()});m.push({id:mm.id,contactoId:from,from,texto:mm.text?.body||`[${mm.type}]`,de:'cliente',fecha:new Date().toISOString()});});fs.writeFileSync(file,JSON.stringify(m.slice(-3000),null,2));fs.writeFileSync(EF,JSON.stringify(emps,null,2));}}res.sendStatus(200)}catch{res.sendStatus(200)}});
app.use(express.json({limit:'15mb'}));app.use(express.urlencoded({extended:true}));app.use((req,res,next)=>{res.header('Access-Control-Allow-Origin','*');res.header('Access-Control-Allow-Headers','*');res.header('Access-Control-Allow-Methods','*');if(req.method==='OPTIONS')return res.sendStatus(200);next()});app.use(express.static(path.join(__dirname,'public')));
const DATA_DIR=path.join(__dirname,'data');const EMPRESAS_FILE=path.join(DATA_DIR,'empresas.json');const MENSAJES_DIR=path.join(DATA_DIR,'mensajes');if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});if(!fs.existsSync(MENSAJES_DIR))fs.mkdirSync(MENSAJES_DIR,{recursive:true});if(!fs.existsSync(EMPRESAS_FILE))fs.writeFileSync(EMPRESAS_FILE,'[]');
function obtenerEmpresas(){try{let e=JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8'));return e.map(x=>{if(!x.contactos)x.contactos=[];if(!x.campanas)x.campanas=[];if(!x.citas)x.citas=[];if(!x.equipo)x.equipo=[];if(!x.waPhoneId)x.waPhoneId=ENV_PHONE_ID;if(!x.waToken)x.waToken=ENV_TOKEN;return x})}catch{return[]}}function guardarEmpresas(l){fs.writeFileSync(EMPRESAS_FILE,JSON.stringify(l,null,2))}
const codigosRegistro=new Map();
function auth(req,res,next){const t=(req.headers.authorization||'').replace('Bearer ','').trim()||req.query.token||'';if(!t)return res.status(401).json({error:'No token'});try{req.user=jwt.verify(t,JWT_SECRET);next()}catch{return res.status(401).json({error:'Token vencido'})}}
app.post('/api/public/solicitar-codigo',async(req,res)=>{const cod=Math.floor(100000+Math.random()*900000).toString();codigosRegistro.set(req.body.email.toLowerCase(),{codigo:cod,expira:Date.now()+600000});res.json({ok:true})});
app.post('/api/public/crear-empresa',(req,res)=>{const{nombre,email,password,plan,codigo,terminos}=req.body;if(!terminos)return res.status(400).json({error:'Acepta'});const reg=codigosRegistro.get(email.toLowerCase());if(!reg||reg.codigo!==codigo)return res.status(400).json({error:'Código'});let emps=obtenerEmpresas();if(emps.find(e=>e.email===email.toLowerCase()))return res.status(400).json({error:'Ya existe'});const nueva={id:'emp_'+Date.now(),nombre,email:email.toLowerCase(),password,plan,estado:'activa',pagado:true,waPhoneId:ENV_PHONE_ID,waToken:ENV_TOKEN,equipo:[{id:'jefe_'+Date.now(),nombre,email:email.toLowerCase(),rol:'jefe',password}],contactos:[],campanas:[],citas:[]};emps.push(nueva);guardarEmpresas(emps);codigosRegistro.delete(email.toLowerCase());res.status(201).json({ok:true})});
app.post('/api/login',(req,res)=>{const{email,password}=req.body;const low=email.toLowerCase().trim();if(low==='admin@klido.com'&&password==='Mafe2002@'){const token=jwt.sign({id:'SUPER',rol:'super',empresaId:'SUPER'},JWT_SECRET,{expiresIn:'7d'});return res.json({ok:true,token,user:{rol:'super'}})}let emps=obtenerEmpresas();for(let e of emps){if(e.email===low&&e.password===password){const token=jwt.sign({id:e.id,rol:'jefe',empresaId:e.id},JWT_SECRET,{expiresIn:'7d'});return res.json({ok:true,token,user:{empresaId:e.id,rol:'jefe'}})}const u=e.equipo.find(u=>u.email===low&&u.password===password);if(u){const token=jwt.sign({id:u.id,rol:u.rol,empresaId:e.id},JWT_SECRET,{expiresIn:'7d'});return res.json({ok:true,token,user:{empresaId:e.id,rol:u.rol}})}}return res.status(401).json({error:'Credenciales'})});
app.get('/api/me',auth,(req,res)=>res.json({ok:true}));
app.get('/api/meta/plantillas',auth,async(req,res)=>{
  try{
    const emps=obtenerEmpresas();const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);
    const phoneId=emp?.waPhoneId||ENV_PHONE_ID;const token=emp?.waToken||ENV_TOKEN;
    try{const r1=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}?fields=whatsapp_business_account`,{headers:{Authorization:`Bearer ${token}`}});const j1=await r1.json();const waba=j1?.whatsapp_business_account?.id;if(waba){const r2=await fetchFn(`https://graph.facebook.com/v20.0/${waba}/message_templates?limit=100`,{headers:{Authorization:`Bearer ${token}`}});const j2=await r2.json();if(j2.data){return res.json({ok:true,plantillas:j2.data.filter(t=>t.status==='APPROVED')})}}}catch{}
    try{const r3=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/message_templates?limit=100`,{headers:{Authorization:`Bearer ${token}`}});const j3=await r3.json();if(j3.data){return res.json({ok:true,plantillas:j3.data.filter(t=>t.status==='APPROVED')})}}catch{}
    return res.json({ok:true,plantillas:[{name:'acol_invitacion_congreso',language:'es_CO',status:'APPROVED'}]});
  }catch(e){res.json({ok:false,error:e.message})}
});
app.get('/api/campanas',auth,(req,res)=>{const emps=obtenerEmpresas();const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);res.json(emp?.campanas||[])});
app.post('/api/campanas/:id/pausar',auth,(req,res)=>{let emps=obtenerEmpresas();const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id);if(i!==-1){const c=emps[i].campanas.find(c=>c.id===req.params.id);if(c){c.pausada=true;c.estado='pausada';guardarEmpresas(emps);}}res.json({ok:true})});
app.post('/api/campanas/:id/reanudar',auth,(req,res)=>{let emps=obtenerEmpresas();const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id);if(i!==-1){const c=emps[i].campanas.find(c=>c.id===req.params.id);if(c){c.pausada=false;c.estado='enviando';guardarEmpresas(emps);}}res.json({ok:true})});

async function getParamNames(plantillaName, phoneId, token){
  try{
    let wabaId=null;
    try{const r=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}?fields=whatsapp_business_account`,{headers:{Authorization:`Bearer ${token}`}});const j=await r.json();wabaId=j?.whatsapp_business_account?.id;}catch{}
    const url=wabaId?`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=${plantillaName}&limit=30`:`https://graph.facebook.com/v20.0/${phoneId}/message_templates?name=${plantillaName}&limit=30`;
    const r=await fetchFn(url,{headers:{Authorization:`Bearer ${token}`}});
    const j=await r.json();
    if(j.data && j.data.length>0){
      const tpl=j.data.find(t=>t.name===plantillaName)||j.data[0];
      let names=[];
      (tpl.components||[]).forEach(comp=>{
        if(comp.text){
          const matches=[...comp.text.matchAll(/\{\{([^}]+)\}\}/g)];
          matches.forEach(m=>names.push(m[1].trim()));
        }
      });
      console.log(`[TEMPLATE PARAMS v120.2] ${plantillaName} ->`,names);
      return names;
    }
  }catch(e){console.log('getParamNames error',e.message)}
  return [];
}

app.post('/api/campanas',auth,async(req,res)=>{
  let emps=obtenerEmpresas();const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id);if(idx===-1)return res.status(404).json({error:'No empresa'});if(!emps[idx].campanas)emps[idx].campanas=[];
  const{nombre,plantilla,plantillaIdioma,lista,contactos,plantillaVars,headerImageUrl}=req.body;
  let norm=(lista||[]).map(x=>typeof x==='object'?{phone:String(x.phone||'').replace(/\D/g,''),nombre:x.nombre||''}:{phone:String(x).replace(/\D/g,''),nombre:''}).filter(x=>x.phone.length>=10);
  if(norm.length===0)return res.status(400).json({error:'Lista vacia'});
  const camp={id:'camp_'+Date.now(),nombre:nombre||plantilla,plantilla,plantillaIdioma,total:norm.length,enviados:0,fallidos:0,estado:'enviando',pausada:false,fecha:new Date().toISOString(),progreso:0};
  emps[idx].campanas.push(camp);guardarEmpresas(emps);res.json({ok:true,campana:camp});
  setTimeout(async()=>{
    try{
      let emps2=obtenerEmpresas();const emp=emps2.find(e=>e.id===emps[idx].id)||emps2[idx];
      const phoneId=emp.waPhoneId||ENV_PHONE_ID;const token=emp.waToken||ENV_TOKEN;
      const paramNames = await getParamNames(plantilla, phoneId, token);
      for(const entry of norm){
        while(true){let chk=obtenerEmpresas();let ee=chk.find(x=>x.id===emp.id);let cc=ee?.campanas.find(x=>x.id===camp.id);if(cc?.pausada){await new Promise(r=>setTimeout(r,3000));continue}break;}
        let vars=[];if(entry.nombre)vars=[entry.nombre];if(contactos){const f=contactos.find(cc=>String(cc.phone||'').replace(/\D/g,'')===entry.phone);if(f?.nombre)vars=[f.nombre]}if(plantillaVars&&String(plantillaVars).trim()!=='')vars=String(plantillaVars).split(',').map(s=>s.trim()).filter(Boolean);if(vars.length===0)vars=['Cliente'];
        try{
          let success=false; let lastJson=null;
          // INTENTO 1: con parameter_name reales de META
          if(paramNames.length>0){
            let comps=[];if(headerImageUrl)comps.push({type:'header',parameters:[{type:'image',image:{link:headerImageUrl}}]});
            comps.push({type:'body',parameters:vars.map((t,i)=>({type:'text',parameter_name:paramNames[i]||paramNames[0],text:String(t).slice(0,100)}))});
            let payload={messaging_product:'whatsapp',to:entry.phone,type:'template',template:{name:plantilla,language:{code:plantillaIdioma||'es_CO'},components:comps}};
            let r=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
            let j=await r.json(); lastJson=j;
            if(r.ok){success=true; console.log(`[ENVIO v120.2 OK INTENTO 1 REAL NAME] ${entry.phone} -> 200 ${j.messages?.[0]?.id||''}`);}
            else console.log(`[INTENTO 1 FAIL] ${r.status} ${JSON.stringify(j).slice(0,600)}`);
          }
          // INTENTO 2: numerico "1","2" (fallback para plantillas viejas)
          if(!success){
            let comps=[];if(headerImageUrl)comps.push({type:'header',parameters:[{type:'image',image:{link:headerImageUrl}}]});
            comps.push({type:'body',parameters:vars.map((t,i)=>({type:'text',parameter_name:(i+1).toString(),text:String(t).slice(0,100)}))});
            let payload={messaging_product:'whatsapp',to:entry.phone,type:'template',template:{name:plantilla,language:{code:plantillaIdioma||'es_CO'},components:comps}};
            let r=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
            let j=await r.json(); lastJson=j;
            if(r.ok){success=true; console.log(`[ENVIO v120.2 OK INTENTO 2 NUMERICO] ${entry.phone} -> 200`);}
            else console.log(`[INTENTO 2 FAIL] ${r.status} ${JSON.stringify(j).slice(0,600)}`);
          }
          // INTENTO 3: sin parameters (por si tu plantilla no tiene {{ }})
          if(!success){
            let payload={messaging_product:'whatsapp',to:entry.phone,type:'template',template:{name:plantilla,language:{code:plantillaIdioma||'es_CO'}}};
            let r=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
            let j=await r.json(); lastJson=j;
            if(r.ok){success=true; console.log(`[ENVIO v120.2 OK INTENTO 3 SIN VARS] ${entry.phone} -> 200`);}
            else console.log(`[INTENTO 3 FAIL] ${r.status} ${JSON.stringify(j).slice(0,600)}`);
          }
          let emps3=obtenerEmpresas();let i3=emps3.findIndex(x=>x.id===emp.id);if(i3!==-1){let cI=emps3[i3].campanas.findIndex(x=>x.id===camp.id);if(cI!==-1){if(success)emps3[i3].campanas[cI].enviados++;else emps3[i3].campanas[cI].fallidos++;emps3[i3].campanas[cI].progreso=Math.round((emps3[i3].campanas[cI].enviados+emps3[i3].campanas[cI].fallidos)/emps3[i3].campanas[cI].total*100);guardarEmpresas(emps3)}}
        }catch(e){console.log('ERR',e.message)}
        await new Promise(r=>setTimeout(r,1800));
      }
      let final=obtenerEmpresas();let iF=final.findIndex(x=>x.id===emp.id);if(iF!==-1){let cF=final[iF].campanas.findIndex(x=>x.id===camp.id);if(cF!==-1){final[iF].campanas[cF].estado='enviada';final[iF].campanas[cF].progreso=100;guardarEmpresas(final)}}
      console.log(`[FINAL v120.2] Campaña ${camp.id} terminada`);
    }catch(e){console.error(e)}
  },800);
});
app.get('/api/mensajes',auth,(req,res)=>{const emps=obtenerEmpresas();const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);const file=path.join(MENSAJES_DIR,`${emp?.id}.json`);if(!fs.existsSync(file))return res.json([]);try{res.json(JSON.parse(fs.readFileSync(file,'utf8')))}catch{res.json([])}});
app.get('/api/contactos',auth,(req,res)=>{const emps=obtenerEmpresas();const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);res.json(emp?.contactos||[])});
app.get('/api/equipo',auth,(req,res)=>{const emps=obtenerEmpresas();const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);res.json(emp?.equipo||[])});
app.post('/api/equipo',auth,(req,res)=>{let emps=obtenerEmpresas();const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id);if(i!==-1){if(!emps[i].equipo)emps[i].equipo=[];emps[i].equipo.push({id:'user_'+Date.now(),...req.body});guardarEmpresas(emps)}res.json({ok:true})});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`KLIDO v120.2 FIX 200 GARANTIZADO PORT ${PORT}`));
