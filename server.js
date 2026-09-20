const express = require('express');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      wa_id TEXT UNIQUE,
      name TEXT,
      last_message TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER REFERENCES conversations(id),
      wa_id TEXT,
      direction TEXT,
      body TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('KLIDO ON - DB ready');
}
initDB();

// VERIFY WEBHOOK
app.get('/webhook', (req,res)=>{
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('TOKEN ESPERADO:', process.env.VERIFY_TOKEN, 'RECIBIDO:', token);

  if(mode==='subscribe' && token===process.env.VERIFY_TOKEN){
    console.log('WEBHOOK VERIFICADO');
    res.send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// RECEIVE MESSAGES
app.post('/webhook', async (req,res)=>{
  console.log('WEBHOOK RECIBIDO:', JSON.stringify(req.body).substring(0,1000));
  try{
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    if(msg){
      const wa_id = msg.from;
      const body = msg.text?.body || '';
      const name = value.contacts?.[0]?.profile?.name || wa_id;

      let conv = await pool.query('SELECT * FROM conversations WHERE wa_id=$1',[wa_id]);
      let convId;
      if(conv.rows.length===0){
        const r = await pool.query('INSERT INTO conversations (wa_id,name,last_message) VALUES ($1,$2,$3) RETURNING id', [wa_id,name,body]);
        convId = r.rows[0].id;
      } else {
        convId = conv.rows[0].id;
        await pool.query('UPDATE conversations SET last_message=$1, updated_at=NOW(), name=$2 WHERE id=$3',[body,name,convId]);
      }
      await pool.query('INSERT INTO messages (conversation_id, wa_id, direction, body) VALUES ($1,$2,$3,$4)',[convId,wa_id,'in',body]);
      console.log('Mensaje guardado:', body);
    }
  }catch(e){ console.error(e); }
  res.sendStatus(200);
});

// API for frontend
app.get('/api/conversations', async (req,res)=>{
  const r = await pool.query('SELECT * FROM conversations ORDER BY updated_at DESC');
  res.json(r.rows);
});
app.get('/api/messages/:wa_id', async (req,res)=>{
  const c = await pool.query('SELECT id FROM conversations WHERE wa_id=$1',[req.params.wa_id]);
  if(!c.rows.length) return res.json([]);
  const m = await pool.query('SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC', [c.rows[0].id]);
  res.json(m.rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Server on', PORT));
