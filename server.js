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

// --- 1. PRENDE RAPIDO PARA RAILWAY (ESTO EVITA EL FAILED TO RESPOND) ---
app.get('/health', (req,res) => res.status(200).send('ok'));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Klido 12.2 Online en ${PORT}`);
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 2. DATA EN ARCHIVOS (para que no se borre al reiniciar) ---
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

// Seed admin si no existe
if(usuariosDB.get().length === 0){
  const hash = bcrypt.hashSync('admin123', 10);
  usuariosDB.set([{ id: uuidv4(), nombre:'Admin', email:'admin@klido.com', password:hash, rol:'superadmin', empresaId:null }]);
  console.log('Seed admin@klido.com / admin123 creado');
}

// --- 3. AUTH ---
function auth(req,res,next){
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'no token'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }catch{ res.status(401).json({error:'token invalido'}); }
}

app.post('/api/login', async (req,res)=>{
  const {email,password} = req.body;
  const user = usuariosDB.get().find(u=>u.email===email);
  if(!user) return res.status(401).json({error:'no existe'});
  const ok = await bcrypt.compare(password, user.password);
  if(!ok) return res.status(401).json({error:'clave mala'});
  const token = jwt.sign({id:user.id, rol:user.rol, empresaId:user.empresaId}, JWT_SECRET, {expiresIn:'7d'});
  res.json({token, user:{id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresaId:user.empresaId}});
});

// --- 4. EMPRESAS ---
app.get('/api/empresas', auth, (req,res)=>{ res.json(empresasDB.get()); });
app.post('/api/empresas', auth, (req,res)=>{
  if(req.user.rol!=='superadmin') return res.status(403).json({error:'solo superadmin'});
  const {nombre, nit, plan} = req.body;
  const empresas = empresasDB.get();
  const nueva = { id: uuidv4(), nombre, nit, plan: plan||'basico', createdAt: new Date() };
  empresas.push(nueva); empresasDB.set(empresas);
  res.json(nueva);
});

// --- 5. USUARIOS POR EMPRESA ---
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

// --- 6. CAMPAÑAS ---
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

// --- 7. SUBIR EXCEL Y ASIGNAR ---
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
      contactos.push({
        id: uuidv4(), campanaId, empresaId: req.user.empresaId || req.body.empresaId,
        nombre: r.nombre || r.Nombre || '', telefono: String(tel), estado:'pendiente', asesorId:null, createdAt:new Date(), data:r
      });
      count++;
    });
    contactosDB.set(contactos);
    fs.unlinkSync(req.file.path);

    // actualiza contador campaña
    const camps = campanasDB.get();
    const c = camps.find(x=>x.id===campanaId);
    if(c){ c.totalContactos += count; campanasDB.set(camps); }

    res.json({ok:true, importados: count});
  }catch(e){ console.log(e); res.status(500).json({error:e.message}); }
});

// --- 8. CHATS / ASIGNACION ---
app.get('/api/contactos/:campanaId', auth, (req,res)=>{
  const lista = contactosDB.get().filter(c=>c.campanaId===req.params.campanaId);
  res.json(lista);
});
app.post('/api/chats/asignar', auth, (req,res)=>{
  const {contactoId, asesorId} = req.body;
  const contactos = contactosDB.get();
  const ct = contactos.find(c=>c.id===contactoId);
  if(!ct) return res.status(404).json({error:'no contacto'});
  ct.asesorId = asesorId; ct.estado='asignado';
  contactosDB.set(contactos);
  io.emit('chat_asignado', ct);
  res.json(ct);
});

// --- 9. WHATSAPP WEBHOOK (para Evolution / Meta) ---
app.post('/api/whatsapp/webhook', (req,res)=>{
  const msg = req.body;
  console.log('WHATSAPP IN:', JSON.stringify(msg).slice(0,500));
  const chats = chatsDB.get();
  chats.push({id:uuidv4(),...msg, createdAt:new Date()});
  chatsDB.set(chats);
  io.emit('mensaje_nuevo', msg);
  res.json({ok:true});
});

// --- 10. FRONTEND FALLBACK ---
app.get('*', (req,res)=>{
  const p = path.join(__dirname,'public','index.html');
  if(fs.existsSync(p)) return res.sendFile(p);
  res.send('Klido CRM 12.2 OK - <a href="/health">health</a>');
});

console.log('Módulos cargados, CRM listo');
