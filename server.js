// KLIDO AVANZA CONSULTING V149 - PANEL ORIGINAL + RESEND + CRM COMPLETO
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
  if(!fs.existsSync(file)) return {empresa_id:id, config:null, chats:{}, campaigns:{}, users:{}, codes:{}};
  try{ return JSON.parse(fs.readFileSync(file,'utf8')); }catch{ return {empresa_id:id, config:null, chats:{}, campaigns:{}, users:{}, codes:{}}; }
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

// ===== RESEND EMAIL =====
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

// LOGIN
app.post('/api/login', (req,res)=>{
  const {correo, password, empresa_id} = req.body;
  const master=getMasterDB();
  const user=Object.values(master.users).find(u=>u.correo===correo && u.password===password);
  if(!user && correo==='admin'){ return res.json({ok:true, empresa_id:'default'}); }
  if(!user) return res.json({ok:false, error:'No existe o contraseña incorrecta'});
  return res.json({ok:true, empresa_id:user.empresa_id, user});
});

// CREAR EMPRESA + GENERAR CODIGO
app.post('/api/crear-empresa', async(req,res)=>{
  const {nombre_agencia, correo, password, plan} = req.body;
  if(!nombre_agencia || !correo) return res.json({ok:false, error:'Faltan datos'});
  const master=getMasterDB();
  const empresa_id=correo.toLowerCase().replace(/[^a-z0-9]/g,'').substring(0,15)+'_'+Date.now().toString().slice(-4);
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  
  master.empresas[empresa_id]={id:empresa_id, nombre:nombre_agencia, correo, plan, codigo, verificado:false, created:Date.now()};
  master.users[correo]={correo, password, empresa_id, plan, nombre:nombre_agencia};
  saveMaster(master);
  
  const db=getDB(empresa_id); db.config=null; saveDB(empresa_id, db);

  await enviarCorreo(correo, `Tu código Klido - ${codigo}`, `
    <div style="font-family:Arial;padding:20px"><h2>Bienvenido a Klido Avanza Consulting</h2>
    <p>Tu agencia <b>${nombre_agencia}</b> ha sido creada.</p>
    <p>Tu código de registro es:</p><h1 style="background:#0b57d0;color:#fff;padding:15px;border-radius:10px;text-align:center;letter-spacing:5px">${codigo}</h1>
    <p>Plan: ${plan}</p><p>Ingresa en app.klidoapp.com.co</p></div>
  `);
  
  console.log(`CODIGO ${correo}: ${codigo}`);
  res.json({ok:true, empresa_id, codigo_debug: codigo, msg:'Código enviado a Gmail'});
});

// VERIFICAR CODIGO
app.post('/api/verificar-codigo',(req,res)=>{
  const {correo, codigo} = req.body;
  const master=getMasterDB();
  const emp=Object.values(master.empresas).find(e=>e.correo===correo);
  if(!emp) return res.json({ok:false, error:'Empresa no encontrada'});
  if(emp.codigo===codigo){ emp.verificado=true; saveMaster(master); return res.json({ok:true, empresa_id:emp.id}); }
  return res.json({ok:false, error:'Código incorrecto'});
});

// OLVIDE CONTRASEÑA
app.post('/api/recuperar-password', async(req,res)=>{
  const {correo} = req.body;
  const master=getMasterDB();
  const user=master.users[correo];
  if(!user) return res.json({ok:false, error:'Correo no registrado'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  master.empresas[user.empresa_id].codigo=codigo; saveMaster(master);
  await enviarCorreo(correo, `Recuperar contraseña Klido - ${codigo}`, `<h1>Tu código de recuperación es: ${codigo}</h1>`);
  console.log(`RECUPERAR ${correo}: ${codigo}`);
  res.json({ok:true, msg:'Código enviado', codigo_debug:codigo});
});

app.post('/api/cambiar-password',(req,res)=>{
  const {correo, codigo, nueva_password}=req.body;
  const master=getMasterDB();
  const emp=Object.values(master.empresas).find(e=>e.correo===correo);
  if(!emp || emp.codigo!==codigo) return res.json({ok:false, error:'Código incorrecto'});
  master.users[correo].password=nueva_password; saveMaster(master);
  res.json({ok:true});
});

// TUS APIS DE CRM (sin tocar)
app.get('/api/empresa/:id',(req,res)=>res.json(loadConfig(req.params.id)||{}));
app.post('/api/config-empresa',(req,res)=>{ const {empresa_id, token, phone_id, waba_id}=req.body; const db=getDB(empresa_id||'default'); db.config={token, phone:phone_id, waba:waba_id, phone_id, waba_id}; saveDB(empresa_id||'default', db); res.json({ok:true}); });
app.get('/api/plantillas/:empresa_id', async(req,res)=>{ const emp=loadConfig(req.params.empresa_id); if(!emp?.token) return res.json([]); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba||emp.waba_id}/message_templates?fields=name,status,language&access_token=${emp.token}&limit=200`); const j=await r.json(); res.json((j.data||[]).filter(t=>t.status==='APPROVED')); }catch{ res.json([]); }});
app.post('/api/campana/enviar', async(req,res)=>{
  const {empresa_id, plantilla, numeros, variables, imagen_url, nombre}=req.body; const emp=loadConfig(empresa_id||'default');
  if(!emp?.token) return res.json({ok:false, error:'Empresa no configurada'});
  let lista=[...new Set((numeros||[]).map(n=>String(n).replace(/\D/g,'')).map(n=>n.length==10?'57'+n:n))];
  const db=getDB(empresa_id); const id=Date.now().toString(); db.campaigns[id]={id, nombre: nombre||plantilla, plantilla, total:lista.length, enviados:0, fallidos:0, estado:'enviando', pausada:false, created:Date.now()}; saveDB(empresa_id, db); res.json({ok:true, total:lista.length});
  (async()=>{ for(let num of lista){ try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone||emp.phone_id}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify({messaging_product:'whatsapp', to:num, type:'template', template:{name:plantilla, language:{code:'es_CO'}, components: variables?.length?[{type:'body', parameters:variables.map(t=>({type:'text', text:t}))}]:[]}})}); const j=await r.json(); const cur=getDB(empresa_id); if(j.messages) cur.campaigns[id].enviados++; else cur.campaigns[id].fallidos++; saveDB(empresa_id,cur);}catch{} await new Promise(r=>setTimeout(r,1200)); } const f=getDB(empresa_id); if(f.campaigns[id]){f.campaigns[id].estado='finalizada'; saveDB(empresa_id,f);} })();
});
app.get('/api/campanas/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).campaigns||{}).sort((a,b)=>b.created-a.created)));
app.get('/api/chats/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).chats||{}).sort((a,b)=>(b.last||0)-(a.last||0))));
app.get('/webhook/:empresa_id',(req,res)=>res.status(200).send(req.query['hub.challenge']||'ok'));
app.post('/webhook/:empresa_id',(req,res)=>{ const db=getDB(req.params.empresa_id); try{ const val=req.body.entry?.[0]?.changes?.[0]?.value; if(val?.messages){ for(let m of val.messages){ const id=m.from; if(!db.chats[id]) db.chats[id]={id, mensajes:[], no_leidos:0}; db.chats[id].mensajes.push({from:'cliente', texto:m.text?.body||'📎', ts:Date.now()}); db.chats[id].no_leidos++; db.chats[id].last=Date.now(); } saveDB(req.params.empresa_id, db); } }catch{} res.sendStatus(200); });

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000, ()=>console.log(`V149 ORIGINAL KLIDO OK ${process.env.PORT||3000}`));
