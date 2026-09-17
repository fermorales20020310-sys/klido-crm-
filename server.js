const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// ESTO ES LO QUE TE FALTABA - sirve la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// Memoria de chats
let chats = {}; // { tel: { nombre, tel, msgs: [] } }

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";

// 1. Webhook para que Meta te verifique
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 2. Webhook para recibir mensajes
app.post('/webhook', (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (msg) {
      const tel = msg.from;
      const text = msg.text?.body || (msg.image? '📷 Imagen' : '📎 Archivo');
      const name = entry.contacts?.[0]?.profile?.name || tel;

      if (!chats[tel]) chats[tel] = { tel, nombre: name, msgs: [] };
      chats[tel].nombre = name;
      chats[tel].msgs.push({ from: 'cliente', text, time: new Date().toLocaleTimeString() });
      console.log(`Nuevo mensaje de ${tel}: ${text}`);
    }
  } catch (e) { console.log(e) }
  res.sendStatus(200);
});

// 3. API para la bandeja
app.get('/api/chats', (req, res) => {
  const lista = Object.values(chats).sort((a,b)=> b.msgs.length - a.msgs.length);
  res.json(lista);
});

// 4. API para responder desde la bandeja
app.post('/api/send', async (req, res) => {
  const { to, text } = req.body;
  try {
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });

    if (!chats[to]) chats[to] = { tel: to, nombre: to, msgs: [] };
    chats[to].msgs.push({ from: 'yo', text, time: new Date().toLocaleTimeString() });
    res.json({ ok: true });
  } catch (err) {
    console.log(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 5. API para campañas (ALIÓN)
app.post('/api/send-campaign', async (req, res) => {
  const { contacts, message } = req.body;
  let sent = 0;
  for (let c of contacts) {
    const textoFinal = message.replace(/{nombre}/gi, c.nombre || '').replace(/{name}/gi, c.nombre || '');
    try {
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
        messaging_product: "whatsapp",
        to: c.tel,
        type: "text",
        text: { body: textoFinal }
      }, { headers: { Authorization: `Bearer ${TOKEN}` } });
      sent++;
      await new Promise(r => setTimeout(r, 700)); // evita bloqueo
    } catch (e) { console.log('Error enviando a', c.tel) }
  }
  res.json({ ok: true, sent });
});

// 6. Limpiar
app.get('/api/clear', (req, res) => {
  chats = {};
  res.json({ ok: true, cleared: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO CRM ONLINE EN PUERTO ' + PORT));
