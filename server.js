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
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

app.use(cors());
app.use(express.json({ limit: '30mb' }));

const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');
if(!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
app.use(express.static(publicPath));
app.use('/uploads', express.static(uploadPath));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25*1024*1024 } });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'klido_secret_2026_produccion_segura';
const META_TOKEN = process.env.WHATSAPP_TOKEN || process.env.META_TOKEN || '';
const WABA_ID_GLOBAL = process.env.WABA_ID || '2317286332424288';
const PHONE_ID_GLOBAL = process.env.PHONE_NUMBER_ID || '1338474282683914';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido_verify_123';
const RESEND_FROM = process.env.RESEND_FROM || 'Klido CRM <onboarding@resend.dev>';

let mailer = null;
if(process.env.RESEND_API_KEY){
  mailer = nodemailer.createTransport({ host: 'smtp.resend.com', port: 465, secure: true, auth: { user: 'resend', pass: process.env.RESEND_API_KEY } });
}

async function initDB(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agencias (id SERIAL PRIMARY KEY, nombre TEXT, slug TEXT UNIQUE, email TEXT, plan TEXT DEFAULT 'basico', estado TEXT DEFAULT 'pendiente_pago', phone_number_id TEXT, waba_id TEXT, access_token TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, agencia_id INT REFERENCES agencias(id) ON DELETE CASCADE, email TEXT UNIQUE, password TEXT, rol TEXT DEFAULT 'admin', nombre TEXT, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS otps (id SERIAL PRIMARY KEY, email TEXT, codigo TEXT, tipo TEXT, expira TIMESTAMP DEFAULT NOW() + INTERVAL '30 min');
      CREATE TABLE IF NOT EXISTS contactos (id SERIAL PRIMARY KEY, agencia_id INT, telefono TEXT, nombre TEXT, trabajador_id INT, ciudad TEXT, origen TEXT DEFAULT 'manual', ultimo_mensaje TIMESTAMP DEFAULT NOW(), no_leido INT DEFAULT 0, UNIQUE(agencia_id, telefono));
      CREATE TABLE IF NOT EXISTS mensajes (id SERIAL PRIMARY KEY, agencia_id INT, contacto_id INT, trabajador_id INT, direccion TEXT, tipo TEXT DEFAULT 'texto', contenido TEXT, media_url TEXT, media_mime TEXT, estado TEXT DEFAULT 'enviado', campana_id INT, wamid TEXT, timestamp TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS plantillas (id SERIAL PRIMARY KEY, agencia_id INT, nombre TEXT, estado TEXT, contenido JSONB, categoria TEXT, idioma TEXT DEFAULT 'es', updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(agencia_id, nombre));
      CREATE TABLE IF NOT EXISTS campanas (id SERIAL PRIMARY KEY, agencia_id INT, nombre TEXT, plantilla TEXT, total INT DEFAULT 0, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, bloque_actual INT DEFAULT 0, estado TEXT DEFAULT 'en_curso', created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS campanas_log (id SERIAL PRIMARY KEY, campana_id INT, contacto_id INT, telefono TEXT, estado TEXT, error TEXT, enviado_at TIMESTAMP DEFAULT NOW());
    `);
    console.log('✅ DB OK WABA:', WABA_ID_GLOBAL);
    if(META_TOKEN.length>80) await pool.query(`UPDATE agencias SET access_token=$1 WHERE access_token LIKE 'PEGA_%' OR LENGTH(access_token)<80`, [META_TOKEN]).catch(()=>{});
  }catch(e){ console.error('DB ERROR:', e.message) }
}

function getCreds(agenciaRow){
  let token = agenciaRow?.access_token || META_TOKEN;
  if(!token || token.includes('PEGA_') || token.length < 80) token = META_TOKEN;
  return { token, waba: agenciaRow?.waba_id || WABA_ID_GLOBAL, phone: agenciaRow?.phone_number_id || PHONE_ID_GLOBAL }
}

async function uploadMediaToMeta(phoneId, token, buffer, mime, filename){
  try{
    const form = new FormData();
    const blob = new Blob([buffer], { type: mime });
    form.append('file', blob, filename);
    form.append('type', mime);
    form.append('messaging_product', 'whatsapp');
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/media`, { method:'POST', headers:{ Authorization:`Bearer ${token}` }, body: form });
    const j = await r.json(); return j.id || null;
  }catch{ return null }
}

const auth = (req,res,next)=>{ try{ const t=(req.headers.authorization||'').replace('Bearer ',''); req.user=jwt.verify(t, JWT_SECRET); next(); }catch{ res.status(401).json({error:'no auth'}) } };
const isAdmin = (req,res,next)=>{ if(req.user.rol!=='admin') return res.status(403).json({error:'solo admin'}); next(); };

async function syncTemplatesForAgencia(agencia_id){
  try{
    const ag = await pool.query(`SELECT * FROM agencias WHERE id=$1`,[agencia_id]); if(!ag.rows[0]) return 0;
    const { token, waba } = getCreds(ag.rows[0]); if(!token||token.length<80) return 0;
    const r = await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?access_token=${token}&limit=100`);
    const data = await r.json(); const approved = (data.data||[]).filter(t=>t.status==='APPROVED');
    for(const t of approved){ await pool.query(`INSERT INTO plantillas (agencia_id, nombre, estado, contenido, categoria, idioma) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (agencia_id,nombre) DO UPDATE SET estado=$3, contenido=$4, categoria=$5, updated_at=NOW()`, [agencia_id, t.name, t.status, t, t.category, t.language||'es']); }
    io.to(`agencia_${agencia_id}`).emit('templates_update', { count: approved.length }); return approved.length;
  }catch{ return 0 }
}
setInterval(async ()=>{ try{ const ags = await pool.query(`SELECT id FROM agencias WHERE estado='activo'`); for(const a of ags.rows) await syncTemplatesForAgencia(a.id); }catch{} }, 30*60*1000);

app.get('/', (req,res)=> res.sendFile(path.join(publicPath, 'index.html')));
app.get('/campanas', (req,res)=> res.sendFile(path.join(publicPath, 'campanas.html')));
app.get('/api/health', (req,res)=> res.json({ ok:true, v12:'FINAL PROD', waba:WABA_ID_GLOBAL }));
app.get('/api/config-info', (req,res)=> res.json({ waba:WABA_ID_GLOBAL, phone:PHONE_ID_GLOBAL, webhook: `${req.protocol}://${req.get('host')}/api/webhook` }));
app.get('/api/planes', (req,res)=> res.json([
  { id:'basico', nombre:'BÁSICO', precio:'$800.000 / año', mant:'$80.000 / trim', features:['Inbox ilimitado','Roles Admin/Worker','Campañas 50/5min antibaneo','Historial fotos/audios/archivos','Soporte 3133181851'] },
  { id:'premium', nombre:'PREMIUM', precio:'$1.300.000 / año', mant:'$95.000 / trim', features:['Todo Básico','IA Respuestas + Resumen','Métricas IA por trabajador','Segmentación avanzada'] },
  { id:'gold', nombre:'GOLD', precio:'$2.400.000 / año', mant:'$120.000 / trim', features:['Todo Premium','Llamadas Instantáneas WA','IA Entrenada con tu negocio','Onboarding dedicado'] }
]));

app.post('/api/register-empresa', async (req,res)=>{
  try{
    const { empresa, email, password, plan } = req.body;
    const slug = empresa.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + Date.now().toString().slice(-4);
    const hash = await bcrypt.hash(password, 10);
    const ag = await pool.query(`INSERT INTO agencias (nombre, slug, email, plan, estado, waba_id, phone_number_id, access_token) VALUES ($1,$2,$3,$4,'pendiente_pago',$5,$6,$7) RETURNING id`, [empresa, slug, email, plan||'basico', WABA_ID_GLOBAL, PHONE_ID_GLOBAL, META_TOKEN]);
    await pool.query(`INSERT INTO usuarios (agencia_id, email, password, rol, nombre) VALUES ($1,$2,$3,'admin',$4) ON CONFLICT (email) DO NOTHING`, [ag.rows[0].id, email, hash, empresa]);
    const codigo = Math.floor(100000+Math.random()*900000).toString();
    await pool.query(`INSERT INTO otps (email,codigo,tipo) VALUES ($1,$2,'registro')`, [email, codigo]);
    if(mailer) try{ await mailer.sendMail({ from: RESEND_FROM, to: email, subject: `Código Klido ${empresa}`, html: `<h2>Código: ${codigo}</h2><p>Plan: ${plan}</p>` }) }catch{}
    res.json({ ok:true, whatsapp_pago: `https://wa.me/573133181851?text=${encodeURIComponent(`Hola Fer quiero activar Klido\nEmpresa:${empresa}\nEmail:${email}\nPlan:${plan}\nCodigo:${codigo}`)}`, codigo_preview: codigo });
  }catch(e){ res.status(500).json({error:e.message}) }
});
app.post('/api/verify-otp', async (req,res)=>{
  const { email, codigo } = req.body; const r = await pool.query(`SELECT * FROM otps WHERE email=$1 AND codigo=$2 AND expira > NOW() ORDER BY id DESC LIMIT 1`,[email, codigo]);
  if(!r.rows[0]) return res.status(400).json({error:'codigo invalido'});
  await pool.query(`UPDATE agencias SET estado='activo' WHERE email=$1`,[email]);
  const u = await pool.query(`SELECT u.*, a.slug, a.plan, a.estado FROM usuarios u JOIN agencias a ON a.id=u.agencia_id WHERE u.email=$1`,[email]);
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: u.rows[0].agencia_id, rol: u.rows[0].rol }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: u.rows[0] });
});
app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body; const u = await pool.query(`SELECT u.*, a.slug, a.plan, a.estado, a.nombre as agencia_nombre FROM usuarios u JOIN agencias a ON a.id=u.agencia_id WHERE u.email=$1`,[email]);
  if(!u.rows[0]) return res.status(404).json({error:'no existe'}); if(u.rows[0].estado!=='activo') return res.status(403).json({error:'Pendiente pago 3133181851'});
  const ok = await bcrypt.compare(password, u.rows[0].password); if(!ok) return res.status(401).json({error:'clave mala'});
  const token = jwt.sign({ id: u.rows[0].id, agencia_id: u.rows[0].agencia_id, rol: u.rows[0].rol }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: u.rows[0] });
});
app.post('/api/forgot', async (req,res)=>{ const { email } = req.body; const codigo = Math.floor(100000+Math.random()*900000).toString(); await pool.query(`INSERT INTO otps (email,codigo,tipo) VALUES ($1,$2,'reset')`,[email, codigo]); if(mailer) try{ await mailer.sendMail({ from: RESEND_FROM, to: email, subject: 'Recuperar Klido', html: `<h2>${codigo}</h2>` }) }catch{}; res.json({ ok:true, preview: codigo }); });
app.post('/api/reset', async (req,res)=>{ const { email, codigo, nueva } = req.body; const r = await pool.query(`SELECT * FROM otps WHERE email=$1 AND codigo=$2 AND expira > NOW() ORDER BY id DESC LIMIT 1`,[email, codigo]); if(!r.rows[0]) return res.status(400).json({error:'codigo malo'}); const hash = await bcrypt.hash(nueva, 10); await pool.query(`UPDATE usuarios SET password=$1 WHERE email=$2`,[hash, email]); res.json({ ok:true }); });

