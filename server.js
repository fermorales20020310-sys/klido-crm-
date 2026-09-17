const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        phone TEXT PRIMARY KEY,
        name TEXT,
        last_message TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        body TEXT,
        from_me BOOLEAN,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("DB OK");
  }catch(e){ console.log("DB Error pero no me caigo:", e.message); }
}
initDB();

// Webhook verificación
app.get('/webhook', (req,res)=>{
  if(req.query['hub.verify_token'] === (process.env.VERIFY_TOKEN||'klido123')){
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Webhook recibe mensajes
app.post('/webhook', async (req,res)=>{
  try{
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if(msg){
      const phone = msg.from;
      const body = msg.text?.body || '[archivo]';
      const name = entry.contacts?.[0]?.profile?.name || '';
      console.log("Mensaje de", phone, body);
      await pool.query(`INSERT INTO contacts (phone,name,last_message) VALUES ($1,$2,$3) ON CONFLICT (phone) DO UPDATE SET last_message=$3, updated_at=NOW(), name=COALESCE(NULLIF($2,''),contacts.name)`, [phone,name,body]);
      await pool.query(`INSERT INTO messages (phone,body,from_me) VALUES ($1,$2,false)`, [phone,body]);
    }
  }catch(e){ console.log("Webhook error", e.message); }
  res.sendStatus(200);
});

app.get('/api/contacts', async (req,res)=>{
  try{
    const r = await pool.query(`SELECT * FROM contacts ORDER BY updated_at DESC`);
    res.json(r.rows);
  }catch(e){ res.json([]); }
});

app.get('/api/messages/:phone', async (req,res)=>{
  try{
    const r = await pool.query(`SELECT * FROM messages WHERE phone=$1 ORDER BY created_at ASC LIMIT 200`, [req.params.phone]);
    res.json(r.rows);
  }catch(e){ res.json([]); }
});

app.post('/api/send', async (req,res)=>{
  try{
    const {phone,body} = req.body;
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;
    await axios.post(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      messaging_product: "whatsapp", to: phone, text: { body }
    }, { headers: { Authorization: `Bearer ${token}` } });
    await pool.query(`INSERT INTO messages (phone,body,from_me) VALUES ($1,$2,true)`, [phone,body]);
    res.json({ok:true});
  }catch(e){ console.log(e.response?.data||e.message); res.status(500).json({error:e.message}); }
});

app.post('/api/campaigns/send', async (req,res)=>{
  const {contacts, templateName} = req.body;
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.PHONE_NUMBER_ID;
  let sent=0;
  for(const c of contacts){
    try{
      await axios.post(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        messaging_product: "whatsapp", to: c.phone,
        template: { name: templateName, language: { code: "es" } }
      }, { headers: { Authorization: `Bearer ${token}` } });
      sent++; await new Promise(r=>setTimeout(r,1100));
    }catch(e){ console.log("Fail",c.phone, e.response?.data); }
  }
  res.json({sent});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Klido CRM con campañas listo en ${PORT}`));
