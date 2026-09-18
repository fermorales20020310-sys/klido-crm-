const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(bodyParser.json());
app.use(express.static('public'));

const DATA_FILE = './data.json';
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({contacts:[], messages:{}}));

function getData(){ try{ return JSON.parse(fs.readFileSync(DATA_FILE)); }catch(e){ return {contacts:[], messages:{}} } }
function saveData(d){ fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

app.get('/bandeja', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'bandeja.html'));
});

app.get('/api/contacts', (req,res) => res.json(getData().contacts));
app.get('/api/messages/:tel', (req,res) => res.json(getData().messages[req.params.tel] || []));

app.post('/api/send', async (req,res) => {
  const { to, texto } = req.body;
  console.log('INTENTO ENVIAR A:', to);
  if(!to || to === 'undefined') return res.json({ok:false, error:'numero undefined'});

  const data = getData();
  if(!data.messages[to]) data.messages[to] = [];
  data.messages[to].push({ texto, tipo: 'enviado', fecha: new Date() });
  saveData(data);

  try {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.PHONE_NUMBER_ID;
    const r = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: texto } })
    });
    const j = await r.json();
    console.log('RESPUESTA META:', JSON.stringify(j));
    return res.json(j);
  } catch(e){ console.log(e); return res.json({ok:false, error:e.message}); }
});

app.post('/webhook', (req,res) => {
  try{
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const contact = value?.contacts?.[0];
    if(msg){
      const from = msg.from;
      const text = msg.text?.body || msg.button?.text || 'mensaje no texto';
      const nombre = contact?.profile?.name || from;
      const data = getData();
      if(!data.contacts.find(c=>c.telefono===from)){
        data.contacts.push({ telefono: from, nombre: nombre });
      }
      if(!data.messages[from]) data.messages[from] = [];
      data.messages[from].push({ texto: text, tipo: 'recibido', fecha: new Date() });
      saveData(data);
      console.log('MENSAJE RECIBIDO DE:', from, text);
    }
  }catch(e){ console.log(e) }
  res.sendStatus(200);
});

app.get('/webhook', (req,res) => {
  if(req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

app.listen(process.env.PORT || 3000, ()=> console.log('LISTO'));
