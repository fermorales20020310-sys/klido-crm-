require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ storage: multer.memoryStorage() });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT = process.env.JWT_SECRET || 'klido-secret-2024';

const mailer = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

async function initDB(){
  await pool.query(`
  CREATE TABLE IF NOT EXISTS agencias (id SERIAL PRIMARY KEY, nombre TEXT, slug TEXT UNIQUE, email TEXT, plan TEXT DEFAULT 'basico', estado TEXT DEFAULT 'pendiente_pago');
  CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, agencia_id INT REFERENCES agencias(id), email TEXT UNIQUE, password TEXT, rol TEXT DEFAULT 'admin', nombre TEXT, online BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS otps (id SERIAL PRIMARY KEY, email TEXT, codigo TEXT, tipo TEXT, expira TIMESTAMP DEFAULT NOW() + INTERVAL '15 min');
  CREATE TABLE IF NOT EXISTS contactos (id SERIAL PRIMARY KEY, agencia_id INT, telefono TEXT, nombre TEXT, etiqueta TEXT DEFAULT 'nuevo', trabajador_id INT, ciudad TEXT, ultimo_mensaje TIMESTAMP DEFAULT NOW(), no_leido INT DEFAULT 0, origen TEXT DEFAULT 'manual', UNIQUE(agencia_id, telefono));
  CREATE TABLE IF NOT EXISTS mensajes (id SERIAL PRIMARY KEY, agencia_id INT, contacto_id INT, trabajador_id INT, direccion TEXT, tipo TEXT DEFAULT 'texto', contenido TEXT, media_url TEXT, timestamp TIMESTAMP DEFAULT NOW(), estado TEXT DEFAULT 'enviado', campana_id INT);
  CREATE TABLE IF NOT EXISTS plantillas (id SERIAL PRIMARY KEY, agencia_id INT, nombre TEXT, estado TEXT, contenido JSONB, categoria TEXT, updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(agencia_id, nombre));
  CREATE TABLE IF NOT EXISTS campanas (id SERIAL PRIMARY KEY, agencia_id INT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, bloque_actual INT DEFAULT 0, estado TEXT DEFAULT 'en_curso', created_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS campanas_log (id SERIAL PRIMARY KEY, campana_id INT, contacto_id INT, telefono TEXT, estado TEXT, enviado_at TIMESTAMP DEFAULT NOW());
  `);
  console.log('>>> TABLAS V12 FINAL OK');
}
initDB();

const auth = (req,res,next)=>{ try{ req.user = jwt.verify((req.headers.authorization||'').replace('Bearer ',''), JWT); next(); }catch{ res.status(401).json({error:'no auth'}) } };

async function syncTemplates(agencia_id){
  try{
    if(!process.env.WABA_ID ||!process.env.META_TOKEN) return;
    const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WABA_ID}/message_templates?access_token=${process.env.META_TOKEN}`);
    const d = await r.json();
    for(const t of (d.data||[]).filter(x=>x.status==='APPROVED')){
      await pool.query(`INSERT INTO plantillas (agencia_id,nombre,estado,contenido,categoria) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (agencia_id,nombre) DO UPDATE SET estado=$3, contenido=$4, updated_at=NOW()`, [agencia_id, t.name, t.status, t, t.category]);
    }
  }catch(e){ console.log('sync err', e.message) }
}
setInterval(()=>{ pool.query('SELECT id FROM agencias WHERE estado=$1',['activo']).then(r=> r.rows.forEach(a=> syncTemplates(a.id))) }, 30*60*1000);

// REGISTER + PAGO A TU WPP 3133181851
app.post('/api/register-empresa', async (req,res)=>{
  const { empresa, email, password, plan } = req.body;
  const slug = empresa.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const hash = await bcrypt.hash(password, 10);
  const ag = await pool.query(`INSERT INTO agencias (nombre, slug, email, plan, estado) VALUES ($1,$2,$3,$4,'pendiente_pago') ON CONFLICT (slug) DO UPDATE SET email=$3, plan=$4 RETURNING id`,[empresa, slug, email, plan]);
  await pool.query(`INSERT INTO usuarios (agencia_id, email, password, rol, nombre) VALUES ($1,$2,$3,'admin',$4) ON CONFLICT (email) DO UPDATE SET password=$3`,[ag.rows[0].id, email, hash, empresa]);
  const codigo = Math.floor(100000+Math.random()*900000).toString();
  await pool.query(`INSERT INTO otps (email,codigo,tipo) VALUES ($1,$2,'registro')`,[email, codigo]);
  try{ await mailer.sendMail({ from: process.env.SMTP_USER, to: email, subject: 'Código Klido CRM', text: `Tu código es ${codigo}` }) }catch{}
  res.json({ ok:true, whatsapp_pago: `https://wa.me/573133181851?text=Hola%20Fer%20quiero%20activar%20Klido%20${empresa}%20Plan:${plan}%20Email:${email}%20Codigo:${codigo}` });
});

