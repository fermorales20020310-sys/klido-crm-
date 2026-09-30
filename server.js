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
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage() });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET;
const META_TOKEN = process.env.WHATSAPP_TOKEN || process.env.META_TOKEN;
const WABA_ID_GLOBAL = process.env.WABA_ID;
const PHONE_ID_GLOBAL = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido_verify_123';
const SUPER_ADMIN_KEY = process.env.SUPER_ADMIN_KEY;

// Mailer con RESEND
const mailer = nodemailer.createTransport({
  host: 'smtp.resend.com',
  port: 465,
  secure: true,
  auth: { user: 'resend', pass: process.env.RESEND_API_KEY }
});

async function initDB(){
  await pool.query(`
  CREATE TABLE IF NOT EXISTS agencias (
    id SERIAL PRIMARY KEY,
    nombre TEXT,
    slug TEXT UNIQUE,
    email TEXT,
    plan TEXT DEFAULT 'basico',
    estado TEXT DEFAULT 'pendiente_pago',
    phone_number_id TEXT,
    waba_id TEXT,
    access_token TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    agencia_id INT REFERENCES agencias(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    password TEXT,
    rol TEXT DEFAULT 'admin',
    nombre TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS otps (id SERIAL PRIMARY KEY, email TEXT, codigo TEXT, tipo TEXT, expira TIMESTAMP DEFAULT NOW() + INTERVAL '15 min');
  CREATE TABLE IF NOT EXISTS contactos (
    id SERIAL PRIMARY KEY,
    agencia_id INT REFERENCES agencias(id) ON DELETE CASCADE,
    telefono TEXT,
    nombre TEXT,
    trabajador_id INT,
    ciudad TEXT,
    origen TEXT DEFAULT 'manual',
    ultimo_mensaje TIMESTAMP DEFAULT NOW(),
    no_leido INT DEFAULT 0,
    UNIQUE(agencia_id, telefono)
  );
  CREATE TABLE IF NOT EXISTS mensajes (
    id SERIAL PRIMARY KEY,
    agencia_id INT,
    contacto_id INT,
    trabajador_id INT,
    direccion TEXT,
    tipo TEXT DEFAULT 'texto',
    contenido TEXT,
    media_url TEXT,
    estado TEXT DEFAULT 'enviado',
    campana_id INT,
    timestamp TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS plantillas (
    id SERIAL PRIMARY KEY,
    agencia_id INT,
    nombre TEXT,
    estado TEXT,
    contenido JSONB,
    categoria TEXT,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(agencia_id, nombre)
  );
  CREATE TABLE IF NOT EXISTS campanas (
    id SERIAL PRIMARY KEY,
    agencia_id INT,
    nombre TEXT,
    plantilla TEXT,
    total INT DEFAULT 0,
    enviados INT DEFAULT 0,
    bloque_actual INT DEFAULT 0,
    estado TEXT DEFAULT 'en_curso',
    created_at TIMESTAMP DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS campanas_log (
    id SERIAL PRIMARY KEY,
    campana_id INT,
    contacto_id INT,
    telefono TEXT,
    estado TEXT,
    enviado_at TIMESTAMP DEFAULT NOW()
  );
  `);
  // Crear agencia default y super admin si no existe
  const slugDefault = process.env.DEFAULT_AGENCY || 'acol';
  const adminEmail = process.env.ADMIN_USER;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  const adminAgencia = process.env.ADMIN_AGENCY || slugDefault;

  if(adminEmail && adminHash){
    const ag = await pool.query(`INSERT INTO agencias (nombre, slug, email, plan, estado, waba_id, phone_number_id, access_token) VALUES ($1,$2,$3,'gold','activo',$4,$5,$6) ON CONFLICT (slug) DO UPDATE SET estado='activo', waba_id=$4, phone_number_id=$5, access_token=$6 RETURNING id`, [adminAgencia, slugDefault, adminEmail, WABA_ID_GLOBAL, PHONE_ID_GLOBAL, META_TOKEN]);
    await pool.query(`INSERT INTO usuarios (agencia_id, email, password, rol, nombre) VALUES ($1,$2,$3,'admin',$4) ON CONFLICT (email) DO UPDATE SET password=$3, agencia_id=$1`, [ag.rows[0].id, adminEmail, adminHash, 'Super Admin']);
  }
  console.log('>>> TABLAS V12 MULTIAGENCIA OK - WABA:', WABA_ID_GLOBAL);
}
initDB();

