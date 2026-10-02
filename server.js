const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_v115_final_2026_gerencia';
const RESEND_FROM = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SUPER_ADMIN_EMAIL = 'admin@klido.com';
const SUPER_ADMIN_PASS = 'Mafe2002@';
const VERIFY_TOKEN = 'klido123';
const ENV_TOKEN = process.env.WHATSAPP_TOKEN || process.env.META_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || process.env.TOKEN || '';
const ENV_PHONE_ID = process.env.WA_PHONE_ID || process.env.PHONE_ID || process.env.PHONE_NUMBER_ID || process.env.WA_PHONE_NUMBER_ID || '1338474282683914';
let fetchFn = global.fetch; if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }
console.log(`[KLIDO v118 AUTOSELECT] TOKEN_LEN=${ENV_TOKEN.length} PHONE=${ENV_PHONE_ID}`);
app.get('/webhook', (req, res) => { const mode = req.query['hub.mode']; const token = req.query['hub.verify_token']; const challenge = req.query['hub.challenge']; if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge); return res.sendStatus(403); });
app.post('/webhook', express.json({limit:'15mb'}), (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value; const phoneId = value?.metadata?.phone_number_id; const messages = value?.messages; const contacts = value?.contacts;
    if (phoneId && messages) {
      const DATA_DIR = path.join(__dirname,'data'); const EMPRESAS_FILE = path.join(DATA_DIR,'empresas.json'); const MENSAJES_DIR = path.join(DATA_DIR,'mensajes'); if (!fs.existsSync(MENSAJES_DIR)) fs.mkdirSync(MENSAJES_DIR,{recursive:true});
      let emps=[]; try{ emps=JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8')); }catch{}; const idx=emps.findIndex(e=>e.waPhoneId===phoneId || e.waPhoneId===ENV_PHONE_ID);
      if(idx!==-1){ const emp=emps[idx]; if(!emp.contactos) emp.contactos=[]; const file=path.join(MENSAJES_DIR, `${emp.id}.json`); let msgs=[]; if(fs.existsSync(file)) try{ msgs=JSON.parse(fs.readFileSync(file,'utf8')); }catch{}; messages.forEach(m=>{ const from=m.from; const name=contacts?.[0]?.profile?.name||'Cliente '+from.slice(-4); if(!emp.contactos.find(c=>c.phone===from)){ emp.contactos.push({id:from,nombre:name,phone:from,tag:'Nuevo',fecha:new Date().toISOString()}); } msgs.push({id:m.id,contactoId:from,from,texto:m.text?.body||`[${m.type}]`,de:'cliente',fecha:new Date().toISOString()}); }); fs.writeFileSync(file, JSON.stringify(msgs.slice(-3000),null,2)); fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(emps,null,2)); }
    } res.sendStatus(200);
  } catch(e){ res.sendStatus(200); }
});
app.use(express.json({limit:'15mb'})); app.use(express.urlencoded({extended:true})); app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Headers','*'); res.header('Access-Control-Allow-Methods','*'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); }); app.use(express.static(path.join(__dirname,'public')));
const DATA_DIR = path.join(__dirname,'data'); const EMPRESAS_FILE = path.join(DATA_DIR,'empresas.json'); const MENSAJES_DIR = path.join(DATA_DIR,'mensajes'); if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); if(!fs.existsSync(MENSAJES_DIR)) fs.mkdirSync(MENSAJES_DIR,{recursive:true}); if(!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE,'[]');
function obtenerEmpresas(){ try{ let emps=JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8')); emps=emps.map(e=>{ if(!e.contactos) e.contactos=[]; if(!e.campanas) e.campanas=[]; if(!e.citas) e.citas=[]; if(!e.equipo) e.equipo=[]; if(!e.waPhoneId) e.waPhoneId=ENV_PHONE_ID; if(!e.waToken) e.waToken=ENV_TOKEN; return e; }); return emps; }catch{ return []; } }
function guardarEmpresas(l){ fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(l,null,2)); }
const codigosRegistro = new Map(); const codigosReset = new Map();
function auth(req,res,next){ const t=(req.headers.authorization||'').replace('Bearer ','').trim()||req.query.token||''; if(!t) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(t,JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Token vencido'}); } }
async function enviarResend(to,subject,html){ if(!RESEND_API_KEY) return {id:'mock'}; const r=await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:RESEND_FROM,to:to.toLowerCase(),subject,html})}); const j=await r.json(); if(!r.ok) throw new Error(j.message); return j; }
app.post('/api/public/solicitar-codigo', async (req,res)=>{ const {email}=req.body; const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosRegistro.set(email.toLowerCase(),{codigo,expira:Date.now()+10*60*1000}); try{ await enviarResend(email.toLowerCase(),`KLIDO ${codigo}`,`<h2>${codigo}</h2>`); res.json({ok:true}); }catch(e){ res.json({ok:true,mensaje:`${codigo}`}); } });
app.post('/api/public/crear-empresa',(req,res)=>{ const {nombre,email,password,plan,codigo,terminos}=req.body; if(!terminos) return res.status(400).json({error:'Acepta'}); const reg=codigosRegistro.get(email.toLowerCase()); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código'}); let emps=obtenerEmpresas(); if(emps.length>=10) return res.status(400).json({error:'Limite'}); if(emps.find(e=>e.email===email.toLowerCase())) return res.status(400).json({error:'Ya existe'}); const nueva={id:'emp_'+Date.now(),nombre,email:email.toLowerCase(),password,plan,estado:'activa',pagado:true,waPhoneId:ENV_PHONE_ID||'',waToken:ENV_TOKEN||'',consumo:{mensajes:0,usuarios:2},equipo:[{id:'jefe_'+Date.now(),nombre,email:email.toLowerCase(),rol:'jefe',password}],contactos:[],campanas:[],citas:[],fechaRegistro:new Date().toISOString()}; emps.push(nueva); guardarEmpresas(emps); codigosRegistro.delete(email.toLowerCase()); res.status(201).json({ok:true}); });
app.post('/api/public/forgot-password', async (req,res)=>{ const {email}=req.body; const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosReset.set(email.toLowerCase(),{codigo,expira:Date.now()+10*60*1000}); try{ await enviarResend(email.toLowerCase(),`Reset ${codigo}`,`<h2>${codigo}</h2>`); res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/public/reset-password',(req,res)=>{ const {email,codigo,nuevaPassword}=req.body; const reg=codigosReset.get(email.toLowerCase()); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código'}); let emps=obtenerEmpresas(); emps=emps.map(e=>{ if(e.email===email.toLowerCase()) e.password=nuevaPassword; e.equipo=e.equipo.map(u=>{ if(u.email===email.toLowerCase()) u.password=nuevaPassword; return u; }); return e; }); guardarEmpresas(emps); codigosReset.delete(email.toLowerCase()); res.json({ok:true}); });
app.post('/api/login',(req,res)=>{ const {email,password}=req.body; const low=email.toLowerCase().trim(); if(low===SUPER_ADMIN_EMAIL.toLowerCase()&&password===SUPER_ADMIN_PASS){ const token=jwt.sign({id:'SUPER',email:SUPER_ADMIN_EMAIL,rol:'super',empresaId:'SUPER'},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{id:'SUPER',nombre:'GERENCIA',email:SUPER_ADMIN_EMAIL,rol:'super'}}); } let emps=obtenerEmpresas(); for(let e of emps){ if(e.email===low&&e.password===password){ const token=jwt.sign({id:e.id,email:e.email,rol:'jefe',plan:e.plan,empresaId:e.id},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{id:e.id,nombre:e.nombre,email:e.email,plan:e.plan,rol:'jefe',empresaId:e.id,empresaNombre:e.nombre}}); } const u=e.equipo.find(u=>u.email===low&&u.password===password); if(u){ const token=jwt.sign({id:u.id,email:u.email,rol:u.rol,plan:e.plan,empresaId:e.id},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{id:u.id,nombre:u.nombre,email:u.email,plan:e.plan,rol:u.rol,empresaId:e.id,empresaNombre:e.nombre}}); } } return res.status(401).json({error:'Credenciales'}); });
app.get('/api/me',auth,(req,res)=>{ if(req.user.rol==='super') return res.json({id:'SUPER',rol:'super'}); const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json({id:req.user.id,empresaId:emp?.id,waPhoneId:emp?.waPhoneId,tokenLen:emp?.waToken?.length||ENV_TOKEN.length}); });

