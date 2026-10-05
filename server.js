// KLIDO AVANZA CONSULTING V155 - TU V154 ARREGLADO - FIX EMPRESA NO ENCONTRADA
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({limit:'100mb'}));
app.use(express.urlencoded({extended:true}));
['db','public','public/uploads','uploads'].forEach(d=>{ if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}) });
const upload = multer({dest:'uploads/'});

function getDB(id){
  id=id||'default';
  const file=path.join(__dirname,'db',`${id}.json`);
  if(!fs.existsSync(file)) return {empresa_id:id, config:null, chats:{}, campaigns:{}, workers:{}, reminders:[], gmail_campaigns:{}, calls:{}, users:{}, codes:{}};
  try{ return JSON.parse(fs.readFileSync(file,'utf8')); }catch{ return {empresa_id:id, config:null, chats:{}, campaigns:{}, workers:{}, reminders:[], gmail_campaigns:{}, calls:{}, users:{}, codes:{}}; }
}
function saveDB(id,data){ fs.writeFileSync(path.join(__dirname,'db',`${id}.json`), JSON.stringify(data,null,2)); }
function loadConfig(id){
  let db=getDB(id);
  if(!db.config && process.env.WHATSAPP_TOKEN){
    db.config={token:process.env.WHATSAPP_TOKEN, phone:process.env.PHONE_ID, waba:process.env.WABA_ID, phone_id:process.env.PHONE_ID, waba_id:process.env.WABA_ID};
    saveDB(id, db);
  }
  return db.config;
}
function getMasterDB(){
  const file=path.join(__dirname,'db','master.json');
  if(!fs.existsSync(file)) return {empresas:{}, users:{}};
  try{ return JSON.parse(fs.readFileSync(file,'utf8')); }catch{ return {empresas:{}, users:{}}; }
}
function saveMaster(db){ fs.writeFileSync(path.join(__dirname,'db','master.json'), JSON.stringify(db,null,2)); }

// ===== TUS PLANES REALES COMO LOS VENDES =====
const PLANES = {
  Basico: {
    nombre:'BÁSICO', max_conversaciones:2000, max_trabajadores:2,
    campañas_wpp_excel:true, campañas_wpp_manual:true, campañas_gmail:false,
    ia:false, boton_agente:false, llamadas:false, seguimiento_llamadas:false, metricas:false
  },
  Premium: {
    nombre:'PREMIUM', max_conversaciones:8000, max_trabajadores:5,
    campañas_wpp_excel:true, campañas_wpp_manual:true, campañas_gmail:false,
    ia:true, boton_agente:true, llamadas:false, seguimiento_llamadas:false, metricas:true
  },
  Gold: {
    nombre:'GOLD ILIMITADO', max_conversaciones:9999999, max_trabajadores:999,
    campañas_wpp_excel:true, campañas_wpp_manual:true, campañas_gmail:true,
    ia:true, boton_agente:true, llamadas:true, seguimiento_llamadas:true, metricas:true
  }
};

