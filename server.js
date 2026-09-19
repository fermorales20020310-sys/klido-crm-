const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(require('cors')());

const publicPath = path.join(__dirname, 'public');
const uploadDir = path.join(publicPath, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// Multer y xlsx opcionales para que no tumbe el server si faltan
let upload = null, xlsx = null;
try { const multer = require('multer'); upload = multer({ dest: uploadDir }); } catch(e){ console.log('sin multer'); }
try { xlsx = require('xlsx'); } catch(e){ console.log('sin xlsx'); }

const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || 'klido123').trim();
let WABA_ID = (process.env.WABA_ID || '').trim();
if (WABA_ID.startsWith('EAAT') || WABA_ID.length > 50) WABA_ID = '';
const META_TOKEN = (process.env.WHATSAPP_TOKEN || '').trim();
const PHONE_ID = (process.env.PHONE_NUMBER_ID || '').trim();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'fermorales20020310@gmail.com').toLowerCase();
const ADMIN_PASS = process.env.ADMIN_PASS || 'Mafe2002@';

let memMessages = [], memContacts = {}, memCampaigns = [], cacheTemplates = [], pool = null, unreadMap = {};

async function initDB(){
  if (!process.env.DATABASE_URL){ console.log('⚠️ Sin DATABASE_URL - historial solo en memoria'); return; }
  try{
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS contacts(wa_id TEXT PRIMARY KEY, name TEXT, last_msg TEXT, updated_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, type TEXT, direction TEXT, source TEXT, template_name TEXT, status TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, name TEXT, total INT, sent INT DEFAULT 0, delivered INT DEFAULT 0, read INT DEFAULT 0, failed INT DEFAULT 0, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    const { rows } = await pool.query(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 5000`);
    memMessages = rows || [];
    const c = await pool.query(`SELECT * FROM contacts`); c.rows.forEach(r => memContacts[r.wa_id] = r);
    const camp = await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`); memCampaigns = camp.rows || [];
    const unread = await pool.query(`SELECT wa_id, COUNT(*) as cnt FROM messages WHERE direction='in' AND is_read=false GROUP BY wa_id`);
    unread.rows.forEach(r => unreadMap[r.wa_id] = parseInt(r.cnt));
    console.log(`✅ DB OK - ${memMessages.length} mensajes`);
  }catch(e){ console.log('DB error:', e.message); pool = null; }
}
initDB();

async function discoverWABA(){
  if (WABA_ID && /^\d{10,20}$/.test(WABA_ID)) return WABA_ID;
  if (!META_TOKEN) return null;
  try{
    const r = await fetch(`https://graph.facebook.com/v20.0/me/whatsapp_business_accounts?fields=id`, { headers:{ Authorization:`Bearer ${META_TOKEN}` } });
    const j = await r.json();
    if (j.data?.[0]?.id){ WABA_ID = j.data[0].id; return WABA_ID; }
  }catch{}
  return WABA_ID || null;
}

async function fetchMetaTemplates(){
  try{
    let waba = WABA_ID || await discoverWABA();
    if (!waba ||!META_TOKEN) return cacheTemplates;
    const r = await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?fields=name,status,language,category&limit=100`, { headers:{ Authorization:`Bearer ${META_TOKEN}` } });
    const j = await r.json();
    if (j.data){
      cacheTemplates = j.data.filter(t => t.status === 'APPROVED').map(t => ({ name: t.name, language: t.language, category: t.category }));
      if (cacheTemplates.length) console.log(`✅ PLANTILLAS: ${cacheTemplates.map(t=>t.name).join(', ')}`);
    }
    return cacheTemplates;
  }catch{ return cacheTemplates; }
}
setTimeout(fetchMetaTemplates, 3000);
setInterval(fetchMetaTemplates, 15000);

function saveHistory(m){
  memMessages.push(m);
  if (memMessages.length > 6000) memMessages.shift();
  memContacts[m.wa_id] = { wa_id: m.wa_id, name: memContacts[m.wa_id]?.name || m.wa_id, last_msg: m.text, updated_at: new Date() };
  if (m.direction === 'in' &&!m.is_read) unreadMap[m.wa_id] = (unreadMap[m.wa_id] || 0) + 1;
  if (pool){
    pool.query(`INSERT INTO contacts(wa_id,name,last_msg,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(wa_id) DO UPDATE SET last_msg=$3, updated_at=NOW()`, [m.wa_id, m.wa_id, m.text]).catch(()=>{});
    pool.query(`INSERT INTO messages(wa_id,text,type,direction,source,template_name,status,is_read) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [m.wa_id, m.text, m.type, m.direction, m.source, m.template_name||null, m.status||'sent',!!m.is_read]).catch(()=>{});
  }
}

// LOGIN
app.post('/api/login', (req,res)=>{
  const email = (req.body.email||'').toLowerCase().trim();
  const pass = (req.body.password||'').trim();
  if (email === ADMIN_EMAIL && pass === ADMIN_PASS) return res.json({ ok:true });
  res.json({ ok:false, error:'Credenciales incorrectas' });
});

// WEBHOOK
app.get('/webhook', (req,res)=>{
  if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/webhook', async(req,res)=>{
  const v = req.body.entry?.[0]?.changes?.[0]?.value;
  if (!v) return res.sendStatus(200);
  if (v.statuses){
    const st = v.statuses[0];
    const c = memCampaigns.find(x=>x.status==='enviando') || memCampaigns[0];
    if (c){
      if (st.status==='sent') c.sent++; if (st.status==='delivered') c.delivered++;
      if (st.status==='read') c.read++; if (st.status==='failed') c.failed++;
      if (pool) pool.query(`UPDATE campaigns SET sent=$1, delivered=$2, read=$3, failed=$4 WHERE id=$5`, [c.sent,c.delivered,c.read,c.failed,c.id]).catch(()=>{});
    }
  }
  if (v.messages){
    const m = v.messages[0];
    const txt = m.type==='text'? m.text.body : `[${m.type}]`;
    saveHistory({ wa_id:m.from, text:txt, type:m.type, direction:'in', source:'inbox', created_at:new Date(), status:'delivered', is_read:false });
  }
  res.sendStatus(200);
});

app.get('/api/templates', async(_,res)=> res.json(await fetchMetaTemplates()));

// CHATS con no leídos y campaña
app.get('/api/chats', async(_,res)=>{
  try{
    if (pool){
      const { rows } = await pool.query(`
        SELECT last_msg.wa_id, last_msg.text, last_msg.created_at, last_msg.source, last_msg.direction, last_msg.template_name, c.name,
        (SELECT COUNT(*) FROM messages WHERE wa_id=last_msg.wa_id AND direction='in' AND is_read=false) > 0 as unanswered,
        (SELECT COUNT(*) FROM messages WHERE wa_id=last_msg.wa_id AND direction='in' AND is_read=false) as unread_count
        FROM (SELECT DISTINCT ON (wa_id) wa_id, text, created_at, source, direction, template_name FROM messages ORDER BY wa_id, created_at DESC) last_msg
        LEFT JOIN contacts c ON c.wa_id=last_msg.wa_id
        ORDER BY last_msg.created_at DESC LIMIT 500`);
      if (rows.length) return res.json(rows);
    }
  }catch(e){ console.log('chats db err', e.message); }
  const map = {};
  memMessages.forEach(m=>{
    if (!map[m.wa_id] || new Date(m.created_at) > new Date(map[m.wa_id].created_at)){
      map[m.wa_id] = { wa_id:m.wa_id, text:m.text, created_at:m.created_at, source:m.source, direction:m.direction, template_name:m.template_name, name:memContacts[m.wa_id]?.name||m.wa_id, unanswered:(unreadMap[m.wa_id]||0)>0, unread_count:unreadMap[m.wa_id]||0 };
    }
  });
  res.json(Object.values(map).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)));
});

