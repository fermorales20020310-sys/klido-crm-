const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({limit: '50mb'}));
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";

let chats = {};
try { if(fs.existsSync('./chats.json')) chats = JSON.parse(fs.readFileSync('./chats.json')); } catch(e){}

function save(){ fs.writeFileSync('./chats.json', JSON.stringify(chats)); }

// 1. ENVIAR (lo que ya tienes)
app.post('/api/send', async (req, res) => {
  const { to, message } = req.body;
  try {
    const url = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;
    const r = await axios.post(url, { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if(!chats[to]) chats[to] = {tel: to, nombre: to, msgs: []};
    chats[to].msgs.push({from:'yo', text: message, time: new Date().toLocaleString()});
    save();
    res.json({ok:true, id: r.data.messages[0].id});
  } catch(e){ res.status(500).json({ok:false, error: e.response?.data || e.message}); }
});

// 2. WEBHOOK PARA RECIBIR RESPUESTAS
app.get('/webhook', (req,res)=>{
  if(req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

app.post('/webhook', (req,res)=>{
  const entry = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = entry?.messages?.[0];
  if(msg){
    const from = msg.from;
    const text = msg.text?.body || `[${msg.type}]`;
    const name = entry.contacts?.[0]?.profile?.name || from;
    if(!chats[from]) chats[from] = {tel: from, nombre: name, msgs: []};
    chats[from].nombre = name;
    chats[from].msgs.push({from:'cliente', text, time: new Date().toLocaleString()});
    chats[from].unread = (chats[from].unread || 0) + 1;
    save();
    console.log("NUEVO MENSAJE DE", from, text);
  }
  res.sendStatus(200);
});

// 3. API PARA LA BANDEJA
app.get('/api/chats', (req,res)=>{ res.json(Object.values(chats).sort((a,b)=> b.msgs.length - a.msgs.length)); });
app.post('/api/read', (req,res)=>{ if(chats[req.body.tel]) chats[req.body.tel].unread=0; save(); res.json({ok:true}); });

app.listen(PORT, ()=> console.log('KLIDO CRM CON BANDEJA EN '+PORT));
