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

const DATA_FILE = path.join(__dirname, 'data.json');
let db = { contacts: {}, messages: {}, campaigns: {} };

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.contacts = raw.contacts || {};
    db.messages = raw.messages || {};
    db.campaigns = raw.campaigns || {};
  }
} catch(e){}

function saveDB(){
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function normalizarTel(tel){
  if(!tel) return '';
  let t = tel.toString().replace(/\D/g,'');
  if(t.length == 10) t = '57' + t;
  if(t.startsWith('0057')) t = t.substring(2);
  return t;
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    if (!entry ||!entry.messages) return res.sendStatus(200);
    const msg = entry.messages[0];
    const telefono = normalizarTel(msg.from);
    const texto = msg.text?.body || msg.button?.text || '[Mensaje no texto]';

    if (!db.contacts[telefono]) {
      db.contacts[telefono] = { telefono, nombre: entry.contacts?.[0]?.profile?.name || telefono, creado: new Date().toISOString() };
    }
    if (!db.messages[telefono]) db.messages[telefono] = [];

    db.messages[telefono].push({
      id: msg.id,
      telefono,
      tipo: 'recibido',
      texto,
      fecha: new Date().toISOString()
    });
    saveDB();
  } catch(e){ console.error(e) }
  res.sendStatus(200);
});

app.get('/api/contacts', (req, res) => {
  res.json(Object.values(db.contacts));
});

app.get('/api/messages/:telefono', (req, res) => {
  const tel = normalizarTel(req.params.telefono);
  res.json(db.messages[tel] || []);
});

app.post('/api/send', async (req, res) => {
  try {
    let { to, texto } = req.body;
    const telefono = normalizarTel(to);
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
    const TOKEN = process.env.WHATSAPP_TOKEN;

    const resp = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefono,
        type: "text",
        text: { body: texto }
      })
    });
    const data = await resp.json();
    if(!resp.ok) return res.status(400).json(data);

    if (!db.messages[telefono]) db.messages[telefono] = [];
    db.messages[telefono].push({
      id: data.messages?.[0]?.id || Date.now().toString(),
      telefono,
      tipo: 'enviado',
      texto,
      fecha: new Date().toISOString()
    });
    saveDB();
    res.json({ ok: true, data });
  } catch(e){ res.status(500).json({ error: e.message }); }
});

// ESTO QUITA EL CANNOT GET /bandeja
app.get('/bandeja', (req,res) => res.sendFile(path.join(__dirname,'public','bandeja.html')));
app.get('/campanas', (req,res) => res.sendFile(path.join(__dirname,'public','campanas.html')));
app.get('/campañas', (req,res) => res.sendFile(path.join(__dirname,'public','campanas.html')));

app.listen(PORT, () => console.log(`CRM corriendo en ${PORT}`));
