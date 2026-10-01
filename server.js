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

function load(file, def){
  try{
    const p = path.join(DATA_DIR, file);
    if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8'));
  }catch(e){ console.error('load error', file, e.message); }
  return def;
}
function save(file, data){
  try{ fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data,null,2)); }
  catch(e){ console.error('save error', file, e.message); }
}

// DATOS PERSISTENTES - NUNCA SE BORRA
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
let contactos = load('contactos.json', []);

// NUEVOS - NO DAÑAN LOS ANTERIORES, SE CREAN VACIOS SI NO EXISTEN
let agentesCfg = load('agentes.json', []);
let susurros = load('susurros.json', []);
let metricasAgentes = load('metricasAgentes.json', []);
let pipelines = load('pipelines.json', []);
let pagos = load('pagos.json', []);
let linksPago = load('linksPago.json', []);
let automatizaciones = load('automatizaciones.json', []);
let etiquetas = load('etiquetas.json', []);
let reservas = load('reservas.json', []);
let calendarios = load('calendarios.json', []);
let healthNumeros = load('healthNumeros.json', []);
let webhooksClientes = load('webhooksClientes.json', []);

// SUPERADMIN INICIAL SI NO EXISTE
if(usuarios.length===0){
  (async()=>{
    const hash = await bcrypt.hash('Mafe2002@',10);
    const agId='ag_superadmin_klido';
    agencias.push({
      id:agId, nombre:'KLIDO AVANZA', email:'fermorales20020310@gmail.com',
      plan:'gold', anual:2400000, trim:120000, estado:'activa',
      codigo:'KLIDO-GOLD-MASTER', activo:true, createdAt:new Date().toISOString(),
      totalTrabajadores:1, totalMensajes:0, totalCampanias:0
    });
    usuarios.push({
      id:'u_superadmin', nombre:'Fer Morales', email:'fermorales20020310@gmail.com',
      password:hash, plain:'Mafe2002@', rol:'SuperAdmin', empresa:'KLIDO AVANZA',
      empresaId:agId, plan:'gold', planDesbloqueado:'gold', activo:true, esSuperAdmin:true,
      createdAt:new Date().toISOString()
    });
    save('agencias.json', agencias);
    save('usuarios.json', usuarios);
    console.log('✅ SuperAdmin creado: fermorales20020310@gmail.com / Mafe2002@');
  })();
}

// BLOQUEOS REALES POR PLAN - ESTO HACE QUE SE RESPETE Y NO SE SALTE
const LIMITES_PLAN = {
  basico: { trabajadores: 3, conversaciones: 1000, ia:false, llamadas:false, nombre:'Básico', anual:800000, trim:80000 },
  premium: { trabajadores: 10, conversaciones: 5000, ia:true, llamadas:false, nombre:'Premium + IA', anual:1400000, trim:95000 },
  gold: { trabajadores: 999999, conversaciones: 999999999, ia:true, llamadas:true, nombre:'Gold + IA + Llamadas', anual:2400000, trim:120000 }
};
function getLimite(plan){ return LIMITES_PLAN[plan] || LIMITES_PLAN.basico; }

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

