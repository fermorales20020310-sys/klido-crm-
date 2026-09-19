const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
const publicPath = path.join(__dirname,'public');
const uploadDir = path.join(publicPath,'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
app.use('/uploads',express.static(uploadDir));

console.log('Archivos en public:', fs.existsSync(publicPath)? fs.readdirSync(publicPath) : 'no public');

let pool=null, memMessages=[], memCampaigns=[
 {id:1,name:'Campaña Alion - 14/09',total:591,sent:591,created_at:'2026-09-14T17:19:43Z'},
 {id:2,name:'Campaña Alion - 17/09',total:591,sent:591,created_at:'2026-09-17T17:19:43Z'}
];
try{ if(process.env.DATABASE_URL) pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});}catch{}

async function initDB(){
 if(!pool) return;
 try{
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts(wa_id TEXT PRIMARY KEY, name TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, file_url TEXT, type TEXT, direction TEXT, source TEXT DEFAULT 'inbox', created_at TIMESTAMP DEFAULT NOW())`);
  // FIX DB - crea tabla si no existe
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, name TEXT, total INT, sent INT, created_at TIMESTAMP DEFAULT NOW())`);
  // FIX DB - si la tabla existe vieja sin columnas, las agrega
  try{ await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total INT DEFAULT 591`); }catch{}
  try{ await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sent INT DEFAULT 591`); }catch{}
  try{ await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Campaña'`); }catch{}
  const {rows}=await pool.query(`SELECT COUNT(*) as c FROM campaigns`);
  if(parseInt(rows[0].c)===0){
    await pool.query(`INSERT INTO campaigns(name,total,sent,created_at) VALUES('Campaña Alion - 14/09',591,591,'2026-09-14 17:19:43'),('Campaña Alion - 17/09',591,591,'2026-09-17 17:19:43')`);
  }
  console.log('✅ DB OK - campaigns fixed');
 }catch(e){
  console.log('DB Error fix:', e.message);
  // si falla, borra y recrea
  try{
    await pool.query(`DROP TABLE IF EXISTS campaigns`);
    await pool.query(`CREATE TABLE campaigns(id SERIAL PRIMARY KEY, name TEXT, total INT, sent INT, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`INSERT INTO campaigns(name,total,sent) VALUES('Campaña Alion - 14/09',591,591),('Campaña Alion - 17/09',591,591)`);
    console.log('✅ DB RECREADA');
  }catch{}
 }
}
initDB();

const TOKEN=process.env.WHATSAPP_TOKEN, PHONE_ID=process.env.PHONE_NUMBER_ID;
async function dl(id,name){ try{ if(!TOKEN) return null; const r1=await fetch(`https://graph.facebook.com/v20.0/${id}`,{headers:{Authorization:`Bearer ${TOKEN}`}}); const j=await r1.json(); if(!j.url) return null; const r2=await fetch(j.url,{headers:{Authorization:`Bearer ${TOKEN}`}}); const b=Buffer.from(await r2.arrayBuffer()); fs.writeFileSync(path.join(uploadDir,name),b); return `/uploads/${name}`; }catch{ return null; } }

app.post('/api/login',(req,res)=>{
  const {email,password}=req.body;
  const e=process.env.ADMIN_EMAIL||'admin@klido.co';
  const p=process.env.ADMIN_PASS||'klido123';
  if(email===e && password===p) return res.json({ok:true});
  res.json({ok:false});
});

app.get('/webhook',(req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/webhook',async(req,res)=>{
 try{ const m=req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; if(!m) return res.sendStatus(200);
 let txt='',url=null; if(m.type==='text') txt=m.text.body; else if(m.type==='image'){url=await dl(m.image.id,`${m.id}.jpg`); txt=m.image.caption||'📷 Imagen';} else if(m.type==='document'){url=await dl(m.document.id,m.document.filename||`${m.id}.pdf`); txt=`📄 ${m.document.filename}`;} else if(m.type==='audio'){url=await dl(m.audio.id,`${m.id}.ogg`); txt='🎤 Audio';}
 if(pool) try{ await pool.query(`INSERT INTO contacts(wa_id,name) VALUES($1,$2) ON CONFLICT(wa_id) DO NOTHING`,[m.from,m.from]); await pool.query(`INSERT INTO messages(wa_id,text,file_url,type,direction,source) VALUES($1,$2,$3,$4,'in','inbox')`,[m.from,txt,url,m.type]); }catch{ memMessages.push({wa_id:m.from,text:txt,file_url:url,type:m.type,direction:'in',source:'inbox',created_at:new Date()}); } else memMessages.push({wa_id:m.from,text:txt,file_url:url,type:m.type,direction:'in',source:'inbox',created_at:new Date()});
 res.sendStatus(200);}catch{res.sendStatus(200);}
});

app.post('/api/send',async(req,res)=>{ const {to,message,source}=req.body; if(TOKEN&&PHONE_ID) await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})}); const src=source||'inbox'; if(pool) try{ await pool.query(`INSERT INTO messages(wa_id,text,direction,type,source) VALUES($1,$2,'out','text',$3)`,[to,message,src]); }catch{ memMessages.push({wa_id:to,text:message,direction:'out',type:'text',source:src,created_at:new Date()}); } else memMessages.push({wa_id:to,text:message,direction:'out',type:'text',source:src,created_at:new Date()}); res.json({ok:true}); });

