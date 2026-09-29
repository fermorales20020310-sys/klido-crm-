// server.js - KLIDO V7.0 ADMIN - INBOX + EQUIPO + METRICAS + FIX 502
try{ require('dotenv').config(); }catch(e){}
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
app.use(express.json({limit:'30mb'}));
app.use(express.static(path.join(__dirname,'public')));
app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.header('Access-Control-Allow-Headers','Content-Type'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
pool.on('error', e=>console.error('PG POOL ERROR', e.message));

const WA_TOKEN = (process.env.WHATSAPP_TOKEN||'').trim();
const WA_PHONE_ID = (process.env.WHATSAPP_PHONE_ID || process.env.PHONE_NUMBER_ID || process.env.PHONE_ID || '').trim();
const WA_VERIFY = (process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'klido123').trim();

console.log('>>> KLIDO V7.0 ADMIN - WA:', { hasToken:!!WA_TOKEN, phoneId: WA_PHONE_ID });

async function sendEmail(to, subject, html){
  if(!process.env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY');
  const r = await fetch('https://api.resend.com/emails',{ method:'POST', headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'}, body:JSON.stringify({from: process.env.RESEND_FROM || 'KLIDO <onboarding@resend.dev>', to:[to], subject, html}) });
  const data = await r.json(); if(!r.ok) throw new Error(JSON.stringify(data)); return data;
}
async function sendWhatsappReal(to, text){
  if(!WA_TOKEN) throw new Error('Falta WHATSAPP_TOKEN');
  if(!WA_PHONE_ID) throw new Error('Falta PHONE_ID');
  let clean = String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean;
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{ method:'POST', headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'}, body:JSON.stringify({messaging_product:'whatsapp', to:clean, type:'text', text:{body:text}}) });
  const j = await r.json(); if(!r.ok){ console.error('WA ERROR', j); throw new Error(j.error?.message||'Error WA'); } return j;
}
async function sendTemplateReal(to, templateName){
  let clean = String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean;
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{ method:'POST', headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'}, body:JSON.stringify({messaging_product:'whatsapp', to:clean, type:'template', template:{name:templateName, language:{code:'es_CO'}}}) });
  return await r.json();
}
async function ensureTables(){
  try{
    await pool.query(`CREATE TABLE IF NOT EXISTS users(agency_id TEXT, username TEXT, password_hash TEXT, role TEXT, display_name TEXT, plan TEXT DEFAULT 'basico', PRIMARY KEY(agency_id,username))`);
    // MIGRACION PARA TABLAS VIEJAS - NO BORRA NADA
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'basico'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`);

    await pool.query(`CREATE TABLE IF NOT EXISTS chats(agency_id TEXT, wa_id TEXT, name TEXT, last_message TEXT, last_message_at BIGINT, unread INT DEFAULT 0, tag TEXT DEFAULT 'nuevo', source TEXT DEFAULT 'direct', assigned_to TEXT, PRIMARY KEY(agency_id,wa_id))`);
    await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS assigned_to TEXT`);

    await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, text TEXT, direction TEXT, timestamp BIGINT, sent_by TEXT, campaign_id INT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS password_resets(agency_id TEXT, email TEXT, token TEXT, expires_at BIGINT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_config(agency_id TEXT PRIMARY KEY, enabled BOOLEAN, prompt TEXT, human_takeover BOOLEAN)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS templates(agency_id TEXT, name TEXT, status TEXT, language TEXT, PRIMARY KEY(agency_id,name))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, agency_id TEXT, template TEXT, total INT, sent INT DEFAULT 0, status TEXT DEFAULT 'pending', created_at BIGINT, contacts JSONB)`);
    console.log('>>> Tablas OK V7');
  }catch(e){ console.error('ensureTables:', e.message); }
}

app.get('/health', (req,res)=>res.json({ok:true, v:'V7.0 ADMIN', phoneId:WA_PHONE_ID, wa:!!WA_TOKEN, owner:'3133181851'}));

app.get('/webhook', (req,res)=>{ if(req.query['hub.verify_token']===WA_VERIFY) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/webhook', async (req,res)=>{
  try{
    const val = req.body.entry?.[0]?.changes?.[0]?.value; const msg = val?.messages?.[0];
    if(msg){
      const wa_id = msg.from; const text = msg.text?.body || '[media]'; const name = val.contacts?.[0]?.profile?.name||wa_id;
      let agency_id='demo'; try{ const ag=await pool.query(`SELECT agency_id FROM users LIMIT 1`); if(ag.rows.length) agency_id=ag.rows[0].agency_id; }catch(e){}
      await pool.query(`INSERT INTO chats(agency_id,wa_id,name,last_message,last_message_at,unread,source) VALUES($1,$2,$3,$4,$5,1,'direct') ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$4, last_message_at=$5, unread=chats.unread+1, name=$3`,[agency_id, wa_id, name, text, Date.now()]);
      await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp) VALUES($1,$2,$3,'in',$4)`,[agency_id, wa_id, text, Date.now()]);
    }
  }catch(e){ console.error(e); } res.sendStatus(200);
});

// LOGIN
app.post('/api/login', async (req,res)=>{
  const {agency_id, username, email, password} = req.body; const userLogin = (username||email||'').toLowerCase(); const ag = (agency_id||'').toLowerCase();
  const r = await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2)`,[ag, userLogin]);
  if(!r.rows.length) return res.status(401).json({error:'No existe '+userLogin+' en '+ag});
  const ok = await bcrypt.compare(password, r.rows[0].password_hash); if(!ok) return res.status(401).json({error:'Clave incorrecta'});
  res.json({agency_id:r.rows[0].agency_id, username:r.rows[0].username, role:r.rows[0].role, display_name:r.rows[0].display_name, plan:r.rows[0].plan});
});
app.post('/api/forgot-password', async (req,res)=>{
  const {email} = req.body; const clean = email.trim().toLowerCase();
  const users = await pool.query(`SELECT agency_id FROM users WHERE LOWER(username)=LOWER($1)`,[clean]);
  if(!users.rows.length) return res.status(404).json({error:'No registrado'});
  for(let u of users.rows){
    const token = crypto.randomBytes(32).toString('hex'); const expires = Date.now()+1000*60*15;
    await pool.query(`INSERT INTO password_resets(agency_id,email,token,expires_at) VALUES($1,$2,$3,$4)`,[u.agency_id, clean, token, expires]);
    const link = `https://${req.get('host')}/reset.html?token=${token}`;
    await sendEmail(clean, `KLIDO - Restablecer ${u.agency_id}`, `<h2>KLIDO</h2><p>Agencia ${u.agency_id}</p><a href="${link}" style="background:#111;color:#fff;padding:14px;border-radius:12px;text-decoration:none">Cambiar clave</a>`);
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
  try{
    const {agency_id, username} = req.query;
    if(!agency_id ||!username) return res.json({error:'Usa: /api/hazme-jefe?agency_id=demo&username=TU_EMAIL'});
    const r = await pool.query(`UPDATE users SET role='jefe', plan='gold' WHERE agency_id=$1 AND LOWER(username)=LOWER($2) RETURNING agency_id,username,role,plan`,[agency_id.toLowerCase(), username.toLowerCase()]);
    if(!r.rows.length){ const all = await pool.query(`SELECT agency_id,username,role,plan FROM users LIMIT 20`); return res.json({error:'No encontrado', usuarios: all.rows}); }
    res.json({ok:true, mensaje:'YA ERES JEFE GOLD', usuario: r.rows[0]});
  }catch(e){ res.json({error:e.message}); }
});
app.get('/api/crear-jefe', async (req,res)=>{
  try{
    const {agency_id, username, password} = req.query; if(!agency_id||!username||!password) return res.json({error:'Falta datos'});
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,'jefe',$4,'gold') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role='jefe', plan='gold'`,[agency_id.toLowerCase(), username.toLowerCase(), hash, username]);
    res.json({ok:true, login:{agency_id, username, password}});
  }catch(e){ res.json({error:e.message}); }
});

// INBOX ORIGINAL - NO TOCADO
app.get('/api/chats', async (req,res)=>{
  const {agency_id, filter, worker} = req.query;
  let q = `SELECT *, CASE WHEN unread>0 THEN 'red' WHEN source='campaign' THEN 'yellow' ELSE 'online' END as status_dot FROM chats WHERE agency_id=$1`;
  const params=[agency_id];
  if(filter==='unanswered') q+=` AND unread>0`;
  if(filter==='campaign') q+=` AND source='campaign'`;
  if(worker){ params.push(worker); q+=` AND wa_id IN (SELECT DISTINCT wa_id FROM messages WHERE agency_id=$1 AND sent_by=$${params.length})`; }
  q+=` ORDER BY last_message_at DESC LIMIT 400`;
  const r=await pool.query(q,params); res.json(r.rows);
});
app.get('/api/messages/:wa_id', async (req,res)=>{ const r=await pool.query(`SELECT * FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY timestamp ASC LIMIT 1000`,[req.query.agency_id, req.params.wa_id]); res.json(r.rows); });
app.post('/api/messages/send', async (req,res)=>{
  try{
    const {wa_id,text,agency_id,username} = req.body;
    const waRes = await sendWhatsappReal(wa_id, text);
    await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,sent_by) VALUES($1,$2,$3,'out',$4,$5)`,[agency_id, wa_id, text, Date.now(), username||'jefe']);
    await pool.query(`INSERT INTO chats(agency_id,wa_id,last_message,last_message_at,unread) VALUES($1,$2,$3,$4,0) ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$3, last_message_at=$4, unread=0`,[agency_id, wa_id, text, Date.now()]);
    res.json({ok:true, wa:waRes});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/chats/:wa_id/read', async (req,res)=>{ await pool.query(`UPDATE chats SET unread=0 WHERE agency_id=$1 AND wa_id=$2`,[req.query.agency_id, req.params.wa_id]); res.json({ok:true}); });
app.post('/api/chats/:wa_id/tag', async (req,res)=>{ await pool.query(`UPDATE chats SET tag=$1 WHERE agency_id=$2 AND wa_id=$3`,[req.body.tag, req.body.agency_id, req.params.wa_id]); res.json({ok:true}); });

// TEAM ORIGINAL + NUEVO
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

// === NUEVO: ESTADISTICAS PARA ADMINISTRADOR ===
app.get('/api/stats', async (req,res)=>{
  try{
    const {agency_id} = req.query;
    const totalChats = await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1`,[agency_id]);
    const unread = await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND unread>0`,[agency_id]);
    const totalMsg = await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1`,[agency_id]);
    const todayMsg = await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND timestamp > $2`,[agency_id, Date.now()-1000*60*60*24]);
    const byWorker = await pool.query(`SELECT sent_by as worker, COUNT(*) as total FROM messages WHERE agency_id=$1 AND direction='out' GROUP BY sent_by ORDER BY total DESC`,[agency_id]);
    const byTag = await pool.query(`SELECT tag, COUNT(*) as total FROM chats WHERE agency_id=$1 GROUP BY tag`,[agency_id]);
    const last7 = await pool.query(`SELECT COUNT(*) as c FROM messages WHERE agency_id=$1 AND timestamp > $2`,[agency_id, Date.now()-1000*60*60*24*7]);
    res.json({
      totalChats: Number(totalChats.rows[0].count),
      unread: Number(unread.rows[0].count),
      totalMessages: Number(totalMsg.rows[0].count),
      todayMessages: Number(todayMsg.rows[0].count),
      weekMessages: Number(last7.rows[0].c),
      byWorker: byWorker.rows,
      byTag: byTag.rows
    });
  }catch(e){ res.json({error:e.message}); }
});

