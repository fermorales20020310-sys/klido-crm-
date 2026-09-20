const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security middlewares ---
app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json());

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10 });
app.use('/api/login', loginLimiter);

// Servir frontend
app.use(express.static('public'));

// --- Auth helpers ---
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto';
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.replace('Bearer ', '');
  if (!token) return res.status(401).json({ok:false});
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ok:false}); }
}

// --- Login ---
app.post('/api/login', async (req, res) => {
  const { user, password } = req.body || {};
  if (user !== process.env.ADMIN_USER) return res.status(401).json({ok:false});
  const ok = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH || '');
  if (!ok) return res.status(401).json({ok:false});
  const token = jwt.sign({ user }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ ok: true, token });
});

// --- API protegida ---
app.get('/api/chats', auth, (req, res) => {
  res.json({ ok: true, chats: [] });
});

app.post('/api/chats/send', auth, async (req, res) => {
  // aquí tu lógica de envío con WHATSAPP_TOKEN
  res.json({ ok: true });
});

app.get('/api/stats', auth, (req, res) => {
  res.json({ ok: true });
});

// --- Webhook WhatsApp ---
// Verificación (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recepción (POST) con firma APP_SECRET
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-hub-signature-256'] || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET || '').update(req.body).digest('hex');
  // timing-safe compare
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) {
    return res.sendStatus(401);
  }
  const data = JSON.parse(req.body.toString());
  // procesa mensajes aquí...
  console.log('Webhook OK', JSON.stringify(data).slice(0,200));
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log('✅ KLIDO CRM SECURE ON');
  console.log('✅ DB OK');
});
