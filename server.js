import express from 'express';
import pg from 'pg';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

await pool.query(`
CREATE TABLE IF NOT EXISTS contacts (id SERIAL PRIMARY KEY, phone TEXT UNIQUE, name TEXT, last_msg_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, contact_phone TEXT, from_me BOOLEAN, body TEXT, created_at TIMESTAMP DEFAULT NOW());
`);

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido_verify_123";

app.get('/webhook/whatsapp', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (msg) {
    const phone = msg.from;
    const body = msg.text?.body || `[${msg.type}]`;
    const name = value.contacts?.[0]?.profile?.name || phone;
    await pool.query(`INSERT INTO contacts (phone, name) VALUES ($1,$2) ON CONFLICT (phone) DO UPDATE SET name=$2, last_msg_at=NOW()`, [phone, name]);
    await pool.query(`INSERT INTO messages (contact_phone, from_me, body) VALUES ($1, false, $2)`, [phone, body]);
  }
  res.sendStatus(200);
});

app.get('/api/conversations', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM contacts ORDER BY last_msg_at DESC`);
  res.json(rows);
});
app.get('/api/messages/:phone', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM messages WHERE contact_phone=$1 ORDER BY created_at ASC`, [req.params.phone]);
  res.json(rows);
});
app.post('/api/send', async (req, res) => {
  const { to, text } = req.body;
  const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } })
  });
  const data = await r.json();
  if(data.error) return res.status(400).json(data);
  await pool.query(`INSERT INTO messages (contact_phone, from_me, body) VALUES ($1, true, $2)`, [to, text]);
  res.json({ ok: true });
});

app.listen(process.env.PORT || 8080, () => console.log("CRM corriendo"));