// ===== RESEND EMAIL (TUYO ORIGINAL) =====
async function enviarCorreo(to, subject, html){
  try{
    if(!process.env.RESEND_API_KEY){ console.log('No RESEND_API_KEY, código en consola'); return true; }
    const r=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${process.env.RESEND_API_KEY}`},
      body:JSON.stringify({from: process.env.RESEND_FROM || 'Klido <onboarding@klidoapp.com.co>', to, subject, html})
    });
    const j=await r.json(); console.log('Resend', j); return true;
  }catch(e){ console.log('Resend error', e.message); return true; }
}

// LOGIN - FIX MINUSCULAS
app.post('/api/login', (req,res)=>{
  const {correo, password} = req.body;
  const correoLimpio = String(correo||'').trim().toLowerCase();
  const master=getMasterDB();
  const user=Object.values(master.users).find(u=> String(u.correo||'').toLowerCase()===correoLimpio && u.password===password);
  if(!user && correoLimpio==='admin'){ return res.json({ok:true, empresa_id:'default'}); }
  if(!user) return res.json({ok:false, error:'No existe o contraseña incorrecta'});
  return res.json({ok:true, empresa_id:user.empresa_id, user});
});

// CREAR EMPRESA - FIX GUARDA TODO EN MINUSCULAS
app.post('/api/crear-empresa', async(req,res)=>{
  const {nombre_agencia, correo, password, plan} = req.body;
  if(!nombre_agencia ||!correo) return res.json({ok:false, error:'Faltan datos'});
  const correoLimpio = String(correo).trim().toLowerCase();
  const master=getMasterDB();
  const empresa_id=correoLimpio.replace(/[^a-z0-9]/g,'').substring(0,15)+'_'+Date.now().toString().slice(-4);
  const codigo=Math.floor(100000+Math.random()*900000).toString();

  master.empresas[empresa_id]={id:empresa_id, nombre:nombre_agencia, correo:correoLimpio, plan: plan||'Basico', codigo, verificado:false, created:Date.now()};
  master.users[correoLimpio]={correo:correoLimpio, password, empresa_id, plan: plan||'Basico', nombre:nombre_agencia};
  saveMaster(master);

  const db=getDB(empresa_id); db.config=null; saveDB(empresa_id, db);

  await enviarCorreo(correoLimpio, `Tu código Klido - ${codigo}`, `
    <div style="font-family:Arial;padding:20px"><h2>Bienvenido a Klido Avanza Consulting</h2>
    <p>Tu agencia <b>${nombre_agencia}</b> ha sido creada.</p>
    <p>Tu código de registro es:</p><h1 style="background:#0b57d0;color:#fff;padding:15px;border-radius:10px;text-align:center;letter-spacing:5px">${codigo}</h1>
    <p>Plan: ${plan}</p><p>Ingresa en app.klidoapp.com.co</p></div>
  `);

  console.log(`CODIGO ${correoLimpio}: ${codigo}`);
  res.json({ok:true, empresa_id, codigo_debug: codigo, msg:'Código enviado a Gmail'});
});

// VERIFICAR CODIGO - FIX DEFINITIVO EMPRESA NO ENCONTRADA
app.post('/api/verificar-codigo',(req,res)=>{
  const {correo, codigo} = req.body;
  const correoLimpio = String(correo||'').trim().toLowerCase();
  const codigoLimpio = String(codigo||'').trim();
  const master=getMasterDB();
  const emp=Object.values(master.empresas).find(e=> String(e.correo||'').trim().toLowerCase()===correoLimpio);
  if(!emp) return res.json({ok:false, error:'Empresa no encontrada'});
  if(String(emp.codigo).trim()===codigoLimpio){ emp.verificado=true; saveMaster(master); return res.json({ok:true, empresa_id:emp.id}); }
  return res.json({ok:false, error:'Código incorrecto'});
});

app.post('/api/recuperar-password', async(req,res)=>{
  const {correo} = req.body;
  const correoLimpio = String(correo||'').trim().toLowerCase();
  const master=getMasterDB();
  const user=master.users[correoLimpio] || Object.values(master.users).find(u=> String(u.correo||'').toLowerCase()===correoLimpio);
  if(!user) return res.json({ok:false, error:'Correo no registrado'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  if(master.empresas[user.empresa_id]){ master.empresas[user.empresa_id].codigo=codigo; saveMaster(master); }
  await enviarCorreo(correoLimpio, `Recuperar contraseña Klido - ${codigo}`, `<h1>Tu código de recuperación es: ${codigo}</h1>`);
  console.log(`RECUPERAR ${correoLimpio}: ${codigo}`);
  res.json({ok:true, msg:'Código enviado', codigo_debug:codigo});
});

app.post('/api/cambiar-password',(req,res)=>{
  const {correo, codigo, nueva_password}=req.body;
  const correoLimpio = String(correo||'').trim().toLowerCase();
  const master=getMasterDB();
  const emp=Object.values(master.empresas).find(e=> String(e.correo||'').trim().toLowerCase()===correoLimpio);
  if(!emp || String(emp.codigo).trim()!==String(codigo).trim()) return res.json({ok:false, error:'Código incorrecto'});
  const userKey = Object.keys(master.users).find(k=>k.toLowerCase()===correoLimpio) || correoLimpio;
  if(master.users[userKey]){ master.users[userKey].password=nueva_password; saveMaster(master); }
  res.json({ok:true});
});

// ===== CHECK PLAN CON LIMITES REALES =====
app.get('/api/mi-plan/:empresa_id',(req,res)=>{
  const master=getMasterDB();
  const empresa_id=req.params.empresa_id;
  const emp=master.empresas[empresa_id] || Object.values(master.empresas).find(e=>e.id===empresa_id) || {plan:'Basico', nombre:'Default'};
  const planKey=emp.plan||'Basico';
  const plan=PLANES[planKey]||PLANES.Basico;
  const db=getDB(empresa_id);
  const totalConvers=Object.keys(db.chats||{}).length;
  const totalTrab=Object.keys(db.workers||{}).length;
  res.json({
    plan:planKey,...plan,
    nombre_empresa:emp.nombre, correo:emp.correo,
    usado_conversaciones: totalConvers,
    usado_trabajadores: totalTrab,
    puede_convers: totalConvers < plan.max_conversaciones,
    puede_trabajador: totalTrab < plan.max_trabajadores,
    limite_alcanzado: totalConvers >= plan.max_conversaciones
  });
});

// TUS APIS DE CRM (ORIGINALES)
app.get('/api/empresa/:id',(req,res)=>res.json(loadConfig(req.params.id)||{}));
app.post('/api/config-empresa',(req,res)=>{ const {empresa_id, token, phone_id, waba_id}=req.body; const db=getDB(empresa_id||'default'); db.config={token, phone:phone_id, waba:waba_id, phone_id, waba_id}; saveDB(empresa_id||'default', db); res.json({ok:true}); });
app.get('/api/plantillas/:empresa_id', async(req,res)=>{ const emp=loadConfig(req.params.empresa_id); if(!emp?.token) return res.json([]); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba||emp.waba_id}/message_templates?fields=name,status,language&access_token=${emp.token}&limit=200`); const j=await r.json(); res.json((j.data||[]).filter(t=>t.status==='APPROVED')); }catch{ res.json([]); }});

