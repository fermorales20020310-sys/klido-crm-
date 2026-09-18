const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Sirve todo lo que está en public/ (bandeja.html, campanas.html, logo.png)
app.use(express.static(path.join(__dirname, 'public')));

// Base de datos local
const DATA_FILE = path.join(__dirname, 'data.json');
let db = { contacts: {}, messages: {} };
try {
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!db.contacts) db.contacts = {};
    if (!db.messages) db.messages = {};
  }
} catch (e) {
  console.log('Error leyendo data.json', e.message);
}
function saveDB() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) {}
}

// ============ API ============
app.get('/api/contacts', (req, res) => {
  const list = Object.values(db.contacts).sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
  res.json(list);
});

app.get('/api/messages/:wa_id', (req, res) => {
  res.json(db.messages[req.params.wa_id] || []);
  if (db.contacts[req.params.wa_id]) {
    db.contacts[req.params.wa_id].unread = 0;
    saveDB();
  }
});

app.post('/api/send', async (req, res) => {
  const { wa_id, text } = req.body;
  if (!wa_id ||!text) return res.status(400).json({ error: 'Falta wa_id o texto' });

  if (!db.messages[wa_id]) db.messages[wa_id] = [];
  db.messages[wa_id].push({ from: 'me', text, timestamp: Date.now() });

  if (db.contacts[wa_id]) {
    db.contacts[wa_id].lastMessage = text;
    db.contacts[wa_id].lastTimestamp = Date.now();
    db.contacts[wa_id].hot = false; // CLAVE: Al responder se quita rojo y pasa a Bandeja normal
    db.contacts[wa_id].unread = 0;
  }
  saveDB();

  // Enviar a WhatsApp si hay token
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
    console.log('Error WA:', e.response?.data || e.message);
  }
  res.json({ ok: true });
});

app.get('/api/templates', (req, res) => res.json([]));

// ============ WEBHOOK WHATSAPP ============
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
        change.value?.messages?.forEach(m => {
          const wa_id = m.from;
          let text = '';
          if (m.type === 'text') text = m.text.body;
          else if (m.type === 'image') text = '[image] ' + (m.image?.caption || '');
          else text = `[${m.type}]`;

          const name = change.value.contacts?.[0]?.profile?.name || wa_id;

          if (!db.contacts[wa_id]) {
            db.contacts[wa_id] = {
              wa_id,
              name,
              lastMessage: text,
              lastTimestamp: Date.now(),
              hot: true, // CLAVE: Nuevo mensaje entra a HOY con punto rojo
              unread: 1,
              fromCampaign: true, // Para que salga amarillo Escribió por campaña
              campaignName: 'alion_co',
              tag: 'alion_co'
            };
          } else {
            db.contacts[wa_id].lastMessage = text;
            db.contacts[wa_id].lastTimestamp = Date.now();
            db.contacts[wa_id].hot = true; // Si responde cliente, vuelve a HOY con rojo
            db.contacts[wa_id].unread = (db.contacts[wa_id].unread || 0) + 1;
            db.contacts[wa_id].fromCampaign = true;
            db.contacts[wa_id].campaignName = 'alion_co';
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

// ============ RUTAS FRONT - ESTO ARREGLA TU NOT FOUND ============
app.get('/campanas', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'campanas.html');
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  return res.send(CAMPANA_FALLBACK);
});

app.get('/campanas.html', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'campanas.html');
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  return res.send(CAMPANA_FALLBACK);
});

app.get('/bandeja', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bandeja.html')));
app.get('/bandeja.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bandeja.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Fallback por si no subiste campanas.html, nunca más Not Found
const CAMPANA_FALLBACK = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campañas KLIDO</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap');*{font-family:Inter;box-sizing:border-box}body{margin:0;background:#f1f5f9}
.header{height:62px;background:#2563eb;display:flex;align-items:center;justify-content:space-between;padding:0 16px;color:#fff}
.btn-black{background:#111827;color:#fff;border:none;padding:10px 16px;border-radius:10px;font-weight:800;cursor:pointer}
.card{max-width:800px;margin:24px auto;background:#fff;padding:24px;border-radius:16px;border:1px solid #e2e8f0}
.badge-yellow{background:#fef08a;color:#78350f;border:1px solid #facc15;padding:6px 12px;border-radius:99px;font-weight:800;font-size:12px}
</style></head><body>
<div class="header"><b>KLIDO AVANZA</b><button class="btn-black" onclick="location.href='/bandeja'">← Volver a Bandeja</button></div>
<div class="card"><h2>Campaña alion_co</h2><p>Esta campaña genera el distintivo amarillo en la bandeja.</p>
<p><span class="badge-yellow">Escribió por campaña: alion_co</span></p>
<p style="color:#64748b">Todos los contactos nuevos entrarán en <b>HOY con punto rojo 🔴</b> y al responder pasarán a Bandeja normal.</p>
<button class="btn-black" style="width:100%;padding:14px;margin-top:12px" onclick="location.href='/bandeja'">Ir a Bandeja Azul</button></div></body></html>`;

app.listen(PORT, () => console.log('KLIDO AVANZA OK en puerto ' + PORT));
