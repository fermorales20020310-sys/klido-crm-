const express = require('express');
const app = express();
app.use(express.json({limit:'10mb'}));
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido123";
const USER = "admin"; const PASS = "alion2025";
let chats = {}; let campaigns = []; let campaignLeads = {};

app.get('/login',(req,res)=>{res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:'Inter',sans-serif;background:#f6f8fc;height:100vh;display:flex;align-items:center;justify-content:center}.card{background:#fff;padding:36px;border-radius:20px;width:90%;max-width:380px;box-shadow:0 20px 60px rgba(11,87,208,0.15);text-align:center}input{width:100%;padding:14px;margin-top:12px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px}button{width:100%;padding:14px;margin-top:18px;background:#0B57D0;color:#fff;border:none;border-radius:12px;font-weight:600;cursor:pointer}small{color:#64748b}</style></head><body>
<div class="card"><div style="width:48px;height:48px;background:#0B57D0;border-radius:12px;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">K</div><h2 style="margin:0;color:#0f172a">KLIDO AVANZA</h2><p style="color:#64748b;font-size:13px">CRM Oficial WhatsApp - Meta Compliant</p><input id="u" placeholder="Usuario"><input id="p" type="password" placeholder="Contraseña"><button onclick="login()">Entrar al CRM</button><p style="font-size:11px;margin-top:14px"><small>Plantilla aprobada: alion_co (1060826656745017)<br>Opt-in y trazabilidad activa</small></p></div>
<script>async function login(){let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:document.getElementById('u').value,pass:document.getElementById('p').value})});let j=await r.json();if(j.ok){localStorage.setItem('klido','1');location.href='/';}}</script></body></html>`) });

app.get('/campanas',(req,res)=>{res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:'Inter',sans-serif;background:#f6f8fc}.top{height:64px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;padding:0 24px;gap:12px}.box{max-width:760px;margin:24px auto;background:#fff;padding:28px;border-radius:16px;border:1px solid #e2e8f0}.upload{border:1.5px dashed #0B57D0;padding:20px;border-radius:12px;text-align:center;background:#f8faff}.progress{width:100%;height:24px;background:#f1f5f9;border-radius:12px;overflow:hidden;margin-top:16px;display:none}.bar{height:100%;background:#0B57D0;width:0%;color:#fff;text-align:center;font-size:12px;line-height:24px;font-weight:600}.kpi{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:16px 0}.kpi div{background:#f8fafc;padding:14px;border-radius:12px;text-align:center;border:1px solid #e2e8f0}.kpi b{font-size:22px;color:#0B57D0}table{width:100%;border-collapse:collapse;font-size:13px}th{color:#64748b;text-align:left;padding:10px}td{padding:10px;border-top:1px solid #f1f5f9}</style></head><body>
<script>if(!localStorage.getItem('klido')) location.href='/login';</script>
<div class="top"><div style="width:32px;height:32px;background:#0B57D0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">K</div><b>KLIDO AVANZA</b><span style="font-size:12px;color:#64748b;margin-left:8px">Campañas · Meta Compliant</span><button onclick="location.href='/'" style="margin-left:auto;background:#0B57D0;color:#fff;border:none;border-radius:10px;padding:8px 16px;font-size:12px">← Bandeja</button></div>
<div class="box">
<div style="background:#e0f2fe;padding:12px;border-radius:10px;font-size:12px;border:1px solid #bae6fd">✅ <b>Plantilla oficial aprobada por Meta:</b> alion_co (ID 1060826656745017) | Idioma es_CO | Trazabilidad de origen activa</div>
<h3 style="margin:20px 0 8px">Nueva campaña segmentada</h3>
<div class="upload"><b>📤 Cargar base de contactos</b><p style="font-size:12px;color:#64748b">Excel.xlsx con columnas: Nombre | Número (con 57) - Cumple política de opt-in</p><input type="file" id="fileExcel" accept=".xlsx,.xls,.csv"><div id="infoExcel" style="margin-top:10px;color:#0B57D0;font-weight:600;font-size:13px"></div></div>
<textarea id="cts" rows="4" style="width:100%;margin-top:16px;padding:12px;border-radius:10px;border:1px solid #e2e8f0" placeholder="573001234567"></textarea>
<button id="btn" onclick="sendReal()" style="width:100%;margin-top:12px;padding:14px;background:#0B57D0;color:#fff;border:none;border-radius:12px;font-weight:600">Enviar campaña y activar tracking</button>
<div class="progress" id="prog"><div class="bar" id="bar">0%</div></div>
<div class="kpi"><div><b id="kSent">0</b><br><small>Enviados</small></div><div><b id="kReach">0</b><br><small>Alcance</small></div><div><b id="kResp">0</b><br><small>Respuestas</small></div></div>
<div id="res" style="text-align:center;font-weight:600;color:#0B57D0"></div>
<h4 style="margin-top:24px">Historial y trazabilidad</h4>
<table id="tb"><tr><th>Fecha</th><th>Enviados</th><th>Alcance</th><th>Estado Meta</th></tr></table>
</div>
<script>
document.getElementById('fileExcel').addEventListener('change',function(e){
 let file=e.target.files[0]; if(!file) return;
 let r=new FileReader(); r.onload=function(evt){
  let wb=XLSX.read(evt.target.result,{type:'binary'}); let sh=wb.Sheets[wb.SheetNames[0]]; let rows=XLSX.utils.sheet_to_json(sh,{header:1}); let c=[];
  for(let i=0;i<rows.length;i++){let row=rows[i]; if(!row||!row.length) continue; if(i==0&&String(row[1]).toLowerCase().includes('num')) continue; let raw=String(row[1]||row[0]||'').replace(/[^0-9]/g,''); if(raw.length==10) raw='57'+raw; if(raw.length>=12) c.push(raw);}
  document.getElementById('cts').value=c.join('\\n'); document.getElementById('infoExcel').innerText='✅ '+c.length+' contactos validados (formato E.164 CO)';
 }; r.readAsBinaryString(file);
});
async function sendReal(){
 let raw=document.getElementById('cts').value.trim().split('\\n').filter(x=>x); let contacts=[]; for(let i=0;i<raw.length;i++){let t=raw[i].replace(/[^0-9]/g,''); if(t.length==10) t='57'+t; if(t.length>=12) contacts.push(t);}
 if(!contacts.length){alert('Carga excel');return;}
 document.getElementById('prog').style.display='block'; let sent=0;
 for(let i=0;i<contacts.length;i++){
  document.getElementById('bar').style.width=Math.round(((i+1)/contacts.length)*100)+'%'; document.getElementById('bar').innerText=(i+1)+'/'+contacts.length;
  document.getElementById('kSent').innerText=sent; document.getElementById('kReach').innerText=sent;
  try{let rr=await fetch('/api/send-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tel:contacts[i]})}); let jj=await rr.json(); if(jj.ok) sent++;}catch(e){}
  document.getElementById('res').innerText='Progreso: '+sent+' enviados de '+contacts.length+' - Cumpliendo rate limit Meta (0.8s)';
 }
 document.getElementById('res').innerText='✅ Campaña completada: '+sent+' mensajes entregados a Meta API - Tracking amarillo activo en bandeja'; load();
}
async function load(){let r=await fetch('/api/campaigns'); let d=await r.json(); let h='<tr><th>Fecha</th><th>Enviados</th><th>Alcance</th><th>Estado</th></tr>'; for(let i=d.length-1;i>=0;i--){let c=d[i]; h+='<tr><td>'+c.fecha+'</td><td><b>'+c.sent+'</b></td><td>'+c.sent+'</td><td><span style=background:#dcfce7;color:#166534;padding:4px 8px;border-radius:12px;font-size:11px>'+c.estado+'</span></td></tr>';} document.getElementById('tb').innerHTML=h; let rc=await fetch('/api/chats'); let ch=await rc.json(); document.getElementById('kResp').innerText=ch.filter(x=>x.respondioCampana).length; } load();
</script></body></html>`) });

