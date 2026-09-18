const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// --- CONFIGURACION CON TU CLAVE ---
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ chats: {} }, null, 2));
}

function getData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return { chats: {} }; }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- 1. VERIFICACION WEBHOOK META ---
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO CORRECTAMENTE');
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// --- 2. RECIBE Y HACE COPIA DEL HISTORIAL ---
app.post('/webhook', (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (msg) {
      const data = getData();
      const wa_id = msg.from;
      const name = contact?.profile?.name || wa_id;

      if (!data.chats[wa_id]) {
        data.chats[wa_id] = { name: name, wa_id: wa_id, messages: [] };
      }

      data.chats[wa_id].messages.push({
        id: msg.id,
        text: msg.text?.body || `[${msg.type}]`,
        direction: 'inbound',
        timestamp: new Date().toISOString(),
        raw: msg
      });
      data.chats[wa_id].name = name;
      data.chats[wa_id].last_message = msg.text?.body || msg.type;

      saveData(data);
      console.log(`COPIA GUARDADA -> ${wa_id}: ${msg.text?.body}`);
    }
  } catch (err) {
    console.log('Error guardando copia:', err.message);
  }
  res.sendStatus(200);
});

// --- 3. APIS PARA TU BANDEJA ---
app.get('/api/chats', (req, res) => {
  const data = getData();
  const chats = Object.values(data.chats).sort((a,b) => {
    const lastA = a.messages[a.messages.length-1]?.timestamp || 0;
    const lastB = b.messages[b.messages.length-1]?.timestamp || 0;
    return new Date(lastB) - new Date(lastA);
  });
  res.json(chats);
});

app.get('/api/chats/:wa_id', (req, res) => {
  const data = getData();
  res.json(data.chats[req.params.wa_id] || null);
});

app.post('/api/send', async (req, res) => {
  const { to, text } = req.body;
  if (!to ||!text) return res.status(400).json({ error: 'Falta to y text' });
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to, type: "text", text: { body: text } })
    });
    const result = await r.json();

    if (result.messages) {
      const data = getData();
      if (!data.chats[to]) data.chats[to] = { name: to, wa_id: to, messages: [] };
      data.chats[to].messages.push({ text: text, direction: 'outbound', timestamp: new Date().toISOString() });
      data.chats[to].last_message = text;
      saveData(data);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KLIDO CRM OK - Puerto ${PORT} - Clave: ${VERIFY_TOKEN}`));
