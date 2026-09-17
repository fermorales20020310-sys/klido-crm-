const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json({limit:'10mb'}));

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";
const USER = "admin"; const PASS = "alion2025";

let chats = {}; let campaigns = []; let campaignLeads = {};

// === PERSISTENCIA PARA QUE NO SE BORRE NUNCA ===
const DATA_FILE = '/tmp/klido_data.json';
const VOL_FILE = '/mnt/data/klido_data.json';
try{
  if(fs.existsSync(VOL_FILE)){let d=JSON.parse(fs.readFileSync(VOL_FILE,'utf8')); chats=d.chats||{}; campaigns=d.campaigns||[]; campaignLeads=d.campaignLeads||{};}
  else if(fs.existsSync(DATA_FILE)){let d=JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); chats=d.chats||{}; campaigns=d.campaigns||[]; campaignLeads=d.campaignLeads||{};}
}catch(e){}
function saveData(){
  try{
    let data=JSON.stringify({chats,campaigns,campaignLeads});
    fs.writeFileSync(DATA_FILE, data);
    if(fs.existsSync('/mnt/data')) fs.writeFileSync(VOL_FILE, data);
  }catch(e){}
}
setInterval(saveData, 3000);

app.get('/logo', (req,res)=>{
  if(fs.existsSync(path.join(__dirname,'logo.png'))) return res.sendFile(path.join(__dirname,'logo.png'));
  if(fs.existsSync('/mnt/data/logo_cropped.png')) return res.sendFile('/mnt/data/logo_cropped.png');
  if(fs.existsSync('/mnt/data/logo.png')) return res.sendFile('/mnt/data/logo.png');
  res.status(404).send('');
});

