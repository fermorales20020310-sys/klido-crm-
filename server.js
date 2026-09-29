// server.js - KLIDO CRM V6.1 - FIX RAILWAY NETWORKING - SIN DAÑAR NADA
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

// CORS para que no falle el front
app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.header('Access-Control-Allow-Headers','Content-Type'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
pool.on('error', (err)=>console.error('POOL ERROR', err.message));

const WA_TOKEN = (process.env.WHATSAPP_TOKEN||'').trim();
const WA_PHONE_ID = (process.env.WHATSAPP_PHONE_ID || process.env.PHONE_NUMBER_ID || process.env.PHONE_ID || '').trim();
const WA_VERIFY = (process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'klido123').trim();

console.log('>>> KLIDO V6.1 - WA:', { hasToken:!!WA_TOKEN, phoneId: WA_PHONE_ID, verify: WA_VERIFY });

async function sendEmail(to, subject, html){
  if(!process.env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY');
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from: process.env.RESEND_FROM || 'KLIDO <onboarding@resend.dev>', to:[to], subject, html})
  });
  const data = await r.json(); if(!r.ok) throw new Error(JSON.stringify(data)); return data;
}
async function sendWhatsappReal(to, text){
  if(!WA_TOKEN) throw new Error('Falta WHATSAPP_TOKEN');
  if(!WA_PHONE_ID) throw new Error('Falta PHONE_NUMBER_ID=133847482683914');
  let clean = String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean;
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{
    method:'POST',
    headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp', to:clean, type:'text', text:{body:text}})
  });
  const j = await r.json(); if(!r.ok){ console.error('WA ERROR', j); throw new Error(j.error?.message||'Error WA'); }
  return j;
}
async function sendTemplateReal(to, templateName){
  let clean = String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean;
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{
    method:'POST',
    headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp', to:clean, type:'template', template:{name:templateName, language:{code:'es_CO'}}})
  });
  return await r.json();
}

async function ensureTables(){
  try{
    await pool.query(`CREATE TABLE IF NOT EXISTS users(agency_id TEXT, username TEXT, password_hash TEXT, role TEXT, display_name TEXT, plan TEXT DEFAULT 'basico', PRIMARY KEY(agency_id,username))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS chats(agency_id TEXT, wa_id TEXT, name TEXT, last_message TEXT, last_message_at BIGINT, unread INT DEFAULT 0, tag TEXT DEFAULT 'nuevo', source TEXT DEFAULT 'direct', PRIMARY KEY(agency_id,wa_id))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, text TEXT, direction TEXT, timestamp BIGINT, sent_by TEXT, campaign_id INT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS password_resets(agency_id TEXT, email TEXT, token TEXT, expires_at BIGINT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_config(agency_id TEXT PRIMARY KEY, enabled BOOLEAN, prompt TEXT, human_takeover BOOLEAN)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS templates(agency_id TEXT, name TEXT, status TEXT, language TEXT, PRIMARY KEY(agency_id,name))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, agency_id TEXT, template TEXT, total INT, sent INT DEFAULT 0, status TEXT DEFAULT 'pending', created_at BIGINT, contacts JSONB)`);
    console.log('>>> Tablas OK');
  }catch(e){ console.error('ensureTables error:', e.message); }
}

app.get('/health', (req,res)=>res.json({ok:true, v:'V6.1 FIX', phoneId:WA_PHONE_ID, wa:!!WA_TOKEN, owner:'3133181851'}));

// WEBHOOK
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

// AUTH
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
    await sendEmail(clean, `KLIDO - Restablecer ${u.agency_id}`, `<h2>KLIDO - Ley 1581</h2><p>Agencia ${u.agency_id}</p><a href="${link}" style="background:#111;color:#fff;padding:14px;border-radius:12px;text-decoration:none">Cambiar clave</a>`);
  }
  res.json({ok:true});
});
app.post('/api/reset-password', async (req,res)=>{
  const {token, newPassword} = req.body; const r = await pool.query(`SELECT * FROM password_resets WHERE token=$1`,[token]);
  if(!r.rows.length) return res.status(400).json({error:'Token invalido'}); if(Date.now() > Number(r.rows[0].expires_at)) return res.status(400).json({error:'Expirado'});
  const hash = await bcrypt.hash(newPassword, 10); await pool.query(`UPDATE users SET password_hash=$1 WHERE LOWER(username)=LOWER($2)`,[hash, r.rows[0].email]);
  await pool.query(`DELETE FROM password_resets WHERE token=$1`,[token]); res.json({ok:true});
});

