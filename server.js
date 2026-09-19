const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({limit:'30mb'}));
app.use(express.static('public'));
const uploadDir = path.join(__dirname,'public','uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
app.use('/uploads',express.static(uploadDir));

const pool = new Pool({connectionString:process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?{rejectUnauthorized:false}:false});

(async()=>{
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts (wa_id TEXT PRIMARY KEY, name TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, file_url TEXT, type TEXT, direction TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, name TEXT, total INT, sent INT, created_at TIMESTAMP DEFAULT NOW())`);
  const {rows} = await pool.query(`SELECT COUNT(*) FROM campaigns`);
  if(parseInt(rows[0].count)===0){
    await pool.query(`INSERT INTO campaigns(name,total,sent,created_at) VALUES('Campaña Alion - 14/09',591,591,'2026-09-14 17:19:43'),('Campaña Alion - 17/09',591,591,'2026-09-17 17:19:43')`);
  }
})();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

async function descargarMedia(id, name){
  try{
    const r1 = await fetch(`https://graph.facebook.com/v20.0/${id}`,{headers:{Authorization:`Bearer ${TOKEN}`}});
    const j = await r1.json(); if(!j.url) return null;
    const r2 = await fetch(j.url,{headers:{Authorization:`Bearer ${TOKEN}`}});
    const buf = Buffer.from(await r2.arrayBuffer());
    fs.writeFileSync(path.join(uploadDir,name),buf);
    return `/uploads/${name}`;
  }catch(e){return null}
}

app.get('/webhook',(req,res)=>{
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});
app.post('/webhook',async(req,res)=>{
  try{
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    let txt='', url=null;
    if(msg.type==='text') txt=msg.text.body;
    else if(msg.type==='image'){ url=await descargarMedia(msg.image.id,`${msg.id}.jpg`); txt=msg.image.caption||'📷 Imagen'; }
    else if(msg.type==='document'){ url=await descargarMedia(msg.document.id,msg.document.filename||`${msg.id}.pdf`); txt=`📄 ${msg.document.filename}`; }
    else if(msg.type==='audio'){ url=await descargarMedia(msg.audio.id,`${msg.id}.ogg`); txt='🎤 Audio'; }
    await pool.query(`INSERT INTO contacts(wa_id,name) VALUES($1,$2) ON CONFLICT(wa_id) DO NOTHING`,[msg.from,msg.from]);
    await pool.query(`INSERT INTO messages(wa_id,text,file_url,type,direction) VALUES($1,$2,$3,$4,'in')`,[msg.from,txt,url,msg.type]);
    res.sendStatus(200);
  }catch(e){res.sendStatus(200)}
});

app.post('/api/send',async(req,res)=>{
  const {to,message}=req.body;
  if(TOKEN&&PHONE_ID) await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})});
  await pool.query(`INSERT INTO messages(wa_id,text,direction,type) VALUES($1,$2,'out','text')`,[to,message]);
  res.json({ok:true});
});
app.get('/api/chats',async(_,res)=>{
  const {rows}=await pool.query(`SELECT m.wa_id, m.text, m.created_at, c.name FROM (SELECT DISTINCT ON (wa_id) wa_id,text,created_at FROM messages ORDER BY wa_id,created_at DESC) m LEFT JOIN contacts c ON c.wa_id=m.wa_id ORDER BY m.created_at DESC`);
  res.json(rows);
});
app.get('/api/messages/:wa_id',async(req,res)=>{
  const {rows}=await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC`,[req.params.wa_id]); res.json(rows);
});
app.get('/api/campaigns',async(_,res)=>{
  const {rows}=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC`); res.json(rows);
});
app.post('/api/campaigns/upload',async(req,res)=>{
  const {total,name}=req.body;
  await pool.query(`INSERT INTO campaigns(name,total,sent) VALUES($1,$2,$2)`,[name||`Campaña ${new Date().toLocaleDateString()}`, parseInt(total)||0]);
  res.json({ok:true});
});
app.get('/',(_,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000,()=>console.log('KLIDO CRM PRO BLANCO OK'));
