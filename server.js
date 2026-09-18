const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

let pool = null;
try{
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.query(`CREATE TABLE IF NOT EXISTS contacts (phone TEXT PRIMARY KEY, name TEXT, last_message TEXT, unread INT DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, phone TEXT, text TEXT, direction TEXT, timestamp TIMESTAMP DEFAULT NOW());`).then(()=>console.log('✅ DB Lista')).catch(e=>console.log('DB error',e.message));
}catch(e){ console.log('⚠️ Sin PG, modo memoria'); }

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let memContacts = [{phone:'573001112233', name:'Cliente Prueba', lastMessage:'Hola, info por favor', unread:1, time:'10:30'}];
let memMessages = { '573001112233': [{text:'Hola, info por favor', direction:'in', timestamp: new Date()}] };

app.get('/api/contacts', async (req,res)=>{
  if(pool){ try{ let r=await pool.query('SELECT phone, name, last_message as "lastMessage", unread, TO_CHAR(updated_at,\'HH24:MI\') as time FROM contacts ORDER BY updated_at DESC'); return res.json(r.rows); }catch(e){} }
  res.json(memContacts);
});
app.get('/api/messages/:phone', async (req,res)=>{
  if(pool){ try{ let r=await pool.query('SELECT text, direction, timestamp FROM messages WHERE phone=$1 ORDER BY timestamp ASC', [req.params.phone]); return res.json(r.rows); }catch(e){} }
  res.json(memMessages[req.params.phone]||[]);
});
app.post('/api/send', async (req,res)=>{ 
  const {phone,message}=req.body;
  if(pool){ try{ await pool.query('INSERT INTO messages(phone,text,direction) VALUES($1,$2,\'out\')',[phone,message]); await pool.query('INSERT INTO contacts(phone,name,last_message) VALUES($1,$1,$2) ON CONFLICT(phone) DO UPDATE SET last_message=$2, updated_at=NOW()',[phone,message]); }catch(e){} }
  res.json({ok:true}); 
});
app.post('/api/read/:phone', (req,res)=> res.json({ok:true}));
app.post('/webhook', (req,res)=> res.json({ok:true}));
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(process.env.PORT||3000, ()=> console.log('KLIDO corriendo'));
