const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(bodyParser.json());

// TU API VERIFICADA - vienen de Railway Variables
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";

let chats = {};
let campaigns = [];
let blocked = new Set(); // Para respetar STOP

const TEMPLATE_NAME = "alion_co";
const TEMPLATE_LANG = "es_CO";

const CRM_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klido Avanza</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f0f2f5;height:100vh;display:flex;flex-direction:column}
.top{height:60px;background:#0B57D0;color:#fff;display:flex;align-items:center;padding:0 20px}
.main{flex:1;display:flex;overflow:hidden}
.lista{width:360px;background:#fff;border-right:1px solid #ddd;overflow:auto}.chat{padding:14px;border-bottom:1px solid #eee;cursor:pointer}.chat b{color:#0B57D0}
.msgs{flex:1;display:flex;flex-direction:column;background:#e5ddd5}.mensajes{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:10px}.msg{padding:10px 14px;border-radius:18px;max-width:72%;font-size:14px}.cliente{background:#fff;align-self:flex-start}.yo{background:#0B57D0;color:#fff;align-self:flex-end}
.input{display:flex;padding:12px;background:#f0f2f5;gap:10px}#txt{flex:1;padding:12px 16px;border-radius:25px;border:1px solid #ddd;outline:none}
.btn-camp{position:fixed;bottom:20px;left:20px;background:#0B57D0;color:#fff;border:none;padding:15px 24px;border-radius:30px;font-weight:bold;cursor:pointer;box-shadow:0 4px 15px rgba(11,87,208,.4);z-index:10}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20;align-items:center;justify-content:center}.modal.active{display:flex}.modal-box{background:#fff;width:95%;max-width:700px;border-radius:16px;overflow:hidden;max-height:92vh;display:flex;flex-direction:column}.modal-head{padding:18px 20px;background:#0B57D0;color:#fff;display:flex;justify-content:space-between}.modal-body{padding:20px;overflow:auto}
table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #eee;font-size:13px;text-align:left}
</style></head><body>
<div class="top"><b>KLIDO AVANZA</b><span style="margin-left:auto" id="count">0 chats</span></div>
<div class="main"><div class="lista" id="lista"></div><div class="msgs"><div class="mensajes" id="mensajes"><p style="color:#666">Selecciona un chat</p></div><div class="input"><input id="txt" placeholder="Escribe..."><button onclick="enviar()" style="background:#0B57D0;color:#fff;border:none;border-radius:50%;width:45px;height:45px;cursor:pointer">➤</button></div></div></div>
<button class="btn-camp" onclick="openCamp()">📢 CAMPAÑAS</button>
<div class="modal" id="modalCamp"><div class="modal-box"><div class="modal-head"><b>📢 Campaña ALIÓN - Oficial Verificada</b><button onclick="closeCamp()" style="background:#fff;color:#0B57D0;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer">X</button></div><div class="modal-body">
<p style="background:#e8f0fe;padding:12px;border-radius:10px;font-size:13px">✅ Plantilla: <b>alion_co</b> | ID: 1060826656745017 | Estado: Activa - Legal y verificada por Meta</p>
<label><b>Contactos (Nombre, Número - solo clientes con opt-in)</b></label><textarea id="contacts" rows="4" placeholder="Fer, 573001234567"></textarea>
<table id="tablaCamp" style="margin-top:15px"><tr><th>Fecha</th><th>Enviados</th><th>Estado</th></tr></table>
<button onclick="sendCamp()" id="btnCamp" style="margin-top:18px;width:100%;padding:14px;background:#0B57D0;color:#fff;border:none;border-radius:10px;font-weight:bold;cursor:pointer">🚀 ENVIAR PLANTILLA OFICIAL</button><div id="resCamp" style="margin-top:12px;font-weight:bold;text-align:center"></div>
<button onclick="closeCamp()" style="margin-top:10px;width:100%;padding:12px;background:#eee;border:none;border-radius:10px">← Volver a bandeja</button>
</div></div></div>
<script>
function openCamp(){document.getElementById('modalCamp').classList.add('active');loadCamp()}
function closeCamp(){document.getElementById('modalCamp').classList.remove('active')}
let chats=[],actual=null;
async function cargar(){let r=await fetch('/api/chats');chats=await r.json();document.getElementById('count').innerText=chats.length+' chats';let h='';if(!chats.length){document.getElementById('lista').innerHTML='<p style=padding:20px;color:#888>No hay chats</p>';return}chats.forEach(c=>{h+=\`<div class=chat onclick="abrir('\${c.tel}')"><b>\${c.nombre}</b><br><small>\${c.tel}</small></div>\`});document.getElementById('lista').innerHTML=h}
function abrir(tel){actual=tel;let c=chats.find(x=>x.tel==tel);let h='';c.msgs.forEach(m=>{h+=\`<div class="msg \${m.from}">\${m.text}</div>\`});document.getElementById('mensajes').innerHTML=h}
async function enviar(){let t=document.getElementById('txt').value;if(!t||!actual)return;document.getElementById('txt').value='';await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})});cargar();setTimeout(()=>abrir(actual),500)}
async function sendCamp(){let raw=document.getElementById('contacts').value.trim().split('\\n');let contacts=raw.map(l=>{let p=l.split(',');return{nombre:(p[0]||'').trim(),tel:(p[1]||p[0]||'').trim().replace(/[^0-9]/g,'')}}).filter(c=>c.tel.length>9);if(!contacts.length){alert('Pon números');return}document.getElementById('btnCamp').innerText='Enviando...';let r=await fetch('/api/send-campaign-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contacts})});let d=await r.json();document.getElementById('resCamp').innerText='✅ Enviados: '+d.sent+' | Bloqueados/Opt-out: '+d.failed;loadCamp();setTimeout(closeCamp,1500);document.getElementById('btnCamp').innerText='🚀 ENVIAR PLANTILLA OFICIAL'}
async function loadCamp(){let r=await fetch('/api/campaigns');let data=await r.json();let h='<tr><th>Fecha</th><th>Enviados</th><th>Estado</th></tr>';data.slice().reverse().forEach(c=>{h+=\`<tr><td>\${c.fecha}</td><td>\${c.sent}</td><td>\${c.estado}</td></tr>\`});document.getElementById('tablaCamp').innerHTML=h}
document.getElementById('txt').addEventListener('keydown',e=>{if(e.key=='Enter')enviar()});setInterval(cargar,3000);cargar();
</script></body></html>`;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req,res)=> res.send(CRM_HTML));
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
      const text = msg.text?.body || '';
      const name = entry.contacts?.[0]?.profile?.name || tel;
      // LEGAL: Respetar STOP
      if (/stop|no quiero|no me envie|salir|baja/i.test(text)) {
        blocked.add(tel);
        console.log('Opt-out:', tel);
      }
      if (!chats[tel]) chats[tel] = { tel, nombre: name, msgs: [] };
      chats[tel].msgs.push({ from: 'cliente', text, time: new Date().toLocaleTimeString() });
    }
  } catch(e){}
  res.sendStatus(200);
});

app.get('/api/chats', (req, res) => res.json(Object.values(chats)));
app.get('/api/campaigns', (req,res)=> res.json(campaigns));

app.post('/api/send', async (req, res) => {
  const { to, text } = req.body;
  if (blocked.has(to)) return res.status(400).json({ error: 'Usuario opt-out' });
  try {
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp", to, type: "text", text: { body: text }
    }, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!chats[to]) chats[to] = { tel: to, nombre: to, msgs: [] };
    chats[to].msgs.push({ from: 'yo', text, time: new Date().toLocaleTimeString() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json(err.response?.data || {}) }
});

app.post('/api/send-campaign-template', async (req, res) => {
  const { contacts } = req.body;
  let sent = 0, failed = 0;
  const fecha = new Date().toLocaleString('es-CO');
  for (let c of contacts) {
    if (blocked.has(c.tel)) { failed++; continue; }
    try {
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
        messaging_product: "whatsapp",
        to: c.tel,
        type: "template",
        template: { name: TEMPLATE_NAME, language: { code: TEMPLATE_LANG } }
      }, { headers: { Authorization: `Bearer ${TOKEN}` } });
      sent++;
      await new Promise(r=>setTimeout(r, 800)); // Delay legal anti-spam
    } catch(e){ failed++; }
  }
  campaigns.push({ fecha, sent, failed, estado: 'Enviada legal', plantilla: TEMPLATE_NAME });
  res.json({ ok:true, sent, failed });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO AVANZA LEGAL ONLINE'));