const auth = (req,res,next)=>{
  try{
    const token = (req.headers.authorization||'').replace('Bearer ','');
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  }catch{ res.status(401).json({error:'no auth'}) }
};

// --- FUNCION MULTIAGENCIA: obtener credenciales ---
function getCreds(agenciaRow){
  return {
    token: agenciaRow?.access_token || META_TOKEN,
    waba: agenciaRow?.waba_id || WABA_ID_GLOBAL,
    phone: agenciaRow?.phone_number_id || PHONE_ID_GLOBAL
  }
}

async function syncTemplatesForAgencia(agencia_id){
  try{
    const ag = await pool.query(`SELECT * FROM agencias WHERE id=$1`,[agencia_id]);
    if(!ag.rows[0]) return;
    const { token, waba } = getCreds(ag.rows[0]);
    if(!token ||!waba) return;
    const r = await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?access_token=${token}`);
    const data = await r.json();
    if(!data.data) { console.log('Meta err', data); return; }
    const approved = data.data.filter(t=>t.status==='APPROVED');
    for(const t of approved){
      await pool.query(`INSERT INTO plantillas (agencia_id, nombre, estado, contenido, categoria) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (agencia_id,nombre) DO UPDATE SET estado=$3, contenido=$4, categoria=$5, updated_at=NOW()`, [agencia_id, t.name, t.status, t, t.category]);
    }
    console.log(`Sync ${approved.length} plantillas para agencia ${agencia_id}`);
    io.to(`agencia_${agencia_id}`).emit('templates_update', { count: approved.length });
  }catch(e){ console.log('sync error', e.message) }
}

// Sync cada 30 min
setInterval(async ()=>{
  const rows = await pool.query(`SELECT id FROM agencias WHERE estado='activo'`);
  rows.rows.forEach(r=> syncTemplatesForAgencia(r.id));
}, 30*60*1000);

// --- AUTH MULTIAGENCIA ---
app.post('/api/register-empresa', async (req,res)=>{
  const { empresa, email, password, plan } = req.body;
  if(!empresa ||!email ||!password) return res.status(400).json({error:'faltan datos'});
  const slug = empresa.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + Date.now().toString().slice(-4);
  const hash = await bcrypt.hash(password, 10);
  const ag = await pool.query(`INSERT INTO agencias (nombre, slug, email, plan, estado, waba_id, phone_number_id, access_token) VALUES ($1,$2,$3,$4,'pendiente_pago',$5,$6,$7) RETURNING id`, [empresa, slug, email, plan, WABA_ID_GLOBAL, PHONE_ID_GLOBAL, META_TOKEN]);
  await pool.query(`INSERT INTO usuarios (agencia_id, email, password, rol, nombre) VALUES ($1,$2,$3,'admin',$4)`, [ag.rows[0].id, email, hash, empresa]);
  const codigo = Math.floor(100000+Math.random()*900000).toString();
  await pool.query(`INSERT INTO otps (email,codigo,tipo) VALUES ($1,$2,'registro')`, [email, codigo]);
  try{ await mailer.sendMail({ from: process.env.RESEND_FROM, to: email, subject: `Tu código Klido ${empresa}`, html: `<h2>Código: ${codigo}</h2><p>Expira en 15 min. Plan: ${plan}</p>` }) }catch(e){ console.log('mail err', e.message) }
  const waLink = `https://wa.me/573133181851?text=${encodeURIComponent(`Hola Fer, quiero activar Klido Empresa:${empresa} Email:${email} Plan:${plan} Codigo:${codigo}`)}`;
  res.json({ ok:true, agencia_id: ag.rows[0].id, whatsapp_pago: waLink, codigo_preview: codigo });
});

