const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const JWT_SECRET = process.env.JWT_SECRET || 'klido_avanza_secret_2026_real';
const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive:true });

function load(file, def){ try{ const p=path.join(DATA_DIR,file); if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8')); }catch(e){ console.error('load error',file,e.message); } return def; }
function save(file, data){ try{ fs.writeFileSync(path.join(DATA_DIR,file), JSON.stringify(data,null,2)); }catch(e){ console.error('save error',file,e.message); } }

let agencias = load('agencias.json', []);
let usuarios = load('usuarios.json', []);
let mensajes = load('mensajes.json', []);
let campanias = load('campanias.json', []);
let plantillas = load('plantillas.json', [
  {id:'tpl_bienvenida', nombre:'Bienvenida Oficial', contenido:'Hola {{1}} 👋 Bienvenido a {{2}}. Somos KLIDO AVANZA CONSULTING. ¿En qué te ayudamos?', estado:'APROBADA', categoria:'MARKETING'},
  {id:'tpl_oferta', nombre:'Oferta Especial', contenido:'Hola {{1}} 🔥 Tenemos una oferta especial para ti en {{2}}. Responde SI para más info.', estado:'APROBADA', categoria:'MARKETING'},
  {id:'tpl_recordatorio', nombre:'Recordatorio Pago', contenido:'Hola {{1}}, te recordamos que tu mantenimiento trimestral vence el {{2}}. Evita bloqueos.', estado:'APROBADA', categoria:'UTILITY'}
]);
let codigos = load('codigos.json', []);

if(usuarios.length===0){
  (async()=>{
    const hash = await bcrypt.hash('Mafe2002@',10);
    const agId='ag_superadmin_klido';
    agencias.push({ id:agId, nombre:'KLIDO AVANZA', email:'fermorales20020310@gmail.com', plan:'gold', anual:2400000, trim:120000, estado:'activa', codigo:'KLIDO-GOLD-MASTER', activo:true, createdAt:new Date().toISOString(), totalTrabajadores:1, totalMensajes:0, totalCampanias:0 });
    usuarios.push({ id:'u_superadmin', nombre:'Fer Morales SuperAdmin', email:'fermorales20020310@gmail.com', password:hash, plain:'Mafe2002@', rol:'SuperAdmin', empresa:'KLIDO AVANZA', empresaId:agId, plan:'gold', planDesbloqueado:'gold', activo:true, esSuperAdmin:true, createdAt:new Date().toISOString() });
    save('agencias.json', agencias); save('usuarios.json', usuarios);
  })();
}

const LIMITES_PLAN = {
  basico: { trabajadores: 3, conversaciones: 1000, ia:false, llamadas:false, nombre:'Básico', anual:800000, trim:80000 },
  premium: { trabajadores: 10, conversaciones: 5000, ia:true, llamadas:false, nombre:'Premium + IA', anual:1400000, trim:95000 },
  gold: { trabajadores: 999999, conversaciones: 999999999, ia:true, llamadas:true, nombre:'Gold + IA + Llamadas', anual:2400000, trim:120000 }
};
function getLimite(plan){ return LIMITES_PLAN[plan] || LIMITES_PLAN.basico; }

app.use(cors()); app.use(express.json()); app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));
const upload = multer({ dest: path.join(__dirname,'uploads') });
if(!fs.existsSync(path.join(__dirname,'uploads'))) fs.mkdirSync(path.join(__dirname,'uploads'),{recursive:true});

function auth(req,res,next){
  try{
    const token = (req.headers.authorization||'').replace('Bearer ','');
    if(!token) return res.status(401).json({error:'Token requerido'});
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = usuarios.find(u=> u.id===decoded.id);
    if(!user) return res.status(401).json({error:'Usuario no existe'});
    req.user=user; next();
  }catch(e){ res.status(401).json({error:'Token inválido'}); }
}
function checkPlan(req,res,next){
  const u = usuarios.find(x=> x.id===req.user.id);
  if(!u) return res.status(401).json({error:'Usuario no encontrado'});
  if(u.esSuperAdmin){ req.limitePlan=getLimite('gold'); req.planActual='gold'; return next(); }
  const plan = u.planDesbloqueado || u.plan;
  req.limitePlan=getLimite(plan); req.planActual=plan; next();
}
function isAdmin(req){ return ['Admin','SuperAdmin'].includes(req.user.rol); }

