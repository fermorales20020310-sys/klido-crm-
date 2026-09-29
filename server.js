// server.js - KLIDO V8.5 PRO FIX - MULTIAGENCIA + MEDIA + ANTIBANEO + SYNC + CAMPANAS SIN Ñ
try{ require('dotenv').config(); }catch(e){}
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
app.use(express.json({limit:'30mb'}));
app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS'); res.header('Access-Control-Allow-Headers','Content-Type'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); });

// FIX 1: Redirect ñ -> sin ñ para que no de Cannot GET
app.get('/campañas.html', (req,res)=> res.redirect(301, '/campanas.html'));
app.get('/campa%C3%B1as.html', (req,res)=> res.redirect(301, '/campanas.html'));

app.use(express.static(path.join(__dirname,'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const WA_TOKEN = (process.env.WHATSAPP_TOKEN||'').trim();
const WA_PHONE_ID = (process.env.WHATSAPP_PHONE_ID || process.env.PHONE_NUMBER_ID || '').trim();
const WABA_ID = (process.env.WABA_ID||'').trim();
const WA_VERIFY = (process.env.WHATSAPP_VERIFY_TOKEN || 'klido123').trim();

async function sendEmail(to, subject, html){
  if(!process.env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY');
  const r = await fetch('https://api.resend.com/emails',{ method:'POST', headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'}, body:JSON.stringify({from: process.env.RESEND_FROM || 'KLIDO <onboarding@resend.dev>', to:[to], subject, html}) });
  const data = await r.json(); if(!r.ok) throw new Error(JSON.stringify(data)); return data;
}
async function sendWhatsappReal(to, text){
  if(!WA_TOKEN) throw new Error('Falta WHATSAPP_TOKEN');
  let clean = String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean;
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{ method:'POST', headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'}, body:JSON.stringify({messaging_product:'whatsapp', to:clean, type:'text', text:{body:text}}) });
  const j = await r.json(); if(!r.ok) throw new Error(j.error?.message||'Error WA'); return j;
}
async function sendTemplateReal(to, templateName){
  let clean = String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean; if(clean.length<10) return {error:'numero corto'};
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{ method:'POST', headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'}, body:JSON.stringify({messaging_product:'whatsapp', to:clean, type:'template', template:{name:templateName, language:{code:'es_CO'}}}) });
  return await r.json();
}
async function ensureTables(){
  await pool.query(`CREATE TABLE IF NOT EXISTS users(agency_id TEXT, username TEXT, password_hash TEXT, role TEXT, display_name TEXT, plan TEXT DEFAULT 'basico', PRIMARY KEY(agency_id,username))`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'basico'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chats(agency_id TEXT, wa_id TEXT, name TEXT, last_message TEXT, last_message_at BIGINT, unread INT DEFAULT 0, tag TEXT DEFAULT 'nuevo', source TEXT DEFAULT 'direct', assigned_to TEXT, PRIMARY KEY(agency_id,wa_id))`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS assigned_to TEXT`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'direct'`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, text TEXT, direction TEXT, timestamp BIGINT, sent_by TEXT, campaign_id INT, media_url TEXT, media_type TEXT)`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS password_resets(agency_id TEXT, email TEXT, token TEXT, expires_at BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_config(agency_id TEXT PRIMARY KEY, enabled BOOLEAN, prompt TEXT, human_takeover BOOLEAN)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS templates(agency_id TEXT, name TEXT, status TEXT, language TEXT, PRIMARY KEY(agency_id,name))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, agency_id TEXT, template TEXT, total INT, sent INT DEFAULT 0, status TEXT DEFAULT 'pending', created_at BIGINT, contacts JSONB)`);
  console.log('>>> Tablas V8.5 OK');
}

app.get('/health', (req,res)=>res.json({ok:true, v:'V8.5 FIX', phoneId:WA_PHONE_ID, waba:WABA_ID, owner:'3133181851'}));
app.get('/webhook', (req,res)=>{ if(req.query['hub.verify_token']===WA_VERIFY) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/webhook', async (req,res)=>{
  try{
    const val = req.body.entry?.[0]?.changes?.[0]?.value; const msg = val?.messages?.[0];
    if(msg){
      const wa_id = msg.from;
      let text = msg.text?.body || ''; let media_type = null;
      if(msg.image){ text='📷 Foto'; media_type='image'; }
      if(msg.video){ text='🎥 Video'; media_type='video'; }
      if(msg.audio||msg.voice){ text='🎤 Audio'; media_type='audio'; }
      if(msg.document){ text='📄 Documento'; media_type='document'; }
      const name = val.contacts?.[0]?.profile?.name||wa_id;
      let agency_id='acol';
      try{ const ag=await pool.query(`SELECT agency_id FROM users WHERE plan='gold' LIMIT 1`); if(ag.rows.length) agency_id=ag.rows[0].agency_id; }catch(e){}
      await pool.query(`INSERT INTO chats(agency_id,wa_id,name,last_message,last_message_at,unread,source) VALUES($1,$2,$3,$4,$5,1,'direct') ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$4, last_message_at=$5, unread=chats.unread+1, name=$3`,[agency_id, wa_id, name, text, Date.now()]);
      await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,media_type) VALUES($1,$2,$3,'in',$4,$5)`,[agency_id, wa_id, text, Date.now(), media_type]);
    }
  }catch(e){ console.error(e); } res.sendStatus(200);
});

app.post('/api/login', async (req,res)=>{
  const {agency_id, username, email, password} = req.body; const userLogin = (username||email||'').toLowerCase(); const ag = (agency_id||'').toLowerCase();
  const r = await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2)`,[ag, userLogin]);
  if(!r.rows.length) return res.status(401).json({error:'No existe '+userLogin+' en agencia '+ag});
  const ok = await bcrypt.compare(password, r.rows[0].password_hash); if(!ok) return res.status(401).json({error:'Clave incorrecta'});
  res.json({agency_id:r.rows[0].agency_id, username:r.rows[0].username, role:r.rows[0].role, display_name:r.rows[0].display_name, plan:r.rows[0].plan});
});
app.post('/api/forgot-password', async (req,res)=>{
  const {email} = req.body; const clean = email.trim().toLowerCase();
  const users = await pool.query(`SELECT agency_id FROM users WHERE LOWER(username)=LOWER($2) OR LOWER(username)=LOWER($1)`,[clean, clean]);
  const uniq = [...new Map(users.rows.map(r=>[r.agency_id,r])).values()];
  if(!uniq.length) return res.status(404).json({error:'Correo no registrado'});
  for(let u of uniq){
    const token = crypto.randomBytes(32).toString('hex'); const expires = Date.now()+1000*60*15;
    await pool.query(`INSERT INTO password_resets(agency_id,email,token,expires_at) VALUES($1,$2,$3,$4)`,[u.agency_id, clean, token, expires]);
    const link = `https://${req.get('host')}/reset.html?token=${token}`;
    await sendEmail(clean, `KLIDO - Restablecer ${u.agency_id}`, `<h2>KLIDO</h2><p>Agencia: ${u.agency_id}</p><a href="${link}" style="background:#2a4bff;color:#fff;padding:14px 20px;border-radius:12px;text-decoration:none;display:inline-block">Cambiar contraseña</a>`);
  }
  res.json({ok:true});
});
app.post('/api/reset-password', async (req,res)=>{
  const {token, newPassword} = req.body; const r = await pool.query(`SELECT * FROM password_resets WHERE token=$1`,[token]);
  if(!r.rows.length) return res.status(400).json({error:'Token invalido'}); if(Date.now() > Number(r.rows[0].expires_at)) return res.status(400).json({error:'Expirado'});
  const hash = await bcrypt.hash(newPassword, 10); await pool.query(`UPDATE users SET password_hash=$1 WHERE LOWER(username)=LOWER($2)`,[hash, r.rows[0].email]);
  await pool.query(`DELETE FROM password_resets WHERE token=$1`,[token]); res.json({ok:true});
});
app.get('/api/hazme-jefe', async (req,res)=>{
  const {agency_id, username} = req.query;
  const r = await pool.query(`UPDATE users SET role='jefe', plan='gold', display_name='Fernanda Morales' WHERE agency_id=$1 AND LOWER(username)=LOWER($2) RETURNING *`,[agency_id.toLowerCase(), username.toLowerCase()]);
  if(!r.rows.length) return res.json({error:'No encontrado'}); res.json({ok:true, usuario:r.rows[0]});
});
app.get('/api/crear-jefe', async (req,res)=>{
  const {agency_id, username, password, name} = req.query; if(!agency_id||!username||!password) return res.json({error:'Falta'});
  const hash = await bcrypt.hash(password, 10);
  const display = name || 'Fernanda Morales';
  await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,'jefe',$4,'gold') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role='jefe', plan='gold', display_name=$4`,[agency_id.toLowerCase(), username.toLowerCase(), hash, display]);
  res.json({ok:true, login:{agency_id, username, display_name:display}});
});

app.get('/api/chats', async (req,res)=>{
  const {agency_id, worker} = req.query; let q=`SELECT * FROM chats WHERE agency_id=$1`; const p=[agency_id];
  if(worker){ p.push(worker); q+=` AND wa_id IN (SELECT DISTINCT wa_id FROM messages WHERE agency_id=$1 AND sent_by=$${p.length})`; }
  q+=` ORDER BY last_message_at DESC LIMIT 400`; const r=await pool.query(q,p); res.json(r.rows);
});
app.get('/api/messages/:wa_id', async (req,res)=>{ const r=await pool.query(`SELECT * FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY timestamp ASC LIMIT 1000`,[req.query.agency_id, req.params.wa_id]); res.json(r.rows); });
app.post('/api/messages/send', async (req,res)=>{
  try{
    const {wa_id,text,agency_id,username} = req.body;
    await sendWhatsappReal(wa_id, text);
    await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,sent_by) VALUES($1,$2,$3,'out',$4,$5)`,[agency_id, wa_id, text, Date.now(), username]);
    await pool.query(`INSERT INTO chats(agency_id,wa_id,last_message,last_message_at,unread) VALUES($1,$2,$3,$4,0) ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$3, last_message_at=$4, unread=0`,[agency_id, wa_id, text, Date.now()]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});
// FIX 2: Soporta las 2 formas de marcar leído
app.post('/api/chats/:wa_id/read', async (req,res)=>{ const ag=req.query.agency_id||req.body.agency_id; await pool.query(`UPDATE chats SET unread=0 WHERE agency_id=$1 AND wa_id=$2`,[ag, req.params.wa_id]); res.json({ok:true}); });
app.post('/api/chats/read', async (req,res)=>{ await pool.query(`UPDATE chats SET unread=0 WHERE agency_id=$1 AND wa_id=$2`,[req.body.agency_id, req.body.wa_id]); res.json({ok:true}); });
app.post('/api/chats/:wa_id/tag', async (req,res)=>{ await pool.query(`UPDATE chats SET tag=$1 WHERE agency_id=$2 AND wa_id=$3`,[req.body.tag, req.body.agency_id, req.params.wa_id]); res.json({ok:true}); });

// FIX 3: Workers alias para tu panel admin nuevo
app.get('/api/workers', async (req,res)=>{ const r=await pool.query(`SELECT agency_id,username,role,display_name,plan, username as id FROM users WHERE agency_id=$1`,[req.query.agency_id]); const enriched=[]; for(let u of r.rows){ const chats=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1`,[req.query.agency_id]); const msgs=await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND sent_by=$2 AND timestamp > $3`,[req.query.agency_id,u.username,Date.now()-86400000]); enriched.push({...u, chats:Number(chats.rows[0].count), msgs:Number(msgs.rows[0].count), unread:0}); } res.json(enriched); });
app.post('/api/workers', async (req,res)=>{ const {agency_id,email,password,role} = req.body; const hash=await bcrypt.hash(password,10); await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,$4,$2,'basico') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role=$4`,[agency_id.toLowerCase(), email.toLowerCase(), hash, role||'worker']); res.json({ok:true}); });
app.delete('/api/workers/:id', async (req,res)=>{ const ag=req.query.agency_id; const id=req.params.id; await pool.query(`DELETE FROM users WHERE agency_id=$1 AND (LOWER(username)=LOWER($2) OR username=$2)`,[ag, id]); res.json({ok:true}); });

app.get('/api/team', async (req,res)=>{ const r=await pool.query(`SELECT agency_id,username,role,display_name,plan FROM users WHERE agency_id=$1`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/team/create', async (req,res)=>{
  const {agency_id,username,password,display_name,role_req} = req.body;
  const check = await pool.query(`SELECT role FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2)`,[agency_id, role_req.toLowerCase()]);
  if(!check.rows.length ||!['jefe','admin'].includes(check.rows[0].role)) return res.status(403).json({error:'Solo jefe/admin'});
  const hash=await bcrypt.hash(password,10);
  await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,'trabajador',$4,'basico') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, display_name=$4`,[agency_id.toLowerCase(), username.toLowerCase(), hash, display_name]);
  res.json({ok:true});
});
app.post('/api/team/delete', async (req,res)=>{ await pool.query(`DELETE FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2) AND role='trabajador'`,[req.body.agency_id, req.body.username]); res.json({ok:true}); });

