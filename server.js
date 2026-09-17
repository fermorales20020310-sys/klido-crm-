const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;

let contacts = {};
let templatesCache = [];

app.use(bodyParser.json());
// IMPORTANTE: index:false para que no abra campañas por defecto
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        const msgs = change.value.messages;
        if (msgs) {
          msgs.forEach(msg => {
            const wa_id = msg.from;
            const text = msg.text?.body || `[${msg.type}]`;
            const name = change.value.contacts?.[0]?.profile?.name || wa_id;
            if (!contacts[wa_id]) {
              contacts[wa_id] = { wa_id, name, lastMessage: '', hot: false, unread: 0, messages: [], tag: 'alion_co' };
            }
            contacts[wa_id].lastMessage = text;
            contacts[wa_id].hot = true;
            contacts[wa_id].unread = (contacts[wa_id].unread || 0) + 1;
            contacts[wa_id].messages.push({ from: 'client', text, timestamp: new Date() });
          });
        }
      });
    });
  }
  res.sendStatus(200);
});

app.get('/api/contacts', (req, res) => res.json(Object.values(contacts)));
app.get('/api/messages/:wa_id', (req, res) => {
  const c = contacts[req.params.wa_id];
  if (c) { c.unread = 0; res.json(c.messages); } else res.json([]);
});

app.get('/api/templates', async (req, res) => {
  try {
    const url = `https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?limit=100`;
    const r = await axios.get(url, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
    templatesCache = (r.data.data || []).filter(t => t.status === 'APPROVED');
    res.json(templatesCache);
  } catch (e) { res.json(templatesCache); }
});

app.post('/api/send', async (req, res) => {
  const { wa_id, text, templateName } = req.body;
  try {
    let payload = templateName 
      ? { messaging_product: "whatsapp", to: wa_id, type: "template", template: { name: templateName, language: { code: "es_CO" } } }
      : { messaging_product: "whatsapp", to: wa_id, type: "text", text: { body: text } };
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, payload, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    if (contacts[wa_id]) {
      contacts[wa_id].messages.push({ from: 'me', text: text || templateName, timestamp: new Date() });
      contacts[wa_id].hot = false;
      contacts[wa_id].unread = 0;
      contacts[wa_id].lastMessage = text || templateName;
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.response?.data || e.message }); }
});

// RUTAS FIJAS - AHORA SI BANDEJA ES LA PRINCIPAL
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bandeja.html')));
app.get('/bandeja', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bandeja.html')));
app.get('/campanas', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('KLIDO OK'));
