// server.js - KLIDO V9 REAL PRO - SIN DEMO
try{ require('dotenv').config(); }catch(e){}
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(express.json({limit:'30mb'}));
app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS'); res.header('Access-Control-Allow-Headers','Content-Type'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); });
app.get('/campañas.html',(req,res)=>res.redirect(301,'/campanas.html'));
app.get('/campa%C3%B1as.html',(req,res)=>res.redirect(301,'/campanas.html'));
app.use(express.static(path.join(__dirname,'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const WA_TOKEN = (process.env.WHATSAPP_TOKEN||'').trim();
const WA_PHONE_ID = (process.env.WHATSAPP_PHONE_ID||'').trim();
const WABA_ID = (process.env.WABA_ID||'').trim();
const WA_VERIFY = (process.env.WHATSAPP_VERIFY_TOKEN||'klido123').trim();

async function sendWhatsappReal(to,text){
 let clean=String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean;
 const r=await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{method:'POST',headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:clean,type:'text',text:{body:text}})});
 const j=await r.json(); if(!r.ok) throw new Error(j.error?.message); return j;
}
async function sendTemplateReal(to,template){
 let clean=String(to).replace(/\D/g,''); if(clean.length===10) clean='57'+clean;
 const r=await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`,{method:'POST',headers:{'Authorization':'Bearer '+WA_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:clean,type:'template',template:{name:template,language:{code:'es_CO'}}})});
 return await r.json();
}
async function ensureTables(){
 await pool.query(`CREATE TABLE IF NOT EXISTS users(agency_id TEXT, username TEXT, password_hash TEXT, role TEXT, display_name TEXT, plan TEXT DEFAULT 'basico', PRIMARY KEY(agency_id,username))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS chats(agency_id TEXT, wa_id TEXT, name TEXT, last_message TEXT, last_message_at BIGINT, unread INT DEFAULT 0, tag TEXT DEFAULT 'nuevo', source TEXT DEFAULT 'direct', PRIMARY KEY(agency_id,wa_id))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, agency_id TEXT, wa_id TEXT, text TEXT, direction TEXT, timestamp BIGINT, sent_by TEXT, campaign_id INT)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS templates(agency_id TEXT, name TEXT, status TEXT, language TEXT, PRIMARY KEY(agency_id,name))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, agency_id TEXT, template TEXT, total INT, sent INT DEFAULT 0, status TEXT DEFAULT 'pending', created_at BIGINT, contacts JSONB)`);
 console.log('>>> KLIDO REAL PRO TABLAS OK');
}

app.get('/health',(req,res)=>res.json({ok:true,v:'V9 REAL',owner:'3133181851'}));
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']===WA_VERIFY) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/webhook',async(req,res)=>{
 try{
  const val=req.body.entry?.[0]?.changes?.[0]?.value; const msg=val?.messages?.[0];
  if(msg){
   const wa_id=msg.from; const text=msg.text?.body||''; const name=val.contacts?.[0]?.profile?.name||wa_id;
   let agency_id='acol'; try{ const ag=await pool.query(`SELECT agency_id FROM users WHERE role='jefe' LIMIT 1`); if(ag.rows.length) agency_id=ag.rows[0].agency_id; }catch(e){}
   await pool.query(`INSERT INTO chats(agency_id,wa_id,name,last_message,last_message_at,unread) VALUES($1,$2,$3,$4,$5,1) ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$4,last_message_at=$5,unread=chats.unread+1,name=$3`,[agency_id,wa_id,name,text,Date.now()]);
   await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp) VALUES($1,$2,$3,'in',$4)`,[agency_id,wa_id,text,Date.now()]);
  }
 }catch(e){} res.sendStatus(200);
});

