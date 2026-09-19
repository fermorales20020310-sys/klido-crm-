const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

let pool = null;
try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    console.log('DB conectada');
  } else {
    console.log('SIN DATABASE_URL - usando memoria temporal');
  }
} catch (e) { console.log('Error pool', e.message); }

// Memoria temporal si no hay DB
let memMessages = [];
let memCampaigns = [
  { id: 1, name: 'Campaña Alion - 14/09', total: 591, sent: 591, created_at: '2026-09-14T17:19:43' },
  { id: 2, name: 'Campaña Alion - 17/09', total: 591, sent: 591, created_at: '2026-09-17T17:19:43' }
];

async function initDB() {
  if (!pool) return;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS contacts (wa_id TEXT PRIMARY KEY, name TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, file_url TEXT, type TEXT, direction TEXT, source TEXT DEFAULT 'inbox', created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, name TEXT, total INT, sent INT, created_at TIMESTAMP DEFAULT NOW())`);
    const { rows } = await pool.query(`SELECT COUNT(*) FROM campaigns`);
    if (parseInt(rows[0].count) === 0) {
      await pool.query(`INSERT INTO campaigns(name,total,sent,created_at) VALUES('Campaña Alion - 14/09',591,591,'2026-09-14 17:19:43'),('Campaña Alion - 17/09',591,591,'2026-09-17 17:19:43')`);
    }
  } catch (e) { console.log('Init DB error', e.message); }
}
initDB();

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

async function descargarMedia(id, name) {
  try {
    if (!TOKEN) return null;
    const r1 = await fetch(`https://graph.facebook.com/v20.0/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const j = await r1.json(); if (!j.url) return null;
    const r2 = await fetch(j.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const buf = Buffer.from(await r2.arrayBuffer());
    fs.writeFileSync(path.join(uploadDir, name), buf);
    return `/uploads/${name}`;
  } catch { return null; }
}

app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);
    let txt = '', url = null, src = 'inbox';
    if (msg.type === 'text') txt = msg.text.body;
    else if (msg.type === 'image') { url = await descargarMedia(msg.image.id, `${msg.id}.jpg`); txt = msg.image.caption || '📷 Imagen'; }
    else if (msg.type === 'document') { url = await descargarMedia(msg.document.id, msg.document.filename || `${msg.id}.pdf`); txt = `📄 ${msg.document.filename}`; }
    else if (msg.type === 'audio') { url = await descargarMedia(msg.audio.id, `${msg.id}.ogg`); txt = '🎤 Audio'; }
    else txt = `📎 ${msg.type}`;

    if (pool) {
      try {
        await pool.query(`INSERT INTO contacts(wa_id,name) VALUES($1,$2) ON CONFLICT(wa_id) DO NOTHING`, [msg.from, msg.from]);
        await pool.query(`INSERT INTO messages(wa_id,text,file_url,type,direction,source) VALUES($1,$2,$3,$4,'in',$5)`, [msg.from, txt, url, msg.type, src]);
      } catch (e) { console.log(e.message); memMessages.push({ wa_id: msg.from, text: txt, file_url: url, type: msg.type, direction: 'in', source: src, created_at: new Date() }); }
    } else {
      memMessages.push({ wa_id: msg.from, text: txt, file_url: url, type: msg.type, direction: 'in', source: src, created_at: new Date() });
    }
    res.sendStatus(200);
  } catch { res.sendStatus(200); }
});

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
    if (pool) await pool.query(`INSERT INTO messages(wa_id,text,direction,type,source) VALUES($1,$2,'out','text',$3)`, [to, message, src]);
    else memMessages.push({ wa_id: to, text: message, direction: 'out', type: 'text', source: src, created_at: new Date() });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/chats', async (_, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query(`SELECT m.wa_id, m.text, m.created_at, c.name, m.source FROM (SELECT DISTINCT ON (wa_id) wa_id,text,created_at,source FROM messages ORDER BY wa_id,created_at DESC) m LEFT JOIN contacts c ON c.wa_id=m.wa_id ORDER BY m.created_at DESC`);
      return res.json(rows);
    }
    const map = {}; memMessages.forEach(m => map[m.wa_id] = m);
    res.json(Object.values(map));
  } catch { res.json([]); }
});

app.get('/api/messages/:wa_id', async (req, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC`, [req.params.wa_id]);
      return res.json(rows);
    }
    res.json(memMessages.filter(m => m.wa_id === req.params.wa_id));
  } catch { res.json([]); }
});

app.get('/api/campaigns', async (_, res) => {
  try {
    if (pool) {
      const { rows } = await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC`);
      return res.json(rows);
    }
    res.json(memCampaigns);
  } catch { res.json(memCampaigns); }
});

app.post('/api/campaigns/upload', async (req, res) => {
  try {
    const { total, name } = req.body;
    const t = parseInt(total) || 0;
    if (pool) await pool.query(`INSERT INTO campaigns(name,total,sent) VALUES($1,$2,$2)`, [name || `Campaña ${new Date().toLocaleDateString()}`, t]);
    else memCampaigns.unshift({ id: Date.now(), name: name || `Campaña ${new Date().toLocaleDateString()}`, total: t, sent: t, created_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (_, res) => res.json({ ok: true, status: 'KLIDO CRM PRO RUNNING' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO PRO BLANCO LISTO en ' + PORT));
