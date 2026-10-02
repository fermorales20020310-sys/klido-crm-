const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_secret_key_v112_pro';

// === CONFIG CORREO v112.8 ===
const RESEND_FROM_FIXED = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
let fetchFn = global.fetch;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }
console.log('[CONFIG] FROM:', RESEND_FROM_FIXED);
console.log('[CONFIG] RESEND:', RESEND_API_KEY? 'OK '+RESEND_API_KEY.slice(0,14)+'...' : 'FALTA');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const codigosVerificacion = new Map();
const DATA_DIR = path.join(__dirname, 'data');
const EMPRESAS_FILE = path.join(DATA_DIR, 'empresas.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE, JSON.stringify([]));

function obtenerEmpresas() {
  try {
    const raw = JSON.parse(fs.readFileSync(EMPRESAS_FILE, 'utf8'));
    return raw.map(e => ({
      id: e.id,
      nombre: e.nombre,
      email: (e.email||'').toLowerCase(),
      password: e.password,
      plan: e.plan || 'basico',
      estado: e.estado || 'pendiente_gerente',
      pagado: e.pagado || false,
      codigoActivacion: e.codigoActivacion || '',
      waPhoneId: e.waPhoneId || '1338474282683914',
      mantenimiento: e.plan==='gold'?'$120k/trim':e.plan==='premium'?'$95k/trim':'$80k/trim',
      consumo: e.consumo || { mensajes: 0, usuarios: e.plan==='gold'?10:e.plan==='premium'?5:2, contactos: 0 },
      fechaRegistro: e.fechaRegistro || new Date().toISOString()
    }));
  } catch { return []; }
}
function guardarEmpresas(empresas) {
  fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(empresas, null, 2));
}

function auth(req,res,next){
  const h = req.headers['authorization']||'';
  const token = h.replace('Bearer ','').trim();
  if(!token) return res.status(401).json({error:'No token'});
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({error:'Token inválido'}); }
}

// =============== RUTAS PUBLICAS ===============
app.post('/api/public/solicitar-codigo', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Correo requerido' });
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  codigosVerificacion.set(email.toLowerCase(), { codigo, expira: Date.now() + 10*60*1000 });
  console.log(`[v112.8] Código ${email}: ${codigo} FROM=${RESEND_FROM_FIXED}`);

  if (RESEND_API_KEY && fetchFn) {
    try {
      const r = await fetchFn('https://api.resend.com/emails', {
        method:'POST',
        headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},
        body: JSON.stringify({
          from: RESEND_FROM_FIXED,
          to: email.toLowerCase(),
          subject: `KLIDO - Tu código es ${codigo}`,
          html: `<div style="font-family:sans-serif;background:#f8fafc;padding:24px"><div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden"><div style="background:#020917;color:#fff;padding:20px;font-weight:900">KLIDO - AVANZA CONSULTING</div><div style="padding:24px"><h2 style="margin:0">Tu código de verificación</h2><p style="color:#64748b;font-size:13px">Expira en 10 minutos. Si no lo solicitaste, ignóralo.</p><div style="background:#f1f5f9;padding:20px;text-align:center;border-radius:12px;margin:20px 0"><span style="font-size:34px;font-weight:900;letter-spacing:8px">${codigo}</span></div><p style="font-size:11px;color:#94a3b8">Soporte: wa.me/573133181851</p></div></div></div>`
        })
      });
      const j = await r.json();
      console.log('[RESEND RESPONSE]', r.status, j);
      if (r.ok) return res.json({ ok:true, mensaje:`Código enviado a ${email}. Revisa SPAM` });
      return res.status(500).json({ error:`Resend ${r.status}: ${j.message||JSON.stringify(j)}` });
    } catch(e){
      console.log('[RESEND ERROR]', e.message);
      return res.status(500).json({ error:e.message });
    }
  }
  return res.json({ ok:true, mensaje:`Código (sin Resend): ${codigo}` });
});

