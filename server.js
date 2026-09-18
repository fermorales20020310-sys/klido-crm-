require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'data.json');

let db = { contacts: {}, messages: {} };
if (fs.existsSync(DATA_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e){ db = { contacts: {}, messages: {} }; }
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// API CONTACTOS
app.get('/api/contacts', (req, res) => {
  const list = Object.values(db.contacts).sort((a,b)=> (b.lastTimestamp||0)-(a.lastTimestamp||0));
  res.json(list);
});

app.get('/api/messages/:wa_id', (req, res) => {
  const wa_id = req.params.wa_id;
  res.json(db.messages[wa_id] || []);
  if(db.contacts[wa_id]){
    db.contacts[wa_id].unread = 0;
    saveDB();
  }
});

app.post('/api/send', async (req, res) => {
  const { wa_id, text } = req.body;
  if(!wa_id ||!text) return res.status(400).json({error:'Falta wa_id o texto'});

  // 1. Guardar local
  if(!db.messages[wa_id]) db.messages[wa_id]=[];
  db.messages[wa_id].push({ from:'me', text, timestamp: Date.now() });

  // 2. Quitar de HOT y pasar a bandeja normal
  if(db.contacts[wa_id]){
    db.contacts[wa_id].lastMessage = text;
    db.contacts[wa_id].lastTimestamp = Date.now();
    db.contacts[wa_id].hot = false; // <- CLAVE: Al responder se va de HOY
    db.contacts[wa_id].unread = 0;
  }
  saveDB();

  // 3. Enviar a WhatsApp
  try {
    await axios.post(`https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      to: wa_id,
      type: "text",
      text: { body: text }
    }, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });
    res.json({ ok:true });
  } catch(err){
    console.log(err.response?.data || err.message);
    res.json({ ok:true, warning: 'Guardado local, error enviando a WA', detail: err.response?.data });
  }
});

// WEBHOOK VERIFICACION
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WEBHOOK MENSAJES ENTRANTES
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        const value = change.value;
        const messages = value.messages;
        if (messages) {
          messages.forEach(async (msg) => {
            const wa_id = msg.from;
            let text = '';
            if(msg.type === 'text') text = msg.text.body;
            else if(msg.type === 'image') text = '[image] ' + (msg.image?.caption || '');
            else text = `[${msg.type}]`;

            const contactName = value.contacts?.[0]?.profile?.name || wa_id;

            // Detectar si viene de campaña (por contexto de anuncio)
            let campaignName = null;
            let fromCampaign = false;
            if (msg.context && msg.context.from) { /* mensaje de respuesta */ }
            // Si tu campaña tiene referral o si el mensaje trae dato de campaña, lo marcas
            // Para alion_co lo detectamos por palabra o lo puedes pasar manual
            if (value?.contacts) {
              // Si el contacto ya tenía tag de campaña, se mantiene
            }

            // Si es primer mensaje y no existe, marcar como HOT
            if(!db.contacts[wa_id]){
              db.contacts[wa_id] = {
                wa_id,
                name: contactName,
                lastMessage: text,
                lastTimestamp: Date.now(),
                hot: true, // <- CLAVE: Entra a HOY con punto rojo
                unread: 1,
                fromCampaign: false,
                campaignName: null,
                tag: ''
              };
            } else {
              // Si ya existía y llega mensaje nuevo, vuelve a HOT
              db.contacts[wa_id].lastMessage = text;
              db.contacts[wa_id].lastTimestamp = Date.now();
              db.contacts[wa_id].hot = true; // <- CLAVE: Vuelve a HOY
              db.contacts[wa_id].unread = (db.contacts[wa_id].unread || 0) + 1;
              db.contacts[wa_id].name = contactName || db.contacts[wa_id].name;
            }

            // Si detectas que viene de campaña, activa amarillo
            // Puedes activarlo manual si sabes que es de alion_co, o por contexto
            // Ejemplo: si el primer mensaje contiene "alion" o si viene de anuncio
            if (msg.referral || text.toLowerCase().includes('alion') || db.contacts[wa_id].tag?.includes('alion')) {
              db.contacts[wa_id].fromCampaign = true;
              db.contacts[wa_id].campaignName = db.contacts[wa_id].campaignName || 'alion_co';
              db.contacts[wa_id].tag = 'alion_co';
            }

            if(!db.messages[wa_id]) db.messages[wa_id]=[];
            db.messages[wa_id].push({ from:'client', text, timestamp: Date.now() });
            saveDB();
          });
        }
      });
    });
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// RUTAS FRONT
app.get('/bandeja', (req, res) => res.sendFile(path.join(__dirname,'public','bandeja.html')));
app.get('/campanas', (req, res) => res.sendFile(path.join(__dirname,'public','campanas.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));

// TEMPLATE API (para que no te salga error)
app.get('/api/templates', async (req,res)=>{
  try{
    const wabaId = process.env.WABA_ID;
    if(!wabaId) return res.json([]);
    const r = await axios.get(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`,{
      headers:{ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
    });
    res.json(r.data.data || []);
  }catch(e){ res.json([]); }
});

app.listen(PORT, ()=> console.log('KLIDO corriendo en '+PORT));