// PUBLICAS
app.post('/api/public/crear-empresa', async (req,res)=>{
  try{
    const {nombre,email,password,plan} = req.body;
    if(!nombre||!email||!password) return res.status(400).json({error:'Faltan campos'});
    if(usuarios.find(u=> u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Correo ya registrado'});
    const p = ['basico','premium','gold'].includes(plan)?plan:'premium';
    const lim = getLimite(p);
    const codigo = `KLIDO-${p.toUpperCase()}-${Math.floor(1000+Math.random()*9000)}`;
    const hash = await bcrypt.hash(password,10);
    const agId=uuidv4();
    const agencia={ id:agId, nombre:nombre.trim(), email:email.toLowerCase(), plan:p, anual:lim.anual, trim:lim.trim, estado:'pendiente_pago', codigo, activo:false, createdAt:new Date().toISOString(), totalTrabajadores:1, totalMensajes:0, totalCampanias:0 };
    const usuario={ id:uuidv4(), nombre:nombre.trim(), email:email.toLowerCase(), password:hash, plain:password, rol:'Admin', empresa:nombre.trim(), empresaId:agId, plan:p, planDesbloqueado:null, activo:false, createdAt:new Date().toISOString() };
    agencias.push(agencia); usuarios.push(usuario); codigos.push({codigo, email:email.toLowerCase(), plan:p, usado:false, createdAt:new Date().toISOString()});
    save('agencias.json',agencias); save('usuarios.json',usuarios); save('codigos.json',codigos);
    res.json({ok:true, codigo, mensaje:`¡Agencia ${nombre} registrada! Tu código ${codigo} se activará tras confirmar pago al WhatsApp 3133181851. Plan ${lim.nombre}: ${lim.conversaciones===999999999?'ilimitado':lim.conversaciones} conversaciones, ${lim.trabajadores===999999?'ilimitado':lim.trabajadores} trabajadores.`});
  }catch(e){ console.error(e); res.status(500).json({error:'Error creando empresa'}); }
});

app.post('/api/public/verificar-codigo', (req,res)=>{
  try{
    const {email,codigo} = req.body;
    if(!email||!codigo) return res.status(400).json({error:'Faltan datos'});
    const cod = codigos.find(c=> c.codigo===codigo.trim().toUpperCase() && c.email.toLowerCase()===email.toLowerCase());
    if(!cod) return res.status(400).json({error:'Código o correo inválido'});
    if(cod.usado) return res.json({ok:true, planDesbloqueado:cod.plan, mensaje:'Ya estaba desbloqueado'});
    const ag = agencias.find(a=> a.email.toLowerCase()===email.toLowerCase());
    const us = usuarios.find(u=> u.email.toLowerCase()===email.toLowerCase());
    if(ag){ ag.activo=true; ag.estado='activa'; ag.planDesbloqueado=cod.plan; }
    if(us){ us.activo=true; us.planDesbloqueado=cod.plan; }
    cod.usado=true; cod.usadoEn=new Date().toISOString();
    save('agencias.json',agencias); save('usuarios.json',usuarios); save('codigos.json',codigos);
    res.json({ok:true, planDesbloqueado:cod.plan, mensaje:`Plan ${cod.plan.toUpperCase()} desbloqueado. Ya puedes ingresar.`});
  }catch(e){ res.status(500).json({error:'Error verificando'}); }
});

app.post('/api/login', async (req,res)=>{
  try{
    const {email,password} = req.body;
    const user = usuarios.find(u=> u.email.toLowerCase()===email.toLowerCase());
    if(!user) return res.status(400).json({error:'Usuario no existe'});
    const ok = await bcrypt.compare(password, user.password);
    if(!ok) return res.status(400).json({error:'Contraseña incorrecta'});
    if(!user.activo &&!user.esSuperAdmin) return res.status(403).json({error:'Agencia pendiente de pago. Verifica tu código KLIDO-XXXX al 3133181851'});
    const planEff = user.planDesbloqueado || user.plan;
    const limite = getLimite(planEff);
    if(!user.esSuperAdmin){
      const totalConv = mensajes.filter(m=> m.agenciaId===user.empresaId || m.agenciaId===user.empresa).length;
      const totalTrab = usuarios.filter(u=> u.empresa===user.empresa).length;
      if(totalConv > limite.conversaciones){ return res.status(403).json({error:`Límite de conversaciones superado ${totalConv}/${limite.conversaciones} en plan ${limite.nombre}. Adquiere Gold ilimitado al 3133181851`}); }
    }
    const token = jwt.sign({id:user.id, empresa:user.empresa, rol:user.rol}, JWT_SECRET, {expiresIn:'30d'});
    res.json({ok:true, token, user:{id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresa:user.empresa, plan:planEff, planDesbloqueado:user.planDesbloqueado, esSuperAdmin:!!user.esSuperAdmin, limite}});
  }catch(e){ console.error(e); res.status(500).json({error:'Error login'}); }
});

// PROTEGIDAS
app.get('/api/plan/permisos', auth, checkPlan, (req,res)=>{
  const ag = req.user.empresaId || req.user.empresa;
  const totalConv = mensajes.filter(m=> m.agenciaId===ag || m.agenciaId===req.user.empresa).length;
  const totalTrab = usuarios.filter(u=> u.empresa===req.user.empresa).length;
  res.json({ plan:req.planActual, nombre:req.limitePlan.nombre, limites:req.limitePlan, uso:{conversaciones:totalConv, trabajadores:totalTrab}, puedeUsarIA:req.limitePlan.ia, puedeUsarLlamadas:req.limitePlan.llamadas, puedeAgregarTrabajador: totalTrab < req.limitePlan.trabajadores, puedeEnviarMensaje: totalConv < req.limitePlan.conversaciones });
});

app.get('/api/mensajes', auth, (req,res)=>{
  const ag = req.user.empresaId || req.user.empresa;
  const msgs = mensajes.filter(m=> m.agenciaId===ag || m.agenciaId===req.user.empresa || m.agenciaId===req.user.empresaId);
  res.json(msgs);
});

app.post('/api/mensajes/enviar', auth, checkPlan, upload.single('archivo'), (req,res)=>{
  try{
    const ag = req.user.empresaId || req.user.empresa;
    const totalConv = mensajes.filter(m=> (m.agenciaId===ag || m.agenciaId===req.user.empresa)).length;
    if(totalConv >= req.limitePlan.conversaciones) return res.status(403).json({error:`⛔ Límite ${req.limitePlan.nombre}: ${req.limitePlan.conversaciones} conversaciones alcanzado. Ya tienes ${totalConv}. Cambia a Gold ilimitado al 3133181851`});
    let tipo='texto';
    if(req.file){ if(req.file.mimetype.startsWith('image')) tipo='foto'; else if(req.file.mimetype.startsWith('audio')) tipo='audio'; else tipo='archivo'; }
    const msg={ id:uuidv4(), agenciaId:ag, empresa:req.user.empresa, from:'yo', to:req.body.to, texto:req.body.texto||'[Archivo]', tipo, archivo:req.file?req.file.filename:null, timestamp:Date.now(), leido:true, campania:false };
    mensajes.push(msg); save('mensajes.json', mensajes);
    io.emit('nuevo_mensaje', msg);
    res.json({ok:true, mensaje:msg});
  }catch(e){ console.error(e); res.status(500).json({error:'Error enviando'}); }
});

app.get('/api/plantillas', auth, (req,res)=>{ res.json(plantillas.filter(p=>p.estado==='APROBADA')); });

app.get('/api/campanias', auth, (req,res)=>{
  const ag = req.user.empresaId || req.user.empresa;
  res.json(campanias.filter(c=> c.agenciaId===ag || c.agenciaId===req.user.empresa));
});

app.post('/api/campanias/upload', auth, checkPlan, upload.single('excel'), (req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:'Sube Excel'});
    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    const numeros = data.map(r=> String(r.telefono||r.Telefono||r.TELEFONO||r.numero||r.Numero||'')).filter(n=>n.length>=8).map(n=> n.replace(/[^0-9+]/g,''));
    if(numeros.length===0) return res.status(400).json({error:'Excel sin columna telefono'});
    const ag = req.user.empresaId || req.user.empresa;
    const totalActual = mensajes.filter(m=> m.agenciaId===ag || m.agenciaId===req.user.empresa).length;
    if(totalActual + numeros.length > req.limitePlan.conversaciones) return res.status(403).json({error:`No puedes crear campaña de ${numeros.length} números: tu plan ${req.limitePlan.nombre} permite ${req.limitePlan.conversaciones}, ya tienes ${totalActual}. Solo te quedan ${req.limitePlan.conversaciones-totalActual}. Pásate a Gold ilimitado 3133181851`});
    const camp={ id:uuidv4(), agenciaId:ag, nombre:req.body.nombre||'Campaña '+(campanias.length+1), numeros, total:numeros.length, enviados:0, plantilla:req.body.plantilla, createdAt:new Date().toISOString(), historial:[{fecha:new Date().toISOString(), accion:`Excel subido con ${numeros.length} números detectados automáticamente`} ] };
    campanias.push(camp); save('campanias.json', campanias);
    const agencia = agencias.find(a=> a.nombre===req.user.empresa); if(agencia){ agencia.totalCampanias=campanias.filter(c=> c.agenciaId===ag || c.agenciaId===req.user.empresa).length; save('agencias.json',agencias); }
    try{ fs.unlinkSync(req.file.path); }catch(e){}
    res.json({ok:true, campania:camp});
  }catch(e){ console.error(e); res.status(500).json({error:'Error subiendo Excel'}); }
});

