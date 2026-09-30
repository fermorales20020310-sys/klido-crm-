require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// --- PRENDE DE UNA, ANTES DE TODO ---
const PORT = process.env.PORT || 3000;
app.get('/health', (req,res) => res.status(200).send('ok'));
app.get('/api/health', (req,res) => res.json({ ok:true, railpack:true, time: new Date().toISOString() }));

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Klido escuchando en ${PORT} - Railpack OK`));

// --- AHORA SI CARGA LO PESADO, DESPUES DE PRENDER ---
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const xlsx = require('xlsx');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const io = new Server(server, { cors: { origin: "*" } });
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

process.on('uncaughtException', e => console.log('No tumba:', e.message));
process.on('unhandledRejection', e => console.log('No tumba:', e?.message));

const JWT_SECRET = process.env.JWT_SECRET || 'klido_secret';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || process.env.APP_SECRET || 'klido_verify_123';
const ADMIN_KEY = process.env.ADMIN_KEY || 'klido_admin_2026';
const WABA_ID = process.env.WABA_ID || process.env.DEFAULT_AGENCY || '';
const PHONE_ID = process.env.PHONE_NUMBER_ID || '';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const GRAPH = process.env.GRAPH_VERSION || 'v20.0';

let empresas=[], codigos={}, mensajes={}, contactos={}, campanas=[], plantillas=[];

async function enviarCorreo(to, subject, html){
  try{
    if(!process.env.RESEND_API_KEY) return false;
    await axios.post('https://api.resend.com/emails',{
      from: process.env.RESEND_FROM || 'Klido <onboarding@resend.dev>',
      to: [to], subject, html
    },{ headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json' }});
    return true;
  }catch(e){ console.log('Resend:', e.response?.data || e.message); return false; }
}

async function syncPlantillas(){
  if(!WHATSAPP_TOKEN ||!WABA_ID) return;
  try{
    const r = await axios.get(`https://graph.facebook.com/${GRAPH}/${WABA_ID}/message_templates`,{ headers:{ Authorization:`Bearer ${WHATSAPP_TOKEN}` }});
    plantillas = (r.data.data||[]).filter(t=>t.status==='APPROVED');
    console.log('Plantillas:', plantillas.length);
  }catch{}
}
setTimeout(syncPlantillas, 3000);
setInterval(syncPlantillas, 5*60*1000);

function auth(req,res,next){
  try{
    const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'});
    const dec=jwt.verify(h.replace('Bearer ',''), JWT_SECRET);
    const emp=empresas.find(e=>e.id===dec.id); if(!emp) return res.status(401).json({error:'No existe'});
    if(!emp.activo) return res.status(403).json({error:'PLAN BLOQUEADO - Debes pagar', bloqueado:true, codigo:emp.codigoPlan});
    if(emp.expira && new Date() > new Date(emp.expira)){ emp.activo=false; return res.status(403).json({error:'PLAN VENCIDO', bloqueado:true});}
    req.user=dec; next();
  }catch{ return res.status(401).json({error:'Token invalido'});}
}

app.get('/api/legal/terminos',(req,res)=>res.json({texto:'Solo enviar a contactos con consentimiento previo. Prohibido spam. Cumple Ley 1581 Colombia.'}));
app.get('/api/legal/privacidad',(req,res)=>res.json({texto:'No vendemos datos. Solo telefono, nombre, mensajes.'}));

app.post('/api/empresas/crear', async (req,res)=>{
  try{
    const {nombre, correo, password, plan, aceptoTerminos}=req.body;
    if(!aceptoTerminos) return res.status(400).json({error:'Acepta terminos'});
    if(empresas.find(e=>e.correo===correo)) return res.status(400).json({error:'Correo ya existe'});
    const hash=await bcrypt.hash(password,10);
    const codigo=`KLIDO-${(plan||'basico').toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const esPago=['pro','premium','enterprise'].includes((plan||'').toLowerCase());
    const emp={ id:uuidv4(), nombre, correo, passwordHash:hash, plan:(plan||'basico').toLowerCase(), codigoPlan:codigo, activo: esPago?false:true, expira:new Date(Date.now()+(esPago?0:7)*24*60*60*1000)};
    empresas.push(emp); contactos[emp.id]=[]; mensajes[emp.id]={};
    res.json({ok:true, empresa:emp, msg: esPago?'BLOQUEADA hasta pago':'Activa 7 dias'});
  }catch(e){ res.status(500).json({error:e.message});}
});

app.post('/api/login', async (req,res)=>{
  try{
    const {correo,password}=req.body; const emp=empresas.find(e=>e.correo===correo);
    if(!emp) return res.status(404).json({error:'No existe'});
    if(!(await bcrypt.compare(password, emp.passwordHash))) return res.status(401).json({error:'Pass mal'});
    if(!emp.activo) return res.status(403).json({error:'PLAN BLOQUEADO', bloqueado:true, codigo:emp.codigoPlan});
    const token=jwt.sign({id:emp.id}, JWT_SECRET, {expiresIn:'12h'});
    res.json({ok:true, token, empresa:emp});
  }catch(e){ res.status(500).json({error:e.message});}
});

app.post('/api/admin/activar-plan',(req,res)=>{
  if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'No auth'});
  const emp=empresas.find(e=>e.correo===req.body.correo); if(!emp) return res.status(404).json({error:'No existe'});
  emp.activo=true; emp.expira=new Date(Date.now()+(req.body.dias||30)*24*60*60*1000);
  res.json({ok:true, empresa:emp});
});

app.post('/api/recuperar/enviar', async (req,res)=>{
  const code=Math.floor(100000+Math.random()*900000).toString();
  codigos[req.body.correo]={code, expires:Date.now()+15*60*1000};
  await enviarCorreo(req.body.correo,'Klido - Codigo', `<h2>${code}</h2><p>Expira 15 min</p>`);
  console.log('CODIGO',req.body.correo,code); res.json({ok:true});
});
app.post('/api/recuperar/cambiar', async (req,res)=>{
  const d=codigos[req.body.correo]; if(!d||d.code!==req.body.code||Date.now()>d.expires) return res.status(400).json({error:'Codigo invalido'});
  const emp=empresas.find(e=>e.correo===req.body.correo); emp.passwordHash=await bcrypt.hash(req.body.nuevaPassword,10); delete codigos[req.body.correo]; res.json({ok:true});
});

app.get('/api/inbox', auth, (req,res)=> res.json(contactos[req.user.id]||[]));
app.get('/api/mensajes/:tel', auth, (req,res)=> res.json(mensajes[req.user.id]?.[req.params.tel]||[]));
app.post('/api/mensajes/enviar', auth, async (req,res)=>{
  const {telefono,contenido}=req.body; if(!mensajes[req.user.id]) mensajes[req.user.id]={}; if(!mensajes[req.user.id][telefono]) mensajes[req.user.id][telefono]=[];
  mensajes[req.user.id][telefono].push({de:'yo', contenido, fecha:new Date()});
  if(WHATSAPP_TOKEN && PHONE_ID){ try{ await axios.post(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`,{messaging_product:'whatsapp',to:telefono,type:'text',text:{body:contenido}},{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}});}catch{}}
  io.to(req.user.id).emit('nuevo_mensaje_cliente',{telefono}); res.json({ok:true});
});

