// server.js V10.8.8 FINAL - V10.8.4 de las 3am INTACTO + Legal + Bloqueo Planes + Código única vez - 3133181851
try{ require('dotenv').config(); }catch(e){}
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
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
  await pool.query(`CREATE TABLE IF NOT EXISTS users(agency_id TEXT, username TEXT, password_hash TEXT, role TEXT, display_name TEXT, plan TEXT DEFAULT 'basico', PRIMARY KEY(agency_id,username))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chats(agency_id TEXT, wa_id TEXT, name TEXT, last_message TEXT, last_message_at BIGINT, unread INT DEFAULT 0, source TEXT DEFAULT 'direct', assigned_to TEXT, PRIMARY KEY(agency_id,wa_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, text TEXT, direction TEXT, timestamp BIGINT, sent_by TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS password_resets(agency_id TEXT, email TEXT, token TEXT, expires_at BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, agency_id TEXT, template TEXT, total INT, sent INT DEFAULT 0, status TEXT DEFAULT 'pending', created_at BIGINT, contacts JSONB)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS templates(agency_id TEXT, name TEXT, status TEXT, language TEXT, PRIMARY KEY(agency_id,name))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_config(agency_id TEXT PRIMARY KEY, enabled BOOLEAN DEFAULT false)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS calls(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, duration INT, note TEXT, created_at BIGINT, created_by TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS activations(agency_id TEXT, email TEXT, plan TEXT, code TEXT, is_used BOOLEAN DEFAULT false, expires_at BIGINT, PRIMARY KEY(agency_id, plan))`);
  console.log('>>> TABLAS V10.8.8 OK - TODO DE LAS 3AM INTACTO');
}

const PLANS = {
  basico: { precio_anual: 800000, mantenimiento: 80000, permite: ['chats','messages'] },
  premium: { precio_anual: 1300000, mantenimiento: 95000, permite: ['chats','messages','campaigns','templates','stats'] },
  gold: { precio_anual: 2400000, mantenimiento: 125000, permite: ['chats','messages','campaigns','templates','stats','ai','calls','workers'] }
};
const WPP_BASE = 'https://wa.me/573133181851?text=Hola%20quiero%20Klido%20Plan%20';

app.get('/api/plans', (req,res)=> res.json([
  {id:'basico', nombre:'Básico', precio_anual:800000, mantenimiento:80000, wpp: WPP_BASE+'BASICO'},
  {id:'premium', nombre:'Premium', precio_anual:1300000, mantenimiento:95000, wpp: WPP_BASE+'PREMIUM'},
  {id:'gold', nombre:'Gold', precio_anual:2400000, mantenimiento:125000, wpp: WPP_BASE+'GOLD'},
]));

app.post('/api/plans/request-code', async (req,res)=>{
  const ag=(req.body.agency_id||'').toLowerCase().trim();
  const email=(req.body.email||'').toLowerCase().trim();
  const plan=(req.body.plan||'basico').toLowerCase().trim();
  const code=Math.floor(100000+Math.random()*900000).toString();
  const expires=Date.now()+1000*60*60*24;
  await pool.query(`INSERT INTO activations(agency_id,email,plan,code,is_used,expires_at) VALUES($1,$2,$3,$4,false,$5) ON CONFLICT(agency_id,plan) DO UPDATE SET email=$2, code=$4, is_used=false, expires_at=$5`, [ag,email,plan,code,expires]);
  res.json({ok:true, code});
});

app.post('/api/plans/activate', async (req,res)=>{
  const ag=(req.body.agency_id||'').toLowerCase().trim();
  const email=(req.body.email||'').toLowerCase().trim();
  const code=(req.body.code||'').trim();
  const plan=(req.body.plan||'').toLowerCase().trim();
  const r=await pool.query(`SELECT * FROM activations WHERE agency_id=$1 AND LOWER(email)=LOWER($2) AND code=$3 AND plan=$4`, [ag,email,code,plan]);
  if(!r.rows.length) return res.status(400).json({error:'Código incorrecto o no es para ese plan. Solo desbloquea el plan que pagaste.'});
  if(Date.now()>Number(r.rows[0].expires_at)) return res.status(400).json({error:'Código expirado'});
  await pool.query(`UPDATE users SET plan=$1 WHERE agency_id=$2`, [plan, ag]);
  await pool.query(`UPDATE activations SET is_used=true WHERE agency_id=$1 AND plan=$2`, [ag,plan]);
  res.json({ok:true, plan, msg:`Plan ${plan.toUpperCase()} desbloqueado. Solo ese plan queda activo.`});
});