const uploadDir = path.join(__dirname,'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
const upload = multer({ dest: uploadDir });

// AUTH
function auth(req,res,next){
  try{
    const token = (req.headers.authorization||'').replace('Bearer ','');
    if(!token) return res.status(401).json({error:'Token requerido'});
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = usuarios.find(u=> u.id===decoded.id);
    if(!user) return res.status(401).json({error:'Usuario no existe'});
    req.user=user;
    next();
  }catch(e){ return res.status(401).json({error:'Token inválido'}); }
}
function checkPlan(req,res,next){
  const u = usuarios.find(x=> x.id===req.user.id);
  if(!u) return res.status(401).json({error:'Usuario no encontrado'});
  if(u.esSuperAdmin){ req.limitePlan=getLimite('gold'); req.planActual='gold'; return next(); }
  const plan = u.planDesbloqueado || u.plan;
  req.limitePlan=getLimite(plan);
  req.planActual=plan;
  next();
}
function isAdmin(req){ return ['Admin','SuperAdmin'].includes(req.user.rol); }

// ================== RUTAS PUBLICAS ==================
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
    const agencia={
      id:agId, nombre:nombre.trim(), email:email.toLowerCase(), plan:p,
      anual:lim.anual, trim:lim.trim, estado:'pendiente_pago', codigo,
      activo:false, createdAt:new Date().toISOString(),
      totalTrabajadores:1, totalMensajes:0, totalCampanias:0
    };
    const usuario={
      id:uuidv4(), nombre:nombre.trim(), email:email.toLowerCase(),
      password:hash, plain:password, rol:'Admin', empresa:nombre.trim(),
      empresaId:agId, plan:p, planDesbloqueado:null, activo:false,
      createdAt:new Date().toISOString()
    };
    agencias.push(agencia);
    usuarios.push(usuario);
    codigos.push({codigo, email:email.toLowerCase(), plan:p, usado:false, createdAt:new Date().toISOString()});
    save('agencias.json',agencias);
    save('usuarios.json',usuarios);
    save('codigos.json',codigos);
    res.json({
      ok:true, codigo,
      mensaje:`¡Agencia ${nombre} registrada! Tu código ${codigo} se activará tras confirmar pago al WhatsApp 3133181851. Plan ${lim.nombre}: ${lim.conversaciones===999999999?'ilimitado':lim.conversaciones} conversaciones, ${lim.trabajadores===999999?'ilimitado':lim.trabajadores} trabajadores.`
    });
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
    cod.usado=true;
    cod.usadoEn=new Date().toISOString();
    save('agencias.json',agencias);
    save('usuarios.json',usuarios);
    save('codigos.json',codigos);
    res.json({ok:true, planDesbloqueado:cod.plan, mensaje:`Plan ${cod.plan.toUpperCase()} desbloqueado. Ya puedes ingresar.`});
  }catch(e){ console.error(e); res.status(500).json({error:'Error verificando'}); }
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
      if(totalConv > limite.conversaciones){
        return res.status(403).json({error:`Límite de conversaciones superado ${totalConv}/${limite.conversaciones} en plan ${limite.nombre}. Adquiere Gold ilimitado al 3133181851`});
      }
    }
    const token = jwt.sign({id:user.id, empresa:user.empresa, rol:user.rol}, JWT_SECRET, {expiresIn:'30d'});
    res.json({ok:true, token, user:{id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresa:user.empresa, plan:planEff, planDesbloqueado:user.planDesbloqueado, esSuperAdmin:!!user.esSuperAdmin, limite}});
  }catch(e){ console.error(e); res.status(500).json({error:'Error login'}); }
});

