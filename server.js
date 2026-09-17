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
let campaigns = [];
let blocked = new Set();

app.get('/', (req,res)=>{
res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klido Avanza</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f0f2f5;height:100vh;display:flex;flex-direction:column}
.top{height:60px;background:#0B57D0;color:#fff;display:flex;align-items:center;padding:0 20px}
.main{flex:1;display:flex;overflow:hidden}
.lista{width:350px;background:#fff;border-right:1px solid #ddd;overflow:auto}
.chat{padding:14px;border-bottom:1px solid #eee;cursor:pointer}.chat:hover{background:#f0f2f5}.chat b{color:#0B57D0}
.msgs{flex:1;display:flex;flex-direction:column;background:#e5ddd5}
.mensajes{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:10px}
.msg{padding:10px 14px;border-radius:18px;max-width:70%;font-size:14px}
.cliente{background:#fff;align-self:flex-start}.yo{background:#0B57D0;color:#fff;align-self:flex-end}
.input{display:flex;padding:12px;background:#f0f2f5;gap:8px}
#txt{flex:1;padding:12px;border-radius:25px;border:1px solid #ddd;outline:none}
.btn-camp{position:fixed;bottom:20px;left:20px;background:#0B57D0;color:#fff;border:none;padding:15px 24px;border-radius:30px;font-weight:bold;cursor:pointer;z-index:10}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20;align-items:center;justify-content:center}
.modal.active{display:flex}
.modal-box{background:#fff;width:95%;max-width:650px;border-radius:16px;overflow:hidden;max-height:90vh;display:flex;flex-direction:column}
.modal-head{padding:16px;background:#0B57D0;color:#fff;display:flex;justify-content:space-between}
.modal-body{padding:20px;overflow:auto}
</style></head><body>
<div class="top"><b>KLIDO AVANZA</b><span style="margin-left:auto" id="count">0 chats</span></div>
<div class="main">
<div class="lista" id="lista"><p style="padding:20px">Cargando...</p></div>
<div class="msgs"><div class="mensajes" id="mensajes"><p>Selecciona un chat</p></div>
<div class="input"><input id="txt" placeholder="Escribe mensaje..."><button onclick="enviar()" style="background:#0B57D0;color:#fff;border:none;border-radius:50%;width:45px;height:45px">></button></div>
</div></div>
<button class="btn-camp" onclick="document.getElementById('modalCamp').classList.add('active');loadCamp()">📢 CAMPAÑAS</button>
<div class="modal" id="modalCamp"><div class="modal-box">
<div class="modal-head"><b>ALION - Plantilla Oficial</b><button onclick="document.getElementById('modalCamp').classList.remove('active')" style="background:#fff;border:none;border-radius:50%;width:30px;height:30px">X</button></div>
<div class="modal-body">
<p style="background:#e8f0fe;padding:10px;border-radius:8px;font-size:12px">Plantilla: <b>alion_co</b> | ID: 1060826656745017 | Activa | Legal</p>
<label>Contactos (Nombre, Numero)</label><textarea id="contacts" rows="4" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd"></textarea>
<table id="tablaCamp" style="width:100%;margin-top:10px;border-collapse:collapse"><tr><th>Fecha</th><th>Enviados</th><th>Estado</th></tr></table>
<button id="btnCamp" onclick="sendCamp()" style="width:100%;margin-top:15px;padding:14px;background:#0B57D0;color:#fff;border:none;border-radius:10px;font-weight:bold">🚀 ENVIAR PLANTILLA OFICIAL</button>
<div id="resCamp" style="text-align:center;margin-top:10px;color:#0B57D0;font-weight:bold"></div>
<button onclick="document.getElementById('modalCamp').classList.remove('active')" style="width:100%;margin-top:10px;padding:10px;background:#eee;border:none;border-radius:8px">← Volver a bandeja</button>
</div></div></div>
<script>
let chats=[],actual=null;
async function cargar(){
 let r=await fetch('/api/chats'); chats=await r.json();
 document.getElementById('count').innerText=chats.length+' chats';
 let h=''; if(chats.length==0){document.getElementById('lista').innerHTML='<p style=padding:20px>No hay chats</p>';return}
 for(let i=0;i<chats.length;i++){let c=chats[i]; h+='<div class=chat onclick="abrir(\\''+c.tel+'\\')"><b>'+c.nombre+'</b><br><small>'+c.tel+'</small></div>'}
 document.getElementById('lista').innerHTML=h;
}
function abrir(tel){
 actual=tel; let c=null; for(let i=0;i<chats.length;i++){if(chats[i].tel==tel){c=chats[i];break}}
 let h=''; for(let i=0;i<c.msgs.length;i++){let m=c.msgs[i]; let cls=m.from=='yo'?'yo':'cliente'; h+='<div class=\\"msg '+cls+'\\">'+m.text+'</div>'}
 document.getElementById('mensajes').innerHTML=h;
}
async function enviar(){
 let t=document.getElementById('txt').value; if(!t||!actual)return;
 document.getElementById('txt').value='';
 await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})});
 cargar(); setTimeout(function(){abrir(actual)},500);
}
async function sendCamp(){
 let raw=document.getElementById('contacts').value.trim().split('\\n');
 let contacts=[]; for(let i=0;i<raw.length;i++){let p=raw[i].split(','); let tel=(p[1]||p[0]||'').replace(/[^0-9]/g,''); if(tel.length>9){contacts.push({nombre:(p[0]||'').trim(),tel:tel})}}
 if(contacts.length==0){alert('Pon numeros');return}
 document.getElementById('btnCamp').innerText='Enviando...';
 let r=await fetch('/api/send-campaign-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contacts:contacts})});
 let d=await r.json();
 document.getElementById('resCamp').innerText='Enviados: '+d.sent+' Fallidos: '+d.failed;
 document.getElementById('btnCamp').innerText='🚀 ENVIAR PLANTILLA OFICIAL';
 loadCamp();
}
async function loadCamp(){
 let r=await fetch('/api/campaigns'); let data=await r.json();
 let h='<tr><th>Fecha</th><th>Enviados</th><th>Estado</th></tr>';
 for(let i=data.length-1;i>=0;i--){let c=data[i]; h+='<tr><td>'+c.fecha+'</td><td>'+c.sent+'</td><td>'+c.estado+'</td></tr>'}
 document.getElementById('tablaCamp').innerHTML=h;
}
document.getElementById('txt').addEventListener('keydown',function(e){if(e.key=='Enter')enviar()});
setInterval(cargar,3000); cargar();
</script></body></html>
`);
});

app.get('/webhook', (req,res)=>{
 if(req.query['hub.verify_token']===VERIFY_TOKEN) res.send(req.query['hub.challenge']);
 else res.sendStatus(403);
});
app.post('/webhook', (req,res)=>{
 try{
  const val=req.body.entry?.[0]?.changes?.[0]?.value;
  const msg=val?.messages?.[0];
  if(msg){
   const tel=msg.from; const text=msg.text?.body||'Archivo';
   const name=val.contacts?.[0]?.profile?.name||tel;
   if(/stop|no quiero|baja|salir/i.test(text)) blocked.add(tel);
   if(!chats[tel]) chats[tel]={tel:tel,nombre:name,msgs:[]};
   chats[tel].msgs.push({from:'cliente',text:text,time:new Date().toLocaleTimeString()});
  }
 }catch(e){}
 res.sendStatus(200);
});

app.get('/api/chats',(req,res)=>res.json(Object.values(chats)));
app.get('/api/campaigns',(req,res)=>res.json(campaigns));
app.get('/api/clear',(req,res)=>{chats={};res.json({ok:true})});

app.post('/api/send', async (req,res)=>{
 const {to,text}=req.body;
 if(blocked.has(to)) return res.status(400).json({error:'opt-out'});
 try{
  await axios.post('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{messaging_product:'whatsapp',to:to,type:'text',text:{body:text}},{headers:{Authorization:'Bearer '+TOKEN}});
  if(!chats[to]) chats[to]={tel:to,nombre:to,msgs:[]};
  chats[to].msgs.push({from:'yo',text:text,time:new Date().toLocaleTimeString()});
  res.json({ok:true});
 }catch(err){res.status(500).json(err.response?.data||{})}
});

app.post('/api/send-campaign-template', async (req,res)=>{
 const {contacts}=req.body;
 let sent=0,failed=0;
 const fecha=new Date().toLocaleString('es-CO');
 for(let c of contacts){
  if(blocked.has(c.tel)){failed++;continue;}
  try{
   await axios.post('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{
    messaging_product:'whatsapp',to:c.tel,type:'template',
    template:{name:'alion_co',language:{code:'es_CO'}}
   },{headers:{Authorization:'Bearer '+TOKEN}});
   sent++; await new Promise(r=>setTimeout(r,800));
  }catch(e){failed++;}
 }
 campaigns.push({fecha:fecha,sent:sent,failed:failed,estado:'Enviada legal'});
 if(campaigns.length>20) campaigns.shift();
 res.json({ok:true,sent:sent,failed:failed});
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('KLIDO AVANZA OK'));
