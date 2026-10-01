const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'klido-secreto-final-2024-avanza-consulting';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Mafe2002@';

let DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { DATA_DIR = path.join(__dirname, 'data'); fs.mkdirSync(DATA_DIR, { recursive: true }); }
}
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// DB inicial si no existe
if (!fs.existsSync(DB_FILE)) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  fs.writeFileSync(DB_FILE, JSON.stringify({
    agencias: [{ id: 'KLIDO-AVANZA', nombre: 'Avanza Consulting YL', email: 'avanzaconsultingyl@gmail.com', plan: 'gold', creado: new Date(), totalUsuarios: 1 }],
    usuarios: [
      { id: '1', nombre: 'Fer Admin', email: 'admin@klido.com', rol: 'jefe', plan: 'gold', agenciaId: 'KLIDO-AVANZA', password: hash, creado: new Date() },
      { id: '2', nombre: 'Avanza Consulting', email: 'avanzaconsultingyl@gmail.com', rol: 'jefe', plan: 'gold', agenciaId: 'KLIDO-AVANZA', password: hash, creado: new Date() }
    ],
    mensajes: [], trabajadores: [], campanas: [], historial: []
  }, null, 2));
}

const readDB = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const writeDB = (data) => {
  // COPIA DE SEGURIDAD AUTOMATICA - nunca se borra
  try {
    const fecha = new Date().toISOString().split('T')[0];
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `db-backup-${fecha}.json`));
    if (data.historial) data.historial.push({ fecha: new Date(), totalAgencias: data.agencias?.length || 0, totalUsuarios: data.usuarios?.length || 0, totalMensajes: data.mensajes?.length || 0 });
    if (data.historial && data.historial.length > 500) data.historial = data.historial.slice(-500);
  } catch {}
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '30mb' }));
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'no token' }); }
};

// ===== REGISTRO AUTONOMO - CREAR EMPRESA DESDE EL INDEX =====
app.post('/api/registro', (req, res) => {
  const { nombreEmpresa, email, password, nombrePersona } = req.body;
  if (!email ||!password ||!nombreEmpresa) return res.status(400).json({ error: 'faltan datos' });
  const db = readDB();
  if (db.usuarios.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'ya existe' });

  const agenciaId = 'AG-' + Date.now().toString(36).toUpperCase();
  const id = Date.now().toString();
  const hash = bcrypt.hashSync(password, 10);

  // Guarda agencia en historial - NUNCA se borra
  if (!db.agencias) db.agencias = [];
  db.agencias.push({ id: agenciaId, nombre: nombreEmpresa, email, plan: 'basico', creado: new Date(), estado: 'activa' });

  // Guarda usuario jefe de esa agencia
  db.usuarios.push({ id, nombre: nombrePersona || nombreEmpresa, email, rol: 'jefe', plan: 'basico', agenciaId, password: hash, creado: new Date() });
  writeDB(db);

  const token = jwt.sign({ id, email, rol: 'jefe', nombre: nombrePersona, plan: 'basico', agenciaId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ ok: true, token, user: { id, email, rol: 'jefe', nombre: nombrePersona, plan: 'basico', agenciaId } });
});

app.post('/api/login', (req, res) => {
  const db = readDB();
  const u = db.usuarios.find(x => x.email.toLowerCase() === req.body.email.toLowerCase());
  if (!u ||!bcrypt.compareSync(req.body.password, u.password)) return res.status(401).json({ error: 'usuario no existe' });
  const token = jwt.sign({ id: u.id, email: u.email, rol: u.rol, nombre: u.nombre, plan: u.plan, agenciaId: u.agenciaId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: u.id, email: u.email, rol: u.rol, nombre: u.nombre, plan: u.plan, agenciaId: u.agenciaId } });
});

// ===== HISTORIAL DE AGENCIAS - NUNCA SE BORRA =====
app.get('/api/agencias', auth, (req, res) => {
  if (req.user.rol!== 'jefe') return res.status(403).json({ error: 'solo jefe' });
  const db = readDB();
  // Si eres admin@klido ves todas, si no solo la tuya
  if (req.user.email === 'admin@klido.com' || req.user.agenciaId === 'KLIDO-AVANZA') {
    res.json({ agencias: db.agencias || [], historial: (db.historial || []).slice(-100).reverse(), backups: fs.readdirSync(BACKUP_DIR).slice(-20) });
  } else {
    res.json({ agencias: (db.agencias || []).filter(a => a.id === req.user.agenciaId) });
  }
});