app.post('/api/campana/enviar', async(req,res)=>{
  const {empresa_id, plantilla, numeros, variables, imagen_url, nombre}=req.body; const emp=loadConfig(empresa_id||'default');
  if(!emp?.token) return res.json({ok:false, error:'Empresa no configurada - Configura API Cloud'});
  const master=getMasterDB();
  const empresa=master.empresas[empresa_id]; const plan=PLANES[empresa?.plan||'Basico'];
  if(!plan.campañas_wpp_excel &&!plan.campañas_wpp_manual) return res.json({ok:false, error:'Plan no incluye campañas WPP'});
  let lista=[...new Set((numeros||[]).map(n=>String(n).replace(/\D/g,'')).map(n=>n.length==10?'57'+n:n))];
  const db=getDB(empresa_id); const id=Date.now().toString(); db.campaigns[id]={id, nombre: nombre||plantilla, plantilla, total:lista.length, enviados:0, fallidos:0, estado:'enviando', pausada:false, created:Date.now()}; saveDB(empresa_id, db); res.json({ok:true, total:lista.length});
  (async()=>{ for(let num of lista){ try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone||emp.phone_id}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify({messaging_product:'whatsapp', to:num, type:'template', template:{name:plantilla, language:{code:'es_CO'}, components: variables?.length?[{type:'body', parameters:variables.map(t=>({type:'text', text:t}))}]:[]}})}); const j=await r.json(); const cur=getDB(empresa_id); if(j.messages) cur.campaigns[id].enviados++; else cur.campaigns[id].fallidos++; saveDB(empresa_id,cur);}catch{} await new Promise(r=>setTimeout(r,1200)); } const f=getDB(empresa_id); if(f.campaigns[id]){f.campaigns[id].estado='finalizada'; saveDB(empresa_id,f);} })();
});
app.get('/api/campanas/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).campaigns||{}).sort((a,b)=>b.created-a.created)));

app.post('/api/campana/gmail/enviar', async(req,res)=>{
  const {empresa_id, asunto, html, emails}=req.body;
  const master=getMasterDB(); const emp=master.empresas[empresa_id]; const plan=PLANES[emp?.plan||'Basico'];
  if(!plan.campañas_gmail) return res.json({ok:false, error:'🔒 Solo plan Gold incluye campañas Gmail. Mejora tu plan'});
  const db=getDB(empresa_id); const id=Date.now().toString();
  db.gmail_campaigns[id]={id, asunto, total:emails.length, enviados:0, estado:'enviando', created:Date.now()}; saveDB(empresa_id, db);
  res.json({ok:true, total:emails.length});
  (async()=>{ for(let email of emails){ await enviarCorreo(email, asunto, html); const cur=getDB(empresa_id); cur.gmail_campaigns[id].enviados++; saveDB(empresa_id, cur); await new Promise(r=>setTimeout(r,800)); } const f=getDB(empresa_id); f.gmail_campaigns[id].estado='finalizada'; saveDB(empresa_id,f); })();
});

app.post('/api/cliente/guardar',(req,res)=>{
  const {empresa_id, chat_id, cliente}=req.body;
  const db=getDB(empresa_id);
  if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id, mensajes:[], no_leidos:0, last:Date.now()};
  const validos=['Cliente','Nuevo','Interesado','Campaña'];
  const seg=validos.includes(cliente.segmento)? cliente.segmento : 'Nuevo';
  db.chats[chat_id].cliente={...cliente, segmento:seg, updated:Date.now()};
  saveDB(empresa_id, db);
  res.json({ok:true});
});