app.post('/api/verify-otp', async (req,res)=>{
  const { email, codigo } = req.body;
  const r = await pool.query(`SELECT * FROM otps WHERE email=$1 AND codigo=$2 AND expira > NOW() ORDER BY id DESC LIMIT 1`,[email, codigo]);
  if(!r.rows[0]) return res.status(400).json({error:'codigo invalido o expirado'});
  await pool.query(`UPDATE agencias SET estado='activo' WHERE email=$1`,[email]);
  const u = await pool.query(`SELECT u.*, a.id as agencia_id FROM usuarios u JOIN agencias a ON a.id=u.agencia_id WHERE u.email=$1`,[email]);
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: u.rows[0].agencia_id, rol: u.rows[0].rol }, JWT);
  res.json({ token, user: u.rows[0] });
});

app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body;
  const u = await pool.query(`SELECT u.*, a.slug, a.plan, a.estado FROM usuarios u JOIN agencias a ON a.id=u.agencia_id WHERE u.email=$1`,[email]);
  if(!u.rows[0]) return res.status(404).json({error:'no existe'});
  if(u.rows[0].estado!=='activo') return res.status(403).json({error:'Empresa pendiente de pago. Escríbenos 3133181851'});
  const ok = await bcrypt.compare(password, u.rows[0].password);
  if(!ok) return res.status(401).json({error:'clave incorrecta'});
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: u.rows[0].agencia_id, rol: u.rows[0].rol }, JWT);
  res.json({ token, user: u.rows[0] });
});

app.post('/api/forgot', async (req,res)=>{
  const { email } = req.body; const codigo = Math.floor(100000+Math.random()*900000).toString();
  await pool.query(`INSERT INTO otps (email,codigo,tipo) VALUES ($1,$2,'reset')`,[email, codigo]);
  try{ await mailer.sendMail({ from: process.env.SMTP_USER, to: email, subject: 'Recuperar Klido', text: `Código: ${codigo}` }) }catch{}
  res.json({ ok:true });
});
app.post('/api/reset', async (req,res)=>{
  const { email, codigo, nueva } = req.body;
  const r = await pool.query(`SELECT * FROM otps WHERE email=$1 AND codigo=$2 AND expira > NOW()`,[email, codigo]);
  if(!r.rows[0]) return res.status(400).json({error:'codigo malo'});
  const hash = await bcrypt.hash(nueva, 10);
  await pool.query(`UPDATE usuarios SET password=$1 WHERE email=$2`,[hash, email]);
  res.json({ ok:true });
});

function normalizePhone(p){ if(!p) return null; let s=String(p).replace(/\D/g,''); if(s.length==10) return '57'+s; if(s.length==11 && s.startsWith('57')) return s; if(s.length>=12) return s.slice(-12); return null; }

