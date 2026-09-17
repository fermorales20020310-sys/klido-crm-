const express = require('express');
const app = express();
app.use(express.json({limit: '10mb'}));

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";
const USER = "admin";
const PASS = "alion2025";

let chats = {};
let campaigns = [];

app.get('/login', (req,res)=>{
res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0B57D0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:Arial}.card{background:#fff;padding:26px;border-radius:16px;width:92%;max-width:350px;text-align:center}input{width:100%;padding:11px;margin-top:10px;border:1px solid #ccc;border-radius:8px}button{width:100%;padding:11px;margin-top:12px;background:#0B57D0;color:#fff;border:none;border-radius:8px;font-weight:bold}</style></head><body><div class="card"><h2 style="color:#0B57D0">KLIDO AVANZA</h2><input id="u" placeholder="Usuario"><input id="p" type="password" placeholder="Contrasena"><button onclick="login()">ENTRAR</button><p id="er" style="color:red"></p></div><script>async function login(){let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:document.getElementById('u').value,pass:document.getElementById('p').value})});let j=await r.json();if(j.ok){localStorage.setItem('klido','1');location.href='/';}else{document.getElementById('er').innerText='Usuario o clave mal';}}</script></body></html>`);
});

app.get('/campanas', (req,res)=>{
res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<style>body{margin:0;font-family:Arial;background:#f0f2f5}.top{background:#0B57D0;color:#fff;padding:12px;display:flex;align-items:center}.box{max-width:700px;margin:15px auto;background:#fff;padding:18px;border-radius:12px}textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #ccc;box-sizing:border-box}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}th,td{padding:8px;border-bottom:1px solid #eee}.upload{border:2px dashed #0B57D0;padding:15px;border-radius:10px;text-align:center;background:#f8fbff;margin-bottom:12px}</style></head><body>
<script>if(!localStorage.getItem('klido')) location.href='/login';</script>
<div class="top"><b>CAMPANAS ALION</b><button onclick="location.href='/'" style="margin-left:auto;background:#fff;color:#0B57D0;border:none;border-radius:12px;padding:6px 12px">Volver a bandeja</button></div>
<div class="box">
<p style="background:#e8f0fe;padding:8px;border-radius:6px;font-size:12px">Plantilla oficial: <b>alion_co</b> | 1060826656745017 | Legal y activa</p>

<div class="upload">
<b>📤 Subir Excel de contactos</b><br>
<small>Columnas: Nombre | Numero (con 57)</small><br><br>
<input type="file" id="fileExcel" accept=".xlsx,.xls,.csv" style="margin:auto">
<div id="infoExcel" style="margin-top:8px;color:#0B57D0;font-weight:bold"></div>
</div>

<label>Contactos detectados (puedes editar)</label>
<textarea id="cts" rows="6" placeholder="Fer, 573001234567"></textarea>
<button id="btn" onclick="send()" style="width:100%;margin-top:10px;padding:12px;background:#0B57D0;color:#fff;border:none;border-radius:8px;font-weight:bold">🚀 ENVIAR CAMPANA OFICIAL</button>
<div id="res" style="text-align:center;margin-top:8px;color:#0B57D0;font-weight:bold"></div>
<h4>Seguimiento y alcance</h4>
<table id="tb"><tr><th>Fecha</th><th>Enviados</th><th>Alcance</th><th>Estado</th></tr></table>
</div>
<script>
document.getElementById('fileExcel').addEventListener('change', function(e){
 let file=e.target.files[0];
 if(!file) return;
 let reader=new FileReader();
 reader.onload=function(evt){
  let data=evt.target.result;
  let wb=XLSX.read(data,{type:'binary'});
  let sheet=wb.Sheets[wb.SheetNames[0]];
  let rows=XLSX.utils.sheet_to_json(sheet,{header:1});
  let contacts=[];
  for(let i=0;i<rows.length;i++){
   let r=rows[i];
   if(!r || r.length==0) continue;
   // si la primera fila es encabezado, saltarla
   if(i==0 && (String(r[0]).toLowerCase().includes('nombre') || String(r[1]).toLowerCase().includes('numero'))) continue;
   let nombre=r[0]||'';
   let tel=String(r[1]||r[0]||'').replace(/[^0-9]/g,'');
   if(tel.length>=10) contacts.push(nombre+', '+tel);
  }
  document.getElementById('cts').value=contacts.join('\\n');
  document.getElementById('infoExcel').innerText='✅ '+contacts.length+' contactos cargados del Excel';
 };
 if(file.name.endsWith('.csv')){ reader.readAsText(file); } else { reader.readAsBinaryString(file); }
});

async function send(){
 let raw=document.getElementById('cts').value.trim().split('\\n');
 let contacts=[];
 for(let i=0;i<raw.length;i++){
  let tel=raw[i].split(',')[1]||raw[i];
  tel=tel.replace(/[^0-9]/g,'');
  if(tel.length>9) contacts.push({tel:tel});
 }
 if(contacts.length==0){alert('Sube el Excel o pon numeros');return;}
 document.getElementById('btn').innerText='Enviando '+contacts.length+'...';
 let r=await fetch('/api/send-campaign-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contacts})});
 let d=await r.json();
 document.getElementById('res').innerText='✅ Enviados: '+d.sent+' | Alcance: '+d.sent;
 document.getElementById('btn').innerText='🚀 ENVIAR CAMPANA OFICIAL';
 load();
}
async function load(){
 let r=await fetch('/api/campaigns');
 let data=await r.json();
 let h='<tr><th>Fecha</th><th>Enviados</th><th>Alcance</th><th>Estado</th></tr>';
 for(let i=data.length-1;i>=0;i--){let c=data[i]; h+='<tr><td>'+c.fecha+'</td><td>'+c.sent+'</td><td>'+c.sent+'</td><td>'+c.estado+'</td></tr>';}
 document.getElementById('tb').innerHTML=h;
}
load();
</script></body></html>
`);
});

app.get('/', (req,res)=>{
res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f0f2f5;height:100vh;display:flex;flex-direction:column}.top{height:56px;background:#0B57D0;color:#fff;display:flex;align-items:center;padding:0 12px;gap:8px}.btnc{background:#fff;color:#0B57D0;border:none;border-radius:16px;padding:6px 14px;font-size:12px;font-weight:bold}.main{flex:1;display:flex;overflow:hidden}.lista{width:330px;background:#fff;border-right:1px solid #ddd;overflow:auto}.chat{padding:10px;border-bottom:1px solid #eee;cursor:pointer;font-size:13px}.chat b{color:#0B57D0}.msgs{flex:1;display:flex;flex-direction:column;background:#e5ddd5}.mensajes{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:6px}.msg{padding:8px 12px;border-radius:14px;max-width:72%;font-size:13px}.cli{background:#fff;align-self:flex-start}.yo{background:#0B57D0;color:#fff;align-self:flex-end}.input{display:flex;padding:8px;background:#f0f2f5;gap:6px}</style></head><body>
<script>if(!localStorage.getItem('klido')) location.href='/login';</script>
<div class="top"><b>KLIDO AVANZA</b><button class="btnc" onclick="location.href='/campanas'">CAMPANAS</button><span id="cnt" style="font-size:12px"></span><button onclick="localStorage.clear();location.href='/login'" style="margin-left:auto;background:transparent;border:1px solid #fff;color:#fff;border-radius:12px;padding:4px 10px;font-size:11px">Salir</button></div>
<div class="main"><div class="lista" id="lista"></div><div class="msgs"><div class="mensajes" id="mensajes"><p>Selecciona un chat</p></div><div class="input"><input id="txt" placeholder="Escribe..." style="flex:1;padding:10px;border-radius:20px;border:1px solid #ddd"><button onclick="enviar()" style="background:#0B57D0;color:#fff;border:none;border-radius:50%;width:36px;height:36px">></button></div></div></div>
<script>
let chats=[],actual=null;
async function cargar(){
 let r=await fetch('/api/chats'); chats=await r.json();
 document.getElementById('cnt').innerText=chats.length+' chats';
 let h=''; if(chats.length==0){document.getElementById('lista').innerHTML='<p style=padding:10px>No hay chats</p>';return;}
 for(let i=0;i<chats.length;i++){let c=chats[i]; h+='<div class=chat onclick="abrir(\\''+c.tel+'\\')"><b>'+c.nombre+'</b><br>'+c.tel+'</div>';}
 document.getElementById('lista').innerHTML=h;
}
function abrir(tel){
 actual=tel; let c=null; for(let i=0;i<chats.length;i++){if(chats[i].tel==tel) c=chats[i];}
 let h=''; for(let j=0;j<c.msgs.length;j++){let m=c.msgs[j]; let cl=m.from=='yo'?'yo':'cli'; h+='<div class="msg '+cl+'">'+m.text+'</div>';}
 document.getElementById('mensajes').innerHTML=h;
}
async function enviar(){
 let t=document.getElementById('txt').value; if(!t||!actual) return;
 document.getElementById('txt').value='';
 await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})});
 cargar();
}
document.getElementById('txt').addEventListener('keydown',function(e){if(e.key=='Enter')enviar();});
setInterval(cargar,3000); cargar();
</script></body></html>
`);
});

app.post('/api/login',(req,res)=>{ if(req.body.user===USER && req.body.pass===PASS) res.json({ok:true}); else res.json({ok:false}); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']===VERIFY_TOKEN) res.send(req.query['hub.challenge']); else res.sendStatus(403); });
app.post('/webhook',(req,res)=>{ try{let v=req.body.entry?.[0]?.changes?.[0]?.value; let m=v?.messages?.[0]; if(m){let tel=m.from; let txt=m.text?.body||'archivo'; let nm=v.contacts?.[0]?.profile?.name||tel; if(!chats[tel]) chats[tel]={tel:tel,nombre:nm,msgs:[]}; chats[tel].msgs.push({from:'cli',text:txt});}}catch(e){} res.sendStatus(200); });
app.get('/api/chats',(req,res)=>res.json(Object.values(chats)));
app.get('/api/campaigns',(req,res)=>res.json(campaigns));
app.post('/api/send', async (req,res)=>{ try{await fetch('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},body:JSON.stringify({messaging_product:'whatsapp',to:req.body.to,type:'text',text:{body:req.body.text}})}); if(!chats[req.body.to]) chats[req.body.to]={tel:req.body.to,nombre:req.body.to,msgs:[]}; chats[req.body.to].msgs.push({from:'yo',text:req.body.text}); res.json({ok:true});}catch(e){res.status(500).json({});} });
app.post('/api/send-campaign-template', async (req,res)=>{ let sent=0; let fecha=new Date().toLocaleString('es-CO'); for(let c of req.body.contacts){ try{await fetch('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},body:JSON.stringify({messaging_product:'whatsapp',to:c.tel,type:'template',template:{name:'alion_co',language:{code:'es_CO'}}})}); sent++; await new Promise(r=>setTimeout(r,700));}catch(e){}} campaigns.push({fecha:fecha,sent:sent,estado:'Enviada legal'}); res.json({sent:sent}); });
app.listen(process.env.PORT||3000,()=>console.log('OK'));