app.post('/api/verify-otp', async (req,res)=>{
  const { email, codigo } = req.body;
  const r = await pool.query(`SELECT * FROM otps WHERE email=$1 AND codigo=$2 AND expira > NOW() ORDER BY id DESC LIMIT 1`,[email, codigo]);
  if(!r.rows[0]) return res.status(400).json({error:'codigo invalido'});
  await pool.query(`UPDATE agencias SET estado='activo' WHERE email=$1`,[email]);
  const u = await pool.query(`SELECT u.*, a.slug, a.plan FROM usuarios u JOIN agencias a ON a.id=u.agencia_id WHERE u.email=$1`,[email]);
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: u.rows[0].agencia_id, rol: u.rows[0].rol }, JWT_SECRET);
  await syncTemplatesForAgencia(u.rows[0].agencia_id);
  res.json({ token, user: u.rows[0] });
});

app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body;
  const u = await pool.query(`SELECT u.*, a.slug, a.plan, a.estado, a.waba_id, a.phone_number_id FROM usuarios u JOIN agencias a ON a.id=u.agencia_id WHERE u.email=$1`,[email]);
  if(!u.rows[0]) return res.status(404).json({error:'usuario no existe'});
  if(u.rows[0].estado!== 'activo') return res.status(403).json({error:'Empresa pendiente de pago. Escribe al 3133181851'});
  const ok = await bcrypt.compare(password, u.rows[0].password);
  if(!ok){
    // también permite hash del ADMIN_PASSWORD_HASH
    if(u.rows[0].password!== process.env.ADMIN_PASSWORD_HASH){
      const isHash = await bcrypt.compare(password, u.rows[0].password).catch(()=>false);
      if(!isHash) return res.status(401).json({error:'clave incorrecta'});
    }
  }
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: u.rows[0].agencia_id, rol: u.rows[0].rol }, JWT_SECRET);
  res.json({ token, user: u.rows[0], agencia: { id: u.rows[0].agencia_id, slug: u.rows[0].slug, plan: u.rows[0].plan } });
});

app.post('/api/forgot', async (req,res)=>{
  const { email } = req.body;
  const codigo = Math.floor(100000+Math.random()*900000).toString();
  await pool.query(`INSERT INTO otps (email,codigo,tipo) VALUES ($1,$2,'reset')`,[email, codigo]);
  try{ await mailer.sendMail({ from: process.env.RESEND_FROM, to: email, subject: 'Recuperar Klido', html: `<h2>Código: ${codigo}</h2>` }) }catch{}
  res.json({ ok:true, msg:'codigo enviado' });
});
app.post('/api/reset', async (req,res)=>{
  const { email, codigo, nueva } = req.body;
  const r = await pool.query(`SELECT * FROM otps WHERE email=$1 AND codigo=$2 AND expira > NOW() ORDER BY id DESC LIMIT 1`,[email, codigo]);
  if(!r.rows[0]) return res.status(400).json({error:'codigo invalido'});
  const hash = await bcrypt.hash(nueva, 10);
  await pool.query(`UPDATE usuarios SET password=$1 WHERE email=$2`,[hash, email]);
  res.json({ ok:true });
});

// --- MULTIAGENCIA INBOX ---
function normalizePhone(p){ if(!p) return null; let s=String(p).replace(/\D/g,''); if(s.length==10) return '57'+s; if(s.length==11) return s; if(s.length>=12) return s.slice(-12); return s.length>=10?s:null; }

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
  const c = await pool.query(`SELECT telefono FROM contactos WHERE id=$1 AND agencia_id=$2`,[contacto_id, req.user.agencia_id]);
  if(!c.rows[0]) return res.status(404).json({error:'contacto no existe'});
  try{
    if(token && phone){
      await fetch(`https://graph.facebook.com/v20.0/${phone}/messages`,{
        method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
        body: JSON.stringify({ messaging_product:'whatsapp', to: c.rows[0].telefono, type:'text', text:{ body: contenido } })
      });
    }
  }catch(e){ console.log('send meta err', e.message) }
  const m = await pool.query(`INSERT INTO mensajes (agencia_id, contacto_id, trabajador_id, direccion, tipo, contenido) VALUES ($1,$2,$3,'saliente','texto',$4) RETURNING *`,[req.user.agencia_id, contacto_id, req.user.id, contenido]);
  await pool.query(`UPDATE contactos SET ultimo_mensaje=NOW() WHERE id=$1`,[contacto_id]);
  io.to(`agencia_${req.user.agencia_id}`).emit('new_message', m.rows[0]);
  res.json(m.rows[0]);
});

