const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';

app.get('/webhook', (req,res)=>{
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook', async (req,res)=>{
  try{
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const contact = req.body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
    if(!msg) return res.sendStatus(200);
    const phone = msg.from;
    const body = msg.text?.body || "[archivo]";
    const name = contact?.profile?.name || phone;
    await pool.query(`INSERT INTO contacts(phone,name,last_message,tag) VALUES($1,$2,$3,'campana') ON CONFLICT(phone) DO UPDATE SET last_message=$3, updated_at=NOW()`, [phone,name,body]);
    await pool.query(`INSERT INTO messages(phone,body,from_me) VALUES($1,$2,false)`, [phone,body]);
    res.sendStatus(200);
  }catch(e){ console.error(e.message); res.sendStatus(200); }
});

app.get('/api/contacts', async (req,res)=>{ const r=await pool.query(`SELECT * FROM contacts ORDER BY updated_at DESC`); res.json(r.rows); });
app.get('/api/messages/:phone', async (req,res)=>{ const r=await pool.query(`SELECT * FROM messages WHERE phone=$1 ORDER BY created_at ASC`, [req.params.phone]); res.json(r.rows); });
app.post('/api/send', async (req,res)=>{
  const {phone,message}=req.body;
  try{
    await axios.post(`https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`, {messaging_product:"whatsapp",to:phone,text:{body:message}}, {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    await pool.query(`INSERT INTO messages(phone,body,from_me) VALUES($1,$2,true)`, [phone,message]);
    await pool.query(`UPDATE contacts SET last_message=$2, updated_at=NOW() WHERE phone=$1`, [phone,message]);
    res.json({ok:true});
  }catch(e){ res.json({error:e.response?.data||e.message}); }
});
app.post('/api/tag', async (req,res)=>{ await pool.query(`UPDATE contacts SET tag=$2 WHERE phone=$1`, [req.body.phone,req.body.tag]); res.json({ok:true}); });
app.get('/test', async (req,res)=>{
  const body="Prueba KLIDO "+new Date().toLocaleTimeString();
  await pool.query(`INSERT INTO contacts(phone,name,last_message,tag) VALUES('573001112233','Fer Prueba',$1,'campana') ON CONFLICT(phone) DO UPDATE SET last_message=$1, updated_at=NOW()`, [body]);
  await pool.query(`INSERT INTO messages(phone,body,from_me) VALUES('573001112233',$1,false)`, [body]);
  res.send("OK - Ve al CRM");
});
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000, ()=>console.log("KLIDO listo"));
