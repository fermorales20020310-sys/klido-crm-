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
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: '20mb' }));

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
app.use('/public', express.static(publicPath));
app.use(express.static(__dirname));

const upload = multer({ storage: multer.memoryStorage() });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET;
const META_TOKEN = process.env.WHATSAPP_TOKEN || process.env.META_TOKEN;
const WABA_ID_GLOBAL = process.env.WABA_ID || '2317286332424288';
const PHONE_ID_GLOBAL = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido_verify_123';

const mailer = nodemailer.createTransport({
  host: 'smtp.resend.com',
  port: 465,
  secure: true,
  auth: { user: 'resend', pass: process.env.RESEND_API_KEY }
});

async function initDB(){
  await pool.query(`
  CREATE TABLE IF NOT EXISTS agencias (id SERIAL PRIMARY KEY, nombre TEXT, slug TEXT UNIQUE, email TEXT, plan TEXT DEFAULT 'basico', estado TEXT DEFAULT 'pendiente_pago', phone_number_id TEXT, waba_id TEXT, access_token TEXT, created_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, agencia_id INT REFERENCES agencias(id) ON DELETE CASCADE, email TEXT UNIQUE, password TEXT, rol TEXT DEFAULT 'admin', nombre TEXT, created_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS otps (id SERIAL PRIMARY KEY, email TEXT, codigo TEXT, tipo TEXT, expira TIMESTAMP DEFAULT NOW() + INTERVAL '15 min');
  CREATE TABLE IF NOT EXISTS contactos (id SERIAL PRIMARY KEY, agencia_id INT, telefono TEXT, nombre TEXT, trabajador_id INT, ciudad TEXT, origen TEXT DEFAULT 'manual', ultimo_mensaje TIMESTAMP DEFAULT NOW(), no_leido INT DEFAULT 0, UNIQUE(agencia_id, telefono));
  CREATE TABLE IF NOT EXISTS mensajes (id SERIAL PRIMARY KEY, agencia_id INT, contacto_id INT, trabajador_id INT, direccion TEXT, tipo TEXT DEFAULT 'texto', contenido TEXT, media_url TEXT, estado TEXT DEFAULT 'enviado', campana_id INT, timestamp TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS plantillas (id SERIAL PRIMARY KEY, agencia_id INT, nombre TEXT, estado TEXT, contenido JSONB, categoria TEXT, updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(agencia_id, nombre));
  CREATE TABLE IF NOT EXISTS campanas (id SERIAL PRIMARY KEY, agencia_id INT, nombre TEXT, plantilla TEXT, total INT DEFAULT 0, enviados INT DEFAULT 0, bloque_actual INT DEFAULT 0, estado TEXT DEFAULT 'en_curso', created_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS campanas_log (id SERIAL PRIMARY KEY, campana_id INT, contacto_id INT, telefono TEXT, estado TEXT, enviado_at TIMESTAMP DEFAULT NOW());
  `);
  console.log('>>> TABLAS V12 MULTIAGENCIA OK WABA:', WABA_ID_GLOBAL, 'PUBLIC PATH:', publicPath);
}
initDB();

const auth = (req,res,next)=>{
  try{ req.user = jwt.verify((req.headers.authorization||'').replace('Bearer ',''), JWT_SECRET); next(); }
  catch{ res.status(401).json({error:'no auth'}) }
};

// --- FIX V12 CRITICO PARA PRESENTACION 3PM ---
function getCreds(agenciaRow){
  let token = agenciaRow?.access_token || META_TOKEN;

  // Si la tabla está con PEGA_ o token corto/inválido, usa el de Variables de Railway
  if (!token || token.includes('PEGA_') || token.length < 80) {
    console.log('⚠️ FIX V12: Tabla agencias con PEGA_, usando WHATSAPP_TOKEN de Variables');
    token = META_TOKEN;
  }

  // Auto-repara la tabla en background para no volver a fallar
  if (agenciaRow && META_TOKEN && META_TOKEN.length > 80 && (!agenciaRow.access_token || agenciaRow.access_token.includes('PEGA_'))) {
     pool.query("UPDATE agencias SET access_token = $1 WHERE id=$2", [META_TOKEN, agenciaRow.id]).catch(()=>{});
  }

  return { token: token, waba: agenciaRow?.waba_id || WABA_ID_GLOBAL, phone: agenciaRow?.phone_number_id || PHONE_ID_GLOBAL }
}