app.post('/api/campanias/enviar', auth, checkPlan, (req,res)=>{
  try{
    const camp = campanias.find(c=> c.id===req.body.campaniaId);
    if(!camp) return res.status(404).json({error:'Campaña no encontrada'});
    const tpl = plantillas.find(p=> p.id===camp.plantilla);
    if(!tpl || tpl.estado!=='APROBADA') return res.status(400).json({error:'Solo plantillas APROBADAS por META pueden enviarse'});
    const ag = req.user.empresaId || req.user.empresa;
    const totalActual = mensajes.filter(m=> m.agenciaId===ag || m.agenciaId===req.user.empresa).length;
    if(totalActual + camp.numeros.length > req.limitePlan.conversaciones) return res.status(403).json({error:`Límite superado para enviar: Plan ${req.limitePlan.nombre} ${req.limitePlan.conversaciones} conv. Tienes ${totalActual} + ${camp.numeros.length} = ${totalActual+camp.numeros.length}. Cambia a Gold 3133181851`});
    camp.numeros.forEach(num=>{
      mensajes.push({ id:uuidv4(), agenciaId:camp.agenciaId, empresa:req.user.empresa, from:num, to:num, texto:tpl.contenido, tipo:'texto', timestamp:Date.now(), leido:false, campania:true, esCampania:true, noLeido:true });
    });
    save('mensajes.json', mensajes);
    camp.enviados=camp.numeros.length;
    camp.historial.push({fecha:new Date().toISOString(), accion:`Enviados ${camp.enviados} con plantilla APROBADA ${tpl.nombre} - Punto amarillo activado`});
    save('campanias.json', campanias);
    const agencia = agencias.find(a=> a.nombre===req.user.empresa); if(agencia){ agencia.totalMensajes=mensajes.filter(m=> m.agenciaId===ag || m.agenciaId===req.user.empresa).length; save('agencias.json',agencias); }
    io.emit('campania_enviada', camp);
    res.json({ok:true, enviados:camp.enviados});
  }catch(e){ console.error(e); res.status(500).json({error:'Error campaña'}); }
});

