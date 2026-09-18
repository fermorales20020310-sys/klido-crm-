const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL? { rejectUnauthorized: false } : false
});

async function initDB(){
  if(!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      phone TEXT PRIMARY KEY, name TEXT, last_message TEXT,
      unread INT DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW()
    );`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY, phone TEXT, text TEXT,
      direction TEXT, timestamp TIMESTAMP DEFAULT NOW()
    );`);
  console.log('DB KLIDO PRO lista');
}
initDB();

let memory = { contacts: [], messages: {} };

async function saveMessage(phone, name, text, direction){
  if(!process.env.DATABASE_URL){
    if(!memory.messages[phone]) memory.messages[phone]=[];
    memory.messages[phone].push({text, direction, timestamp:new Date()});
    let c=memory.contacts.find(x=>x.phone===phone);
    if(!c) memory.contacts.unshift({phone, name, lastMessage:text, unread: direction==='in'?1:0, time:'ahora'});
    else { c.lastMessage=text; if(direction==='in') c.unread++; }
    return;
  }
  await pool.query(`INSERT INTO contacts(phone,name,last_message,unread,updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(phone) DO UPDATE SET last_message=$3, unread = CASE WHEN $4=1 THEN contacts.unread+1 ELSE contacts.unread END, updated_at=NOW()`, [phone, name, text, direction==='in'?1:0]);
  await pool.query('INSERT INTO messages(phone,text,direction) VALUES($1,$2,$3)', [phone,text,direction]);
}

// WEBHOOK
app.get('/webhook', (req,res)=>{
  if(req.query['hub.verify_token']===process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});
app.post('/webhook', async (req,res)=>{
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const contact = req.body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
  if(msg){
    await saveMessage(msg.from, contact?.profile?.name||msg.from, msg.text?.body||'[archivo]', 'in');
  }
  res.sendStatus(200);
});

app.get('/api/contacts', async (req,res)=>{
  if(!process.env.DATABASE_URL) return res.json(memory.contacts);
  const {rows}=await pool.query('SELECT * FROM contacts ORDER BY updated_at DESC');
  res.json(rows.map(r=>({phone:r.phone, name:r.name, lastMessage:r.last_message, unread:r.unread, time:new Date(r.updated_at).toLocaleTimeString()})));
});
app.get('/api/messages/:phone', async (req,res)=>{
  if(!process.env.DATABASE_URL) return res.json(memory.messages[req.params.phone]||[]);
  const {rows}=await pool.query('SELECT * FROM messages WHERE phone=$1 ORDER BY timestamp ASC',[req.params.phone]);
  res.json(rows.map(r=>({text:r.text, direction:r.direction, timestamp:r.timestamp})));
});
app.post('/api/read/:phone', async (req,res)=>{
  if(process.env.DATABASE_URL) await pool.query('UPDATE contacts SET unread=0 WHERE phone=$1',[req.params.phone]);
  else { let c=memory.contacts.find(x=>x.phone===req.params.phone); if(c) c.unread=0; }
  res.json({ok:true});
});
app.post('/api/send', async (req,res)=>{
  const {phone, message}=req.body;
  try{
    await axios.post(`https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      messaging_product:'whatsapp', to:phone, type:'text', text:{body:message}
    }, {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    await saveMessage(phone, phone, message, 'out');
    res.json({ok:true});
  }catch(e){ console.log(e.response?.data); res.status(500).json({error:'Error enviando'}); }
});

app.listen(process.env.PORT||3000, ()=>console.log('KLIDO PRO corriendo'));
