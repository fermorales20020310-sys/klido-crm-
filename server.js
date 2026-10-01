const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'klido-secreto-final-2024-avanza-consulting';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Mafe2002@';
const SMTP_USER = process.env.SMTP_USER || 'fermorales20020310@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '';

// DIRECTORIO DE DATOS - VOLUMEN DE RAILWAY - NO BORRA NADA
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');

// CREA DB SI NO EXISTE - CONSERVA LO QUE YA TIENES
if (!fs.existsSync(DB_FILE)) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  fs.writeFileSync(DB_FILE, JSON.stringify({
    mensajes: [],
    trabajadores: [],
    campanas: [],
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

// ===== FIX CACHE - ESTO ARREGLA LO DE INCOGNITO IGUAL =====
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0, lastModified: false }));

// AUTH MIDDLEWARE
const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'no token' });
  try {
    const token = header.replace('Bearer ', '');
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token invalido' });
  }
};

// ========== LOGIN ==========
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const u = db.usuarios.find(x => x.email.toLowerCase() === email.toLowerCase());
  if (!u) return res.status(401).json({ error: 'usuario no existe' });
  const ok = bcrypt.compareSync(password, u.password);
  if (!ok) return res.status(401).json({ error: 'clave incorrecta' });
  const token = jwt.sign({ id: u.id, email: u.email, rol: u.rol, nombre: u.nombre, plan: u.plan || 'basico', agenciaId: u.agenciaId || 'KLIDO' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: u.id, email: u.email, rol: u.rol, nombre: u.nombre, plan: u.plan || 'basico', agenciaId: u.agenciaId } });
});

// ========== BANDEJA MENSAJES - NO TOCAR LOGICA ==========
app.get('/api/mensajes', auth, (req, res) => {
  const db = readDB();
  // Ultimos 300 chats
  res.json(db.mensajes.slice(-300).reverse());
});

app.post('/api/mensajes/segmentar', auth, (req, res) => {
  const { id, segmento } = req.body; // nuevo, intermitente, fijo, irrelevante
  const db = readDB();
  const m = db.mensajes.find(x => x.id == id || x.numero == id);
  if (m) { m.segmento = segmento; writeDB(db); }
  res.json({ ok: true, segmento });
});

app.post('/api/mensajes/seguimiento', auth, (req, res) => {
  const { id, nota, fecha } = req.body;
  const db = readDB();
  const m = db.mensajes.find(x => x.id == id);
  if (m) {
    m.seguimiento = nota;
    m.programado = fecha || null;
    m.leido = true;
    writeDB(db);
  }
  res.json({ ok: true });
});

app.get('/api/calendario', auth, (req, res) => {
  const db = readDB();
  const list = db.mensajes.filter(m => m.programado).sort((a, b) => new Date(a.programado) - new Date(b.programado));
  res.json(list);
});

app.get('/api/metricas', auth, (req, res) => {
  const db = readDB();
  const total = db.mensajes.length;
  const noLeidos = db.mensajes.filter(m =>!m.leido).length;
  const nuevos = db.mensajes.filter(m => m.segmento === 'nuevo').length;
  const fijos = db.mensajes.filter(m => m.segmento === 'fijo' || m.segmento === 'recurrente').length;
  res.json({ totalMensajes: total, noLeidos, nuevos, conversion: fijos });
});

// ========== GRUPO DE TRABAJO ==========
app.get('/api/trabajadores', auth, (req, res) => {
  const db = readDB();
  res.json(db.trabajadores || []);
});

app.post('/api/trabajadores', auth, (req, res) => {
  if (req.user.rol!== 'jefe' && req.user.rol!== 'admin') return res.status(403).json({ error: 'solo jefe' });
  const { nombre, email, password } = req.body;
  const db = readDB();
  if (db.usuarios.find(u => u.email === email) || db.trabajadores.find(t => t.email === email)) return res.status(400).json({ error: 'ya existe' });
  const id = Date.now().toString();
  db.trabajadores.push({ id, nombre, email, password: bcrypt.hashSync(password, 10), creado: new Date() });
  // tambien en usuarios para login
  db.usuarios.push({ id, nombre, email, rol: 'agente', plan: req.user.plan, agenciaId: req.user.agenciaId, password: bcrypt.hashSync(password, 10) });
  writeDB(db);
  res.json({ ok: true, id });
});

app.delete('/api/trabajadores/:id', auth, (req, res) => {
  const db = readDB();
  db.trabajadores = db.trabajadores.filter(t => t.id!== req.params.id);
  db.usuarios = db.usuarios.filter(u => u.id!== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ========== TEMPLATES Y CAMPAÑAS ==========
app.get('/api/templates', auth, (req, res) => {
  res.json([{ name: 'hola_cliente', lang: 'es' }, { name: 'seguimiento', lang: 'es' }, { name: 'oferta_avanza', lang: 'es' }, { name: 'recordatorio', lang: 'es' }]);
});

const upload = multer({ dest: '/tmp', limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/api/campanas/excel', auth, upload.single('excel'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    const wb = xlsx.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    if (data.length === 0) return res.status(400).json({ error: 'excel vacio' });
    const db = readDB();
    db.campanas.push({ id: Date.now().toString(), fecha: new Date(), total: data.length, plantilla: req.body.plantilla || 'hola_cliente', por: req.user.email, data: data.slice(0, 500) });
    writeDB(db);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, total: data.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/campanas/historial', auth, (req, res) => {
  const db = readDB();
  res.json((db.campanas || []).slice(-30).reverse());
});

// ========== PLANES ==========
app.post('/api/planes/cambiar', auth, (req, res) => {
  const { plan } = req.body;
  const db = readDB();
  const u = db.usuarios.find(x => x.id == req.user.id);
  if (u) { u.plan = plan; writeDB(db); }
  res.json({ ok: true, plan });
});

// ========== LLAMADA DIRECTA GOLD ==========
app.post('/api/call', auth, (req, res) => {
  const { numero } = req.body;
  // Solo gold puede llamar
  const db = readDB();
  const u = db.usuarios.find(x => x.id == req.user.id);
  if ((u?.plan!== 'gold' && req.user.plan!== 'gold') && req.user.rol!== 'jefe') {
    return res.status(403).json({ error: 'solo plan gold' });
  }
  res.json({ tel: `tel:${numero}`, ok: true });
});

// ========== WEBHOOK WHATSAPP OFICIAL META - NO BORRAR ==========
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.send('ok webhook klido');
  }
});

app.post('/webhook', (req, res) => {
  try {
    const body = req.body;
    const entry = body.entry?.[0]?.changes?.[0]?.value;
    const messages = entry?.messages;
    if (messages && messages[0]) {
      const msg = messages[0];
      const from = msg.from;
      const text = msg.text?.body || msg.button?.text || '[media]';
      const db = readDB();
      db.mensajes.push({
        id: Date.now().toString() + Math.random().toString().slice(2, 6),
        numero: from,
        texto: text,
        timestamp: new Date(),
        segmento: 'nuevo',
        leido: false,
        wamid: msg.id
      });
      // Limita a 2000 mensajes max para no llenar disco
      if (db.mensajes.length > 2000) db.mensajes = db.mensajes.slice(-2000);
      writeDB(db);
    }
  } catch (e) { console.error('webhook error', e); }
  res.sendStatus(200);
});

// ========== FRONTEND ==========
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`KLIDO REAL FINAL ${PORT} GOLD ${ADMIN_PASS} SMTP:${SMTP_USER} - AVANZA CONSULTING - NO CACHE ACTIVO`);
  console.log(`Data dir: ${DATA_DIR} - DB: ${DB_FILE}`);
});
