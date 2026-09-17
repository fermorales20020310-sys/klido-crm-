const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(bodyParser.json());

const TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_ID = process.env.PHONE_NUMBER_ID || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";
const USER_LOGIN = process.env.CRM_USER || "admin";
const PASS_LOGIN = process.env.CRM_PASS || "alion2025";

let chats = {};
let campaigns = [];

app.get('/login', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title><style>body{margin:0;background:#0B57D0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Arial}.box{background:#fff;padding:30px;border-radius:16px;width:90%;max-width:380px;text-align:center}input{width:100%;padding:12px;margin-top:10px;border:1px solid #ddd;border-radius:8px}button{width:100%;padding:12px;margin-top:15px;background:#0B57D0;color:#fff;border:none;border-radius:8px;font-weight:bold}</style></head><body><div class="box"><h2 style="color:#0B57D0">KLIDO AVANZA</h2><input id="u" placeholder="Usuario"><input id="p" type="password" placeholder="Contraseña"><button onclick="login()">ENTRAR</button><p id="e" style="color:red"></p></div><script>async function login(){let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:document.getElementById('u').value,pass:document.getElementById('p').value})});let d=await r.json(); if(d.ok){localStorage.setItem('klido','1'); location.href='/';} else {document.getElementById('e').innerText='Datos incorrectos';}}</script></body></html>`);
});

// PAGINA CAMPAÑAS - AHORA SEPARADA PARA QUE SI FUNCIONE EL BOTON
app.get('/campanas', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campañas Alion</title><style>body{margin:0;font-family:Arial;background:#f0f2f5}.top{height:55px;background:#0B57D0;color:#fff;display:flex;align-items:center;padding:0 12px}.box{max-width:700px;margin:20px auto;background:#fff;padding:20px;border-radius:12px} textarea{width:100%;border:1px solid #ddd;border-radius:8px;padding:10px} button{padding:12px;border:none;border-radius:8px;font-weight:bold;cursor:pointer} table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px} th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}</style></head><body>
  <script>if(!localStorage.getItem('klido')){location.href='/login';}</script>
  <div class="top"><b>CAMPAÑAS ALIÓN</b><button onclick="location.href='/'" style="margin-left:auto;background:#fff;color:#0B57D0;border:none;border-radius:15px;padding:6px 12px;font-size:12px">← Volver a bandeja</button></div>
  <div class="box">
  <p style="background:#e8f0fe;padding:10px;border-radius:8px;font-size:12px">✅ Plantilla oficial: <b>alion_co</b> | ID 1060826656745017 | Activa y legal por Meta</p>
  <label><b>Contactos (Nombre, Numero - uno por linea)</b></label><textarea id="contacts" rows="6" placeholder="Fer, 573001234567&#10;Juan, 573009998888"></textarea>
  <button id="btn" onclick="sendCamp()" style="width:100%;margin-top:12px;background:#0B57D0;color:#fff">🚀 ENVIAR CAMPAÑA OFICIAL</button>
  <div id="res" style="text-align:center;margin-top:10px;color:#0B57D0;font-weight:bold"></div>
  <h4 style="margin-top:20px">Seguimiento y Alcance</h4><table id="tabla"><tr><th>Fecha</th><th>Enviados</th><th>Alcance</th><th>Estado</th></tr></table>
  </div>
  <script>
  async function sendCamp(){
    let raw=document.getElementById('contacts').value.trim().split('\\n');
    let contacts=[]; for(let i=0;i<raw.length;i++){let p=raw[i].split(','); let tel=(p[1]||p[0]||'').replace(/[^0-9]/g,''); if(tel.length>9) contacts.push({tel:tel});}
    if(contacts.length==0){alert('Pon numeros con formato Nombre, 57...');return;}
    document.getElementById('btn').innerText='Enviando plantilla oficial...'; document.getElementById('btn').disabled=true;
    let r=await fetch('/api/send-campaign-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contacts:contacts})});
    let d=await r.json(); document.getElementById('res').innerText='✅ Enviados: '+d.sent+' | Alcance: '+d.sent+' personas';
    document.getElementById('btn').innerText='🚀 ENVIAR CAMPAÑA OFICIAL'; document.getElementById('btn').disabled=false; loadCamp();
  }
  async function loadCamp(){
    let r=await fetch('/api/campaigns'); let data=await r.json();
    let h='<tr><th>Fecha</th><th>Enviados</th><th>Alcance</th><th>Estado</th></tr>';
    for(let i=data.length-1;i>=0;i--){let c=data[i]; h+='<tr><td>'+c.fecha+'</td><td>'+c.sent+'</td><td>'+c.sent+'</td><td>'+c.estado+'</td></tr>';}
    document.getElementById('tabla').innerHTML=h;
  }
  loadCamp();
  </script></body></html>`);
});

app.get('/', (req,res)=>{
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klido Avanza</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f0f2f5;height:100vh;display:flex;flex-direction:column}.top{height:55px;background:#0B57D0;color:#fff;display:flex;align-items:center;padding:0 12px;gap:8px}.btnc{padding:6px 14px;background:#fff;color:#0B57D0;border:none;border-radius:15px;font-size:12px;font-weight:bold;cursor:pointer}.main{flex:1;display:flex;overflow:hidden}.lista{width:330px;background:#fff;border-right:1px solid #ddd;overflow:auto}.chat{padding:10px;border-bottom:1px solid #eee;cursor:pointer;font-size:13px}.chat b{color:#0B57D0}.msgs{flex:1;display:flex;flex-direction:column;background:#e5ddd5}.mensajes{flex:1;overflow:auto;padding:15px;display:flex;flex-direction:column;gap:8px}.msg{padding:8px 12px;border-radius:14px;max-width:70%;font-size:13px}.cliente{background:#fff;align-self:flex-start}.yo{background:#0B57D0;color:#fff;align-self:flex-end}.input{display:flex;padding:10px;background:#f0f2f5;gap:6px}</style></head><body>
  <script>if(!localStorage.getItem('klido')){location.href='/login';}</script>
  <div class="top"><b>KLIDO AVANZA</b><button class="btnc" onclick="location.href='/campanas'">📢 CAMPAÑAS</button><span id="count" style="font-size:12px"></span><button onclick="localStorage.clear();location.href='/login'" style="margin-left:auto;background:transparent;border:1px solid #fff;color:#fff;border-radius:12px;padding:4px 8px;font-size:11px">Salir</button></div>
  <div class="main"><div class="lista" id="lista"></div><div class="msgs"><div class="mensajes" id="mensajes"></div><div class="input"><input id="txt" placeholder="Escribe mensaje..." style="flex:1;padding:10px;border-radius:20px;border:1px solid #ddd"><button onclick="enviar()" style="background:#0B57D0;color:#fff;border:none;border-radius:50%;width:38px;height:38px">></button></div></div></div>
  <script>
  let chats=[],actual=null;
  async function cargar(){
    let r=await fetch('/api/chats'); chats=await r.json();
    document.getElementById('count').innerText=chats.length+' chats';
    let h=''; if(chats.length==0){document.getElementById('lista').innerHTML='<p style=padding:10px;color:#888'>No hay chats</p>';return;}
    for(let i=0;i<chats.length;i++){let c=chats[i]; h+='<div class=chat onclick="abrir(\\''+c.tel+'\\')"><b>'+c.nombre+'</b><br>'+c.tel+'</div>';}
    document.getElementById('lista').innerHTML=h;
  }
  function abrir(tel){
    actual=tel; let c=null; for(let i=0;i<chats.length;i++){if(chats[i].tel==tel){c=chats[i];}}
    let h=''; for(let j=0;j<c.msgs.length;j++){let m=c.msgs[j]; let cl=m.from=='yo'?'yo':'cliente'; h+='<div class=\\"msg '+cl+'\\">'+m.text+'</div>';}
    document.getElementById('mensajes').innerHTML=h;
  }
  async function enviar(){
    let t=document.getElementById('txt').value; if(!t||!actual)return;
    document.getElementById('txt').value='';
    await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})});
    cargar();
  }
  document.getElementById('txt').addEventListener('keydown',function(e){if(e.key=='Enter')enviar();});
  setInterval(cargar,3000); cargar();
  </script></body></html>`);
});

