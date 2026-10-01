const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch(e) { console.log('nodemailer opcional no instalado, sigo'); }

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'klido-secreto-final-2024-avanza-consulting';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Mafe2002@';
const SMTP_USER = process.env.SMTP_USER || 'fermorales20020310@gmail.com';

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DB_FILE)) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  fs.writeFileSync(DB_FILE, JSON.stringify({
    mensajes: [], trabajadores: [], campanas: [],
    usuarios: [
      { id: '1', nombre: 'Fer Admin', email: 'admin@klido.com', rol: 'jefe', plan: 'gold', agenciaId: 'KLIDO-AVANZA', password: hash },
      { id: '2', nombre: 'Fer Morales', email: SMTP_USER, rol: 'jefe', plan: 'gold', agenciaId: 'KLIDO-AVANZA', password: hash }
    ]
  }, null, 2));
}

const readDB = () => {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { mensajes: [], trabajadores: [], campanas: [], usuarios: [] }; }
};
const writeDB = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// HEALTHCHECK PARA RAILWAY - ESTO ARREGLA TU FAILED
app.get('/health', (req,res)=>res.json({status:'ok', service:'klido-crm'}));
app.get('/api/health', (req,res)=>res.json({status:'ok', service:'klido-crm'}));

app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0, lastModified: false }));

const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'no token' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch (e) { return res.status(401).json({ error: 'token invalido' }); }
};

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const u = db.usuarios.find(x => x.email.toLowerCase() === email.toLowerCase());
  if (!u) return res.status(401).json({ error: 'usuario no existe' });
  if (!bcrypt.compareSync(password, u.password)) return res.status(401).json({ error: 'clave incorrecta' });
  const token = jwt.sign({ id: u.id, email: u.email, rol: u.rol, nombre: u.nombre, plan: u.plan || 'basico', agenciaId: u.agenciaId || 'KLIDO' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: u.id, email: u.email, rol: u.rol, nombre: u.nombre, plan: u.plan || 'basico', agenciaId: u.agenciaId } });
});

app.get('/api/mensajes', auth, (req, res) => res.json(readDB().mensajes.slice(-300).reverse()));
app.post('/api/mensajes/segmentar', auth, (req, res) => {
  const db = readDB(); const m = db.mensajes.find(x => x.id == req.body.id || x.numero == req.body.id);
  if (m) { m.segmento = req.body.segmento; writeDB(db); }
  res.json({ ok: true, segmento: req.body.segmento });
});
app.post('/api/mensajes/seguimiento', auth, (req, res) => {
  const db = readDB(); const m = db.mensajes.find(x => x.id == req.body.id);
  if (m) { m.seguimiento = req.body.nota; m.programado = req.body.fecha || null; m.leido = true; writeDB(db); }
  res.json({ ok: true });
});
app.get('/api/calendario', auth, (req, res) => res.json(readDB().mensajes.filter(m=>m.programado).sort((a,b)=>new Date(a.programado)-new Date(b.programado))));
app.get('/api/metricas', auth, (req, res) => {
  const db = readDB();
  res.json({ totalMensajes: db.mensajes.length, noLeidos: db.mensajes.filter(m=>!m.leido).length, nuevos: db.mensajes.filter(m=>m.segmento==='nuevo').length, conversion: db.mensajes.filter(m=>m.segmento==='fijo'||m.segmento==='recurrente').length });
});
app.get('/api/trabajadores', auth, (req, res) => res.json(readDB().trabajadores || []));
app.post('/api/trabajadores', auth, (req, res) => {
  if (req.user.rol!== 'jefe' && req.user.rol!== 'admin') return res.status(403).json({ error: 'solo jefe' });
  const db = readDB();
  if (db.usuarios.find(u=>u.email===req.body.email)) return res.status(400).json({ error: 'ya existe' });
  const id = Date.now().toString();
  db.trabajadores.push({ id, nombre: req.body.nombre, email: req.body.email, creado: new Date() });
  db.usuarios.push({ id, nombre: req.body.nombre, email: req.body.email, rol: 'agente', plan: req.user.plan, agenciaId: req.user.agenciaId, password: bcrypt.hashSync(req.body.password,10) });
  writeDB(db); res.json({ ok: true, id });
});
app.delete('/api/trabajadores/:id', auth, (req, res) => {
  const db = readDB(); db.trabajadores = db.trabajadores.filter(t=>t.id!==req.params.id); db.usuarios = db.usuarios.filter(u=>u.id!==req.params.id); writeDB(db); res.json({ ok: true });
});
app.get('/api/templates', auth, (req, res) => res.json([{ name: 'hola_cliente', lang: 'es' }, { name: 'seguimiento', lang: 'es' }, { name: 'oferta_avanza', lang: 'es' }, { name: 'recordatorio', lang: 'es' }]));
const upload = multer({ dest: '/tmp', limits: { fileSize: 10*1024*1024 } });
app.post('/api/campanas/excel', auth, upload.single('excel'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    const wb = xlsx.readFile(req.file.path); const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    if (!data.length) return res.status(400).json({ error: 'excel vacio' });
    const db = readDB(); db.campanas.push({ id: Date.now().toString(), fecha: new Date(), total: data.length, plantilla: req.body.plantilla || 'hola_cliente', por: req.user.email, data: data.slice(0,500) }); writeDB(db);
    fs.unlinkSync(req.file.path); res.json({ ok: true, total: data.length });
  } catch(e){ res.status(500).json({ error: e.message }); }
});
app.get('/api/campanas/historial', auth, (req, res) => res.json((readDB().campanas||[]).slice(-30).reverse()));
app.post('/api/planes/cambiar', auth, (req, res) => {
  const db = readDB(); const u = db.usuarios.find(x=>x.id==req.user.id); if(u){u.plan=req.body.plan;writeDB(db);} res.json({ ok: true, plan: req.body.plan });
});
app.post('/api/call', auth, (req, res) => {
  const db = readDB(); const u = db.usuarios.find(x=>x.id==req.user.id);
  if ((u?.plan!== 'gold' && req.user.plan!== 'gold') && req.user.rol!== 'jefe') return res.status(403).json({ error: 'solo plan gold' });
  res.json({ tel: `tel:${req.body.numero}`, ok: true });
});
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === (process.env.VERIFY_TOKEN||'klido123')) res.send(req.query['hub.challenge']); else res.send('ok webhook klido');
});
app.post('/webhook', (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value; const messages = entry?.messages;
    if (messages?.[0]) {
      const msg = messages[0]; const db = readDB();
      db.mensajes.push({ id: Date.now().toString()+Math.random().toString().slice(2,6), numero: msg.from, texto: msg.text?.body||msg.button?.text||'[media]', timestamp: new Date(), segmento: 'nuevo', leido: false, wamid: msg.id });
      if (db.mensajes.length>2000) db.mensajes=db.mensajes.slice(-2000); writeDB(db);
    }
  } catch(e){ console.error('webhook error',e); }
  res.sendStatus(200);
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`KLIDO REAL FINAL ${PORT} GOLD ${ADMIN_PASS} SMTP:${SMTP_USER} - AVANZA CONSULTING - HEALTH OK`);
  console.log(`Data dir: ${DATA_DIR} - DB: ${DB_FILE}`);
});
