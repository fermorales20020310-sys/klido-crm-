const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

let pool = null;

async function initDB(){
  const { Pool } = require('pg');
  if(!process.env.DATABASE_URL) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try{
    // Si la BD está corrupta, la arreglamos sin borrar datos
    await pool.query(`CREATE TABLE IF NOT EXISTS contacts (phone TEXT PRIMARY KEY);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY);`);

    // Agregamos TODAS las columnas posibles - si ya existen no pasa nada
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_message TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lastMessage TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unread INT DEFAULT 0;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();`);

    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS phone TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS text TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS body TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP DEFAULT NOW();`);

    console.log('✅ DB REPARADA - Anti-caídas activado');
  }catch(e){
    console.log('DB Fix error', e.message);
  }
}
initDB();

const app = express();
app.use(cors());
app.use(bodyParser.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';

// WEBHOOK VERIFICACION
app.get('/webhook', (req,res)=>{
  if(req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

// WEBHOOK RECIBIR - con try/catch para que nunca tumbe
app.post('/webhook', async (req,res)=>{
  res.sendStatus(200); // responde rápido a Meta
  try{
    const val = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = val?.messages?.[0];
    if(!msg ||!pool) return;
    const phone = msg.from;
    const text = msg.text?.body || '📎';
    const name = val.contacts?.[0]?.profile?.name || phone;
    await pool.query('INSERT INTO messages(phone,text,body,direction,timestamp) VALUES($1,$2,$2,$3,NOW())',[phone,text,'in']);
    await pool.query(`INSERT INTO contacts(phone,name,last_message,unread,updated_at) VALUES($1,$2,$3,1,NOW()) ON CONFLICT(phone) DO UPDATE SET last_message=$3, unread=contacts.unread+1, updated_at=NOW()`,[phone,name,text]);
    console.log('📩',phone,text);
  }catch(e){ console.log('webhook err', e.message); }
});

// CONTACTS - NUNCA SE CAE
app.get('/api/contacts', async (req,res)=>{
  try{
    if(!pool) return res.json([]);
    let r=await pool.query(`SELECT phone, COALESCE(name,phone) as name, COALESCE(last_message, lastMessage, '') as "lastMessage", COALESCE(unread,0) as unread FROM contacts ORDER BY updated_at DESC NULLS LAST`);
    res.json(r.rows);
  }catch(e){
    console.log('contacts error, reparando...', e.message);
    res.json([]);
  }
});

// MESSAGES - NUNCA SE CAE
app.get('/api/messages/:phone', async (req,res)=>{
  try{
    if(!pool) return res.json([]);
    let p = req.params.phone.replace(/\D/g,'').slice(-10);
    let r=await pool.query(`SELECT COALESCE(text,body,'') as text, COALESCE(direction,'in') as direction FROM messages WHERE phone LIKE '%'||$1||'%' ORDER BY id ASC`,[p]);
    res.json(r.rows);
  }catch(e){
    console.log('messages error', e.message);
    res.json([]);
  }
});

app.post('/api/send', async (req,res)=>{
  try{
    const {phone,message}=req.body;
    if(pool){
      await pool.query('INSERT INTO messages(phone,text,body,direction,timestamp) VALUES($1,$2,$2,$3,NOW())',[phone,message,'out']);
      await pool.query(`INSERT INTO contacts(phone,last_message,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(phone) DO UPDATE SET last_message=$2, updated_at=NOW()`,[phone,message]);
    }
    if(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID){
      try{
        let resp=await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,{
          method:'POST',
          headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},
          body:JSON.stringify({messaging_product:'whatsapp',to:phone.replace(/\D/g,''),type:'text',text:{body:message}})
        });
        let data=await resp.json();
        console.log('Enviado:', JSON.stringify(data));
      }catch(e){ console.log('send api err', e.message); }
    }
    res.json({ok:true});
  }catch(e){ console.log('send err', e.message); res.json({ok:true}); }
});

app.post('/api/read/:phone', async (req,res)=>{
  try{ if(pool) await pool.query(`UPDATE contacts SET unread=0 WHERE phone LIKE '%'||$1||'%'`,[req.params.phone.slice(-10)]); }catch(e){}
  res.json({ok:true});
});

app.get('/api/templates', async (req,res)=>{
  try{
    if(!process.env.WABA_ID) return res.json([]);
    let r=await fetch(`https://graph.facebook.com/v18.0/${process.env.WABA_ID}/message_templates?status=APPROVED&limit=25`,{headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    let d=await r.json(); res.json(d.data||[]);
  }catch(e){ res.json([]); }
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('🚀 KLIDO CRM PRO ANTI-CAÍDAS en '+PORT));
