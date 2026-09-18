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

// ------ DB ------
const DATA_FILE = path.join(__dirname, 'data.json');
let db = { contacts: {}, messages: {}, campaigns: {} };

try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.contacts = raw.contacts || {};
    db.messages = raw.messages || {};
    db.campaigns = raw.campaigns || {};
  }
} catch(e){ console.log("Error leyendo DB", e) }

function saveDB(){
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ------ ESTO ARREGLA TU HISTORIAL ------
function normalizarTel(tel){
  if(!tel) return '';
  let t = tel.toString().replace(/\D/g,'');
  // quita 57 si viene con 00 o + ya lo quitamos arriba
  if(t.length == 10) t = '57' + t; // si es 311... le pone 57
  if(t.startsWith('0057')) t = t.substring(2);
  return t;
}

// ------ WEBHOOK: RECIBIR MENSAJES ------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  // pon el mismo verify_token que pusiste en Meta
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
    const telefonoRaw = msg.from;
    const telefono = normalizarTel(telefonoRaw);
    const texto = msg.text?.body || msg.button?.text || '[Otro tipo de mensaje]';

    // Busca o crea contacto SIEMPRE por telefono normalizado
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
    console.log(`Mensaje guardado de ${telefono}: ${texto}`);
  } catch(e){ console.error(e) }
  res.sendStatus(200);
});

// ------ API PARA TU BANDEJA.HTML ------
app.get('/api/contacts', (req, res) => {
  res.json(Object.values(db.contacts));
});

app.get('/api/messages/:telefono', (req, res) => {
  const tel = normalizarTel(req.params.telefono);
  res.json(db.messages[tel] || []);
});

// ------ API PARA RESPONDER - ESTO ARREGLA QUE NO LES LLEGA ------
app.post('/api/send', async (req, res) => {
  try {
    let { to, texto } = req.body;
    const telefono = normalizarTel(to);

    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
    const TOKEN = process.env.WHATSAPP_TOKEN;

    if(!PHONE_NUMBER_ID ||!TOKEN){
      return res.status(500).json({ error: "Falta PHONE_NUMBER_ID o WHATSAPP_TOKEN en env" });
    }

    const resp = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefono,
        type: "text",
        text: { body: texto }
      })
    });

    const data = await resp.json();

    if(!resp.ok){
      console.error("Error Meta:", data);
      return res.status(400).json(data);
    }

    // Guardar mi respuesta en el MISMO historial
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
  } catch(e){
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`CRM corriendo en puerto ${PORT}`));
