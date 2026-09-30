require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
const upload = multer({ storage: multer.memoryStorage() });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'klido-secret-2024';

// --- TABLAS V12 ---
async function initDB(){
  await pool.query(`
  CREATE TABLE IF NOT EXISTS agencias (id SERIAL PRIMARY KEY, nombre TEXT, slug TEXT UNIQUE, plan TEXT DEFAULT 'starter');
  CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, agencia_id INT REFERENCES agencias(id), email TEXT UNIQUE, password TEXT, rol TEXT, nombre TEXT, created_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS contactos (id SERIAL PRIMARY KEY, agencia_id INT, telefono TEXT, nombre TEXT, etiqueta TEXT, trabajador_id INT, ciudad TEXT, UNIQUE(agencia_id, telefono));
  CREATE TABLE IF NOT EXISTS mensajes (id SERIAL PRIMARY KEY, agencia_id INT, contacto_id INT, trabajador_id INT, direccion TEXT, contenido TEXT, timestamp TIMESTAMP DEFAULT NOW(), campanha_id INT);
  CREATE TABLE IF NOT EXISTS plantillas (id SERIAL PRIMARY KEY, agencia_id INT, nombre TEXT, estado TEXT, contenido TEXT, categoria TEXT, updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(agencia_id, nombre));
  CREATE TABLE IF NOT EXISTS campanas (id SERIAL PRIMARY KEY, agencia_id INT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, leidos INT DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS campanas_log (id SERIAL PRIMARY KEY, campana_id INT, contacto_id INT, telefono TEXT, estado TEXT, error TEXT);
  CREATE TABLE IF NOT EXISTS planes (id SERIAL PRIMARY KEY, nombre TEXT, precio TEXT, features TEXT);
  `);
  console.log('>>> TABLAS V12 OK');
  // planes default
  await pool.query(`INSERT INTO planes (nombre, precio, features) VALUES
  ('Starter','\$49/mes','1.000 convos, 2 workers, 1 campaña'),
  ('Pro','\$99/mes','5.000 convos, 10 workers, campañas ilimitadas + métricas')
  ON CONFLICT DO NOTHING`);
}
initDB();

const auth = (req,res,next)=>{
  try{
    const token = (req.headers.authorization||'').replace('Bearer ','');
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data; next();
  }catch{ res.status(401).json({error:'no auth'}) }
};

// --- AUTH ---
app.post('/api/auth/login', async (req,res)=>{
  const { email, password, slug } = req.body;
  const ag = await pool.query('SELECT * FROM agencias WHERE slug=$1',[slug||'acol']);
  if(!ag.rows[0]) return res.status(404).json({error:'agencia no existe'});
  const u = await pool.query('SELECT * FROM usuarios WHERE email=$1 AND agencia_id=$2',[email, ag.rows[0].id]);
  if(!u.rows[0]) return res.status(404).json({error:'usuario no existe'});
  const ok = await bcrypt.compare(password, u.rows[0].password);
  if(!ok) return res.status(401).json({error:'clave mala'});
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: ag.rows[0].id, rol: u.rows[0].rol }, JWT_SECRET);
  res.json({ token, user: u.rows[0], agencia: ag.rows[0] });
});

