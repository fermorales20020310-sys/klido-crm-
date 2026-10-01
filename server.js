require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_avanza_2026_super_secure_real';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
if(!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if(!fs.existsSync('data')) fs.mkdirSync('data');
const upload = multer({ dest: 'uploads/' });

function load(file, def){
  try{
    const p = path.join(__dirname,'data',file);
    if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8'));
  }catch(e){ console.log('Load error',file,e.message); }
  return def;
}
function save(file, data){
  try{ fs.writeFileSync(path.join(__dirname,'data',file), JSON.stringify(data,null,2)); }catch(e){ console.error('Save error',file,e); }
}

let agencias = load('agencias.json', []);
let usuarios = load('usuarios.json', [
  { id:'superadmin-1', nombre:'Fer Morales', email:'fermorales20020310@gmail.com', password:bcrypt.hashSync('Mafe2002@',10), plain:'Mafe2002@', rol:'SuperAdmin', empresa:'KLIDO AVANZA', plan:'gold', planDesbloqueado:'gold', activo:true, esSuperAdmin:true, createdAt:new Date() }
]);
let mensajes = load('mensajes.json', []);
let campanias = load('campanias.json', []);
let plantillas = load('plantillas.json', [
  { id:'tpl1', nombre:'bienvenida_oficial', estado:'APROBADA', contenido:'Hola {{1}}, bienvenido a Klido Avanza Consulting {{2}}', categoria:'MARKETING' },
  { id:'tpl2', nombre:'seguimiento_pedido', estado:'APROBADA', contenido:'Hola {{1}}, tu pedido {{2}} está en camino. Gracias por confiar en nosotros.', categoria:'UTILITY' }
]);
let codigosPago = load('codigos.json', {});
let resetCodes = {};

console.log(`=== KLIDO CRM REAL - MERCADO === Agencias:${agencias.length} Usuarios:${usuarios.length} Mensajes:${mensajes.length}`);

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h) return res.status(401).json({error:'Sesión expirada, ingresa de nuevo'});
  try{ req.user=jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Token inválido'}); }
}

app.get('/health',(req,res)=>res.send('OK KLIDO REAL'));

app.post('/api/login', async (req,res)=>{
  try{
    const { email, password } = req.body;
    if(!email||!password) return res.status(400).json({error:'Faltan datos'});
    const u = usuarios.find(x=> x.email.toLowerCase()===email.trim().toLowerCase());
    if(!u) return res.status(401).json({error:'Correo no registrado'});
    const ok = await bcrypt.compare(password, u.password) || password===u.plain;
    if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
    if(u.activo===false && !u.esSuperAdmin) return res.status(403).json({error:'Tu plan está pendiente de activación. Envía tu código de pago al WhatsApp 3133181851'});
    const token = jwt.sign({id:u.id,email:u.email,rol:u.rol,empresa:u.empresa,plan:u.planDesbloqueado}, JWT_SECRET, {expiresIn:'7d'});
    res.json({token, user:{id:u.id,nombre:u.nombre,email:u.email,rol:u.rol,empresa:u.empresa,plan:u.planDesbloqueado||u.plan, esSuperAdmin:u.esSuperAdmin||false}});
  }catch(e){ console.error(e); res.status(500).json({error:'Error interno login'}); }
});

