const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";
let chats = {};

const BANDEJA_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Klido Bandeja</title><style>body{margin:0;font-family:Arial;background:#111;color:#fff;display:flex;height:100vh}.lista{width:350px;background:#181818;border-right:1px solid #333;overflow:auto}.chat{padding:14px;border-bottom:1px solid #222;cursor:pointer}.chat:hover{background:#222}.chat b{color:#25D366}.msgs{flex:1;display:flex;flex-direction:column}.mensajes{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:10px}.msg{padding:10px 14px;border-radius:12px;max-width:70%;font-size:14px}.cliente{background:#2a2a2a;align-self:flex-start}.yo{background:#25D366;color:#000;align-self:flex-end}.input{display:flex;padding:12px;border-top:1px solid #333;background:#181818}#txt{flex:1;padding:12px;border-radius:20px;border:none;outline:none}#btn{margin-left:10px;padding:12px 20px;background:#25D366;border:none;border-radius:20px;font-weight:bold;cursor:pointer}</style></head><body><div class="lista" id="lista"><p style="padding:20px">Cargando...</p></div><div class="msgs"><div class="mensajes" id="mensajes"><p>Selecciona un chat</p></div><div class="input"><input id="txt" placeholder="Escribe mensaje..."><button id="btn" onclick="enviar()">Enviar</button></div></div><script>let chats=[],actual=null;async function cargar(){let r=await fetch('/api/chats');chats=await r.json();let h='';if(chats.length==0){document.getElementById('lista').innerHTML='<p style=padding:20px>No hay chats. Mandate un WhatsApp.</p>';return}chats.forEach(c=>{let u=c.msgs[c.msgs.length-1]?.text||'';h+=\`<div class=chat onclick="abrir('\${c.tel}')"><b>\${c.nombre}</b><br><small>\${c.tel}</small><br><small style=color:#aaa>\${u.slice(0,30)}</small></div>\`});document.getElementById('lista').innerHTML=h}function abrir(tel){actual=tel;let c=chats.find(x=>x.tel==tel);if(!c)return;let h='';c.msgs.forEach(m=>{h+=\`<div class="msg \${m.from}"><small style=font-size:10px;opacity:.6>\${m.time||''}</small><br>\${m.text}</div>\`});document.getElementById('mensajes').innerHTML=h;document.getElementById('mensajes').scrollTop=999999}async function enviar(){let t=document.getElementById('txt').value;if(!t||!actual)return;document.getElementById('txt').value='';await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})});cargar();setTimeout(()=>abrir(actual),500)}document.getElementById('txt').addEventListener('keydown',e=>{if(e.key=='Enter')enviar()});setInterval(cargar,3000);cargar();</script></body></html>`;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req,res)=> res.send(BANDEJA_HTML));
app.get('/bandeja', (req,res)=> res.send(BANDEJA_HTML));
app.get('/bandeja.html', (req,res)=> res.send(BANDEJA_HTML));

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
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
  } catch(e){}
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

app.get('/campanas.html', (req,res)=>{
  res.sendFile(path.join(__dirname, 'public', 'campanas.html'), (err)=>{
    if(err) res.send('<h1>Campañas OK - sube campanas.html a public</h1>');
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO ONLINE'));
