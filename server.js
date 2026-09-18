const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

let pool = null;
try{
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.query(`CREATE TABLE IF NOT EXISTS contacts (phone TEXT PRIMARY KEY, name TEXT, last_message TEXT, unread INT DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, phone TEXT, text TEXT, direction TEXT, timestamp TIMESTAMP DEFAULT NOW());`).then(()=>console.log('✅ DB Lista'));
}catch(e){ console.log('⚠️ Sin PG'); }

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// === ESTO ES LO QUE TE FALTABA PARA QUE META VERIFIQUE ===
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';

app.get('/webhook', (req,res)=>{
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log('Verificación:', mode, token);
  if(mode === 'subscribe' && token === VERIFY_TOKEN){
    console.log('✅ Webhook verificado!');
    res.status(200).send(challenge);
  }else{
    res.sendStatus(403);
  }
});

// Webhook para recibir mensajes REALES de Meta
app.post('/webhook', async (req,res)=>{
  console.log('Mensaje entrante:', JSON.stringify(req.body).slice(0,500));
  try{
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if(msg){
      const phone = msg.from;
      const text = msg.text?.body || msg.image?.caption || '📎 Archivo';
      const name = value.contacts?.[0]?.profile?.name || phone;

      if(pool){
        await pool.query('INSERT INTO messages(phone,text,direction) VALUES($1,$2,\'in\')',[phone,text]);
        await pool.query('INSERT INTO contacts(phone,name,last_message,unread) VALUES($1,$2,$3,1) ON CONFLICT(phone) DO UPDATE SET last_message=$3, unread=contacts.unread+1, updated_at=NOW()',[phone,name,text]);
      }
      console.log(`✅ Guardado ${phone}: ${text}`);
    }
  }catch(e){ console.log('Error webhook', e.message); }
  res.sendStatus(200);
});

// APIs
app.get('/api/contacts', async (req,res)=>{
  if(pool){ try{ let r=await pool.query('SELECT phone, name, last_message as "lastMessage", unread, TO_CHAR(updated_at,\'HH24:MI\') as time FROM contacts ORDER BY updated_at DESC'); return res.json(r.rows); }catch(e){} }
  res.json([]);
});
app.get('/api/messages/:phone', async (req,res)=>{
  if(pool){ try{ let r=await pool.query('SELECT text, direction, timestamp FROM messages WHERE phone=$1 ORDER BY timestamp ASC',[req.params.phone]); return res.json(r.rows); }catch(e){} }
  res.json([]);
});
app.post('/api/send', async (req,res)=>{
  const {phone,message}=req.body;
  // Aquí luego conectamos el envío con la API de Meta
  console.log(`Enviar a ${phone}: ${message}`);
  if(pool){ try{ await pool.query('INSERT INTO messages(phone,text,direction) VALUES($1,$2,\'out\')',[phone,message]); await pool.query('INSERT INTO contacts(phone,name,last_message) VALUES($1,$1,$2) ON CONFLICT(phone) DO UPDATE SET last_message=$2, updated_at=NOW()',[phone,message]); }catch(e){} }
  res.json({ok:true});
});
app.post('/api/read/:phone', async (req,res)=>{
  if(pool){ try{ await pool.query('UPDATE contacts SET unread=0 WHERE phone=$1',[req.params.phone]); }catch(e){} }
  res.json({ok:true});
});

app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000, ()=> console.log('KLIDO corriendo'));
