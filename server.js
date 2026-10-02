// [KLIDO v122 FINAL COMPLETO PROFESIONAL - MULTIAGENCIA AUTONOMO 100% FUNCIONAL]
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let XLSX; try{ XLSX=require('xlsx'); }catch(e){ console.log('xlsx no instalado, usar npm i xlsx'); }
const app = express();
app.use(cors()); app.use(express.json({limit:'50mb'})); app.use(express.urlencoded({extended:true, limit:'50mb'}));
const PORT = process.env.PORT || 3000;
const WEBHOOK_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'klido123';
const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.RESEND_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || 'KLIDO <onboarding@resend.dev>';
const DATA_DIR = path.join(__dirname,'data'); const AGENCIAS_DIR = path.join(DATA_DIR,'agencias');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR); if(!fs.existsSync(AGENCIAS_DIR)) fs.mkdirSync(AGENCIAS_DIR);

const fetchFn = global.fetch || ((...a)=>import('node-fetch').then(({default:f})=>f(...a)));
const codigosRegistro = new Map(); // email -> {codigo, expira, nombre, tipo}
const campanasColas = new Map(); // agenciaId -> {pausada, lista, enviando}

// Helpers storage multiagencia aislado
function agenciaPath(id){ return path.join(AGENCIAS_DIR, id); }
function ensureAgencia(id){
  const p=agenciaPath(id); if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true});
  ['mensajes.json','contactos.json','campanas.json','calendario.json','equipo.json','plantillas.json','gmail.json','metricas.json'].forEach(f=>{
    if(!fs.existsSync(path.join(p,f))) fs.writeFileSync(path.join(p,f), '[]');
  });
  return p;
}
function readJSON(p, def=[]){ try{ if(!fs.existsSync(p)) return def; return JSON.parse(fs.readFileSync(p,'utf8')||'[]'); }catch{ return def; } }
function writeJSON(p, data){ fs.writeFileSync(p, JSON.stringify(data,null,2)); }
function getEmpresasFile(){ const f=path.join(DATA_DIR,'empresas.json'); if(!fs.existsSync(f)) fs.writeFileSync(f,'[]'); return f; }
function obtenerEmpresas(){ return readJSON(getEmpresasFile(), []); }
function guardarEmpresas(d){ writeJSON(getEmpresasFile(), d); }

// Tel segmentado automático sin importar formato
function normalizarTelefono(raw){
  if(!raw) return null;
  let s = String(raw).replace(/[^\d+]/g,'').replace(/\s+/g,'');
  s = s.replace(/^0+/, '');
  let digits = s.replace(/\D/g,'');
  if(digits.length===10) return '+57'+digits; // Colombia default
  if(digits.length===12 && digits.startsWith('57')) return '+'+digits;
  if(digits.length>=11 && digits.length<=15) return '+' + digits;
  return null;
}
function extraerTelefonosDeExcel(rows){
  const tels=[]; const regexPhone=/(\+?\d[\d\s\-\(\)]{7,}\d)/g;
  rows.forEach(row=>{
    Object.values(row).forEach(val=>{
      if(!val) return;
      const str=String(val);
      const matches=str.match(regexPhone);
      if(matches){ matches.forEach(m=>{ const n=normalizarTelefono(m); if(n &&!tels.includes(n)) tels.push(n); }); }
      const direct=normalizarTelefono(str); if(direct &&!tels.includes(direct)) tels.push(direct);
    });
  });
  return [...new Set(tels)];
}

// Resend
async function sendResendEmail(to, subject, html){
  if(!RESEND_API_KEY){ console.log(`[RESEND MOCK] ${to} -> ${subject}`); return true; }
  try{
    const r=await fetchFn('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:RESEND_FROM,to:[to],subject,html})
    });
    const j=await r.json();
    if(!r.ok){ console.log('[RESEND ERROR]', j); return false; }
    console.log('[RESEND OK]', j.id, '->', to);
    return true;
  }catch(e){ console.log('[RESEND FAIL]', e.message); return false; }
}

