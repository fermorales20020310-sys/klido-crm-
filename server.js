const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

let pool = null;

async function initDB(){
  try{
    const { Pool } = require('pg');
    if(!process.env.DATABASE_URL) return;
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query(`CREATE TABLE IF NOT EXISTS contacts (phone TEXT PRIMARY KEY, name TEXT, last_message TEXT, unread INT DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, phone TEXT, text TEXT, body TEXT, direction TEXT, timestamp TIMESTAMP DEFAULT NOW());`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS text TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS body TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS phone TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unread INT DEFAULT 0;`);
    console.log('✅ DB Lista');
  }catch(e){ console.log('DB Error', e.message); }
}
initDB();

const app = express();
app.use(cors());
app.use(bodyParser.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';

// VERIFICACION
app.get('/webhook',(req,res)=>{
  if(req.query['hub.mode']=='subscribe' && req.query['hub.verify_token']==VERIFY_TOKEN){
    console.log('✅ Webhook verificado'); return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// RECIBIR
app.post('/webhook', async(req,res)=>{
  try{
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    if(msg && pool){
      const phone = msg.from;
      const text = msg.text?.body || '📎 archivo';
      const name = value.contacts?.[0]?.profile?.name || phone;
      console.log(`📩 ${name} ${phone}: ${text}`);
      await pool.query('INSERT INTO messages(phone,text,body,direction) VALUES($1,$2,$2,$3)',[phone,text,'in']);
      await pool.query(`INSERT INTO contacts(phone,name,last_message,unread,updated_at) VALUES($1,$2,$3,1,NOW()) ON CONFLICT(phone) DO UPDATE SET last_message=$3, unread=contacts.unread+1, updated_at=NOW(), name=$2`,[phone,name,text]);
    }
  }catch(e){ console.log('webhook err', e.message); }
  res.sendStatus(200);
});

// APIS
app.get('/api/contacts', async(req,res)=>{
  if(!pool) return res.json([]);
  let r=await pool.query(`SELECT phone, name, last_message as "lastMessage", unread FROM contacts ORDER BY updated_at DESC`);
  res.json(r.rows);
});

app.get('/api/messages/:phone', async(req,res)=>{
  if(!pool) return res.json([]);
  let phone = req.params.phone.replace(/\D/g,'').slice(-10);
  let r=await pool.query(`SELECT COALESCE(text,body,'') as text, direction, timestamp FROM messages WHERE phone LIKE '%' || $1 || '%' ORDER BY timestamp ASC`,[phone]);
  res.json(r.rows);
});

app.post('/api/send', async(req,res)=>{
  const {phone,message}=req.body;
  let cleanPhone = phone.replace(/\D/g,'');
  if(pool) {
    await pool.query('INSERT INTO messages(phone,text,body,direction) VALUES($1,$2,$2,$3)',[cleanPhone,message,'out']);
    await pool.query(`INSERT INTO contacts(phone,name,last_message,updated_at) VALUES($1,$1,$2,NOW()) ON CONFLICT(phone) DO UPDATE SET last_message=$2, updated_at=NOW()`,[cleanPhone,message]);
  }
  // ENVIO REAL A META
  if(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID){
    try{
      let resp = await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,{
        method:'POST',
        headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},
        body: JSON.stringify({messaging_product:'whatsapp',to:cleanPhone,type:'text',text:{body:message}})
      });
      let data = await resp.json();
      console.log('📤 Meta:', JSON.stringify(data));
      return res.json(data);
    }catch(e){ console.log('send err', e.message); return res.json({error:e.message}); }
  }
  res.json({ok:true, warning:'Sin WHATSAPP_TOKEN, solo guardado'});
});

app.post('/api/read/:phone', async(req,res)=>{
  if(pool) await pool.query('UPDATE contacts SET unread=0 WHERE phone LIKE $1',['%'+req.params.phone.slice(-10)+'%']);
  res.json({ok:true});
});

app.get('/api/templates', async(req,res)=>{
  if(!process.env.WHATSAPP_TOKEN ||!process.env.WABA_ID) return res.json({error:'Falta WABA_ID y WHATSAPP_TOKEN en Railway Variables'});
  try{
    let r=await fetch(`https://graph.facebook.com/v18.0/${process.env.WABA_ID}/message_templates?status=APPROVED&limit=50`,{headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    let d=await r.json();
    res.json(d.data||[]);
  }catch(e){ res.json({error:e.message}); }
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000,()=>console.log('🚀 KLIDO CRM en '+ (process.env.PORT||3000)));
