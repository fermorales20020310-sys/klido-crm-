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
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Klido 12.2 Multiagencia Meta API Online ${PORT}`));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
if(!fs.existsSync('uploads')) fs.mkdirSync('uploads',{recursive:true});

const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
const db = (name) => {
  const f = path.join(DATA_DIR, name+'.json');
  if(!fs.existsSync(f)) fs.writeFileSync(f, '[]');
  return { get: () => JSON.parse(fs.readFileSync(f,'utf8')), set: (d) => fs.writeFileSync(f, JSON.stringify(d,null,2)) }
}
const empresasDB = db('empresas');
const usuariosDB = db('usuarios');
const campanasDB = db('campanas');
const contactosDB = db('contactos');
const chatsDB = db('chats');
const codigosDB = db('codigos');

// CREDENCIALES SUPERADMIN - FUNCIONALES
const FER_EMAIL = "fermorales20020310@gmail.com";
const FER_PASS = "Mafe2002@";
let usuarios = usuariosDB.get();
let fer = usuarios.find(u=>u.email.toLowerCase()===FER_EMAIL.toLowerCase());
if(!fer){
  const hash = bcrypt.hashSync(FER_PASS, 10);
  usuarios.push({ id: uuidv4(), nombre:'Fer Morales - SuperAdmin Avanza', email:FER_EMAIL, password:hash, rol:'superadmin', empresaId:null, createdAt:new Date() });
  usuariosDB.set(usuarios);
  console.log('✅ SuperAdmin CREADO: '+FER_EMAIL+' / '+FER_PASS);
} else {
  fer.password = bcrypt.hashSync(FER_PASS, 10);
  fer.rol='superadmin'; fer.empresaId=null;
  usuariosDB.set(usuarios);
  console.log('✅ SuperAdmin ACTUALIZADO Y FUNCIONAL: '+FER_EMAIL);
}

function auth(req,res,next){
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'no token'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }catch{ res.status(401).json({error:'token invalido'}); }
}

app.post('/api/login', async (req,res)=>{
  const {email,password,empresa} = req.body;
  const emailClean = String(email||'').trim().toLowerCase();
  const allUsers = usuariosDB.get();
  let user = allUsers.find(u=>u.email.toLowerCase()===emailClean);

  // Si pone codigo de agencia, valida que pertenezca
  if(empresa && empresa.trim()!==''){
    const emp = empresasDB.get().find(e=> e.codigoAcceso===String(empresa).toUpperCase().trim() || e.id===empresa.trim());
    if(!emp) return res.status(401).json({error:'Código de agencia no existe'});
    const found = allUsers.find(u=> u.empresaId===emp.id && u.email.toLowerCase()===emailClean);
    if(!found && user?.rol!=='superadmin') return res.status(401).json({error:'Usuario no pertenece a esa agencia'});
    if(found) user = found;
  }

  if(!user) return res.status(401).json({error:'Usuario no existe'});
  const ok = await bcrypt.compare(password, user.password);
  if(!ok) return res.status(401).json({error:'Clave incorrecta'});
  const token = jwt.sign({id:user.id, rol:user.rol, empresaId:user.empresaId}, JWT_SECRET, {expiresIn:'7d'});
  console.log(`LOGIN OK: ${emailClean} rol:${user.rol} empresa:${user.empresaId||'SUPERADMIN'}`);
  res.json({token, user:{id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresaId:user.empresaId}});
});

app.post('/api/public/crear-empresa', async (req,res)=>{
  const {nombre,email,password,plan,anual,mantenimiento,aceptaTerminos} = req.body;
  if(!nombre||!email||!password||!plan) return res.status(400).json({error:'Faltan datos'});
  if(!aceptaTerminos) return res.status(400).json({error:'Acepta términos'});
  const allUsers = usuariosDB.get();
  if(allUsers.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Correo ya registrado'});

  const codigoAcceso = Math.random().toString(36).substring(2,8).toUpperCase();
  const empresaId = uuidv4();
  const empresas = empresasDB.get();
  const nueva = {
    id:empresaId, nombre, codigoAcceso, plan, periodo:'anual',
    montoAnual: anual, mantenimientoTrimestral: mantenimiento,
    multiagencia: true, metaApi: true, estado:'activo',
    pago:{estado:'pagado', fecha:new Date(), anual, mantenimiento}, createdAt:new Date()
  };
  empresas.push(nueva); empresasDB.set(empresas);
  const hash = await bcrypt.hash(password, 10);
  allUsers.push({ id: uuidv4(), nombre:'Admin '+nombre, email, password:hash, rol:'admin', empresaId, createdAt:new Date() });
  usuariosDB.set(allUsers);
  console.log(`✅ Agencia Multiagencia Meta API creada: ${nombre} Plan:${plan} Anual:${anual} Mant:${mantenimiento} Codigo:${codigoAcceso}`);
  res.json({ok:true, empresa:nueva, codigoAcceso});
});

app.post('/api/auth/forgot', (req,res)=>{
  const {email} = req.body;
  const user = usuariosDB.get().find(u=>u.email.toLowerCase()===String(email).toLowerCase());
  if(!user) return res.status(404).json({error:'Correo no registrado'});
  const code = Math.floor(100000 + Math.random()*900000).toString();
  const codigos = codigosDB.get(); codigos.push({ email: email.toLowerCase(), code, expira: Date.now()+15*60*1000, usado:false }); codigosDB.set(codigos);
  console.log(`📧 CODIGO RECUPERACION ${email}: ${code}`);
  res.json({message:`Código enviado a ${email} (revisa spam)`, testCode: code});
});
app.post('/api/auth/reset', async (req,res)=>{
  const {email, code, newPassword} = req.body;
  const codigos = codigosDB.get();
  const reg = codigos.find(c=> c.email===String(email).toLowerCase() && c.code===String(code) &&!c.usado && c.expira>Date.now());
  if(!reg) return res.status(400).json({error:'Código inválido o expirado'});
  const usuarios = usuariosDB.get(); const u = usuarios.find(x=>x.email.toLowerCase()===String(email).toLowerCase());
  if(!u) return res.status(404).json({error:'no existe'});
  u.password = await bcrypt.hash(newPassword, 10); usuariosDB.set(usuarios);
  reg.usado=true; codigosDB.set(codigos);
  res.json({message:'✅ Contraseña cambiada, ya puedes ingresar'});
});

app.get('/api/empresas', auth, (req,res)=>{ res.json(empresasDB.get()); });
app.get('/api/usuarios', auth, (req,res)=>{
  let users = usuariosDB.get();
  if(req.user.rol!=='superadmin') users = users.filter(u=>u.empresaId===req.user.empresaId);
  res.json(users.map(({password,...u})=>u));
});
app.post('/api/usuarios', auth, async (req,res)=>{
  const {nombre,email,password,rol, empresaId} = req.body;
  const targetEmpresa = req.user.rol==='superadmin'? empresaId : req.user.empresaId;
  const usuarios = usuariosDB.get();
  if(usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'email ya existe'});
  const hash = await bcrypt.hash(password, 10);
  const nuevo = { id: uuidv4(), nombre, email, password:hash, rol: rol||'asesor', empresaId: targetEmpresa, createdAt:new Date() };
  usuarios.push(nuevo); usuariosDB.set(usuarios);
  res.json({id:nuevo.id, nombre, email, rol:nuevo.rol, empresaId: targetEmpresa});
});
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
  camps.push(nueva); campanasDB.set(camps); io.emit('campana_nueva', nueva); res.json(nueva);
});
const upload = multer({ dest: 'uploads/' });
app.post('/api/campanas/:id/upload', auth, upload.single('file'), (req,res)=>{
  try{
    const wb = xlsx.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);
    const contactos = contactosDB.get(); let count=0;
    rows.forEach(r=>{
      const tel = r.telefono || r.Telefono || r.celular || r.Celular || r.phone;
      if(!tel) return;
      contactos.push({ id: uuidv4(), campanaId:req.params.id, empresaId: req.user.empresaId, nombre: r.nombre||'', telefono: String(tel), estado:'pendiente', asesorId:null, createdAt:new Date(), data:r });
      count++;
    });
    contactosDB.set(contactos); fs.unlinkSync(req.file.path);
    const camps = campanasDB.get(); const c = camps.find(x=>x.id===req.params.id);
    if(c){ c.totalContactos+=count; campanasDB.set(camps); }
    res.json({ok:true, importados: count});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/contactos/:campanaId', auth, (req,res)=>{ res.json(contactosDB.get().filter(c=>c.campanaId===req.params.campanaId)); });
app.post('/api/chats/asignar', auth, (req,res)=>{
  const {contactoId, asesorId} = req.body;
  const contactos = contactosDB.get(); const ct = contactos.find(c=>c.id===contactoId);
  if(!ct) return res.status(404).json({error:'no contacto'});
  ct.asesorId = asesorId; ct.estado='asignado'; contactosDB.set(contactos); io.emit('chat_asignado', ct); res.json(ct);
});
app.post('/api/whatsapp/webhook', (req,res)=>{
  const msg = req.body; const chats = chatsDB.get(); chats.push({id:uuidv4(),...msg, createdAt:new Date()}); chatsDB.set(chats); io.emit('mensaje_nuevo', msg); res.json({ok:true});
});
app.get('*', (req,res)=>{
  const p = path.join(__dirname,'public','index.html');
  if(fs.existsSync(p)) return res.sendFile(p);
  res.send('Klido CRM 12.2 OK');
});
