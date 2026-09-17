const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";
const USER = process.env.CRM_USER || "admin";
const PASS = process.env.CRM_PASS || "alion2025";

let chats = {};
let campaigns = [];

app.get('/login', (req,res)=>{
res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title><style>body{margin:0;background:#0B57D0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Arial}.card{background:#fff;padding:28px;border-radius:16px;width:92%;max-width:360px;text-align:center}input{width:100%;padding:12px;margin-top:10px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box}button{width:100%;padding:12px;margin-top:14px;background:#0B57D0;color:#fff;border:none;border-radius:8px;font-weight:bold}</style></head><body><div class="card"><h2 style="color:#0B57D0">KLIDO AVANZA</h2><input id="u" placeholder="Usuario"><input id="p" type="password" placeholder="Contraseña"><button onclick="go()">ENTRAR</button><p id="er" style="color:red;font-size:12px"></p></div><script>async function go(){let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:document.getElementById('u').value,pass:document.getElementById('p').value})});let j=await r.json();if(j.ok){localStorage.setItem('klido','1');location.href='/';}else{document.getElementById('er').innerText='Clave incorrecta';}}</script></body></html>`);
});

app.get('/campanas', (req,res)=>{
res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campanas</title><style>body{margin:0;font-family:Arial;background:#f0f2f5}.top{background:#0B57D0;color:#fff;padding:12px;display:flex;align-items:center}.box{max-width:700px;margin:15px auto;background:#fff;padding:18px;border-radius:12px}textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #ccc;box-sizing:border-box}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}</style></head><body><script>if(!localStorage.getItem('klido'))location.href='/login';</script><div class="top"><b>CAMPANAS ALION</b><button onclick="location.href='/'" style="margin-left:auto;background:#fff;color:#0B57D0;border:none;border-radius:12px;padding:6px 12px">Volver a bandeja</button></div><div class="box"><p style="background:#e8f0fe;padding:8px;border-radius:6px;font-size:12px">Plantilla oficial: <b>alion_co</b> | ID 1060826656745017 | Legal y activa</p><label>Contactos (Nombre, Numero)</label><textarea id="cts" rows="5" placeholder="Fer, 573001234567"></textarea><button id="btn" onclick="send()" style="width:100%;margin-top:10px;padding:12px;background:#0B57D0;color:#fff;border:none;border-radius:8px;font-weight:bold">ENVIAR CAMPANA OFICIAL</button><div id="res" style="text-align:center;margin-top:8px;color:#0B57D0;font-weight:bold"></div><h4>Seguimiento y alcance</h4><table id="tb"><tr><th>Fecha</th><th>Enviados</th><th>Alcance</th><th>Estado</th></tr></table></div><script>
async function send(){
 let raw=document.getElementById('cts').value.trim().split('\\n');
 let contacts=[]; for(let i=0;i<raw.length;i++){let tel=raw[i].split(',')[1]||raw[i]; tel=tel.replace(/[^0-9]/g,''); if(tel.length>9) contacts.push({tel:tel});}
 if(contacts.length==0){alert('Pon numeros');return;}
 document.getElementById('btn').innerText='Enviando...';
 let r=await fetch('/api/send-campaign-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contacts})});
 let d=await r.json();
 document.getElementById('res').innerText='Enviados: '+d.sent+' - Alcance: '+d.sent;
 document.getElementById('btn').innerText='ENVIAR CAMPANA OFICIAL';
 load();
}
async function load(){let r=await fetch('/api/campaigns'); let data=await r.json(); let h='<tr><th>Fecha</th><th>Enviados</th><th>Alcance</th><th>Estado</th></tr>'; for(let i=data.length-1;i>=0;i--){let c=data[i]; h+='<tr><td>'+c.fecha+'</td><td>'+c.sent+'</td><td>'+c.sent+'</td><td>'+c.estado+'</td></tr>';} document.getElementById('tb').innerHTML=h;}
load();
</script></body></html>`);
});

app.get('/', (req,res)=>{
res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klido Avanza</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f0f2f5;height:100vh;display:flex;flex-direction:column}.top{height:56px;background:#0B57D0;color:#fff;display:flex;align-items:center;padding:0 12px;gap:8px}.btnc{background:#fff;color:#0B57D0;border:none;border-radius:16px;padding:6px 14px;font-size:12px;font-weight:bold;cursor:pointer}.main{flex:1;display:flex;overflow:hidden}.lista{width:330px;background:#fff;border-right:1px solid #ddd;overflow:auto}.chat{padding:10px;border-bottom:1px solid #eee;cursor:pointer}.chat b{color:#0B57D0}.msgs{flex:1;display:flex;flex-direction:column;background:#e5ddd5}.mensajes{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:6px}.msg{padding:8px 12px;border-radius:14px;max-width:72%;font-size:13px}.cli{background:#fff;align-self:flex-start}.yo{background:#0B57D0;color:#fff;align-self:flex-end}.input{display:flex;padding:8px;background:#f0f2f5;gap:6px}</style></head><body><script>if(!localStorage.getItem('klido'))location.href='/login';</script><div class="top"><b>KLIDO AVANZA</b><button class="btnc" onclick="location.href='/campanas'">CAMPANAS</button><span id="cnt" style="font-size:12px"></span><button onclick="localStorage.clear();location.href='/login'" style="margin-left:auto;background:transparent;border:1px solid #fff;color:#fff;border-radius:12px;padding:4px 10px;font-size:11px">Salir</button></div><div class="main"><div class="lista" id="lista"></div><div class="msgs"><div class="mensajes" id="mensajes"><p style="color:#888">Selecciona un chat</p></div><div class="input"><input id="txt" placeholder="Escribe mensaje..." style="flex:1;padding:10px;border-radius:20px;border:1px solid #ddd"><button onclick="enviar()" style="background:#0B57D0;color:#fff;border:none;border-radius:50%;width:36px;height:36px">></button></div></div></div><script>
let chats=[],actual=null;
async function cargar(){let r=await fetch('/api/chats'); chats=await r.json(); document.getElementById('cnt').innerText=chats.length+' chats'; let h=''; if(chats.length==0){document.getElementById('lista').innerHTML='<p style=padding:10px;color:#888>No hay chats aun</p>';return;} for(let i=0;i<chats.length;i++){let c=chats[i]; h+='<div class=chat onclick="abrir(\\''+c.tel+'\\')"><b>'+c.nombre+'</b><br><small>'+c.tel+'</small></div>';} document.getElementById('lista').innerHTML=h;}
function abrir(tel){actual=tel; let c=null; for(let i=0;i<chats.length;i++){if(chats[i].tel==tel)c=chats[i];} let h=''; for(let j=0;j<c.msgs.length;j++){let m=c.msgs[j]; let cl=m.from=='yo'?'yo':'cli'; h+='<div class=\\"msg '+cl+'\\">'+m.text+'</div>';} document.getElementById('mensajes').innerHTML=h;}
async function enviar(){let t=document.getElementById('txt').value; if(!t||!actual)return; document.getElementById('txt').value=''; await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})}); cargar();}
document.getElementById('txt').addEventListener('keydown',function(e){if(e.key=='Enter')enviar();});
setInterval(cargar,3000); cargar();
</script></body></html>`);
});

app.post('/api/login',(req,res)=>{
 if(req.body.user===USER && req.body.pass===PASS) res.json({ok:true}); else res.json({ok:false});
});
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']===VERIFY_TOKEN) res.send(req.query['hub.challenge']); else res.sendStatus(403); });
app.post('/webhook',(req,res)=>{ try{let v=req.body.entry?.[0]?.changes?.[0]?.value; let m=v?.messages?.[0]; if(m){let tel=m.from; let txt=m.text?.body||'archivo'; let nm=v.contacts?.[0]?.profile?.name||tel; if(!chats[tel]) chats[tel]={tel:tel,nombre:nm,msgs:[]}; chats[tel].msgs.push({from:'cli',text:txt});}}catch(e){} res.sendStatus(200); });
app.get('/api/chats',(req,res)=>res.json(Object.values(chats)));
app.get('/api/campaigns',(req,res)=>res.json(campaigns));
app.post('/api/send', async (req,res)=>{ try{await axios.post('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{messaging_product:'whatsapp',to:req.body.to,type:'text',text:{body:req.body.text}},{headers:{Authorization:'Bearer '+TOKEN}}); if(!chats[req.body.to]) chats[req.body.to]={tel:req.body.to,nombre:req.body.to,msgs:[]}; chats[req.body.to].msgs.push({from:'yo',text:req.body.text}); res.json({ok:true});}catch(e){res.status(500).json(e.response?.data||{});} });
app.post('/api/send-campaign-template', async (req,res)=>{ let sent=0; let fecha=new Date().toLocaleString('es-CO'); for(let c of req.body.contacts){ try{await axios.post('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{messaging_product:'whatsapp',to:c.tel,type:'template',template:{name:'alion_co',language:{code:'es_CO'}}},{headers:{Authorization:'Bearer '+TOKEN}}); sent++; await new Promise(r=>setTimeout(r,700));}catch(e){}} campaigns.push({fecha:fecha,sent:sent,estado:'Enviada legal'}); res.json({sent}); });
app.listen(process.env.PORT||3000,()=>console.log('KLIDO AZUL OK'));
