// KLIDO V179 FIX DEFINITIVO - WEBHOOK LOG
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({limit:'100mb'}));
app.use(express.urlencoded({extended:true}));

const DB_PATH = '/app/db';
if(!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH,{recursive:true});
['public'].forEach(d=>{if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true})});

function getDB(id){ const f=path.join(DB_PATH,`${(id||'default').replace(/[^a-z0-9_\-@.]/gi,'')}.json`); if(!fs.existsSync(f)) return {empresa_id:id, config:{}, chats:{}}; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return {empresa_id:id, config:{}, chats:{}};}}
function saveDB(id,d){ fs.writeFileSync(path.join(DB_PATH,`${(id||'default').replace(/[^a-z0-9_\-@.]/gi,'')}.json`), JSON.stringify(d,null,2)); }
function loadConfig(id){ let db=getDB(id); if(process.env.WHATSAPP_TOKEN) db.config.token=process.env.WHATSAPP_TOKEN.trim(); if(process.env.PHONE_NUMBER_ID) db.config.phone=process.env.PHONE_NUMBER_ID.trim(); if(process.env.WABA_ID) db.config.waba=process.env.WABA_ID.trim(); saveDB(id,db); return db.config; }

const VERIFY = process.env.META_VERIFY_TOKEN || 'klido123';
console.log('VERIFY TOKEN EN USO:', VERIFY);

app.get('/webhook', (req,res)=>{
  console.log('GET /webhook VERIFY:', req.query);
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY){ console.log('WEBHOOK VERIFICADO OK'); return res.status(200).send(req.query['hub.challenge']); }
  console.log('WEBHOOK FAIL TOKEN');
  res.sendStatus(403);
});
app.get('/webhook/:empresa_id', (req,res)=>{
  console.log('GET /webhook/:id VERIFY:', req.params.empresa_id, req.query);
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY){ return res.status(200).send(req.query['hub.challenge']); }
  res.sendStatus(403);
});

function handle(body){
  console.log('WEBHOOK POST RECIBIDO:', JSON.stringify(body).substring(0,2000));
  const val=body.entry?.[0]?.changes?.[0]?.value;
  if(!val){ console.log('SIN VALUE'); return; }
  const phoneId=val.metadata?.phone_number_id;
  const eid='fermorales20020gmailcom_1234';
  const db=getDB(eid);
  if(val.messages){
    val.messages.forEach(m=>{
      const id=m.from;
      if(!db.chats[id]) db.chats[id]={id,mensajes:[],no_leidos:0,last:Date.now()};
      const txt=m.text?.body||'📎 Mensaje';
      db.chats[id].mensajes.push({from:'cliente',texto:txt,ts:Date.now()});
      db.chats[id].no_leidos=(db.chats[id].no_leidos||0)+1;
      db.chats[id].last=Date.now();
      console.log(`ENTRANTE [${eid}] ${id}: ${txt}`);
    });
    saveDB(eid,db);
  }
}
app.post('/webhook', (req,res)=>{ handle(req.body); res.sendStatus(200); });
app.post('/webhook/:empresa_id', (req,res)=>{ handle(req.body); res.sendStatus(200); });

