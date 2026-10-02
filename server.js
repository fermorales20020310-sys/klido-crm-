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
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'klido123';

let fetchFn = global.fetch;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }

console.log(`[KLIDO v115.3] TOKEN VERIFY ${VERIFY_TOKEN} GERENCIA ${SUPER_ADMIN_EMAIL} FROM ${RESEND_FROM}`);

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

const codigosRegistro = new Map();
const codigosReset = new Map();

function auth(req,res,next){
  const t=(req.headers.authorization||'').replace('Bearer ','').trim() || req.query.token || '';
  if(!t) return res.status(401).json({error:'No token'});
  try{ req.user=jwt.verify(t,JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Token vencido'}); }
}

async function enviarResend(to,subject,html){
  if(!RESEND_API_KEY) return {id:'mock'};
  const r=await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:RESEND_FROM,to:to.toLowerCase(),subject,html})});
  const j=await r.json(); if(!r.ok) throw new Error(j.message); return j;
}

// WEBHOOK META CON TU TOKEN klido123
app.get('/webhook',(req,res)=>{
  const mode=req.query['hub.mode']; const token=req.query['hub.verify_token']; const challenge=req.query['hub.challenge'];
  console.log('[WEBHOOK VERIFY INTENTO]', mode, token, 'ESPERADO', VERIFY_TOKEN);
  if(mode==='subscribe' && token===VERIFY_TOKEN){ console.log('[WEBHOOK OK CON klido123]'); return res.status(200).send(challenge); }
  console.log('[WEBHOOK FAIL] token incorrecto'); return res.sendStatus(403);
});

