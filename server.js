// KLIDO CRM - Server completo
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config ---
const ADMIN_USER = (process.env.ADMIN_USER || 'fermorales20020310@gmail.com').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Mafe2002@';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const WABA_ID = process.env.WABA_ID || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';

const pool = process.env.DATABASE_URL? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

app.use(express.json({limit:'20mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({ secret: process.env.SESSION_SECRET || 'klido-secret-123', resave:false, saveUninitialized:false, cookie:{maxAge: 24*3600*1000} }));
app.use(express.static(path.join(__dirname,'public')));
const upload = multer({ dest: '/tmp/', limits:{fileSize: 25*1024*1024} });

// --- DB init ---
async function initDB(){
  if(!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS agencies(id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT, waba_id TEXT, phone_number_id TEXT, wa_token_enc TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, agency_id INT, wa_id TEXT, body TEXT, direction TEXT, type TEXT DEFAULT 'text', media_url TEXT, is_campaign BOOLEAN DEFAULT false, campaign_id INT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, agency_id INT, name TEXT, template TEXT, total INT DEFAULT 0, sent INT DEFAULT 0, failed INT DEFAULT 0, status TEXT DEFAULT 'running', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS agency_id INT`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_id TEXT`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS body TEXT`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'text'`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_campaign BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS campaign_id INT`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false`);
  console.log('KLIDO ON - DB ready');
}
initDB();

const needAuth = (req,res,next)=>{ if(req.session.user) return next(); res.status(401).json({ok:false}); };

// --- LOGIN ---
app.post('/api/login', async (req,res)=>{
  const em=(req.body.email||'').toLowerCase().trim(); const pw=req.body.password||'';
  try{
    if(pool){
      const r=await pool.query('SELECT * FROM agencies WHERE email=$1',[em]);
      if(r.rows.length && r.rows[0].password_hash){
        if(await bcrypt.compare(pw, r.rows[0].password_hash)){
          req.session.user={email:em, agency_id:r.rows[0].id}; return res.json({ok:true});
        }
      }
    }
  }catch(e){ console.error(e); }
  if(em===ADMIN_USER && pw===ADMIN_PASSWORD && ADMIN_PASSWORD){
    req.session.user={email:em, agency_id:1}; return res.json({ok:true});
  }
  res.status(401).json({ok:false, error:'Credenciales inválidas'});
});
app.post('/api/logout',(req,res)=>{ req.session.destroy(()=>res.json({ok:true})); });
app.get('/api/me',(req,res)=>res.json({user:req.session.user||null}));

// --- MENSAJES / HISTORIAL (no se borra) ---
app.get('/api/chats', needAuth, async (req,res)=>{
  const r=await pool.query(`SELECT wa_id, MAX(body) as last_msg, MAX(created_at) as last_at, COUNT(*) FILTER (WHERE direction='in' AND is_read=false) as unread FROM messages WHERE agency_id=$1 GROUP BY wa_id ORDER BY last_at DESC`,[req.session.user.agency_id]);
  res.json(r.rows);
});
app.get('/api/messages/:wa_id', needAuth, async (req,res)=>{
  const r=await pool.query(`SELECT * FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY created_at ASC LIMIT 500`,[req.session.user.agency_id, req.params.wa_id]);
  res.json(r.rows);
  pool.query(`UPDATE messages SET is_read=true WHERE agency_id=$1 AND wa_id=$2 AND direction='in'`,[req.session.user.agency_id, req.params.wa_id]);
});

// --- ENVIAR MENSAJE + ARCHIVOS ---
async function sendWA(to, text, type='text', media_url=null){
  const url=`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
  let data={ messaging_product:'whatsapp', to };
  if(type==='text') data.text={body:text};
  else if(type==='image') data.image={link:media_url, caption:text||''};
  else if(type==='document') data.document={link:media_url, caption:text||''};
  else if(type==='audio') data.audio={link:media_url};
  const resp=await axios.post(url,data,{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}});
  return resp.data;
}
app.post('/api/send', needAuth, async (req,res)=>{
  const {wa_id, body, type='text', media_url=null}=req.body;
  try{
    await sendWA(wa_id, body, type, media_url);
    await pool.query(`INSERT INTO messages(agency_id,wa_id,body,direction,type,media_url) VALUES($1,$2,$3,'out',$4,$5)`,[req.session.user.agency_id, wa_id, body, type, media_url]);
    res.json({ok:true});
  }catch(e){ console.error(e.response?.data||e.message); res.status(500).json({ok:false, error:'No se pudo enviar'}); }
});
app.post('/api/upload', needAuth, upload.single('file'), async (req,res)=>{
  // Railway: se devuelve ruta temporal, en prod usa S3. Por ahora guardamos en /tmp y servimos
  const publicUrl = `/uploads/${req.file.filename}-${req.file.originalname}`;
  fs.renameSync(req.file.path, path.join('/tmp', path.basename(publicUrl)));
  res.json({ok:true, url: publicUrl});
});

// --- WEBHOOK ---
app.get('/webhook',(req,res)=>{
  if(req.query['hub.verify_token']===VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/webhook', async (req,res)=>{
  res.sendStatus(200);
  try{
    const entry=req.body.entry?.[0]?.changes?.[0]?.value;
    const msg=entry?.messages?.[0];
    if(!msg) return;
    const wa_id=msg.from; const type=msg.type;
    let body='', media_url=null;
    if(type==='text') body=msg.text.body;
    else if(type==='image'){ body=msg.image?.caption||'[Imagen]'; media_url=msg.image?.id; }
    else if(type==='document'){ body=msg.document?.caption||'[Documento]'; }
    else if(type==='audio') body='[Audio]';
    else body=`[${type}]`;
    // agency_id 1 por defecto (multi-agencia: buscar por phone_number_id)
    await pool.query(`INSERT INTO messages(agency_id,wa_id,body,direction,type,media_url) VALUES(1,$1,$2,'in',$3,$4)`,[wa_id,body,type,media_url]);
  }catch(e){ console.error(e); }
});

// --- PLANTILLAS APROBADAS AUTO ---
app.get('/api/templates', needAuth, async (req,res)=>{
  try{
    const r=await axios.get(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates?limit=100`,{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}});
    const approved=r.data.data.filter(t=>t.status==='APPROVED');
    res.json(approved);
  }catch(e){ res.json([]); }
});