// ARREGLO DEFINITIVO PARA VOLVERTE JEFE
app.get('/api/hazme-jefe', async (req,res)=>{
  try{
    const {agency_id, username} = req.query;
    if(!agency_id ||!username) return res.json({error:'Usa: /api/hazme-jefe?agency_id=demo&username=TU_EMAIL_REAL', ejemplo:'/api/hazme-jefe?agency_id=demo&username=admin@demo.com'});
    const r = await pool.query(`UPDATE users SET role='jefe', plan='gold' WHERE agency_id=$1 AND LOWER(username)=LOWER($2) RETURNING agency_id,username,role,plan`,[agency_id.toLowerCase(), username.toLowerCase()]);
    if(!r.rows.length){
      const all = await pool.query(`SELECT agency_id,username,role,plan FROM users ORDER BY agency_id LIMIT 20`);
      return res.json({error:'Usuario no encontrado', usuarios_existentes: all.rows, tip:'Crea uno con /api/crear-jefe?agency_id=demo&username=admin@demo.com&password=123456'});
    }
    res.json({ok:true, mensaje:'¡YA ERES JEFE GOLD! Recarga el CRM', usuario: r.rows[0]});
  }catch(e){ res.json({error:e.message}); }
});
app.get('/api/crear-jefe', async (req,res)=>{
  try{
    const {agency_id, username, password} = req.query; if(!agency_id||!username||!password) return res.json({error:'Falta agency_id,username,password'});
    const hash = await bcrypt.hash(password, 10);
    await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,'jefe',$4,'gold') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role='jefe', plan='gold'`,[agency_id.toLowerCase(), username.toLowerCase(), hash, username]);
    res.json({ok:true, mensaje:'Jefe creado', login:{agency_id, username, password}});
  }catch(e){ res.json({error:e.message}); }
});

// CHATS con punto rojo/amarillo
app.get('/api/chats', async (req,res)=>{
  const {agency_id, filter} = req.query;
  let q = `SELECT *, CASE WHEN unread>0 THEN 'red' WHEN source='campaign' THEN 'yellow' ELSE 'online' END as status_dot FROM chats WHERE agency_id=$1`;
  if(filter==='unanswered') q+=` AND unread>0`; if(filter==='campaign') q+=` AND source='campaign'`;
  q+=` ORDER BY last_message_at DESC LIMIT 400`;
  const r=await pool.query(q,[agency_id]); res.json(r.rows);
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

// EQUIPO
app.get('/api/team', async (req,res)=>{ const r=await pool.query(`SELECT agency_id,username,role,display_name,plan FROM users WHERE agency_id=$1`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/team/create', async (req,res)=>{
  const {agency_id,username,password,display_name,role_req} = req.body;
  const check = await pool.query(`SELECT role FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2)`,[agency_id, role_req.toLowerCase()]);
  if(!check.rows.length ||!['jefe','admin'].includes(check.rows[0].role)) return res.status(403).json({error:'Solo jefe/admin puede crear trabajadores'});
  const hash=await bcrypt.hash(password,10);
  await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name) VALUES($1,$2,$3,'trabajador',$4) ON CONFLICT DO NOTHING`,[agency_id.toLowerCase(), username.toLowerCase(), hash, display_name]);
  res.json({ok:true});
});
app.post('/api/team/delete', async (req,res)=>{ await pool.query(`DELETE FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2) AND role='trabajador'`,[req.body.agency_id, req.body.username]); res.json({ok:true}); });

// TEMPLATES / CAMPAÑAS
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

// IA GOLD / PLANES / LEGAL
app.get('/api/ai-config', async (req,res)=>{
  const r=await pool.query(`SELECT * FROM ai_config WHERE agency_id=$1`,[req.query.agency_id]); const plan = await pool.query(`SELECT plan FROM users WHERE agency_id=$1 LIMIT 1`,[req.query.agency_id]);
  const isGold = (plan.rows[0]?.plan||'').toLowerCase()==='gold'; res.json({... (r.rows[0]||{enabled:false,prompt:'',human_takeover:true}), isGold, owner:'3133181851'});
});
app.post('/api/ai-config', async (req,res)=>{
  const {agency_id,enabled,prompt,human_takeover} = req.body; const plan = await pool.query(`SELECT plan FROM users WHERE agency_id=$1 LIMIT 1`,[agency_id]);
  if(!plan.rows.length || plan.rows[0].plan!=='gold') return res.status(403).json({error:'Solo Gold - 3133181851'});
  await pool.query(`INSERT INTO ai_config(agency_id,enabled,prompt,human_takeover) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id) DO UPDATE SET enabled=$2,prompt=$3,human_takeover=$4`,[agency_id,enabled,prompt,human_takeover]); res.json({ok:true});
});
app.get('/api/plans', (req,res)=>res.json([
  {id:'basico', name:'Básico', price:800000, maintenance:80000, wa:'https://wa.me/573133181851?text=Plan%20Basico'},
  {id:'premium', name:'Premium', price:1300000, maintenance:95000, wa:'https://wa.me/573133181851?text=Plan%20Premium'},
  {id:'gold', name:'Gold IA', price:2400000, maintenance:130000, wa:'https://wa.me/573133181851?text=Plan%20Gold'}
]));
app.get('/api/legal', (req,res)=>res.json({ley1581:true, owner:'3133181851', phoneId:WA_PHONE_ID}));

// START FIXED PARA RAILWAY
const PORT = process.env.PORT || 3000;
(async()=>{
  await ensureTables();
  app.listen(PORT, '0.0.0.0', ()=>console.log(`🚀 KLIDO V6.1 FIX en ${PORT} - PhoneID:${WA_PHONE_ID} - 0.0.0.0`));
})();