async function syncTemplatesForAgencia(agencia_id){
  try{
    const ag = await pool.query(`SELECT * FROM agencias WHERE id=$1`,[agencia_id]);
    if(!ag.rows[0]) return;
    const { token, waba } = getCreds(ag.rows[0]);
    if(!token ||!waba) return;
    const r = await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?access_token=${token}`);
    const data = await r.json();
    const approved = (data.data||[]).filter(t=>t.status==='APPROVED');
    for(const t of approved){
      await pool.query(`INSERT INTO plantillas (agencia_id, nombre, estado, contenido, categoria) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (agencia_id,nombre) DO UPDATE SET estado=$3, contenido=$4, categoria=$5, updated_at=NOW()`, [agencia_id, t.name, t.status, t, t.category]);
    }
    io.to(`agencia_${agencia_id}`).emit('templates_update', { count: approved.length });
  }catch(e){ console.log('sync err', e.message) }
}

app.get('/', (req,res)=> res.sendFile(path.join(publicPath, 'index.html')));
app.get('/campanas', (req,res)=> res.sendFile(path.join(publicPath, 'campanas.html')));
app.get('/login', (req,res)=> res.sendFile(path.join(publicPath, 'login.html')));
app.get('/legal', (req,res)=> res.sendFile(path.join(publicPath, 'legal.html')));
app.get('/terminos', (req,res)=> res.sendFile(path.join(publicPath, 'terminos.html')));

app.post('/api/register-empresa', async (req,res)=>{
  const { empresa, email, password, plan } = req.body;
  const slug = empresa.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + Date.now().toString().slice(-4);
  const hash = await bcrypt.hash(password, 10);
  const ag = await pool.query(`INSERT INTO agencias (nombre, slug, email, plan, estado, waba_id, phone_number_id, access_token) VALUES ($1,$2,$3,$4,'pendiente_pago',$5,$6,$7) RETURNING id`, [empresa, slug, email, plan, WABA_ID_GLOBAL, PHONE_ID_GLOBAL, META_TOKEN]);
  await pool.query(`INSERT INTO usuarios (agencia_id, email, password, rol, nombre) VALUES ($1,$2,$3,'admin',$4)`, [ag.rows[0].id, email, hash, empresa]);
  const codigo = Math.floor(100000+Math.random()*900000).toString();
  await pool.query(`INSERT INTO otps (email,codigo,tipo) VALUES ($1,$2,'registro')`, [email, codigo]);
  try{ await mailer.sendMail({ from: process.env.RESEND_FROM, to: email, subject: `Código Klido ${empresa}`, html: `<h2>Código: ${codigo}</h2><p>Plan: ${plan}</p>` }) }catch{}
  res.json({ ok:true, whatsapp_pago: `https://wa.me/573133181851?text=${encodeURIComponent(`Hola Fer quiero activar Klido ${empresa} Plan:${plan} Email:${email} Codigo:${codigo}`)}` });
});

app.post('/api/verify-otp', async (req,res)=>{
  const { email, codigo } = req.body;
  const r = await pool.query(`SELECT * FROM otps WHERE email=$1 AND codigo=$2 AND expira > NOW() ORDER BY id DESC LIMIT 1`,[email, codigo]);
  if(!r.rows[0]) return res.status(400).json({error:'codigo invalido'});
  await pool.query(`UPDATE agencias SET estado='activo' WHERE email=$1`,[email]);
  const u = await pool.query(`SELECT u.*, a.slug FROM usuarios u JOIN agencias a ON a.id=u.agencia_id WHERE u.email=$1`,[email]);
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: u.rows[0].agencia_id, rol: u.rows[0].rol }, JWT_SECRET);
  res.json({ token, user: u.rows[0] });
});

app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body;
  const u = await pool.query(`SELECT u.*, a.slug, a.plan, a.estado FROM usuarios u JOIN agencias a ON a.id=u.agencia_id WHERE u.email=$1`,[email]);
  if(!u.rows[0]) return res.status(404).json({error:'no existe'});
  if(u.rows[0].estado!=='activo') return res.status(403).json({error:'Pendiente de pago 3133181851'});
  const ok = await bcrypt.compare(password, u.rows[0].password);
  if(!ok) return res.status(401).json({error:'clave mala'});
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: u.rows[0].agencia_id, rol: u.rows[0].rol }, JWT_SECRET);
  res.json({ token, user: u.rows[0] });
});

