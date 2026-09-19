const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// --- DB con fallback para que NUNCA de CRASHED ---
let pool = null;
let memMessages = [];
let memContacts = {};
let memCampaigns = [
  { id: 1, name: 'Campaña Alion - 14/09', total: 591, sent: 591, created_at: '2026-09-14T17:19:43.000Z' },
  { id: 2, name: 'Campaña Alion - 17/09', total: 591, sent: 591, created_at: '2026-09-17T17:19:43.000Z' }
];

try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    console.log('DB Pool creado');
  }
} catch (e) { console.log('Pool error', e.message); }

async function initDB() {
  if (!pool) return console.log('Modo memoria - sin DB');
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS contacts (wa_id TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, file_url TEXT, type TEXT, direction TEXT, source TEXT DEFAULT 'inbox', created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, name TEXT, total INT, sent INT, created_at TIMESTAMP DEFAULT NOW())`);
    const { rows } = await pool.query(`SELECT COUNT(*) as c FROM campaigns`);
    if (parseInt(rows[0].c) === 0) {
      await pool.query(`INSERT INTO campaigns(name,total,sent,created_at) VALUES('Campaña Alion - 14/09',591,591,'2026-09-14 17:19:43'),('Campaña Alion - 17/09',591,591,'2026-09-17 17:19:43')`);
      console.log('Historial 591 creado');
    }
  } catch (e) { console.log('InitDB error (no crash):', e.message); }
}
initDB();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

async function descargarMedia(mediaId, fileName) {
  try {
    if (!TOKEN) return null;
    const infoRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const info = await infoRes.json();
    if (!info.url) return null;
    const fileRes = await fetch(info.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const buf = Buffer.from(await fileRes.arrayBuffer());
    fs.writeFileSync(path.join(uploadDir, fileName), buf);
    return `/uploads/${fileName}`;
  } catch (e) { console.log('Media error', e.message); return null; }
}

// Webhook verificación Meta
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Webhook recibir mensajes tiempo real + archivos
app.post('/webhook', async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    let texto = '';
    let fileUrl = null;
    let tipo = msg.type;

    if (msg.type === 'text') texto = msg.text.body;
    else if (msg.type === 'image') { fileUrl = await descargarMedia(msg.image.id, `${msg.id}.jpg`); texto = msg.image.caption || '📷 Imagen'; }
    else if (msg.type === 'document') { fileUrl = await descargarMedia(msg.document.id, msg.document.filename || `${msg.id}.pdf`); texto = `📄 ${msg.document.filename || 'Documento'}`; }
    else if (msg.type === 'audio') { fileUrl = await descargarMedia(msg.audio.id, `${msg.id}.ogg`); texto = '🎤 Audio'; }
    else if (msg.type === 'video') { fileUrl = await descargarMedia(msg.video.id, `${msg.id}.mp4`); texto = '🎥 Video'; }
    else { texto = `📎 ${msg.type}`; if (msg[msg.type]?.id) fileUrl = await descargarMedia(msg[msg.type].id, `${msg.id}`); }

    if (pool) {
      try {
        await pool.query(`INSERT INTO contacts(wa_id,name) VALUES($1,$2) ON CONFLICT(wa_id) DO NOTHING`, [from, from]);
        await pool.query(`INSERT INTO messages(wa_id,text,file_url,type,direction,source) VALUES($1,$2,$3,$4,'in','inbox')`, [from, texto, fileUrl, tipo]);
      } catch (e) { memMessages.push({ wa_id: from, text: texto, file_url: fileUrl, type: tipo, direction: 'in', source: 'inbox', created_at: new Date() }); }
    } else {
      memContacts[from] = from;
      memMessages.push({ wa_id: from, text: texto, file_url: fileUrl, type: tipo, direction: 'in', source: 'inbox', created_at: new Date() });
    }
    res.sendStatus(200);
  } catch (e) { res.sendStatus(200); }
});

// API: Enviar mensaje simple
app.post('/api/send', async (req, res) => {
  try {
    const { to, message, source } = req.body;
    if (TOKEN && PHONE_ID) {
      await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } })
      });
    }
    const src = source || 'inbox';
    if (pool) {
      try { await pool.query(`INSERT INTO messages(wa_id,text,direction,type,source) VALUES($1,$2,'out','text',$3)`, [to, message, src]); }
      catch (e) { memMessages.push({ wa_id: to, text: message, direction: 'out', type: 'text', source: src, created_at: new Date() }); }
    } else memMessages.push({ wa_id: to, text: message, direction: 'out', type: 'text', source: src, created_at: new Date() });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// API: Lista chats - FIX undefined
app.get('/api/chats', async (_, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query(`
        SELECT m.wa_id, m.text, m.created_at, m.source, c.name
        FROM (SELECT DISTINCT ON (wa_id) wa_id, text, created_at, source FROM messages ORDER BY wa_id, created_at DESC) m
        LEFT JOIN contacts c ON c.wa_id = m.wa_id
        ORDER BY m.created_at DESC
      `);
      return res.json(rows);
    } else {
      const map = {};
      memMessages.forEach(m => map[m.wa_id] = { wa_id: m.wa_id, text: m.text, created_at: m.created_at, source: m.source, name: m.wa_id });
      return res.json(Object.values(map).reverse());
    }
  } catch (e) { res.json([]); }
});

// API: Mensajes de un chat - historial completo
app.get('/api/messages/:wa_id', async (req, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC`, [req.params.wa_id]);
      return res.json(rows);
    } else {
      return res.json(memMessages.filter(m => m.wa_id === req.params.wa_id));
    }
  } catch { res.json([]); }
});

