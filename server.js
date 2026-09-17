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

const CRM_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Klido CRM</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#0f0f0f;color:#fff;height:100vh;display:flex;flex-direction:column}
.top{height:55px;background:#181818;border-bottom:1px solid #222;display:flex;align-items:center;padding:0 20px;gap:15px}
.top b{color:#25D366;font-size:18px}.top button{background:#222;color:#fff;border:1px solid #333;padding:8px 16px;border-radius:20px;cursor:pointer}.top button.active{background:#25D366;color:#000;font-weight:bold;border-color:#25D366}
.main{flex:1;display:flex;overflow:hidden}
.view{flex:1;display:none}.view.active{display:flex}
.lista{width:340px;background:#181818;border-right:1px solid #222;overflow:auto}.chat{padding:14px;border-bottom:1px solid #222;cursor:pointer}.chat:hover{background:#222}.chat b{color:#25D366}
.msgs{flex:1;display:flex;flex-direction:column}.mensajes{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:10px}.msg{padding:10px 14px;border-radius:12px;max-width:70%;font-size:14px}.cliente{background:#2a2a2a;align-self:flex-start}.yo{background:#25D366;color:#000;align-self:flex-end}
.input{display:flex;padding:12px;border-top:1px solid #333;background:#181818}#txt{flex:1;padding:12px;border-radius:20px;border:none;outline:none}#btn{margin-left:10px;padding:12px 20px;background:#25D366;border:none;border-radius:20px;font-weight:bold;cursor:pointer}
.camp-box{padding:30px;max-width:800px;width:100%;margin:auto;overflow:auto}textarea,input{width:100%;background:#181818;color:#fff;border:1px solid #333;border-radius:12px;padding:12px;margin-top:8px}label{margin-top:18px;display:block;color:#aaa}
</style></head><body>
<div class="top"><b>KLIDO CRM</b><button id="b1" class="active" onclick="show('bandeja')">💬 Bandeja</button><button id="b2" onclick="show('campanas')">📢 Campañas ALIÓN</button><span style="margin-left:auto;color:#666" id="count">0 chats</span></div>
<div class="main">
<div id="v-bandeja" class="view active"><div class="lista" id="lista"></div><div class="msgs"><div class="mensajes" id="mensajes"><p style="color:#666">Selecciona un chat</p></div><div class="input"><input id="txt" placeholder="Escribe mensaje..."><button id="btn" onclick="enviar()">Enviar</button></div></div></div>
<div id="v-campanas" class="view"><div class="camp-box"><h2 style="color:#25D366">Campaña ALIÓN</h2>
<label>Contactos (Formato: Nombre, Número - uno por línea)<br>Ej: Fer, 573001234567</label><textarea id="contacts" rows="6" placeholder="Juan Perez, 573001111222&#10;Maria, 573002223333"></textarea>
<label>Mensaje (usa {nombre} para personalizar)</label><textarea id="msgCamp" rows="5">Hola {nombre} 👋 soy de ALIÓN, te tenemos una oferta especial para tu crédito...</textarea>
<button onclick="sendCamp()" id="btnCamp" style="margin-top:20px;padding:14px 25px;background:#25D366;border:none;border-radius:10px;font-weight:bold;cursor:pointer;width:100%">🚀 ENVIAR CAMPAÑA</button><div id="resCamp" style="margin-top:15px;color:#25D366"></div></div></div>
</div>
<script>
function show(v){document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.top button').forEach(x=>x.classList.remove('active'));document.getElementById('v-'+v).classList.add('active');document.getElementById('b'+(v=='bandeja'?1:2)).classList.add('active')}
let chats=[],actual=null;async function cargar(){let r=await fetch('/api/chats');chats=await r.json();document.getElementById('count').innerText=chats.length+' chats';let h='';if(chats.length==0){document.getElementById('lista').innerHTML='<p style=padding:20px;color:#666>No hay chats</p>';return}chats.forEach(c=>{let u=c.msgs[c.msgs.length-1]?.text||'';h+=\`<div class=chat onclick="abrir('\${c.tel}')"><b>\${c.nombre}</b><br><small>\${c.tel}</small><br><small style=color:#aaa>\${u.slice(0,30)}</small></div>\`});document.getElementById('lista').innerHTML=h}
function abrir(tel){actual=tel;let c=chats.find(x=>x.tel==tel);if(!c)return;let h='';c.msgs.forEach(m=>{h+=\`<div class="msg \${m.from}"><small style=font-size:10px;opacity:.6>\${m.time||''}</small><br>\${m.text}</div>\`});document.getElementById('mensajes').innerHTML=h;document.getElementById('mensajes').scrollTop=999999}
async function enviar(){let t=document.getElementById('txt').value;if(!t||!actual)return;document.getElementById('txt').value='';await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})});cargar();setTimeout(()=>abrir(actual),500)}
async function sendCamp(){let raw=document.getElementById('contacts').value.trim().split('\\n');let message=document.getElementById('msgCamp').value;let contacts=raw.map(l=>{let p=l.split(',');return{nombre:(p[0]||'').trim(),tel:(p[1]||p[0]||'').trim().replace(/[^0-9]/g,'')}}).filter(c=>c.tel.length>9);if(contacts.length==0){alert('Pon números');return}document.getElementById('btnCamp').innerText='Enviando...';document.getElementById('btnCamp').disabled=true;let r=await fetch('/api/send-campaign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contacts,message})});let d=await r.json();document.getElementById('resCamp').innerText='✅ Enviados: '+d.sent+' de '+contacts.length;document.getElementById('btnCamp').innerText='🚀 ENVIAR CAMPAÑA';document.getElementById('btnCamp').disabled=false}
document.getElementById('txt').addEventListener('keydown',e=>{if(e.key=='Enter')enviar()});setInterval(cargar,3000);cargar();
</script></body></html>`;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req,res)=> res.send(CRM_HTML));
app.get('/bandeja', (req,res)=> res.send(CRM_HTML));
app.get('/bandeja.html', (req,res)=> res.send(CRM_HTML));

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
    await axios.post(\`https://graph.facebook.com/v20.0/\${PHONE_ID}/messages\`, {
      messaging_product: "whatsapp", to, type: "text", text: { body: text }
    }, { headers: { Authorization: \`Bearer \${TOKEN}\` } });
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
      await axios.post(\`https://graph.facebook.com/v20.0/\${PHONE_ID}/messages\`, {
        messaging_product: "whatsapp", to: c.tel, type: "text", text: { body: textoFinal }
      }, { headers: { Authorization: \`Bearer \${TOKEN}\` } });
      sent++; await new Promise(r=>setTimeout(r,700));
    } catch(e){}
  }
  res.json({ ok:true, sent });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO UNIFICADO ONLINE'));