async function checkPlan(ag, feature){
  try{ const r=await pool.query(`SELECT plan FROM users WHERE agency_id=$1 AND role='jefe' LIMIT 1`, [ag.toLowerCase()]); const plan=(r.rows[0]?.plan||'basico').toLowerCase(); return (PLANS[plan]?.permite||PLANS.basico.permite).includes(feature); }catch{return true;}
}

app.get('/health',(req,res)=>res.json({ok:true, v:'V10.8.8', msg:'Klido Avanza Consulting - El mejor CRM para tu empresa'}));

app.get('/legal', (req,res)=>{
  const fp = path.join(__dirname,'public','legal.html');
  if(fs.existsSync(fp)) return res.sendFile(fp);
  res.send(`<h1>Klido Avanza Consulting - Legal</h1><p>API Oficial Meta - Soporte 24/7 3133181851 - Ley 1581 de 2012</p>`);
});

app.post('/api/login',async(req,res)=>{
  try{
    const ag=(req.body.agency_id||'').toLowerCase().trim();
    const u=(req.body.username||req.body.email||'').toLowerCase().trim();
    const pw=req.body.password||'';
    const r=await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2)`, [ag, u]);
    if(!r.rows.length) return res.status(401).json({error:'No existe '+u+' en empresa '+ag});
    const ok=await bcrypt.compare(pw, r.rows[0].password_hash);
    if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
    res.json({agency_id:r.rows[0].agency_id, username:r.rows[0].username, role:r.rows[0].role, plan:r.rows[0].plan, display_name:r.rows[0].display_name});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/crear-jefe', async (req,res)=>{
  try{
    const agency_id=(req.query.agency_id||'').toLowerCase().trim();
    const username=(req.query.username||'').toLowerCase().trim();
    const password=req.query.password||'';
    const name=req.query.name||username;
    const finalPlan=(req.query.plan||'basico').toLowerCase().trim();
    if(!agency_id||!username||!password) return res.json({ok:false, error:'Falta datos'});
    const hash=await bcrypt.hash(password,10);
    await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,'jefe',$4,$5) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role='jefe', display_name=$4, plan=$5`, [agency_id, username, hash, name, finalPlan]);
    res.json({ok:true, plan:finalPlan});
  }catch(e){ res.json({ok:false, error:e.message}); }
});

app.post('/api/forgot-password', async (req,res)=>{
  const clean=(req.body.email||'').trim().toLowerCase();
  const users=await pool.query(`SELECT agency_id FROM users WHERE LOWER(username)=LOWER($1)`, [clean]);
  if(!users.rows.length) return res.status(404).json({error:'Correo no registrado'});
  const code=Math.floor(100000+Math.random()*900000).toString();
  const expires=Date.now()+1000*60*15;
  for(let u of users.rows){
    await pool.query(`DELETE FROM password_resets WHERE LOWER(email)=LOWER($1)`, [clean]);
    await pool.query(`INSERT INTO password_resets(agency_id,email,token,expires_at) VALUES($1,$2,$3,$4)`, [u.agency_id, clean, code, expires]);
  }
  res.json({ok:true, code:code});
});

app.post('/api/reset-password', async (req,res)=>{
  const token=(req.body.token||'').trim();
  const clean=(req.body.email||'').trim().toLowerCase();
  const np=req.body.newPassword||'';
  const r=await pool.query(`SELECT * FROM password_resets WHERE token=$1 AND LOWER(email)=LOWER($2) ORDER BY expires_at DESC LIMIT 1`, [token, clean]);
  if(!r.rows.length) return res.status(400).json({error:'Código incorrecto'});
  if(Date.now()>Number(r.rows[0].expires_at)) return res.status(400).json({error:'Código expirado'});
  const hash=await bcrypt.hash(np,10);
  await pool.query(`UPDATE users SET password_hash=$1 WHERE LOWER(username)=LOWER($2)`, [hash, clean]);
  await pool.query(`DELETE FROM password_resets WHERE LOWER(email)=LOWER($1)`, [clean]);
  res.json({ok:true});
});