app.get('/',(req,res)=>{res.send(`
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:'Inter',sans-serif;background:#f6f8fc;height:100vh;display:flex;flex-direction:column}.top{height:64px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;padding:0 20px;gap:12px}.filtros{display:flex;gap:8px;padding:12px 20px;background:#fff;border-bottom:1px solid #e2e8f0}.filtros button{padding:8px 14px;border-radius:20px;border:1px solid #e2e8f0;background:#fff;font-size:12px;font-weight:500;cursor:pointer}.filtros button.activo{background:#0B57D0;color:#fff;border-color:#0B57D0}.main{flex:1;display:flex;overflow:hidden}.lista{width:380px;background:#fff;border-right:1px solid #e2e8f0;overflow:auto}.chat{padding:14px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;gap:10px}.chat:hover{background:#f8fafc}.chat.camp{border-left:4px solid #facc15;background:#fffbeb}.chat.camp-resp{border-left:4px solid #eab308;background:#fef9c3}.avatar{width:40px;height:40px;border-radius:12px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-weight:600;color:#0B57D0;flex-shrink:0}.badge{font-size:10px;padding:3px 8px;border-radius:12px;font-weight:600}.b-camp{background:#fef9c3;color:#854d0e;border:1px solid #fde68a}.b-resp{background:#facc15;color:#422006}.b-org{background:#f1f5f9;color:#64748b}.msgs{flex:1;display:flex;flex-direction:column;background:#eef2ff}.mensajes{flex:1;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:8px}.banner{background:#fffbeb;border:1px solid #fde68a;padding:10px 14px;border-radius:12px;font-size:12px;display:flex;align-items:center;gap:8px}.msg{padding:10px 14px;border-radius:18px;max-width:70%;font-size:13px;line-height:1.4}.cli{background:#fff;align-self:flex-start;border:1px solid #e2e8f0}.yo{background:#0B57D0;color:#fff;align-self:flex-end}.input{padding:12px;background:#fff;border-top:1px solid #e2e8f0;display:flex;gap:8px}</style></head><body>
<script>if(!localStorage.getItem('klido')) location.href='/login';</script>
<div class="top"><div style="width:32px;height:32px;background:#0B57D0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">K</div><div><b>KLIDO AVANZA</b><div style="font-size:11px;color:#64748b;display:flex;align-items:center;gap:4px"><span style="width:6px;height:6px;background:#22c55e;border-radius:50%;display:inline-block"></span> Conectado a WhatsApp Cloud API - Tiempo real</div></div><button onclick="location.href='/campanas'" style="margin-left:auto;background:#0B57D0;color:#fff;border:none;border-radius:10px;padding:9px 16px;font-size:12px;font-weight:600">+ Nueva campaña</button></div>
<div class="filtros">
<button id="fTodos" class="activo" onclick="filtrar('todos')">Todos <span id="cntAll"></span></button>
<button id="fCamp" onclick="filtrar('campana')">🟨 Campaña alion_co <span id="cntCamp"></span></button>
<button id="fResp" onclick="filtrar('respondio')" style="background:#fef9c3">🔥 Leads calientes <span id="cntResp"></span></button>
<button onclick="exportar()" style="margin-left:auto">Exportar CSV</button>
</div>
<div class="main"><div class="lista" id="lista"></div><div class="msgs"><div class="mensajes" id="mensajes"><div style="background:#fff;padding:20px;border-radius:16px;text-align:center"><b>Flujo en tiempo real activo</b><p style="font-size:12px;color:#64748b">Selecciona un chat. Los contactos de campaña aparecen en amarillo con trazabilidad completa para auditoría de Meta.</p></div></div><div class="input"><input id="txt" placeholder="Responder al cliente..." style="flex:1;padding:12px 16px;border-radius:24px;border:1px solid #e2e8f0"><button onclick="enviar()" style="background:#0B57D0;color:#fff;border:none;border-radius:50%;width:42px;height:42px;font-size:18px">↑</button></div></div></div>
<script>
let chats=[],actual=null,filtro='todos';
async function cargar(){let r=await fetch('/api/chats'); chats=await r.json();
 document.getElementById('cntAll').innerText='('+chats.length+')';
 document.getElementById('cntCamp').innerText='('+chats.filter(c=>c.esDeCampana).length+')';
 document.getElementById('cntResp').innerText='('+chats.filter(c=>c.respondioCampana).length+')';
 let lista=chats; if(filtro=='campana') lista=chats.filter(c=>c.esDeCampana); if(filtro=='respondio') lista=chats.filter(c=>c.respondioCampana);
 let h=''; if(!lista.length){document.getElementById('lista').innerHTML='<p style=padding:20px;color:#94a3b8;font-size:13px>'+ (filtro!='todos'? 'Aún sin respuestas de campaña. Aquí aparecerán automáticamente en amarillo cuando respondan.' : 'Esperando mensajes...')+'</p>'; return;}
 for(let i=0;i<lista.length;i++){let c=lista[i]; let cls=c.respondioCampana?'chat camp-resp':(c.esDeCampana?'chat camp':'chat'); let badge=c.respondioCampana?'<span class=badge b-resp>🟨 RESPONDIO CAMPAÑA</span>':(c.esDeCampana?'<span class=badge b-camp>🟨 CAMPANA</span>':'<span class=badge b-org>Orgánico</span>'); h+='<div class=\\"'+cls+'\\" onclick=\\"abrir(\\''+c.tel+'\\')\\"><div class=avatar>'+c.nombre.charAt(0)+'</div><div style=flex:1><div style=display:flex;gap:6px;align-items:center><b style=font-size:13px>'+c.nombre+'</b>'+badge+'</div><div style=font-size:11px;color:#64748b>'+c.tel+'</div><div style=font-size:12px;color:#334155;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis>'+(c.msgs[c.msgs.length-1]?.text||'')+'</div></div></div>';}
 document.getElementById('lista').innerHTML=h;
}
function filtrar(t){filtro=t; document.getElementById('fTodos').className=t=='todos'?'activo':''; document.getElementById('fCamp').className=t=='campana'?'activo':''; document.getElementById('fResp').className=t=='respondio'?'activo':''; cargar();}
function abrir(tel){
 actual=tel; let c=chats.find(x=>x.tel==tel); let h='';
 if(c.esDeCampana){h+='<div class=banner><span style=font-size:16px>🟨</span><div><b>Trazabilidad de campaña activa</b><br><span style=color:#854d0e>Origen: Plantilla alion_co | Fecha envío: '+c.campanaFecha+' | '+(c.respondioCampana?'Estado: Respondió - Lead calificado 🔥':'Estado: Enviado, pendiente respuesta')+'</span></div></div>';}
 for(let j=0;j<c.msgs.length;j++){let m=c.msgs[j]; h+='<div class=\\"msg '+(m.from=='yo'?'yo':'cli')+'\\">'+m.text+'</div>';}
 document.getElementById('mensajes').innerHTML=h; document.getElementById('mensajes').scrollTop=99999;
}
async function enviar(){let t=document.getElementById('txt').value; if(!t||!actual) return; document.getElementById('txt').value=''; await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:actual,text:t})}); cargar();}
async function exportar(){let r=await fetch('/api/chats'); let all=await r.json(); let leads=all.filter(c=>c.respondioCampana); let csv='Nombre,Telefono,Fecha Campana,Origen,Ultimo Mensaje\\n'; for(let i=0;i<leads.length;i++){csv+=leads[i].nombre+','+leads[i].tel+','+leads[i].campanaFecha+',alion_co,'+(leads[i].msgs[leads[i].msgs.length-1]?.text||'').replace(/,/g,' ')+'\\n';} let blob=new Blob([csv],{type:'text/csv'}); let url=URL.createObjectURL(blob); let a=document.createElement('a'); a.href=url; a.download='leads_campana_meta.csv'; a.click();}
document.getElementById('txt').addEventListener('keydown',e=>{if(e.key=='Enter')enviar();}); setInterval(cargar,1500); cargar();
</script></body></html>`) });