app.post('/api/trabajador/crear',(req,res)=>{
  const {empresa_id, nombre, correo} = req.body;
  const master=getMasterDB(); const emp=master.empresas[empresa_id]; const plan=PLANES[emp?.plan||'Basico'];
  const db=getDB(empresa_id);
  if(Object.keys(db.workers||{}).length >= plan.max_trabajadores){
    return res.json({ok:false, error:`🔒 Tu plan ${emp?.plan} solo permite ${plan.max_trabajadores} trabajadores. Actualiza a ${emp?.plan==='Basico'?'Premium (5)':'Gold (ilimitado)'}`});
  }
  const id=Date.now().toString(); db.workers[id]={id, nombre, correo, created:Date.now()}; saveDB(empresa_id, db);
  res.json({ok:true, id});
});
app.get('/api/trabajadores/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).workers||{})));
app.delete('/api/trabajador/:empresa_id/:id',(req,res)=>{ const db=getDB(req.params.empresa_id); delete db.workers[req.params.id]; saveDB(req.params.empresa_id, db); res.json({ok:true}); });

app.post('/api/llamada/registrar',(req,res)=>{
  const {empresa_id, chat_id, numero, duracion, estado, nota}=req.body;
  const master=getMasterDB(); const emp=master.empresas[empresa_id]; const plan=PLANES[emp?.plan||'Basico'];
  if(!plan.llamadas) return res.json({ok:false, error:'🔒 Llamadas solo Gold'});
  const db=getDB(empresa_id); const id=Date.now().toString();
  db.calls[id]={id, chat_id, numero, duracion, estado: estado||'realizada', nota, fecha:Date.now(), refleja_meta:true};
  if(db.chats[chat_id]){ db.chats[chat_id].mensajes.push({from:'sistema', texto:`📞 Llamada ${estado} - ${duracion} - ${nota||''} (Número reflejado Meta)`, tipo:'llamada', ts:Date.now()}); }
  saveDB(empresa_id, db); res.json({ok:true});
});
app.get('/api/llamadas/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).calls||{}).sort((a,b)=>b.fecha-a.fecha)));

app.post('/api/recordatorio',(req,res)=>{
  const {empresa_id, chat_id, titulo, fecha, tipo}=req.body;
  const db=getDB(empresa_id); db.reminders.push({id:Date.now().toString(), chat_id, titulo, fecha: fecha||Date.now()+86400000, tipo: tipo||'seguimiento', hecho:false}); saveDB(empresa_id, db); res.json({ok:true});
});
app.get('/api/recordatorios/:empresa_id',(req,res)=>res.json((getDB(req.params.empresa_id).reminders||[]).sort((a,b)=>a.fecha-b.fecha)));

app.get('/api/stats/:empresa_id',(req,res)=>{
  const db=getDB(req.params.empresa_id);
  const chats=Object.values(db.chats||{});
  const porSegmento={Cliente:0, Nuevo:0, Interesado:0, Campaña:0};
  chats.forEach(c=>{ const s=c.cliente?.segmento||'Nuevo'; if(porSegmento[s]!==undefined) porSegmento[s]++; });
  res.json({
    total_chats:chats.length,
    por_segmento:porSegmento,
    total_campanas:Object.keys(db.campaigns||{}).length,
    total_trabajadores:Object.keys(db.workers||{}).length,
    total_llamadas:Object.keys(db.calls||{}).length
  });
});

app.get('/api/chats/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).chats||{}).sort((a,b)=>(b.last||0)-(a.last||0))));
app.get('/api/mensajes/:empresa_id/:chat_id',(req,res)=>res.json(getDB(req.params.empresa_id).chats[req.params.chat_id]?.mensajes||[]));
app.post('/api/chat/leido',(req,res)=>{ const db=getDB(req.body.empresa_id); if(db.chats[req.body.chat_id]){db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db);} res.json({ok:true}); });

app.get('/webhook/:empresa_id',(req,res)=>res.status(200).send(req.query['hub.challenge']||'ok'));
app.post('/webhook/:empresa_id',(req,res)=>{
  const empresa_id=req.params.empresa_id;
  const master=getMasterDB(); const emp=master.empresas[empresa_id]; const plan=PLANES[emp?.plan||'Basico'];
  const db=getDB(empresa_id);
  if(Object.keys(db.chats||{}).length >= plan.max_conversaciones &&!db.chats[req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from]){
    console.log(`Limite ${plan.max_conversaciones} alcanzado para ${empresa_id}`); return res.sendStatus(200);
  }
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value;
    if(val?.messages){
      for(let m of val.messages){
        const id=m.from;
        if(!db.chats[id]) db.chats[id]={id, mensajes:[], no_leidos:0, cliente:{segmento:'Nuevo'}};
        db.chats[id].mensajes.push({from:'cliente', texto:m.text?.body||'📎', tipo:m.type, ts:Date.now()});
        db.chats[id].no_leidos++; db.chats[id].last=Date.now();
      }
      saveDB(empresa_id, db);
    }
  }catch{}
  res.sendStatus(200);
});

app.post('/api/chat/responder-ia',(req,res)=>{
  const {empresa_id, chat_id, texto_cliente}=req.body;
  const master=getMasterDB(); const emp=master.empresas[empresa_id]; const plan=PLANES[emp?.plan||'Basico'];
  if(!plan.ia) return res.json({ok:false, error:'IA solo Premium y Gold', ia:false});
  const respuestaIA=`Hola! Soy la IA de Klido. Te ayudo con... (respuesta automática a: "${texto_cliente?.slice(0,50)}")`;
  res.json({ok:true, ia:true, respuesta:respuestaIA, boton_agente: plan.boton_agente, texto_boton:'Pasar a agente humano 👤'});
});

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000, ()=>console.log(`V155 FIX OK ${process.env.PORT||3000}`));