app.get('/api/messages/:wa_id', async(req,res)=>{
  try{
    if (pool){
      const { rows } = await pool.query(`SELECT wa_id, text, type, direction, source, template_name, status, is_read, created_at FROM messages WHERE wa_id=$1 ORDER BY created_at ASC LIMIT 2000`, [req.params.wa_id]);
      if (rows.length) return res.json(rows);
    }
  }catch{}
  res.json(memMessages.filter(m=>m.wa_id===req.params.wa_id).sort((a,b)=> new Date(a.created_at)-new Date(b.created_at)));
});

// Marcar leído
app.put('/api/chats/:wa_id/read', async(req,res)=>{
  const wa = req.params.wa_id;
  unreadMap[wa] = 0;
  memMessages.forEach(m=>{ if (m.wa_id===wa && m.direction==='in') m.is_read = true; });
  if (pool) await pool.query(`UPDATE messages SET is_read=true WHERE wa_id=$1 AND direction='in'`, [wa]).catch(()=>{});
  res.json({ ok:true });
});

// Enviar mensaje normal
app.post('/api/send', async(req,res)=>{
  const { to, message } = req.body;
  if (!to ||!message) return res.json({ ok:false });
  try{
    const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      method:'POST', headers:{ Authorization:`Bearer ${META_TOKEN}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ messaging_product:'whatsapp', to, type:'text', text:{ body:message } })
    });
    const j = await r.json();
    if (j.messages) saveHistory({ wa_id:to, text:message, type:'text', direction:'out', source:'inbox', created_at:new Date(), status:'sent', is_read:true });
    res.json({ ok:!!j.messages, data:j });
  }catch(e){ res.json({ ok:false, error:e.message }); }
});

app.get('/api/campaigns', async(_,res)=>{
  try{ if (pool){ const { rows } = await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`); if (rows.length) return res.json(rows); } }catch{}
  res.json(memCampaigns);
});

