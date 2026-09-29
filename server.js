const express=require('express');
const {Pool}=require('pg');
const axios=require('axios');
const path=require('path');
const xlsx=require('xlsx');
const bcrypt=require('bcryptjs');
const cron=require('node-cron');
const nodemailer=require('nodemailer');
const crypto=require('crypto');
const app=express();
app.use(express.json({limit:'10mb'}));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const G='v22.0'; const MAX_AGENCIES=10;
function getAgencyMap(){try{return JSON.parse(process.env.AGENCY_MAP||'{}')}catch{return{}}}
function getAgency(pid){const m=getAgencyMap();if(pid&&m[pid])return m[pid];return process.env.DEFAULT_AGENCY||'acol'}
function getPidForAgency(a){const m=getAgencyMap();for(let k in m)if(m[k]===a)return k;return process.env.PHONE_NUMBER_ID}

// FIX CORREO - SOPORTA 465 y 587 - SIN VERIFY PARA RAILWAY
function getTransporter(){
  const port=parseInt(process.env.SMTP_PORT||'465');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST||'smtp.gmail.com',
    port: port,
    secure: port===465,
    auth:{user:process.env.SMTP_USER, pass:(process.env.SMTP_PASS||'').replace(/\s/g,'')},
    tls:{rejectUnauthorized:false},
    connectionTimeout:20000,
    greetingTimeout:20000,
    socketTimeout:20000
  });
}