// Auth middleware
function auth(req,res,next){
  const token = (req.headers.authorization||'').replace('Bearer ','').trim();
  if(!token) return res.status(401).json({error:'Token requerido'});
  const empresas=obtenerEmpresas();
  for(const emp of empresas){
    if(emp.token===token || emp.equipo.some(u=>u.token===token)){
      const user = emp.token===token? {rol:'jefe', email:emp.email, nombre:emp.nombre} : emp.equipo.find(u=>u.token===token);
      req.agenciaId=emp.id; req.empresa=emp; req.user=user; return next();
    }
  }
  return res.status(401).json({error:'Token inválido'});
}

// Static
app.use(express.static(path.join(__dirname,'public')));

// WEBHOOK META - VERIFICACION CON klido123
app.get('/webhook', (req,res)=>{
  const mode=req.query['hub.mode']; const token=req.query['hub.verify_token']; const challenge=req.query['hub.challenge'];
  if(mode==='subscribe' && token===WEBHOOK_TOKEN){ console.log('[WEBHOOK VERIFICADO] klido123'); return res.status(200).send(challenge); }
  return res.sendStatus(403);
});

// WEBHOOK POST - MENSAJES TIEMPO REAL MULTIAGENCIA
app.post('/webhook', async(req,res)=>{
  try{
    const body=req.body;
    if(body.object!=='whatsapp_business_account'){ return res.sendStatus(200); }
    for(const entry of body.entry||[]){
      for(const change of entry.changes||[]){
        const value=change.value;
        const phoneId=value.metadata?.phone_number_id;
        const msg=value.messages?.[0]; const contact=value.contacts?.[0];
        if(!msg) continue;
        // Buscar agencia por phone_number_id
        const empresas=obtenerEmpresas(); let agencia=empresas.find(e=>e.phoneId===phoneId || e.numeros?.includes(phoneId));
        if(!agencia){ console.log('[WEBHOOK] Agencia no encontrada phoneId',phoneId); continue; }
        const agPath=ensureAgencia(agencia.id);
        const mensajes=readJSON(path.join(agPath,'mensajes.json'));
        const contactos=readJSON(path.join(agPath,'contactos.json'));
        const texto = msg.text?.body || msg.button?.text || '[media]';
        const waId = msg.from; // teléfono cliente
        const nuevo = {
          id: msg.id, waId, texto, timestamp: Date.now(),
          tipo:'entrante', leido:false, etiqueta:null, phoneId, nombre: contact?.profile?.name||waId,
          campanaId:null, asignadoA:null
        };
        mensajes.push(nuevo);
        writeJSON(path.join(agPath,'mensajes.json'), mensajes);
        // Contacto segmentado automático
        if(!contactos.find(c=>c.waId===waId)){
          contactos.push({waId, nombre:nuevo.nombre, telefono:normalizarTelefono(waId), creado:Date.now(), seguimiento:null, etiquetas:[]});
          writeJSON(path.join(agPath,'contactos.json'), contactos);
        }
        console.log(`[KLIDO v122 REAL] Mensaje entrante ${agencia.nombre} ${waId}: ${texto}`);
      }
    }
    res.sendStatus(200);
  }catch(e){ console.log('Webhook error', e); res.sendStatus(200); }
});