// --- PLANTILLAS SYNC AUTOMATICO API META ---
app.post('/api/templates/sync', auth, async (req,res)=>{
  try{
    if(!process.env.WABA_ID ||!process.env.META_TOKEN) return res.json({ warning:'Falta WABA_ID/META_TOKEN, usando mock', templates:[] });
    const url = `https://graph.facebook.com/v20.0/${process.env.WABA_ID}/message_templates?access_token=${process.env.META_TOKEN}`;
    const r = await fetch(url);
    const data = await r.json();
    const approved = (data.data||[]).filter(t=>t.status==='APPROVED');
    for(const t of approved){
      await pool.query(`INSERT INTO plantillas (agencia_id, nombre, estado, contenido, categoria) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (agencia_id, nombre) DO UPDATE SET estado=$3, contenido=$4, updated_at=NOW()`,
      [req.user.agencia_id, t.name, t.status, JSON.stringify(t), t.category]);
    }
    res.json({ ok:true, count: approved.length, templates: approved });
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.get('/api/templates', auth, async (req,res)=>{
  const r = await pool.query('SELECT * FROM plantillas WHERE agencia_id=$1 AND estado=$2', [req.user.agencia_id, 'APPROVED']);
  res.json(r.rows);
});

// --- EXCEL UPLOAD + NORMALIZACION AUTOMATICA ---
function normalizePhone(p){
  if(!p) return null;
  let s = String(p).replace(/\D/g,'');
  if(s.startsWith('57') && s.length>=12) return s;
  if(s.length==10) return '57'+s;
  if(s.length==12 && s.startsWith('57')) return s;
  return s.length>=10? s : null;
}
app.post('/api/campaigns/upload', auth, upload.single('file'), async (req,res)=>{
  const wb = XLSX.read(req.file.buffer);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  let contactos = [];
  for(const row of rows){
    const keys = Object.keys(row).map(k=>k.toLowerCase());
    const telKey = Object.keys(row).find(k=> ['telefono','celular','phone','numero','tel'].includes(k.toLowerCase()));
    const tel = normalizePhone(row[telKey]);
    if(!tel) continue;
    const nombre = row.Nombre || row.nombre || row.NAME || '';
    const ciudad = row.Ciudad || row.ciudad || '';
    contactos.push({ telefono: tel, nombre, ciudad });
  }
  // upsert
  for(const c of contactos){
    await pool.query(`INSERT INTO contactos (agencia_id, telefono, nombre, ciudad, trabajador_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (agencia_id, telefono) DO UPDATE SET nombre=$3, ciudad=$4`,
    [req.user.agencia_id, c.telefono, c.nombre, c.ciudad, req.user.id]);
  }
  res.json({ ok:true, total: contactos.length, contactos });
});

// --- ENVIAR CAMPAÑA SOLO PLANTILLAS APROBADAS ---
app.post('/api/campaigns/send', auth, async (req,res)=>{
  const { plantilla_nombre, contactos_ids } = req.body;
  const tpl = await pool.query('SELECT * FROM plantillas WHERE agencia_id=$1 AND nombre=$2 AND estado=$3',[req.user.agencia_id, plantilla_nombre, 'APPROVED']);
  if(!tpl.rows[0]) return res.status(400).json({error:'Plantilla no aprobada. Haz sync primero'});
  const camp = await pool.query('INSERT INTO campanas (agencia_id, nombre, plantilla, total) VALUES ($1,$2,$3,$4) RETURNING id',[req.user.agencia_id, `Camp ${plantilla_nombre} ${new Date().toISOString()}`, plantilla_nombre, contactos_ids.length]);
  // envio asincrono (simulado + real Meta)
  res.json({ ok:true, campana_id: camp.rows[0].id, msg:`Enviando ${contactos_ids.length} con plantilla ${plantilla_nombre}` });
  // aqui iria tu loop fetch a https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages
});

// --- METRICAS PARA ADMIN - SEGUIMIENTO TRABAJADORES ---
app.get('/api/metrics/admin', auth, async (req,res)=>{
  if(req.user.rol!== 'admin') return res.status(403).json({error:'solo admin'});
  const msgs = await pool.query(`SELECT u.nombre, COUNT(m.id) as total, AVG(EXTRACT(EPOCH FROM NOW()-m.timestamp)) as tiempo_prom FROM mensajes m JOIN usuarios u ON u.id=m.trabajador_id WHERE m.agencia_id=$1 GROUP BY u.nombre`,[req.user.agencia_id]);
  const camp = await pool.query('SELECT * FROM campanas WHERE agencia_id=$1 ORDER BY id DESC LIMIT 10',[req.user.agencia_id]);
  const hist = await pool.query('SELECT COUNT(*) as hoy FROM mensajes WHERE agencia_id=$1 AND timestamp > NOW() - INTERVAL \'1 day\'',[req.user.agencia_id]);
  res.json({ workers: msgs.rows, campanas: camp.rows, hoy: hist.rows[0] });
});

app.get('/api/history', auth, async (req,res)=>{
  const r = await pool.query('SELECT m.*, c.telefono, c.nombre FROM mensajes m JOIN contactos c ON c.id=m.contacto_id WHERE m.agencia_id=$1 ORDER BY m.timestamp DESC LIMIT 200',[req.user.agencia_id]);
  res.json(r.rows);
});

app.get('/api/config', (req,res)=>{
  res.json({
    webhook: `${req.protocol}://${req.get('host')}/api/webhook`,
    waba_id: process.env.WABA_ID? 'Configurado' : 'Falta WABA_ID',
    phone_id: process.env.PHONE_NUMBER_ID? 'Configurado' : 'Falta',
    docs: 'API oficial WhatsApp Business. Token permanente. Plantillas solo APPROVED. Excel.xlsx con columnas telefono/nombre'
  });
});

app.get('/api/webhook', (req,res)=> res.send(req.query['hub.challenge']));
app.post('/api/webhook', async (req,res)=>{ res.sendStatus(200); /* aqui tu logica de mensajes entrantes */ });

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', ()=> console.log(`🚀 KLIDO V12 FIX REAL + Campañas en ${PORT}`));