async function init(){
await pool.query(`CREATE TABLE IF NOT EXISTS agencies(id TEXT PRIMARY KEY, name TEXT, phone_number_id TEXT UNIQUE, created_at BIGINT, plan_id TEXT DEFAULT 'basico', acepto_terminos BOOLEAN DEFAULT false, fecha_aceptacion BIGINT, waba_id TEXT, wompi_ref TEXT)`);
await pool.query(`CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, nombre TEXT, precio INT, mantenimiento INT, max_campanas INT, max_usuarios INT, ia BOOLEAN)`);
try{await pool.query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS mantenimiento INT DEFAULT 0`)}catch{}
await pool.query(`INSERT INTO plans(id,nombre,precio,mantenimiento,max_campanas,max_usuarios,ia) VALUES('basico','Básico',800000,80000,1,2,false),('pro','Premium',1300000,95000,5,5,true),('enterprise','Gold',2400000,130000,999,999,true) ON CONFLICT(id) DO UPDATE SET nombre=EXCLUDED.nombre, precio=EXCLUDED.precio, mantenimiento=EXCLUDED.mantenimiento, max_campanas=EXCLUDED.max_campanas, max_usuarios=EXCLUDED.max_usuarios, ia=EXCLUDED.ia`);
try{await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS plan_id TEXT DEFAULT 'basico'`)}catch{}
try{await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS acepto_terminos BOOLEAN DEFAULT false`)}catch{}
try{await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS fecha_aceptacion BIGINT`)}catch{}
try{await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS created_at BIGINT`)}catch{}
try{await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS waba_id TEXT`)}catch{}
try{await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS phone_number_id TEXT`)}catch{}
try{await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS name TEXT`)}catch{}
try{await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS wompi_ref TEXT`)}catch{}
await pool.query(`CREATE TABLE IF NOT EXISTS ai_config(agency_id TEXT PRIMARY KEY, enabled BOOLEAN DEFAULT false, prompt TEXT DEFAULT 'Eres un asistente útil de atención al cliente de inmobiliaria. Responde corto, amable, en español. Si no sabes, di que un asesor te contactará.', human_takeover BOOLEAN DEFAULT false, updated_at BIGINT)`);
await pool.query(`CREATE TABLE IF NOT EXISTS conversations(wa_id TEXT,agency_id TEXT,name TEXT,last_message TEXT,last_time BIGINT,unread BOOLEAN DEFAULT true,unread_dot TEXT DEFAULT 'transparent',last_type TEXT DEFAULT 'text',tag TEXT DEFAULT 'nuevo',updated_at BIGINT,assigned_to TEXT,UNIQUE(wa_id,agency_id))`);
await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_to TEXT`);
await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tag TEXT DEFAULT 'nuevo'`);
await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY,wa_id TEXT,agency_id TEXT,direction TEXT,text TEXT,media_type TEXT,media_url TEXT,is_campaign BOOLEAN DEFAULT false,timestamp BIGINT,status TEXT DEFAULT 'sent',sent_by TEXT)`);
await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_by TEXT`);
await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY,agency_id TEXT,template TEXT,total INT DEFAULT 0,sent INT DEFAULT 0,status TEXT DEFAULT 'programada',created_at BIGINT)`);
await pool.query(`CREATE TABLE IF NOT EXISTS campaign_queue(id SERIAL PRIMARY KEY,campaign_id INT,agency_id TEXT,wa_id TEXT,template TEXT,status TEXT DEFAULT 'queued',created_at BIGINT)`);
await pool.query(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,agency_id TEXT,username TEXT,password_hash TEXT,role TEXT DEFAULT 'trabajador',display_name TEXT,UNIQUE(agency_id,username))`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
await pool.query(`CREATE TABLE IF NOT EXISTS password_resets(id SERIAL PRIMARY KEY, agency_id TEXT, email TEXT, token TEXT UNIQUE, expires_at BIGINT)`);
const m=getAgencyMap();const now=Date.now();const ids=new Set(Object.values(m));if(process.env.DEFAULT_AGENCY)ids.add(process.env.DEFAULT_AGENCY);
for(let aid of ids){const pidRaw=Object.keys(m).find(k=>m[k]===aid)||null;const pid=pidRaw?String(pidRaw):null;const aidStr=String(aid);await pool.query(`INSERT INTO agencies(id,name,phone_number_id,created_at,plan_id) VALUES($1,$2,$3,$4,'basico') ON CONFLICT(id) DO NOTHING`,[aidStr,aidStr,pid,now]);}
try{const au=process.env.ADMIN_USER;const aa=process.env.ADMIN_AGENCY||process.env.DEFAULT_AGENCY||'acol';let h=process.env.ADMIN_PASSWORD_HASH;const pl=process.env.ADMIN_PASSWORD||process.env.ADMIN_PASS;if(au&&!h&&pl)h=bcrypt.hashSync(pl,8);if(au&&h)await pool.query(`INSERT INTO users(agency_id,username,password_hash,role) VALUES($1,$2,$3,'jefe') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3`,[aa,au,h]);}catch(e){console.error(e.message)}
console.log('KLIDO ANUAL FINAL + EMAIL FIX 465 - NO VERIFY');
}
init();
app.use(express.static(path.join(__dirname,'public')));

app.get('/api/plans', async (req,res)=>{ const r=await pool.query(`SELECT * FROM plans ORDER BY precio`); res.json(r.rows); });
app.get('/api/me', async (req,res)=>{ const r=await pool.query(`SELECT a.id, a.plan_id, a.name, p.nombre as plan_nombre, p.precio, p.mantenimiento, p.ia, p.max_usuarios, p.max_campanas FROM agencies a LEFT JOIN plans p ON p.id=a.plan_id WHERE a.id=$1`,[req.query.agency_id]); res.json(r.rows[0]||{}); });
app.get('/health', (req,res)=>res.json({ok:true, time:Date.now(), version:'ANUAL + FIX 465 NO VERIFY'}));

app.get('/api/ai-config', async (req,res)=>{ const {agency_id}=req.query; let r=await pool.query('SELECT * FROM ai_config WHERE agency_id=$1',[agency_id]); if(r.rows.length===0){ await pool.query('INSERT INTO ai_config(agency_id) VALUES($1)',[agency_id]); r=await pool.query('SELECT * FROM ai_config WHERE agency_id=$1',[agency_id]); } res.json(r.rows[0]); });
app.post('/api/ai-config', async (req,res)=>{ const {agency_id, enabled, prompt, human_takeover}=req.body; await pool.query(`INSERT INTO ai_config(agency_id,enabled,prompt,human_takeover,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(agency_id) DO UPDATE SET enabled=$2,prompt=$3,human_takeover=$4,updated_at=$5`,[agency_id, enabled, prompt, human_takeover, Date.now()]); res.json({ok:true}); });

app.get('/api/team', async (req,res)=>{ const r=await pool.query(`SELECT agency_id,username,role,display_name FROM users WHERE agency_id=$1 ORDER BY role DESC`,[req.query.agency_id]); res.json(r.rows); });
app.post('/api/team/create', async (req,res)=>{
  const {agency_id, username, password, display_name, role_req}=req.body;
  const me=await pool.query(`SELECT role FROM users WHERE agency_id=$1 AND username=$2`,[agency_id, role_req]);
  if(me.rows[0]?.role!=='jefe') return res.status(403).json({error:'Solo jefe'});
  const max=await pool.query(`SELECT p.max_usuarios FROM agencies a JOIN plans p ON p.id=a.plan_id WHERE a.id=$1`,[agency_id]);
  const cnt=await pool.query(`SELECT COUNT(*) FROM users WHERE agency_id=$1`,[agency_id]);
  if(parseInt(cnt.rows[0].count)>= (max.rows[0]?.max_usuarios||2)) return res.status(400).json({error:'Límite de tu plan. Actualiza a Premium/Gold'});
  const hash=bcrypt.hashSync(password,8);
  await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name) VALUES($1,$2,$3,'trabajador',$4) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3, display_name=$4`,[agency_id, username, hash, display_name||username]);
  res.json({ok:true});
});
app.post('/api/team/delete', async (req,res)=>{ const {agency_id, username, role_req}=req.body; const me=await pool.query(`SELECT role FROM users WHERE agency_id=$1 AND username=$2`,[agency_id, role_req]); if(me.rows[0]?.role!=='jefe') return res.status(403).json({error:'Solo jefe'}); await pool.query(`DELETE FROM users WHERE agency_id=$1 AND username=$2 AND role='trabajador'`,[agency_id, username]); res.json({ok:true}); });
app.get('/api/team/stats', async (req,res)=>{ const r=await pool.query(`SELECT sent_by as username, COUNT(*) as total FROM messages WHERE agency_id=$1 AND direction='out' AND timestamp > $2 GROUP BY sent_by`,[req.query.agency_id, Date.now()-86400000*7]); res.json(r.rows); });

