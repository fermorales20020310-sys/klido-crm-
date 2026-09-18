const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// DB - usa la variable de Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Crear tablas si no existen
async function initDB(){
  try{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        phone TEXT PRIMARY KEY,
        name TEXT,
        last_message TEXT,
        unread INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        text TEXT,
        direction TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ DB Lista');
  }catch(e){ console.log('Error DB:', e.message); }
}
initDB();

// SERVIR FRONTEND
app.use(express.static(path.join(__dirname, 'public')));

// API CONTACTS
app.get('/api/contacts', async (req,res)=>{
  try{
    let r = await pool.query('SELECT phone, name, last_message as "lastMessage", unread, TO_CHAR(updated_at,\'HH24:MI\') as time FROM contacts ORDER BY updated_at DESC');
    res.json(r.rows);
  }catch(e){ res.json([]); }
});

// API MESSAGES
app.get('/api/messages/:phone', async (req,res)=>{
  try{
    let r = await pool.query('SELECT text, direction, timestamp FROM messages WHERE phone=$1 ORDER BY timestamp ASC', [req.params.phone]);
    res.json(r.rows);
  }catch(e){ res.json([]); }
});

// API SEND (aquí va tu lógica de Evolution/Wa API)
app.post('/api/send', async (req,res)=>{
  const { phone, message } = req.body;
  try{
    await pool.query('INSERT INTO messages(phone,text,direction) VALUES($1,$2,\'out\')', [phone,message]);
    await pool.query('INSERT INTO contacts(phone,name,last_message) VALUES($1,$1,$2) ON CONFLICT(phone) DO UPDATE SET last_message=$2, updated_at=NOW()', [phone,message]);
    // AQUÍ CONECTA TU WHATSAPP API REAL
    console.log(`Enviando a ${phone}: ${message}`);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/read/:phone', async (req,res)=>{
  try{ await pool.query('UPDATE contacts SET unread=0 WHERE phone=$1', [req.params.phone]); res.json({ok:true}); }catch(e){res.json({ok:true});}
});

// Webhook para recibir mensajes (Evolution API debe apuntar aquí)
app.post('/webhook', async (req,res)=>{
  try{
    const phone = req.body.phone || req.body.from || 'unknown';
    const text = req.body.text || req.body.message || '';
    const name = req.body.pushName || phone;
    if(text){
      await pool.query('INSERT INTO messages(phone,text,direction) VALUES($1,$2,\'in\')', [phone,text]);
      await pool.query('INSERT INTO contacts(phone,name,last_message,unread) VALUES($1,$2,$3,1) ON CONFLICT(phone) DO UPDATE SET last_message=$3, unread=contacts.unread+1, updated_at=NOW()', [phone,name,text]);
    }
    res.json({ok:true});
  }catch(e){ res.json({ok:true}); }
});

app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('KLIDO corriendo en '+PORT));
