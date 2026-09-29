// server.js - KLIDO V10.8 AVANZA CONSULTING - PLAN AL CREAR + IA + LLAMADAS
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
app.get('/campañas.html',(req,res)=>res.redirect(301,'/campanas.html'));
app.get('/campa%C3%B1as.html',(req,res)=>res.redirect(301,'/campanas.html'));
app.use(express.static(path.join(__dirname,'public')));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const WA_TOKEN = (process.env.WHATSAPP_TOKEN||'').trim();
const WA_PHONE_ID = (process.env.WHATSAPP_PHONE_ID || process.env.PHONE_NUMBER_ID || '').trim();
const WABA_ID = (process.env.WABA_ID||'').trim();
const WA_VERIFY = (process.env.WHATSAPP_VERIFY_TOKEN || 'klido123').trim();

async function sendEmail(to, subject, html){
  if(!process.env.RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY');
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({ from: process.env.RESEND_FROM || 'KLIDO <onboarding@resend.dev>', to:[to], subject, html })
  });
  const data = await r.json(); if(!r.ok) throw new Error(JSON.stringify(data)); return data;
}
async function sendWhatsappReal(to,text){
  let clean = String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean;
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{method:'POST',headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:clean,type:'text',text:{body:text}})});
  const j=await r.json(); if(!r.ok) throw new Error(j.error?.message); return j;
}
async function sendTemplateReal(to,template){
  let clean = String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean; if(clean.length<10) return {error:'corto'};
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{method:'POST',headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:clean,type:'template',template:{name:template,language:{code:'es_CO'}}})});
  return await r.json();
}
async function ensureTables(){
  await pool.query(`CREATE TABLE IF NOT EXISTS users(agency_id TEXT, username TEXT, password_hash TEXT, role TEXT, display_name TEXT, plan TEXT DEFAULT 'basico', PRIMARY KEY(agency_id,username))`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'premium'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chats(agency_id TEXT, wa_id TEXT, name TEXT, last_message TEXT, last_message_at BIGINT, unread INT DEFAULT 0, tag TEXT DEFAULT 'nuevo', source TEXT DEFAULT 'direct', assigned_to TEXT, PRIMARY KEY(agency_id,wa_id))`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS assigned_to TEXT`);
  await pool.query(`ALTER TABLE chats ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'direct'`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, text TEXT, direction TEXT, timestamp BIGINT, sent_by TEXT, campaign_id INT, media_url TEXT, media_type TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS password_resets(agency_id TEXT, email TEXT, token TEXT, expires_at BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS templates(agency_id TEXT, name TEXT, status TEXT, language TEXT, PRIMARY KEY(agency_id,name))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, agency_id TEXT, template TEXT, total INT, sent INT DEFAULT 0, status TEXT DEFAULT 'pending', created_at BIGINT, contacts JSONB)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ai_config(agency_id TEXT PRIMARY KEY, enabled BOOLEAN DEFAULT false)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS calls(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, duration INT, note TEXT, created_at BIGINT, created_by TEXT)`);
  console.log('>>> TABLAS V10.8 OK - PLAN AL CREAR');
}
async function aiReply(text){
  const t = (text||'').toLowerCase();
  if(t.includes('precio')||t.includes('costo')||t.includes('cuanto')) return '¡Hola! En Avanza Consulting: Básico $800k + $80k mant/3m, Premium $1.3M + $95k (con IA), Gold $2.4M + $125k (IA + llamadas). ¿Cuál te interesa? - IA';
  if(t.includes('hola')||t.includes('buenas')) return '¡Hola! Soy asistente de Avanza Consulting 🤖 ¿En qué te ayudo? - IA';
  return 'Gracias por escribir a Avanza Consulting, un asesor te responderá pronto. Soporte 24/7: 3133181851 - IA';
}
app.get('/health',(req,res)=>res.json({ok:true, v:'V10.8 PLAN+IA+CALLS', owner:'3133181851'}));
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']===WA_VERIFY) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/webhook',async(req,res)=>{
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value; const msg=val?.messages?.[0];
    if(msg){
      const wa_id=msg.from; let text=msg.text?.body||'Hola'; let media_type=null;
      if(msg.image){text='📷 Foto'; media_type='image';} if(msg.video){text='🎥 Video'; media_type='video';} if(msg.audio||msg.voice){text='🎤 Audio'; media_type='audio';} if(msg.document){text='📄 Documento'; media_type='document';}
      const name=val.contacts?.[0]?.profile?.name||wa_id; let agency_id='acol';
      try{ const ag=await pool.query(`SELECT agency_id FROM users WHERE role='jefe' LIMIT 1`); if(ag.rows.length) agency_id=ag.rows[0].agency_id; }catch(e){}
      await pool.query(`INSERT INTO chats(agency_id,wa_id,name,last_message,last_message_at,unread,source) VALUES($1,$2,$3,$4,$5,1,'direct') ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$4,last_message_at=$5,unread=chats.unread+1,name=$3`,[agency_id,wa_id,name,text,Date.now()]);
      await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,media_type) VALUES($1,$2,$3,'in',$4,$5)`,[agency_id,wa_id,text,Date.now(),media_type]);
      try{
        const cfg=await pool.query(`SELECT enabled FROM ai_config WHERE agency_id=$1`,[agency_id]);
        const usr=await pool.query(`SELECT plan FROM users WHERE agency_id=$1 ORDER BY CASE WHEN role='jefe' THEN 0 ELSE 1 END LIMIT 1`,[agency_id]);
        const plan=(usr.rows[0]?.plan||'basico').toLowerCase();
        if(cfg.rows[0]?.enabled && (plan.includes('premium') || plan.includes('gold'))){
          const reply=await aiReply(text);
          setTimeout(async()=>{
            const lastOut=await pool.query(`SELECT timestamp FROM messages WHERE agency_id=$1 AND wa_id=$2 AND direction='out' ORDER BY timestamp DESC LIMIT 1`,[agency_id, wa_id]);
            if(lastOut.rows.length && Date.now() - Number(lastOut.rows[0].timestamp) < 100000) return;
            await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,sent_by) VALUES($1,$2,$3,'out',$4,'IA')`,[agency_id,wa_id,reply,Date.now()]);
            await pool.query(`UPDATE chats SET last_message=$1, last_message_at=$2 WHERE agency_id=$3 AND wa_id=$4`,[reply,Date.now(),agency_id,wa_id]);
            try{ await sendWhatsappReal(wa_id, reply); }catch(e){}
          }, 120000);
        }
      }catch(e){ console.log('IA err', e.message); }
    }
  }catch(e){} res.sendStatus(200);
});
app.post('/api/login',async(req,res)=>{
  const {agency_id,username,email,password}=req.body; const u=(username||email||'').toLowerCase().trim(); const ag=(agency_id||'').toLowerCase().trim();
  const r=await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2)`,[ag, u]);
  if(!r.rows.length) return res.status(401).json({error:'Credenciales no válidas'});
  const ok=await bcrypt.compare(password,r.rows[0].password_hash); if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
  res.json({agency_id:r.rows[0].agency_id,username:r.rows[0].username,role:r.rows[0].role,display_name:r.rows[0].display_name,plan:r.rows[0].plan});
});
// CREAR JEFE CON PLAN ELEGIDO
app.get('/api/crear-jefe', async (req,res)=>{
  const {agency_id,username,password,name,plan}=req.query;
  if(!agency_id||!username||!password) return res.json({ok:false, error:'Falta datos'});
  const hash=await bcrypt.hash(password,10);
  const display=name||username;
  const finalPlan=(plan||'premium').toLowerCase();
  await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,'jefe',$4,$5) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role='jefe', display_name=$4, plan=$5`,[agency_id.toLowerCase().trim(),username.toLowerCase().trim(),hash,display,finalPlan]);
  res.json({ok:true, plan:finalPlan});
});
app.post('/api/forgot-password', async (req,res)=>{
  const {email}=req.body; const clean=email.trim().toLowerCase();
  const users=await pool.query(`SELECT agency_id FROM users WHERE LOWER(username)=LOWER($1)`,[clean]);
  if(!users.rows.length) return res.status(404).json({error:'Correo no registrado'});
  const code=Math.floor(100000+Math.random()*900000).toString(); const expires=Date.now()+1000*60*15;
  for(let u of users.rows){
    await pool.query(`DELETE FROM password_resets WHERE LOWER(email)=LOWER($1)`,[clean]);
    await pool.query(`INSERT INTO password_resets(agency_id,email,token,expires_at) VALUES($1,$2,$3,$4)`,[u.agency_id,clean,code,expires]);
    const html=`<div style="font-family:Inter,sans-serif;background:#070b18;padding:40px"><div style="max-width:500px;margin:0 auto;background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px"><div style="color:#fff;font-weight:900">KLIDO</div><div style="color:#8aa4ff;font-size:10px">AVANZA CONSULTING</div><h2 style="color:#fff;margin-top:20px">Código: ${code}</h2><p style="color:#94a3b8">Empresa: ${u.agency_id}</p><div style="background:#111c34;border:1px solid #1e2f4f;border-radius:12px;padding:20px;text-align:center;margin:20px 0"><div style="font-size:36px;font-weight:900;letter-spacing:8px;color:#fff">${code}</div></div></div></div>`;
    await sendEmail(clean, `KLIDO Avanza - Código ${code}`, html);
  }
  res.json({ok:true});
});
app.post('/api/reset-password', async (req,res)=>{
  const {token,email,newPassword}=req.body; const clean=email.trim().toLowerCase();
  const r=await pool.query(`SELECT * FROM password_resets WHERE token=$1 AND LOWER(email)=LOWER($2) ORDER BY expires_at DESC LIMIT 1`,[token, clean]);
  if(!r.rows.length) return res.status(400).json({error:'Código incorrecto'}); if(Date.now()>Number(r.rows[0].expires_at)) return res.status(400).json({error:'Código expirado'});
  const hash=await bcrypt.hash(newPassword,10); await pool.query(`UPDATE users SET password_hash=$1 WHERE LOWER(username)=LOWER($2)`,[hash, clean]);
  await pool.query(`DELETE FROM password_resets WHERE LOWER(email)=LOWER($1)`,[clean]); res.json({ok:true});
});
app.get('/api/chats',async(req,res)=>{
  const {agency_id,worker}=req.query; const ag=(agency_id||'').toLowerCase().trim(); if(!ag) return res.json([]);
  if(worker && worker!=='undefined' && worker!==''){ const r=await pool.query(`SELECT * FROM chats WHERE agency_id=$1 AND (assigned_to=$2 OR wa_id IN (SELECT wa_id FROM messages WHERE agency_id=$1 AND sent_by=$2)) ORDER BY last_message_at DESC LIMIT 200`,[ag,worker.toLowerCase().trim()]); return res.json(r.rows); }
  const r=await pool.query(`SELECT * FROM chats WHERE agency_id=$1 ORDER BY last_message_at DESC LIMIT 400`,[ag]); res.json(r.rows);
});
app.get('/api/messages/:wa_id',async(req,res)=>{ const r=await pool.query(`SELECT * FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY timestamp ASC LIMIT 1000`,[req.query.agency_id,req.params.wa_id]); res.json(r.rows); });
app.post('/api/messages/send',async(req,res)=>{
  const {wa_id,text,agency_id,username}=req.body; const ag=agency_id.toLowerCase().trim(); const user=username.toLowerCase().trim();
  await sendWhatsappReal(wa_id,text); await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,sent_by) VALUES($1,$2,$3,'out',$4,$5)`,[ag,wa_id,text,Date.now(),user]);
  await pool.query(`INSERT INTO chats(agency_id,wa_id,last_message,last_message_at,unread,assigned_to) VALUES($1,$2,$3,$4,0,$5) ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$3,last_message_at=$4,unread=0,assigned_to=COALESCE(chats.assigned_to,$5)`,[ag,wa_id,text,Date.now(),user]); res.json({ok:true});
});
app.post('/api/chats/read',async(req,res)=>{ await pool.query(`UPDATE chats SET unread=0 WHERE agency_id=$1 AND wa_id=$2`,[req.body.agency_id,req.body.wa_id]); res.json({ok:true}); });
app.post('/api/chats/:wa_id/read',async(req,res)=>{ const ag=req.query.agency_id||req.body.agency_id; await pool.query(`UPDATE chats SET unread=0 WHERE agency_id=$1 AND wa_id=$2`,[ag,req.params.wa_id]); res.json({ok:true}); });
app.get('/api/workers',async(req,res)=>{ const ag=req.query.agency_id.toLowerCase().trim(); const r=await pool.query(`SELECT agency_id,username,role,display_name,plan, username as id FROM users WHERE agency_id=$1 ORDER BY CASE WHEN role='jefe' THEN 0 ELSE 1 END`,[ag]); res.json(r.rows); });
app.post('/api/workers',async(req,res)=>{
  const {agency_id,email,password,role}=req.body; if(!agency_id||!email||!password) return res.status(400).json({error:'Todos los campos obligatorios'}); if(password.length<6) return res.status(400).json({error:'Mínimo 6'});
  const ag=agency_id.toLowerCase().trim(); const em=email.toLowerCase().trim(); const hash=await bcrypt.hash(password,10); const finalRole=(role==='admin'?'admin':'trabajador');
  const boss=await pool.query(`SELECT plan FROM users WHERE agency_id=$1 AND role='jefe' LIMIT 1`,[ag]); const plan=boss.rows[0]?.plan||'premium';
  await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role=$4`,[ag,em,hash,finalRole,em,plan]); res.json({ok:true});
});
app.delete('/api/workers/:id',async(req,res)=>{ const ag=req.query.agency_id.toLowerCase().trim(); const id=decodeURIComponent(req.params.id).toLowerCase().trim(); const del=await pool.query(`DELETE FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2) AND role!='jefe' RETURNING username`,[ag,id]); if(!del.rows.length) return res.status(404).json({error:'No se puede eliminar jefe'}); res.json({ok:true}); });
app.get('/api/stats',async(req,res)=>{
  const ag=req.query.agency_id.toLowerCase().trim();
  const total=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1`,[ag]);
  const unread=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND unread>0`,[ag]);
  const camp=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND source='campaign'`,[ag]);
  const today=await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND timestamp>$2`,[ag,Date.now()-86400000]);
  const ia=await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND sent_by='IA'`,[ag]);
  const calls=await pool.query(`SELECT COUNT(*) FROM calls WHERE agency_id=$1`,[ag]);
  const boss=await pool.query(`SELECT plan FROM users WHERE agency_id=$1 AND role='jefe' LIMIT 1`,[ag]);
  res.json({totalChats:Number(total.rows[0].count),unread:Number(unread.rows[0].count),campaign:Number(camp.rows[0].count),today:Number(today.rows[0].count),todayMessages:Number(today.rows[0].count),ia:Number(ia.rows[0].count),calls:Number(calls.rows[0].count),currentPlan:boss.rows[0]?.plan||'premium'});
});
app.get('/api/ai/config',async(req,res)=>{ const r=await pool.query(`SELECT enabled FROM ai_config WHERE agency_id=$1`,[req.query.agency_id]); res.json({enabled: r.rows[0]?.enabled || false}); });
app.post('/api/ai/toggle',async(req,res)=>{ const {agency_id, enabled} = req.body; await pool.query(`INSERT INTO ai_config(agency_id,enabled) VALUES($1,$2) ON CONFLICT(agency_id) DO UPDATE SET enabled=$2`,[agency_id, enabled]); res.json({ok:true, enabled}); });
app.post('/api/calls/log',async(req,res)=>{
  const {agency_id, wa_id, duration, note, username} = req.body;
  const u=await pool.query(`SELECT plan FROM users WHERE agency_id=$1 ORDER BY CASE WHEN role='jefe' THEN 0 ELSE 1 END LIMIT 1`,[agency_id]);
  const plan=(u.rows[0]?.plan||'basico').toLowerCase(); if(!plan.includes('gold')) return res.status(403).json({error:'Solo Gold tiene llamadas'});
  await pool.query(`INSERT INTO calls(agency_id,wa_id,duration,note,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6)`,[agency_id, wa_id, duration||0, note||'', Date.now(), username||'']); res.json({ok:true});
});
app.get('/api/calls',async(req,res)=>{ const r=await pool.query(`SELECT * FROM calls WHERE agency_id=$1 ORDER BY id DESC LIMIT 100`,[req.query.agency_id]); res.json(r.rows); });
app.get('/api/templates',async(req,res)=>{ const r=await pool.query(`SELECT * FROM templates WHERE agency_id=$1 AND status='approved' ORDER BY name`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/templates/sync',async(req,res)=>{
  if(!WABA_ID) return res.json({ok:true,count:0}); const resp=await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?fields=name,status&status=APPROVED&limit=100`,{headers:{'Authorization':'Bearer '+WA_TOKEN}}); const j=await resp.json(); let c=0; for(let t of j.data||[]){ await pool.query(`INSERT INTO templates(agency_id,name,status,language) VALUES($1,$2,$3,'es_CO') ON CONFLICT(agency_id,name) DO UPDATE SET status=$3`,[req.query.agency_id,t.name,'approved']); c++; } res.json({ok:true,count:c});
});
app.get('/api/campaigns',async(req,res)=>{ const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY id DESC LIMIT 100`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/campaigns/start',async(req,res)=>{
  const {agency_id,template,contacts}=req.body; if(!contacts?.length) return res.status(400).json({error:'Sin contactos'});
  const uniq=[...new Map(contacts.map(c=>[String(c.wa_id).replace(/\D/g,''),c])).values()].slice(0,5000);
  const result=await pool.query(`INSERT INTO campaigns(agency_id,template,total,sent,created_at,contacts,status) VALUES($1,$2,$3,0,$4,$5,'pending') RETURNING id`,[agency_id,template,uniq.length,Date.now(),JSON.stringify(uniq)]);
  res.json({ok:true,campaign_id:result.rows[0].id});
});
setInterval(async()=>{
  try{
    const pending=await pool.query(`SELECT * FROM campaigns WHERE status!='done' ORDER BY id ASC LIMIT 2`);
    for(let camp of pending.rows){
      const contacts=typeof camp.contacts==='string'?JSON.parse(camp.contacts):camp.contacts; const toSend=contacts.slice(camp.sent,camp.sent+50);
      if(!toSend.length){ await pool.query(`UPDATE campaigns SET status='done' WHERE id=$1`,[camp.id]); continue; }
      for(let c of toSend){ try{ await sendTemplateReal(c.wa_id,camp.template); await pool.query(`INSERT INTO chats(agency_id,wa_id,name,last_message,source,last_message_at) VALUES($1,$2,$3,$4,'campaign',$5) ON CONFLICT(agency_id,wa_id) DO UPDATE SET source='campaign'`,[camp.agency_id,c.wa_id,c.name,'Campaña: '+camp.template,Date.now()]); }catch(e){} await new Promise(r=>setTimeout(r,3000)); }
      await pool.query(`UPDATE campaigns SET sent=sent+$1 WHERE id=$2`,[toSend.length,camp.id]);
    }
  }catch(e){}
}, 1000*60*60*5);
const PORT=process.env.PORT||3000;
(async()=>{ await ensureTables(); app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 KLIDO V10.8 PLAN AL CREAR en ${PORT}`)); })();