app.post('/webhook',(req,res)=>{ try{ const e=req.body.entry?.[0]?.changes?.[0]?.value; if(e?.messages){ const tel=e.messages[0].from; const txt=e.messages[0].text?.body||`[${e.messages[0].type}]`; const empId=empresas[0]?.id; if(empId){ if(!mensajes[empId])mensajes[empId]={}; if(!mensajes[empId][tel])mensajes[empId][tel]=[]; mensajes[empId][tel].push({de:'cliente',contenido:txt,fecha:new Date()}); let c=contactos[empId].find(x=>x.telefono===tel); if(!c){c={id:uuidv4(),telefono:tel,nombre:e.contacts?.[0]?.profile?.name||tel,noLeido:true}; contactos[empId].unshift(c);} io.to(empId).emit('nuevo_mensaje_cliente',{telefono:tel});}} }catch{} res.sendStatus(200);});
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']===VERIFY_TOKEN) res.send(req.query['hub.challenge']); else res.sendStatus(403);});

const upload=multer({dest:'uploads/'});
app.post('/api/campanas/upload', auth, upload.single('file'), (req,res)=>{
  try{
    const wb=xlsx.readFile(req.file.path); const data=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const tels=data.map(r=>{ const v=Object.values(r).find(v=>String(v).replace(/\D/g,'').length>=10); return v?String(v).replace(/\D/g,''):null;}).filter(Boolean).map(t=>t.length===10?'57'+t:t);
    if(!contactos[req.user.id])contactos[req.user.id]=[]; const ids=[];
    tels.forEach(t=>{ let c=contactos[req.user.id].find(x=>x.telefono===t); if(!c){c={id:uuidv4(),telefono:t,nombre:t,esCampana:true}; contactos[req.user.id].push(c);} ids.push(c.id);});
    fs.unlinkSync(req.file.path); res.json({ok:true, detectados:tels.length, contactos_ids:ids});
  }catch(e){ res.status(500).json({error:e.message});}
});

app.post('/api/campanas/enviar', auth, async (req,res)=>{
  try{
    if(!req.body.aceptoLegal) return res.status(400).json({error:'Acepta legalidad'});
    if(!WHATSAPP_TOKEN ||!PHONE_ID) return res.status(400).json({error:'Falta WHATSAPP_TOKEN o PHONE_ID'});
    const plantillaReal=plantillas.find(p=>p.name===req.body.plantilla)||plantillas[0]; if(!plantillaReal) return res.status(400).json({error:'Sin plantillas aprobadas'});
    const tels=req.body.contactos_ids.map(id=>(contactos[req.user.id]||[]).find(x=>x.id===id)?.telefono).filter(Boolean);
    const camp={id:uuidv4(), empresaId:req.user.id, nombre:plantillaReal.name, total:tels.length, enviados:0, estado:'en_proceso'};
    campanas.push(camp); let idx=0;
    const bloque=async()=>{
      const lote=tels.slice(idx,idx+50); if(lote.length===0){camp.estado='completado'; return;}
      for(let tel of lote){ try{ await axios.post(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`,{messaging_product:'whatsapp',to:tel,type:'template',template:{name:plantillaReal.name,language:{code:plantillaReal.language||'es_CO'}}},{headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}}); camp.enviados++; }catch{} await new Promise(r=>setTimeout(r,700));}
      idx+=50; io.to(req.user.id).emit('campana_update',camp); if(idx<tels.length) setTimeout(bloque, 5*60*60*1000);
    }; bloque(); res.json({ok:true, campana:camp});
  }catch(e){ res.status(500).json({error:e.message});}
});

app.get('/api/campanas', auth,(req,res)=> res.json(campanas.filter(c=>c.empresaId===req.user.id)));
app.get('/api/plantillas',(req,res)=> res.json(plantillas));
app.get('/api/templates',(req,res)=> res.json(plantillas.map(p=>({nombre:p.name}))));

io.on('connection', s=>{ s.on('join_empresa', id=>s.join(id));});
app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