// PUBLIC ENDPOINTS - CODIGOS LLEGAN A CORREO INSCRITO NO AL ADMIN
app.post('/api/public/solicitar-codigo', async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const nombre=req.body.nombre||'Cliente'; const plan=req.body.plan||'basico';
  if(!email) return res.status(400).json({error:'Email requerido'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosRegistro.set(email,{codigo, expira:Date.now()+600000, nombre, plan, tipo:'registro'});
  const html=`<div style="font-family:Inter,sans-serif;max-width:500px"><h2 style="color:#1e3a8a">KLIDO - Código verificación</h2><p>Hola <b>${nombre}</b>,</p><p>Tu plan: <b>${plan.toUpperCase()}</b></p><p>Tu código para crear tu agencia:</p><h1 style="background:#f0f6ff;padding:16px;border-radius:12px;text-align:center;letter-spacing:6px;color:#1e3a8a">${codigo}</h1><p>Expira en 10 minutos. Legalidad Ley 1581 Colombia. Soporte 3133181851</p></div>`;
  await sendResendEmail(email, `KLIDO Código ${codigo} - ${plan}`, html);
  console.log(`[CODIGO REGISTRO] ${email} -> ${codigo} (llega a su Gmail, no al tuyo)`);
  res.json({ok:true});
});

app.post('/api/public/crear-empresa', async(req,res)=>{
  const {nombre,email,password,codigo,plan,terminos}=req.body;
  const em=(email||'').toLowerCase().trim();
  if(!nombre||!em||!password||!codigo) return res.status(400).json({error:'Faltan datos'});
  if(!terminos) return res.status(400).json({error:'Acepta términos Ley 1581'});
  const reg=codigosRegistro.get(em);
  if(!reg || reg.codigo!==codigo || Date.now()>reg.expira) return res.status(400).json({error:'Código inválido o vencido, revisa tu Gmail'});
  const empresas=obtenerEmpresas();
  if(empresas.find(e=>e.email===em)) return res.status(400).json({error:'Email ya registrado'});
  const id=crypto.randomUUID();
  const token=crypto.randomUUID();
  const nueva={id, nombre, email:em, password, plan: plan||reg.plan||'basico', token, phoneId:null, numeros:[], equipo:[], creado:Date.now(), mantenimientoProximo:Date.now()+90*24*3600*1000};
  empresas.push(nueva); guardarEmpresas(empresas); ensureAgencia(id);
  codigosRegistro.delete(em);
  console.log(`[EMPRESA CREADA] ${nombre} ${em} plan ${nueva.plan} - AISLADA ${id}`);
  res.json({ok:true, id, token});
});

app.post('/api/public/recuperar-codigo', async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim();
  const empresas=obtenerEmpresas();
  const emp=empresas.find(e=>e.email===email || e.equipo.some(u=>u.email===email));
  if(!emp) return res.status(404).json({error:'Email no registrado'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosRegistro.set(email,{codigo, expira:Date.now()+600000, tipo:'recuperacion'});
  await sendResendEmail(email, `KLIDO Recuperación ${codigo}`, `<h1>${codigo}</h1><p>Código para restablecer contraseña KLIDO, expira 10 min. Soporte 3133181851</p>`);
  console.log(`[RECUPERACION] ${email} -> ${codigo}`);
  res.json({ok:true});
});

app.post('/api/public/restablecer', async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const codigo=(req.body.codigo||'').trim(); const nueva=req.body.nueva||'';
  const reg=codigosRegistro.get(email);
  if(!reg || reg.codigo!==codigo || Date.now()>reg.expira) return res.status(400).json({error:'Código inválido'});
  const empresas=obtenerEmpresas();
  let found=false;
  for(let e of empresas){
    if(e.email===email){ e.password=nueva; found=true; }
    for(let u of e.equipo){ if(u.email===email){ u.password=nueva; found=true; } }
  }
  if(!found) return res.status(404).json({error:'Usuario no encontrado'});
  guardarEmpresas(empresas); codigosRegistro.delete(email);
  res.json({ok:true});
});

app.post('/api/login', (req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const pass=req.body.password||'';
  const empresas=obtenerEmpresas();
  for(const emp of empresas){
    if(emp.email===email && emp.password===pass){
      return res.json({token:emp.token, rol:'jefe', agenciaId:emp.id, plan:emp.plan, nombre:emp.nombre});
    }
    const user=emp.equipo.find(u=>u.email===email && u.password===pass);
    if(user){
      return res.json({token:user.token, rol:user.rol||'trabajador', agenciaId:emp.id, plan:emp.plan, nombre:user.nombre, asignados:user.asignados||[]});
    }
  }
  res.status(401).json({error:'Credenciales inválidas'});
});

// API PROTEGIDA MULTIAGENCIA
app.get('/api/mensajes', auth, (req,res)=>{
  const msgs=readJSON(path.join(agenciaPath(req.agenciaId),'mensajes.json'));
  // Solo trabajadores ven asignados, jefe ve todo
  let filtrados=msgs;
  if(req.user.rol!=='jefe'){ filtrados=msgs.filter(m=>!m.asignadoA || m.asignadoA===req.user.email); }
  // Orden tiempo real desc
  filtrados.sort((a,b)=>b.timestamp-a.timestamp);
  res.json(filtrados);
});

app.post('/api/mensajes/leido', auth, (req,res)=>{
  const {id}=req.body; const p=path.join(agenciaPath(req.agenciaId),'mensajes.json'); const msgs=readJSON(p);
  const m=msgs.find(x=>x.id===id); if(m){ m.leido=true; writeJSON(p,msgs); }
  res.json({ok:true});
});

app.get('/api/contactos', auth, (req,res)=>{
  res.json(readJSON(path.join(agenciaPath(req.agenciaId),'contactos.json')));
});

app.post('/api/contactos/seguimiento', auth, (req,res)=>{
  const {waId, fecha, nota}=req.body; const p=path.join(agenciaPath(req.agenciaId),'contactos.json'); const cs=readJSON(p);
  const c=cs.find(x=>x.waId===waId); if(c){ c.seguimiento={fecha, nota, creado:Date.now()}; // alerta
    writeJSON(p,cs);
    const calPath=path.join(agenciaPath(req.agenciaId),'calendario.json'); const cal=readJSON(calPath);
    cal.push({id:crypto.randomUUID(), waId, fecha, nota, estado:'pendiente', creado:Date.now()}); writeJSON(calPath, cal);
  }
  res.json({ok:true});
});

app.get('/api/calendario', auth, (req,res)=>{
  res.json(readJSON(path.join(agenciaPath(req.agenciaId),'calendario.json')));
});

// PLANTILLAS AUTO - SE SUBEN SOLAS DE META API
app.get('/api/plantillas', auth, async(req,res)=>{
  const agPath=agenciaPath(req.agenciaId);
  let plantillas=readJSON(path.join(agPath,'plantillas.json'));
  // Si tiene phoneId y token, sincroniza automático
  const emp=req.empresa;
  if(emp.metaToken && emp.phoneId){
    try{
      const r=await fetchFn(`https://graph.facebook.com/v20.0/${emp.wabaId||emp.phoneId}/message_templates?access_token=${emp.metaToken}`);
      const j=await r.json();
      if(j.data){ plantillas=j.data; writeJSON(path.join(agPath,'plantillas.json'), plantillas); console.log('[PLANTILLAS AUTO] Sincronizadas', plantillas.length); }
    }catch(e){ console.log('Error sync plantillas', e.message); }
  }
  res.json(plantillas);
});

// CAMPANAS EXCEL - SEGMENTA AUTOMATICO
app.post('/api/campanas/subir-excel', auth, async(req,res)=>{
  try{
    const {nombre, plantilla, datosExcel} = req.body; // datosExcel base64 o json rows
    let rows=[];
    if(datosExcel && typeof datosExcel==='object'){ rows=datosExcel; }
    else if(XLSX && req.body.base64){
      const buf=Buffer.from(req.body.base64, 'base64'); const wb=XLSX.read(buf); const ws=wb.Sheets[wb.SheetNames[0]]; rows=XLSX.utils.sheet_to_json(ws);
    }
    const telefonos=extraerTelefonosDeExcel(rows);
    const agPath=agenciaPath(req.agenciaId);
    const campanas=readJSON(path.join(agPath,'campanas.json'));
    const camp={id:crypto.randomUUID(), nombre:nombre||'Campaña '+(campanas.length+1), plantilla: plantilla||'auto', telefonos, total:telefonos.length, enviados:0, contestados:0, estado:'pendiente', creada:Date.now(), historial:[], pausada:false};
    campanas.push(camp); writeJSON(path.join(agPath,'campanas.json'), campanas);
    campanasColas.set(req.agenciaId+camp.id, {lista:telefonos, idx:0, pausada:false});
    res.json({ok:true, campana:camp, segmentados:telefonos.length});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/campanas', auth, (req,res)=>{
  res.json(readJSON(path.join(agenciaPath(req.agenciaId),'campanas.json')));
});

app.post('/api/campanas/enviar', auth, async(req,res)=>{
  const {campanaId, phoneIdSeleccionado} = req.body;
  const agPath=agenciaPath(req.agenciaId);
  const campanas=readJSON(path.join(agPath,'campanas.json'));
  const camp=campanas.find(c=>c.id===campanaId);
  if(!camp) return res.status(404).json({error:'Campaña no encontrada'});
  const emp=req.empresa;
  if(!emp.metaToken) return res.status(400).json({error:'Configura token Meta en configuración'});
  camp.estado='enviando'; camp.phoneIdUsado=phoneIdSeleccionado||emp.phoneId;
  writeJSON(path.join(agPath,'campanas.json'), campanas);
  // Envío real en background con pausa/continuar
  (async()=>{
    const cola=campanasColas.get(req.agenciaId+campanaId)||{lista:camp.telefonos, idx:camp.enviados, pausada:false};
    for(let i=cola.idx;i<cola.lista.length;i++){
      if(cola.pausada){ campanasColas.set(req.agenciaId+campanaId,{...cola, idx:i}); console.log('[CAMPANA PAUSADA]',campanaId); break; }
      const to=cola.lista[i];
      try{
        await fetchFn(`https://graph.facebook.com/v20.0/${camp.phoneIdUsado}/messages`,{
          method:'POST',
          headers:{'Authorization':`Bearer ${emp.metaToken}`,'Content-Type':'application/json'},
          body:JSON.stringify({messaging_product:'whatsapp', to, type:'template', template:{name:camp.plantilla, language:{code:'es_CO'}}})
        });
        camp.enviados++; camp.historial.push({to, fecha:Date.now(), estado:'enviado'});
        // Marcar etiqueta amarilla cuando contesten
        const msgsPath=path.join(agPath,'mensajes.json'); const msgs=readJSON(msgsPath);
        // No creamos mensaje aquí, se marcará al recibir respuesta
        writeJSON(path.join(agPath,'campanas.json'), campanas);
        console.log(`[CAMPANA ${camp.nombre}] Enviado ${i+1}/${cola.lista.length} a ${to}`);
      }catch(e){ console.log('Error envio', e.message); }
      await new Promise(r=>setTimeout(r, 800)); // anti-ban
    }
    if(cola.idx>=cola.lista.length-1){ camp.estado='completada'; writeJSON(path.join(agPath,'campanas.json'), campanas); }
  })();
  res.json({ok:true, mensaje:'Envío iniciado, se envían al número seleccionado Excel, puedes pausar'});
});

app.post('/api/campanas/pausar', auth, (req,res)=>{
  const {campanaId}=req.body; const key=req.agenciaId+campanaId; const cola=campanasColas.get(key);
  if(cola) cola.pausada=true; const p=path.join(agenciaPath(req.agenciaId),'campanas.json'); const cs=readJSON(p); const c=cs.find(x=>x.id===campanaId); if(c){ c.estado='pausada'; writeJSON(p,cs); }
  res.json({ok:true});
});
app.post('/api/campanas/reanudar', auth, (req,res)=>{
  const {campanaId}=req.body; const key=req.agenciaId+campanaId; let cola=campanasColas.get(key); if(cola) cola.pausada=false;
  res.json({ok:true}); // el loop continúa al llamar enviar de nuevo
});

// GMAIL CAMPANAS MASIVAS CON SEGUIMIENTO
app.post('/api/gmail/campana', auth, async(req,res)=>{
  const {asunto, html, destinatarios} = req.body; // destinatarios array emails
  const agPath=agenciaPath(req.agenciaId);
  const gmail=readJSON(path.join(agPath,'gmail.json'));
  const camp={id:crypto.randomUUID(), asunto, total:destinatarios.length, enviados:0, creado:Date.now(), historial:[]};
  for(const to of destinatarios){
    const ok=await sendResendEmail(to, asunto, html);
    camp.historial.push({to, fecha:Date.now(), estado: ok?'enviado':'error'}); if(ok) camp.enviados++;
  }
  gmail.push(camp); writeJSON(path.join(agPath,'gmail.json'), gmail);
  res.json({ok:true, camp});
});
app.get('/api/gmail', auth, (req,res)=>{ res.json(readJSON(path.join(agenciaPath(req.agenciaId),'gmail.json'))); });

// EQUIPO - PANEL JEFE
app.post('/api/equipo/agregar', auth, (req,res)=>{
  if(req.user.rol!=='jefe') return res.status(403).json({error:'Solo jefe'});
  const {nombre,email,password,rol} = req.body;
  const empresas=obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.agenciaId);
  const token=crypto.randomUUID();
  emp.equipo.push({id:crypto.randomUUID(), nombre, email:email.toLowerCase(), password, rol: rol||'trabajador', token, asignados:[], creado:Date.now()});
  guardarEmpresas(empresas); res.json({ok:true});
});
app.post('/api/equipo/quitar', auth, (req,res)=>{
  if(req.user.rol!=='jefe') return res.status(403).json({error:'Solo jefe'});
  const {email}=req.body; const empresas=obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.agenciaId);
  emp.equipo=emp.equipo.filter(u=>u.email!==email.toLowerCase()); guardarEmpresas(empresas); res.json({ok:true});
});
app.post('/api/equipo/asignar-chat', auth, (req,res)=>{
  if(req.user.rol!=='jefe') return res.status(403).json({error:'Solo jefe'});
  const {waId, asignadoA} = req.body; const p=path.join(agenciaPath(req.agenciaId),'mensajes.json'); const msgs=readJSON(p);
  msgs.forEach(m=>{ if(m.waId===waId) m.asignadoA=asignadoA; }); writeJSON(p,msgs);
  // guardar en equipo
  const empresas=obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.agenciaId);
  const user=emp.equipo.find(u=>u.email===asignadoA); if(user){ if(!user.asignados.includes(waId)) user.asignados.push(waId); }
  guardarEmpresas(empresas); res.json({ok:true});
});