// ================== RUTAS PROTEGIDAS ==================
app.get('/api/plan/permisos', auth, checkPlan, (req,res)=>{
  const ag = req.user.empresaId || req.user.empresa;
  const totalConv = mensajes.filter(m=> m.agenciaId===ag || m.agenciaId===req.user.empresa).length;
  const totalTrab = usuarios.filter(u=> u.empresa===req.user.empresa).length;
  res.json({
    plan:req.planActual,
    nombre:req.limitePlan.nombre,
    limites:req.limitePlan,
    uso:{conversaciones:totalConv, trabajadores:totalTrab},
    puedeUsarIA:req.limitePlan.ia,
    puedeUsarLlamadas:req.limitePlan.llamadas,
    puedeAgregarTrabajador: totalTrab < req.limitePlan.trabajadores,
    puedeEnviarMensaje: totalConv < req.limitePlan.conversaciones
  });
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
    if(totalConv >= req.limitePlan.conversaciones) return res.status(403).json({error:`⛔ Límite ${req.limitePlan.nombre}: ${req.limitePlan.conversaciones===999999999?'ilimitado':req.limitePlan.conversaciones} conversaciones alcanzado. Ya tienes ${totalConv}. Cambia a Gold ilimitado al 3133181851`});
    let tipo='texto';
    if(req.file){
      if(req.file.mimetype.startsWith('image')) tipo='foto';
      else if(req.file.mimetype.startsWith('audio')) tipo='audio';
      else tipo='archivo';
    }
    const msg={
      id:uuidv4(), agenciaId:ag, empresa:req.user.empresa,
      from:'yo', to:req.body.to, texto:req.body.texto||'[Archivo]',
      tipo, archivo:req.file?req.file.filename:null,
      timestamp:Date.now(), leido:true, campania:false
    };
    mensajes.push(msg);
    save('mensajes.json', mensajes);
    // métrica tiempo primera respuesta
    let met = metricasAgentes.find(m=> m.agenteId===req.user.id);
    if(!met){ met={agenteId:req.user.id, agencia:req.user.empresa, primeraRespuesta:0, resolucionProm:0, chatsAtendidos:0, totalTiempo:0}; metricasAgentes.push(met); }
    met.chatsAtendidos++; save('metricasAgentes.json', metricasAgentes);
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
    if(totalActual + numeros.length > req.limitePlan.conversaciones) return res.status(403).json({error:`No puedes crear campaña de ${numeros.length} números: tu plan ${req.limitePlan.nombre} permite ${req.limitePlan.conversaciones>900000?'Ilimitado':req.limitePlan.conversaciones}, ya tienes ${totalActual}. Solo te quedan ${req.limitePlan.conversaciones-totalActual}. Pásate a Gold ilimitado 3133181851`});
    const camp={
      id:uuidv4(), agenciaId:ag, nombre:req.body.nombre||'Campaña '+(campanias.length+1),
      numeros, total:numeros.length, enviados:0, plantilla:req.body.plantilla,
      createdAt:new Date().toISOString(),
      historial:[{fecha:new Date().toISOString(), accion:`Excel subido con ${numeros.length} números detectados automáticamente`} ]
    };
    campanias.push(camp);
    save('campanias.json', campanias);
    const agencia = agencias.find(a=> a.nombre===req.user.empresa);
    if(agencia){ agencia.totalCampanias=campanias.filter(c=> c.agenciaId===ag || c.agenciaId===req.user.empresa).length; save('agencias.json',agencias); }
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
    if(totalActual + camp.numeros.length > req.limitePlan.conversaciones) return res.status(403).json({error:`Límite superado para enviar: Plan ${req.limitePlan.nombre} ${req.limitePlan.conversaciones>900000?'Ilimitado':req.limitePlan.conversaciones} conv. Tienes ${totalActual} + ${camp.numeros.length} = ${totalActual+camp.numeros.length}. Cambia a Gold 3133181851`});
    camp.numeros.forEach(num=>{
      mensajes.push({
        id:uuidv4(), agenciaId:camp.agenciaId, empresa:req.user.empresa,
        from:num, to:num, texto:tpl.contenido, tipo:'texto',
        timestamp:Date.now(), leido:false, campania:true, esCampania:true, noLeido:true
      });
    });
    save('mensajes.json', mensajes);
    camp.enviados=camp.numeros.length;
    camp.historial.push({fecha:new Date().toISOString(), accion:`Enviados ${camp.enviados} con plantilla APROBADA ${tpl.nombre} - Punto amarillo activado`});
    save('campanias.json', campanias);
    const agencia = agencias.find(a=> a.nombre===req.user.empresa);
    if(agencia){ agencia.totalMensajes=mensajes.filter(m=> m.agenciaId===ag || m.agenciaId===req.user.empresa).length; save('agencias.json',agencias); }
    io.emit('campania_enviada', camp);
    res.json({ok:true, enviados:camp.enviados});
  }catch(e){ console.error(e); res.status(500).json({error:'Error campaña'}); }
});

app.get('/api/trabajadores', auth, (req,res)=>{
  if(!isAdmin(req)) return res.status(403).json({error:'Solo admin'});
  const list = usuarios.filter(u=> u.empresa===req.user.empresa);
  res.json(list.map(u=>({
    id:u.id, nombre:u.nombre, email:u.email, rol:u.rol,
    plan:u.plan, planDesbloqueado:u.planDesbloqueado, activo:u.activo,
    tieneIA:getLimite(u.planDesbloqueado||u.plan).ia,
    tieneLlamadas:getLimite(u.planDesbloqueado||u.plan).llamadas
  })));
});