app.post('/api/login',async(req,res)=>{
 const {agency_id,username,email,password}=req.body; const u=(username||email||'').toLowerCase(); const ag=(agency_id||'').toLowerCase();
 const r=await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2)`,[ag,u]);
 if(!r.rows.length) return res.status(401).json({error:'Credenciales no válidas'});
 const ok=await bcrypt.compare(password,r.rows[0].password_hash); if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
 res.json({agency_id:r.rows[0].agency_id,username:r.rows[0].username,role:r.rows[0].role,display_name:r.rows[0].display_name,plan:r.rows[0].plan});
});

app.get('/api/chats',async(req,res)=>{ const r=await pool.query(`SELECT * FROM chats WHERE agency_id=$1 ORDER BY last_message_at DESC LIMIT 400`,[req.query.agency_id]); res.json(r.rows); });
app.get('/api/messages/:wa_id',async(req,res)=>{ const r=await pool.query(`SELECT * FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY timestamp ASC LIMIT 1000`,[req.query.agency_id,req.params.wa_id]); res.json(r.rows); });
app.post('/api/messages/send',async(req,res)=>{ try{ const {wa_id,text,agency_id,username}=req.body; await sendWhatsappReal(wa_id,text); await pool.query(`INSERT INTO messages(agency_id,wa_id,text,direction,timestamp,sent_by) VALUES($1,$2,$3,'out',$4,$5)`,[agency_id,wa_id,text,Date.now(),username]); await pool.query(`INSERT INTO chats(agency_id,wa_id,last_message,last_message_at,unread) VALUES($1,$2,$3,$4,0) ON CONFLICT(agency_id,wa_id) DO UPDATE SET last_message=$3,last_message_at=$4,unread=0`,[agency_id,wa_id,text,Date.now()]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/chats/read',async(req,res)=>{ await pool.query(`UPDATE chats SET unread=0 WHERE agency_id=$1 AND wa_id=$2`,[req.body.agency_id,req.body.wa_id]); res.json({ok:true}); });

// TRABAJADORES REAL - SIN DEMO
app.get('/api/workers',async(req,res)=>{
 try{
  const r=await pool.query(`SELECT agency_id,username,role,display_name,plan FROM users WHERE agency_id=$1 ORDER BY role DESC, username ASC`,[req.query.agency_id]);
  res.json(r.rows.map(u=>({...u,id:u.username,chats:0,msgs:0})));
 }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/workers',async(req,res)=>{
 try{
  const {agency_id,email,password,role}=req.body;
  if(!agency_id||!email||!password) return res.status(400).json({error:'Todos los campos son obligatorios'});
  if(password.length<6) return res.status(400).json({error:'La contraseña debe tener mínimo 6 caracteres'});
  const ag=agency_id.toLowerCase().trim(); const em=email.toLowerCase().trim();
  if(!em.includes('@')) return res.status(400).json({error:'Correo corporativo no válido'});
  const hash=await bcrypt.hash(password,10);
  const finalRole=(role==='admin'?'admin':'trabajador');
  await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name,plan) VALUES($1,$2,$3,$4,$5,'basico') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, role=$4`,[ag,em,hash,finalRole,em]);
  res.json({ok:true,username:em});
 }catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/workers/:id',async(req,res)=>{
 const ag=req.query.agency_id; const id=decodeURIComponent(req.params.id);
 await pool.query(`DELETE FROM users WHERE agency_id=$1 AND LOWER(username)=LOWER($2) AND role!='jefe'`,[ag.toLowerCase(),id.toLowerCase()]);
 res.json({ok:true});
});

app.get('/api/stats',async(req,res)=>{
 const {agency_id}=req.query;
 const total=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1`,[agency_id]);
 const unread=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND unread>0`,[agency_id]);
 const camp=await pool.query(`SELECT COUNT(*) FROM chats WHERE agency_id=$1 AND source='campaign'`,[agency_id]);
 const today=await pool.query(`SELECT COUNT(*) FROM messages WHERE agency_id=$1 AND timestamp>$2`,[agency_id,Date.now()-86400000]);
 res.json({totalChats:Number(total.rows[0].count),unread:Number(unread.rows[0].count),campaign:Number(camp.rows[0].count),today:Number(today.rows[0].count),todayMessages:Number(today.rows[0].count)});
});
app.get('/api/templates',async(req,res)=>{ const r=await pool.query(`SELECT * FROM templates WHERE agency_id=$1 AND status='approved'`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/templates/sync',async(req,res)=>{
 try{
  if(!WABA_ID) return res.json({ok:true,count:0});
  const resp=await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?fields=name,status&status=APPROVED&limit=100`,{headers:{'Authorization':'Bearer '+WA_TOKEN}});
  const j=await resp.json(); let c=0; for(let t of j.data||[]){ await pool.query(`INSERT INTO templates(agency_id,name,status,language) VALUES($1,$2,$3,'es_CO') ON CONFLICT(agency_id,name) DO UPDATE SET status=$3`,[req.query.agency_id,t.name,'approved']); c++; }
  res.json({ok:true,count:c});
 }catch(e){ res.json({error:e.message}); }
});
app.get('/api/campaigns',async(req,res)=>{ const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY id DESC LIMIT 50`,[req.query.agency_id]); res.json(r.rows); });
app.get('/api/campaigns/:id',async(req,res)=>{ const r=await pool.query(`SELECT * FROM campaigns WHERE id=$1 AND agency_id=$2`,[req.params.id,req.query.agency_id]); if(!r.rows.length) return res.status(404).json({error:'No encontrada'}); res.json(r.rows[0]); });
app.post('/api/campaigns/start',async(req,res)=>{
 const {agency_id,template,contacts}=req.body; if(!contacts?.length) return res.status(400).json({error:'Sin contactos'});
 const uniq=[...new Map(contacts.map(c=>[String(c.wa_id).replace(/\D/g,''),c])).values()];
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
(async()=>{ await ensureTables(); app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 KLIDO V9 REAL en ${PORT}`)); })();
