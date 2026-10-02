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
const WPP_VENTAS = '573133181851';

let fetchFn = global.fetch;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }

console.log(`[KLIDO v115.1] GERENCIA ${SUPER_ADMIN_EMAIL} FROM ${RESEND_FROM} KEY ${RESEND_API_KEY? 'OK' : 'FALTA'} WPP ${WPP_VENTAS}`);

app.use(express.json({limit:'15mb'}));
app.use(express.urlencoded({extended:true, limit:'15mb'}));
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Headers','Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname,'public')));

// DATA - RAILWAY JSON + PREPARADO POSTGRES PARA 10 EMPRESAS
const DATA_DIR = path.join(__dirname,'data');
const EMPRESAS_FILE = path.join(DATA_DIR,'empresas.json');
const MENSAJES_DIR = path.join(DATA_DIR,'mensajes');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(MENSAJES_DIR)) fs.mkdirSync(MENSAJES_DIR,{recursive:true});
if(!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE, JSON.stringify([]));

function obtenerEmpresas(){
  try{
    const raw = JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8'));
    return raw.map(e=>({
      id: e.id, nombre: e.nombre, email: (e.email||'').toLowerCase(), password: e.password,
      plan: e.plan||'basico', estado: e.estado||'activa', pagado: e.pagado!==undefined?e.pagado:true,
      codigoActivacion: e.codigoActivacion||('KLIDO-'+Date.now()),
      waPhoneId: e.waPhoneId||'1338474282683914', waToken: e.waToken||'', metaAppId: e.metaAppId||'', metaBusinessId: e.metaBusinessId||'',
      consumo: e.consumo||{mensajes:0,usuarios:e.plan==='gold'?10:e.plan==='premium'?5:2,contactos:0,ia:e.plan!=='basico'},
      equipo: e.equipo||[], contactos: e.contactos||[], campanas: e.campanas||[], citas: e.citas||[], metricas: e.metricas||{ventas:0,chats:0},
      fechaRegistro: e.fechaRegistro||new Date().toISOString()
    }));
  }catch{ return []; }
}
function guardarEmpresas(lista){ fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(lista,null,2)); }

const codigosRegistro = new Map();
const codigosReset = new Map();