// Subir Excel/CSV
if (upload){
  app.post('/api/campaigns/upload', upload.single('file'), (req,res)=>{
    try{
      if (!req.file ||!xlsx) return res.json({ ok:false, error:'No file' });
      const wb = xlsx.readFile(req.file.path);
      const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1 });
      const numbers = data.flat().map(v=>String(v||'').replace(/\D/g,'')).filter(n=>n.length>=10);
      fs.unlinkSync(req.file.path);
      res.json({ ok:true, numbers, total:numbers.length });
    }catch(e){ res.json({ ok:false, error:e.message }); }
  });
}

// Enviar campaña
app.post('/api/campaigns/send-bulk', async(req,res)=>{
  const { numbers, templateName } = req.body;
  if (!templateName ||!numbers?.length) return res.json({ ok:false, error:'Faltan datos' });
  const tpl = cacheTemplates.find(t=>t.name===templateName);
  const lang = tpl?.language || 'es_CO';
  const id = Date.now().toString();
  const camp = { id, name:templateName, total:numbers.length, sent:0, delivered:0, read:0, failed:0, status:'enviando', created_at:new Date().toISOString() };
  memCampaigns.unshift(camp);
  if (pool) pool.query(`INSERT INTO campaigns(id,name,total,sent,delivered,read,failed,status) VALUES($1,$2,$3,0,0,0,0,$4)`, [id,templateName,numbers.length,'enviando']).catch(()=>{});
  (async()=>{
    for (const raw of numbers){
      const to = String(raw).replace(/\D/g,'');
      try{
        const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
          method:'POST', headers:{ Authorization:`Bearer ${META_TOKEN}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ messaging_product:'whatsapp', to, type:'template', template:{ name:templateName, language:{ code:lang } } })
        });
        const j = await r.json();
        if (j.messages){ camp.sent++; saveHistory({ wa_id:to, text:`[Plantilla ${templateName}]`, type:'template', direction:'out', source:'campaign', template_name:templateName, status:'sent', created_at:new Date(), is_read:true }); }
        else camp.failed++;
      }catch{ camp.failed++; }
      await new Promise(r=>setTimeout(r,700));
    }
    camp.status='completada';
    if (pool) pool.query(`UPDATE campaigns SET sent=$1, delivered=$2, read=$3, failed=$4, status=$5 WHERE id=$6`, [camp.sent,camp.delivered,camp.read,camp.failed,camp.status,id]).catch(()=>{});
  })();
  res.json({ ok:true, id, total:numbers.length });
});

app.use(express.static(publicPath));
app.get('/health', async(_,res)=> res.json({ ok:true, templates:cacheTemplates.map(t=>t.name), hasDB:!!pool }));
app.get('/', (req,res)=> res.sendFile(path.join(publicPath,'login.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, ()=> console.log(`🚀 KLIDO LISTO en puerto ${PORT}`));

// Cierre graceful para que Railway no marque SIGTERM como error
process.on('SIGTERM', ()=>{ console.log('SIGTERM recibido, cerrando...'); server.close(()=>process.exit(0)); });
