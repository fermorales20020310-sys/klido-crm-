const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let chats = {};
try { if(fs.existsSync('chats.json')) chats = JSON.parse(fs.readFileSync('chats.json','utf8')); } catch(e){ chats = {}; }

function save(){ fs.writeFileSync('chats.json', JSON.stringify(chats, null, 2)); }

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY = process.env.VERIFY_TOKEN || 'klido123';

// Verificación Meta
app.get('/webhook', (req,res)=>{
  if(req.query['hub.verify_token'] === VERIFY){
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Recibir mensajes
app.post('/webhook', (req,res)=>{
  try{
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if(msg){
      const from = msg.from;
      const text = msg.text?.body || msg.button?.text || msg.interactive?.list_reply?.title || msg.interactive?.button_reply?.title || `[${msg.type}]`;
      const name = value.contacts?.[0]?.profile?.name || value.contacts?.[0]?.wa_id || from;
      if(!chats[from]) chats[from] = {tel: from, nombre: name, msgs: [], unread: 0};
      chats[from].nombre = name;
      chats[from].msgs.push({from:'cliente', text, time: new Date().toLocaleString('es-CO')});
      chats[from].unread = (chats[from].unread || 0) + 1;
      save();
      console.log('Mensaje de', from, text);
    }
  }catch(e){ console.error(e); }
  res.sendStatus(200);
});

app.get('/api/chats', (req,res)=>{
  res.json(Object.values(chats).sort((a,b)=> (b.msgs?.[b.msgs.length-1]?.time || '').localeCompare(a.msgs?.[a.msgs.length-1]?.time || '')));
});

app.get('/api/clear', (req,res)=>{
  chats = {};
  save();
  res.json({ok:true, cleared:true});
});

app.post('/api/send', async (req,res)=>{
  const {to, text} = req.body;
  try{
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: 'whatsapp', to, text: {body: text}
    }, {headers: {Authorization: `Bearer ${TOKEN}`}});
    if(!chats[to]) chats[to] = {tel: to, nombre: to, msgs: [], unread: 0};
    chats[to].msgs.push({from:'yo', text, time: new Date().toLocaleString('es-CO')});
    save();
    res.json({ok:true});
  }catch(e){
    console.error(e.response?.data || e.message);
    res.status(500).json({error: e.response?.data || e.message});
  }
});

app.post('/api/send-campaign', async (req,res)=>{
  const {contacts, message} = req.body;
  let sent = 0;
  for(const c of contacts){
    const txt = message.replace(/{nombre}/gi, c.nombre || '').replace(/{name}/gi, c.nombre || '');
    try{
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
        messaging_product: 'whatsapp', to: c.tel, text: {body: txt}
      }, {headers: {Authorization: `Bearer ${TOKEN}`}});
      sent++;
    }catch(e){ console.error('fail', c.tel); }
    await new Promise(r=> setTimeout(r, 1200));
  }
  res.json({ok:true, sent});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('KLIDO CRM en', PORT));
