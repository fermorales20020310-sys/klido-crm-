const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(bodyParser.json());
app.use(express.static('public'));

const DATA_FILE = './data.json';
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({contacts:[], messages:{}}));

function getData(){ return JSON.parse(fs.readFileSync(DATA_FILE)); }
function saveData(d){ fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

// ESTO ARREGLA TU ERROR DE LA CAPTURA
app.get('/bandeja', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'bandeja.html'));
});

app.get('/api/contacts', (req,res) => {
  const data = getData();
  res.json(data.contacts);
});

app.get('/api/messages/:tel', (req,res) => {
  const data = getData();
  res.json(data.messages[req.params.tel] || []);
});

app.post('/api/send', async (req,res) => {
  const { to, texto } = req.body;
  const data = getData();

  // Guardar mensaje enviado
  if(!data.messages[to]) data.messages[to] = [];
  data.messages[to].push({ texto, tipo: 'enviado', fecha: new Date() });
  saveData(data);

  // Enviar por API de WhatsApp
  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;
    if(token && phoneId){
      await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: texto } })
      });
    }
  } catch(e){ console.log(e) }
  res.json({ok:true});
});

// WEBHOOK PARA RECIBIR MENSAJES
app.post('/webhook', (req,res) => {
  try{
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(entry){
      const from = entry.from;
      const text = entry.text?.body || '';
      const data = getData();
      if(!data.contacts.find(c=>c.telefono===from)) data.contacts.push({ telefono: from, nombre: from });
      if(!data.messages[from]) data.messages[from] = [];
      data.messages[from].push({ texto: text, tipo: 'recibido', fecha: new Date() });
      saveData(data);
    }
  }catch(e){}
  res.sendStatus(200);
});

app.get('/webhook', (req,res) => {
  if(req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('KLIDO listo en puerto '+PORT));
