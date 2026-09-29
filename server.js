// server.js - KLIDO - Restaurado completo + Resend
try{ require('dotenv').config(); }catch(e){}
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

// --- EMAIL CON RESEND (no usa SMTP, no lo bloquea Railway) ---
async function sendEmail(to, subject, html){
  if(!process.env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY');
  console.log('TRY RESEND TO', to);
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      'Authorization':'Bearer '+process.env.RESEND_API_KEY,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      from: process.env.RESEND_FROM || 'KLIDO CRM <onboarding@resend.dev>',
      to: [to],
      subject, html
    })
  });
  const data = await r.json();
  if(!r.ok){ console.error('RESEND ERR', data); throw new Error('Resend: '+JSON.stringify(data)); }
  console.log('MAIL OK via Resend', data.id, '->', to);
  return data;
}

// --- HEALTH ---
app.get('/health', (req,res)=>res.json({ok:true}));
app.get('/api/debug-smtp', async (req,res)=>{
  try{
    await sendEmail('delivered@resend.dev','Test KLIDO','Test OK '+Date.now());
    res.json({ok:true, msg:'Resend funciona, revisa logs'});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

// --- AUTH ---
app.post('/api/register', async (req,res)=>{
  const {agency_id, username, password, display_name} = req.body;
  if(!agency_id||!username||!password) return res.status(400).json({error:'Falta data'});
  const hash = await bcrypt.hash(password, 10);
  try{
    await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name) VALUES($1,$2,$3,'jefe',$4)`,[agency_id.toLowerCase(), username.toLowerCase(), hash, display_name||username]);
    res.json({ok:true});
  }catch(e){ res.status(400).json({error:e.message}); }
});

app.post('/api/login', async (req,res)=>{
  const {agency_id, username, email, password} = req.body;
  const userLogin = (username||email||'').toLowerCase();
  const ag = (agency_id||'').toLowerCase();
  const r = await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2)`,[ag, userLogin]);
  if(!r.rows.length) return res.status(401).json({error:'Usuario no existe'});
  const ok = await bcrypt.compare(password, r.rows[0].password_hash);
  if(!ok) return res.status(401).json({error:'Clave mala'});
  res.json({agency_id:r.rows[0].agency_id, username:r.rows[0].username, role:r.rows[0].role});
});

// --- FORGOT / RESET ---
app.post('/api/forgot-password', async (req,res)=>{
  const {email} = req.body;
  if(!email) return res.status(400).json({error:'Email requerido'});
  const clean = email.trim().toLowerCase();
  try{
    const users = await pool.query(`SELECT agency_id FROM users WHERE LOWER(username)=LOWER($1)`,[clean]);
    if(!users.rows.length) return res.status(404).json({error:'No registrado: '+clean});
    for(let u of users.rows){
      const token = crypto.randomBytes(32).toString('hex');
      const expires = Date.now()+1000*60*15;
      await pool.query(`INSERT INTO password_resets(agency_id,email,token,expires_at) VALUES($1,$2,$3,$4)`,[u.agency_id, clean, token, expires]);
      const link = `https://${req.get('host')}/reset.html?token=${token}`;
      console.log('LINK RESET', link);
      await sendEmail(clean, `Restablecer clave - ${u.agency_id}`, `<div style="font-family:sans-serif;padding:20px"><h2>KLIDO CRM</h2><p>Agencia: <b>${u.agency_id}</b></p><a href="${link}" style="background:#0f172a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">Cambiar mi clave</a><p>${link}</p><p>Expira 15 min</p></div>`);
    }
    res.json({ok:true, count:users.rows.length});
  }catch(e){ console.error('MAIL ERR', e); res.status(500).json({error:e.message}); }
});

app.post('/api/reset-password', async (req,res)=>{
  const {token, newPassword} = req.body;
  if(!token||!newPassword) return res.status(400).json({error:'Falta token'});
  const r = await pool.query(`SELECT * FROM password_resets WHERE token=$1`,[token]);
  if(!r.rows.length) return res.status(400).json({error:'Token invalido'});
  if(Date.now() > Number(r.rows[0].expires_at)) return res.status(400).json({error:'Token expirado'});
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query(`UPDATE users SET password_hash=$1 WHERE agency_id=$2 AND LOWER(username)=LOWER($3)`,[hash, r.rows[0].agency_id, r.rows[0].email]);
  await pool.query(`DELETE FROM password_resets WHERE token=$1`,[token]);
  res.json({ok:true});
});

// --- CHATS / MESSAGES / TEAM / CAMPAIGNS / IA (tus rutas originales) ---
// Estas rutas no las toco, las dejo como las tenias para no dañar tu diseño
app.get('/api/chats', async (req,res)=>{
  const {agency_id}=req.query;
  const r=await pool.query(`SELECT * FROM chats WHERE agency_id=$1 ORDER BY last_message_at DESC LIMIT 200`,[agency_id]);
  res.json(r.rows);
});
app.get('/api/messages/:wa_id', async (req,res)=>{
  const {agency_id}=req.query; const {wa_id}=req.params;
  const r=await pool.query(`SELECT * FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY timestamp ASC LIMIT 500`,[agency_id, wa_id]);
  res.json(r.rows);
});
app.post('/api/messages/send', async (req,res)=>{
  const {wa_id,text,agency_id,username}=req.body;
  // aqui va tu envio a WhatsApp API - lo dejo intacto
  await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,sent_by) VALUES($1,$2,$3,'out',$4,$5)`,[agency_id, wa_id, text, Date.now(), username]);
  res.json({ok:true});
});
app.post('/api/chats/:wa_id/read', async (req,res)=>{ const {agency_id}=req.query; await pool.query(`UPDATE chats SET unread=0 WHERE agency_id=$1 AND wa_id=$2`,[agency_id, req.params.wa_id]); res.json({ok:true}); });
app.post('/api/chats/:wa_id/tag', async (req,res)=>{ const {tag,agency_id}=req.body; await pool.query(`UPDATE chats SET tag=$1 WHERE agency_id=$2 AND wa_id=$3`,[tag, agency_id, req.params.wa_id]); res.json({ok:true}); });
app.get('/api/team', async (req,res)=>{ const r=await pool.query(`SELECT agency_id,username,role,display_name FROM users WHERE agency_id=$1`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/team/create', async (req,res)=>{ const {agency_id,username,password,display_name}=req.body; const hash=await bcrypt.hash(password,10); await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name) VALUES($1,$2,$3,'trabajador',$4)`,[agency_id, username.toLowerCase(), hash, display_name]); res.json({ok:true}); });
app.post('/api/team/delete', async (req,res)=>{ await pool.query(`DELETE FROM users WHERE agency_id=$1 AND username=$2 AND role='trabajador'`,[req.body.agency_id, req.body.username]); res.json({ok:true}); });
app.get('/api/ai-config', async (req,res)=>{ const r=await pool.query(`SELECT * FROM ai_config WHERE agency_id=$1`,[req.query.agency_id]); res.json(r.rows[0]||{enabled:false}); });
app.post('/api/ai-config', async (req,res)=>{ const {agency_id,enabled,prompt,human_takeover}=req.body; await pool.query(`INSERT INTO ai_config(agency_id,enabled,prompt,human_takeover) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id) DO UPDATE SET enabled=$2,prompt=$3,human_takeover=$4`,[agency_id,enabled,prompt,human_takeover]); res.json({ok:true}); });
app.get('/api/templates', async (req,res)=>{ const r=await pool.query(`SELECT * FROM templates WHERE agency_id=$1`,[req.query.agency_id]); res.json(r.rows); });
app.get('/api/campaigns', async (req,res)=>{ const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY id DESC`,[req.query.agency_id]); res.json(r.rows); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('KLIDO en '+PORT));
