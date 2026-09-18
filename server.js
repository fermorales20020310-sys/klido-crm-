const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'data.json');

function normalizar(tel){
  if(!tel) return null;
  let t = tel.toString().replace(/\D/g,'');
  if(t.length < 8) return null; // evita contactos como "Gabriela" sin numero
  return t;
}

function leerData(){
  try{
    if(!fs.existsSync(DATA_FILE)) return {contacts:[], messages:{}};
    const d = JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
    if(!d.contacts) d.contacts = [];
    if(!d.messages) d.messages = {};
    // Limpia contactos sin telefono
    d.contacts = d.contacts.filter(c => c.telefono && normalizar(c.telefono));
    return d;
  }catch(e){ return {contacts:[], messages:{}} }
}
function guardarData(data){
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// API CONTACTOS
app.get('/api/contacts', (req,res)=>{
  const data = leerData();
  res.json(data.contacts);
});

// API MENSAJES
app.get('/api/messages/:tel', (req,res)=>{
  const data = leerData();
  const tel = normalizar(req.params.tel);
  res.json(data.messages[tel] || []);
});

// WEBHOOK VERIFICACION
app.get('/webhook', (req,res)=>{
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';
  if(req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

// WEBHOOK MENSAJES ENTRANTES
app.post('/webhook', (req,res)=>{
  const data = leerData();
  try{
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    const contact = entry?.contacts?.[0];
    if(msg && contact){
      const tel = normalizar(msg.from);
      const nombre = contact.profile?.name || tel;
      if(!tel) return res.sendStatus(200);

      if(!data.contacts.find(c=>c.telefono===tel)){
        data.contacts.unshift({telefono: tel, nombre: nombre});
      }
      if(!data.messages[tel]) data.messages[tel]=[];
      data.messages[tel].push({
        texto: msg.text?.body || '[archivo]',
        tipo: 'recibido',
        fecha: new Date().toISOString()
      });
      guardarData(data);
    }
  }catch(e){ console.log(e) }
  res.sendStatus(200);
});

// ENVIAR MENSAJE
app.post('/api/send', async (req,res)=>{
  const {to, texto} = req.body;
  const tel = normalizar(to);
  if(!tel ||!texto) return res.status(400).json({error:'faltan datos'});

  const TOKEN = process.env.WHATSAPP_TOKEN;
  const PHONE_ID = process.env.PHONE_NUMBER_ID;

  try{
    await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{
      method:'POST',
      headers:{'Authorization':`Bearer ${TOKEN}`,'Content-Type':'application/json'},
      body: JSON.stringify({messaging_product:'whatsapp', to: tel, text:{body:texto}})
    });
    const data = leerData();
    if(!data.messages[tel]) data.messages[tel]=[];
    data.messages[tel].push({texto, tipo:'enviado', fecha: new Date().toISOString()});
    guardarData(data);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}) }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Corriendo en '+PORT));
