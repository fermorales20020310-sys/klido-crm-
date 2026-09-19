const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const mediaDir = path.join(__dirname, 'public', 'media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
app.use('/media', express.static(mediaDir));

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY = process.env.VERIFY_TOKEN || 'klido123';

if (!TOKEN) console.warn('⚠️ Falta WHATSAPP_TOKEN');
if (!PHONE_ID) console.warn('⚠️ Falta PHONE_NUMBER_ID');
if (!process.env.DATABASE_URL) console.warn('⚠️ Falta DATABASE_URL');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, direction TEXT, text TEXT, source TEXT DEFAULT 'chat', media_url TEXT, media_type TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS conversations(wa_id TEXT PRIMARY KEY, last_message TEXT, unread_count INT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, name TEXT, template TEXT, total INT, sent INT DEFAULT 0, failed INT DEFAULT 0, status TEXT DEFAULT 'enviada', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS source TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC)`);
    console.log('✅ DB OK');
  } catch (e) { console.error('DB init error:', e.message); }
}
initDB();

// Verificación Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY) {
    console.log('Webhook verificado');
    res.status(200).send(challenge);
  } else if (req.query['hub.verify_token'] === VERIFY) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Recepción mensajes
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const val = change?.value;
    if (!val?.messages) return;

    for (const m of val.messages) {
      const wa_id = m.from;
      let text = '';
      let media_url = null;
      let media_type = m.type;

      if (m.type === 'text') {
        text = m.text.body;
      } else if (m.type === 'button' && m.button?.text) {
        text = m.button.text;
      } else if (m.type === 'interactive' && m.interactive?.button_reply?.title) {
        text = m.interactive.button_reply.title;
      } else {
        const mediaId = m[m.type]?.id;
        const caption = m[m.type]?.caption || '';
        if (mediaId) {
          try {
            const meta = await axios.get(`https://graph.facebook.com/v22.0/${mediaId}`, {
              headers: { Authorization: `Bearer ${TOKEN}` }
            });
            const dl = await axios.get(meta.data.url, {
              headers: { Authorization: `Bearer ${TOKEN}` },
              responseType: 'arraybuffer'
            });
            const mime = meta.data.mime_type || 'application/octet-stream';
            const ext = (mime.split('/')[1]?.split(';')[0] || 'bin').substring(0, 5);
            const fname = `${mediaId}.${ext}`;
            fs.writeFileSync(path.join(mediaDir, fname), dl.data);
            media_url = `/media/${fname}`;
            text = caption || `[${m.type}]`;
          } catch (e) {
            console.error('media err', e.message);
            text = caption || `[${m.type}]`;
          }
        } else {
          text = `[${m.type}]`;
        }
      }

      if (!text &&!media_url) continue;

      await pool.query(
        `INSERT INTO messages(wa_id,direction,text,source,media_url,media_type) VALUES($1,'in',$2,'chat',$3,$4)`,
        [wa_id, text, media_url, media_type]
      );
      await pool.query(
        `INSERT INTO conversations(wa_id,last_message,unread_count) VALUES($1,$2,1)
         ON CONFLICT(wa_id) DO UPDATE SET last_message=EXCLUDED.last_message, unread_count=conversations.unread_count+1, updated_at=NOW()`,
        [wa_id, text]
      );
    }
  } catch (e) { console.error('webhook err:', e.message); }
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
  }
});

// Chats
app.get('/api/chats', async (req, res) => {
  try {
    const r = await pool.query(`SELECT wa_id, last_message as text, unread_count, updated_at as created_at FROM conversations ORDER BY updated_at DESC LIMIT 200`);
    res.json(r.rows);
  } catch (e) { console.error(e.message); res.status(500).json([]); }
});

app.get('/api/messages/:wa_id', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC LIMIT 1000`, [req.params.wa_id]);
    res.json(r.rows);
  } catch (e) { console.error(e.message); res.status(500).json([]); }
});

app.put('/api/chats/:wa_id/read', async (req, res) => {
  try {
    await pool.query(`UPDATE conversations SET unread_count=0 WHERE wa_id=$1`, [req.params.wa_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// Enviar mensaje
app.post('/api/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to ||!message) return res.status(400).json({ ok: false, error: 'Faltan datos' });
  try {
    await axios.post(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to, text: { body: message } },
      { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
    );
    await pool.query(`INSERT INTO messages(wa_id,direction,text,source) VALUES($1,'out',$2,'chat')`, [to, message]);
    await pool.query(`INSERT INTO conversations(wa_id,last_message,unread_count) VALUES($1,$2,0)
      ON CONFLICT(wa_id) DO UPDATE SET last_message=EXCLUDED.last_message, updated_at=NOW()`, [to, message]);
    res.json({ ok: true });
  } catch (e) {
    console.error('send error:', e.response?.data || e.message);
    res.status(500).json({ ok: false, error: e.response?.data?.error?.message || 'Error enviando a WhatsApp' });
  }
});

// Plantillas
app.get('/api/templates', async (req, res) => {
  try {
    const r = await axios.get(`https://graph.facebook.com/v22.0/${PHONE_ID}/message_templates?limit=100`,
      { headers: { Authorization: `Bearer ${TOKEN}` } });
    res.json(r.data.data || []);
  } catch (e) {
    console.error('templates err:', e.response?.data || e.message);
    res.json([]);
  }
});

// Campañas
app.get('/api/campaigns', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 50`);
    res.json(r.rows);
  } catch (e) { res.json([]); }
});

app.post('/api/campaigns/send-bulk', async (req, res) => {
  const { numbers, templateName } = req.body;
  if (!numbers?.length ||!templateName) return res.status(400).json({ ok: false, error: 'Faltan números o plantilla' });
  try {
    const cr = await pool.query(`INSERT INTO campaigns(name,template,total,status) VALUES($1,$2,$3,'enviando') RETURNING id`,
      [templateName, templateName, numbers.length]);
    const cid = cr.rows[0].id;
    let sent = 0, failed = 0;

    for (const num of numbers) {
      try {
        await axios.post(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
          { messaging_product: 'whatsapp', to: num, type: 'template', template: { name: templateName, language: { code: 'es' } } },
          { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
        );
        await pool.query(`INSERT INTO messages(wa_id,direction,text,source) VALUES($1,'out',$2,'campaign')`, [num, `[Plantilla ${templateName}]`]);
        sent++;
      } catch (e) {
        failed++;
        console.error('bulk fail', num, e.response?.data?.error?.message || e.message);
      }
      await new Promise(r => setTimeout(r, 400));
    }
    await pool.query(`UPDATE campaigns SET sent=$1, failed=$2, status='enviada' WHERE id=$3`, [sent, failed, cid]);
    res.json({ ok: true, sent, failed });
  } catch (e) {
    console.error('bulk error:', e.message);
    res.status(500).json({ ok: false, error: 'Error en campaña' });
  }
});

// Health
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*) FROM messages');
    const c = await pool.query('SELECT COUNT(*) FROM conversations');
    res.json({ ok: true, totalMensajes: r.rows[0].count, totalChats: c.rows[0].count, time: new Date().toISOString() });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ KLIDO CRM ON en puerto ${PORT}`));
