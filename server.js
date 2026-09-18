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

app.get('/bandeja', (req,res) => res.sendFile(path.join(__dirname, 'public', 'bandeja.html')));

app.get('/api/contacts', (req,res) => {
  const data = getData();
  data.contacts.sort((a,b) => (b.isNew?1:0) - (a.isNew?1:0) || new Date(b.lastTime) - new Date(a.lastTime));
  res.json(data.contacts);
});

app.get('/api/messages/:tel', (req,res) => {
  res.json(getData().messages[req.params.tel] || []);
});

app.post('/api/send', async (req,res) => {
  const { to, texto } = req.body;
  const data = getData();
  if(!data.messages[to]) data.messages[to] = [];
  data.messages[to].push({ texto, tipo: 'enviado', fecha: new Date() });
  let c = data.contacts.find(x=>x.telefono===to);
  if(c){ c.unread=0; c.isNew=false; c.lastMsg=texto; c.lastTime=new Date(); }
  saveData(data);
  try{
    const r = await fetch(`https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`, {
      method:'POST',
      headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp', to:to, type:'text', text:{body:texto}})
    });
    const j = await r.json();
    console.log('RESPUESTA META:', j);
    res.json(j);
  }catch(e){ res.json({ok:false, error:e.message}) }
});

// WEBHOOK QUE RECIBE MENSAJES
app.post('/webhook', (req,res) => {
  try{
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const contact = value?.contacts?.[0];
    if(msg){
      const from = msg.from;
      const text = msg.text?.body || 'Mensaje nuevo';
      const nombre = contact?.profile?.name || from;
      const data = getData();
      let c = data.contacts.find(x=>x.telefono===from);
      if(!c){
        c={telefono:from, nombre:nombre, unread:1, isNew:true, lastMsg:text, lastTime:new Date()};
        data.contacts.push(c);
      }else{
        c.unread = (c.unread||0)+1;
        c.isNew=true;
        c.lastMsg=text;
        c.lastTime=new Date();
      }
      if(!data.messages[from]) data.messages[from]=[];
      data.messages[from].push({texto:text, tipo:'recibido', fecha:new Date()});
      saveData(data);
      console.log('NUEVO MENSAJE DE:', from);
    }
  }catch(e){ console.log(e) }
  res.sendStatus(200);
});

app.get('/webhook', (req,res) => {
  if(req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

// RUTA DE PRUEBA PARA VER EL PUNTO ROJO
app.get('/api/test', (req,res)=>{
  const data=getData();
  const tel='573001234567';
  if(!data.contacts.find(c=>c.telefono===tel)){
    data.contacts.push({telefono:tel, nombre:'Cliente Prueba', unread:3, isNew:true, lastMsg:'Hola, me interesa una casa', lastTime:new Date()});
    data.messages[tel]=[{texto:'Hola, me interesa una casa', tipo:'recibido', fecha:new Date()}];
    saveData(data);
  }
  res.json({ok:true});
});

app.listen(process.env.PORT || 3000, ()=>console.log('LISTO'));