app.get('/api/stats', async (req,res)=>{
  const {agency_id} = req.query;
  const totalChats = await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1`,[agency_id]);
  const unread = await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND unread>0`,[agency_id]);
  const campaign = await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND source='campaign'`,[agency_id]);
  const totalMsg = await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1`,[agency_id]);
  const todayMsg = await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND timestamp > $2`,[agency_id, Date.now()-86400000]);
  const byWorker = await pool.query(`SELECT sent_by as worker, COUNT(*) as total FROM messages WHERE agency_id=$1 AND direction='out' GROUP BY sent_by ORDER BY total DESC`,[agency_id]);
  const byTag = await pool.query(`SELECT tag, COUNT(*) as total FROM chats WHERE agency_id=$1 GROUP BY tag`,[agency_id]);
  res.json({totalChats:Number(totalChats.rows[0].count), unread:Number(unread.rows[0].count), campaign:Number(campaign.rows[0].count), totalMessages:Number(totalMsg.rows[0].count), today:Number(todayMsg.rows[0].count), todayMessages:Number(todayMsg.rows[0].count), weekMessages:0, byWorker:byWorker.rows, byTag:byTag.rows});
});

// --- PLANTILLAS ---
app.get('/api/templates', async (req,res)=>{ const r=await pool.query(`SELECT * FROM templates WHERE agency_id=$1 AND status='approved' ORDER BY name`,[req.query.agency_id]); res.json(r.rows); });
async function syncTemplatesLogic(agency_id){
  if(!WA_TOKEN) throw new Error('Falta WHATSAPP_TOKEN');
  if(!WABA_ID){ const r=await pool.query(`SELECT COUNT(*) FROM templates WHERE agency_id=$1 AND status='approved'`,[agency_id]); return {ok:true, count:Number(r.rows[0].count), note:'Pon WABA_ID para sync Meta'}; }
  const resp = await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?fields=name,status,language&status=APPROVED&limit=100`,{headers:{'Authorization':'Bearer '+WA_TOKEN}});
  const j = await resp.json(); if(j.error) throw new Error(j.error.message);
  let count=0; for(let t of j.data||[]){ await pool.query(`INSERT INTO templates(agency_id,name,status,language) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id,name) DO UPDATE SET status=$3, language=$4`,[agency_id, t.name, 'approved', t.language]); count++; }
  return {ok:true, count};
}
app.post('/api/templates/sync-real', async (req,res)=>{ try{ const j=await syncTemplatesLogic(req.query.agency_id); res.json(j); }catch(e){ res.json({error:e.message}); } });
app.post('/api/templates/sync', async (req,res)=>{ try{ const j=await syncTemplatesLogic(req.query.agency_id); res.json(j); }catch(e){ res.json({error:e.message}); } });

