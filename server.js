const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Servir frontend
app.use(express.static('public'));
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL? { rejectUnauthorized: false } : false
});

// CREAR TABLAS SI NO EXISTEN
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS contacts (wa_id TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, file_url TEXT, type TEXT DEFAULT 'text', direction TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, name TEXT, total INT, sent INT DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);

    // Si no hay historial, crea las 2 de 591 que me pediste
    const { rows } = await pool.query(`SELECT COUNT(*) FROM campaigns`);
    if (parseInt(rows[0].count) === 0) {
      await pool.query(`INSERT INTO campaigns(name,total,sent,created_at) VALUES
        ('Campaña Alion - 14/09',591,591,'2026-09-14 17:19:43'),
        ('Campaña Alion - 17/09',591,591,'2026-09-17 17:19:43')`);
      console.log('Historial 591 creado');
    }
    console.log('DB OK');
  } catch (e) { console.log('Error DB', e.message); }
})();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

// DESCARGAR MEDIA DE WHATSAPP
async function descargarMedia(mediaId, fileName) {
  try {
    if (!TOKEN) return null;
    const infoRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const info = await infoRes.json();
    if (!info.url) return null;

    const fileRes = await fetch(info.url, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${fileName}`;
  } catch (e) {
    console.log('Error bajando media', e.message);
    return null;
  }
}

// WEBHOOK VERIFICACION META
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// WEBHOOK RECIBIR MENSAJES
app.post('/webhook', async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    let texto = '';
    let archivoUrl = null;
    const tipo = msg.type;

    if (msg.type === 'text') texto = msg.text.body;
    else if (msg.type === 'image') {
      const fName = `${msg.id}.jpg`;
      archivoUrl = await descargarMedia(msg.image.id, fName);
      texto = msg.image.caption || '📷 Imagen';
    } else if (msg.type === 'document') {
      const fName = msg.document.filename || `${msg.id}.pdf`;
      archivoUrl = await descargarMedia(msg.document.id, fName);
      texto = `📄 ${msg.document.filename || 'Documento'}`;
    } else if (msg.type === 'audio') {
      const fName = `${msg.id}.ogg`;
      archivoUrl = await descargarMedia(msg.audio.id, fName);
      texto = '🎤 Audio';
    } else {
      texto = `📎 ${msg.type}`;
      if (msg[msg.type]?.id) {
        archivoUrl = await descargarMedia(msg[msg.type].id, `${msg.id}`);
      }
    }

    await pool.query(`INSERT INTO contacts (wa_id, name) VALUES ($1,$2) ON CONFLICT (wa_id) DO NOTHING`, [from, from]);
    await pool.query(`INSERT INTO messages (wa_id, text, file_url, type, direction) VALUES ($1,$2,$3,$4,'in')`, [from, texto, archivoUrl, tipo]);

    res.sendStatus(200);
  } catch (e) {
    console.log(e);
    res.sendStatus(200);
  }
});

// API - ENVIAR MENSAJE
app.post('/api/send', async (req, res) => {
  try {
    const { to, message } = req.body;
    if (TOKEN && PHONE_ID) {
      await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } })
      });
    }
    await pool.query(`INSERT INTO messages (wa_id, text, direction, type) VALUES ($1,$2,'out','text')`, [to, message]);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// API - LISTA DE CHATS (FIX undefined chats)
app.get('/api/chats', async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.wa_id, m.text, m.created_at, c.name
      FROM (
        SELECT DISTINCT ON (wa_id) wa_id, text, created_at
        FROM messages ORDER BY wa_id, created_at DESC
      ) m
      LEFT JOIN contacts c ON c.wa_id = m.wa_id
      ORDER BY m.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    // fallback si falla el DISTINCT ON
    const { rows } = await pool.query(`SELECT wa_id, MAX(text) as text, MAX(created_at) as created_at FROM messages GROUP BY wa_id ORDER BY MAX(created_at) DESC`);
    res.json(rows);
  }
});

// API - MENSAJES DE UN CHAT
app.get('/api/messages/:wa_id', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC`, [req.params.wa_id]);
  res.json(rows);
});

// API - CAMPAÑAS HISTORIAL (2x 591)
app.get('/api/campaigns', async (_, res) => {
  const { rows } = await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC`);
  res.json(rows);
});

// API - SUBIR CAMPAÑA
app.post('/api/campaigns/upload', async (req, res) => {
  try {
    const { total, name } = req.body;
    const t = parseInt(total) || 0;
    await pool.query(`INSERT INTO campaigns(name,total,sent) VALUES($1,$2,$2)`, [name || `Campaña ${new Date().toLocaleDateString()}`, t]);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// API - FIX HISTORIAL MANUAL
app.get('/api/fix-history', async (_, res) => {
  await pool.query(`DELETE FROM campaigns`);
  await pool.query(`INSERT INTO campaigns(name,total,sent,created_at) VALUES('Campaña Alion - 14/09',591,591,'2026-09-14 17:19:43'),('Campaña Alion - 17/09',591,591,'2026-09-17 17:19:43')`);
  res.json({ ok: true, msg: 'Historial 591 restaurado' });
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO PRO OK en puerto ' + PORT));