app.post('/api/public/crear-empresa', async (req,res)=>{
  try{
    const { nombre, email, password, plan } = req.body;
    if(!nombre||!email||!password||!plan) return res.status(400).json({error:'Completa todos los campos'});
    if(usuarios.some(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Correo ya registrado en otra agencia'});
    const codigo = `KLIDO-${plan.toUpperCase()}-${Math.floor(1000+Math.random()*9000)}`;
    const precios = { basico:{anual:800000, trim:80000, asesores:3}, premium:{anual:1400000, trim:95000, asesores:10}, gold:{anual:2400000, trim:120000, asesores:999} };
    const p = precios[plan];
    const agencia = { id:uuidv4(), nombre: nombre.trim(), email: email.trim().toLowerCase(), plan, anual:p.anual, trim:p.trim, asesores:p.asesores, codigo, activo:false, createdAt:new Date().toISOString(), totalTrabajadores:1, estado:'PENDIENTE_PAGO' };
    agencias.push(agencia); save('agencias.json', agencias);
    codigosPago[codigo]={ agenciaId:agencia.id, plan, email:email.toLowerCase(), trim:p.trim, anual:p.anual, createdAt:new Date().toISOString() }; save('codigos.json', codigosPago);
    const hash = await bcrypt.hash(password,10);
    usuarios.push({ id:agencia.id, nombre: nombre.trim(), email:email.toLowerCase(), password:hash, plain:password, rol:'Admin', empresa:nombre.trim(), plan, planDesbloqueado:null, activo:false, codigoPendiente:codigo, createdAt:new Date().toISOString() });
    save('usuarios.json', usuarios);
    console.log(`VENTA NUEVA: ${nombre} ${email} ${plan} ${codigo}`);
    res.json({ok:true, codigo, plan, mensaje:`Registro exitoso. Tu código ${codigo} será enviado a ${email} tras confirmar pago al WhatsApp 3133181851. Anual: $${p.anual} + Mantenimiento: $${p.trim}/trim`});
  }catch(e){ console.error(e); res.status(500).json({error:'Error creando empresa'}); }
});

app.post('/api/public/verificar-codigo', (req,res)=>{
  try{
    const { email, codigo } = req.body;
    const data = codigosPago[codigo?.trim()];
    if(!data || data.email.toLowerCase()!==email.toLowerCase()) return res.status(400).json({error:'Código inválido o correo no coincide'});
    const u = usuarios.find(x=> x.email.toLowerCase()===email.toLowerCase());
    if(u){ u.planDesbloqueado=data.plan; u.activo=true; delete u.codigoPendiente; save('usuarios.json', usuarios); }
    const ag = agencias.find(a=> a.id===data.agenciaId);
    if(ag){ ag.activo=true; ag.estado='ACTIVA'; ag.fechaActivacion=new Date().toISOString(); save('agencias.json', agencias); }
    res.json({ok:true, planDesbloqueado:data.plan, message:'Plan activado correctamente'});
  }catch(e){ res.status(500).json({error:'Error verificando'}); }
});

app.get('/api/admin/agencias', auth, (req,res)=>{
  const me = usuarios.find(x=> x.id===req.user.id);
  if(!me?.esSuperAdmin && me?.rol!=='SuperAdmin') return res.status(403).json({error:'Solo SuperAdmin'});
  const lista = agencias.map(ag=>{
    const trab = usuarios.filter(us=> us.empresa===ag.nombre);
    const msgs = mensajes.filter(m=> m.agenciaId===ag.nombre).length;
    const camps = campanias.filter(c=> c.agenciaId===ag.nombre).length;
    return {...ag, trabajadores: trab, totalMensajes: msgs, totalCampanias: camps, listaTrabajadores: trab.map(t=> ({nombre:t.nombre,email:t.email,rol:t.rol,activo:t.activo})) };
  });
  res.json({ totalAgencias: agencias.length, totalUsuarios: usuarios.length, totalMensajes: mensajes.length, agencias: lista });
});

app.get('/api/mensajes', auth, (req,res)=> res.json(mensajes.filter(m=> m.agenciaId===req.user.empresa || m.agenciaId===req.user.id).sort((a,b)=> b.timestamp - a.timestamp)));
app.post('/api/mensajes/enviar', auth, upload.single('archivo'), (req,res)=>{
  try{
    const { to, texto } = req.body;
    let tipo='texto';
    if(req.file){
      if(req.file.mimetype.startsWith('image')) tipo='foto';
      else if(req.file.mimetype.startsWith('audio')) tipo='audio';
      else tipo='archivo';
    }
    const msg = { id:uuidv4(), agenciaId:req.user.empresa, from:'yo', to: to||'cliente', texto: texto||'[Archivo]', tipo, archivo:req.file? req.file.filename : null, timestamp:Date.now(), leido:true, campania:false, noLeido:false };
    mensajes.push(msg); save('mensajes.json', mensajes);
    io.emit('nuevo_mensaje', msg);
    res.json({ok:true, mensaje:msg});
  }catch(e){ res.status(500).json({error:'Error enviando'}); }
});
app.post('/webhook/meta', (req,res)=>{
  const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if(entry){
    const msg = { id:uuidv4(), agenciaId:'KLIDO AVANZA', from:entry.from, texto:entry.text?.body||'[Media]', tipo:entry.type||'texto', timestamp:Date.now(), leido:false, campania:false, noLeido:true, esCampania:Math.random()>0.6 };
    mensajes.push(msg); save('mensajes.json', mensajes);
    io.emit('nuevo_mensaje', msg);
  }
  res.sendStatus(200);
});
app.get('/api/plantillas', auth, (req,res)=> res.json(plantillas.filter(p=> p.estado==='APROBADA')));
app.post('/api/campanias/upload', auth, upload.single('excel'), (req,res)=>{
  try{
    const wb = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const numeros = data.map(r=> String(r.telefono||r.numero||r.celular||Object.values(r)[0]||'')).filter(n=> n.replace(/\D/g,'').length>=10);
    const camp = { id:uuidv4(), agenciaId:req.user.empresa, nombre:req.body.nombre||`Campaña ${new Date().toLocaleDateString()}`, numeros, total:numeros.length, enviados:0, plantilla:req.body.plantilla, createdAt:new Date().toISOString(), historial:[] };
    campanias.push(camp); save('campanias.json', campanias);
    fs.unlinkSync(req.file.path);
    res.json({ok:true, campania:camp});
  }catch(e){ res.status(500).json({error:'Excel inválido. Debe tener columna telefono'}); }
});
app.post('/api/campanias/enviar', auth, (req,res)=>{
  try{
    const camp = campanias.find(c=> c.id===req.body.campaniaId);
    if(!camp) return res.status(404).json({error:'Campaña no encontrada'});
    const tpl = plantillas.find(p=> p.id===camp.plantilla);
    if(!tpl) return res.status(400).json({error:'Solo plantillas aprobadas por META'});
    camp.numeros.forEach(num=>{
      mensajes.push({ id:uuidv4(), agenciaId:camp.agenciaId, from:num, to:num, texto:tpl.contenido, tipo:'texto', timestamp:Date.now(), leido:false, campania:true, noLeido:true, esCampania:true });
    });
    save('mensajes.json', mensajes);
    camp.enviados=camp.numeros.length;
    camp.historial.push({ fecha:new Date().toISOString(), accion:`Enviados ${camp.enviados} con plantilla ${tpl.nombre}` });
    save('campanias.json', campanias);
    io.emit('campania_enviada', camp);
    res.json({ok:true, enviados:camp.enviados});
  }catch(e){ res.status(500).json({error:'Error enviando campaña'}); }
});
app.get('/api/campanias', auth, (req,res)=> res.json(campanias.filter(c=> c.agenciaId===req.user.empresa)));
app.get('/api/metricas', auth, (req,res)=>{
  const ag = req.user.empresa;
  const msgs = mensajes.filter(m=> m.agenciaId===ag);
  const me = usuarios.find(u=> u.id===req.user.id);
  res.json({ total:msgs.length, noLeidos:msgs.filter(m=>!m.leido).length, campania:msgs.filter(m=>m.campania).length, campanias:campanias.filter(c=>c.agenciaId===ag).length, trabajadores:usuarios.filter(u=>u.empresa===ag).length, esSuperAdmin: me?.esSuperAdmin||false, totalAgencias: agencias.length });
});
app.get('/api/trabajadores', auth, (req,res)=> res.json(usuarios.filter(u=>u.empresa===req.user.empresa)));
app.post('/api/trabajadores', auth, async (req,res)=>{
  if(!['Admin','SuperAdmin'].includes(req.user.rol)) return res.status(403).json({error:'Solo el administrador puede agregar'});
  const jefe = usuarios.find(u=>u.id===req.user.id);
  const hash = await bcrypt.hash(req.body.password,10);
  const nuevo = { id:uuidv4(), nombre:req.body.nombre, email:req.body.email.toLowerCase(), password:hash, plain:req.body.password, rol:'Trabajador', empresa:jefe.empresa, plan:jefe.plan, planDesbloqueado:jefe.planDesbloqueado, activo:true, createdAt:new Date().toISOString() };
  usuarios.push(nuevo); save('usuarios.json', usuarios);
  const ag = agencias.find(a=> a.nombre===jefe.empresa);
  if(ag){ ag.totalTrabajadores = usuarios.filter(u=>u.empresa===ag.nombre).length; save('agencias.json', agencias); }
  res.json({ok:true});
});
app.delete('/api/trabajadores/:id', auth, (req,res)=>{
  if(!['Admin','SuperAdmin'].includes(req.user.rol)) return res.status(403).json({error:'Solo admin'});
  usuarios = usuarios.filter(u=>u.id!==req.params.id); save('usuarios.json', usuarios);
  res.json({ok:true});
});
app.post('/api/auth/forgot',(req,res)=>{
  const code=String(Math.floor(100000+Math.random()*900000));
  resetCodes[req.body.email.toLowerCase()]=code;
  console.log('RESET',req.body.email,code);
  res.json({ok:true, message:'Código: '+code});
});
app.post('/api/auth/reset', async (req,res)=>{
  const { email, code, newPassword }=req.body;
  if(resetCodes[email.toLowerCase()]!==code) return res.status(400).json({error:'Código inválido'});
  const u=usuarios.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(u){ u.password=await bcrypt.hash(newPassword,10); u.plain=newPassword; save('usuarios.json', usuarios); }
  delete resetCodes[email.toLowerCase()];
  res.json({ok:true, message:'Contraseña cambiada'});
});
app.get('/app.html',(req,res)=> res.sendFile(path.join(__dirname,'public','app.html')));
app.get('/terminos.html',(req,res)=> res.sendFile(path.join(__dirname,'public','terminos.html')));
app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
io.on('connection', socket=>{
  socket.on('marcar_leido', id=>{
    const m=mensajes.find(x=>x.id===id);
    if(m){ m.leido=true; m.noLeido=false; save('mensajes.json', mensajes); io.emit('mensaje_leido', id); }
  });
});
server.listen(PORT,'0.0.0.0',()=> console.log(`KLIDO CRM REAL MERCADO LISTO en ${PORT}`));
