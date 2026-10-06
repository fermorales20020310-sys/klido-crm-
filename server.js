// KLIDO CRM V180 - TODO TODO COMPLETO - WEBHOOK + ENVIO + CRM
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));

// --- DB EN VOLUMEN ---
const DB_PATH = '/app/db';
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });
const PUBLIC_PATH = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_PATH)) fs.mkdirSync(PUBLIC_PATH, { recursive: true });

function sanitize(id){ return String(id||'default').replace(/[^a-z0-9_\-@.]/gi,'').substring(0,80); }

function getDB(empresa_id){
  const file = path.join(DB_PATH, `${sanitize(empresa_id)}.json`);
  if(!fs.existsSync(file)) return { empresa_id, config:{}, chats:{} };
  try{ return JSON.parse(fs.readFileSync(file,'utf8')); }catch{ return { empresa_id, config:{}, chats:{} }; }
}
function saveDB(empresa_id, data){
  const file = path.join(DB_PATH, `${sanitize(empresa_id)}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function loadConfig(empresa_id){
  let db = getDB(empresa_id);
  if(!db.config) db.config = {};
  // Variables de Railway mandan
  if(process.env.WHATSAPP_TOKEN) db.config.token = process.env.WHATSAPP_TOKEN.trim();
  if(process.env.PHONE_NUMBER_ID) db.config.phone = process.env.PHONE_NUMBER_ID.trim();
  if(process.env.WABA_ID) db.config.waba = process.env.WABA_ID.trim();
  if(!db.chats) db.chats = {};
  saveDB(empresa_id, db);
  return db.config;
}
function findEmpresaIdByPhone(phone_number_id){
  if(!phone_number_id) return 'fermorales20020gmailcom_1234';
  try{
    const files = fs.readdirSync(DB_PATH);
    for(const f of files){
      if(!f.endsWith('.json')) continue;
      try{
        const j = JSON.parse(fs.readFileSync(path.join(DB_PATH,f),'utf8'));
        if(j.config && j.config.phone && String(j.config.phone)===String(phone_number_id)){
          return j.empresa_id || f.replace('.json','');
        }
      }catch{}
    }
  }catch{}
  // default tuyo
  return 'fermorales20020gmailcom_1234';
}

const VERIFY_TOKEN = (process.env.META_VERIFY_TOKEN || 'klido123').trim();
console.log('================================');
console.log('KLIDO V180 OK');
console.log('VERIFY_TOKEN:', VERIFY_TOKEN);
console.log('PHONE_ID env:', process.env.PHONE_NUMBER_ID);
console.log('HAS TOKEN env:',!!process.env.WHATSAPP_TOKEN);
console.log('================================');

// --- WEBHOOK VERIFICACION ---
function verifyWebhook(req,res){
  console.log('GET VERIFY', req.path, req.query);
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN){
    console.log('✅ WEBHOOK VERIFICADO OK');
    return res.status(200).send(req.query['hub.challenge']);
  }
  console.log('❌ WEBHOOK FAIL TOKEN, esperado:', VERIFY_TOKEN, 'recibido:', req.query['hub.verify_token']);
  res.sendStatus(403);
}
app.get('/webhook', verifyWebhook);
app.get('/webhook/:empresa_id', verifyWebhook);

// --- WEBHOOK RECEPCION ---
function handleIncoming(body){
  console.log('📩 WEBHOOK POST RECIBIDO:', JSON.stringify(body).substring(0,3000));
  try{
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    if(!value){ console.log('sin value'); return; }

    const phoneId = value.metadata?.phone_number_id;
    const empresa_id = findEmpresaIdByPhone(phoneId);
    console.log('PhoneID:', phoneId, '-> Empresa:', empresa_id);

    let db = getDB(empresa_id);
    if(!db.chats) db.chats = {};

    // Mensajes entrantes
    if(value.messages){
      value.messages.forEach(m=>{
        const from = m.from; // 573...
        if(!db.chats[from]) db.chats[from] = { id: from, mensajes:[], no_leidos:0, last:Date.now() };
        let texto = '';
        if(m.type==='text') texto = m.text?.body || '';
        else if(m.type==='image') texto = '📷 Imagen';
        else if(m.type==='audio') texto = '🎤 Audio';
        else if(m.type==='document') texto = '📄 Documento';
        else texto = `📎 ${m.type}`;

        db.chats[from].mensajes.push({ from:'cliente', texto, ts: Date.now(), wamid: m.id });
        db.chats[from].no_leidos = (db.chats[from].no_leidos||0)+1;
        db.chats[from].last = Date.now();
        console.log(`✅ ENTRANTE [${empresa_id}] ${from}: ${texto}`);
      });
      saveDB(empresa_id, db);
    }
    // Estados (leido, entregado)
    if(value.statuses){
      console.log('STATUS:', value.statuses);
    }
  }catch(e){
    console.log('ERROR handleIncoming', e.message);
  }
}
app.post('/webhook', (req,res)=>{ handleIncoming(req.body); res.sendStatus(200); });
app.post('/webhook/:empresa_id', (req,res)=>{ handleIncoming(req.body); res.sendStatus(200); });

// --- APIS CRM ---
app.get('/api/chats/:empresa_id', (req,res)=>{
  const db = getDB(req.params.empresa_id);
  const list = Object.values(db.chats||{}).sort((a,b)=>(b.last||0)-(a.last||0));
  res.json(list);
});

app.get('/api/mensajes/:empresa_id/:chat_id', (req,res)=>{
  const db = getDB(req.params.empresa_id);
  const msgs = db.chats?.[req.params.chat_id]?.mensajes || [];
  res.json(msgs.sort((a,b)=>(a.ts||0)-(b.ts||0)));
});

app.post('/api/chat/leido', (req,res)=>{
  const { empresa_id, chat_id } = req.body;
  if(!empresa_id ||!chat_id) return res.json({ok:false});
  let db = getDB(empresa_id);
  if(db.chats?.[chat_id]){ db.chats[chat_id].no_leidos = 0; saveDB(empresa_id, db); }
  res.json({ok:true});
});

app.post('/api/mensaje/enviar', async (req,res)=>{
  const { empresa_id, chat_id, texto } = req.body;
  const eid = empresa_id || 'fermorales20020gmailcom_1234';
  console.log('➡️ INTENTO ENVIAR', { eid, chat_id, texto });
  const emp = loadConfig(eid);
  console.log('CONFIG ENVIO', { hasToken:!!emp.token, phone: emp.phone });

  if(!emp.token) return res.json({ok:false, error:'No hay WHATSAPP_TOKEN en Railway Variables'});
  if(!emp.phone) return res.json({ok:false, error:'No hay PHONE_NUMBER_ID en Railway Variables'});
  if(!chat_id) return res.json({ok:false, error:'Falta chat_id'});

  const to = String(chat_id).replace(/\D/g,'');
  try{
    const url = `https://graph.facebook.com/v20.0/${emp.phone}/messages`;
    const resp = await fetch(url,{
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${emp.token}` },
      body: JSON.stringify({ messaging_product:'whatsapp', to, type:'text', text:{ body: texto } })
    });
    const j = await resp.json();
    console.log('⬅️ RESP META:', JSON.stringify(j));

    if(j.error){
      return res.json({ ok:false, error: j.error.message, detalle: j });
    }
    if(j.messages && j.messages[0]){
      let db = getDB(eid);
      if(!db.chats[chat_id]) db.chats[chat_id] = { id: chat_id, mensajes:[], no_leidos:0, last: Date.now() };
      db.chats[chat_id].mensajes.push({ from:'agente', texto, ts: Date.now(), wamid: j.messages[0].id });
      db.chats[chat_id].last = Date.now();
      saveDB(eid, db);
      return res.json({ ok:true, id: j.messages[0].id });
    }
    res.json({ ok:false, error:'Respuesta inesperada', detalle: j });
  }catch(e){
    console.log('❌ ERROR ENVIO', e.message);
    res.json({ ok:false, error: e.message });
  }
});

// DEBUG
app.get('/api/debug/config/:empresa_id', (req,res)=>{
  res.json({ V:'V180', verify: VERIFY_TOKEN, config: loadConfig(req.params.empresa_id), time: new Date().toISOString() });
});
app.get('/api/debug/ping', (req,res)=>res.json({ok:true, V:'V180', now:Date.now()}));

// --- INDEX EMBEBIDO (para que no falle el deploy de public/index.html) ---
const INDEX_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klido CRM V180</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,system-ui;display:flex;height:100vh;overflow:hidden;background:#111b21}#sidebar{width:360px;background:#fff;border-right:1px solid #ddd;display:flex;flex-direction:column}#search{padding:10px;border-bottom:1px solid #eee}#q{width:100%;padding:10px 14px;border-radius:20px;border:1px solid #ddd;outline:none;background:#f0f2f5}#list{flex:1;overflow-y:auto}.item{padding:12px 14px;border-bottom:1px solid #f2f2f2;cursor:pointer;display:flex;gap:10px;align-items:center}.item:hover{background:#f5f6f6}.item.active{background:#e9edef}.av{width:38px;height:38px;border-radius:50%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}.name{font-weight:600;font-size:14px}.prev{font-size:12px;color:#667781;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}#area{flex:1;display:flex;flex-direction:column;background:#efeae2}#head{height:56px;padding:0 16px;background:#f0f2f5;border-bottom:1px solid #ddd;display:flex;align-items:center;font-weight:700}#msgs{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:6px}.bubble{max-width:68%;padding:8px 12px;border-radius:8px;font-size:14.2px;line-height:19px;box-shadow:0 1px.5px rgba(0,0,0,.13);word-break:break-word}.cli{align-self:flex-start;background:#fff;border-top-left-radius:0}.age{align-self:flex-end;background:#d9fdd3;border-top-right-radius:0}#input{height:62px;background:#f0f2f5;display:flex;align-items:center;gap:8px;padding:0 12px}#txt{flex:1;padding:11px 16px;border-radius:22px;border:0;outline:none;font-size:15px}#btn{border:0;background:#000;color:#fff;border-radius:22px;padding:10px 18px;font-weight:700;cursor:pointer}#empty{flex:1;display:flex;align-items:center;justify-content:center;color:#667781}</style></head><body><div id="sidebar"><div id="search"><input id="q" placeholder="Buscar chat..."></div><div id="list"></div></div><div id="area"><div id="head">Selecciona un chat - V180</div><div id="msgs"><div id="empty">Tus chats de WhatsApp aparecerán aquí<br><small>Si no aparecen, revisa Railway logs</small></div></div><div id="input"><input id="txt" placeholder="Escribe un mensaje..."><button id="btn">Enviar</button></div></div><script>let eid=localStorage.getItem('empresa_id')||'fermorales20020gmailcom_1234';let cur=null;function render(msgs){const c=document.getElementById('msgs');c.innerHTML='';if(!msgs.length){c.innerHTML='<div id="empty">No hay mensajes</div>';return;}msgs.forEach(m=>{const d=document.createElement('div');d.className='bubble '+(m.from==='agente'?'age':'cli');d.textContent=m.texto||'';c.appendChild(d);});c.scrollTop=c.scrollHeight;}async function loadChats(){try{const r=await fetch('/api/chats/'+eid);const chats=await r.json();const list=document.getElementById('list');const q=document.getElementById('q').value.toLowerCase();list.innerHTML='';chats.filter(c=>!q||c.id.toLowerCase().includes(q)).forEach(c=>{const div=document.createElement('div');div.className='item'+(cur===c.id?' active':'');const last=c.mensajes?.[c.mensajes.length-1]?.texto||'';const n=c.no_leidos||0;div.innerHTML='<div class="av">'+c.id.slice(-2)+'</div><div style="flex:1;min-width:0"><div class="name">'+c.id+(n?' <span style="background:#25d366;color:#fff;border-radius:10px;padding:2px 6px;font-size:11px">'+n+'</span>':'')+'</div><div class="prev">'+last.slice(0,40)+'</div></div>';div.onclick=()=>openChat(c.id);list.appendChild(div);});}catch(e){}}async function openChat(id){cur=id;document.getElementById('head').textContent=id;try{await fetch('/api/chat/leido',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:eid,chat_id:id})});}catch{}try{const r=await fetch('/api/mensajes/'+eid+'/'+id);const msgs=await r.json();render(msgs);}catch{}}async function enviar(){const inp=document.getElementById('txt');const t=inp.value.trim();if(!t||!cur)return;const cont=document.getElementById('msgs');const b=document.createElement('div');b.className='bubble age';b.textContent=t;cont.appendChild(b);cont.scrollTop=cont.scrollHeight;inp.value='';try{const r=await fetch('/api/mensaje/enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:eid,chat_id:cur,texto:t})});const j=await r.json();console.log(j);if(!j.ok) alert('Error envio: '+JSON.stringify(j));}catch(e){alert(e.message);}}document.getElementById('btn').onclick=enviar;document.getElementById('txt').addEventListener('keydown',e=>{if(e.key==='Enter')enviar();});document.getElementById('q').addEventListener('input',loadChats);setInterval(loadChats,3000);loadChats();<\/script></body></html>`;

app.get('/', (req,res)=>res.send(INDEX_HTML));
app.use(express.static(PUBLIC_PATH));

app.get('*', (req,res,next)=>{
  if(req.path.startsWith('/api/') || req.path.startsWith('/webhook')) return next();
  res.send(INDEX_HTML);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`KLIDO V180 CORRIENDO EN ${PORT}`));