app.post('/api/forgot', async (req,res)=>{
  const { email } = req.body; const codigo = Math.floor(100000+Math.random()*900000).toString();
  await pool.query(`INSERT INTO otps (email,codigo,tipo) VALUES ($1,$2,'reset')`,[email, codigo]);
  try{ await mailer.sendMail({ from: process.env.RESEND_FROM, to: email, subject: 'Recuperar Klido', html: `<h2>${codigo}</h2>` }) }catch{}
  res.json({ ok:true });
});
app.post('/api/reset', async (req,res)=>{
  const { email, codigo, nueva } = req.body;
  const r = await pool.query(`SELECT * FROM otps WHERE email=$1 AND codigo=$2 AND expira > NOW() ORDER BY id DESC LIMIT 1`,[email, codigo]);
  if(!r.rows[0]) return res.status(400).json({error:'codigo malo'});
  const hash = await bcrypt.hash(nueva, 10);
  await pool.query(`UPDATE usuarios SET password=$1 WHERE email=$2`,[hash, email]);
  res.json({ ok:true });
});

function normalizePhone(p){ if(!p) return null; let s=String(p).replace(/\D/g,''); if(s.length==10) return '57'+s; return s.length>=10?s:null; }

app.get('/api/contactos', auth, async (req,res)=>{
  let q = `SELECT * FROM contactos WHERE agencia_id=$1`;
  if(req.user.rol==='worker') q+=` AND trabajador_id=${req.user.id}`;
  if(req.query.filtro==='no_leidos') q+=` AND no_leido > 0`;
  if(req.query.filtro==='campana') q+=` AND origen='campana'`;
  if(req.query.filtro==='online') q+=` AND ultimo_mensaje > NOW() - INTERVAL '10 minutes'`;
  q+=` ORDER BY ultimo_mensaje DESC LIMIT 300`;
  const r = await pool.query(q,[req.user.agencia_id]); res.json(r.rows);
});
app.get('/api/mensajes/:id', auth, async (req,res)=>{
  const r = await pool.query(`SELECT * FROM mensajes WHERE agencia_id=$1 AND contacto_id=$2 ORDER BY timestamp ASC`,[req.user.agencia_id, req.params.id]);
  res.json(r.rows);
});
app.post('/api/mensajes/enviar', auth, upload.single('file'), async (req,res)=>{
  const { contacto_id, contenido } = req.body;
  const ag = await pool.query(`SELECT * FROM agencias WHERE id=$1`,[req.user.agencia_id]);
  const { token, phone } = getCreds(ag.rows[0]);
  const c = await pool.query(`SELECT telefono FROM contactos WHERE id=$1`,[contacto_id]);
  try{ if(token && phone) await fetch(`https://graph.facebook.com/v20.0/${phone}/messages`,{ method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body: JSON.stringify({ messaging_product:'whatsapp', to: c.rows[0].telefono, type:'text', text:{ body: contenido } }) }); }catch{}
  const m = await pool.query(`INSERT INTO mensajes (agencia_id, contacto_id, trabajador_id, direccion, contenido) VALUES ($1,$2,$3,'saliente',$4) RETURNING *`,[req.user.agencia_id, contacto_id, req.user.id, contenido]);
  io.to(`agencia_${req.user.agencia_id}`).emit('new_message', m.rows[0]);
  res.json(m.rows[0]);
});

app.post('/api/campanas/upload', auth, upload.single('file'), async (req,res)=>{
  const wb = XLSX.read(req.file.buffer); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  let tels=[]; for(const row of rows){ const k=Object.keys(row).find(x=> /tel|cel|phone|numero|whatsapp/i.test(x)); const n=normalizePhone(row[k]); if(n) tels.push({ telefono:n, nombre: row.Nombre||row.nombre||'' }); }
  for(const t of tels){ await pool.query(`INSERT INTO contactos (agencia_id, telefono, nombre, origen, trabajador_id) VALUES ($1,$2,$3,'campana',$4) ON CONFLICT (agencia_id, telefono) DO UPDATE SET nombre=$3, origen='campana'`,[req.user.agencia_id, t.telefono, t.nombre, req.user.id]); }
  const ids = await pool.query(`SELECT id FROM contactos WHERE agencia_id=$1 AND telefono = ANY($2)`,[req.user.agencia_id, tels.map(t=>t.telefono)]);
  res.json({ ok:true, detectados: tels.length, contactos_ids: ids.rows.map(r=>r.id) });
});