// ===== TODO LO QUE YA TENIAS - INTACTO =====
app.get('/api/mensajes', auth, (req, res) => res.json(readDB().mensajes.slice(-300).reverse()));
app.post('/api/mensajes/segmentar', auth, (req, res) => { const db = readDB(); const m = db.mensajes.find(x => x.id == req.body.id); if (m) { m.segmento = req.body.segmento; writeDB(db); } res.json({ ok: true }); });
app.post('/api/mensajes/seguimiento', auth, (req, res) => { const db = readDB(); const m = db.mensajes.find(x => x.id == req.body.id); if (m) { m.seguimiento = req.body.nota; m.programado = req.body.fecha; m.leido = true; writeDB(db); } res.json({ ok: true }); });
app.get('/api/calendario', auth, (req, res) => res.json(readDB().mensajes.filter(m => m.programado).sort((a, b) => new Date(a.programado) - new Date(b.programado))));
app.get('/api/metricas', auth, (req, res) => { const db = readDB(); res.json({ totalMensajes: db.mensajes.length, noLeidos: db.mensajes.filter(m =>!m.leido).length, nuevos: db.mensajes.filter(m => m.segmento === 'nuevo').length, conversion: db.mensajes.filter(m => m.segmento === 'fijo').length, totalAgencias: db.agencias?.length || 0 }); });
app.get('/api/trabajadores', auth, (req, res) => res.json(readDB().trabajadores || []));
app.post('/api/trabajadores', auth, (req, res) => { const db = readDB(); const id = Date.now().toString(); db.trabajadores.push({ id, nombre: req.body.nombre, email: req.body.email, agenciaId: req.user.agenciaId }); db.usuarios.push({ id, nombre: req.body.nombre, email: req.body.email, rol: 'agente', plan: req.user.plan, agenciaId: req.user.agenciaId, password: bcrypt.hashSync(req.body.password, 10) }); writeDB(db); res.json({ ok: true }); });
app.delete('/api/trabajadores/:id', auth, (req, res) => { const db = readDB(); db.trabajadores = db.trabajadores.filter(t => t.id!== req.params.id); db.usuarios = db.usuarios.filter(u => u.id!== req.params.id || u.agenciaId!== req.user.agenciaId); writeDB(db); res.json({ ok: true }); });
app.get('/api/templates', auth, (req, res) => res.json([{ name: 'hola_cliente' }, { name: 'seguimiento' }, { name: 'oferta_avanza' }]));
const upload = multer({ dest: '/tmp' });
app.post('/api/campanas/excel', auth, upload.single('excel'), (req, res) => { try { const wb = xlsx.readFile(req.file.path); const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); const db = readDB(); db.campanas.push({ id: Date.now().toString(), fecha: new Date(), total: data.length, por: req.user.email, agenciaId: req.user.agenciaId }); writeDB(db); res.json({ ok: true, total: data.length }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/campanas/historial', auth, (req, res) => res.json((readDB().campanas || []).filter(c => c.agenciaId === req.user.agenciaId).slice(-30).reverse()));
app.post('/api/planes/cambiar', auth, (req, res) => { const db = readDB(); const u = db.usuarios.find(x => x.id == req.user.id); if (u) { u.plan = req.body.plan; const ag = db.agencias.find(a => a.id === u.agenciaId); if (ag) ag.plan = req.body.plan; writeDB(db); } res.json({ ok: true }); });
app.post('/api/call', auth, (req, res) => res.json({ tel: `tel:${req.body.numero}` }));
app.get('/webhook', (req, res) => res.send(req.query['hub.challenge'] || 'ok'));
app.post('/webhook', (req, res) => { try { const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; if (msg) { const db = readDB(); db.mensajes.push({ id: Date.now().toString(), numero: msg.from, texto: msg.text?.body || '[media]', timestamp: new Date(), segmento: 'nuevo', leido: false, agenciaId: 'KLIDO-AVANZA' }); if (db.mensajes.length > 5000) db.mensajes = db.mensajes.slice(-5000); writeDB(db); } } catch {} res.sendStatus(200); });
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`KLIDO AUTONOMO ${PORT} DB:${DB_FILE} BACKUP:${BACKUP_DIR}`));
