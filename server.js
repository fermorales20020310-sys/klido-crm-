const express=require('express');
const {Pool}=require('pg');
const axios=require('axios');
const path=require('path');
const xlsx=require('xlsx');
const bcrypt=require('bcryptjs');
const cron=require('node-cron');
const app=express();
app.use(express.json({limit:'10mb'}));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const G='v22.0';
const MAX_AGENCIES=10;

function getAgencyMap(){try{return JSON.parse(process.env.AGENCY_MAP||'{}');}catch{return {};}}
function getAgency(pid){const m=getAgencyMap();if(pid&&m[pid])return m[pid];return process.env.DEFAULT_AGENCY||'acol';}
function getPidForAgency(a){const m=getAgencyMap();for(let k in m)if(m[k]===a)return k;return process.env.PHONE_NUMBER_ID;}

async function init(){
await pool.query(`CREATE TABLE IF NOT EXISTS agencies(id TEXT PRIMARY KEY, name TEXT, phone_number_id TEXT UNIQUE, created_at BIGINT)`);
await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS waba_id TEXT`);
await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS phone_number_id TEXT`);
await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS name TEXT`);
await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS created_at BIGINT`);
await pool.query(`CREATE TABLE IF NOT EXISTS conversations(wa_id TEXT,agency_id TEXT,name TEXT,last_message TEXT,last_time BIGINT,unread BOOLEAN DEFAULT true,unread_dot TEXT DEFAULT 'transparent',last_type TEXT DEFAULT 'text',tag TEXT DEFAULT 'nuevo',updated_at BIGINT,UNIQUE(wa_id,agency_id))`);
await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY,wa_id TEXT,agency_id TEXT,direction TEXT,text TEXT,media_type TEXT,media_url TEXT,is_campaign BOOLEAN DEFAULT false,timestamp BIGINT,status TEXT DEFAULT 'sent')`);
await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY,agency_id TEXT,template TEXT,total INT DEFAULT 0,sent INT DEFAULT 0,status TEXT DEFAULT 'programada',created_at BIGINT)`);
await pool.query(`CREATE TABLE IF NOT EXISTS campaign_queue(id SERIAL PRIMARY KEY,campaign_id INT,agency_id TEXT,wa_id TEXT,template TEXT,status TEXT DEFAULT 'queued',created_at BIGINT)`);
await pool.query(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,agency_id TEXT,username TEXT,password_hash TEXT,role TEXT DEFAULT 'trabajador',UNIQUE(agency_id,username))`);
const m=getAgencyMap();const now=Date.now();const ids=new Set(Object.values(m));if(process.env.DEFAULT_AGENCY)ids.add(process.env.DEFAULT_AGENCY);
for(let aid of ids){const pid=Object.keys(m).find(k=>m[k]===aid)||null;await pool.query(`INSERT INTO agencies(id,name,phone_number_id,created_at) VALUES($1,$1,$2,$3) ON CONFLICT(id) DO NOTHING`,[aid,pid,now]);}
try{const au=process.env.ADMIN_USER;const aa=process.env.ADMIN_AGENCY||process.env.DEFAULT_AGENCY||'acol';let h=process.env.ADMIN_PASSWORD_HASH;const pl=process.env.ADMIN_PASSWORD||process.env.ADMIN_PASS;if(au&&!h&&pl)h=bcrypt.hashSync(pl,8);if(au&&h)await pool.query(`INSERT INTO users(agency_id,username,password_hash,role) VALUES($1,$2,$3,'jefe') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3`,[aa,au,h]);}catch(e){console.error(e.message);}
console.log('GOLD TODO-EN-UNO');
}
init();
app.use(express.static(path.join(__dirname,'public')));

app.get('/super',(req,res)=>{res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Super Admin Klido</title><style>body{font-family:system-ui;background:#0a1931;color:#fff;padding:20px}input{width:100%;padding:10px;margin:6px 0;border-radius:8px;border:1px solid #4da6ff;background:#071224;color:#fff}button{background:#1e90ff;color:#fff;border:0;padding:11px;border-radius:8px;width:100%;font-weight:700;cursor:pointer;margin-top:6px}.card{background:#0f2347;border:1px solid #4da6ff;border-radius:12px;padding:14px;margin:10px 0}</style></head><body><h2>KLIDO Super Admin (max 10)</h2><input id="k" placeholder="SUPER_ADMIN_KEY" type="password"><div class="card"><h3>Crear agencia</h3><input id="aid" placeholder="id ej: agencia2"><input id="pid" placeholder="phone_number_id"><input id="waba" placeholder="waba_id opcional"><button onclick="cAg()">Crear</button></div><div class="card"><h3>Crear usuario</h3><input id="uag" placeholder="agencia id"><input id="uus" placeholder="email"><input id="upw" placeholder="clave"><button onclick="cUs()">Crear</button></div><div class="card"><button onclick="lAg()">Listar agencias</button><div id="lst"></div></div><script>async function cAg(){let r=await fetch('/api/super/agencies',{method:'POST',headers:{'Content-Type':'application/json','x-super-key':k.value},body:JSON.stringify({id:aid.value,phone_number_id:pid.value,waba_id:waba.value})});alert(await r.text());}async function cUs(){let r=await fetch('/api/super/users',{method:'POST',headers:{'Content-Type':'application/json','x-super-key':k.value},body:JSON.stringify({agency_id:uag.value,username:uus.value,password:upw.value,role:'jefe'})});alert(await r.text());}async function lAg(){let r=await fetch('/api/super/agencies',{headers:{'x-super-key':k.value}});let j=await r.json();lst.innerHTML='<pre>'+JSON.stringify(j,null,2)+'</pre>';}</script></body></html>`);});