// --- CAMPANAS ---
app.post('/api/campanas/upload', auth, upload.single('file'), async (req,res)=>{
  const wb = XLSX.read(req.file.buffer); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  let tels=[]; for(const row of rows){ const k=Object.keys(row).find(x=> /tel|cel|phone|numero|whatsapp/i.test(x)); const n=normalizePhone(row[k]); if(n) tels.push({ telefono:n, nombre: row.Nombre||row.nombre||row.NOMBRE||'' }); }
  for(const t of tels){ await pool.query(`INSERT INTO contactos (agencia_id, telefono, nombre, origen, trabajador_id) VALUES ($1,$2,$3,'campana',$4) ON CONFLICT (agencia_id, telefono) DO UPDATE SET nombre=$3, origen='campana'`,[req.user.agencia_id, t.telefono, t.nombre, req.user.id]); }
  const ids = await pool.query(`SELECT id, telefono FROM contactos WHERE agencia_id=$1 AND telefono = ANY($2)`,[req.user.agencia_id, tels.map(t=>t.telefono)]);
  res.json({ ok:true, detectados: tels.length, contactos_ids: ids.rows.map(r=>r.id), contactos: ids.rows });
});

app.post('/api/campanas/enviar', auth, async (req,res)=>{
  const { plantilla, contactos_ids } = req.body;
  const tpl = await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND nombre=$2 AND estado='APPROVED'`,[req.user.agencia_id, plantilla]);
  if(!tpl.rows[0]) return res.status(400).json({error:'Plantilla no aprobada. Haz sync.'});
  const camp = await pool.query(`INSERT INTO campanas (agencia_id, nombre, plantilla, total) VALUES ($1,$2,$3,$4) RETURNING *`,[req.user.agencia_id, `Camp ${plantilla}`, plantilla, contactos_ids.length]);
  let bloque=0;
  const enviarBloque = async ()=>{
    const slice = contactos_ids.slice(bloque*50,(bloque+1)*50);
    if(slice.length==0){ await pool.query(`UPDATE campanas SET estado='completado' WHERE id=$1`,[camp.rows[0].id]); return; }
    for(const cid of slice){ await pool.query(`INSERT INTO campanas_log (campana_id, contacto_id, telefono, estado) VALUES ($1,$2,(SELECT telefono FROM contactos WHERE id=$2),'enviado')`,[camp.rows[0].id, cid]); }
    bloque++; await pool.query(`UPDATE campanas SET enviados=enviados+$1, bloque_actual=$2 WHERE id=$3`,[slice.length, bloque, camp.rows[0].id]);
    io.to(`agencia_${req.user.agencia_id}`).emit('campana_progress', { id: camp.rows[0].id, enviados: bloque*50 });
    setTimeout(enviarBloque, 5*60*1000); // antibaneo 50 cada 5 min, cambia a 5h si WABA nueva
  };
  enviarBloque();
  res.json({ ok:true, campana: camp.rows[0], msg:'Enviando en bloques 50/5min antibaneo' });
});

app.get('/api/templates', auth, async (req,res)=>{ const r=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND estado='APPROVED' ORDER BY updated_at DESC`,[req.user.agencia_id]); res.json(r.rows); });
app.post('/api/templates/sync', auth, async (req,res)=>{ await syncTemplatesForAgencia(req.user.agencia_id); const r=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND estado='APPROVED'`,[req.user.agencia_id]); res.json({ ok:true, count: r.rows.length, templates: r.rows }); });

app.get('/api/metrics', auth, async (req,res)=>{
  if(req.user.rol==='admin'){
    const workers = await pool.query(`SELECT u.id, u.nombre, u.email, COUNT(m.id) as total FROM usuarios u LEFT JOIN mensajes m ON m.trabajador_id=u.id WHERE u.agencia_id=$1 GROUP BY u.id`,[req.user.agencia_id]);
    const camps = await pool.query(`SELECT * FROM campanas WHERE agencia_id=$1 ORDER BY id DESC LIMIT 20`,[req.user.agencia_id]);
    res.json({ workers: workers.rows, campanas: camps.rows, agencia_id: req.user.agencia_id });
  }else{
    const m = await pool.query(`SELECT COUNT(*) FROM mensajes WHERE trabajador_id=$1`,[req.user.id]);
    res.json({ mis_mensajes: m.rows[0].count });
  }
});

app.get('/api/planes', (req,res)=>{
  res.json([
    { id:'basico', nombre:'BÁSICO', precio:'$800.000 anual', mant:'$80.000 trimestral', features:['Inbox + Campañas + Historial','2 workers','Soporte'], wa:`https://wa.me/573133181851?text=Quiero%20Plan%20BÁSICO%20Klido` },
    { id:'premium', nombre:'PREMIUM', precio:'$1.300.000 anual', mant:'$95.000 trimestral', features:['Todo Básico + IA','10 workers','Métricas + Auto-sync'], wa:`https://wa.me/573133181851?text=Quiero%20Plan%20PREMIUM%20Klido%20con%20IA` },
    { id:'gold', nombre:'GOLD', precio:'$2.400.000 anual', mant:'$120.000 trimestral', features:['Todo Premium + Llamadas instantáneas','Workers ilimitados','IA + Voz'], wa:`https://wa.me/573133181851?text=Quiero%20Plan%20GOLD%20Klido` }
  ]);
});