app.post('/api/public/crear-empresa', (req, res) => {
  const { nombre, email, password, plan, codigo, aceptoTerminos } = req.body;
  if (!nombre ||!email ||!password ||!plan ||!codigo) return res.status(400).json({ error: 'Faltan campos' });
  if (!aceptoTerminos) return res.status(400).json({ error: 'Acepta Ley 1581' });
  const reg = codigosVerificacion.get(email.toLowerCase());
  if (!reg || reg.codigo!== codigo) return res.status(400).json({ error: 'Código incorrecto o expirado' });
  if (Date.now() > reg.expira) { codigosVerificacion.delete(email.toLowerCase()); return res.status(400).json({ error: 'Código caducado' }); }

  let empresas = obtenerEmpresas();
  if (empresas.find(e=>e.email===email.toLowerCase())) return res.status(400).json({ error: 'Ya existe cuenta con este correo' });

  const nueva = {
    id: 'AG-'+Date.now(),
    nombre, email: email.toLowerCase(), password, plan,
    estado: 'pendiente_gerente',
    pagado: false,
    codigoActivacion: '',
    waPhoneId: '1338474282683914',
    consumo: { mensajes:0, usuarios: plan==='gold'?10:plan==='premium'?5:2, contactos:0 },
    fechaRegistro: new Date().toISOString()
  };
  empresas.push(nueva);
  guardarEmpresas(empresas);
  codigosVerificacion.delete(email.toLowerCase());
  return res.status(201).json({ ok:true, mensaje:'Registrada. Pendiente aprobación en /admin.html' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email ||!password) return res.status(400).json({ error: 'Correo y clave requeridos' });
  const empresas = obtenerEmpresas();
  const emp = empresas.find(e=>e.email===email.toLowerCase() && e.password===password);
  if (!emp) return res.status(401).json({ error: 'Credenciales inválidas' });

  // Si es gerente, dejar pasar aunque esté pendiente
  const esGerente = ['avanzaconsultingyl@gmail.com','admin@klido.com'].includes(emp.email.toLowerCase());
  if (!esGerente && emp.estado!== 'activa') {
    return res.status(403).json({ error: `Estado: ${emp.estado}. Pendiente activación por Gerencia en /admin.html` });
  }

  const rol = esGerente? 'super' : 'agencia';
  const token = jwt.sign({ id:emp.id, email:emp.email, plan:emp.plan, rol }, JWT_SECRET, {expiresIn:'24h'});
  return res.json({ ok:true, token, user:{ id:emp.id, nombre:emp.nombre, email:emp.email, plan:emp.plan, rol } });
});

// =============== PANEL GERENTE /admin.html ===============
app.get('/api/admin/agencias', auth, (req,res)=>{
  const empresas = obtenerEmpresas();
  const pendientes = empresas.filter(e=>e.estado!=='activa').map(e=>({
    empresaId:e.id, nombre:e.nombre, email:e.email, plan:e.plan, fecha:e.fechaRegistro, leida:false
  }));
  return res.json({
    total: empresas.length,
    restan: Math.max(0, 10-empresas.length),
    wpp: '3133181851',
    agencias: empresas,
    notificaciones: pendientes,
    historial: [{fecha:new Date().toISOString(), agencias:empresas.length}]
  });
});

app.post('/api/admin/activar', auth, async (req,res)=>{
  const { agenciaId } = req.body;
  let empresas = obtenerEmpresas();
  const idx = empresas.findIndex(e=>e.id===agenciaId);
  if(idx===-1) return res.status(404).json({error:'Agencia no encontrada'});
  const codigoAct = 'KLIDO-'+Math.floor(100000+Math.random()*900000).toString();
  empresas[idx].estado='activa';
  empresas[idx].pagado=true;
  empresas[idx].codigoActivacion=codigoAct;
  guardarEmpresas(empresas);

  if(RESEND_API_KEY && fetchFn){
    try{
      await fetchFn('https://api.resend.com/emails',{
        method:'POST',
        headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},
        body: JSON.stringify({
          from: RESEND_FROM_FIXED,
          to: empresas[idx].email,
          subject: `KLIDO - Empresa Activada - ${codigoAct}`,
          html: `<div style="font-family:sans-serif;padding:24px"><h2>¡Empresa Activada!</h2><p><b>${empresas[idx].nombre}</b> fue activada.</p><p>Plan: ${empresas[idx].plan.toUpperCase()}</p><p>Código: <b>${codigoAct}</b></p><p>Ingresa en https://klidoapp.com.co</p></div>`
        })
      });
    }catch(e){ console.log('Error enviando activación', e.message); }
  }
  return res.json({ ok:true, mensaje:`${empresas[idx].nombre} activada y código enviado a ${empresas[idx].email}`, codigo:codigoAct });
});

app.post('/api/gerente/desbloquear/:id', auth, (req,res)=>{
  let empresas = obtenerEmpresas();
  const idx = empresas.findIndex(e=>e.id===req.params.id);
  if(idx===-1) return res.status(404).json({error:'No existe'});
  empresas[idx].estado='activa'; empresas[idx].pagado=true;
  guardarEmpresas(empresas);
  return res.json({ mensaje:'Empresa desbloqueada' });
});

app.post('/api/admin/bloquear', auth, (req,res)=>{
  const { agenciaId, estado, pagado } = req.body;
  let empresas = obtenerEmpresas();
  const idx = empresas.findIndex(e=>e.id===agenciaId);
  if(idx===-1) return res.status(404).json({error:'No existe'});
  empresas[idx].estado=estado;
  if(pagado!==undefined) empresas[idx].pagado=pagado;
  guardarEmpresas(empresas);
  return res.json({ ok:true, mensaje:`Estado cambiado a ${estado}` });
});

app.post('/api/admin/corregir-acol', auth, (req,res)=>{
  let empresas = obtenerEmpresas();
  let count=0;
  empresas = empresas.map(e=>{
    if(e.nombre.toLowerCase().includes('acol')||e.email.includes('acol')){
      e.plan='basico'; e.waPhoneId='1338474282683914'; count++;
    }
    return e;
  });
  guardarEmpresas(empresas);
  return res.json({ ok:true, mensaje:`Corregidas ${count} ACOL a BASICO + WA 1338474282683914` });
});

app.get('/api/contrato/:id', auth, (req,res)=>{
  res.send(`<html><body style="font-family:sans-serif;padding:24px"><h1>Contrato ${req.params.id}</h1><p>KLIDO - Avanza Consulting - Ley 1581 Habeas Data</p><p>Fecha: ${new Date().toISOString()}</p></body></html>`);
});

// Fallback frontend
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, ()=>{
  console.log('==================================================');
  console.log(' KLIDO CRM v112.8 FINAL - GERENTE + RESEND');
  console.log(` FROM: ${RESEND_FROM_FIXED}`);
  console.log(` PORT: ${PORT}`);
  console.log(' Panel: /admin.html?v=112');
  console.log('==================================================');
});
