const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// WEBHOOK VERIFICATION - Esto es lo que pones en Meta
app.get('/webhook', (req,res)=>{
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if(mode==='subscribe' && token===VERIFY_TOKEN){ console.log("WEBHOOK VERIFICADO"); return res.status(200).send(challenge); }
  return res.sendStatus(403);
});

// ESTA ES LA URL QUE DEBES PEGAR EN META:
// https://klido-crm-production.up.railway.app/webhook

app.post(['/webhook','/webhook/whatsapp'], async (req,res)=>{
  try{
    console.log("LLEGO MENSAJE:", JSON.stringify(req.body).slice(0,2000));
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    if(!msg) return res.sendStatus(200);

    const phone = msg.from;
    const body = msg.text?.body || msg.image?.caption || "[archivo]";
    const name = value.contacts?.[0]?.profile?.name || phone;

    await pool.query(`INSERT INTO contacts(phone,name,last_message,tag) VALUES($1,$2,$3,'campana') ON CONFLICT(phone) DO UPDATE SET last_message=$3, tag=COALESCE(contacts.tag,'campana'), updated_at=NOW()`, [phone,name,body]);
    await pool.query(`INSERT INTO messages(phone,body,from_me) VALUES($1,$2,false)`, [phone,body]);

    res.sendStatus(200);
  }catch(e){ console.error("Error webhook:", e.message); res.sendStatus(200); }
});

app.get('/test', async (req,res)=>{
  const phone = "573001112233";
  const body = "prueba manual KLIDO " + new Date().toLocaleTimeString();
  await pool.query(`INSERT INTO contacts(phone,name,last_message,tag) VALUES($1,$2,$3,'campana') ON CONFLICT(phone) DO UPDATE SET last_message=$3, tag='campana', updated_at=NOW()`, [phone,"Fer Prueba",body]);
  await pool.query(`INSERT INTO messages(phone,body,from_me) VALUES($1,$2,false)`, [phone,body]);
  res.send("OK - Ve a tu CRM, debe aparecer Fer Prueba");
});

app.get('/api/health', async (req,res)=>{
  try{ await pool.query('SELECT 1'); res.send('KLIDO con colores listo - DB OK con tags'); }
  catch(e){ res.send('DB Error: '+e.message); }
});

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("KLIDO en "+PORT));