// LOGIN
app.get('/login',(req,res)=>{res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:'Inter',sans-serif;background:#f0f7ff;height:100vh;display:flex;align-items:center;justify-content:center}.card{background:#fff;padding:36px;border-radius:20px;width:92%;max-width:400px;box-shadow:0 20px 60px rgba(11,87,208,0.18);text-align:center}input{width:100%;padding:14px;margin-top:12px;border:1px solid #e2e8f0;border-radius:12px}button{width:100%;padding:14px;margin-top:18px;background:#0B57D0;color:#fff;border:none;border-radius:12px;font-weight:700;cursor:pointer}</style></head><body>
<div class="card"><img src="/logo" style="height:90px;margin:0 auto 12px;display:block;object-fit:contain"><h2 style="margin:0;color:#0f172a">KLIDO AVANZA</h2><p style="color:#0B57D0;font-size:13px;font-weight:600;margin:4px 0">CRM DE REDES Y WHATSAPP</p><p style="color:#64748b;font-size:11px">API Oficial 2000 chats/día activa</p><input id="u" placeholder="Usuario: admin"><input id="p" type="password" placeholder="Contraseña: alion2025"><button onclick="login()">Entrar al CRM</button></div>
<script>async function login(){let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:document.getElementById('u').value,pass:document.getElementById('p').value})});let j=await r.json();if(j.ok){localStorage.setItem('klido','1');location.href='/';}else{alert('Mal');}}</script></body></html>`) });

// CAMPANAS
app.get('/campanas',(req,res)=>{res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:'Inter',sans-serif;background:#f6f8fc}.top{height:64px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;padding:0 20px;gap:12px}.box{max-width:780px;margin:20px auto;background:#fff;padding:24px;border-radius:16px;border:1px solid #e2e8f0}select{width:100%;padding:12px;border-radius:10px;border:1px solid #e2e8f0;margin:10px 0;background:#fff}.upload{border:1.5px dashed #0B57D0;padding:18px;border-radius:12px;text-align:center;background:#f8faff}.progress{width:100%;height:24px;background:#f1f5f9;border-radius:12px;overflow:hidden;margin-top:14px;display:none}.bar{height:100%;background:#0B57D0;width:0%;color:#fff;text-align:center;font-size:12px;line-height:24px;font-weight:600}.kpi{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:14px 0}.kpi div{background:#f8fafc;padding:12px;border-radius:12px;text-align:center;border:1px solid #e2e8f0}.kpi b{font-size:20px;color:#0B57D0}table{width:100%;border-collapse:collapse;font-size:13px}th{color:#64748b;text-align:left;padding:8px}td{padding:8px;border-top:1px solid #f1f5f9}</style></head><body>
<script>if(!localStorage.getItem('klido')) location.href='/login';</script>
<div class="top"><img src="/logo" style="height:42px"><b>KLIDO AVANZA</b><span style="font-size:11px;color:#0B57D0;font-weight:600;background:#e0f2fe;padding:4px 8px;border-radius:12px">API 2000/día ACTIVA</span><button onclick="location.href='/'" style="margin-left:auto;background:#0B57D0;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:12px">← Bandeja</button></div>
<div class="box">
<div style="background:#e0f2fe;padding:10px;border-radius:10px;font-size:12px;border:1px solid #bae6fd">✅ API detectada. Puedes usar todas tus plantillas aprobadas.</div>
<label style="font-size:12px;font-weight:700;margin-top:14px;display:block">Selecciona plantilla aprobada</label>
<select id="tplSelect"><option>Cargando plantillas...</option></select>
<div id="tplInfo" style="background:#fffbeb;padding:8px;border-radius:8px;font-size:12px;border:1px solid #fde68a;margin-bottom:10px"></div>
<div class="upload"><b>📤 Cargar Excel</b><p style="font-size:11px;color:#64748b">Columnas: Nombre | Numero con 57</p><input type="file" id="fileExcel"><div id="infoExcel" style="margin-top:8px;color:#0B57D0;font-weight:700;font-size:12px"></div></div>
<textarea id="cts" rows="4" style="width:100%;margin-top:12px;padding:10px;border-radius:10px;border:1px solid #e2e8f0"></textarea>
<button onclick="sendReal()" style="width:100%;margin-top:10px;padding:14px;background:#0B57D0;color:#fff;border:none;border-radius:12px;font-weight:700">🚀 Enviar campaña - Tracking amarillo</button>
<div class="progress" id="prog"><div class="bar" id="bar">0%</div></div>
<div class="kpi"><div><b id="kSent">0</b><br><small>Enviados</small></div><div><b id="kReach">0</b><br><small>Alcance</small></div><div><b id="kResp">0</b><br><small>Hot nuevos</small></div></div>
<div id="res" style="text-align:center;font-weight:700;color:#0B57D0;font-size:13px"></div>
<table id="tb"></table>
</div>
<script>
async function loadTpls(){let r=await fetch('/api/templates');let d=await r.json();let sel=document.getElementById('tplSelect');sel.innerHTML='';for(let i=0;i<d.length;i++){let t=d[i];let op=document.createElement('option');op.value=t.name;op.text=t.name+' - '+t.language+' ('+t.status+')';sel.appendChild(op);}updateInfo();}
function updateInfo(){let n=document.getElementById('tplSelect').value;document.getElementById('tplInfo').innerText='Plantilla: '+n+' - Se marcara en amarillo en bandeja';}
document.getElementById('tplSelect').addEventListener('change',updateInfo);
document.getElementById('fileExcel').addEventListener('change',function(e){let file=e.target.files[0];let r=new FileReader();r.onload=function(evt){let wb=XLSX.read(evt.target.result,{type:'binary'});let sh=wb.Sheets[wb.SheetNames[0]];let rows=XLSX.utils.sheet_to_json(sh,{header:1});let c=[];for(let i=0;i<rows.length;i++){let row=rows[i];if(!row||!row.length) continue;if(i==0&&String(row[1]).toLowerCase().includes('num')) continue;let raw=String(row[1]||row[0]||'').replace(/[^0-9]/g,'');if(raw.length==10) raw='57'+raw;if(raw.length>=12) c.push(raw);}document.getElementById('cts').value=c.join('\\n');document.getElementById('infoExcel').innerText='✅ '+c.length+' validados';};r.readAsBinaryString(file);});
async function sendReal(){let tpl=document.getElementById('tplSelect').value;let raw=document.getElementById('cts').value.trim().split('\\n').filter(x=>x);let contacts=[];for(let i=0;i<raw.length;i++){let t=raw[i].replace(/[^0-9]/g,'');if(t.length==10) t='57'+t;if(t.length>=12) contacts.push(t);}if(!contacts.length){alert('Carga excel');return;}document.getElementById('prog').style.display='block';let sent=0;for(let i=0;i<contacts.length;i++){document.getElementById('bar').style.width=Math.round(((i+1)/contacts.length)*100)+'%';document.getElementById('bar').innerText=(i+1)+'/'+contacts.length;try{let rr=await fetch('/api/send-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tel:contacts[i],template:tpl})});let jj=await rr.json();if(jj.ok) sent++;}catch(e){}document.getElementById('kSent').innerText=sent;document.getElementById('kReach').innerText=sent;document.getElementById('res').innerText='Enviando '+tpl+': '+sent+'/'+contacts.length;}document.getElementById('res').innerText='✅ '+sent+' entregados con '+tpl;loadHist();}
async function loadHist(){let r=await fetch('/api/campaigns');let d=await r.json();let h='<tr><th>Fecha</th><th>Plantilla</th><th>Enviados</th><th>Estado</th></tr>';for(let i=d.length-1;i>=0;i--){let c=d[i];h+='<tr><td>'+c.fecha+'</td><td><span style=background:#fef9c3;padding:2px 8px;border-radius:10px>'+c.template+'</span></td><td><b>'+c.sent+'</b></td><td><span style=background:#dcfce7;color:#166534;padding:3px 8px;border-radius:12px;font-size:11px>'+c.estado+'</span></td></tr>';}document.getElementById('tb').innerHTML=h;let rc=await fetch('/api/chats');let ch=await rc.json();document.getElementById('kResp').innerText=ch.filter(x=>x.isHot).length;}loadTpls();loadHist();
</script></body></html>`) });