function isSuper(req){return req.headers['x-super-key']===process.env.SUPER_ADMIN_KEY;}
app.get('/api/super/agencies',async(req,res)=>{if(!isSuper(req))return res.status(403).json({error:'forbidden'});const r=await pool.query(`SELECT * FROM agencies ORDER BY created_at`);res.json({max:MAX_AGENCIES,count:r.rows.length,agencies:r.rows,map:getAgencyMap()});});
app.post('/api/super/agencies',async(req,res)=>{
if(!isSuper(req))return res.status(403).json({error:'forbidden'});
const{id,phone_number_id,waba_id}=req.body;if(!id||!phone_number_id)return res.status(400).json({error:'faltan datos'});
const c=await pool.query(`SELECT COUNT(*) FROM agencies`);if(parseInt(c.rows[0].count)>=MAX_AGENCIES)return res.status(400).json({error:'limite 10'});
const nid=id.toLowerCase().trim();
await pool.query(`INSERT INTO agencies(id,name,phone_number_id,waba_id,created_at) VALUES($1,$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET phone_number_id=$2, waba_id=$3`,[nid,phone_number_id,waba_id||null,Date.now()]);
res.json({ok:true,msg:'Agrega a AGENCY_MAP: "'+phone_number_id+'":"'+nid+'" y redeploy'});
});
app.post('/api/super/users',async(req,res)=>{
if(!isSuper(req))return res.status(403).json({error:'forbidden'});
const{agency_id,username,password,role}=req.body;const h=bcrypt.hashSync(password,8);
await pool.query(`INSERT INTO users(agency_id,username,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3`,[agency_id,username,h,role||'jefe']);
res.json({ok:true});
});

app.get('/webhook',(req,res)=>{if(req.query['hub.verify_token']===process.env.VERIFY_TOKEN)return res.send(req.query['hub.challenge']);res.sendStatus(403);});
app.post('/webhook',async(req,res)=>{try{const v=req.body.entry?.[0]?.changes?.[0]?.value;const m=v?.messages?.[0];const ag=getAgency(v?.metadata?.phone_number_id);
if(m){const wa=m.from;const nm=v.contacts?.[0]?.profile?.name||wa;let tx='',mt='text',mid=null;const isc=!!m.context;
if(m.type==='text')tx=m.text.body;else if(m.image){tx='📷 Imagen';mt='image';mid=m.image.id;}else if(m.audio){tx='🎤 Audio';mt='audio';mid=m.audio.id;}else if(m.video){tx='🎥 Video';mt='video';mid=m.video.id;}else if(m.document){tx='📄 Documento';mt='document';mid=m.document.id;}else tx='['+m.type+']';
const now=Date.now();const dot=isc?'yellow':'red';
await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,last_type,updated_at) VALUES($1,$2,$3,$4,$5,true,$6,$7,$5) ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=$4,last_time=$5,unread=true,unread_dot=$6,last_type=$7,updated_at=$5,name=$3`,[wa,ag,nm,tx,now,dot,mt]);
await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,media_type,media_url,is_campaign,timestamp) VALUES($1,$2,'in',$3,$4,$5,$6,$7)`,[wa,ag,tx,mt,mid,isc,now]);}}catch(e){console.error(e.message);}res.sendStatus(200);});