function normalizePhone(p){ if(!p) return null; let s=String(p).replace(/\D/g,''); if(s.length==10) return '57'+s; if(s.length==12&&s.startsWith('57')) return s; if(s.length>=11&&s.length<=15) return s; return null; }

app.get('/api/contactos', auth, async (req,res)=>{
  let q = `SELECT * FROM contactos WHERE agencia_id=$1`; const params=[req.user.agencia_id];
  if(req.user.rol==='worker'){ q+=` AND trabajador_id=$2`; params.push(req.user.id); }
  if(req.query.filtro==='no_leidos') q+=` AND no_leido > 0`;
  if(req.query.filtro==='campana') q+=` AND origen='campana'`;
  if(req.query.filtro==='online') q+=` AND ultimo_mensaje > NOW() - INTERVAL '10 minutes'`;
  if(req.query.q) q+=` AND (nombre ILIKE '%${req.query.q}%' OR telefono ILIKE '%${req.query.q}%')`;
  q+=` ORDER BY ultimo_mensaje DESC LIMIT 400`; const r=await pool.query(q, params); res.json(r.rows);
});
app.get('/api/mensajes/:id', auth, async (req,res)=>{
  const r=await pool.query(`SELECT m.*, c.nombre as contacto_nombre, c.telefono FROM mensajes m JOIN contactos c ON c.id=m.contacto_id WHERE m.agencia_id=$1 AND m.contacto_id=$2 ORDER BY m.timestamp ASC LIMIT 1000`,[req.user.agencia_id, req.params.id]);
  await pool.query(`UPDATE contactos SET no_leido=0 WHERE id=$1`,[req.params.id]); res.json(r.rows);
});
app.post('/api/mensajes/enviar', auth, upload.single('file'), async (req,res)=>{
  try{
    const { contacto_id, contenido } = req.body; const ag=await pool.query(`SELECT * FROM agencias WHERE id=$1`,[req.user.agencia_id]); const { token, phone }=getCreds(ag.rows[0]);
    const c=await pool.query(`SELECT telefono FROM contactos WHERE id=$1`,[contacto_id]); let mediaUrl=null, mediaMime=null, tipo='texto', wa=null;
    if(req.file){
      const filename=`${Date.now()}-${req.file.originalname}`; const fp=path.join(uploadPath, filename); fs.writeFileSync(fp, req.file.buffer);
      mediaUrl=`/uploads/${filename}`; mediaMime=req.file.mimetype; tipo=mediaMime.startsWith('image/')?'imagen':mediaMime.startsWith('audio/')?'audio':mediaMime.startsWith('video/')?'video':'documento';
      if(token.length>80){ const mid=await uploadMediaToMeta(phone, token, req.file.buffer, mediaMime, req.file.originalname);
        if(mid){ let payload={ messaging_product:'whatsapp', to:c.rows[0].telefono }; if(tipo==='imagen') payload={...payload, type:'image', image:{ id:mid, caption:contenido||'' }}; else if(tipo==='audio') payload={...payload, type:'audio', audio:{ id:mid }}; else if(tipo==='video') payload={...payload, type:'video', video:{ id:mid, caption:contenido||'' }}; else payload={...payload, type:'document', document:{ id:mid, filename:req.file.originalname, caption:contenido||'' }};
          try{ const rr=await fetch(`https://graph.facebook.com/v20.0/${phone}/messages`,{ method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify(payload)}); wa=await rr.json(); }catch{} } }
    }else{ if(token.length>80){ try{ const rr=await fetch(`https://graph.facebook.com/v20.0/${phone}/messages`,{ method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({ messaging_product:'whatsapp', to:c.rows[0].telefono, type:'text', text:{ body:contenido } })}); wa=await rr.json(); }catch{} } }
    const m=await pool.query(`INSERT INTO mensajes (agencia_id, contacto_id, trabajador_id, direccion, tipo, contenido, media_url, media_mime, wamid) VALUES ($1,$2,$3,'saliente',$4,$5,$6,$7,$8) RETURNING *`,[req.user.agencia_id, contacto_id, req.user.id, tipo, contenido||'', mediaUrl, mediaMime, wa?.messages?.[0]?.id||null]);
    await pool.query(`UPDATE contactos SET ultimo_mensaje=NOW() WHERE id=$1`,[contacto_id]); io.to(`agencia_${req.user.agencia_id}`).emit('new_message', m.rows[0]); res.json(m.rows[0]);
  }catch(e){ res.status(500).json({error:e.message}) }
});