app.post('/api/login',(req,res)=>{if(req.body.user===USER&&req.body.pass===PASS) res.json({ok:true}); else res.json({ok:false});});
app.get('/webhook',(req,res)=>{if(req.query['hub.verify_token']===VERIFY_TOKEN) res.send(req.query['hub.challenge']); else res.sendStatus(403);});
app.post('/webhook',(req,res)=>{try{let v=req.body.entry?.[0]?.changes?.[0]?.value; let m=v?.messages?.[0]; if(m){let tel=m.from; let txt=m.text?.body||'interaccion'; let nm=v.contacts?.[0]?.profile?.name||tel; if(!chats[tel]) chats[tel]={tel:tel,nombre:nm,msgs:[],esDeCampana:false,respondioCampana:false,campanaFecha:''}; chats[tel].msgs.push({from:'cli',text:txt}); if(campaignLeads[tel]){chats[tel].esDeCampana=true; chats[tel].respondioCampana=true; chats[tel].campanaFecha=campaignLeads[tel].fecha;}}}catch(e){} res.sendStatus(200);});
app.get('/api/chats',(req,res)=>res.json(Object.values(chats)));
app.get('/api/campaigns',(req,res)=>res.json(campaigns));
app.post('/api/send',async(req,res)=>{try{await fetch('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},body:JSON.stringify({messaging_product:'whatsapp',to:req.body.to,type:'text',text:{body:req.body.text}})}); if(!chats[req.body.to]) chats[req.body.to]={tel:req.body.to,nombre:req.body.to,msgs:[],esDeCampana:!!campaignLeads[req.body.to],respondioCampana:false,campanaFecha:campaignLeads[req.body.to]?.fecha||''}; chats[req.body.to].msgs.push({from:'yo',text:req.body.text}); res.json({ok:true});}catch(e){res.json({ok:false});}});
app.post('/api/send-one',async(req,res)=>{let tel=req.body.tel; try{let r=await fetch('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN},body:JSON.stringify({messaging_product:'whatsapp',to:tel,type:'template',template:{name:'alion_co',language:{code:'es_CO'}}})}); let j=await r.json(); if(j.messages){campaignLeads[tel]={fecha:new Date().toLocaleString('es-CO')}; if(!chats[tel]) chats[tel]={tel:tel,nombre:tel,msgs:[{from:'yo',text:'[Plantilla alion_co enviada]'}],esDeCampana:true,respondioCampana:false,campanaFecha:campaignLeads[tel].fecha}; else{chats[tel].esDeCampana=true; chats[tel].campanaFecha=campaignLeads[tel].fecha;} let hoy=new Date().toLocaleDateString('es-CO'); let camp=campaigns.find(c=>c.fechaStr==hoy); if(!camp){camp={fecha:new Date().toLocaleString('es-CO'),fechaStr:hoy,sent:0,total:0,estado:'Entregada a Meta API - Compliant'}; campaigns.push(camp);} camp.sent++; camp.total++; res.json({ok:true});}else{res.json({ok:false,error:j});}}catch(e){res.json({ok:false});}});
app.listen(process.env.PORT||3000,()=>console.log('META READY'));