app.post('/api/register', async (req,res)=>{
 try{
   let {agency_id, name, email, password, plan_id}=req.body;
   if(!agency_id||!email||!password) return res.status(400).json({error:'faltan datos'});
   agency_id=agency_id.toLowerCase().trim().replace(/[^a-z0-9-]/g,'');
   const count=await pool.query(`SELECT COUNT(*) FROM agencies`);
   if(parseInt(count.rows[0].count)>=MAX_AGENCIES) return res.status(400).json({error:'Cupos llenos'});
   const exist=await pool.query(`SELECT id FROM agencies WHERE id=$1`,[agency_id]);
   if(exist.rows.length>0) return res.status(400).json({error:'Esa agencia ya existe'});
   await pool.query(`INSERT INTO agencies(id,name,phone_number_id,created_at,plan_id,acepto_terminos,fecha_aceptacion) VALUES($1,$2,$3,$4,$5,true,$4)`,[agency_id, name||agency_id, 'pending_'+agency_id, Date.now(), plan_id||'basico']);
   const hash=bcrypt.hashSync(password,8);
   await pool.query(`INSERT INTO users(agency_id,username,password_hash,role,display_name) VALUES($1,$2,$3,'jefe',$4)`,[agency_id, email, hash, name||email]);
   await pool.query(`INSERT INTO ai_config(agency_id) VALUES($1) ON CONFLICT DO NOTHING`,[agency_id]);
   res.json({ok:true, agency_id});
 }catch(e){ console.error(e); res.status(500).json({error:'error registro'}) }
});

app.post('/api/wompi/create', async (req,res)=>{
 const {agency_id, plan_id}=req.body;
 const plans={basico:800000, pro:1300000, enterprise:2400000};
 const amount=(plans[plan_id]||800000)*100;
 const reference=agency_id+'-'+Date.now();
 await pool.query(`UPDATE agencies SET wompi_ref=$1 WHERE id=$2`,[reference, agency_id]);
 res.json({public_key:process.env.WOMPI_PUBLIC_KEY, currency:'COP', amount_in_cents:amount, reference, redirect_url:`https://${req.get('host')}/?paid=1`});
});
app.post('/api/wompi/webhook', async (req,res)=>{
 try{ const data=req.body.data?.transaction; if(data?.status==='APPROVED'){ const agency_id=data.reference.split('-')[0]; let plan='basico'; if(data.amount_in_cents>=240000000) plan='enterprise'; else if(data.amount_in_cents>=130000000) plan='pro'; await pool.query(`UPDATE agencies SET plan_id=$1 WHERE id=$2`,[plan, agency_id]); } res.sendStatus(200); }catch(e){ res.sendStatus(200) }
});