app.get('/api/chats',async(req,res)=>{
  const ag=(req.query.agency_id||'').toLowerCase().trim();
  if(!ag) return res.json([]);
  if(!(await checkPlan(ag,'chats'))) return res.status(403).json({error:'Tu plan no permite inbox'});
  const r=await pool.query(`SELECT * FROM chats WHERE agency_id=$1 ORDER BY last_message_at DESC LIMIT 400`, [ag]);
  res.json(r.rows);
});
app.get('/api/messages/:wa_id',async(req,res)=>{
  const r=await pool.query(`SELECT * FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY timestamp ASC LIMIT 1000`, [req.query.agency_id, req.params.wa_id]);
  res.json(r.rows);
});
app.post('/api/messages/send',async(req,res)=>{
  const ag=(req.body.agency_id||'').toLowerCase().trim();
  if(!(await checkPlan(ag,'messages'))) return res.status(403).json({error:'Tu plan no permite mensajes'});
  await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,sent_by) VALUES($1,$2,$3,'out',$4,$5)`, [ag, req.body.wa_id, req.body.text, Date.now(), (req.body.username||'').toLowerCase().trim()]);
  await pool.query(`INSERT INTO chats(agency_id,wa_id,last_message,last_message_at,unread,assigned_to) VALUES($1,$2,$3,$4,0,$5) ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$3,last_message_at=$4,unread=0`, [ag, req.body.wa_id, req.body.text, Date.now(), (req.body.username||'').toLowerCase().trim()]);
  res.json({ok:true});
});
app.get('/api/workers',async(req,res)=>{
  const r=await pool.query(`SELECT agency_id,username,role,display_name,plan FROM users WHERE agency_id=$1 ORDER BY CASE WHEN role='jefe' THEN 0 ELSE 1 END`, [(req.query.agency_id||'').toLowerCase().trim()]);
  res.json(r.rows);
});
app.post('/api/workers',async(req,res)=>{
  const ag=(req.body.agency_id||'').toLowerCase().trim();
  if(!(await checkPlan(ag,'workers'))) return res.status(403).json({error:'Plan básico no permite workers, actualiza a Gold'});
  const em=(req.body.email||'').toLowerCase().trim();
  const hash=await bcrypt.hash(req.body.password||'',10);
  const role=req.body.role==='admin'?'admin':'trabajador';
  const boss=await pool.query(`SELECT plan FROM users WHERE agency_id=$1 AND role='jefe' LIMIT 1`, [ag]);
  const plan=boss.rows[0]?.plan||'basico';
  await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role=$4`, [ag, em, hash, role, em, plan]);
  res.json({ok:true});
});
app.delete('/api/workers/:id',async(req,res)=>{
  await pool.query(`DELETE FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2) AND role!='jefe'`, [(req.query.agency_id||'').toLowerCase().trim(), decodeURIComponent(req.params.id).toLowerCase().trim()]);
  res.json({ok:true});
});
app.get('/api/stats',async(req,res)=>{
  const ag=(req.query.agency_id||'').toLowerCase().trim();
  const boss=await pool.query(`SELECT plan FROM users WHERE agency_id=$1 AND role='jefe' LIMIT 1`, [ag]);
  const total=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1`, [ag]);
  const unread=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND unread>0`, [ag]);
  res.json({totalChats:Number(total.rows[0].count), unread:Number(unread.rows[0].count), currentPlan:boss.rows[0]?.plan||'basico'});
});
function serveIndex(res){
  const p = path.join(__dirname,'public','index.html');
  if(fs.existsSync(p)) return res.sendFile(p);
  return res.status(200).send(`<h1>KLIDO V10.8.8 ONLINE</h1>`);
}
app.get('/', (req,res)=> serveIndex(res));
app.get('*', (req,res)=>{
  if(req.path.startsWith('/api/')||req.path.startsWith('/health')) return res.status(404).json({error:'API no encontrada'});
  return serveIndex(res);
});
const PORT=process.env.PORT||3000;
(async()=>{
  await ensureTables();
  app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 KLIDO V10.8.8 en ${PORT}`));
})();