app.post('/api/trabajadores', auth, checkPlan, async (req,res)=>{
  try{
    if(!isAdmin(req)) return res.status(403).json({error:'Solo admin'});
    const totalTrab = usuarios.filter(u=> u.empresa===req.user.empresa).length;
    if(totalTrab >= req.limitePlan.trabajadores) return res.status(403).json({error:`⛔ Límite ${req.limitePlan.nombre}: solo ${req.limitePlan.trabajadores>900000?'Ilimitado':req.limitePlan.trabajadores} trabajadores permitidos (incluyes jefe). Ya tienes ${totalTrab}. Premium permite 10, Gold ilimitado. WhatsApp 3133181851`});
    if(usuarios.find(u=> u.email.toLowerCase()===req.body.email.toLowerCase())) return res.status(400).json({error:'Correo ya existe'});
    const hash = await bcrypt.hash(req.body.password,10);
    const nuevo={
      id:uuidv4(), nombre:req.body.nombre, email:req.body.email.toLowerCase(),
      password:hash, plain:req.body.password, rol:'Trabajador',
      empresa:req.user.empresa, empresaId:req.user.empresaId,
      plan:req.user.plan, planDesbloqueado:req.user.planDesbloqueado||req.user.plan,
      activo:true, createdAt:new Date().toISOString()
    };
    usuarios.push(nuevo);
    save('usuarios.json', usuarios);
    const ag = agencias.find(a=> a.nombre===req.user.empresa);
    if(ag){ ag.totalTrabajadores=usuarios.filter(u=>u.empresa===ag.nombre).length; save('agencias.json', agencias); }
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({error:'Error agregando'}); }
});

app.delete('/api/trabajadores/:id', auth, (req,res)=>{
  try{
    if(!isAdmin(req)) return res.status(403).json({error:'Solo admin'});
    const idx = usuarios.findIndex(u=> u.id===req.params.id && u.empresa===req.user.empresa);
    if(idx===-1) return res.status(404).json({error:'No encontrado'});
    if(usuarios[idx].esSuperAdmin) return res.status(403).json({error:'No puedes eliminar SuperAdmin'});
    usuarios.splice(idx,1);
    save('usuarios.json', usuarios);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:'Error eliminando'}); }
});

// CONTACTOS - ESTADO Y NOTAS
app.get('/api/contactos/:numero', auth, (req,res)=>{
  try{
    const ag = req.user.empresaId || req.user.empresa;
    let c = contactos.find(x=> x.numero===req.params.numero && (x.agenciaId===ag || x.agencia===req.user.empresa));
    if(!c){
      c = { numero:req.params.numero, agenciaId:ag, agencia:req.user.empresa, estado:'nuevo', notas:'', historial:[], updatedAt:new Date().toISOString() };
    }
    res.json(c);
  }catch(e){ res.status(500).json({error:'Error contacto'}); }
});