app.get('/super',(req,res)=>{res.send(`<h2>KLIDO Super Admin</h2><p>usa /api/super/* con x-super-key</p>`)});
function isSuper(req){return req.headers['x-super-key']===process.env.SUPER_ADMIN_KEY}
app.get('/api/super/agencies',async(req,res)=>{if(!isSuper(req))return res.status(403).json({error:'forbidden'});const r=await pool.query(`SELECT * FROM agencies ORDER BY created_at`);res.json({max:MAX_AGENCIES,count:r.rows.length,agencies:r.rows})});
app.post('/api/super/agencies',async(req,res)=>{if(!isSuper(req))return res.status(403).json({error:'forbidden'});const{id,phone_number_id,waba_id}=req.body;if(!id||!phone_number_id)return res.status(400).json({error:'faltan datos'});const c=await pool.query(`SELECT COUNT(*) FROM agencies`);if(parseInt(c.rows[0].count)>=MAX_AGENCIES)return res.status(400).json({error:'limite 10'});const nid=String(id).toLowerCase().trim();await pool.query(`INSERT INTO agencies(id,name,phone_number_id,waba_id,created_at,plan_id) VALUES($1,$1,$2,$3,$4,'basico') ON CONFLICT(id) DO UPDATE SET phone_number_id=$2,waba_id=$3`,[nid,String(phone_number_id),waba_id||null,Date.now()]);res.json({ok:true})});
app.post('/api/super/users',async(req,res)=>{if(!isSuper(req))return res.status(403).json({error:'forbidden'});const{agency_id,username,password,role}=req.body;const h=bcrypt.hashSync(password,8);await pool.query(`INSERT INTO users(agency_id,username,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3`,[agency_id,username,h,role||'jefe']);res.json({ok:true})});

app.get('/webhook',(req,res)=>{if(req.query['hub.verify_token']===process.env.VERIFY_TOKEN)return res.send(req.query['hub.challenge']);res.sendStatus(403)});
app.post('/webhook',async(req,res)=>{
 try{
   const v=req.body.entry?.[0]?.changes?.[0]?.value; const m=v?.messages?.[0]; const ag=getAgency(v?.metadata?.phone_number_id);
   if(m){ const wa=m.from; const nm=v.contacts?.[0]?.profile?.name||wa; let tx='',mt='text',mid=null; const isc=!!m.context; if(m.type==='text')tx=m.text.body; else if(m.image){tx='📷 Imagen';mt='image';mid=m.image.id} else if(m.audio){tx='🎤 Audio';mt='audio';mid=m.audio.id} else if(m.video){tx='🎥 Video';mt='video';mid=m.video.id} else if(m.document){tx='📄 Documento';mt='document';mid=m.document.id} else tx='['+m.type+']'; const now=Date.now(); const dot=isc?'yellow':'red'; await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,last_type,updated_at) VALUES($1,$2,$3,$4,$5,true,$6,$7,$5) ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=$4,last_time=$5,unread=true,unread_dot=$6,last_type=$7,updated_at=$5,name=$3`,[wa,ag,nm,tx,now,dot,mt]); await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,media_type,media_url,is_campaign,timestamp) VALUES($1,$2,'in',$3,$4,$5,$6,$7)`,[wa,ag,tx,mt,mid,isc,now]); }
 }catch(e){console.error('WEBHOOK ERR', e.message)} res.sendStatus(200)
});