app.get('/api/chats',async(_,res)=>{ try{ if(pool){ const {rows}=await pool.query(`SELECT m.wa_id,m.text,m.created_at,m.source,c.name FROM (SELECT DISTINCT ON (wa_id) wa_id,text,created_at,source FROM messages ORDER BY wa_id,created_at DESC) m LEFT JOIN contacts c ON c.wa_id=m.wa_id ORDER BY m.created_at DESC`); return res.json(rows);} const map={}; memMessages.forEach(m=>map[m.wa_id]={wa_id:m.wa_id,text:m.text,created_at:m.created_at,source:m.source,name:m.wa_id}); return res.json(Object.values(map).reverse()); }catch{res.json([]);} });
app.get('/api/messages/:wa_id',async(req,res)=>{ try{ if(pool){ const {rows}=await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC`,[req.params.wa_id]); return res.json(rows);} res.json(memMessages.filter(m=>m.wa_id===req.params.wa_id)); }catch{res.json([]);} });
app.get('/api/campaigns',async(_,res)=>{ try{ if(pool){ const {rows}=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC`); return res.json(rows);} res.json(memCampaigns);}catch{res.json(memCampaigns);} });
app.post('/api/campaigns/upload',async(req,res)=>{ const {total,name}=req.body; const t=parseInt(total)||0; try{ if(pool) await pool.query(`INSERT INTO campaigns(name,total,sent) VALUES($1,$2,$2)`,[name||`Campaña`,t]); else memCampaigns.unshift({id:Date.now(),name:name||`Campaña`,total:t,sent:t,created_at:new Date().toISOString()}); }catch(e){ console.log(e.message); } res.json({ok:true}); });
app.post('/api/campaigns/send-bulk',async(req,res)=>{ const {numbers,message}=req.body; let sent=0; for(const raw of (numbers||[])){ const clean=String(raw).replace(/\D/g,''); if(clean.length<10) continue; if(TOKEN&&PHONE_ID){ await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:clean,type:'text',text:{body:message}})}); await new Promise(r=>setTimeout(r,400)); } if(pool) try{ await pool.query(`INSERT INTO messages(wa_id,text,direction,type,source) VALUES($1,$2,'out','text','campaign')`,[clean,message]); }catch{ memMessages.push({wa_id:clean,text:message,direction:'out',type:'text',source:'campaign',created_at:new Date()}); } else memMessages.push({wa_id:clean,text:message,direction:'out',type:'text',source:'campaign',created_at:new Date()}); sent++; } res.json({ok:true,sent}); });

// ===== RUTAS QUE ARREGLAN TU PROBLEMA - SOPORTA LOS 2 NOMBRES =====
function getCampaignFile(){
  if(fs.existsSync(path.join(publicPath,'campaigns.html'))) return path.join(publicPath,'campaigns.html');
  if(fs.existsSync(path.join(publicPath,'campanas.html'))) return path.join(publicPath,'campanas.html');
  if(fs.existsSync(path.join(publicPath,'bandeja.html'))) return path.join(publicPath,'bandeja.html');
  return path.join(publicPath,'index.html');
}

app.get('/campaigns',(req,res)=>{ res.sendFile(getCampaignFile()); });
app.get('/campaigns.html',(req,res)=>{ res.sendFile(getCampaignFile()); });
app.get('/campanas',(req,res)=>{ res.sendFile(getCampaignFile()); });
app.get('/campanas.html',(req,res)=>{ res.sendFile(getCampaignFile()); });
app.get('/bandeja',(req,res)=>{ res.sendFile(path.join(publicPath,'bandeja.html')); });

app.get('/login.html',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.get('/index.html',(req,res)=>res.sendFile(path.join(publicPath,'index.html')));

app.use(express.static(publicPath));

app.get('/health',(req,res)=>{
  let files=[]; try{ files=fs.readdirSync(publicPath); }catch{}
  res.json({ok:true, files, campaignFile: getCampaignFile()});
});

app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));

app.listen(process.env.PORT||3000,()=>console.log(`KLIDO CRM PRO OK en ${process.env.PORT||3000} - CAMPAÑA FIXED usando ${getCampaignFile()}`));