// --- CAMPAÑAS FIX ---
app.get('/api/campaigns', async (req,res)=>{ const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY id DESC LIMIT 100`,[req.query.agency_id]); res.json(r.rows); });
app.get('/api/campaigns/:id', async (req,res)=>{
  const r=await pool.query(`SELECT * FROM campaigns WHERE id=$1 AND agency_id=$2`,[req.params.id, req.query.agency_id]);
  if(!r.rows.length) return res.status(404).json({error:'No encontrada'});
  const camp=r.rows[0];
  res.json({id:camp.id, template:camp.template, total:camp.total, sent:camp.sent, status:camp.status, logs:[`Enviados ${camp.sent}/${camp.total} - Antibaneo 50/5h`]});
});
app.post('/api/campaigns/upload', async (req,res)=>{
  try{
    const {agency_id, template, fileBase64} = req.body;
    const buffer = Buffer.from(fileBase64.split(',').pop(), 'base64'); const wb = XLSX.read(buffer); const sheet = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(sheet, {header:1}).filter(r=>r && r.length);
    if(rows.length<2) return res.status(400).json({error:'Excel vacio'});
    const headers = rows[0].map(h=>String(h||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""));
    let phoneIdx = headers.findIndex(h=>['telefono','tel','phone','celular','whatsapp','numero','movil','cel'].some(k=>h.includes(k)));
    if(phoneIdx===-1){ let best=0,cmax=0; for(let col=0;col<headers.length;col++){ let c=0; for(let r=1;r<Math.min(rows.length,40);r++){ let v=String(rows[r][col]||'').replace(/\D/g,''); if(v.length>=10&&v.length<=13) c++; } if(c>cmax){cmax=c; best=col;}} phoneIdx=best; }
    const contacts = []; for(let i=1;i<rows.length;i++){ let raw=rows[i][phoneIdx]; if(!raw) continue; let num=String(raw).replace(/\D/g,''); if(num.length===10) num='57'+num; if(num.length<10||num.length>15) continue; let nameIdx = phoneIdx===0?1:0; for(let c=0;c<rows[i].length;c++){ if(c!==phoneIdx && String(rows[i][c]).length>2 && isNaN(rows[i][c])){ nameIdx=c; break; } } contacts.push({wa_id:num, name:String(rows[i][nameIdx]||'').slice(0,30)}); }
    const uniq = [...new Map(contacts.map(c=>[c.wa_id,c])).values()].slice(0,5000);
    if(!uniq.length) return res.status(400).json({error:'No detecte numeros'});
    const result = await pool.query(`INSERT INTO campaigns(agency_id,template,total,created_at,contacts,status) VALUES($1,$2,$3,$4,$5,'pending') RETURNING id`,[agency_id, template, uniq.length, Date.now(), JSON.stringify(uniq)]);
    res.json({ok:true, id:result.rows[0].id, total:uniq.length, campaign_id:result.rows[0].id});
  }catch(e){ res.status(500).json({error:e.message}); }
});
// FIX NUEVO ENDPOINT QUE USA TU CAMPANAS.HTML NUEVO
app.post('/api/campaigns/start', async (req,res)=>{
  try{
    const {agency_id, template, contacts} = req.body;
    if(!contacts ||!contacts.length) return res.status(400).json({error:'Sin contactos'});
    const uniq = [...new Map(contacts.map(c=>[String(c.wa_id).replace(/\D/g,''),c])).values()].slice(0,5000);
    const result = await pool.query(`INSERT INTO campaigns(agency_id,template,total,sent,created_at,contacts,status) VALUES($1,$2,$3,0,$4,$5,'pending') RETURNING id`,[agency_id, template, uniq.length, Date.now(), JSON.stringify(uniq)]);
    res.json({ok:true, campaign_id:result.rows[0].id, id:result.rows[0].id, total:uniq.length});
  }catch(e){ res.status(500).json({error:e.message}); }
});

setInterval(async ()=>{
  try{
    const pending = await pool.query(`SELECT * FROM campaigns WHERE status!='done' ORDER BY id ASC LIMIT 2`);
    for(let camp of pending.rows){
      const contacts = typeof camp.contacts==='string'?JSON.parse(camp.contacts):camp.contacts; const toSend = contacts.slice(camp.sent, camp.sent+50);
      if(!toSend.length){ await pool.query(`UPDATE campaigns SET status='done' WHERE id=$1`,[camp.id]); continue; }
      for(let c of toSend){ try{ await sendTemplateReal(c.wa_id, camp.template); await pool.query(`INSERT INTO chats(agency_id,wa_id,name,last_message,source,last_message_at) VALUES($1,$2,$3,$4,'campaign',$5) ON CONFLICT(agency_id,wa_id) DO UPDATE SET source='campaign', name=COALESCE(EXCLUDED.name,chats.name)`,[camp.agency_id, c.wa_id, c.name, 'Campaña: '+camp.template, Date.now()]); }catch(e){} await new Promise(r=>setTimeout(r, 3000)); }
      await pool.query(`UPDATE campaigns SET sent=sent+$1 WHERE id=$2`,[toSend.length, camp.id]);
    }
  }catch(e){ console.error('Camp', e.message); }
}, 1000*60*60*5);

const PORT = process.env.PORT || 3000;
(async()=>{ await ensureTables(); app.listen(PORT, '0.0.0.0', ()=>console.log(`🚀 KLIDO V8.5 FIX en ${PORT}`)); })();