app.post('/webhook',express.json(),(req,res)=>{
  try{
    console.log('[WEBHOOK POST]', JSON.stringify(req.body).slice(0,1500));
    const entry=req.body.entry?.[0]; const changes=entry?.changes?.[0]; const value=changes?.value;
    const phoneId=value?.metadata?.phone_number_id;
    const messages=value?.messages;
    if(messages && phoneId){
      let emps=obtenerEmpresas();
      const empIdx=emps.findIndex(e=>e.waPhoneId===phoneId);
      if(empIdx!==-1){
        const empId=emps[empIdx].id;
        const file=path.join(MENSAJES_DIR, `${empId}.json`);
        let msgs=[]; if(fs.existsSync(file)) try{msgs=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
        messages.forEach(m=>{
          msgs.push({ id:m.id, contactoId:m.from, from:m.from, texto:m.text?.body||`[${m.type}]`, tipo:m.type, de:'cliente', fecha:new Date().toISOString(), empresaId:empId });
        });
        fs.writeFileSync(file, JSON.stringify(msgs.slice(-2000),null,2));
        console.log(`[MENSAJE RECIBIDO] Agencia ${emps[empIdx].nombre} de ${messages[0].from} texto ${messages[0].text?.body}`);
      }else{ console.log('[WEBHOOK] Phone ID no coincide con ninguna agencia', phoneId); }
    }
    res.sendStatus(200);
  }catch(e){ console.error('[WEBHOOK ERROR]',e); res.sendStatus(200); }
});

// PUBLIC
app.post('/api/public/solicitar-codigo', async (req,res)=>{
  const {email}=req.body; const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosRegistro.set(email.toLowerCase(),{codigo,expira:Date.now()+10*60*1000});
  try{ await enviarResend(email.toLowerCase(),`KLIDO Código ${codigo}`,`<h2>Código ${codigo}</h2>`); res.json({ok:true,mensaje:`Código enviado a ${email}`}); }catch(e){ res.json({ok:true,mensaje:`Código: ${codigo}`}); }
});
app.post('/api/public/crear-empresa',(req,res)=>{
  const {nombre,email,password,plan,codigo,terminos}=req.body;
  if(!terminos) return res.status(400).json({error:'Acepta términos'});
  const reg=codigosRegistro.get(email.toLowerCase()); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código inválido'});
  let emps=obtenerEmpresas(); if(emps.length>=10) return res.status(400).json({error:'Límite 10'});
  if(emps.find(e=>e.email===email.toLowerCase())) return res.status(400).json({error:'Ya existe'});
  const nueva={id:'emp_'+Date.now(),nombre,email:email.toLowerCase(),password,plan,estado:'activa',pagado:true,codigoActivacion:'KLIDO-'+Date.now(),waPhoneId:'',waToken:'',consumo:{mensajes:0,usuarios:plan==='gold'?10:plan==='premium'?5:2,contactos:0},equipo:[{id:'jefe_'+Date.now(),nombre,email:email.toLowerCase(),rol:'jefe',password}],contactos:[],campanas:[],citas:[],fechaRegistro:new Date().toISOString()};
  emps.push(nueva); guardarEmpresas(emps); codigosRegistro.delete(email.toLowerCase()); res.status(201).json({ok:true});
});
app.post('/api/public/forgot-password', async (req,res)=>{
  const {email}=req.body; const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosReset.set(email.toLowerCase(),{codigo,expira:Date.now()+10*60*1000});
  try{ await enviarResend(email.toLowerCase(),`KLIDO Reset ${codigo}`,`<h2>Código ${codigo}</h2>`); res.json({ok:true,mensaje:`Código enviado a ${email}`}); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/public/reset-password',(req,res)=>{
  const {email,codigo,nuevaPassword}=req.body; const reg=codigosReset.get(email.toLowerCase()); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código inválido'});
  let emps=obtenerEmpresas(); emps=emps.map(e=>{ if(e.email===email.toLowerCase()) e.password=nuevaPassword; e.equipo=e.equipo.map(u=>{ if(u.email===email.toLowerCase()) u.password=nuevaPassword; return u; }); return e; }); guardarEmpresas(emps); codigosReset.delete(email.toLowerCase()); res.json({ok:true});
});
app.post('/api/login',(req,res)=>{
  const {email,password}=req.body; const low=email.toLowerCase().trim(); console.log('[LOGIN]',low);
  if(low===SUPER_ADMIN_EMAIL.toLowerCase()&&password===SUPER_ADMIN_PASS){ const token=jwt.sign({id:'SUPER',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold',empresaId:'SUPER'},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{id:'SUPER',nombre:'GERENCIA',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold'}}); }
  let emps=obtenerEmpresas(); let empFound=null; let userFound=null;
  for(let e of emps){ if(e.email===low&&e.password===password){ empFound=e; userFound={...e,rol:'jefe'}; break; } const u=e.equipo.find(u=>u.email===low&&u.password===password); if(u){ empFound=e; userFound={...u,empresaId:e.id,plan:e.plan,empresaNombre:e.nombre,rol:u.rol}; break; } }
  if(!empFound) return res.status(401).json({error:'Credenciales incorrectas'});
  const token=jwt.sign({id:userFound.id||empFound.id,email:userFound.email,rol:userFound.rol||'jefe',plan:empFound.plan,empresaId:empFound.id},JWT_SECRET,{expiresIn:'7d'});
  return res.json({ok:true,token,user:{id:userFound.id||empFound.id,nombre:userFound.nombre||empFound.nombre,email:userFound.email,plan:empFound.plan,rol:userFound.rol||'jefe',empresaId:empFound.id,empresaNombre:empFound.nombre}});
});
app.get('/api/me',auth,(req,res)=>{
  if(req.user.rol==='super') return res.json({id:'SUPER',nombre:'GERENCIA',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold'});
  const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); if(!emp) return res.status(404).json({error:'No empresa'});
  return res.json({id:req.user.id,nombre:emp.nombre,email:req.user.email,plan:emp.plan,rol:req.user.rol,empresaId:emp.id,empresaNombre:emp.nombre,waPhoneId:emp.waPhoneId});
});
app.get('/api/admin/agencias',auth,(req,res)=>{ if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'}); const emps=obtenerEmpresas(); res.json({total:emps.length,restan:Math.max(0,10-emps.length),wpp:'3133181851',agencias:emps}); });
app.post('/api/gerente/desbloquear/:id',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.params.id); if(i!==-1){ emps[i].estado='activa'; emps[i].pagado=true; guardarEmpresas(emps); } res.json({mensaje:'Desbloqueada'}); });
app.post('/api/admin/bloquear',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.body.agenciaId); if(i!==-1){ emps[i].estado=req.body.estado; emps[i].pagado=req.body.pagado; guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/admin/activar',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.body.agenciaId); if(i!==-1){ emps[i].estado='activa'; emps[i].pagado=true; guardarEmpresas(emps); } res.json({ok:true}); });

// ENVIO REAL META API
app.post('/api/mensajes',auth, async (req,res)=>{
  try{
    const {contactoId,texto} = req.body; if(!contactoId||!texto) return res.status(400).json({error:'Falta contactoId o texto'});
    const emps=obtenerEmpresas(); const empIdx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(empIdx===-1) return res.status(404).json({error:'No empresa'});
    const emp=emps[empIdx];
    if(!emp.waPhoneId||!emp.waToken){ return res.status(400).json({error:`Agencia ${emp.nombre} sin WA Phone ID o Token. Ve a Configuración y guarda: WA Phone ID y META Token permanente`}); }
    const url=`https://graph.facebook.com/v20.0/${emp.waPhoneId}/messages`;
    const body={messaging_product:'whatsapp',to:contactoId.replace(/[^0-9]/g,''),type:'text',text:{body:texto}};
    console.log('[ENVIANDO META]', emp.nombre, 'to', contactoId);
    const r=await fetchFn(url,{method:'POST',headers:{'Authorization':`Bearer ${emp.waToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json(); console.log('[META RESP]', r.status, JSON.stringify(j));
    if(!r.ok) return res.status(400).json({error:`META: ${j.error?.message||JSON.stringify(j)}`});
    const file=path.join(MENSAJES_DIR, `${emp.id}.json`); let msgs=[]; if(fs.existsSync(file)) try{msgs=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
    msgs.push({id:'msg_'+Date.now(),contactoId,from:contactoId,texto,de:'yo',fecha:new Date().toISOString(),empresaId:emp.id});
    fs.writeFileSync(file, JSON.stringify(msgs.slice(-2000),null,2));
    emps[empIdx].consumo.mensajes=(emps[empIdx].consumo.mensajes||0)+1; guardarEmpresas(emps);
    return res.json({ok:true,mensaje:'Enviado META API',meta:j});
  }catch(e){ console.error(e); return res.status(500).json({error:e.message}); }
});
app.get('/api/mensajes',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); if(!emp) return res.json([]); const file=path.join(MENSAJES_DIR, `${emp.id}.json`); if(!fs.existsSync(file)) return res.json([]); try{ return res.json(JSON.parse(fs.readFileSync(file,'utf8'))); }catch{ return res.json([]); } });
app.get('/api/contactos',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.contactos||[]); });
app.post('/api/contactos',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].contactos.push({id:Date.now().toString(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/campanas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.campanas||[]); });
app.post('/api/campanas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].campanas.push({id:'camp_'+Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/equipo',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.equipo||[]); });
app.post('/api/equipo',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].equipo.push({id:'user_'+Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.delete('/api/equipo/:uid',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].equipo=emps[i].equipo.filter(u=>u.id!==req.params.uid); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/citas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.citas||[]); });
app.post('/api/citas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].citas.push({id:Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/config/meta',auth,(req,res)=>{
  let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i===-1) return res.status(404).json({error:'No empresa'});
  const {waPhoneId,waToken}=req.body; if(waPhoneId) emps[i].waPhoneId=waPhoneId; if(waToken) emps[i].waToken=waToken; guardarEmpresas(emps);
  console.log(`[META CONFIG] ${emps[i].nombre} Phone ${waPhoneId} Token ${waToken? 'OK' : 'VACIO'}`);
  res.json({ok:true,mensaje:`Guardado ${emps[i].nombre} - Ya puedes enviar`});
});
app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`KLIDO v115.3 TOKEN klido123 PORT ${PORT} - LISTO MENSAJES REALES`));
