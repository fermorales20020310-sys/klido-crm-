const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";

let chats = {};

// RUTA EXACTA DE TUS ARCHIVOS
const publicPath = path.join(__dirname, 'public');
console.log("PUBLIC PATH:", publicPath);
console.log("FILES IN PUBLIC:", fs.existsSync(publicPath)? fs.readdirSync(publicPath) : "NO EXISTE PUBLIC");

app.use(express.static(publicPath));

// Forzar bandeja y campañas aunque falle el static
app.get('/bandeja', (req,res) => res.sendFile(path.join(publicPath, 'bandeja.html')));
app.get('/bandeja.html', (req,res) => res.sendFile(path.join(publicPath, 'bandeja.html')));
app.get('/campanas', (req,res) => res.sendFile(path.join(publicPath, 'campanas.html')));
app.get('/campanas.html', (req,res) => res.sendFile(path.join(publicPath, 'campanas.html')));

// WEBHOOK VERIFICACION
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (msg) {
      const tel = msg.from;
      const text = msg.text?.body || 'Archivo';
      const name = entry.contacts?.[0]?.profile?.name || tel;
      if (!chats[tel]) chats[tel] = { tel, nombre: name, msgs: [] };
      chats[tel].msgs.push({ from: 'cliente', text, time: new Date().toLocaleTimeString() });
    }
  } catch(e){ console.log(e) }
  res.sendStatus(200);
});

app.get('/api/chats', (req, res) => res.json(Object.values(chats)));
app.get('/api/clear', (req, res) => { chats = {}; res.json({ok:true}) });

app.post('/api/send', async (req, res) => {
  const { to, text } = req.body;
  try {
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp", to, type: "text", text: { body: text }
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!chats[to]) chats[to] = { tel: to, nombre: to, msgs: [] };
    chats[to].msgs.push({ from: 'yo', text, time: new Date().toLocaleTimeString() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json(err.response?.data || {}) }
});

app.post('/api/send-campaign', async (req, res) => {
  const { contacts, message } = req.body;
  let sent = 0;
  for (let c of contacts) {
    const textoFinal = message.replace(/{nombre}/gi, c.nombre||'');
    try {
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
        messaging_product: "whatsapp", to: c.tel, type: "text", text: { body: textoFinal }
      }, { headers: { Authorization: `Bearer ${TOKEN}` } });
      sent++; await new Promise(r=>setTimeout(r,700));
    } catch(e){}
  }
  res.json({ ok:true, sent });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO ONLINE'));
