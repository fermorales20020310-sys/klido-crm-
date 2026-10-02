const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_secret_key_v114_final';
const RESEND_FROM_FIXED = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SUPER_ADMIN_EMAIL = 'admin@klido.com';
const SUPER_ADMIN_PASS = 'Mafe2002@';

let fetchFn = global.fetch;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }

console.log('[KLIDO v114] FROM:', RESEND_FROM_FIXED, 'GERENTE:', SUPER_ADMIN_EMAIL);

app.use(express.json({limit:'5mb'}));
app.use(express.urlencoded({ extended: true }));
app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Headers','Origin, X-Requested-With, Content-Type, Accept, Authorization'); res.header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); });
app.use(express.static(path.join(__dirname, 'public')));

const codigosVerificacion = new Map();
const DATA_DIR = path.join(__dirname, 'data');
const EMPRESAS_FILE = path.join(DATA_DIR, 'empresas.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE, JSON.stringify([]));

function obtenerEmpresas(){
  try{
    const data = JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8'));
    return data.map(e=>({
      id: e.id, nombre: e.nombre, email: (e.email||'').toLowerCase(), password: e.password,
      plan: e.plan||'basico', estado: e.estado||'pendiente_gerente', pagado: e.pagado||false,
      codigoActivacion: e.codigoActivacion||'', waPhoneId: e.waPhoneId||'1338474282683914',
      consumo: e.consumo||{mensajes:0,usuarios:e.plan==='gold'?10:e.plan==='premium'?5:2,contactos:0},
      fechaRegistro: e.fechaRegistro||new Date().toISOString()
    }));
  }catch{ return []; }
}
function guardarEmpresas(list){ fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(list,null,2)); console.log('[SAVE]', list.length, 'empresas'); }

