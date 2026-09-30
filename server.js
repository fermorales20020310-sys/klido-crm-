// server.js V10.8.3 - FIX DEFINITIVO transformParamRef - AVANZA CONSULTING
try{ require('dotenv').config(); }catch(e){}
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const app = express();
app.use(express.json({limit:'30mb'}));
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname,'public')));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

async function ensureTables(){
  await pool.query(CREATE TABLE IF NOT EXISTS users(agency_id TEXT, username TEXT, password_hash TEXT, role TEXT, display_name TEXT, plan TEXT DEFAULT 'premium', PRIMARY KEY(agency_id,username)));
  await pool.query(ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'premium');
  await pool.query(ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT);
  await pool.query(CREATE TABLE IF NOT EXISTS chats(agency_id TEXT, wa_id TEXT, name TEXT, last_message TEXT, last_message_at BIGINT, unread INT DEFAULT 0, source TEXT DEFAULT 'direct', assigned_to TEXT, PRIMARY KEY(agency_id,wa_id)));
  await pool.query(ALTER TABLE chats ADD COLUMN IF NOT EXISTS assigned_to TEXT);
  await pool.query(ALTER TABLE chats ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'direct');
  await pool.query(CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, text TEXT, direction TEXT, timestamp BIGINT, sent_by TEXT));
  await pool.query(CREATE TABLE IF NOT EXISTS password_resets(agency_id TEXT, email TEXT, token TEXT, expires_at BIGINT));
  await pool.query(CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, agency_id TEXT, template TEXT, total INT, sent INT DEFAULT 0, status TEXT DEFAULT 'pending', created_at BIGINT, contacts JSONB));
  await pool.query(CREATE TABLE IF NOT EXISTS templates(agency_id TEXT, name TEXT, status TEXT, language TEXT, PRIMARY KEY(agency_id,name)));
  await pool.query(CREATE TABLE IF NOT EXISTS ai_config(agency_id TEXT PRIMARY KEY, enabled BOOLEAN DEFAULT false));
  await pool.query(CREATE TABLE IF NOT EXISTS calls(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, duration INT, note TEXT, created_at BIGINT, created_by TEXT));
  console.log('>>> TABLAS V10.8.3 OK');
}

app.get('/health',(req,res)=>res.json({ok:true, v:'V10.8.3'}));

app.post('/api/login',async(req,res)=>{
  try{
    const ag = (req.body.agency_id||'').toLowerCase().trim();
    const u = (req.body.username||req.body.email||'').toLowerCase().trim();
    const pw = req.body.password||'';
    console.log('LOGIN ->', ag, u);
    const r = await pool.query(SELECT * FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2), [ag, u]);
    if(!r.rows.length) return res.status(401).json({error:'No existe '+u+' en empresa '+ag});
    const ok = await bcrypt.compare(pw, r.rows[0].password_hash);
    if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
    res.json({agency_id:r.rows[0].agency_id, username:r.rows[0].username, role:r.rows[0].role, plan:r.rows[0].plan, display_name:r.rows[0].display_name});
  }catch(e){ console.error('LOGIN ERR', e); res.status(500).json({error:e.message}); }
});

app.get('/api/crear-jefe', async (req,res)=>{
  try{
    const agency_id=(req.query.agency_id||'').toLowerCase().trim();
    const username=(req.query.username||'').toLowerCase().trim();
    const password=req.query.password||'';
    const name=req.query.name||username;
    const finalPlan=(req.query.plan||'premium').toLowerCase().trim();
    if(!agency_id||!username||!password) return res.json({ok:false, error:'Falta datos'});
    const hash=await bcrypt.hash(password,10);
    await pool.query(INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,'jefe',$4,$5) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role='jefe', display_name=$4, plan=$5, [agency_id, username, hash, name, finalPlan]);
    res.json({ok:true, plan:finalPlan});
  }catch(e){ res.json({ok:false, error:e.message}); }
});

