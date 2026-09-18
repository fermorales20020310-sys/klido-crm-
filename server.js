const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(bodyParser.json());
app.use(express.static(__dirname));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]');
}

function leerHistorial() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } 
  catch(e) { return []; }
}

function guardarMensaje(phone, text, from) {
  const historial = leerHistorial();
  historial.push({
    phone: phone,
    text: text,
    from: from,
    time: new Date().toLocaleString('es-CO', {timeZone: 'America/Bogota'}),
    timestamp: Date.now()
  });
  fs.writeFileSync(DATA_FILE, JSON.stringify(historial, null, 2));
  console.log(`MENSAJE GUARDADO [${from}] ${phone}: ${text}`);
}

// Verificacion para Meta
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO');
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// Donde llegan los mensajes
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        const messages = change.value?.messages;
        if (messages) {
          messages.forEach(msg => {
            const phone = msg.from;
            const text = msg.text?.body || `[${msg.type}]`;
            guardarMensaje(phone, text, 'cliente');
          });
        }
      });
    });
  }
  res.sendStatus(200);
});

// APIs para la bandeja
app.get('/api/historial', (req, res) => {
  let historial = leerHistorial();
  if (req.query.phone) {
    historial = historial.filter(m => m.phone === req.query.phone);
  }
  res.json(historial);
});

app.get('/api/conversaciones', (req, res) => {
  const historial = leerHistorial();
  const conv = {};
  historial.forEach(m => {
    if (!conv[m.phone]) conv[m.phone] = { phone: m.phone, ultimo: m.text, time: m.time, timestamp: m.timestamp, total: 0 };
    conv[m.phone].ultimo = m.text;
    conv[m.phone].time = m.time;
    conv[m.phone].timestamp = m.timestamp;
    conv[m.phone].total++;
  });
  res.json(Object.values(conv).sort((a,b) => b.timestamp - a.timestamp));
});

app.post('/api/enviar', async (req, res) => {
  const { phone, text } = req.body;
  try {
    const r = await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, text: { body: text } })
    });
    const data = await r.json();
    if (data.error) {
      console.log('ERROR ENVIANDO:', data.error);
      return res.status(400).json(data);
    }
    guardarMensaje(phone, text, 'yo');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'bandeja.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('LISTO en puerto ' + PORT));