app.post('/api/mensaje/enviar', async (req,res)=>{
  const {chat_id,texto}=req.body;
  const empresa_id='fermorales20020gmailcom_1234';
  const emp=loadConfig(empresa_id);
  console.log('ENVIAR A',chat_id);
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{
      method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`},
      body:JSON.stringify({messaging_product:'whatsapp', to:String(chat_id).replace(/\D/g,''), type:'text', text:{body:texto}})
    });
    const j=await r.json();
    console.log('RESP META',j);
    if(j.messages){
      const db=getDB(empresa_id); if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id,mensajes:[],no_leidos:0,last:Date.now()};
      db.chats[chat_id].mensajes.push({from:'agente',texto,ts:Date.now()}); db.chats[chat_id].last=Date.now(); saveDB(empresa_id,db);
      return res.json({ok:true});
    }
    res.json({ok:false,error:j});
  }catch(e){ res.json({ok:false,error:e.message}); }
});
app.get('/api/chats/:empresa_id',(req,res)=>{ const db=getDB(req.params.empresa_id); res.json(Object.values(db.chats||{}).sort((a,b)=>(b.last||0)-(a.last||0))); });
app.get('/api/mensajes/:empresa_id/:chat_id',(req,res)=>{ const db=getDB(req.params.empresa_id); res.json((db.chats[req.params.chat_id]?.mensajes||[]).sort((a,b)=>(a.ts||0)-(b.ts||0))); });
app.post('/api/chat/leido',(req,res)=>{ const db=getDB(req.body.empresa_id); if(db.chats[req.body.chat_id]){db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db);} res.json({ok:true}); });
app.get('/api/debug/config/:empresa_id',(req,res)=>res.json({V:'V179', verify:VERIFY, config:loadConfig(req.params.empresa_id)}));

const INDEX=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klido</title><style>body{margin:0;font-family:Arial;display:flex;height:100vh;overflow:hidden}#l{width:360px;border-right:1px solid #ddd;overflow:auto;background:#fff}#r{flex:1;display:flex;flex-direction:column;background:#e5ddd5}#h{height:56px;padding:0 16px;background:#f0f2f5;border-bottom:1px solid #ddd;display:flex;align-items:center;font-weight:700}#m{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:8px}.i{padding:12px;border-bottom:1px solid #f0f0f0;cursor:pointer;display:flex;gap:10px}.i:hover{background:#f5f5f5}.b{padding:8px 12px;border-radius:8px;max-width:68%;font-size:14px;word-break:break-word}.c{background:#fff;align-self:flex-start}.a{background:#dcf8c6;align-self:flex-end}#in{height:62px;background:#f0f0f0;display:flex;align-items:center;gap:8px;padding:0 10px}#t{flex:1;padding:11px 16px;border-radius:22px;border:0;outline:none}#s{border:0;background:#000;color:#fff;border-radius:22px;padding:10px 18px;font-weight:700;cursor:pointer}</style></head><body><div id="l"></div><div id="r"><div id="h">Selecciona un chat</div><div id="m"></div><div id="in"><input id="t" placeholder="Escribe..."><button id="s">Enviar</button></div></div><script>var eid='fermorales20020gmailcom_1234';var cur=null;function loadChats(){fetch('/api/chats/'+eid).then(r=>r.json()).then(chs=>{var l=document.getElementById('l');l.innerHTML='';chs.forEach(c=>{var d=document.createElement('div');d.className='i';var last=(c.mensajes&&c.mensajes.slice(-1)[0]&&c.mensajes.slice(-1)[0].texto)||'';d.innerHTML='<div style=\\'width:36px;height:36px;border-radius:50%;background:#000;color:#fff;display:flex;align-items:center;justify-content:center\\'>57</div><div><b>'+c.id+'</b><div style=\\'font-size:12px;color:#666\\'>'+last.substring(0,30)+'</div></div>';d.onclick=function(){openChat(c.id)};l.appendChild(d);});});}function openChat(id){cur=id;document.getElementById('h').innerText=id;fetch('/api/chat/leido',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:eid,chat_id:id})});fetch('/api/mensajes/'+eid+'/'+id).then(r=>r.json()).then(msgs=>{var m=document.getElementById('m');m.innerHTML='';msgs.forEach(x=>{var b=document.createElement('div');b.className='b '+(x.from==='agente'?'a':'c');b.innerText=x.texto;m.appendChild(b);});m.scrollTop=m.scrollHeight;});}function send(){var inp=document.getElementById('t');var txt=inp.value.trim();if(!txt||!cur)return;var m=document.getElementById('m');var b=document.createElement('div');b.className='b a';b.innerText=txt;m.appendChild(b);m.scrollTop=m.scrollHeight;inp.value='';fetch('/api/mensaje/enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:eid,chat_id:cur,texto:txt})}).then(r=>r.json()).then(j=>{console.log(j); if(!j.ok) alert('Error: '+JSON.stringify(j.error));});}document.getElementById('s').onclick=send;document.getElementById('t').addEventListener('keydown',function(e){if(e.key==='Enter')send();});setInterval(loadChats,3000);loadChats();<\/script></body></html>`;
app.get('/',(req,res)=>res.send(INDEX));
app.use(express.static(path.join(__dirname,'public')));
app.listen(process.env.PORT||3000,()=>console.log('V179 WEBHOOK FIX OK'));