app.get('/api/contactos', auth, async (req,res)=>{
  const { filtro } = req.query;
  let q = `SELECT * FROM contactos WHERE agencia_id=$1`;
  if(req.user.rol==='worker') q+=` AND trabajador_id=${req.user.id}`;
  if(filtro==='no_leidos') q+=` AND no_leido > 0`;
  if(filtro==='campana') q+=` AND origen='campana'`;
  if(filtro==='online') q+=` AND ultimo_mensaje > NOW() - INTERVAL '10 minutes'`;
  q+=` ORDER BY ultimo_mensaje DESC LIMIT 300`;
  const r = await pool.query(q, [req.user.agencia_id]); res.json(r.rows);
});

app.get('/api/mensajes/:id', auth, async (req,res)=>{
  const r = await pool.query(`SELECT * FROM mensajes WHERE agencia_id=$1 AND contacto_id=$2 ORDER BY timestamp ASC LIMIT 500`,[req.user.agencia_id, req.params.id]);
  res.json(r.rows);
});

app.post('/api/mensajes/enviar', auth, upload.single('file'), async (req,res)=>{
  const { contacto_id, contenido, tipo } = req.body;
  const cont = await pool.query(`SELECT telefono FROM contactos WHERE id=$1`,[contacto_id]);
  let media_url = null; if(req.file) media_url = `public/${req.file.originalname}`;
  try{
    if(process.env.PHONE_NUMBER_ID && process.env.META_TOKEN){
      await fetch(`https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,{ method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${process.env.META_TOKEN}`}, body: JSON.stringify({ messaging_product:'whatsapp', to: cont.rows[0].telefono, type: tipo||'text', text:{body:contenido} }) });
    }
  }catch{}
  const m = await pool.query(`INSERT INTO mensajes (agencia_id, contacto_id, trabajador_id, direccion, tipo, contenido, media_url) VALUES ($1,$2,$3,'saliente',$4,$5,$6) RETURNING *`,[req.user.agencia_id, contacto_id, req.user.id, tipo||'texto', contenido, media_url]);
  io.to(`agencia_${req.user.agencia_id}`).emit('new_message', m.rows[0]);
  res.json(m.rows[0]);
});

app.post('/api/campanas/upload', auth, upload.single('file'), async (req,res)=>{
  const wb = XLSX.read(req.file.buffer); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  let tels=[]; for(const row of rows){ const k=Object.keys(row).find(x=> /tel|cel|phone|numero/i.test(x)); const n=normalizePhone(row[k]); if(n) tels.push({ telefono:n, nombre: row.Nombre||row.nombre||'' }); }
  for(const t of tels){ await pool.query(`INSERT INTO contactos (agencia_id, telefono, nombre, origen, trabajador_id) VALUES ($1,$2,$3,'campana',$4) ON CONFLICT (agencia_id, telefono) DO UPDATE SET nombre=$3, origen='campana'`,[req.user.agencia_id, t.telefono, t.nombre, req.user.id]); }
  const ids = await pool.query(`SELECT id FROM contactos WHERE agencia_id=$1 AND telefono = ANY($2)`,[req.user.agencia_id, tels.map(t=>t.telefono)]);
  res.json({ ok:true, detectados: tels.length, contactos_ids: ids.rows.map(r=>r.id) });
});

