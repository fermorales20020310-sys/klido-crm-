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

let fetchFn = global.fetch;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }

console.log(`[KLIDO v115.9 FINAL] VERIFY=${VERIFY_TOKEN} TOKEN_60D_OK PORT=${PORT} WEBHOOK=https://app.klidoapp.com.co/webhook`);

// ========== WEBHOOK META - PRIMERO, NO MOVER ==========
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log(`[WEBHOOK GET] mode=${mode} token=${token} challenge=${challenge}`);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log(`[WEBHOOK VERIFICADO OK ${VERIFY_TOKEN}]`);
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', express.json({limit:'15mb'}), (req, res) => {
  try {
    console.log('[WEBHOOK POST]', JSON.stringify(req.body).substring(0,2500));
    const entry = req.body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const phoneId = value?.metadata?.phone_number_id;
    const messages = value?.messages;
    const contacts = value?.contacts;

    if (phoneId && messages && messages.length>0) {
      const DATA_DIR = path.join(__dirname,'data');
      const EMPRESAS_FILE = path.join(DATA_DIR,'empresas.json');
      const MENSAJES_DIR = path.join(DATA_DIR,'mensajes');
      if (!fs.existsSync(MENSAJES_DIR)) fs.mkdirSync(MENSAJES_DIR,{recursive:true});
      let emps=[]; try{ emps=JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8')); }catch{}
      const idx=emps.findIndex(e=>e.waPhoneId===phoneId);
      if(idx===-1){
        console.log(`[WEBHOOK] PhoneID ${phoneId} no encontrado en agencias`);
      }else{
        const emp=emps[idx];
        if(!emp.contactos) emp.contactos=[];
        const file=path.join(MENSAJES_DIR, `${emp.id}.json`);
        let msgs=[]; if(fs.existsSync(file)) try{ msgs=JSON.parse(fs.readFileSync(file,'utf8')); }catch{}

        messages.forEach(m=>{
          const from=m.from;
          const name=contacts?.[0]?.profile?.name || 'Cliente '+from.slice(-4);
          if(!emp.contactos.find(c=>c.phone===from || c.id===from)){
            emp.contactos.push({id:from, nombre:name, phone:from, tag:'Nuevo - Inbox', fecha:new Date().toISOString()});
            console.log(`[CONTACTO AUTO-CREADO] ${name} ${from} en ${emp.nombre}`);
          }
          msgs.push({id:m.id, contactoId:from, from:from, texto:m.text?.body||`[${m.type}]`, tipo:m.type, de:'cliente', fecha:new Date().toISOString(), empresaId:emp.id});
        });
        fs.writeFileSync(file, JSON.stringify(msgs.slice(-3000),null,2));
        fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(emps,null,2));
        console.log(`[INBOX OK] ${emp.nombre} nuevo mensaje de ${messages[0].from}: ${messages[0].text?.body}`);
      }
    }
    res.sendStatus(200);
  } catch(e){ console.error('[WEBHOOK ERROR]',e); res.sendStatus(200); }
});

// ========== MIDDLEWARE ==========
app.use(express.json({limit:'15mb'}));
app.use(express.urlencoded({extended:true, limit:'15mb'}));
app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Headers','*'); res.header('Access-Control-Allow-Methods','*'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); });
app.use(express.static(path.join(__dirname,'public')));

const DATA_DIR = path.join(__dirname,'data');
const EMPRESAS_FILE = path.join(DATA_DIR,'empresas.json');
const MENSAJES_DIR = path.join(DATA_DIR,'mensajes');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(MENSAJES_DIR)) fs.mkdirSync(MENSAJES_DIR,{recursive:true});
if(!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE,'[]');

function obtenerEmpresas(){ try{ return JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8')); }catch{ return []; } }
function guardarEmpresas(l){ fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(l,null,2)); }
const codigosRegistro = new Map(); const codigosReset = new Map();
function auth(req,res,next){ const t=(req.headers.authorization||'').replace('Bearer ','').trim()||req.query.token||''; if(!t) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(t,JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Token vencido'}); } }
async function enviarResend(to,subject,html){ if(!RESEND_API_KEY) return {id:'mock'}; const r=await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:RESEND_FROM,to:to.toLowerCase(),subject,html})}); const j=await r.json(); if(!r.ok) throw new Error(j.message); return j; }