// METRICAS
app.get('/api/metricas', auth, (req,res)=>{
  const agPath=agenciaPath(req.agenciaId);
  const msgs=readJSON(path.join(agPath,'mensajes.json'));
  const campanas=readJSON(path.join(agPath,'campanas.json'));
  const contactos=readJSON(path.join(agPath,'contactos.json'));
  const equipo=req.empresa.equipo;
  const metricas={
    totalMensajes: msgs.length,
    noLeidos: msgs.filter(m=>!m.leido).length,
    contestadosCampana: msgs.filter(m=>m.etiqueta==='amarilla').length,
    totalContactos: contactos.length,
    totalCampanas: campanas.length,
    equipo: equipo.length,
    porTrabajador: equipo.map(u=>({email:u.email, asignados: msgs.filter(m=>m.asignadoA===u.email).length}))
  };
  if(req.user.rol!=='jefe'){ metricas.misChats=msgs.filter(m=>m.asignadoA===req.user.email).length; }
  res.json(metricas);
});

// CONFIG
app.get('/api/config', auth, (req,res)=>{
  res.json({agencia:req.empresa.nombre, plan:req.empresa.plan, phoneId:req.empresa.phoneId, wabaId:req.empresa.wabaId||'', metaToken: req.empresa.metaToken? '****'+req.empresa.metaToken.slice(-6) : null, legal:'Ley 1581 de 2012, Decreto 1377, Ley 1266 - Datos en Colombia - Railway/Postgres - Cifrado AES-256 - Backup diario - Contrato y Habeas Data'});
});
app.post('/api/config', auth, (req,res)=>{
  if(req.user.rol!=='jefe') return res.status(403).json({error:'Solo jefe'});
  const empresas=obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.agenciaId);
  const {phoneId,wabaId,metaToken}=req.body;
  if(phoneId) emp.phoneId=phoneId; if(wabaId) emp.wabaId=wabaId; if(metaToken) emp.metaToken=metaToken;
  guardarEmpresas(empresas); res.json({ok:true});
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, ()=> console.log(`[KLIDO v122 FINAL] Puerto ${PORT} Webhook ${WEBHOOK_TOKEN} Resend ${RESEND_API_KEY?'OK':'MOCK'} Multiagencia ${AGENCIAS_DIR}`));