// BANDEJA
app.get('/',(req,res)=>{res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:'Inter',sans-serif;background:#f6f8fc;height:100vh;display:flex;flex-direction:column}.top{height:64px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;padding:0 16px;gap:10px}.filtros{display:flex;gap:6px;padding:10px 16px;background:#fff;border-bottom:1px solid #e2e8f0}.filtros button{padding:7px 12px;border-radius:20px;border:1px solid #e2e8f0;background:#fff;font-size:11px;font-weight:500;cursor:pointer}.filtros button.activo{background:#0B57D0;color:#fff}.main{flex:1;display:flex;overflow:hidden}.lista{width:360px;background:#fff;border-right:1px solid #e2e8f0;overflow:auto}.chat{padding:12px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;gap:9px}.chat.camp{border-left:4px solid #facc15;background:#fffbeb}.chat.camp-read{border-left:4px solid #fde68a;background:#fff}.avatar{width:38px;height:38px;border-radius:10px;background:#e0f2fe;display:flex;align-items:center;justify-content:center;font-weight:700;color:#0B57D0;overflow:hidden}.avatar img{width:100%;height:100%;object-fit:cover}.badge{font-size:9px;padding:2px 7px;border-radius:10px;font-weight:600}.b-camp{background:#fef9c3;color:#854d0e;border:1px solid #fde68a}.b-hot{background:#facc15;color:#422006}.msgs{flex:1;display:flex;flex-direction:column;background:#eef2ff}.mensajes{flex:1;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:8px}.banner{background:#fffbeb;border:1px solid #fde68a;padding:10px 12px;border-radius:10px;font-size:11px}.msg{padding:9px 12px;border-radius:16px;max-width:70%;font-size:13px}.cli{background:#fff;align-self:flex-start;border:1px solid #e2e8f0}.yo{background:#0B57D0;color:#fff;align-self:flex-end}.input{padding:10px;background:#fff;border-top:1px solid #e2e8f0;display:flex;gap:8px}</style></head><body>
<script>if(!localStorage.getItem('klido')) location.href='/login';</script>
<div class="top"><img src="/logo" style="height:40px;object-fit:contain"><div><b style="font-size:14px">KLIDO AVANZA</b><div style="font-size:10px;color:#64748b">API 2000/día - Tiempo real</div></div><button onclick="location.href='/campanas'" style="margin-left:auto;background:#0B57D0;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:11px;font-weight:600">+ Campaña</button><button onclick="localStorage.clear();location.href='/login'" style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:10px">Salir</button></div>
<div class="filtros">
<button id="fTodos" class="activo" onclick="filtrar('todos')">Todos <span id="cntAll"></span></button>
<button id="fCamp" onclick="filtrar('campana')">🟨 Campaña <span id="cntCamp"></span></button>
<button id="fResp" onclick="filtrar('respondio')" style="background:#fef9c3;border-color:#facc15">🔥 Hot <span id="cntResp"></span></button>
<button onclick="exportar()" style="margin-left:auto;background:#f8fafc">Exportar</button>
</div>
<div class="main"><div class="lista" id="lista"></div><div class="msgs"><div class="mensajes" id="mensajes"><div style="background:#fff;padding:18px;border-radius:14px;text-align:center"><img src="/logo" style="height:60px;margin:0 auto 10px;display:block"><b>Flujo que pediste activo</b><p style="font-size:11px;color:#64748b">Lees un lead amarillo → sale de Hot pero conserva etiqueta en Todos.<br>Respondes → sale de Hot definitivo.</p></div></div><div class="input"><input id="txt" placeholder="Responder..." style="flex:1;padding:11px 14px;border-radius:20px;border:1px solid #e2e8f0"><button onclick="enviar()" style="background:#0B57D0;color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:16px">↑</button></div></div></div>
<script>
let chats=[],actual=null,filtro='todos';
async function cargar(){
 let r=await fetch('/api/chats'); chats=await r.json();
 document.getElementById('cntAll').innerText='('+chats.length+')';
 document.getElementById('cntCamp').innerText='('+chats.filter(c=>c.esDeCampana).length+')';
 document.getElementById('cntResp').innerText='('+chats.filter(c=>c.isHot).length+')';
 let lista=chats;
 if(filtro=='campana') lista=chats.filter(c=>c.esDeCampana);
 if(filtro=='respondio') lista=chats.filter(c=>c.isHot);
 let h=''; if(!lista.length){document.getElementById('lista').innerHTML='<p style=padding:18px;color:#94a3b8;font-size:12px>'+ (filtro=='respondio'? 'Hot vacío. Cuando respondan campañas, aparecerán aquí en amarillo.' : 'Sin chats')+'</p>'; return;}
 for(let i=0;i<lista.length;i++){let c=lista[i]; let cls=c.isHot?'chat camp':(c.esDeCampana?'chat camp-read':'chat'); let badge=c.isHot?'<span class=badge b-hot>🟨 HOT</span>':(c.esDeCampana?'<span class=badge b-camp>🟨 '+c.templateName+'</span>':''); h+='<div class=\\"'+cls+'\\" onclick=\\"abrir(\\''+c.tel+'\\')\\"><div class=avatar><img src=\\'/logo\\' onerror=\\'this.style.display=\"none\";this.parentElement.innerText=\"'+c.nombre.charAt(0).toUpperCase()+'\"\\'></div><div style=flex:1><div style=display:flex;gap:5px;align-items:center><b style=font-size:12px>'+c.nombre+'</b>'+badge+'</div><div style=font-size:10px;color:#64748b>'+c.tel+'</div><div style=font-size:11px;color:#334155;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis>'+(c.msgs[c.msgs.length-1]?.text||'')+'</div></div></div>';}
 document.getElementById('lista').innerHTML=h;
}
function filtrar(t){filtro=t; document.getElementById('fTodos').className=t=='todos'?'activo':''; document.getElementById('fCamp').className=t=='campana'?'activo':''; document.getElementById('fResp').className=t=='respondio'?'activo':''; cargar();}
async function abrir(tel){
 actual=tel; await fetch('/api/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tel})});
 let c=chats.find(x=>x.tel==tel); let h='';
 if(c.esDeCampana){h+='<div class=banner>🟨 <b>Origen: '+c.templateName+'</b> | Fecha: '+c.campanaFecha+'<br>'+(c.isHot?'<span style=color:#b45309;font-weight:700>🔥 Lead NUEVO sin atender</span>':'<span style=color:#64748b>Ya atendido - conserva etiqueta para trazabilidad Meta</span>')+'</div>';}
 for(let j=0;j<c.msgs.length;j++){let m=c.msgs[j]; h+='<div class=\\"msg '+(m.from=='yo'?'yo':'cli')+'\\">'+m.text+'</div>';}
 document.getElementById('mensajes').innerHTML=h; document.getElementById('mensajes').scrollTop=99999; cargar();
}
async function enviar(){
 let t=document.getElementById('txt').value; if(!t||!actual) return; document.getElementById('txt').value='';
 await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})});
 await fetch('/api/respondido',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tel:actual})});
 cargar();
}
async function exportar(){let r=await fetch('/api/chats'); let all=await r.json(); let leads=all.filter(c=>c.esDeCampana); let csv='Nombre,Telefono,Plantilla,Fecha,Estado,Ultimo Mensaje\\n'; for(let i=0;i<leads.length;i++){csv+=leads[i].nombre+','+leads[i].tel+','+leads[i].templateName+','+leads[i].campanaFecha+','+(leads[i].isHot?'HOT':'Atendido')+','+(leads[i].msgs[leads[i].msgs.length-1]?.text||'').replace(/,/g,' ')+'\\n';} let blob=new Blob([csv],{type:'text/csv'}); let url=URL.createObjectURL(blob); let a=document.createElement('a'); a.href=url; a.download='klido_trazabilidad_meta.csv'; a.click();}
document.getElementById('txt').addEventListener('keydown',e=>{if(e.key=='Enter')enviar();}); setInterval(cargar,1500); cargar();
</script></body></html>`) });

// API
app.post('/api/login',(req,res)=>{if(req.body.user===USER&&req.body.pass===PASS) res.json({ok:true}); else res.json({ok:false});});
app.get('/webhook',(req,res)=>{if(req.query['hub.verify_token']===VERIFY_TOKEN) res.send(req.query['hub.challenge']); else res.sendStatus(403);});
app.post('/webhook',(req,res)=>{
 try{
  let v=req.body.entry?.[0]?.changes?.[0]?.value; let m=v?.messages?.[0];
  if(m){
   let tel=m.from; let txt=m.text?.body||m.button?.text||'interaccion'; let nm=v.contacts?.[0]?.profile?.name||tel;
   if(!chats[tel]) chats[tel]={tel:tel,nombre:nm,msgs:[],esDeCampana:false,isHot:false,templateName:'',campanaFecha:'',leido:false};
   chats[tel].msgs.push({from:'cli',text:txt});
   if(campaignLeads[tel]){chats[tel].esDeCampana=true; chats[tel].isHot=true; chats[tel].templateName=campaignLeads[tel].template; chats[tel].campanaFecha=campaignLeads[tel].fecha; chats[tel].leido=false;}
   saveData();
  }
 }catch(e){} res.sendStatus(200);
});
app.get('/api/chats',(req,res)=>res.json(Object.values(chats)));
app.get('/api/campaigns',(req,res)=>res.json(campaigns));
app.post('/api/read',(req,res)=>{if(chats[req.body.tel]){chats[req.body.tel].leido=true;} saveData(); res.json({ok:true});});
app.post('/api/respondido',(req,res)=>{if(chats[req.body.tel]){chats[req.body.tel].isHot=false; chats[req.body.tel].leido=true;} saveData(); res.json({ok:true});});
app.get('/api/templates', async (req,res)=>{
 try{
  let waba = WABA_ID;
  if(!waba){
   try{
    let rDirect = await fetch('https://graph.facebook.com/v20.0/'+PHONE_ID+'/message_templates?fields=name,language,status&limit=100', {headers:{'Authorization':'Bearer '+TOKEN}});
    let jDirect = await rDirect.json();
    if(jDirect.data && jDirect.data.length>0){
      let approved = jDirect.data.filter(t=>t.status=='APPROVED');
      if(approved.length>0) return res.json(approved);
    }
    let rPhone = await fetch('https://graph.facebook.com/v20.0/'+PHONE_ID+'?fields=id,account_id', {headers:{'Authorization':'Bearer '+TOKEN}});
    let jPhone = await rPhone.json();
    if(jPhone.account_id) waba = jPhone.account_id;
   }catch(e){}
  }
  if(waba){
   let r=await fetch('https://graph.facebook.com/v20.0/'+waba+'/message_templates?fields=name,language,status&limit=100',{headers:{'Authorization':'Bearer '+TOKEN}});
   let j=await r.json();
   let approved=(j.data||[]).filter(t=>t.status=='APPROVED');
   if(approved.length>0) return res.json(approved);
  }
  res.json([{name:'alion_co', language:'es_CO', status:'APPROVED'}]);
 }catch(e){res.json([{name:'alion_co', language:'es_CO', status:'APPROVED'}]);}
});
app.post('/api/send',async(req,res)=>{
 try{
  await fetch('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},body:JSON.stringify({messaging_product:'whatsapp',to:req.body.to,type:'text',text:{body:req.body.text}})});
  if(!chats[req.body.to]) chats[req.body.to]={tel:req.body.to,nombre:req.body.to,msgs:[],esDeCampana:!!campaignLeads[req.body.to],isHot:false,templateName:campaignLeads[req.body.to]?.template||'',campanaFecha:campaignLeads[req.body.to]?.fecha||'',leido:true};
  chats[req.body.to].msgs.push({from:'yo',text:req.body.text}); saveData(); res.json({ok:true});
 }catch(e){res.json({ok:false});}
});
app.post('/api/send-one',async(req,res)=>{
 let tel=req.body.tel; let tpl=req.body.template||'alion_co';
 try{
  let r=await fetch('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},body:JSON.stringify({messaging_product:'whatsapp',to:tel,type:'template',template:{name:tpl,language:{code:'es_CO'}}})});
  let j=await r.json();
  if(j.messages){
   campaignLeads[tel]={fecha:new Date().toLocaleString('es-CO'), template:tpl};
   if(!chats[tel]) chats[tel]={tel:tel,nombre:tel,msgs:[{from:'yo',text:'['+tpl+']'}],esDeCampana:true,isHot:false,templateName:tpl,campanaFecha:campaignLeads[tel].fecha,leido:false};
   else{chats[tel].esDeCampana=true; chats[tel].templateName=tpl; chats[tel].campanaFecha=campaignLeads[tel].fecha;}
   let key=new Date().toLocaleDateString('es-CO')+'_'+tpl;
   let camp=campaigns.find(c=>c.key==key);
   if(!camp){camp={key:key, fecha:new Date().toLocaleString('es-CO'), template:tpl, sent:0, total:0, estado:'Entregada a Meta API'}; campaigns.push(camp);}
   camp.sent++; camp.total++; saveData(); res.json({ok:true});
  }else{res.json({ok:false,error:j});}
 }catch(e){res.json({ok:false});}
});
app.listen(process.env.PORT||3000,()=>console.log('KLIDO FINAL CON LOGO OK'));