function auth(req,res,next){
  const h = req.headers['authorization']||'';
  const token = h.replace('Bearer ','').trim() || req.query.token || '';
  if(!token) return res.status(401).json({error:'No token'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch{ return res.status(401).json({error:'Token invalido o vencido'}); }
}

// ================= PUBLIC =================
app.post('/api/public/solicitar-codigo', async (req,res)=>{
  const {email} = req.body; if(!email) return res.status(400).json({error:'Correo requerido'});
  const codigo = Math.floor(100000+Math.random()*900000).toString();
  codigosVerificacion.set(email.toLowerCase(), {codigo, expira: Date.now()+10*60*1000});
  console.log('[CODIGO]', email, codigo);
  if(RESEND_API_KEY && fetchFn){
    try{
      const r = await fetchFn('https://api.resend.com/emails',{
        method:'POST', headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},
        body: JSON.stringify({from:RESEND_FROM_FIXED,to:email.toLowerCase(),subject:`KLIDO - Tu codigo ${codigo}`,html:`<div style="font-family:sans-serif;padding:20px"><h2>KLIDO</h2><p>Tu codigo:</p><div style="font-size:32px;font-weight:900;letter-spacing:6px;background:#f1f5f9;padding:15px;border-radius:10px;text-align:center">${codigo}</div><p>Expira en 10 min</p></div>`})
      });
      const j = await r.json(); console.log('[RESEND]', r.status, j);
      if(r.ok) return res.json({ok:true,mensaje:`Codigo enviado a ${email}`});
      return res.status(500).json({error:`Resend ${j.message||JSON.stringify(j)}`});
    }catch(e){ return res.status(500).json({error:e.message}); }
  }
  return res.json({ok:true,mensaje:`Codigo: ${codigo}`});
});

app.post('/api/public/crear-empresa',(req,res)=>{
  const {nombre,email,password,plan,codigo} = req.body;
  if(!nombre||!email||!password||!plan||!codigo) return res.status(400).json({error:'Faltan campos'});
  const reg = codigosVerificacion.get(email.toLowerCase());
  if(!reg || reg.codigo!==codigo) return res.status(400).json({error:'Codigo incorrecto'});
  if(Date.now()>reg.expira) return res.status(400).json({error:'Codigo caducado'});
  let empresas = obtenerEmpresas();
  if(empresas.find(e=>e.email===email.toLowerCase())) return res.status(400).json({error:'Ya existe una empresa con ese correo'});
  const nueva = {id:'emp_'+Date.now(),nombre,email:email.toLowerCase(),password,plan,estado:'pendiente_gerente',pagado:false,codigoActivacion:'',waPhoneId:'1338474282683914',consumo:{mensajes:0,usuarios:plan==='gold'?10:plan==='premium'?5:2,contactos:0},fechaRegistro:new Date().toISOString()};
  empresas.push(nueva); guardarEmpresas(empresas); codigosVerificacion.delete(email.toLowerCase());
  return res.status(201).json({ok:true,mensaje:'Registrada. Pendiente aprobacion Gerencia'});
});

// ================= LOGIN v114 - FIX DEFINITIVO =================
app.post('/api/login',(req,res)=>{
  const {email,password} = req.body;
  if(!email||!password) return res.status(400).json({error:'Correo y clave requeridos'});
  const emailLow = email.toLowerCase().trim();
  console.log('[LOGIN]', emailLow);

  // 1. GERENCIA FIJA - SIEMPRE ENTRA
  if(emailLow===SUPER_ADMIN_EMAIL.toLowerCase() && password===SUPER_ADMIN_PASS){
    const token = jwt.sign({id:'SUPER-ADMIN',email:SUPER_ADMIN_EMAIL,plan:'gold',rol:'super'},JWT_SECRET,{expiresIn:'7d'});
    return res.json({ok:true,token,user:{id:'SUPER-ADMIN',nombre:'GERENTE KLIDO',email:SUPER_ADMIN_EMAIL,plan:'gold',rol:'super',estado:'activa'}});
  }

  let empresas = obtenerEmpresas();
  const emp = empresas.find(e=>e.email===emailLow && e.password===password);
  if(!emp){
    console.log('[LOGIN FAIL]', emailLow);
    return res.status(401).json({error:'Correo o clave incorrecta'});
  }
  console.log('[LOGIN FOUND]', emp.email, emp.estado, 'pagado:', emp.pagado);

  if(emp.estado!=='activa'){
    return res.status(403).json({error:`Empresa ${emp.estado}. Contacta a Gerencia admin@klido.com - Wpp 3133181851`});
  }

  // FIX PAGADO
  if(!emp.pagado){ emp.pagado=true; guardarEmpresas(empresas); }

  const token = jwt.sign({id:emp.id,email:emp.email,plan:emp.plan,rol:'agencia'},JWT_SECRET,{expiresIn:'7d'});
  return res.json({ok:true,token,user:{id:emp.id,nombre:emp.nombre,email:emp.email,plan:emp.plan,rol:'agencia',estado:emp.estado,pagado:true}});
});

app.get('/api/me', auth, (req,res)=>{
  if(req.user.rol==='super') return res.json({id:'SUPER-ADMIN',nombre:'GERENTE KLIDO',email:SUPER_ADMIN_EMAIL,plan:'gold',rol:'super',estado:'activa'});
  let empresas = obtenerEmpresas();
  const emp = empresas.find(e=>e.id===req.user.id || e.email===req.user.email);
  if(!emp) return res.status(404).json({error:'Empresa no encontrada'});
  return res.json({id:emp.id,nombre:emp.nombre,email:emp.email,plan:emp.plan,rol:'agencia',estado:emp.estado,pagado:emp.pagado,codigoActivacion:emp.codigoActivacion});
});

// ================= GERENCIA =================
app.get('/api/admin/agencias', auth, (req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  const empresas = obtenerEmpresas();
  return res.json({
    total: empresas.length, restan: Math.max(0,10-empresas.length), wpp:'3133181851',
    agencias: empresas,
    notificaciones: empresas.filter(e=>e.estado!=='activa').map(e=>({empresaId:e.id,nombre:e.nombre,email:e.email,plan:e.plan,fecha:e.fechaRegistro})),
    historial: [{fecha:new Date().toISOString(), agencias: empresas.length}]
  });
});

app.post('/api/admin/activar', auth, (req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  const {agenciaId} = req.body; let empresas = obtenerEmpresas(); const idx = empresas.findIndex(e=>e.id===agenciaId);
  if(idx===-1) return res.status(404).json({error:'No encontrada'});
  empresas[idx].estado='activa'; empresas[idx].pagado=true; empresas[idx].codigoActivacion='KLIDO-'+Math.floor(100000+Math.random()*900000);
  guardarEmpresas(empresas);
  return res.json({ok:true,mensaje:`${empresas[idx].nombre} ACTIVADA`,codigo:empresas[idx].codigoActivacion});
});

app.post('/api/gerente/desbloquear/:id', auth, (req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  let empresas = obtenerEmpresas(); const idx = empresas.findIndex(e=>e.id===req.params.id);
  if(idx===-1) return res.status(404).json({error:'No existe'});
  empresas[idx].estado='activa'; empresas[idx].pagado=true;
  if(!empresas[idx].codigoActivacion) empresas[idx].codigoActivacion='KLIDO-'+Math.floor(100000+Math.random()*900000);
  guardarEmpresas(empresas);
  return res.json({mensaje:`${empresas[idx].nombre} desbloqueada OK - ya puede ingresar a app.html`});
});

app.post('/api/admin/bloquear', auth, (req,res)=>{
  if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'});
  const {agenciaId,estado,pagado} = req.body; let empresas = obtenerEmpresas(); const idx = empresas.findIndex(e=>e.id===agenciaId);
  if(idx===-1) return res.status(404).json({error:'No existe'});
  empresas[idx].estado=estado; if(pagado!==undefined) empresas[idx].pagado=pagado; guardarEmpresas(empresas);
  return res.json({ok:true});
});

app.get('/api/contrato/:id', auth, (req,res)=>{ res.send(`<html><body><h1>Contrato KLIDO ${req.params.id}</h1><p>Ley 1581</p></body></html>`); });
app.get('/api/debug/empresas', auth, (req,res)=>{ if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'}); res.json(obtenerEmpresas()); });

app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, ()=> console.log(`KLIDO v114 FINAL - GERENTE ${SUPER_ADMIN_EMAIL} - PORT ${PORT} - LISTO AGENCIAS`));