app.get('/api/trabajadores', auth, (req,res)=>{
  if(!isAdmin(req)) return res.status(403).json({error:'Solo admin'});
  const list = usuarios.filter(u=> u.empresa===req.user.empresa);
  res.json(list.map(u=>({id:u.id, nombre:u.nombre, email:u.email, rol:u.rol, plan:u.plan, planDesbloqueado:u.planDesbloqueado, activo:u.activo, tieneIA:getLimite(u.planDesbloqueado||u.plan).ia, tieneLlamadas:getLimite(u.planDesbloqueado||u.plan).llamadas})));
});

app.post('/api/trabajadores', auth, checkPlan, async (req,res)=>{
  try{
    if(!isAdmin(req)) return res.status(403).json({error:'Solo admin'});
    const totalTrab = usuarios.filter(u=> u.empresa===req.user.empresa).length;
    if(totalTrab >= req.limitePlan.trabajadores) return res.status(403).json({error:`⛔ Límite ${req.limitePlan.nombre}: solo ${req.limitePlan.trabajadores} trabajadores permitidos (incluyes jefe). Ya tienes ${totalTrab}. Premium permite 10, Gold ilimitado. WhatsApp 3133181851`});
    if(usuarios.find(u=> u.email.toLowerCase()===req.body.email.toLowerCase())) return res.status(400).json({error:'Correo ya existe'});
    const hash = await bcrypt.hash(req.body.password,10);
    const nuevo={ id:uuidv4(), nombre:req.body.nombre, email:req.body.email.toLowerCase(), password:hash, plain:req.body.password, rol:'Trabajador', empresa:req.user.empresa, empresaId:req.user.empresaId, plan:req.user.plan, planDesbloqueado:req.user.planDesbloqueado||req.user.plan, activo:true, createdAt:new Date().toISOString() };
    usuarios.push(nuevo); save('usuarios.json', usuarios);
    const ag = agencias.find(a=> a.nombre===req.user.empresa); if(ag){ ag.totalTrabajadores=usuarios.filter(u=>u.empresa===ag.nombre).length; save('agencias.json', agencias); }
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({error:'Error agregando'}); }
});