app.get('/api/team/activity', async (req,res)=>{
  try{
    const {agency_id} = req.query;
    const team = await pool.query(`SELECT username, role, display_name, plan FROM users WHERE agency_id=$1 ORDER BY role DESC`,[agency_id]);
    const activity = [];
    for(let u of team.rows){
      const msgs = await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND sent_by=$2`,[agency_id, u.username]);
      const last = await pool.query(`SELECT MAX(timestamp) as last FROM messages WHERE agency_id=$1 AND sent_by=$2`,[agency_id, u.username]);
      const chats = await pool.query(`SELECT COUNT(DISTINCT wa_id) as c FROM messages WHERE agency_id=$1 AND sent_by=$2`,[agency_id, u.username]);
      activity.push({...u, messages: Number(msgs.rows[0].count), chats_touched: Number(chats.rows[0].c), last_active: last.rows[0].last });
    }
    res.json(activity);
  }catch(e){ res.json({error:e.message}); }
});

app.get('/api/worker/:username/chats', async (req,res)=>{
  const {agency_id} = req.query;
  const r = await pool.query(`SELECT DISTINCT c.* FROM chats c JOIN messages m ON m.wa_id=c.wa_id AND m.agency_id=c.agency_id WHERE m.agency_id=$1 AND m.sent_by=$2 ORDER BY c.last_message_at DESC LIMIT 100`,[agency_id, req.params.username]);
  res.json(r.rows);
});

// TEMPLATES / CAMPAIGNS - ORIGINAL
app.get('/api/templates', async (req,res)=>{ const r=await pool.query(`SELECT * FROM templates WHERE agency_id=$1 AND status='approved'`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/templates/sync', async (req,res)=>{ for(let t of req.body.templates){ await pool.query(`INSERT INTO templates(agency_id,name,status,language) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id,name) DO UPDATE SET status=$3`,[req.body.agency_id, t.name, t.status, t.language||'es']); } res.json({ok:true}); });
app.get('/api/campaigns', async (req,res)=>{ const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY id DESC LIMIT 100`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/campaigns/upload', async (req,res)=>{
  const {agency_id, template, fileBase64} = req.body;
  const buffer = Buffer.from(fileBase64.split(',').pop(), 'base64'); const wb = XLSX.read(buffer); const sheet = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(sheet, {header:1});
  const contacts = rows.slice(1).filter(r=>r[0]).map(r=>({wa_id:String(r[0]).replace(/\D/g,''), name:r[1]||''})).slice(0,5000);
  if(!contacts.length) return res.status(400).json({error:'Excel vacio'});
  const result = await pool.query(`INSERT INTO campaigns(agency_id,template,total,created_at,contacts) VALUES($1,$2,$3,$4,$5) RETURNING id`,[agency_id, template, contacts.length, Date.now(), JSON.stringify(contacts)]);
  res.json({ok:true, id:result.rows[0].id, total:contacts.length});
});
setInterval(async ()=>{
  try{
    const pending = await pool.query(`SELECT * FROM campaigns WHERE status!='done' ORDER BY id ASC LIMIT 2`);
    for(let camp of pending.rows){
      const contacts = typeof camp.contacts==='string'?JSON.parse(camp.contacts):camp.contacts; const toSend = contacts.slice(camp.sent, camp.sent+50);
      if(!toSend.length){ await pool.query(`UPDATE campaigns SET status='done' WHERE id=$1`,[camp.id]); continue; }
      for(let c of toSend){ try{ await sendTemplateReal(c.wa_id, camp.template); }catch(e){} await new Promise(r=>setTimeout(r, 3000)); }
      await pool.query(`UPDATE campaigns SET sent=sent+$1 WHERE id=$2`,[toSend.length, camp.id]);
    }
  }catch(e){ console.error('Camp error', e.message); }
}, 1000*60*60*5);
app.get('/api/ai-config', async (req,res)=>{
  const r=await pool.query(`SELECT * FROM ai_config WHERE agency_id=$1`,[req.query.agency_id]); const plan = await pool.query(`SELECT plan FROM users WHERE agency_id=$1 LIMIT 1`,[req.query.agency_id]);
  const isGold = (plan.rows[0]?.plan||'').toLowerCase()==='gold'; res.json({... (r.rows[0]||{enabled:false,prompt:'',human_takeover:true}), isGold, owner:'3133181851'});
});
app.post('/api/ai-config', async (req,res)=>{
  const {agency_id,enabled,prompt,human_takeover} = req.body; const plan = await pool.query(`SELECT plan FROM users WHERE agency_id=$1 LIMIT 1`,[agency_id]);
  if(!plan.rows.length || plan.rows[0].plan!=='gold') return res.status(403).json({error:'Solo Gold'});
  await pool.query(`INSERT INTO ai_config(agency_id,enabled,prompt,human_takeover) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id) DO UPDATE SET enabled=$2,prompt=$3,human_takeover=$4`,[agency_id,enabled,prompt,human_takeover]); res.json({ok:true});
});
app.get('/api/plans', (req,res)=>res.json([{id:'basico',price:800000},{id:'premium',price:1300000},{id:'gold',price:2400000}]));
app.get('/api/legal', (req,res)=>res.json({ley1581:true, owner:'3133181851', phoneId:WA_PHONE_ID}));

const PORT = process.env.PORT || 3000;
(async()=>{
  try{ await ensureTables(); }catch(e){ console.error('DB init fail pero sigo:', e.message); }
  app.listen(PORT, '0.0.0.0', ()=>console.log(`🚀 KLIDO V7.0 ADMIN en ${PORT} - 0.0.0.0 - PhoneID:${WA_PHONE_ID}`));
})();
process.on('uncaughtException', e=>console.error('UNCAUGHT', e.message));
process.on('unhandledRejection', e=>console.error('REJECTION', e?.message));
