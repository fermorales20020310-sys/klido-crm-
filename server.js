const express = require('express');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

// Crear carpeta uploads si no existe
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });

// FUNCION CLAVE PARA BAJAR ARCHIVOS
async function descargarMedia(mediaId, fileName) {
  try {
    const info = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    }).then(r=>r.json());

    if(!info.url) return null;

    const file = await fetch(info.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const buffer = Buffer.from(await file.arrayBuffer());

    const filePath = path.join(__dirname, 'public/uploads', fileName);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${fileName}`;
  } catch(e) {
    console.log('Error bajando media', e);
    return null;
  }
}

// VERIFICACION WEBHOOK
app.get('/webhook', (req,res)=>{
  if(req.query['hub.verify_token'] === process.env.VERIFY_TOKEN){
    res.send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

// RECIBIR MENSAJES
app.post('/webhook', async(req,res)=>{
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if(!msg) return res.sendStatus(200);

    const from = msg.from;
    let texto = '';
    let archivoUrl = null;
    let tipo = msg.type;

    if (msg.type === 'text') {
      texto = msg.text.body;
    }
    else if (msg.type === 'image') {
      const fileName = `${msg.image.id}.jpg`;
      archivoUrl = await descargarMedia(msg.image.id, fileName);
      texto = msg.image.caption || '📷 Imagen recibida';
    }
    else if (msg.type === 'document') {
      const fileName = msg.document.filename || `${msg.document.id}.pdf`;
      archivoUrl = await descargarMedia(msg.document.id, fileName);
      texto = `📄 ${msg.document.filename || 'Documento'}`;
    }
    else if (msg.type === 'audio') {
      const fileName = `${msg.audio.id}.ogg`;
      archivoUrl = await descargarMedia(msg.audio.id, fileName);
      texto = `🎤 Audio recibido`;
    }
    else {
      texto = `📎 Archivo recibido (${msg.type})`;
      if(msg[msg.type]?.id){
        archivoUrl = await descargarMedia(msg[msg.type].id, `${msg[msg.type].id}`);
      }
    }

    await pool.query(
      `INSERT INTO messages (wa_id, text, file_url, type, direction, created_at) VALUES ($1,$2,$3,$4,'in', NOW()) ON CONFLICT DO NOTHING`,
      [from, texto, archivoUrl, tipo]
    );

    // actualizar contactos
    await pool.query(`INSERT INTO contacts (wa_id, name) VALUES ($1,$2) ON CONFLICT (wa_id) DO NOTHING`, [from, from]);

    res.sendStatus(200);
  } catch(e){ console.log(e); res.sendStatus(200); }
});

// ENVIAR MENSAJES
app.post('/api/send', async(req,res)=>{
  const { to, message } = req.body;
  await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{
    method:'POST',
    headers:{ 'Authorization':`Bearer ${TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ messaging_product:'whatsapp', to, type:'text', text:{body:message} })
  });
  await pool.query(`INSERT INTO messages (wa_id, text, direction, created_at) VALUES ($1,$2,'out',NOW())`,[to, message]);
  res.json({ok:true});
});

// INBOX
app.get('/api/chats', async(_,res)=>{
  const { rows } = await pool.query(`SELECT DISTINCT ON (wa_id) * FROM messages ORDER BY wa_id, created_at DESC`);
  res.json(rows);
});
app.get('/api/messages/:wa_id', async(req,res)=>{
  const { rows } = await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC`,[req.params.wa_id]);
  res.json(rows);
});

app.listen(process.env.PORT || 3000, ()=> console.log('KLIDO listo'));