app.post('/api/login',async(req,res)=>{
  const {email, username, password, acepto_terminos}=req.body; const userEmail=email||username; if(!userEmail||!password) return res.status(400).json({error:'faltan datos'});
  const agency_id=req.body.agency_id||process.env.DEFAULT_AGENCY||'acol';
  const r=await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND username=$2`,[agency_id,userEmail]);
  if(!r.rows.length) return res.status(401).json({error:'Usuario no existe'});
  if(!bcrypt.compareSync(password,r.rows[0].password_hash)) return res.status(401).json({error:'Clave incorrecta'});
  if(acepto_terminos){ await pool.query(`UPDATE agencies SET acepto_terminos=true, fecha_aceptacion=$1 WHERE id=$2`,[Date.now(), agency_id]); }
  res.json({ok:true, role:r.rows[0].role, agency_id, username:userEmail});
});

app.get('/api/media',async(req,res)=>{try{const mid=(req.query.mid||'').trim();const meta=await axios.get(`https://graph.facebook.com/${G}/${mid}`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});const rr=await axios.get(meta.data.url,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`},responseType:'stream'});res.setHeader('Content-Type',rr.headers['content-type']);rr.data.pipe(res)}catch(e){res.sendStatus(500)}});
app.get('/api/chats',async(req,res)=>{const r=await pool.query(`SELECT wa_id,name,last_message as "lastMessage",unread_dot as dot,last_type,tag,assigned_to FROM conversations WHERE agency_id=$1 ORDER BY last_time DESC LIMIT 300`,[req.query.agency_id]);res.json(r.rows)});
app.get('/api/messages/:wa',async(req,res)=>{const r=await pool.query(`SELECT text,direction,timestamp,media_type,media_url,is_campaign,sent_by FROM messages WHERE wa_id=$1 AND agency_id=$2 ORDER BY timestamp ASC LIMIT 1000`,[req.params.wa,req.query.agency_id]);res.json(r.rows)});
app.post('/api/messages/send',async(req,res)=>{
  const{wa_id,text,agency_id,username}=req.body; const pid=getPidForAgency(agency_id);
  await axios.post(`https://graph.facebook.com/${G}/${pid}/messages`,{messaging_product:'whatsapp',to:wa_id,type:'text',text:{body:text}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
  const now=Date.now(); await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,timestamp,sent_by) VALUES($1,$2,'out',$3,$4,$5)`,[wa_id,agency_id,text,now,username||'jefe']); await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,updated_at,assigned_to) VALUES($1,$2,$1,$3,$4,false,'transparent',$4,$5) ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=$3,last_time=$4,assigned_to=$5`,[wa_id,agency_id,text,now,username||null]); res.json({ok:true})
});
app.post('/api/chats/:wa/read',async(req,res)=>{await pool.query(`UPDATE conversations SET unread=false,unread_dot='transparent' WHERE wa_id=$1 AND agency_id=$2`,[req.params.wa,req.query.agency_id]);res.json({ok:true})});
app.post('/api/chats/:wa/tag',async(req,res)=>{await pool.query(`UPDATE conversations SET tag=$1 WHERE wa_id=$2 AND agency_id=$3`,[req.body.tag,req.params.wa,req.body.agency_id]);res.json({ok:true})});
app.get('/api/templates',async(req,res)=>{try{const ar=await pool.query(`SELECT waba_id FROM agencies WHERE id=$1`,[req.query.agency_id]);const waba=ar.rows[0]?.waba_id||process.env.WABA_ID;const r=await axios.get(`https://graph.facebook.com/${G}/${waba}/message_templates?fields=name,status`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});res.json(r.data.data.filter(t=>t.status==='APPROVED'))}catch(e){res.json([])}});

app.post('/api/campaigns/upload',async(req,res)=>{
 try{
  const{agency_id,template,fileBase64}=req.body;
  const lim=await pool.query(`SELECT p.max_campanas FROM agencies a JOIN plans p ON p.id=a.plan_id WHERE a.id=$1`,[agency_id]);
  const maxCamp=lim.rows[0]?.max_campanas||1;
  const active=await pool.query(`SELECT COUNT(*) FROM campaigns WHERE agency_id=$1 AND status='enviando'`,[agency_id]);
  if(parseInt(active.rows[0].count)>=maxCamp) return res.status(400).json({error:`Tu plan solo permite ${maxCamp} campaña(s) simultánea(s)`});
  const buf=Buffer.from(fileBase64.split(',').pop(),'base64');const wb=xlsx.read(buf,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=xlsx.utils.sheet_to_json(ws,{header:1});let phones=[];rows.flat().forEach(c=>{let s=String(c||'').replace(/\D/g,'');if(s.length>=10)phones.push(s)});phones=[...new Set(phones)];const now=Date.now();const cr=await pool.query(`INSERT INTO campaigns(agency_id,template,total,sent,status,created_at) VALUES($1,$2,$3,0,'enviando',$4) RETURNING id`,[agency_id,template,phones.length,now]);for(let p of phones)await pool.query(`INSERT INTO campaign_queue(campaign_id,agency_id,wa_id,template,status,created_at) VALUES($1,$2,$3,$4,'queued',$5)`,[cr.rows[0].id,agency_id,p,template,now]);res.json({ok:true,total:phones.length})
 }catch(e){console.error(e);res.status(500).json({error:'excel_error'})}
});
app.get('/api/campaigns',async(req,res)=>{const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY created_at DESC LIMIT 50`,[req.query.agency_id]);res.json(r.rows)});

// ===== RESET POR CORREO FIX DEFINITIVO - SIN VERIFY =====
app.post('/api/forgot-password', async (req,res)=>{
  console.log('FORGOT REQ', req.body);
  const {email}=req.body;
  if(!email) return res.status(400).json({error:'Escribe tu correo'});
  const clean=email.trim().toLowerCase();
  const users=await pool.query(`SELECT agency_id, username FROM users WHERE LOWER(username)=LOWER($1)`,[clean]);
  if(!users.rows.length){
    console.log('USER NOT FOUND', clean);
    return res.status(404).json({error:'Ese correo no está registrado: '+clean});
  }
  try{
    const transporter=getTransporter();
    console.log('SMTP TRY', process.env.SMTP_HOST, process.env.SMTP_PORT, process.env.SMTP_USER, 'len', (process.env.SMTP_PASS||'').length);
    // SIN verify - Railway lo bloquea
    for(let u of users.rows){
      const token=crypto.randomBytes(32).toString('hex');
      const expires=Date.now()+1000*60*15;
      await pool.query(`INSERT INTO password_resets(agency_id,email,token,expires_at) VALUES($1,$2,$3,$4)`,[u.agency_id, clean, token, expires]);
      const link=`https://${req.get('host')}/reset.html?token=${token}`;
      console.log('SENDING TO', clean, 'AG', u.agency_id);
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || `"KLIDO CRM" <${process.env.SMTP_USER}>`,
        to: clean,
        subject:`Restablecer clave - Agencia ${u.agency_id}`,
        html:`<div style="font-family:sans-serif;padding:20px"><h2>KLIDO CRM</h2><p>Agencia: <b>${u.agency_id}</b></p><p>Correo: <b>${clean}</b></p><p><a href="${link}" style="background:#2f7bff;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">Cambiar mi clave</a></p><p style="margin-top:10px;word-break:break-all;font-size:12px;color:#555">${link}</p><p>Expira en 15 min</p></div>`
      });
      console.log('MAIL OK', info.messageId, 'a', clean);
    }
    res.json({ok:true, count: users.rows.length});
  }catch(e){
    console.error('MAIL ERR FULL', e.message, e);
    res.status(500).json({error:'SMTP: '+e.message});
  }
});