// ========== PUBLIC + LOGIN (SIN TOCAR LO QUE YA TIENES) ==========
app.post('/api/public/solicitar-codigo', async (req,res)=>{ const {email}=req.body; const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosRegistro.set(email.toLowerCase(),{codigo,expira:Date.now()+10*60*1000}); try{ await enviarResend(email.toLowerCase(),`KLIDO Código ${codigo}`,`<h2>${codigo}</h2><p>Expira 10 min</p>`); res.json({ok:true,mensaje:`Código enviado a ${email}`}); }catch(e){ res.json({ok:true,mensaje:`Código: ${codigo}`}); } });
app.post('/api/public/crear-empresa',(req,res)=>{ const {nombre,email,password,plan,codigo,terminos}=req.body; if(!terminos) return res.status(400).json({error:'Acepta términos'}); const reg=codigosRegistro.get(email.toLowerCase()); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código inválido'}); let emps=obtenerEmpresas(); if(emps.length>=10) return res.status(400).json({error:'Límite 10'}); if(emps.find(e=>e.email===email.toLowerCase())) return res.status(400).json({error:'Ya existe'}); const nueva={id:'emp_'+Date.now(),nombre,email:email.toLowerCase(),password,plan,estado:'activa',pagado:true,codigoActivacion:'KLIDO-'+Date.now(),waPhoneId:'',waToken:'',consumo:{mensajes:0,usuarios:plan==='gold'?10:plan==='premium'?5:2,contactos:0},equipo:[{id:'jefe_'+Date.now(),nombre,email:email.toLowerCase(),rol:'jefe',password}],contactos:[],campanas:[],citas:[],fechaRegistro:new Date().toISOString()}; emps.push(nueva); guardarEmpresas(emps); codigosRegistro.delete(email.toLowerCase()); res.status(201).json({ok:true}); });
app.post('/api/public/forgot-password', async (req,res)=>{ const {email}=req.body; const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosReset.set(email.toLowerCase(),{codigo,expira:Date.now()+10*60*1000}); try{ await enviarResend(email.toLowerCase(),`KLIDO Reset ${codigo}`,`<h2>${codigo}</h2>`); res.json({ok:true,mensaje:`Código enviado`}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/public/reset-password',(req,res)=>{ const {email,codigo,nuevaPassword}=req.body; const reg=codigosReset.get(email.toLowerCase()); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código inválido'}); let emps=obtenerEmpresas(); emps=emps.map(e=>{ if(e.email===email.toLowerCase()) e.password=nuevaPassword; e.equipo=e.equipo.map(u=>{ if(u.email===email.toLowerCase()) u.password=nuevaPassword; return u; }); return e; }); guardarEmpresas(emps); codigosReset.delete(email.toLowerCase()); res.json({ok:true}); });
app.post('/api/login',(req,res)=>{ const {email,password}=req.body; const low=email.toLowerCase().trim(); console.log('[LOGIN]',low); if(low===SUPER_ADMIN_EMAIL.toLowerCase()&&password===SUPER_ADMIN_PASS){ const token=jwt.sign({id:'SUPER',email:SUPER_ADMIN_EMAIL,rol:'super',empresaId:'SUPER'},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{id:'SUPER',nombre:'GERENCIA',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold'}}); } let emps=obtenerEmpresas(); for(let e of emps){ if(e.email===low&&e.password===password){ const token=jwt.sign({id:e.id,email:e.email,rol:'jefe',plan:e.plan,empresaId:e.id},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{id:e.id,nombre:e.nombre,email:e.email,plan:e.plan,rol:'jefe',empresaId:e.id,empresaNombre:e.nombre}}); } const u=e.equipo.find(u=>u.email===low&&u.password===password); if(u){ const token=jwt.sign({id:u.id,email:u.email,rol:u.rol,plan:e.plan,empresaId:e.id},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{id:u.id,nombre:u.nombre,email:u.email,plan:e.plan,rol:u.rol,empresaId:e.id,empresaNombre:e.nombre}}); } } return res.status(401).json({error:'Credenciales incorrectas'}); });
app.get('/api/me',auth,(req,res)=>{ if(req.user.rol==='super') return res.json({id:'SUPER',rol:'super',email:SUPER_ADMIN_EMAIL}); const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); if(!emp) return res.status(404).json({error:'No empresa'}); res.json({id:req.user.id,nombre:emp.nombre,email:req.user.email,plan:emp.plan,rol:req.user.rol,empresaId:emp.id,empresaNombre:emp.nombre,waPhoneId:emp.waPhoneId||'VACIO',waToken:emp.waToken?'CONFIGURADO':'VACIO'}); });
app.get('/api/admin/agencias',auth,(req,res)=>{ if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'}); const emps=obtenerEmpresas(); res.json({total:emps.length,restan:Math.max(0,10-emps.length),agencias:emps}); });
app.post('/api/gerente/desbloquear/:id',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.params.id); if(i!==-1){ emps[i].estado='activa'; emps[i].pagado=true; guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/admin/bloquear',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.body.agenciaId); if(i!==-1){ emps[i].estado=req.body.estado; emps[i].pagado=req.body.pagado; guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/admin/activar',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.body.agenciaId); if(i!==-1){ emps[i].estado='activa'; emps[i].pagado=true; guardarEmpresas(emps); } res.json({ok:true}); });

// ========== CRM - ENVIO REAL FUNCIONAL ==========
app.post('/api/mensajes',auth, async (req,res)=>{
  try{
    const {contactoId,texto}=req.body;
    if(!contactoId||!texto) return res.status(400).json({error:'Falta contacto o texto'});
    let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id);
    if(idx===-1) return res.status(404).json({error:'Empresa no encontrada'});
    const emp=emps[idx];
    console.log(`[ENVIO INTENTO] ${emp.nombre} -> ${contactoId} : ${texto}`);
    console.log(`[ENVIO CREDENCIALES] PhoneID=${emp.waPhoneId} TokenLen=${emp.waToken?.length||0}`);

    if(!emp.waPhoneId || emp.waPhoneId==='VACIO' || emp.waPhoneId.length<10){
      return res.status(400).json({error:`Configura WA Phone ID en Configuración. Debe ser 1338474282683914 para Acol. Actual: ${emp.waPhoneId}`});
    }
    if(!emp.waToken || emp.waToken.length<50){
      return res.status(400).json({error:`Configura TOKEN permanente en Configuración. Actual vacío o corto.`});
    }

    const toClean=contactoId.replace(/\D/g,'');
    const url=`https://graph.facebook.com/v20.0/${emp.waPhoneId}/messages`;
    const payload={messaging_product:'whatsapp',to:toClean,type:'text',text:{body:texto}};

    console.log('[META REQUEST]', url, payload);
    const r=await fetchFn(url,{method:'POST',headers:{'Authorization':`Bearer ${emp.waToken}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json();
    console.log('[META RESPONSE]', r.status, JSON.stringify(j));

    if(!r.ok){
      if(j.error?.code===190) return res.status(400).json({error:`TOKEN VENCIDO (60 días expiró). Genera TOKEN PERMANENTE de Usuario de Sistema en business.facebook.com. Detalle: ${j.error.message}`, meta:j});
      return res.status(400).json({error:`META dice: ${j.error?.message||JSON.stringify(j)}`, meta:j, code:j.error?.code});
    }

    const file=path.join(MENSAJES_DIR, `${emp.id}.json`);
    let msgs=[]; if(fs.existsSync(file)) try{msgs=JSON.parse(fs.readFileSync(file,'utf8'))}catch{};
    msgs.push({id:'msg_'+Date.now(), contactoId:toClean, texto, de:'yo', fecha:new Date().toISOString(), empresaId:emp.id, metaId:j.messages?.[0]?.id});
    fs.writeFileSync(file, JSON.stringify(msgs.slice(-3000),null,2));
    emps[idx].consumo.mensajes=(emps[idx].consumo.mensajes||0)+1; guardarEmpresas(emps);
    console.log(`[ENVIO OK] ${emp.nombre} -> ${toClean} wamid ${j.messages?.[0]?.id}`);
    res.json({ok:true, mensaje:'Enviado real WhatsApp', meta:j});
  }catch(e){ console.error('[ENVIO ERROR]',e); res.status(500).json({error:e.message}); }
});

app.get('/api/mensajes',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); const file=path.join(MENSAJES_DIR, `${emp?.id}.json`); if(!fs.existsSync(file)) return res.json([]); try{ res.json(JSON.parse(fs.readFileSync(file,'utf8'))); }catch{ res.json([]); } });
app.get('/api/contactos',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.contactos||[]); });
app.post('/api/contactos',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].contactos.push({id:Date.now().toString(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/campanas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.campanas||[]); });
app.post('/api/campanas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].campanas.push({id:'camp_'+Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/equipo',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.equipo||[]); });
app.post('/api/equipo',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].equipo.push({id:'user_'+Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.delete('/api/equipo/:uid',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].equipo=emps[i].equipo.filter(u=>u.id!==req.params.uid); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/citas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.citas||[]); });
app.post('/api/citas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].citas.push({id:Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/config/meta',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i===-1) return res.status(404).json({error:'No empresa'}); const {waPhoneId,waToken}=req.body; if(waPhoneId) emps[i].waPhoneId=waPhoneId.trim(); if(waToken) emps[i].waToken=waToken.trim(); guardarEmpresas(emps); console.log(`[META CONFIG GUARDADA] ${emps[i].nombre} Phone ${emps[i].waPhoneId} TokenLen ${emps[i].waToken.length}`); res.json({ok:true,mensaje:`Guardado ${emps[i].nombre} - Ya puedes enviar`}); });

// DEBUG RAPIDO
app.get('/api/debug/test-envio/:numero',auth, async (req,res)=>{
  let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(idx===-1) return res.status(404).json({error:'No empresa'}); const emp=emps[idx]; const to=req.params.numero.replace(/\D/g,''); const url=`https://graph.facebook.com/v20.0/${emp.waPhoneId}/messages`;
  try{ const r=await fetchFn(url,{method:'POST',headers:{'Authorization':`Bearer ${emp.waToken}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:'Test KLIDO v115.9 - envio ok'}})}); const j=await r.json(); console.log('[TEST META]',r.status,j); res.json({status:r.status,phoneId:emp.waPhoneId,to,meta:j}); }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`KLIDO v115.9 FINAL FUNCIONAL PORT ${PORT} - INBOX+ENVIO REAL LISTO`));
