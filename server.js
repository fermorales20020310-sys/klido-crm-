const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const xlsx = require('xlsx');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'klido-secreto-2025';

app.get('/health', (req,res) => res.status(200).send('ok'));
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Klido 12.2 Avanza Online en ${PORT}`));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
if(!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
const db = (name) => {
  const f = path.join(DATA_DIR, name+'.json');
  if(!fs.existsSync(f)) fs.writeFileSync(f, '[]');
  return {
    get: () => JSON.parse(fs.readFileSync(f,'utf8')),
    set: (d) => fs.writeFileSync(f, JSON.stringify(d,null,2)),
  }
}
const empresasDB = db('empresas');
const usuariosDB = db('usuarios');
const campanasDB = db('campanas');
const contactosDB = db('contactos');
const chatsDB = db('chats');
const codigosDB = db('codigos'); // para reset password

if(usuariosDB.get().length === 0){
  const hash = bcrypt.hashSync('admin123', 10);
  usuariosDB.set([{ id: uuidv4(), nombre:'Admin', email:'admin@klido.com', password:hash, rol:'superadmin', empresaId:null }]);
  console.log('Seed admin@klido.com / admin123');
}

function auth(req,res,next){
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'no token'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }catch{ res.status(401).json({error:'token invalido'}); }
}

// --- AUTH LOGIN (acepta codigo de empresa o email) ---
app.post('/api/login', async (req,res)=>{
  const {email,password, empresa} = req.body;
  let user = usuariosDB.get().find(u=>u.email===email);
  if(!user && empresa){
    const emp = empresasDB.get().find(e=> e.codigoAcceso===empresa || e.id===empresa );
    if(emp) user = usuariosDB.get().find(u=> u.empresaId===emp.id && u.email===email);
  }
  if(!user) return res.status(401).json({error:'Usuario no existe en esa empresa'});
  const ok = await bcrypt.compare(password, user.password);
  if(!ok) return res.status(401).json({error:'Clave incorrecta'});
  const token = jwt.sign({id:user.id, rol:user.rol, empresaId:user.empresaId}, JWT_SECRET, {expiresIn:'7d'});
  res.json({token, user:{id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresaId:user.empresaId}});
});

// --- NUEVO: CREAR EMPRESA PROFESIONAL CON PLAN Y TERMINOS ---
app.post('/api/public/crear-empresa', async (req,res)=>{
  const {nombre,email,password,plan, aceptaTerminos} = req.body;
  if(!nombre ||!email ||!password ||!plan) return res.status(400).json({error:'Faltan datos: nombre, correo, contraseña y plan'});
  if(!aceptaTerminos) return res.status(400).json({error:'Debes aceptar términos y condiciones'});

  const usuarios = usuariosDB.get();
  if(usuarios.find(u=>u.email===email)) return res.status(400).json({error:'Correo ya registrado'});

  const codigoAcceso = Math.random().toString(36).substring(2,8).toUpperCase();
  const empresaId = uuidv4();
  const empresas = empresasDB.get();

  // Simula pago - aqui va tu pasarela real (Wompi/MercadoPago)
  const nuevaEmpresa = {
    id: empresaId,
    nombre,
    codigoAcceso,
    plan, // starter, pro, enterprise
    estado:'activo',
    pago: { estado:'pagado', fecha: new Date(), monto: plan==='starter'?29: plan==='pro'?59:129 },
    createdAt: new Date()
  };
  empresas.push(nuevaEmpresa); empresasDB.set(empresas);

  const hash = await bcrypt.hash(password, 10);
  const nuevoAdmin = {
    id: uuidv4(),
    nombre: 'Admin '+nombre,
    email,
    password:hash,
    rol:'admin',
    empresaId,
    createdAt:new Date()
  };
  usuarios.push(nuevoAdmin); usuariosDB.set(usuarios);

  console.log(`✅ Empresa creada: ${nombre} Plan:${plan} Codigo:${codigoAcceso} Email:${email}`);

  res.json({ok:true, empresa: nuevaEmpresa, codigoAcceso, mensaje:'Empresa creada y plan '+plan+' activado. Usa el código '+codigoAcceso+' para ingresar.'});
});

// --- NUEVO: OLVIDE CONTRASEÑA ---
app.post('/api/auth/forgot', (req,res)=>{
  const {email} = req.body;
  if(!email) return res.status(400).json({error:'Correo requerido'});
  const user = usuariosDB.get().find(u=>u.email===email);
  if(!user) return res.status(404).json({error:'Correo no registrado en Klido'});

  const code = Math.floor(100000 + Math.random()*900000).toString();
  const codigos = codigosDB.get();
  codigos.push({ email, code, expira: Date.now()+15*60*1000, usado:false });
  codigosDB.set(codigos);

  console.log(`📧 CODIGO RECUPERACION para ${email}: ${code} - Expira 15min`);
  // Aqui conectas tu servicio de email real (Brevo/SendGrid)

  res.json({message:`Código enviado a ${email} (revisa spam). Código: ${code} - SOLO EN MODO TEST se muestra aqui`, testCode: code });
});

app.post('/api/auth/reset', async (req,res)=>{
  const {email, code, newPassword} = req.body;
  if(!email ||!code ||!newPassword) return res.status(400).json({error:'Faltan datos'});

  const codigos = codigosDB.get();
  const registro = codigos.find(c=> c.email===email && c.code===String(code) &&!c.usado && c.expira > Date.now());
  if(!registro) return res.status(400).json({error:'Código inválido o expirado'});

  const usuarios = usuariosDB.get();
  const u = usuarios.find(x=>x.email===email);
  if(!u) return res.status(404).json({error:'Usuario no existe'});

  u.password = await bcrypt.hash(newPassword, 10);
  usuariosDB.set(usuarios);

  registro.usado = true; codigosDB.set(codigos);
  res.json({message:'✅ Contraseña cambiada correctamente. Ya puedes ingresar.'});
});

// --- EMPRESAS (solo superadmin) ---
app.get('/api/empresas', auth, (req,res)=>{ res.json(empresasDB.get()); });
app.post('/api/empresas', auth, (req,res)=>{
  if(req.user.rol!=='superadmin') return res.status(403).json({error:'solo superadmin'});
  const {nombre, nit, plan} = req.body;
  const empresas = empresasDB.get();
  const nueva = { id: uuidv4(), nombre, nit, plan: plan||'basico', codigoAcceso: Math.random().toString(36).substring(2,8).toUpperCase(), createdAt: new Date() };
  empresas.push(nueva); empresasDB.set(empresas);
  res.json(nueva);
});

// --- USUARIOS ---
app.get('/api/usuarios', auth, (req,res)=>{
  let users = usuariosDB.get();
  if(req.user.rol!=='superadmin') users = users.filter(u=>u.empresaId===req.user.empresaId);
  res.json(users.map(({password,...u})=>u));
});
app.post('/api/usuarios', auth, async (req,res)=>{
  const {nombre,email,password,rol, empresaId} = req.body;
  const targetEmpresa = req.user.rol==='superadmin'? empresaId : req.user.empresaId;
  if(!targetEmpresa) return res.status(400).json({error:'empresa requerida'});
  const usuarios = usuariosDB.get();
  if(usuarios.find(u=>u.email===email)) return res.status(400).json({error:'email ya existe'});
  const hash = await bcrypt.hash(password, 10);
  const nuevo = { id: uuidv4(), nombre, email, password:hash, rol: rol||'asesor', empresaId: targetEmpresa, createdAt:new Date() };
  usuarios.push(nuevo); usuariosDB.set(usuarios);
  res.json({id:nuevo.id, nombre, email, rol:nuevo.rol, empresaId: targetEmpresa});
});

// --- CAMPAÑAS ---
app.get('/api/campanas', auth, (req,res)=>{
  let camps = campanasDB.get();
  if(req.user.rol!=='superadmin') camps = camps.filter(c=>c.empresaId===req.user.empresaId);
  res.json(camps);
});
app.post('/api/campanas', auth, (req,res)=>{
  const {nombre, descripcion} = req.body;
  const empresaId = req.user.rol==='superadmin'? req.body.empresaId : req.user.empresaId;
  const camps = campanasDB.get();
  const nueva = { id: uuidv4(), nombre, descripcion, empresaId, estado:'activa', totalContactos:0, createdAt:new Date() };
  camps.push(nueva); campanasDB.set(camps);
  io.emit('campana_nueva', nueva);
  res.json(nueva);
});

// --- EXCEL ---
const upload = multer({ dest: 'uploads/' });
app.post('/api/campanas/:id/upload', auth, upload.single('file'), (req,res)=>{
  try{
    const campanaId = req.params.id;
    const wb = xlsx.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);
    const contactos = contactosDB.get();
    let count = 0;
    rows.forEach(r=>{
      const tel = r.telefono || r.Telefono || r.celular || r.Celular || r.phone;
      if(!tel) return;
      contactos.push({ id: uuidv4(), campanaId, empresaId: req.user.empresaId, nombre: r.nombre || r.Nombre || '', telefono: String(tel), estado:'pendiente', asesorId:null, createdAt:new Date(), data:r });
      count++;
    });
    contactosDB.set(contactos);
    fs.unlinkSync(req.file.path);
    const camps = campanasDB.get(); const c = camps.find(x=>x.id===campanaId);
    if(c){ c.totalContactos += count; campanasDB.set(camps); }
    res.json({ok:true, importados: count});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/contactos/:campanaId', auth, (req,res)=>{ res.json(contactosDB.get().filter(c=>c.campanaId===req.params.campanaId)); });
app.post('/api/chats/asignar', auth, (req,res)=>{
  const {contactoId, asesorId} = req.body;
  const contactos = contactosDB.get(); const ct = contactos.find(c=>c.id===contactoId);
  if(!ct) return res.status(404).json({error:'no contacto'});
  ct.asesorId = asesorId; ct.estado='asignado'; contactosDB.set(contactos);
  io.emit('chat_asignado', ct); res.json(ct);
});
app.post('/api/whatsapp/webhook', (req,res)=>{
  const msg = req.body; const chats = chatsDB.get();
  chats.push({id:uuidv4(),...msg, createdAt:new Date()}); chatsDB.set(chats);
  io.emit('mensaje_nuevo', msg); res.json({ok:true});
});

app.get('*', (req,res)=>{
  const p = path.join(__dirname,'public','index.html');
  if(fs.existsSync(p)) return res.sendFile(p);
  res.send('Klido CRM 12.2 OK');
});
