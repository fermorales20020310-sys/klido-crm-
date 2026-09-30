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
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Klido 12.2 Online ${PORT}`));

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

// --- CREDENCIAL SUPERADMIN 100% FUNCIONAL ---
const FER_EMAIL = "fermorales20020310@gmail.com";
const FER_PASS = "Mafe2002@";
let users = usuariosDB.get();
let fer = users.find(u=>u.email.toLowerCase()===FER_EMAIL.toLowerCase());
if(!fer){
  users.push({ id: uuidv4(), nombre:'Fer Morales SuperAdmin', email:FER_EMAIL, password:bcrypt.hashSync(FER_PASS,10), rol:'superadmin', empresaId:null, createdAt:new Date() });
  console.log('CREADO SUPERADMIN '+FER_EMAIL);
} else {
  fer.password = bcrypt.hashSync(FER_PASS,10);
  fer.rol='superadmin'; fer.empresaId=null;
  console.log('ACTUALIZADO SUPERADMIN '+FER_EMAIL+' FUNCIONAL');
}
usuariosDB.set(users);

function auth(req,res,next){
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'no token'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }catch{ res.status(401).json({error:'token invalido'}); }
}

app.post('/api/login', async (req,res)=>{
  try{
    const {email,password,empresa} = req.body;
    const emailClean = String(email||'').trim().toLowerCase();
    let allUsers = usuariosDB.get();
    let user = allUsers.find(u=>u.email.toLowerCase()===emailClean);
    if(empresa && empresa.trim()!==''){
      const emp = empresasDB.get().find(e=> e.codigoAcceso===empresa.trim().toUpperCase());
      if(!emp) return res.status(401).json({error:'Código de agencia inválido'});
      const inAgency = allUsers.find(u=> u.empresaId===emp.id && u.email.toLowerCase()===emailClean);
      if(inAgency) user = inAgency;
      else if(user?.rol!=='superadmin') return res.status(401).json({error:'No perteneces a esa agencia'});
    }
    if(!user) return res.status(401).json({error:'Usuario no existe'});
    const ok = await bcrypt.compare(String(password), user.password);
    if(!ok) return res.status(401).json({error:'Clave incorrecta'});
    const token = jwt.sign({id:user.id, rol:user.rol, empresaId:user.empresaId}, JWT_SECRET, {expiresIn:'7d'});
    console.log(`LOGIN OK: ${emailClean} -> ${user.rol}`);
    res.json({token, user:{id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresaId:user.empresaId}});
  }catch(e){ console.log(e); res.status(500).json({error:e.message}); }
});

app.post('/api/public/crear-empresa', async (req,res)=>{
  const {nombre,email,password,plan,anual,mantenimiento,aceptaTerminos} = req.body;
  if(!nombre||!email||!password) return res.status(400).json({error:'Faltan datos'});
  if(!aceptaTerminos) return res.status(400).json({error:'Acepta términos'});
  let allUsers = usuariosDB.get();
  if(allUsers.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Correo ya existe'});
  const codigoAcceso = Math.random().toString(36).substring(2,8).toUpperCase();
  const empresaId = uuidv4();
  const nueva = { id:empresaId, nombre, codigoAcceso, plan:plan||'basico', anual:anual||800000, mantenimiento:mantenimiento||80000, multiagencia:true, metaApi:true, estado:'activo', createdAt:new Date() };
  const empresas = empresasDB.get(); empresas.push(nueva); empresasDB.set(empresas);
  allUsers.push({ id: uuidv4(), nombre:'Admin '+nombre, email, password:bcrypt.hashSync(password,10), rol:'admin', empresaId, createdAt:new Date() });
  usuariosDB.set(allUsers);
  res.json({ok:true, empresa:nueva, codigoAcceso});
});

app.post('/api/auth/forgot', (req,res)=>{
  const {email} = req.body;
  const user = usuariosDB.get().find(u=>u.email.toLowerCase()===String(email).toLowerCase());
  if(!user) return res.status(404).json({error:'No registrado'});
  const code = Math.floor(100000 + Math.random()*900000).toString();
  const codigos = codigosDB.get(); codigos.push({ email: email.toLowerCase(), code, expira: Date.now()+15*60*1000, usado:false }); codigosDB.set(codigos);
  console.log(`CODIGO ${email}: ${code}`);
  res.json({message:`Código enviado a ${email}`, testCode: code});
});
app.post('/api/auth/reset', async (req,res)=>{
  const {email, code, newPassword} = req.body;
  const codigos = codigosDB.get();
  const reg = codigos.find(c=> c.email===String(email).toLowerCase() && c.code===String(code) &&!c.usado && c.expira>Date.now());
  if(!reg) return res.status(400).json({error:'Código inválido'});
  const usuarios = usuariosDB.get(); const u = usuarios.find(x=>x.email.toLowerCase()===String(email).toLowerCase());
  if(!u) return res.status(404).json({error:'no existe'});
  u.password = await bcrypt.hash(newPassword, 10); usuariosDB.set(usuarios);
  reg.usado=true; codigosDB.set(codigos);
  res.json({message:'Contraseña cambiada'});
});

app.get('/api/empresas', auth, (req,res)=> res.json(empresasDB.get()));
app.get('/api/usuarios', auth, (req,res)=>{
  let us = usuariosDB.get(); if(req.user.rol!=='superadmin') us=us.filter(u=>u.empresaId===req.user.empresaId);
  res.json(us.map(({password,...u})=>u));
});
app.post('/api/usuarios', auth, async (req,res)=>{
  const {nombre,email,password,rol,empresaId} = req.body;
  const target = req.user.rol==='superadmin'? empresaId : req.user.empresaId;
  const usuarios = usuariosDB.get();
  if(usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'ya existe'});
  usuarios.push({ id: uuidv4(), nombre, email, password:bcrypt.hashSync(password,10), rol:rol||'asesor', empresaId:target, createdAt:new Date() });
  usuariosDB.set(usuarios); res.json({ok:true});
});
app.get('/api/campanas', auth, (req,res)=>{
  let c=campanasDB.get(); if(req.user.rol!=='superadmin') c=c.filter(x=>x.empresaId===req.user.empresaId); res.json(c);
});
app.post('/api/campanas', auth, (req,res)=>{
  const {nombre} = req.body; const empresaId = req.user.rol==='superadmin'? req.body.empresaId : req.user.empresaId;
  const camps=campanasDB.get(); const n={id:uuidv4(),nombre,empresaId,estado:'activa',totalContactos:0,createdAt:new Date()}; camps.push(n); campanasDB.set(camps); res.json(n);
});
const upload = multer({ dest: 'uploads/' });
app.post('/api/campanas/:id/upload', auth, upload.single('file'), (req,res)=>{
  try{
    const wb = xlsx.readFile(req.file.path); const sheet = wb.Sheets[wb.SheetNames[0]]; const rows = xlsx.utils.sheet_to_json(sheet);
    const contactos=contactosDB.get(); let count=0;
    rows.forEach(r=>{ const tel=r.telefono||r.celular||r.phone; if(!tel) return; contactos.push({id:uuidv4(),campanaId:req.params.id,empresaId:req.user.empresaId,telefono:String(tel),estado:'pendiente',createdAt:new Date(),data:r}); count++; });
    contactosDB.set(contactos); fs.unlinkSync(req.file.path); res.json({ok:true, importados:count});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/contactos/:campanaId', auth, (req,res)=> res.json(contactosDB.get().filter(c=>c.campanaId===req.params.campanaId)));
app.post('/api/whatsapp/webhook', (req,res)=>{ const chats=chatsDB.get(); chats.push({id:uuidv4(),...req.body,createdAt:new Date()}); chatsDB.set(chats); io.emit('mensaje_nuevo', req.body); res.json({ok:true}); });
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