app.post('/api/campanas/upload', auth, upload.single('file'), async (req,res)=>{
  try{
    const wb=XLSX.read(req.file.buffer); const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); let tels=[];
    for(const row of rows){ const k=Object.keys(row).find(x=>/tel|cel|phone|numero|whatsapp/i.test(x))||Object.keys(row)[0]; const n=normalizePhone(row[k]); if(n) tels.push({ telefono:n, nombre:String(row.Nombre||row.nombre||'').substring(0,80) }); }
    const unique=[...new Map(tels.map(o=>[o.telefono,o])).values()];
    for(const t of unique){ await pool.query(`INSERT INTO contactos (agencia_id, telefono, nombre, origen, trabajador_id) VALUES ($1,$2,$3,'campana',$4) ON CONFLICT (agencia_id, telefono) DO UPDATE SET nombre=COALESCE(NULLIF($3,''),contactos.nombre), origen='campana'`,[req.user.agencia_id, t.telefono, t.nombre, req.user.id]); }
    const ids=await pool.query(`SELECT id FROM contactos WHERE agencia_id=$1 AND telefono=ANY($2)`,[req.user.agencia_id, unique.map(t=>t.telefono)]); res.json({ ok:true, detectados:unique.length, contactos_ids:ids.rows.map(r=>r.id) });
  }catch(e){ res.status(500).json({error:e.message}) }
});
app.post('/api/campanas/enviar', auth, async (req,res)=>{
  try{
    const { plantilla, contactos_ids } = req.body; const tpl=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND nombre=$2 AND estado='APPROVED'`,[req.user.agencia_id, plantilla]);
    if(!tpl.rows[0]) return res.status(400).json({error:'Plantilla no aprobada'}); const ag=await pool.query(`SELECT * FROM agencias WHERE id=$1`,[req.user.agencia_id]); const { token, phone }=getCreds(ag.rows[0]);
    const camp=await pool.query(`INSERT INTO campanas (agencia_id, nombre, plantilla, total) VALUES ($1,$2,$3,$4) RETURNING *`,[req.user.agencia_id, `Camp ${plantilla}`, plantilla, contactos_ids.length]);
    let bloque=0; const enviarBloque=async()=>{
      const slice=contactos_ids.slice(bloque*50,(bloque+1)*50); if(slice.length==0){ await pool.query(`UPDATE campanas SET estado='completado' WHERE id=$1`,[camp.rows[0].id]); io.to(`agencia_${req.user.agencia_id}`).emit('campana_update', { id:camp.rows[0].id, estado:'completado' }); return; }
      let enviados=0; for(const cid of slice){ try{ const cont=await pool.query(`SELECT telefono FROM contactos WHERE id=$1`,[cid]); const payload={ messaging_product:'whatsapp', to:cont.rows[0].telefono, type:'template', template:{ name:plantilla, language:{ code:tpl.rows[0].idioma||'es' }}}; const rr=await fetch(`https://graph.facebook.com/v20.0/${phone}/messages`,{ method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify(payload)}); const j=await rr.json(); const ok=!!j.messages; await pool.query(`INSERT INTO campanas_log (campana_id, contacto_id, telefono, estado, error) VALUES ($1,$2,$3,$4,$5)`,[camp.rows[0].id, cid, cont.rows[0].telefono, ok?'enviado':'fallido', ok?'':JSON.stringify(j).substring(0,500)]); if(ok) enviados++; await new Promise(r=>setTimeout(r,800)); }catch(e){ await pool.query(`INSERT INTO campanas_log (campana_id, contacto_id, telefono, estado, error) VALUES ($1,$2,'','fallido',$3)`,[camp.rows[0].id, e.message]); } }
      bloque++; await pool.query(`UPDATE campanas SET enviados=enviados+$1, bloque_actual=$2 WHERE id=$3`,[enviados, bloque, camp.rows[0].id]); setTimeout(enviarBloque, 5*60*1000);
    }; enviarBloque(); res.json({ ok:true, campana:camp.rows[0] });
  }catch(e){ res.status(500).json({error:e.message}) }
});
app.get('/api/campanas', auth, async (req,res)=>{ const r=await pool.query(`SELECT * FROM campanas WHERE agencia_id=$1 ORDER BY created_at DESC LIMIT 100`,[req.user.agencia_id]); res.json(r.rows); });
app.get('/api/campanas/:id/logs', auth, async (req,res)=>{ const r=await pool.query(`SELECT * FROM campanas_log WHERE campana_id=$1 ORDER BY enviado_at DESC LIMIT 500`,[req.params.id]); res.json(r.rows); });
app.get('/api/templates', auth, async (req,res)=>{ const r=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1 AND estado='APPROVED' ORDER BY updated_at DESC`,[req.user.agencia_id]); res.json(r.rows); });
app.post('/api/templates/sync', auth, async (req,res)=>{ const count=await syncTemplatesForAgencia(req.user.agencia_id); const r=await pool.query(`SELECT * FROM plantillas WHERE agencia_id=$1`,[req.user.agencia_id]); res.json({ ok:true, count, plantillas:r.rows }); });

app.get('/api/workers', auth, isAdmin, async (req,res)=>{ const r=await pool.query(`SELECT id, nombre, email, rol FROM usuarios WHERE agencia_id=$1 ORDER BY id`,[req.user.agencia_id]); res.json(r.rows); });
app.post('/api/workers', auth, isAdmin, async (req,res)=>{ const { nombre, email, password, rol }=req.body; const hash=await bcrypt.hash(password,10); const r=await pool.query(`INSERT INTO usuarios (agencia_id, email, password, rol, nombre) VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre, email, rol`,[req.user.agencia_id, email, hash, rol||'worker', nombre]); res.json({ ok:true, worker:r.rows[0] }); });
app.delete('/api/workers/:id', auth, isAdmin, async (req,res)=>{ await pool.query(`DELETE FROM usuarios WHERE id=$1 AND agencia_id=$2 AND rol!='admin'`,[req.params.id, req.user.agencia_id]); res.json({ ok:true }); });

app.get('/api/metrics', auth, async (req,res)=>{
  if(req.user.rol==='admin'){ const workers=await pool.query(`SELECT u.id, u.nombre, COUNT(m.id) as total FROM usuarios u LEFT JOIN mensajes m ON m.trabajador_id=u.id WHERE u.agencia_id=$1 GROUP BY u.id`,[req.user.agencia_id]); const contactos=await pool.query(`SELECT COUNT(*) as total FROM contactos WHERE agencia_id=$1`,[req.user.agencia_id]); res.json({ workers:workers.rows, total:contactos.rows[0].total }); }
  else { const m=await pool.query(`SELECT COUNT(*) FROM mensajes WHERE trabajador_id=$1`,[req.user.id]); res.json({ mis_mensajes:m.rows[0].count }); }
});

app.get('/api/webhook', (req,res)=>{ if(req.query['hub.verify_token']===VERIFY_TOKEN) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/api/webhook', async (req,res)=>{
  try{
    const value=req.body.entry?.[0]?.changes?.[0]?.value; const msg=value?.messages?.[0];
    if(msg){ const telefono=msg.from; const ag=await pool.query(`SELECT id FROM agencias WHERE phone_number_id=$1`,[value.metadata.phone_number_id]); let agencia_id=ag.rows[0]?.id||(await pool.query(`SELECT id FROM agencias LIMIT 1`)).rows[0]?.id;
      if(agencia_id){ const cont=await pool.query(`INSERT INTO contactos (agencia_id, telefono, nombre, ultimo_mensaje, no_leido) VALUES ($1,$2,$3,NOW(),1) ON CONFLICT (agencia_id, telefono) DO UPDATE SET ultimo_mensaje=NOW(), no_leido=contactos.no_leido+1 RETURNING id`,[agencia_id, telefono, value.contacts?.[0]?.profile?.name||telefono]); const mensaje=await pool.query(`INSERT INTO mensajes (agencia_id, contacto_id, direccion, tipo, contenido, wamid) VALUES ($1,$2,'entrante',$3,$4,$5) RETURNING *`,[agencia_id, cont.rows[0].id, msg.type, msg.text?.body||`[${msg.type}]`, msg.id]); io.to(`agencia_${agencia_id}`).emit('new_message', mensaje.rows[0]); } }
  }catch{} res.sendStatus(200);
});

io.on('connection', s=>{ s.on('join_agencia', id=> s.join(`agencia_${id}`)); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', ()=> console.log(`🚀 KLIDO V12 FINAL PROD OK en ${PORT} - WABA ${WABA_ID_GLOBAL} - FIX PEGA_ ACTIVO`));
initDB();
