const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== DB ==========
const DATA_FILE = path.join(__dirname, 'data.json');
let db = { contacts: {}, messages: {}, campaigns: {} };

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.contacts = raw.contacts || {};
    db.messages = raw.messages || {};
    db.campaigns = raw.campaigns || {};
  }
} catch (e) {
  console.log('Error DB', e.message);
}

function saveDB() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
}

if (!db.campaigns['alion_co']) {
  db.campaigns['alion_co'] = { name: 'alion_co', welcome: 'Hola vengo de alion_co', totalMessages: 0, totalContacts: 0, createdAt: Date.now(), lastSeen: Date.now() };
  saveDB();
}

// ========== API CONTACTS Y MENSAJES ==========
app.get('/api/contacts', (req, res) => {
  const list = Object.values(db.contacts).sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
  res.json(list);
});

app.get('/api/messages/:wa_id', (req, res) => {
  res.json(db.messages[req.params.wa_id] || []);
});

app.post('/api/send', async (req, res) => {
  const { wa_id, text } = req.body;
  if (!wa_id ||!text) return res.status(400).json({ error: 'Falta wa_id o text' });

  if (!db.messages[wa_id]) db.messages[wa_id] = [];
  db.messages[wa_id].push({ from: 'me', text, timestamp: Date.now() });

  if (db.contacts[wa_id]) {
    db.contacts[wa_id].lastMessage = text;
    db.contacts[wa_id].lastTimestamp = Date.now();
    db.contacts[wa_id].hot = false; // CLAVE: al responder se va de HOY a Bandeja normal
    db.contacts[wa_id].unread = 0;
  }
  saveDB();

  try {
    const axios = require('axios');
    if (process.env.PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN) {
      await axios.post(`https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        to: wa_id,
        type: "text",
        text: { body: text }
      }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } });
    }
  } catch (e) {
    console.log('Error WA send', e.response?.data || e.message);
  }
  res.json({ ok: true });
});

// ========== API CAMPAÑAS CON SEGUIMIENTO ==========
app.get('/api/campaigns', (req, res) => {
  // Recalcular contadores en tiempo real
  Object.keys(db.campaigns).forEach(cName => {
    const related = Object.values(db.contacts).filter(c => (c.campaignName||'').toLowerCase() === cName.toLowerCase());
    db.campaigns[cName].totalContacts = related.length;
    db.campaigns[cName].totalMessages = related.reduce((acc, c) => {
      const msgs = db.messages[c.wa_id]? db.messages[c.wa_id].filter(m=>m.from==='client').length : 0;
      return acc + msgs;
    }, 0);
  });
  saveDB();
  res.json(Object.values(db.campaigns).sort((a,b)=>b.createdAt-a.createdAt));
});

app.post('/api/campaigns', (req, res) => {
  const { name, welcome } = req.body;
  if (!name) return res.status(400).json({ error: 'Falta nombre' });
  const key = name.toLowerCase().trim();
  db.campaigns[key] = {
    name: key,
    welcome: welcome || `Hola vengo de la campaña ${key}`,
    totalContacts: db.campaigns[key]?.totalContacts || 0,
    totalMessages: db.campaigns[key]?.totalMessages || 0,
    createdAt: db.campaigns[key]?.createdAt || Date.now(),
    lastSeen: Date.now()
  };
  saveDB();
  res.json({ ok: true, campaign: db.campaigns[key] });
});

// ========== WEBHOOK ==========
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        const value = change.value;
        value.messages?.forEach(m => {
          const wa_id = m.from;
          let text = '';
          if (m.type === 'text') text = m.text.body;
          else if (m.type === 'image') text = '[image] ' + (m.image?.caption || '');
          else text = `[${m.type}]`;

          const name = value.contacts?.[0]?.profile?.name || wa_id;

          // Detectar campaña por [nombre] en el texto
          let campName = 'alion_co';
          const tagMatch = text.match(/\[(.*?)\]/);
          if (tagMatch) campName = tagMatch[1].toLowerCase().trim();
          else if (text.toLowerCase().includes('alion')) campName = 'alion_co';

          if (!db.campaigns[campName]) {
            db.campaigns[campName] = { name: campName, welcome: '', totalContacts: 0, totalMessages: 0, createdAt: Date.now(), lastSeen: Date.now() };
          }
          db.campaigns[campName].totalMessages = (db.campaigns[campName].totalMessages || 0) + 1;
          db.campaigns[campName].lastSeen = Date.now();

          if (!db.contacts[wa_id]) {
            db.contacts[wa_id] = {
              wa_id,
              name,
              lastMessage: text,
              lastTimestamp: Date.now(),
              hot: true, // CLAVE: entra a HOY con punto rojo
              unread: 1,
              fromCampaign: true,
              campaignName: campName,
              tag: campName
            };
            db.campaigns[campName].totalContacts = (db.campaigns[campName].totalContacts || 0) + 1;
          } else {
            db.contacts[wa_id].lastMessage = text;
            db.contacts[wa_id].lastTimestamp = Date.now();
            db.contacts[wa_id].hot = true;
            db.contacts[wa_id].unread = (db.contacts[wa_id].unread || 0) + 1;
            db.contacts[wa_id].fromCampaign = true;
            db.contacts[wa_id].campaignName = campName;
            db.contacts[wa_id].tag = campName;
          }

          if (!db.messages[wa_id]) db.messages[wa_id] = [];
          db.messages[wa_id].push({ from: 'client', text, timestamp: Date.now() });
          saveDB();
        });
      });
    });
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// ========== FRONT ==========
app.get('/campanas', (req, res) => {
  const fp = path.join(__dirname, 'public', 'campanas.html');
  if (fs.existsSync(fp)) return res.sendFile(fp);
  return res.status(404).send('Sube public/campanas.html');
});
app.get('/campanas.html', (req, res) => {
  const fp = path.join(__dirname, 'public', 'campanas.html');
  if (fs.existsSync(fp)) return res.sendFile(fp);
  return res.status(404).send('Sube public/campanas.html');
});
app.get('/bandeja', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bandeja.html')));
app.get('/bandeja.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bandeja.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('KLIDO AVANZA OK - Seguimiento activo en ' + PORT));