function auth(req,res,next){
  const header = req.headers['authorization']||'';
  const token = header.replace('Bearer ','').trim() || req.query.token || req.body.token || '';
  if(!token) return res.status(401).json({error:'No token - ingresa de nuevo'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Token vencido'}); }
}

async function enviarResend(to, subject, html){
  if(!RESEND_API_KEY){
    console.log(`[RESEND MOCK] To:${to} Sub:${subject}`);
    return {id:'mock'};
  }
  const resp = await fetchFn('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({from:RESEND_FROM,to:to.toLowerCase(),subject,html})
  });
  const data = await resp.json();
  console.log('[RESEND]', resp.status, data);
  if(!resp.ok) throw new Error(data.message||JSON.stringify(data));
  return data;
}

// ============ PUBLIC ============
app.post('/api/public/solicitar-codigo', async (req,res)=>{
  const {email}=req.body; if(!email) return res.status(400).json({error:'Correo requerido'});
  const low=email.toLowerCase().trim();
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosRegistro.set(low,{codigo,expira:Date.now()+10*60*1000});
  try{
    await enviarResend(low, `KLIDO - Código ${codigo}`, `
      <div style="font-family:Arial;background:#0f172a;color:#fff;padding:30px;border-radius:12px">
        <img src="https://app.klidoapp.com.co/logo.png" width="130" style="margin-bottom:20px">
        <h2 style="color:#38bdf8">Tu código KLIDO</h2>
        <div style="font-size:36px;letter-spacing:8px;background:#1e293b;padding:20px;text-align:center;border-radius:10px;font-weight:900;margin:20px 0">${codigo}</div>
        <p>Expira en 10 minutos.</p>
        <p style="font-size:11px;color:#94a3b8">KLIDO CRM MultiAgencia - Ley 1581 Habeas Data Colombia - Contrato digital aceptado al registrarse.</p>
      </div>
    `);
    return res.json({ok:true,mensaje:`Código enviado a ${low}`});
  }catch(e){ return res.json({ok:true,mensaje:`Código: ${codigo} (Resend error: ${e.message})`}); }
});

app.post('/api/public/crear-empresa', (req,res)=>{
  const {nombre,email,password,plan,codigo,terminos}=req.body;
  if(!nombre||!email||!password||!plan||!codigo) return res.status(400).json({error:'Todos los campos requeridos'});
  if(!terminos) return res.status(400).json({error:'Debe aceptar Términos, Contrato y Habeas Data Ley 1581'});
  const low=email.toLowerCase().trim();
  const reg=codigosRegistro.get(low);
  if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código incorrecto'});
  if(Date.now()>reg.expira) return res.status(400).json({error:'Código expirado'});
  let emps=obtenerEmpresas();
  if(emps.length>=10) return res.status(400).json({error:'Límite 10 empresas alcanzado. Contacta 3133181851'});
  if(emps.find(e=>e.email===low)) return res.status(400).json({error:'Ya existe empresa con ese correo'});
  const nueva={
    id:'emp_'+Date.now(), nombre, email:low, password, plan,
    estado:'activa', pagado:true,
    codigoActivacion:'KLIDO-'+Math.floor(100000+Math.random()*900000),
    waPhoneId:'', waToken:'', metaAppId:'', metaBusinessId:'',
    consumo:{mensajes:0,usuarios:plan==='gold'?10:plan==='premium'?5:2,contactos:0,ia:plan!=='basico'},
    equipo:[{id:'jefe_'+Date.now(),nombre:nombre,email:low,rol:'jefe',password}],
    contactos:[], campanas:[], citas:[], metricas:{ventas:0,chats:0},
    fechaRegistro:new Date().toISOString()
  };
  emps.push(nueva); guardarEmpresas(emps); codigosRegistro.delete(low);
  return res.status(201).json({ok:true,mensaje:'Empresa creada activa - ya puede ingresar',empresaId:nueva.id});
});

app.post('/api/public/forgot-password', async (req,res)=>{
  const {email}=req.body; if(!email) return res.status(400).json({error:'Correo requerido'});
  const low=email.toLowerCase().trim();
  let emps=obtenerEmpresas();
  const emp=emps.find(e=>e.email===low);
  const equipoUser = emps.find(e=>e.equipo.some(u=>u.email===low));
  if(!emp&&!equipoUser) return res.status(404).json({error:'Correo no registrado en KLIDO'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosReset.set(low,{codigo,expira:Date.now()+10*60*1000});
  try{
    await enviarResend(low, `KLIDO - Restablecer contraseña ${codigo}`, `
      <div style="font-family:Arial;padding:30px"><h2>Restablecer contraseña KLIDO</h2>
      <p>Código: <b style="font-size:30px;letter-spacing:6px">${codigo}</b></p><p>Expira 10 min. Si no fuiste tú, ignora.</p></div>
    `);
    return res.json({ok:true,mensaje:`Código enviado a ${low}`});
  }catch(e){ return res.status(500).json({error:e.message}); }
});

app.post('/api/public/reset-password', (req,res)=>{
  const {email,codigo,nuevaPassword}=req.body; if(!email||!codigo||!nuevaPassword) return res.status(400).json({error:'Faltan datos'});
  const low=email.toLowerCase().trim();
  const reg=codigosReset.get(low); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código inválido'}); if(Date.now()>reg.expira) return res.status(400).json({error:'Código expirado'});
  let emps=obtenerEmpresas(); let found=false;
  emps=emps.map(e=>{
    if(e.email===low){ e.password=nuevaPassword; found=true; }
    e.equipo=e.equipo.map(u=>{ if(u.email===low){ u.password=nuevaPassword; found=true; } return u; });
    return e;
  });
  if(!found) return res.status(404).json({error:'Usuario no encontrado'});
  guardarEmpresas(emps); codigosReset.delete(low);
  return res.json({ok:true,mensaje:'Contraseña actualizada correctamente'});
});

app.post('/api/login',(req,res)=>{
  const {email,password}=req.body; if(!email||!password) return res.status(400).json({error:'Correo y clave requeridos'});
  const low=email.toLowerCase().trim();
  console.log('[LOGIN]',low);
  if(low===SUPER_ADMIN_EMAIL.toLowerCase()&&password===SUPER_ADMIN_PASS){
    const token=jwt.sign({id:'SUPER',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold',empresaId:'SUPER'},JWT_SECRET,{expiresIn:'7d'});
    return res.json({ok:true,token,user:{id:'SUPER',nombre:'GERENCIA AVANZA CONSULTING',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold',estado:'activa'}});
  }
  let emps=obtenerEmpresas();
  let empFound=null; let userFound=null;
  for(let e of emps){
    if(e.email===low&&e.password===password){ empFound=e; userFound={...e, rol:'jefe'}; break; }
    const u=e.equipo.find(u=>u.email===low&&u.password===password);
    if(u){ empFound=e; userFound={...u, empresaId:e.id, plan:e.plan, empresaNombre:e.nombre, rol:u.rol}; break; }
  }
  if(!empFound) return res.status(401).json({error:'Correo o clave incorrecta'});
  if(empFound.estado!=='activa') return res.status(403).json({error:`Empresa ${empFound.estado}. Contacta gerencia 3133181851`});
  if(!empFound.pagado){ empFound.pagado=true; guardarEmpresas(emps); }
  const token=jwt.sign({id:userFound.id||empFound.id,email:userFound.email,rol:userFound.rol||'jefe',plan:empFound.plan,empresaId:empFound.id},JWT_SECRET,{expiresIn:'7d'});
  return res.json({ok:true,token,user:{id:userFound.id||empFound.id,nombre:userFound.nombre||empFound.nombre,email:userFound.email,plan:empFound.plan,rol:userFound.rol||'jefe',empresaId:empFound.id,empresaNombre:empFound.nombre,estado:'activa'}});
});

app.get('/api/me',auth,(req,res)=>{
  if(req.user.rol==='super') return res.json({id:'SUPER',nombre:'GERENCIA AVANZA',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold'});
  const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);
  if(!emp) return res.status(404).json({error:'Empresa no encontrada'});
  const user=emp.equipo.find(u=>u.email===req.user.email)||emp;
  return res.json({id:user.id||emp.id,nombre:user.nombre||emp.nombre,email:user.email,plan:emp.plan,rol:req.user.rol,empresaId:emp.id,empresaNombre:emp.nombre,estado:emp.estado,waPhoneId:emp.waPhoneId,consumo:emp.consumo});
});

// GERENCIA
app.get('/api/admin/agencias',auth,(req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  const emps=obtenerEmpresas();
  return res.json({total:emps.length,restan:Math.max(0,10-emps.length),wpp:WPP_VENTAS,agencias:emps,notificaciones:emps.filter(e=>e.estado!=='activa').map(e=>({empresaId:e.id,nombre:e.nombre,email:e.email,plan:e.plan,fecha:e.fechaRegistro})),historial:[{fecha:new Date().toISOString(),agencias:emps.length}]});
});
app.post('/api/gerente/desbloquear/:id',auth,(req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.params.id); if(idx===-1) return res.status(404).json({error:'No existe'});
  emps[idx].estado='activa'; emps[idx].pagado=true; guardarEmpresas(emps); return res.json({mensaje:'Desbloqueada OK'});
});
app.post('/api/admin/activar',auth,(req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.body.agenciaId); if(idx!==-1){emps[idx].estado='activa';emps[idx].pagado=true;guardarEmpresas(emps);} return res.json({ok:true});
});
app.post('/api/admin/bloquear',auth,(req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.body.agenciaId); if(idx!==-1){emps[idx].estado=req.body.estado;emps[idx].pagado=req.body.pagado;guardarEmpresas(emps);} return res.json({ok:true});
});
app.get('/api/contrato/:id',auth,(req,res)=>{
  const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.params.id);
  res.send(`<html><head><meta charset="UTF-8"><title>Contrato KLIDO</title></head><body style="font-family:Arial;padding:30px"><img src="/logo.png" width="120"><h2>Contrato KLIDO - ${emp?emp.nombre:req.params.id}</h2><p>Ley 1581 Habeas Data Colombia. Plan ${emp?emp.plan:''}. Aceptación términos y condiciones. Responsabilidad multi-agencia sin cruce información. Cada agencia con credenciales META propias sin riesgo baneo. WhatsApp soporte ${WPP_VENTAS}</p><p>Fecha ${new Date().toISOString()}</p><p>Firma digital aceptada en registro.</p></body></html>`);
});

// CRM APIs - POR EMPRESA SIN CRUCE
app.get('/api/mensajes',auth,(req,res)=>{
  const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);
  if(!emp) return res.json([]);
  const file=path.join(MENSAJES_DIR, `${emp.id}.json`);
  if(!fs.existsSync(file)) return res.json([]);
  try{ return res.json(JSON.parse(fs.readFileSync(file,'utf8'))); }catch{ return res.json([]); }
});
app.post('/api/mensajes',auth,(req,res)=>{
  const emps=obtenerEmpresas(); const empId=req.user.empresaId||req.user.id;
  const file=path.join(MENSAJES_DIR, `${empId}.json`);
  let msgs=[]; if(fs.existsSync(file)) try{msgs=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
  msgs.push({id:Date.now(),...req.body,fecha:new Date().toISOString(),empresaId:empId});
  fs.writeFileSync(file,JSON.stringify(msgs.slice(-1000),null,2));
  res.json({ok:true});
});
app.get('/api/contactos',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.contactos||[]); });
app.post('/api/contactos',auth,(req,res)=>{ let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(idx!==-1){ emps[idx].contactos.push({id:Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/campanas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.campanas||[]); });
app.post('/api/campanas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(idx!==-1){ emps[idx].campanas.push({id:'camp_'+Date.now(),...req.body,fecha:new Date().toISOString(),estado:'enviada'}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/equipo',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.equipo||[]); });
app.post('/api/equipo',auth,(req,res)=>{
  if(req.user.rol!=='jefe'&&req.user.rol!=='super') return res.status(403).json({error:'Solo jefe'});
  let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(idx===-1) return res.status(404).json({error:'No empresa'});
  if(emps[idx].equipo.length>=emps[idx].consumo.usuarios) return res.status(400).json({error:`Límite usuarios plan ${emps[idx].plan}`});
  emps[idx].equipo.push({id:'user_'+Date.now(),...req.body}); guardarEmpresas(emps); res.json({ok:true});
});
app.delete('/api/equipo/:uid',auth,(req,res)=>{
  let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(idx!==-1){ emps[idx].equipo=emps[idx].equipo.filter(u=>u.id!==req.params.uid); guardarEmpresas(emps); } res.json({ok:true});
});
app.get('/api/citas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.citas||[]); });
app.post('/api/citas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(idx!==-1){ emps[idx].citas.push({id:Date.now(),...req.body,fechaCreacion:new Date().toISOString()}); guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/config/meta',auth,(req,res)=>{
  let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(idx===-1) return res.status(404).json({error:'No empresa'});
  const {waPhoneId,waToken,metaAppId,metaBusinessId}=req.body;
  if(waPhoneId) emps[idx].waPhoneId=waPhoneId; if(waToken) emps[idx].waToken=waToken; if(metaAppId) emps[idx].metaAppId=metaAppId; if(metaBusinessId) emps[idx].metaBusinessId=metaBusinessId;
  guardarEmpresas(emps); res.json({ok:true,mensaje:'Credenciales META guardadas por agencia sin cruce'});
});

app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`KLIDO v115.1 FINAL TODO COMPLETO PORT ${PORT}`));