// API: Historial campañas - 2x 591
app.get('/api/campaigns', async (_, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC`);
      return res.json(rows);
    } else return res.json(memCampaigns);
  } catch { res.json(memCampaigns); }
});

// API: Subir campaña (guardar historial)
app.post('/api/campaigns/upload', async (req, res) => {
  try {
    const { total, name } = req.body;
    const t = parseInt(total) || 0;
    if (pool) {
      await pool.query(`INSERT INTO campaigns(name,total,sent) VALUES($1,$2,$2)`, [name || `Campaña ${new Date().toLocaleDateString()}`, t]);
    } else {
      memCampaigns.unshift({ id: Date.now(), name: name || `Campaña ${new Date().toLocaleDateString()}`, total: t, sent: t, created_at: new Date().toISOString() });
    }
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// API: ENVIO MASIVO CON ETIQUETA AMARILLA CAMPAÑA
app.post('/api/campaigns/send-bulk', async (req, res) => {
  try {
    const { numbers, message } = req.body;
    const list = Array.isArray(numbers)? numbers : [];
    let sent = 0;
    for (const raw of list.slice(0, 50)) { // 50 por lote para Meta
      const clean = String(raw).replace(/\D/g, '');
      if (clean.length < 10) continue;
      if (TOKEN && PHONE_ID) {
        await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: clean, type: 'text', text: { body: message || 'Hola, te escribe Klido CRM PRO - campaña alion_co' } })
        });
        await new Promise(r => setTimeout(r, 400));
      }
      if (pool) {
        try { await pool.query(`INSERT INTO messages(wa_id,text,direction,type,source) VALUES($1,$2,'out','text','campaign')`, [clean, message]); }
        catch { memMessages.push({ wa_id: clean, text: message, direction: 'out', type: 'text', source: 'campaign', created_at: new Date() }); }
      } else memMessages.push({ wa_id: clean, text: message, direction: 'out', type: 'text', source: 'campaign', created_at: new Date() });
      sent++;
    }
    res.json({ ok: true, sent });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// Health para Railway
app.get('/health', (_, res) => res.json({ ok: true, status: 'KLIDO CRM PRO RUNNING', time: new Date().toISOString() }));
app.get('/api/fix-history', async (_, res) => {
  try {
    if (pool) {
      await pool.query(`DELETE FROM campaigns`);
      await pool.query(`INSERT INTO campaigns(name,total,sent,created_at) VALUES('Campaña Alion - 14/09',591,591,'2026-09-14 17:19:43'),('Campaña Alion - 17/09',591,591,'2026-09-17 17:19:43')`);
    } else {
      memCampaigns = [
        { id: 1, name: 'Campaña Alion - 14/09', total: 591, sent: 591, created_at: '2026-09-14T17:19:43.000Z' },
        { id: 2, name: 'Campaña Alion - 17/09', total: 591, sent: 591, created_at: '2026-09-17T17:19:43.000Z' }
      ];
    }
    res.json({ ok: true, msg: 'Historial 591 restaurado' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KLIDO CRM PRO BLANCO/AZUL OK en puerto ${PORT}`));
