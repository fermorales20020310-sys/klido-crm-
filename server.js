const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

let pool = null;

// --- CONEXIÓN DB CON MIGRACIÓN AUTOMÁTICA ---
async function initDB(){
  try{
    const { Pool } = require('pg');
    if(!process.env.DATABASE_URL){ console.log('⚠️ No DATABASE_URL'); return; }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    // Crear tablas si no existen
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        phone TEXT PRIMARY KEY,
        name TEXT,
        last_message TEXT,
        unread INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        text TEXT,
        body TEXT,
        direction TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      );
    `);

    // FIX PARA TU ERROR: agrega columnas si faltan
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS text TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS body TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS phone TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unread INT DEFAULT 0;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_message TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name TEXT;`);

    console.log('✅ DB Lista - Migración OK');
  }catch(e){
    console.log('⚠️ Error DB', e.message);
  }
}
initDB();

const app = express();
app.use(cors());
app.use(bodyParser.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public')));

// --- VERIFICACIÓN META (GET) ---
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';

app.get('/webhook', (req,res)=>{
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔍 Verificación webhook:', mode, token);

  if(mode === 'subscribe' && token === VERIFY_TOKEN){
    console.log('✅ Webhook verificado por Meta!');
    return res.status(200).send(challenge);
  }else{
    console.log('❌ Token no coincide');
    return res.sendStatus(403);
  }
});

// --- RECIBIR MENSAJES DE META (POST) ---
app.post('/webhook', async (req,res)=>{
  try{
    // Log completo para debug
    console.log('📩 Webhook entrante:', JSON.stringify(req.body).substring(0,800));

    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if(msg && pool){
      const phone = msg.from;
      const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '📎 Archivo';
      const name = value.contacts?.[0]?.profile?.name || phone;

      console.log(`💬 Nuevo de ${name} (${phone}): ${text}`);

      // Guardar en 2 columnas para compatibilidad
      await pool.query(
        'INSERT INTO messages(phone,text,body,direction) VALUES($1,$2,$2,$3)',
        [phone, text, 'in']
      );

      await pool.query(`
        INSERT INTO contacts(phone,name,last_message,unread,updated_at)
        VALUES($1,$2,$3,1,NOW())
        ON CONFLICT(phone)
        DO UPDATE SET last_message=$3, unread=contacts.unread+1, updated_at=NOW(), name=$2
      `, [phone, name, text]);

      console.log(`✅ Guardado ${phone} en BD`);
    }
  }catch(e){
    console.log('❌ Error webhook:', e.message, e.stack);
  }
  res.sendStatus(200);
});

// --- APIS ---

app.get('/api/contacts', async (req,res)=>{
  if(!pool) return res.json([]);
  try{
    let r=await pool.query(`
      SELECT phone, name, last_message as "lastMessage", unread,
      TO_CHAR(updated_at,'HH24:MI') as time
      FROM contacts
      ORDER BY updated_at DESC
    `);
    res.json(r.rows);
  }catch(e){
    console.log('Error contacts', e.message);
    res.json([]);
  }
});

app.get('/api/messages/:phone', async (req,res)=>{
  if(!pool) return res.json([]);
  try{
    let r=await pool.query(`
      SELECT COALESCE(text,body) as text, direction, timestamp
      FROM messages
      WHERE phone=$1
      ORDER BY timestamp ASC
    `,[req.params.phone]);
    res.json(r.rows);
  }catch(e){
    console.log('Error messages', e.message);
    res.json([]);
  }
});

// ENVIAR MENSAJE - con anti-spam y API oficial opcional
app.post('/api/send', async (req,res)=>{
  const {phone, message} = req.body;
  console.log(`📤 Enviando a ${phone}: ${message.substring(0,50)}...`);

  // 1. Guardar en BD siempre
  if(pool){
    try{
      await pool.query('INSERT INTO messages(phone,text,body,direction) VALUES($1,$2,$2,$3)',[phone,message,'out']);
      await pool.query(`
        INSERT INTO contacts(phone,name,last_message,updated_at)
        VALUES($1,$1,$2,NOW())
        ON CONFLICT(phone) DO UPDATE SET last_message=$2, updated_at=NOW()
      `,[phone,message]);
    }catch(e){ console.log('Error save out', e.message); }
  }

  // 2. Si tienes API oficial de Meta configurada, envía real
  if(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID){
    try{
      const resp = await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,{
        method:'POST',
        headers:{
          'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type':'application/json'
        },
        body: JSON.stringify({
          messaging_product:'whatsapp',
          to: phone,
          type:'text',
          text:{body:message}
        })
      });
      const data = await resp.json();
      console.log('Meta API resp:', data);
    }catch(e){ console.log('Error Meta API', e.message); }
  }

  res.json({ok:true});
});

app.post('/api/read/:phone', async (req,res)=>{
  if(pool){
    try{ await pool.query('UPDATE contacts SET unread=0 WHERE phone=$1',[req.params.phone]); }catch(e){}
  }
  res.json({ok:true});
});

// Catch all para SPA
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`🚀 KLIDO CRM corriendo en ${PORT} - Token: ${VERIFY_TOKEN}`));