app.delete('/api/trabajadores/:id', auth, (req,res)=>{
  try{
    if(!isAdmin(req)) return res.status(403).json({error:'Solo admin'});
    const idx = usuarios.findIndex(u=> u.id===req.params.id && u.empresa===req.user.empresa);
    if(idx===-1) return res.status(404).json({error:'No encontrado'});
    if(usuarios[idx].esSuperAdmin) return res.status(403).json({error:'No puedes eliminar SuperAdmin'});
    usuarios.splice(idx,1); save('usuarios.json', usuarios);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:'Error eliminando'}); }
});

app.get('/api/metricas', auth, checkPlan, (req,res)=>{
  const ag = req.user.empresaId || req.user.empresa;
  const msgs = mensajes.filter(m=> m.agenciaId===ag || m.agenciaId===req.user.empresa);
  const noLeidos = msgs.filter(m=>!m.leido && m.from!=='yo').length;
  const camp = msgs.filter(m=> m.campania).length;
  const camps = campanias.filter(c=> c.agenciaId===ag || c.agenciaId===req.user.empresa).length;
  const trab = usuarios.filter(u=> u.empresa===req.user.empresa).length;
  const totalAg = req.user.esSuperAdmin? agencias.length : undefined;
  res.json({ total: msgs.length, noLeidos, campania: camp, campanias: camps, trabajadores: trab, totalAgencias: totalAg, limite: req.limitePlan, uso:{conversaciones:msgs.length, trabajadores:trab} });
});

app.get('/api/admin/agencias', auth, (req,res)=>{
  if(!req.user.esSuperAdmin && req.user.rol!=='SuperAdmin') return res.status(403).json({error:'Solo SuperAdmin'});
  const data = agencias.map(ag=>{
    const trab = usuarios.filter(u=> u.empresa===ag.nombre).length;
    const msg = mensajes.filter(m=> m.agenciaId===ag.id || m.agenciaId===ag.nombre).length;
    const camp = campanias.filter(c=> c.agenciaId===ag.id || c.agenciaId===ag.nombre).length;
    return {...ag, totalTrabajadores:trab, totalMensajes:msg, totalCampanias:camp};
  });
  res.json({ totalAgencias:agencias.length, totalUsuarios:usuarios.length, totalMensajes:mensajes.length, agencias:data.sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)) });
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/app.html', (req,res)=> res.sendFile(path.join(__dirname,'public','app.html')));
app.get('/terminos.html', (req,res)=> res.sendFile(path.join(__dirname,'public','terminos.html')));

io.use((socket,next)=>{
  try{ const token=socket.handshake.auth?.token; if(!token) return next(new Error('No token')); const d=jwt.verify(token,JWT_SECRET); socket.userId=d.id; next(); }catch(e){ next(new Error('Auth error')); }
});
io.on('connection', (socket)=>{
  socket.on('marcar_leido', (id)=>{ const m=mensajes.find(x=>x.id===id); if(m){ m.leido=false; m.noLeido=false; save('mensajes.json', mensajes); io.emit('mensaje_leido', id); } });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`✅ KLIDO AVANZA CRM REAL con bloqueos por plan corriendo en ${PORT} - ${LIMITES_PLAN.basico.conversaciones}/${LIMITES_PLAN.premium.conversaciones}/ilimitado bloqueos activos`));