app.post('/api/reset-password-secure', async (req,res)=>{
  const {token, new_password}=req.body;
  if(!new_password||new_password.length<6) return res.status(400).json({error:'Clave min 6 caracteres'});
  const r=await pool.query(`SELECT * FROM password_resets WHERE token=$1`,[token]);
  if(!r.rows.length) return res.status(400).json({error:'Token inválido'});
  if(r.rows[0].expires_at < Date.now()){ await pool.query(`DELETE FROM password_resets WHERE token=$1`,[token]); return res.status(400).json({error:'Token vencido'}); }
  const hash=bcrypt.hashSync(new_password,8);
  await pool.query(`UPDATE users SET password_hash=$1 WHERE agency_id=$2 AND LOWER(username)=LOWER($3)`,[hash, r.rows[0].agency_id, r.rows[0].email]);
  await pool.query(`DELETE FROM password_resets WHERE token=$1`,[token]);
  res.json({ok:true, agency_id:r.rows[0].agency_id});
});

app.post('/api/reset-password', async (req,res)=>{
  const {agency_id, username, new_password, requester}=req.body;
  const reqUser=await pool.query(`SELECT role FROM users WHERE agency_id=$1 AND username=$2`,[agency_id, requester||username]);
  if(username!==requester && reqUser.rows[0]?.role!=='jefe') return res.status(403).json({error:'Solo jefe'});
  const hash=bcrypt.hashSync(new_password,8);
  await pool.query(`UPDATE users SET password_hash=$1 WHERE agency_id=$2 AND username=$3`,[hash, agency_id, username]);
  res.json({ok:true});
});

cron.schedule('0 */6 * * *',async()=>{const ags=await pool.query(`SELECT id FROM agencies`);for(let a of ags.rows){const q=await pool.query(`SELECT * FROM campaign_queue WHERE status='queued' AND agency_id=$1 ORDER BY id ASC LIMIT 50`,[a.id]);const pid=getPidForAgency(a.id);for(let row of q.rows){try{await axios.post(`https://graph.facebook.com/${G}/${pid}/messages`,{messaging_product:'whatsapp',to:row.wa_id,type:'template',template:{name:row.template,language:{code:'es'}}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});await pool.query(`UPDATE campaign_queue SET status='sent' WHERE id=$1`,[row.id]);await pool.query(`UPDATE campaigns SET sent=sent+1 WHERE id=$1`,[row.campaign_id])}catch(e){await pool.query(`UPDATE campaign_queue SET status='error' WHERE id=$1`,[row.id])}}}});
app.listen(process.env.PORT||3000,()=>console.log('KLIDO ANUAL FINAL + EMAIL FIX 465 - NO VERIFY'));