app.post('/api/forgot-password', async (req,res)=>{
  try{
    const clean=(req.body.email||'').trim().toLowerCase();
    const users=await pool.query(SELECT agency_id FROM users WHERE LOWER(username)=LOWER($1), [clean]);
    if(!users.rows.length) return res.status(404).json({error:'Correo no registrado'});
    const code=Math.floor(100000+Math.random()*900000).toString();
    const expires=Date.now()+1000*60*15;
    for(let u of users.rows){
      await pool.query(DELETE FROM password_resets WHERE LOWER(email)=LOWER($1), [clean]);
      await pool.query(INSERT INTO password_resets(agency_id,email,token,expires_at) VALUES($1,$2,$3,$4), [u.agency_id, clean, code, expires]);
    }
    res.json({ok:true, code:code});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/reset-password', async (req,res)=>{
  try{
    const token=(req.body.token||'').trim();
    const clean=(req.body.email||'').trim().toLowerCase();
    const np=req.body.newPassword||'';
    const r=await pool.query(SELECT * FROM password_resets WHERE token=$1 AND LOWER(email)=LOWER($2) ORDER BY expires_at DESC LIMIT 1, [token, clean]);
    if(!r.rows.length) return res.status(400).json({error:'Código incorrecto'});
    if(Date.now()>Number(r.rows[0].expires_at)) return res.status(400).json({error:'Código expirado'});
    const hash=await bcrypt.hash(np,10);
    await pool.query(UPDATE users SET password_hash=$1 WHERE LOWER(username)=LOWER($2), [hash, clean]);
    await pool.query(DELETE FROM password_resets WHERE LOWER(email)=LOWER($1), [clean]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/chats',async(req,res)=>{
  const ag=(req.query.agency_id||'').toLowerCase().trim(); if(!ag) return res.json([]);
  const worker=(req.query.worker||'').toLowerCase().trim();
  if(worker && worker!=='undefined' && worker!==''){
    const r=await pool.query(SELECT * FROM chats WHERE agency_id=$1 AND (assigned_to=$2 OR wa_id IN (SELECT wa_id FROM messages WHERE agency_id=$1 AND sent_by=$2)) ORDER BY last_message_at DESC LIMIT 200, [ag, worker]);
    return res.json(r.rows);
  }
  const r=await pool.query(SELECT * FROM chats WHERE agency_id=$1 ORDER BY last_message_at DESC LIMIT 400, [ag]); res.json(r.rows);
});
app.get('/api/messages/:wa_id',async(req,res)=>{ const r=await pool.query(SELECT * FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY timestamp ASC LIMIT 1000, [req.query.agency_id, req.params.wa_id]); res.json(r.rows); });
app.post('/api/messages/send',async(req,res)=>{
  const ag=(req.body.agency_id||'').toLowerCase().trim(); const wa_id=req.body.wa_id; const text=req.body.text; const user=(req.body.username||'').toLowerCase().trim();
  await pool.query(INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,sent_by) VALUES($1,$2,$3,'out',$4,$5), [ag, wa_id, text, Date.now(), user]);
  await pool.query(INSERT INTO chats(agency_id,wa_id,last_message,last_message_at,unread,assigned_to) VALUES($1,$2,$3,$4,0,$5) ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$3,last_message_at=$4,unread=0,assigned_to=COALESCE(chats.assigned_to,$5), [ag, wa_id, text, Date.now(), user]);
  res.json({ok:true});
});
app.post('/api/chats/read',async(req,res)=>{ await pool.query(UPDATE chats SET unread=0 WHERE agency_id=$1 AND wa_id=$2, [req.body.agency_id, req.body.wa_id]); res.json({ok:true}); });
app.get('/api/workers',async(req,res)=>{ const ag=(req.query.agency_id||'').toLowerCase().trim(); const r=await pool.query(SELECT agency_id,username,role,display_name,plan FROM users WHERE agency_id=$1 ORDER BY CASE WHEN role='jefe' THEN 0 ELSE 1 END, [ag]); res.json(r.rows); });
app.post('/api/workers',async(req,res)=>{
  const ag=(req.body.agency_id||'').toLowerCase().trim(); const em=(req.body.email||'').toLowerCase().trim(); const pw=req.body.password||''; const role=req.body.role==='admin'?'admin':'trabajador';
  const hash=await bcrypt.hash(pw,10);
  const boss=await pool.query(SELECT plan FROM users WHERE agency_id=$1 AND role='jefe' LIMIT 1, [ag]); const plan=boss.rows[0]?.plan||'premium';
  await pool.query(INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role=$4, [ag, em, hash, role, em, plan]); res.json({ok:true});
});
app.delete('/api/workers/:id',async(req,res)=>{ const ag=(req.query.agency_id||'').toLowerCase().trim(); const id=decodeURIComponent(req.params.id).toLowerCase().trim(); await pool.query(DELETE FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2) AND role!='jefe', [ag, id]); res.json({ok:true}); });
app.get('/api/stats',async(req,res)=>{
  const ag=(req.query.agency_id||'').toLowerCase().trim();
  const boss=await pool.query(SELECT plan FROM users WHERE agency_id=$1 AND role='jefe' LIMIT 1, [ag]);
  const total=await pool.query(SELECT COUNT(*) FROM chats WHERE agency_id=$1, [ag]);
  const unread=await pool.query(SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND unread>0, [ag]);
  const camp=await pool.query(SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND source='campaign', [ag]);
  const today=await pool.query(SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND timestamp>$2, [ag, Date.now()-86400000]);
  const ia=await pool.query(SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND sent_by='IA', [ag]);
  const calls=await pool.query(SELECT COUNT(*) FROM calls WHERE agency_id=$1, [ag]);
  res.json({today:Number(today.rows[0].count), unread:Number(unread.rows[0].count), campaign:Number(camp.rows[0].count), ia:Number(ia.rows[0].count), calls:Number(calls.rows[0].count), totalChats:Number(total.rows[0].count), currentPlan:boss.rows[0]?.plan||'premium'});
});
app.get('/api/ai/config',async(req,res)=>{ const r=await pool.query(SELECT enabled FROM ai_config WHERE agency_id=$1, [req.query.agency_id]); res.json({enabled: r.rows[0]?.enabled||false}); });
app.post('/api/ai/toggle',async(req,res)=>{ await pool.query(INSERT INTO ai_config(agency_id,enabled) VALUES($1,$2) ON CONFLICT(agency_id) DO UPDATE SET enabled=$2, [req.body.agency_id, req.body.enabled]); res.json({ok:true}); });
app.post('/api/calls/log',async(req,res)=>{ await pool.query(INSERT INTO calls(agency_id,wa_id,duration,note,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6), [req.body.agency_id, req.body.wa_id, req.body.duration||0, req.body.note||'', Date.now(), req.body.username||'']); res.json({ok:true}); });
app.get('/api/calls',async(req,res)=>{ const r=await pool.query(SELECT * FROM calls WHERE agency_id=$1 ORDER BY id DESC LIMIT 100, [req.query.agency_id]); res.json(r.rows); });

const PORT=process.env.PORT||3000;
(async()=>{ await ensureTables(); app.listen(PORT,'0.0.0.0',()=>console.log(🚀 KLIDO V10.8.3 FIX REAL en ${PORT})); })();