app.post('/api/contactos/:numero', auth, (req,res)=>{
  try{
    const ag = req.user.empresaId || req.user.empresa;
    const {estado, notas} = req.body;
    let idx = contactos.findIndex(x=> x.numero===req.params.numero && (x.agenciaId===ag || x.agencia===req.user.empresa));
    if(idx===-1){
      const nuevo = {
        id:uuidv4(), numero:req.params.numero, agenciaId:ag, agencia:req.user.empresa,
        estado:estado||'nuevo', notas:notas||'',
        historial:[{fecha:new Date().toISOString(), accion:`Creado como ${estado||'nuevo'}`}],
        createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
      };
      contactos.push(nuevo);
      save('contactos.json', contactos);
      return res.json(nuevo);
    } else {
      if(estado) contactos[idx].estado = estado;
      if(notas!==undefined) contactos[idx].notas = notas;
      contactos[idx].historial.push({fecha:new Date().toISOString(), accion:`Actualizado a ${estado} - Nota: ${(notas||'').slice(0,60)}`});
      contactos[idx].updatedAt = new Date().toISOString();
      save('contactos.json', contactos);
      return res.json(contactos[idx]);
    }
  }catch(e){ console.error(e); res.status(500).json({error:'Error guardando contacto'}); }
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

// ================== NUEVOS MODULOS - NO ROMPEN LO ANTERIOR ==================

// 1. MULTIAGENTE - Round Robin, Especialidad, Carga, Permisos, Ocultar telefono, Susurro, Metricas respuesta
app.get('/api/agentes/equipo', auth, (req,res)=>{
  const equipo = usuarios.filter(u=> u.empresa===req.user.empresa).map(u=>{
    const met = metricasAgentes.find(m=> m.agenteId===u.id) || {chatsAtendidos:0, primeraRespuesta:0};
    const carga = mensajes.filter(m=> m.asignadoA===u.id &&!m.leido).length;
    const ocultar = req.user.rol==='Trabajador' &&!getLimite(req.user.planDesbloqueado||req.user.plan).ia? true : false;
    return {id:u.id, nombre:u.nombre, rol:u.rol, carga, metricas:met, ocultarTelefono:ocultar};
  });
  res.json(equipo);
});

app.post('/api/chats/asignar', auth, checkPlan, (req,res)=>{
  const {numero, agenteId, tipo} = req.body;
  const ag = req.user.empresaId || req.user.empresa;
  let asignado = agenteId;
  const equipo = usuarios.filter(u=> u.empresa===req.user.empresa && u.activo);
  if(tipo==='roundrobin' ||!agenteId){
    let cfg = agentesCfg.find(a=> a.agencia===req.user.empresa);
    if(!cfg){ cfg={agencia:req.user.empresa, lastIndex:0}; agentesCfg.push(cfg); }
    asignado = equipo[cfg.lastIndex % equipo.length]?.id || equipo[0]?.id;
    cfg.lastIndex = (cfg.lastIndex+1) % equipo.length;
    save('agentes.json', agentesCfg);
  }
  if(tipo==='carga'){
    const porCarga = equipo.map(u=> ({...u, carga:mensajes.filter(m=> m.asignadoA===u.id).length})).sort((a,b)=> a.carga-b.carga);
    asignado = porCarga[0]?.id;
  }
  mensajes.filter(m=> (m.from===numero || m.to===numero) && (m.agenciaId===ag || m.agencia===req.user.empresa)).forEach(m=> m.asignadoA=asignado);
  save('mensajes.json', mensajes);
  io.emit('chat_asignado', {numero, asignadoA:asignado});
  res.json({ok:true, asignadoA:asignado});
});

app.post('/api/chats/susurro', auth, (req,res)=>{
  const {numero, texto} = req.body;
  const s = {id:uuidv4(), numero, agencia:req.user.empresa, autor:req.user.nombre, texto, timestamp:Date.now()};
  susurros.push(s); save('susurros.json', susurros);
  io.emit('nuevo_susurro', s);
  res.json({ok:true});
});
app.get('/api/chats/susurros/:numero', auth, (req,res)=>{
  res.json(susurros.filter(s=> s.numero===req.params.numero && s.agencia===req.user.empresa));
});

// 2. PIPELINE KANBAN + PAGOS + ROI
const ETAPAS = ['Lead Entrante','Cotización Enviada','Pago Pendiente','Cerrado Ganado','Perdido'];
app.get('/api/pipeline', auth, (req,res)=>{
  const ag = req.user.empresaId || req.user.empresa;
  let pipe = pipelines.filter(p=> p.agenciaId===ag || p.agencia===req.user.empresa);
  if(pipe.length===0){
    ETAPAS.forEach(et=> pipelines.push({id:uuidv4(), agenciaId:ag, agencia:req.user.empresa, etapa:et, tarjetas:[]}));
    save('pipelines.json', pipelines);
    pipe = pipelines.filter(p=> p.agenciaId===ag);
  }
  res.json(pipe);
});
app.post('/api/pipeline/mover', auth, (req,res)=>{
  const {contactoNumero, deEtapa, aEtapa, valor, campaniaId} = req.body;
  const ag = req.user.empresaId || req.user.empresa;
  pipelines.forEach(p=> { if((p.agenciaId===ag || p.agencia===req.user.empresa) && p.etapa===deEtapa){ p.tarjetas = p.tarjetas.filter(t=> t.numero!==contactoNumero); }});
  let dest = pipelines.find(p=> (p.agenciaId===ag || p.agencia===req.user.empresa) && p.etapa===aEtapa);
  if(!dest){ dest={id:uuidv4(), agenciaId:ag, agencia:req.user.empresa, etapa:aEtapa, tarjetas:[]}; pipelines.push(dest); }
  dest.tarjetas.push({numero:contactoNumero, valor:valor||0, campaniaId, movedAt:new Date().toISOString()});
  save('pipelines.json', pipelines);
  res.json({ok:true});
});
app.post('/api/pagos/link', auth, checkPlan, (req,res)=>{
  const {numero, monto, pasarela, concepto, campaniaId} = req.body;
  const linkId = uuidv4().slice(0,8);
  const link = `https://pay.klidoavanza.com/${pasarela}/${linkId}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(link)}&size=200x200`;
  const pago = {id:uuidv4(), numero, agencia:req.user.empresa, agenciaId:req.user.empresaId||req.user.empresa, monto, pasarela, concepto, campaniaId, link, qr, estado:'pendiente', createdAt:new Date().toISOString()};
  linksPago.push(pago); save('linksPago.json', linksPago);
  mensajes.push({id:uuidv4(), agenciaId:req.user.empresaId||req.user.empresa, empresa:req.user.empresa, from:'yo', to:numero, texto:`💳 Link de pago ${concepto} $${monto} - ${link}`, tipo:'texto', timestamp:Date.now(), leido:true, esPago:true});
  save('mensajes.json', mensajes);
  res.json({ok:true, pago});
});
app.post('/api/webhooks/pago-confirmado/:pasarela', (req,res)=>{
  const {numero, monto, referencia, campaniaId} = req.body;
  const pago = linksPago.find(p=> p.link.includes(referencia) || p.numero===numero);
  if(pago){ pago.estado='pagado'; pago.pagadoEn=new Date().toISOString(); save('linksPago.json', linksPago);
    let dest = pipelines.find(p=> p.agenciaId===pago.agenciaId && p.etapa==='Cerrado Ganado');
    if(dest){ dest.tarjetas.push({numero:pago.numero, valor:monto||pago.monto, movedAt:new Date().toISOString(), pasarela:pago.pasarela}); save('pipelines.json', pipelines); }
    pagos.push({agencia:pago.agencia, agenciaId:pago.agenciaId, monto:monto||pago.monto, campaniaId:campaniaId||pago.campaniaId||null, fecha:new Date().toISOString()});
    save('pagos.json', pagos);
  }
  res.json({ok:true});
});
app.get('/api/reportes/atribucion', auth, (req,res)=>{
  const ag = req.user.empresaId || req.user.empresa;
  const report = campanias.filter(c=> c.agenciaId===ag || c.agencia===req.user.empresa).map(c=>{
    const ventas = pagos.filter(p=> p.campaniaId===c.id).reduce((a,b)=> a+b.monto,0);
    const conv = pagos.filter(p=> p.campaniaId===c.id).length;
    const total = c.enviados||c.total||1;
    return {id:c.id, nombre:c.nombre, envios:total, ventas, conversion:((conv/total)*100).toFixed(1)+'%', roi:`$${ventas}`};
  });
  const totalVentas = pagos.filter(p=> p.agencia===req.user.empresa || p.agenciaId===ag).reduce((a,b)=> a+b.monto,0);
  res.json({campanias:report, totalVentas});
});

// 3. AUTOMATIZACIONES Y TRIGGERS
app.get('/api/automatizaciones', auth, (req,res)=> res.json(automatizaciones.filter(a=> a.agencia===req.user.empresa)));
app.post('/api/automatizaciones', auth, checkPlan, (req,res)=>{
  if(!req.limitePlan.ia) return res.status(403).json({error:'Automatizaciones solo Premium/Gold'});
  const {nombre, trigger, acciones} = req.body;
  const auto = {id:uuidv4(), agencia:req.user.empresa, nombre, trigger, acciones, activo:true, createdAt:new Date().toISOString()};
  automatizaciones.push(auto); save('automatizaciones.json', automatizaciones);
  res.json({ok:true, auto});
});
app.post('/api/etiquetas/score', auth, (req,res)=>{
  const {numero, tag, score} = req.body;
  let et = etiquetas.find(e=> e.numero===numero && e.agencia===req.user.empresa);
  if(!et){ et={numero, agencia:req.user.empresa, tags:[], score:0}; etiquetas.push(et); }
  if(tag &&!et.tags.includes(tag)) et.tags.push(tag);
  if(score) et.score = (et.score||0)+score;
  save('etiquetas.json', etiquetas);
  res.json({ok:true, etiqueta:et});
});
app.get('/api/etiquetas/:numero', auth, (req,res)=>{
  res.json(etiquetas.find(e=> e.numero===req.params.numero && e.agencia===req.user.empresa) || {tags:[], score:0});
});

// 4. AGENDAMIENTO
app.post('/api/calendario/conectar', auth, (req,res)=>{
  const {tipo, token} = req.body;
  calendarios = calendarios.filter(c=> c.agencia!==req.user.empresa);
  calendarios.push({agencia:req.user.empresa, tipo, token, conectadoEn:new Date().toISOString()});
  save('calendarios.json', calendarios);
  res.json({ok:true});
});
app.post('/api/reservas/crear', auth, (req,res)=>{
  const {numero, fecha, duracion, concepto} = req.body;
  const reserva = {id:uuidv4(), numero, agencia:req.user.empresa, fecha, duracion:duracion||60, concepto, estado:'confirmada', createdAt:new Date().toISOString()};
  reservas.push(reserva); save('reservas.json', reservas);
  mensajes.push({id:uuidv4(), agenciaId:req.user.empresaId||req.user.empresa, empresa:req.user.empresa, from:'yo', to:numero, texto:`📅 Cita confirmada ${concepto} el ${new Date(fecha).toLocaleString()}`, tipo:'texto', timestamp:Date.now(), leido:true});
  save('mensajes.json', mensajes);
  res.json({ok:true, reserva});
});
app.get('/api/reservas', auth, (req,res)=> res.json(reservas.filter(r=> r.agencia===req.user.empresa)));

// 5. INFRAESTRUCTURA - Salud numero, Warmup, Webhooks API
app.get('/api/health/numero', auth, (req,res)=>{
  const h = healthNumeros.find(x=> x.agencia===req.user.empresa) || {agencia:req.user.empresa, qualityScore:'ALTO', estado:'Conectado', bloqueos:0, spamRate:'0.1%', warmup:false, dosisPorHora:50};
  res.json(h);
});
app.post('/api/health/warmup', auth, (req,res)=>{
  const {activar, dosisPorHora} = req.body;
  let h = healthNumeros.find(x=> x.agencia===req.user.empresa);
  if(!h){ h={agencia:req.user.empresa, qualityScore:'MEDIO', estado:activar?'Warmup activo':'Conectado', bloqueos:0, spamRate:'0.5%', warmup:activar, dosisPorHora:dosisPorHora||50}; healthNumeros.push(h); }
  else { h.warmup=activar; h.dosisPorHora=dosisPorHora||50; h.estado=activar?'Warmup activo':'Conectado'; }
  save('healthNumeros.json', healthNumeros);
  res.json({ok:true, health:h});
});
app.post('/api/webhooks/cliente/registrar', auth, (req,res)=>{
  const {url, eventos, origen} = req.body;
  const wh = {id:uuidv4(), agencia:req.user.empresa, url, eventos: eventos||['pedido','lead'], origen:origen||'shopify', activo:true, createdAt:new Date().toISOString()};
  webhooksClientes.push(wh); save('webhooksClientes.json', webhooksClientes);
  res.json({ok:true, webhook:wh});
});
app.get('/api/webhooks/cliente', auth, (req,res)=> res.json(webhooksClientes.filter(w=> w.agencia===req.user.empresa)));
app.post('/api/webhooks/entrada/:agencia', (req,res)=>{
  const agenciaNombre = decodeURIComponent(req.params.agencia);
  const data = req.body;
  const numero = data.telefono||data.phone||data.customer_phone||data.numero||'webhook_'+Date.now();
  mensajes.push({id:uuidv4(), agenciaId:agenciaNombre, empresa:agenciaNombre, from:numero, to:numero, texto:`🛒 Webhook ${req.headers['x-origen']||'externo'} - ${JSON.stringify(data).slice(0,300)}`, tipo:'texto', timestamp:Date.now(), leido:false, noLeido:true, esWebhook:true, esCampania:false});
  save('mensajes.json', mensajes);
  io.emit('nuevo_mensaje', mensajes[mensajes.length-1]);
  res.json({ok:true});
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/app.html', (req,res)=> res.sendFile(path.join(__dirname,'public','app.html')));
app.get('/terminos.html', (req,res)=> res.sendFile(path.join(__dirname,'public','terminos.html')));

io.use((socket,next)=>{
  try{
    const token=socket.handshake.auth?.token;
    if(!token) return next(new Error('No token'));
    const d=jwt.verify(token,JWT_SECRET);
    socket.userId=d.id;
    next();
  }catch(e){ next(new Error('Auth error')); }
});

io.on('connection', (socket)=>{
  socket.on('marcar_leido', (id)=>{
    const m=mensajes.find(x=>x.id===id);
    if(m){ m.leido=false; m.noLeido=false; save('mensajes.json', mensajes); io.emit('mensaje_leido', id); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log(`✅ KLIDO AVANZA CRM REAL con bloqueos 1000/5000/ilimitado + contactos + MULTIAGENTE + PIPELINE + PAGOS + AUTOMATIZACIONES + RESERVAS + HEALTH corriendo en ${PORT}`));