app.post('/api/campanas/enviar', auth, async (req,res)=>{
  const { plantilla, contactos_ids } = req.body;
  const tpl = await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND nombre=$2 AND estado='APPROVED'`,[req.user.agencia_id, plantilla]);
  if(!tpl.rows[0]) return res.status(400).json({error:'Plantilla no aprobada. Sync primero'});
  const camp = await pool.query(`INSERT INTO campanas (agencia_id, nombre, plantilla, total) VALUES ($1,$2,$3,$4) RETURNING *`,[req.user.agencia_id, `Camp ${plantilla}`, plantilla, contactos_ids.length]);
  let bloque=0; const enviarBloque = async ()=>{
    const slice = contactos_ids.slice(bloque*50,(bloque+1)*50);
    if(slice.length==0){ await pool.query(`UPDATE campanas SET estado='completado' WHERE id=$1`,[camp.rows[0].id]); return; }
    for(const cid of slice){ await pool.query(`INSERT INTO campanas_log (campana_id, contacto_id, telefono, estado) VALUES ($1,$2,(SELECT telefono FROM contactos WHERE id=$2),'enviado')`,[camp.rows[0].id, cid]); }
    bloque++; await pool.query(`UPDATE campanas SET enviados=enviados+$1, bloque_actual=$2 WHERE id=$3`,[slice.length, bloque, camp.rows[0].id]);
    setTimeout(enviarBloque, 5*60*1000);
  }; enviarBloque();
  res.json({ ok:true, campana: camp.rows[0] });
});

app.get('/api/templates', auth, async (req,res)=>{ const r=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND estado='APPROVED' ORDER BY updated_at DESC`,[req.user.agencia_id]); res.json(r.rows); });
app.post('/api/templates/sync', auth, async (req,res)=>{ await syncTemplatesForAgencia(req.user.agencia_id); const r=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND estado='APPROVED'`,[req.user.agencia_id]); res.json({ ok:true, count: r.rows.length }); });
app.get('/api/metrics', auth, async (req,res)=>{
  if(req.user.rol==='admin'){ const workers = await pool.query(`SELECT u.id, u.nombre, COUNT(m.id) as total FROM usuarios u LEFT JOIN mensajes m ON m.trabajador_id=u.id WHERE u.agencia_id=$1 GROUP BY u.id`,[req.user.agencia_id]); res.json({ workers: workers.rows }); }
  else { const m = await pool.query(`SELECT COUNT(*) FROM mensajes WHERE trabajador_id=$1`,[req.user.id]); res.json({ mis_mensajes: m.rows[0].count }); }
});
app.get('/api/planes', (req,res)=>{ res.json([{ id:'basico', nombre:'BÁSICO', precio:'$800.000 anual', mant:'$80.000 trim' },{ id:'premium', nombre:'PREMIUM', precio:'$1.300.000 anual', mant:'$95.000 trim' },{ id:'gold', nombre:'GOLD', precio:'$2.400.000 anual', mant:'$120.000 trim' }]); });
app.get('/api/config-info', (req,res)=>{ res.json({ waba: WABA_ID_GLOBAL, phone: PHONE_ID_GLOBAL, webhook: `${req.protocol}://${req.get('host')}/api/webhook` }); });

app.get('/api/webhook', (req,res)=>{ if(req.query['hub.verify_token']===VERIFY_TOKEN) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/api/webhook', async (req,res)=>{
  try{
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if(msg){
      const telefono = msg.from;
      const ag = await pool.query(`SELECT id FROM agencias WHERE phone_number_id=$1`,[value.metadata.phone_number_id]);
      const agencia_id = ag.rows[0]?.id || (await pool.query(`SELECT id FROM agencias WHERE waba_id=$1 LIMIT 1`,[WABA_ID_GLOBAL])).rows[0]?.id;
      if(agencia_id){
        const cont = await pool.query(`INSERT INTO contactos (agencia_id, telefono, nombre, ultimo_mensaje, no_leido) VALUES ($1,$2,$3,NOW(),1) ON CONFLICT (agencia_id, telefono) DO UPDATE SET ultimo_mensaje=NOW(), no_leido=contactos.no_leido+1 RETURNING id`,[agencia_id, telefono, value.contacts?.[0]?.profile?.name || telefono]);
        const mensaje = await pool.query(`INSERT INTO mensajes (agencia_id, contacto_id, direccion, tipo, contenido) VALUES ($1,$2,'entrante',$3,$4) RETURNING *`,[agencia_id, cont.rows[0].id, msg.type, msg.text?.body || msg.type]);
        io.to(`agencia_${agencia_id}`).emit('new_message', mensaje.rows[0]);
      }
    }
  }catch(e){ console.log(e.message) }
  res.sendStatus(200);
});

io.on('connection', s=>{ s.on('join_agencia', id=> s.join(`agencia_${id}`)); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', ()=> console.log(`🚀 KLIDO V12 FIX PEGA_ OK en ${PORT} - WABA ${WABA_ID_GLOBAL}`));