// NUEVO v118: LISTA PLANTILLAS APROBADAS DIRECTO DE META
app.get('/api/meta/plantillas',auth, async (req,res)=>{
  try{
    const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);
    const phoneId=emp?.waPhoneId||ENV_PHONE_ID; const token=emp?.waToken||ENV_TOKEN;
    if(!token) return res.json({ok:false, error:'No token'});
    // 1. Obtener WABA ID desde Phone ID
    let wabaId=null;
    try{
      const r1=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}?fields=whatsapp_business_account`,{headers:{'Authorization':`Bearer ${token}`}});
      const j1=await r1.json(); wabaId=j1?.whatsapp_business_account?.id || j1?.whatsapp_business_account;
      console.log('[META WABA]', JSON.stringify(j1).slice(0,500));
    }catch(e){ console.log('[META WABA ERR]', e.message); }
    if(!wabaId){
      // fallback: intenta directo con phone id (algunas cuentas lo permiten)
      const r=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/message_templates?limit=100`,{headers:{'Authorization':`Bearer ${token}`}});
      const j=await r.json(); if(j.data) { const aprobadas=j.data.filter(t=>t.status==='APPROVED'); return res.json({ok:true, plantillas:aprobadas, source:'phone_id'}); }
      return res.json({ok:false, error:'No WABA', raw:j});
    }
    const r2=await fetchFn(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=100`,{headers:{'Authorization':`Bearer ${token}`}});
    const j2=await r2.json();
    console.log('[META TEMPLATES]', `Total ${j2.data?.length} - ${JSON.stringify(j2).slice(0,1000)}`);
    if(!j2.data) return res.json({ok:false, error:j2.error?.message, raw:j2});
    const aprobadas=j2.data.filter(t=>t.status==='APPROVED');
    res.json({ok:true, plantillas:aprobadas, wabaId});
  }catch(e){ console.error(e); res.json({ok:false, error:e.message}); }
});

app.get('/api/admin/agencias',auth,(req,res)=>{ if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'}); res.json({agencias:obtenerEmpresas()}); });
app.post('/api/admin/bloquear',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.body.agenciaId); if(i!==-1){ emps[i].estado=req.body.estado; emps[i].pagado=req.body.pagado; guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/admin/activar',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.body.agenciaId); if(i!==-1){ emps[i].estado='activa'; emps[i].pagado=true; guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/gerente/desbloquear/:id',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.params.id); if(i!==-1){ emps[i].estado='activa'; emps[i].pagado=true; guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/mensajes',auth, async (req,res)=>{ try{ const {contactoId,texto}=req.body; let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(idx===-1) return res.status(404).json({error:'No empresa'}); const emp=emps[idx]; const phoneIdToUse = emp.waPhoneId || ENV_PHONE_ID; const tokenToUse = emp.waToken || ENV_TOKEN; if(!tokenToUse) return res.status(400).json({error:'No hay token'}); const toClean=contactoId.replace(/\D/g,''); const url=`https://graph.facebook.com/v20.0/${phoneIdToUse}/messages`; const r=await fetchFn(url,{method:'POST',headers:{'Authorization':`Bearer ${tokenToUse}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:toClean,type:'text',text:{body:texto}})}); const j=await r.json(); if(!r.ok) return res.status(400).json({error:j.error?.message, meta:j}); const file=path.join(MENSAJES_DIR, `${emp.id}.json`); let msgs=[]; if(fs.existsSync(file)) try{msgs=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}; msgs.push({id:'msg_'+Date.now(),contactoId:toClean,texto,de:'yo',fecha:new Date().toISOString()}); fs.writeFileSync(file, JSON.stringify(msgs.slice(-3000),null,2)); res.json({ok:true, meta:j}); }catch(e){ res.status(500).json({error:e.message}); } });
app.get('/api/mensajes',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); const file=path.join(MENSAJES_DIR, `${emp?.id}.json`); if(!fs.existsSync(file)) return res.json([]); try{ res.json(JSON.parse(fs.readFileSync(file,'utf8'))); }catch{ res.json([]); } });
app.get('/api/contactos',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.contactos||[]); });
app.post('/api/contactos',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ if(!emps[i].contactos) emps[i].contactos=[]; emps[i].contactos.push({id:Date.now().toString(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/campanas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); if(!emp) return res.json([]); if(!emp.campanas) emp.campanas=[]; res.json(emp.campanas); });
app.post('/api/campanas',auth, async (req,res)=>{
  try{
    let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i===-1) return res.status(404).json({error:'No empresa'});
    if(!emps[i].campanas) emps[i].campanas=[];
    const { nombre, plantilla, lista, contactos, plantillaVars } = req.body;
    let listaNumeros = lista || [];
    let contactosLista = contactos || [];
    let listaNorm = listaNumeros.map(item=>{
      if(typeof item==='object' && item!==null) return {phone:String(item.phone||item.telefono||'').replace(/\D/g,''), nombre:item.nombre||''};
      return {phone:String(item).replace(/\D/g,''), nombre:''};
    }).filter(x=>x.phone.length>=10);
    if(listaNorm.length===0) return res.status(400).json({error:'Lista vacía'});
    const plantillaFinal = String(plantilla||'').trim().toLowerCase();
    if(!plantillaFinal) return res.status(400).json({error:'Selecciona plantilla aprobada'});
    const nueva={id:'camp_'+Date.now(), nombre:nombre||plantillaFinal, plantilla:plantillaFinal, numeros:listaNorm.length, fecha:new Date().toISOString(), estado:'enviando', enviados:0};
    emps[i].campanas.push(nueva); guardarEmpresas(emps);
    console.log(`[CAMPANA AUTO] ${emps[i].nombre} plantilla=${plantillaFinal} nums=${listaNorm.length}`);
    res.json({ok:true, campana:nueva});
    setTimeout(async ()=>{
      try{
        let emps2=obtenerEmpresas(); const emp=emps2.find(e=>e.id===emps[i].id) || emps2[i];
        const phoneId=emp.waPhoneId||ENV_PHONE_ID; const token=emp.waToken||ENV_TOKEN;
        let enviados=0, fallidos=0;
        for(const entry of listaNorm){
          const toClean=entry.phone;
          let vars=[];
          // 1. del Excel
          if(entry.nombre) vars=[entry.nombre];
          if(contactosLista.length>0){ const c=contactosLista.find(cc=>String(cc.phone||'').replace(/\D/g,'')===toClean); if(c?.nombre) vars=[c.nombre]; }
          // 2. si usuario escribió vars manuales (prioridad)
          if(plantillaVars && String(plantillaVars).trim()!==''){ vars=String(plantillaVars).split(',').map(s=>s.trim()).filter(Boolean); }
          // Si sigue vacío para plantillas que exigen 1 var, usa "Cliente" para que no falle
          if(vars.length===0) vars=['Cliente'];
          try{
            const url=`https://graph.facebook.com/v20.0/${phoneId}/messages`;
            let body={messaging_product:'whatsapp', to:toClean, type:'template', template:{name:plantillaFinal, language:{code:'es_CO'}, components:[{type:'body', parameters:vars.map(t=>({type:'text', text:t}))}]}};
            let r=await fetchFn(url,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
            let j=await r.json();
            if(!r.ok){
              // reintenta sin componentes si la plantilla no necesita vars
              body.template.components=[];
              let r2=await fetchFn(url,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
              let j2=await r2.json();
              if(r2.ok){ r=r2; j=j2; } else {
                // reintenta idiomas
                for(const lang of ['es','en_US','en']){
                  body.template.language.code=lang;
                  body.template.components=vars.length>0?[{type:'body', parameters:vars.map(t=>({type:'text', text:t}))}]:[];
                  r=await fetchFn(url,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}); j=await r.json(); if(r.ok) break;
                }
              }
            }
            console.log(`[CAMPANA AUTO] ${toClean} (${vars[0]}) ${plantillaFinal} -> ${r.status} ${JSON.stringify(j).slice(0,600)}`);
            if(r.ok) enviados++; else fallidos++;
            await new Promise(x=>setTimeout(x,1300));
          }catch(err){ fallidos++; }
        }
        let emps3=obtenerEmpresas(); const idx=emps3.findIndex(e=>e.id===emp.id); if(idx!==-1){ const cIdx=emps3[idx].campanas.findIndex(c=>c.id===nueva.id); if(cIdx!==-1){ emps3[idx].campanas[cIdx].enviados=enviados; emps3[idx].campanas[cIdx].fallidos=fallidos; emps3[idx].campanas[cIdx].estado='enviada'; guardarEmpresas(emps3); } }
        console.log(`[CAMPANA FINAL AUTO] ${emp.nombre} ${enviados}/${listaNorm.length}`);
      }catch(e){ console.error(e); }
    },800);
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/equipo',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.equipo||[]); });
app.post('/api/equipo',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ if(!emps[i].equipo) emps[i].equipo=[]; emps[i].equipo.push({id:'user_'+Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.delete('/api/equipo/:uid',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].equipo=emps[i].equipo.filter(u=>u.id!==req.params.uid); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/citas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.citas||[]); });
app.post('/api/citas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ if(!emps[i].citas) emps[i].citas=[]; emps[i].citas.push({id:Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/config/meta',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); const {waPhoneId,waToken}=req.body; if(i!==-1){ if(waPhoneId) emps[i].waPhoneId=waPhoneId; if(waToken) emps[i].waToken=waToken; guardarEmpresas(emps); } res.json({ok:true}); });
app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`KLIDO v118 AUTOSELECT PORT ${PORT} - Plantillas META aprobadas auto`));