// --- CAMPAÑAS con Excel + anti-spam + historial ---
app.post('/api/campaigns/excel', needAuth, upload.single('file'), async (req,res)=>{
  const {template, name}=req.body;
  const wb=xlsx.readFile(req.file.path); const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=xlsx.utils.sheet_to_json(ws);
  // auto-detecta columna de numero
  const numbers=[...new Set(rows.map(r=>String(r.numero||r.Numero||r.phone||r.Phone||r.telefono||'').replace(/\D/g,'')).filter(n=>n.length>=8))];
  fs.unlinkSync(req.file.path);
  const c=await pool.query(`INSERT INTO campaigns(agency_id,name,template,total) VALUES($1,$2,$3,$4) RETURNING id`,[req.session.user.agency_id, name||'Campaña', template, numbers.length]);
  const cid=c.rows[0].id;
  // envío con delay anti-spam: 3 seg entre mensajes, pausa si error
  let sent=0, failed=0;
  (async ()=>{
    for(const num of numbers){
      try{
        await axios.post(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,{
          messaging_product:'whatsapp', to:num, type:'template', template:{name:template, language:{code:'es'}}
        },{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}});
        sent++;
        await pool.query(`INSERT INTO messages(agency_id,wa_id,body,direction,type,is_campaign,campaign_id) VALUES($1,$2,$3,'out','template',true,$4)`,[req.session.user.agency_id,num,`Plantilla ${template}`,cid]);
      }catch(e){
        failed++;
        if(e.response?.data?.error?.code===131026){ // spam / bloqueado
          await pool.query(`UPDATE campaigns SET status='paused_spam' WHERE id=$1`,[cid]); break;
        }
      }
      await new Promise(r=>setTimeout(r,3000)); // anti-spam delay
      if(sent%50===0) await new Promise(r=>setTimeout(r,60000)); // pausa cada 50
    }
    await pool.query(`UPDATE campaigns SET sent=$1, failed=$2, status='done' WHERE id=$3`,[sent,failed,cid]);
  })();
  res.json({ok:true, campaign_id:cid, total:numbers.length});
});
app.get('/api/campaigns', needAuth, async (req,res)=>{
  const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY created_at DESC`,[req.session.user.agency_id]);
  res.json(r.rows);
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log('KLIDO ON port',PORT));