app.post('/api/campanas/enviar', auth, async (req,res)=>{
  const { plantilla, contactos_ids } = req.body;
  const tpl = await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND nombre=$2 AND estado='APPROVED'`,[req.user.agencia_id, plantilla]);
  if(!tpl.rows[0]) return res.status(400).json({error:'Plantilla no aprobada. Haz sync.'});
  const camp = await pool.query(`INSERT INTO campanas (agencia_id, nombre, plantilla, total) VALUES ($1,$2,$3,$4) RETURNING *`,[req.user.agencia_id, `Camp ${plantilla} ${new Date().toLocaleDateString()}`, plantilla, contactos_ids.length]);
  let bloque=0; const enviarBloque=async()=>{
    const slice=contactos_ids.slice(bloque*50,(bloque+1)*50); if(slice.length==0){ await pool.query(`UPDATE campanas SET estado='completado' WHERE id=$1`,[camp.rows[0].id]); return; }
    for(const cid of slice){ await pool.query(`INSERT INTO campanas_log (campana_id, contacto_id, telefono, estado) VALUES ($1,$2,(SELECT telefono FROM contactos WHERE id=$2),'enviado')`,[camp.rows[0].id, cid]); }
    bloque++; await pool.query(`UPDATE campanas SET enviados=enviados+$1, bloque_actual=$2 WHERE id=$3`,[slice.length, bloque, camp.rows[0].id]);
    io.to(`agencia_${req.user.agencia_id}`).emit('campana_progress', { id: camp.rows[0].id, enviados: bloque*50 });
    setTimeout(enviarBloque, 5*60*1000);
  }; enviarBloque();
  res.json({ ok:true, campana: camp.rows[0] });
});

app.get('/api/templates', auth, async (req,res)=>{ const r=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND estado='APPROVED' ORDER BY updated_at DESC`,[req.user.agencia_id]); res.json(r.rows); });
app.post('/api/templates/sync', auth, async (req,res)=>{ await syncTemplates(req.user.agencia_id); const r=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND estado='APPROVED'`,[req.user.agencia_id]); res.json({ ok:true, count: r.rows.length, templates: r.rows }); });
app.get('/api/metrics', auth, async (req,res)=>{
  if(req.user.rol==='admin'){ const workers=await pool.query(`SELECT u.id, u.nombre, u.email, COUNT(m.id) as total_msg FROM usuarios u LEFT JOIN mensajes m ON m.trabajador_id=u.id WHERE u.agencia_id=$1 GROUP BY u.id`,[req.user.agencia_id]); const camps=await pool.query(`SELECT * FROM campanas WHERE agencia_id=$1 ORDER BY id DESC LIMIT 20`,[req.user.agencia_id]); res.json({ workers: workers.rows, campanas: camps.rows }); }
  else { const m=await pool.query(`SELECT COUNT(*) FROM mensajes WHERE trabajador_id=$1`,[req.user.id]); res.json({ mis_mensajes: m.rows[0].count }); }
});
app.get('/api/planes', (req,res)=>{ res.json([{ id:'basico', nombre:'BÁSICO', precio:'$800.000 anual', mant:'$80.000 trimestral', f:['Inbox completo + Historial','2 workers','Campañas 50/5min antibaneo'], wa:`https://wa.me/573133181851?text=Quiero%20BÁSICO%20Klido` },{ id:'premium', nombre:'PREMIUM', precio:'$1.300.000 anual', mant:'$95.000 trimestral', f:['Todo Básico + IA respuestas','10 workers','Métricas + Plantillas auto'], wa:`https://wa.me/573133181851?text=Quiero%20PREMIUM%20Klido%20con%20IA` },{ id:'gold', nombre:'GOLD', precio:'$2.400.000 anual', mant:'$120.000 trimestral', f:['Todo Premium + Llamadas instantáneas','Workers ilimitados','IA + Voz + Prioridad'], wa:`https://wa.me/573133181851?text=Quiero%20GOLD%20Klido%20con%20Llamadas` }]); });
app.get('/api/config-info', (req,res)=>{ res.json({ api:'API Oficial WhatsApp Business - Verificada. Número verde, sin baneos.', beneficios:['Plantillas APPROVED se sincronizan cada 30min automático','Envío con fotos, audios, archivos nativos de Meta','Historial completo por contacto y trabajador','Campañas en bloques anti-baneo 50 mensajes','Tiempo real con socket'], webhook:`${req.protocol}://${req.get('host')}/api/webhook` }); });
app.get('/api/webhook', (req,res)=> res.send(req.query['hub.challenge'])); app.post('/api/webhook', async (req,res)=>{ const m=req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; if(m) io.emit('new_message', m); res.sendStatus(200); });
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));
io.on('connection', s=>{ s.on('join_agencia', id=> s.join(`agencia_${id}`)); });
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', ()=> console.log(`🚀 KLIDO V12 FINAL con logo public/logo.png en ${PORT}`));