app.post('/api/login',async(req,res)=>{const{agency_id,username,password}=req.body;const r=await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND username=$2`,[agency_id,username]);if(!r.rows.length)return res.status(401).json({error:'no_user'});if(!bcrypt.compareSync(password,r.rows[0].password_hash))return res.status(401).json({error:'bad'});res.json({ok:true,role:r.rows[0].role});});
app.get('/api/media',async(req,res)=>{try{const mid=(req.query.mid||'').trim();const meta=await axios.get(`https://graph.facebook.com/${G}/${mid}`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});const rr=await axios.get(meta.data.url,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`},responseType:'stream'});res.setHeader('Content-Type',rr.headers['content-type']);rr.data.pipe(res);}catch(e){res.sendStatus(500);}});
app.get('/api/chats',async(req,res)=>{const r=await pool.query(`SELECT wa_id,name,last_message as "lastMessage",unread_dot as dot,last_type,tag FROM conversations WHERE agency_id=$1 ORDER BY last_time DESC LIMIT 300`,[req.query.agency_id]);res.json(r.rows);});
app.get('/api/messages/:wa',async(req,res)=>{const r=await pool.query(`SELECT text,direction,timestamp,media_type,media_url,is_campaign FROM messages WHERE wa_id=$1 AND agency_id=$2 ORDER BY timestamp ASC LIMIT 1000`,[req.params.wa,req.query.agency_id]);res.json(r.rows);});
app.post('/api/messages/send',async(req,res)=>{const{wa_id,text,agency_id}=req.body;const pid=getPidForAgency(agency_id);await axios.post(`https://graph.facebook.com/${G}/${pid}/messages`,{messaging_product:'whatsapp',to:wa_id,type:'text',text:{body:text}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});const now=Date.now();await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,timestamp) VALUES($1,$2,'out',$3,$4)`,[wa_id,agency_id,text,now]);await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,updated_at) VALUES($1,$2,$1,$3,$4,false,'transparent',$4) ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=$3,last_time=$4`,[wa_id,agency_id,text,now]);res.json({ok:true});});
app.post('/api/chats/:wa/read',async(req,res)=>{await pool.query(`UPDATE conversations SET unread=false,unread_dot='transparent' WHERE wa_id=$1 AND agency_id=$2`,[req.params.wa,req.query.agency_id]);res.json({ok:true});});
app.post('/api/chats/:wa/tag',async(req,res)=>{await pool.query(`UPDATE conversations SET tag=$1 WHERE wa_id=$2 AND agency_id=$3`,[req.body.tag,req.params.wa,req.body.agency_id]);res.json({ok:true});});
app.get('/api/templates',async(req,res)=>{try{const ar=await pool.query(`SELECT waba_id FROM agencies WHERE id=$1`,[req.query.agency_id]);const waba=ar.rows[0]?.waba_id||process.env.WABA_ID;const r=await axios.get(`https://graph.facebook.com/${G}/${waba}/message_templates?fields=name,status`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});res.json(r.data.data.filter(t=>t.status==='APPROVED'));}catch(e){res.json([]);}});
app.post('/api/campaigns/upload',async(req,res)=>{try{const{agency_id,template,fileBase64}=req.body;const buf=Buffer.from(fileBase64.split(',').pop(),'base64');const wb=xlsx.read(buf,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=xlsx.utils.sheet_to_json(ws,{header:1});let phones=[];rows.flat().forEach(c=>{let s=String(c||'').replace(/\D/g,'');if(s.length>=10)phones.push(s);});phones=[...new Set(phones)];const now=Date.now();const cr=await pool.query(`INSERT INTO campaigns(agency_id,template,total,sent,status,created_at) VALUES($1,$2,$3,0,'enviando',$4) RETURNING id`,[agency_id,template,phones.length,now]);for(let p of phones)await pool.query(`INSERT INTO campaign_queue(campaign_id,agency_id,wa_id,template,status,created_at) VALUES($1,$2,$3,$4,'queued',$5)`,[cr.rows[0].id,agency_id,p,template,now]);res.json({ok:true,total:phones.length});}catch(e){console.error(e);res.status(500).json({error:'excel_error'});}});
app.get('/api/campaigns',async(req,res)=>{const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY created_at DESC LIMIT 50`,[req.query.agency_id]);res.json(r.rows);});

cron.schedule('0 */6 * * *',async()=>{const ags=await pool.query(`SELECT id FROM agencies`);for(let a of ags.rows){const q=await pool.query(`SELECT * FROM campaign_queue WHERE status='queued' AND agency_id=$1 ORDER BY id ASC LIMIT 50`,[a.id]);const pid=getPidForAgency(a.id);for(let row of q.rows){try{await axios.post(`https://graph.facebook.com/${G}/${pid}/messages`,{messaging_product:'whatsapp',to:row.wa_id,type:'template',template:{name:row.template,language:{code:'es'}}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});await pool.query(`UPDATE campaign_queue SET status='sent' WHERE id=$1`,[row.id]);await pool.query(`UPDATE campaigns SET sent=sent+1 WHERE id=$1`,[row.campaign_id]);}catch(e){await pool.query(`UPDATE campaign_queue SET status='error' WHERE id=$1`,[row.id]);}}}});
app.listen(process.env.PORT||3000,()=>console.log('GOLD TODO-EN-UNO'));
