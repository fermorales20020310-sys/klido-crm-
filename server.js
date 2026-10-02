const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_secret_key_v112_pro';
const RESEND_FROM_FIXED = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SUPER_ADMIN_EMAIL = 'admin@klido.com';
const SUPER_ADMIN_PASS = 'Mafe2002@';
let fetchFn = global.fetch; if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }
app.use(express.json()); app.use(express.urlencoded({ extended: true })); app.use(express.static(path.join(__dirname, 'public')));
const codigosVerificacion = new Map();
const DATA_DIR = path.join(__dirname, 'data'); const EMPRESAS_FILE = path.join(DATA_DIR, 'empresas.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE, JSON.stringify([]));
function obtenerEmpresas(){ try{ return JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8')); }catch{ return []; } }
function guardarEmpresas(e){ fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(e,null,2)); console.log('[GUARDADO]', e.length, 'empresas'); }
function auth(req,res,next){ const h=req.headers['authorization']||''; const token=h.replace('Bearer ','').trim(); if(!token) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(token,JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Token inválido'}); } }

// SOLICITAR CODIGO
app.post('/api/public/solicitar-codigo', async (req,res)=>{
  const {email}=req.body; if(!email) return res.status(400).json({error:'Correo requerido'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosVerificacion.set(email.toLowerCase(),{codigo,expira:Date.now()+10*60*1000});
  if(RESEND_API_KEY&&fetchFn){ try{ const r=await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:RESEND_FROM_FIXED,to:email.toLowerCase(),subject:`KLIDO - Código ${codigo}`,html:`<h2>Código ${codigo}</h2><p>Expira 10 min</p>`})}); const j=await r.json(); if(r.ok) return res.json({ok:true}); return res.status(500).json({error:j.message}); }catch(e){ return res.status(500).json({error:e.message}); } }
  return res.json({ok:true,mensaje:`Código: ${codigo}`});
});
app.post('/api/public/crear-empresa',(req,res)=>{
  const {nombre,email,password,plan,codigo}=req.body;
  const reg=codigosVerificacion.get(email.toLowerCase()); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código incorrecto'});
  let empresas=obtenerEmpresas(); if(empresas.find(e=>e.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Ya existe'});
  const nueva={id:'AG-'+Date.now(),nombre,email:email.toLowerCase(),password,plan,estado:'pendiente_gerente',pagado:false,codigoActivacion:'',waPhoneId:'1338474282683914',consumo:{mensajes:0,usuarios:plan==='gold'?10:plan==='premium'?5:2,contactos:0},fechaRegistro:new Date().toISOString()};
  empresas.push(nueva); guardarEmpresas(empresas); codigosVerificacion.delete(email.toLowerCase());
  return res.status(201).json({ok:true});
});

// LOGIN FIX v113 - SIN LOOP
app.post('/api/login',(req,res)=>{
  const {email,password}=req.body; console.log('[LOGIN INTENTO]',email);
  if(email.toLowerCase()===SUPER_ADMIN_EMAIL.toLowerCase() && password===SUPER_ADMIN_PASS){
    const token=jwt.sign({id:'SUPER-ADMIN',email:SUPER_ADMIN_EMAIL,plan:'gold',rol:'super'},JWT_SECRET,{expiresIn:'24h'});
    return res.json({ok:true,token,user:{id:'SUPER-ADMIN',nombre:'GERENTE KLIDO',email:SUPER_ADMIN_EMAIL,plan:'gold',rol:'super'}});
  }
  let empresas=obtenerEmpresas();
  const emp=empresas.find(e=>e.email.toLowerCase()===email.toLowerCase() && e.password===password);
  if(!emp){ console.log('[LOGIN FAIL] credenciales',email); return res.status(401).json({error:'Credenciales inválidas'}); }
  console.log('[LOGIN EMPRESA]',emp.email,emp.estado,emp.pagado);
  if(emp.estado!=='activa'){
    return res.status(403).json({error:`Empresa en estado ${emp.estado}. Debe ser activada en /admin.html por gerencia`});
  }
  // FIX: FORZAR PAGADO TRUE SI ESTA ACTIVA
  if(emp.estado==='activa' &&!emp.pagado){
    emp.pagado=true; guardarEmpresas(empresas);
  }
  const token=jwt.sign({id:emp.id,email:emp.email,plan:emp.plan,rol:'agencia'},JWT_SECRET,{expiresIn:'24h'});
  return res.json({ok:true,token,user:{id:emp.id,nombre:emp.nombre,email:emp.email,plan:emp.plan,rol:'agencia'}});
});

app.get('/api/admin/agencias',auth,(req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  const empresas=obtenerEmpresas();
  return res.json({total:empresas.length,restan:Math.max(0,10-empresas.length),wpp:'3133181851',agencias:empresas,notificaciones:empresas.filter(e=>e.estado!=='activa').map(e=>({empresaId:e.id,nombre:e.nombre,email:e.email,plan:e.plan,fecha:e.fechaRegistro})),historial:[{fecha:new Date().toISOString(),agencias:empresas.length}]});
});
app.post('/api/admin/activar',auth,(req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  const {agenciaId}=req.body; let empresas=obtenerEmpresas(); const idx=empresas.findIndex(e=>e.id===agenciaId);
  if(idx===-1) return res.status(404).json({error:'No existe'});
  empresas[idx].estado='activa'; empresas[idx].pagado=true; empresas[idx].codigoActivacion='KLIDO-'+Math.floor(100000+Math.random()*900000).toString();
  guardarEmpresas(empresas);
  console.log('[ACTIVADA]',empresas[idx].email,empresas[idx].estado);
  return res.json({ok:true,mensaje:`${empresas[idx].nombre} ACTIVADA - ya puede ingresar`,codigo:empresas[idx].codigoActivacion});
});
app.post('/api/gerente/desbloquear/:id',auth,(req,res)=>{
  let empresas=obtenerEmpresas(); const idx=empresas.findIndex(e=>e.id===req.params.id);
  if(idx===-1) return res.status(404).json({error:'No existe'});
  empresas[idx].estado='activa'; empresas[idx].pagado=true; guardarEmpresas(empresas);
  console.log('[DESBLOQUEADA]',empresas[idx].email);
  return res.json({mensaje:'Desbloqueada OK - ya puede ingresar'});
});
app.post('/api/admin/bloquear',auth,(req,res)=>{
  const {agenciaId,estado,pagado}=req.body; let empresas=obtenerEmpresas(); const idx=empresas.findIndex(e=>e.id===agenciaId);
  if(idx===-1) return res.status(404).json({error:'No existe'});
  empresas[idx].estado=estado; if(pagado!==undefined) empresas[idx].pagado=pagado; guardarEmpresas(empresas);
  return res.json({ok:true});
});
app.get('/api/debug/empresas',auth,(req,res)=>{ if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'}); return res.json(obtenerEmpresas()); });
app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`KLIDO v113 FIX LOGIN - GERENTE ${SUPER_ADMIN_EMAIL} - PORT ${PORT}`));