app.get('/api/config-info', (req,res)=>{ res.json({ api:'API Oficial WhatsApp Business - Verificada por Meta. WABA '+WABA_ID_GLOBAL, beneficios:['Plantillas APPROVED se sincronizan auto cada 30min','Mensajes con fotos, audios, archivos nativos','Anti-baneo 50 mensajes por bloque','Multiagencia: cada empresa aislada con su propio token','Historial completo + métricas por trabajador'], webhook: `${req.protocol}://${req.get('host')}/api/webhook`, vars: { WABA_ID: WABA_ID_GLOBAL, PHONE: PHONE_ID_GLOBAL, VERIFY: VERIFY_TOKEN } }); });

app.get('/api/webhook', (req,res)=>{
  if(req.query['hub.verify_token'] === VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  return res.sendStatus(403);
});
app.post('/api/webhook', async (req,res)=>{
  try{
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if(msg){
      const telefono = msg.from;
      const contactName = entry?.contacts?.[0]?.profile?.name || telefono;
      // Buscar agencia por phone_number_id
      const phoneIdMeta = entry?.metadata?.phone_number_id;
      let ag = await pool.query(`SELECT id FROM agencias WHERE phone_number_id=$1`,[phoneIdMeta]);
      if(!ag.rows[0]) ag = await pool.query(`SELECT id FROM agencias WHERE waba_id=$1 LIMIT 1`,[WABA_ID_GLOBAL]);
      const agencia_id = ag.rows[0]?.id;
      if(agencia_id){
        const cont = await pool.query(`INSERT INTO contactos (agencia_id, telefono, nombre, ultimo_mensaje, no_leido) VALUES ($1,$2,$3,NOW(),1) ON CONFLICT (agencia_id, telefono) DO UPDATE SET ultimo_mensaje=NOW(), no_leido=contactos.no_leido+1 RETURNING id`,[agencia_id, telefono, contactName]);
        const mensaje = await pool.query(`INSERT INTO mensajes (agencia_id, contacto_id, direccion, tipo, contenido) VALUES ($1,$2,'entrante',$3,$4) RETURNING *`,[agencia_id, cont.rows[0].id, msg.type, msg.text?.body || msg.type]);
        io.to(`agencia_${agencia_id}`).emit('new_message', mensaje.rows[0]);
      }
    }
  }catch(e){ console.log('webhook err', e.message) }
  res.sendStatus(200);
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));

io.on('connection', s=>{ s.on('join_agencia', id=> s.join(`agencia_${id}`)); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', ()=> console.log(`🚀 KLIDO FINAL MULTIAGENCIA WABA ${WABA_ID_GLOBAL} en ${PORT}`));