app.post('/api/login',(req,res)=>{const {user,pass}=req.body; if(user===USER_LOGIN && pass===PASS_LOGIN) res.json({ok:true}); else res.json({ok:false});});
app.get('/webhook',(req,res)=>{if(req.query['hub.verify_token']===VERIFY_TOKEN) res.send(req.query['hub.challenge']); else res.sendStatus(403);});
app.post('/webhook',(req,res)=>{try{const v=req.body.entry?.[0]?.changes?.[0]?.value; const m=v?.messages?.[0]; if(m){const tel=m.from; const text=m.text?.body||'Archivo'; const name=v.contacts?.[0]?.profile?.name||tel; if(!chats[tel]) chats[tel]={tel:tel,nombre:name,msgs:[]}; chats[tel].msgs.push({from:'cliente',text:text});}}catch(e){} res.sendStatus(200);});
app.get('/api/chats',(req,res)=>res.json(Object.values(chats)));
app.get('/api/campaigns',(req,res)=>res.json(campaigns));
app.post('/api/send', async (req,res)=>{const {to,text}=req.body; try{await axios.post('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{messaging_product:'whatsapp',to:to,type:'text',text:{body:text}},{headers:{Authorization:'Bearer '+TOKEN}}); if(!chats[to]) chats[to]={tel:to,nombre:to,msgs:[]}; chats[to].msgs.push({from:'yo',text:text}); res.json({ok:true});}catch(e){res.status(500).json(e.response?.data||{});}});
app.post('/api/send-campaign-template', async (req,res)=>{const {contacts}=req.body; let sent=0; const fecha=new Date().toLocaleString('es-CO'); for(let c of contacts){try{await axios.post('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{messaging_product:'whatsapp',to:c.tel,type:'template',template:{name:'alion_co',language:{code:'es_CO'}}},{headers:{Authorization:'Bearer '+TOKEN}}); sent++; await new Promise(r=>setTimeout(r,800));}catch(e){}} campaigns.push({fecha:fecha,sent:sent,estado:'Enviada legal'}); res.json({ok:true,sent:sent});});
app.listen(process.env.PORT||3000,()=>console.log('OK'));
