const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;

// Datos en memoria
let contacts = {}; // { wa_id: { name, wa_id, lastMessage, status: 'hot'|'contacted', unread, messages: [] } }
let templatesCache = [];

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== WEBHOOK VERIFICATION ==========
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ========== WEBHOOK INCOMING ==========
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        const messages = change.value.messages;
        if (messages) {
          messages.forEach(async msg => {
            const wa_id = msg.from;
            const text = msg.text?.body || msg.type;
            const name = change.value.contacts?.[0]?.profile?.name || wa_id;

            if (!contacts[wa_id]) {
              contacts[wa_id] = { wa_id, name, lastMessage: text, status: 'hot', unread: 0, messages: [] };
            }
            contacts[wa_id].lastMessage = text;
            contacts[wa_id].status = 'hot'; // <-- SIEMPRE que contesta vuelve a HOT
            contacts[wa_id].unread = (contacts[wa_id].unread || 0) + 1;
            contacts[wa_id].messages.push({ from: 'client', text, timestamp: new Date() });

            // Emitir evento para punto rojo
            io.emit('new_message', contacts[wa_id]);
            io.emit('hot_update', { wa_id, status: 'hot', unread: contacts[wa_id].unread });
            console.log(`[HOT] Mensaje de ${wa_id}: ${text}`);
          });
        }
      });
    });
  }
  res.sendStatus(200);
});

// ========== API CONTACTS ==========
app.get('/api/contacts', (req, res) => {
  res.json(Object.values(contacts));
});

app.get('/api/messages/:wa_id', (req, res) => {
  const c = contacts[req.params.wa_id];
  if (c) {
    c.unread = 0;
    io.emit('hot_update', { wa_id: c.wa_id, status: c.status, unread: 0 });
    res.json(c.messages);
  } else res.json([]);
});

// ========== API TEMPLATES ARREGLADO - TRAE LAS 2 ==========
app.get('/api/templates', async (req, res) => {
  try {
    if (!WABA_ID ||!WHATSAPP_TOKEN) return res.json(templatesCache);

    const url = `https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?limit=100`;
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    // TRAE TODAS LAS APROBADAS, SIN FILTRO DE IDIOMA
    const all = r.data.data || [];
    templatesCache = all.filter(t => t.status === 'APPROVED');

    console.log(`[TEMPLATES] Encontradas ${templatesCache.length}:`, templatesCache.map(t=>t.name));
    res.json(templatesCache);
  } catch (e) {
    console.error('Error templates:', e.response?.data || e.message);
    res.json(templatesCache);
  }
});

// ========== ENVIAR MENSAJE - SALE DE HOT ==========
app.post('/api/send', async (req, res) => {
  const { wa_id, text, templateName } = req.body;
  try {
    let payload;
    if (templateName) {
      payload = {
        messaging_product: "whatsapp",
        to: wa_id,
        type: "template",
        template: { name: templateName, language: { code: "es_CO" } }
      };
    } else {
      payload = {
        messaging_product: "whatsapp",
        to: wa_id,
        type: "text",
        text: { body: text }
      };
    }

    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, payload, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
    });

    if (contacts[wa_id]) {
      contacts[wa_id].messages.push({ from: 'me', text: text || `Plantilla: ${templateName}`, timestamp: new Date() });
      contacts[wa_id].status = 'contacted'; // <-- SALE DE HOT CUANDO CONTESTAS
      contacts[wa_id].unread = 0;
      contacts[wa_id].lastMessage = text || `Plantilla: ${templateName}`;
      io.emit('hot_update', { wa_id, status: 'contacted', unread: 0 });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Error send:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bandeja.html'));
});

io.on('connection', (socket) => {
  console.log('Cliente conectado para notificaciones HOT');
});

server.listen(PORT, () => console.log(`KLIDO CRM corriendo en ${PORT} - HOT + PUNTO ROJO ACTIVO`));
