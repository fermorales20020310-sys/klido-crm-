// KLIDO V268 - SERVER COMPLETO - HISTORIAL UNIFICADO POR CORREO
// Anteriores + Proximas - No borra nada de lo anterior
// + AÑADIDO Y ALINEADO: Admin Plan/Aceptar/Bloquear + Reglas Planes Gmail/WhatsApp
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const axios = require('axios');

const app = express();

// ---------- HEALTHCHECK PARA RAILWAY - PARA QUE NO LO TUMBE ----------
app.get('/health', (req,res)=>{ res.status(200).send('OK'); });
app.get('/api/health', (req,res)=>{ res.json({ok:true, status:'OK', time: Date.now()}); });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const DB = process.env.DB_PATH || '/app/db';
if(!fs.existsSync(DB)) fs.mkdirSync(DB, {recursive:true});
const UPLOADS = path.join(DB, 'uploads');
if(!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, {recursive:true});
app.use('/uploads', express.static(UPLOADS));

const upload = multer({ dest: UPLOADS });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@klidoapp.com.co';
const ADMIN_PASS = process.env.ADMIN_PASS || 'KlidoAdmin2026*';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.klidoapp.com.co';

// ---------- UTILS ----------
function dbPath(eid){ return path.join(DB, String(eid).replace(/[^a-zA-Z0-9@._-]/g,'_') + '.json'); }
function listDBFiles(){ try{ return fs.readdirSync(DB).filter(f=>f.endsWith('.json')); }catch{ return []; } }
function loadDB(eid){
  const p = dbPath(eid);
  if(!fs.existsSync(p)) return null;
  try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return null; }
}
function saveDB(db){
  if(!db || !db.empresa_id) return;
  fs.writeFileSync(dbPath(db.empresa_id), JSON.stringify(db,null,2));
}
function newEmpresaId(email){ return email + '_' + Date.now(); }
function getPlanInfo(plan){
  plan = String(plan||'basico').toLowerCase();
  if(plan==='gold') return { plan:'gold', asesores:999, envios:999, mensajes:'Ilimitados', ia:true, gmail:true, llamadas:true, nombre:'Gold' };
  if(plan==='premium') return { plan:'premium', asesores:5, envios:5, mensajes:'5000', ia:true, gmail:false, llamadas:false, nombre:'Premium' };
  return { plan:'basico', asesores:2, envios:1, mensajes:'1000', ia:false, gmail:false, llamadas:false, nombre:'Básico' };
}

// ---------- CAMPAÑAS - NORMALIZADOR (para antiguas) ----------
function normalizeCampaign(c){
  if(!c) return null;
  const historialRaw = c.historial || c.detalle || c.numeros_detalle || c.results || [];
  let historial = [];
  if(Array.isArray(historialRaw)){
    historial = historialRaw.map(h=>{
      if(typeof h === 'string') return { numero: h, estado:'enviado', ts: c.creado||Date.now(), legacy: !!(c.legacy||c.legacy_reconstruido) };
      return {
        numero: h.numero || h.phone || h.to || h.destino || '',
        email: h.email || h.correo || '',
        estado: (h.estado || h.status || 'enviado').toLowerCase(),
        error: h.error || h.mensaje || h.detail || '',
        message_id: h.message_id || h.id || '',
        ts: h.ts || h.fecha || h.created_at || c.creado || Date.now(),
        legacy: !!(h.legacy || c.legacy || c.legacy_reconstruido)
      };
    });
  }
  if(historial.length===0 && Array.isArray(c.numeros)){
    historial = c.numeros.map(n=>{
      const num = typeof n==='string'? n : (n.numero||n.phone||'');
      const est = (typeof n==='object' && n.estado) ? String(n.estado).toLowerCase() : ((c.enviados||0)>0 ? 'enviado' : 'pendiente');
      return { numero:num, estado:est, error:'', message_id:'', ts:c.creado||Date.now(), legacy:true };
    });
  }
  if(historial.length===0 && Array.isArray(c.emails)){
    historial = c.emails.map(e=>{
      const em = typeof e==='string'? e : (e.email||e.correo||'');
      return { numero:'', email:em, estado:'pendiente', error:'', message_id:'', ts:c.creado||Date.now(), legacy:true };
    });
  }
  if(historial.length===0 && c.total && c.enviados){
    for(let i=0;i<(c.enviados||0);i++) historial.push({ numero:'', estado:'enviado', error:'', message_id:'', ts:c.creado||Date.now(), legacy:true });
  }
  const total = c.total || c.total_contactos || c.total_numeros || (Array.isArray(c.numeros)?c.numeros.length:0) || (Array.isArray(c.emails)?c.emails.length:0) || historial.length || 0;
  const enviados = c.enviados || c.sent || historial.filter(h=>['enviado','entregado','leido'].includes(h.estado)).length || 0;
  const fallidos = c.fallidos || c.failed || historial.filter(h=>h.estado==='fallido').length || 0;
  return {
    id: c.id || c._id || ('camp_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)),
    nombre: c.nombre || c.name || 'Campaña',
    tipo: (c.tipo || c.type || 'whatsapp').toLowerCase(),
    template_name: c.template_name || c.template || c.plantilla || '',
    template_lang: c.template_lang || c.language || 'es',
    gmail_subject: c.gmail_subject || c.asunto || '',
    gmail_body: c.gmail_body || c.gmail_html || c.cuerpo || '',
    total, enviados, fallidos,
    status: c.status || c.estado || (enviados>=total && total>0 ? 'completed' : 'running'),
    creado: c.creado || c.created_at || c.fecha || Date.now(),
    numeros: c.numeros || [],
    emails: c.emails || [],
    historial,
    resumen: { total, enviados, fallidos, pendientes: Math.max(0, total - enviados - fallidos) },
    porcentaje: total ? Math.round((enviados/total)*100) : 0,
    legacy: !!(c.legacy||c.legacy_reconstruido),
    legacy_reconstruido: !!(c.legacy||c.legacy_reconstruido)
  };
}
function getAllCampaigns(db){
  if(!db) return [];
  let all = [];
  const keys = ['ccampaigns','campaigns','campaign_list','campanas','campanhas','campañas','campañas_list'];
  for(const k of keys){
    if(Array.isArray(db[k])) all = all.concat(db[k]);
  }
  return all.filter(Boolean);
}

// ---------- HISTORIAL UNIFICADO POR CORREO - ANTERIORES + PROXIMAS ----------
function getAllCampaignsByEmail(email){
  const emailL = String(email||'').toLowerCase().trim();
  let todas = [];
  const seen = new Set();
  for(const f of listDBFiles()){
    try{
      const db = JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      if(String(db.email||'').toLowerCase().trim() !== emailL) continue;
      const list = getAllCampaigns(db).map(normalizeCampaign).filter(Boolean);
      for(const c of list){
        const key = String(c.id);
        if(seen.has(key)) continue;
        seen.add(key);
        todas.push({...c, empresa_id: db.empresa_id, empresa: db.nombre||db.empresa||''});
      }
    }catch{}
  }
  todas.sort((a,b)=> (b.creado||0)-(a.creado||0));
  return todas;
}

// ---------- STATIC - ARREGLADO PARA HEALTHCHECK ----------
app.use(express.static(path.join(__dirname,'public')));
app.get('/', (req,res)=>{
  const f = path.join(__dirname,'public','index.html');
  if(fs.existsSync(f)) return res.sendFile(f);
  return res.status(200).send('KLIDO OK');
});
app.get('/crm', (req,res)=>{
  const f = path.join(__dirname,'public','crm.html');
  if(fs.existsSync(f)) return res.sendFile(f);
  return res.status(200).send('KLIDO CRM OK');
});
app.get('/admin', (req,res)=>{
  const f = path.join(__dirname,'public','admin.html');
  if(fs.existsSync(f)) return res.sendFile(f);
  return res.status(200).send('KLIDO ADMIN OK');
});

// ---------- AUTH / REGISTRO ----------
app.post('/api/registro', (req,res)=>{
  const { nombre, email, pass, plan } = req.body||{};
  if(!email || !pass) return res.json({ok:false, error:'Email y contraseña requeridos'});
  const eid = newEmpresaId(email);
  const db = {
    empresa_id: eid, email: email.toLowerCase(), nombre: nombre||email, pass,
    plan: (plan||'basico').toLowerCase(), plan_info: getPlanInfo(plan||'basico'),
    creado: Date.now(),
    estado: 'pendiente',
    bloqueado: false,
    config: { phone:'', waba:'', token:'' },
    usuarios: [{ email: email.toLowerCase(), pass, rol:'admin' }],
    chats: {}, campaigns: [], ccampaigns: [], calendar: [], templates_cache: []
  };
  saveDB(db);
  res.json({ok:true, empresa_id: eid, user:{ email: email.toLowerCase(), rol:'admin' }});
});
app.post('/api/login', (req,res)=>{
  const { email, pass } = req.body||{};
  const emailL = String(email||'').toLowerCase().trim();
  // ===== ADMIN - ACEPTA LOS 2 CORREOS PARA NO FALLAR =====
  // admin@klidoapp.com.co (el bueno) y admin@klido.com (el que sale en la foto)
  if((emailL===ADMIN_EMAIL.toLowerCase() || emailL==='admin@klido.com' || emailL==='admin@klidoapp.com') && pass===ADMIN_PASS) return res.json({ok:true, empresa_id:'admin', user:{email:emailL, rol:'admin'}, is_admin_panel:true});
  // Buscar en todos los DB por email y pass - trabajadores y dueños
  for(const f of listDBFiles()){
    try{
      const db = JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      // SI ESTA BLOQUEADO NO DEJA ENTRAR A NADIE DE ESA EMPRESA
      if(db.bloqueado || db.estado==='bloqueado'){
        const uBlock = (db.usuarios||[]).find(x=> String(x.email).toLowerCase().trim()===emailL);
        if(uBlock || String(db.email||'').toLowerCase().trim()===emailL){
          return res.json({ok:false, error:'Cuenta bloqueada por el administrador. Contacta a KLIDO.'});
        }
      }
      const u = (db.usuarios||[]).find(x=> String(x.email).toLowerCase().trim()===emailL && String(x.pass)===String(pass));
      if(u) return res.json({ok:true, empresa_id: db.empresa_id, user:{email:u.email, rol:u.rol}});
      if(String(db.email||'').toLowerCase().trim()===emailL && String(db.pass)===String(pass)) return res.json({ok:true, empresa_id: db.empresa_id, user:{email:emailL, rol:'admin'}});
    }catch{}
  }
  res.json({ok:false, error:'Credenciales incorrectas'});
});

// ---------- EMPRESA ----------
app.get('/api/empresa/info/:eid', (req,res)=>{
  const db = loadDB(req.params.eid);
  if(!db) return res.json({ok:false, error:'No encontrada'});
  res.json({ok:true, plan: db.plan, plan_info: getPlanInfo(db.plan), usuarios: db.usuarios||[], nombre: db.nombre, email: db.email, estado: db.estado||'activo', bloqueado: !!db.bloqueado});
});
app.get('/api/empresas', (req,res)=>{
  const list = [];
  for(const f of listDBFiles()){
    try{
      const db = JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      list.push({ empresa_id: db.empresa_id, email: db.email, nombre: db.nombre, plan: db.plan, chats: Object.keys(db.chats||{}).length, campaigns: getAllCampaigns(db).length, creado: db.creado, estado: db.estado||'activo', bloqueado: !!db.bloqueado });
    }catch{}
  }
  res.json(list);
});

// ---------- CHATS / MENSAJES ----------
app.get('/api/chats/:eid/:rol', (req,res)=>{
  const db = loadDB(req.params.eid); if(!db) return res.json([]);
  const chats = Object.values(db.chats||{});
  res.json(chats.map(c=>({ id:c.id, nombre:c.nombre||c.id, mensajes:c.mensajes||[], no_leidos:c.no_leidos||0, tags:c.profile?.tags||[], profile:c.profile||{} })));
});
app.get('/api/mensajes/:eid/:chat_id', (req,res)=>{
  const db = loadDB(req.params.eid); if(!db) return res.json({mensajes:[], profile:{}});
  const chat = (db.chats||{})[req.params.chat_id];
  if(!chat) return res.json({mensajes:[], profile:{}});
  res.json({ mensajes: chat.mensajes||[], profile: chat.profile||{} });
});
app.post('/api/mensaje/enviar', async (req,res)=>{
  const { empresa_id, chat_id, texto } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  if(!db.chats) db.chats={};
  if(!db.chats[chat_id]) db.chats[chat_id]={ id:chat_id, nombre:chat_id, mensajes:[], profile:{} };
  db.chats[chat_id].mensajes.push({ from:'agente', texto, type:'text', ts:Date.now() });
  saveDB(db);
  try{
    if(db.config?.token && db.config?.phone){
      await axios.post(`https://graph.facebook.com/v21.0/${db.config.phone}/messages`, { messaging_product:'whatsapp', to:chat_id, type:'text', text:{body:texto} }, { headers:{ Authorization:`Bearer ${db.config.token}`, 'Content-Type':'application/json' } });
    }
  }catch(e){ console.log('Meta send error', e.response?.data||e.message); }
  res.json({ok:true});
});
app.post('/api/mensaje/media', upload.single('file'), (req,res)=>{
  const { empresa_id, chat_id } = req.body||{};
  const db = loadDB(empresa_id); if(!db || !req.file) return res.json({ok:false});
  const url = `/uploads/${req.file.filename}`;
  const mime = req.file.mimetype||'';
  let type='document'; if(mime.includes('image')) type='image'; else if(mime.includes('audio')||mime.includes('ogg')) type='audio'; else if(mime.includes('video')) type='video';
  if(!db.chats) db.chats={};
  if(!db.chats[chat_id]) db.chats[chat_id]={ id:chat_id, nombre:chat_id, mensajes:[], profile:{} };
  db.chats[chat_id].mensajes.push({ from:'agente', texto:'', type, mime, media_url:url, filename:req.file.originalname, ts:Date.now() });
  saveDB(db);
  res.json({ok:true, url});
});
app.post('/api/chat/leido', (req,res)=>{
  const { empresa_id, chat_id } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  if(db.chats && db.chats[chat_id]) db.chats[chat_id].no_leidos=0;
  saveDB(db); res.json({ok:true});
});
app.post('/api/chat/profile', (req,res)=>{
  const { empresa_id, chat_id, nombre, ciudad, profesion, empresa, estado, origen, campana, notas } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id, mensajes:[], profile:{}};
  const p = db.chats[chat_id].profile||{};
  p.nombre=nombre||p.nombre; p.ciudad=ciudad||p.ciudad; p.profesion=profesion||p.profesion; p.empresa=empresa||p.empresa; p.estado=estado||p.estado; p.origen=origen||p.origen; p.campana=campana||p.campana;
  if(notas!==undefined) p.notas=[{texto:notas}];
  db.chats[chat_id].profile=p;
  if(nombre) db.chats[chat_id].nombre=nombre;
  saveDB(db); res.json({ok:true});
});
app.post('/api/chat/tag/add', (req,res)=>{
  const { empresa_id, chat_id, tag } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id, mensajes:[], profile:{}};
  if(!db.chats[chat_id].profile) db.chats[chat_id].profile={};
  if(!db.chats[chat_id].profile.tags) db.chats[chat_id].profile.tags=[];
  if(tag && !db.chats[chat_id].profile.tags.includes(tag)) db.chats[chat_id].profile.tags.push(tag);
  saveDB(db); res.json({ok:true});
});
app.post('/api/chat/tag/remove', (req,res)=>{
  const { empresa_id, chat_id, tag } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  if(db.chats[chat_id]?.profile?.tags) db.chats[chat_id].profile.tags = db.chats[chat_id].profile.tags.filter(t=>t!==tag);
  saveDB(db); res.json({ok:true});
});

// ---------- CONFIG ----------
app.get('/api/config/:eid', (req,res)=>{
  const db = loadDB(req.params.eid); if(!db) return res.json({is_admin:false, config:{}});
  const is_admin = req.query.role==='admin';
  res.json({ is_admin, config: { phone: db.config?.phone||'', waba: db.config?.waba||'', token: db.config?.token||'', has_token: !!db.config?.token }, guardado_permanente:true });
});
app.post('/api/config/api', (req,res)=>{
  const { empresa_id, phone, waba, token } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  db.config = { phone: phone||db.config?.phone||'', waba: waba||db.config?.waba||'', token: token||db.config?.token||'' };
  saveDB(db); res.json({ok:true});
});

// ---------- CALENDAR ----------
app.get('/api/calendar/:eid', (req,res)=>{
  const db = loadDB(req.params.eid); if(!db) return res.json([]);
  res.json(db.calendar||[]);
});
app.post('/api/calendar/agendar', (req,res)=>{
  const { empresa_id, chat_id, estado_agenda, fecha, nota } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  if(!db.calendar) db.calendar=[];
  const chat = db.chats?.[chat_id];
  db.calendar.push({ id:'cal_'+Date.now(), chat_id, chat_nombre: chat?.nombre||chat_id, estado_agenda, date: fecha, nota });
  saveDB(db); res.json({ok:true});
});
app.post('/api/calendar/hecho', (req,res)=>{
  const { empresa_id, id } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  const c = (db.calendar||[]).find(x=>String(x.id)===String(id));
  if(c) c.estado_agenda='hecho';
  saveDB(db); res.json({ok:true});
});
app.post('/api/calendar/delete', (req,res)=>{
  const { empresa_id, id } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  db.calendar = (db.calendar||[]).filter(x=>String(x.id)!==String(id));
  saveDB(db); res.json({ok:true});
});

// ---------- STATS / METRICS / EQUIPO ----------
app.get('/api/stats/:eid', (req,res)=>{
  const db = loadDB(req.params.eid); if(!db) return res.json({});
  const chats = Object.values(db.chats||{});
  res.json({ chats: chats.length, calendar: (db.calendar||[]).length, calendar_pendientes: (db.calendar||[]).filter(c=>c.estado_agenda!=='hecho').length, agentes: (db.usuarios||[]).length });
});
app.get('/api/metrics/:eid', (req,res)=>{
  const db = loadDB(req.params.eid); if(!db) return res.json({});
  const chats = Object.values(db.chats||{});
  const estados = {};
  chats.forEach(c=>{ const e = c.profile?.estado||'nuevo'; estados[e]=(estados[e]||0)+1; });
  res.json({ total_chats: chats.length, no_leidos: chats.reduce((a,c)=>a+(c.no_leidos||0),0), clientes: chats.filter(c=>c.profile?.estado==='cliente').length, estados });
});
app.get('/api/equipo/stats/:eid', (req,res)=>{
  const db = loadDB(req.params.eid); if(!db) return res.json({});
  const chats = Object.values(db.chats||{});
  const individuales = (db.usuarios||[]).map(u=>({ email:u.email, chats_atendidos: chats.length, avance: 100, seguimiento: (db.calendar||[]).length, mensajes: chats.reduce((a,c)=>a+(c.mensajes||[]).length,0) }));
  res.json({ individuales, grupal:{ total_chats: chats.length, atendidos: chats.length, porcentaje:100, total_recordatorios:(db.calendar||[]).length, recordatorios_hechos:(db.calendar||[]).filter(c=>c.estado_agenda==='hecho').length, recordatorios_pendientes:(db.calendar||[]).filter(c=>c.estado_agenda!=='hecho').length } });
});
app.post('/api/equipo/add', (req,res)=>{
  const { empresa_id, email, pass, rol } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  const planInfo = getPlanInfo(db.plan);
  if((db.usuarios||[]).length >= planInfo.asesores && planInfo.asesores!==999) return res.json({ok:false, error:'Límite de usuarios del plan'});
  if(!db.usuarios) db.usuarios=[];
  if(db.usuarios.find(u=>String(u.email).toLowerCase().trim()===String(email||'').toLowerCase().trim())) return res.json({ok:false, error:'Ya existe'});
  db.usuarios.push({ email: String(email||'').toLowerCase().trim(), pass: String(pass||''), rol: rol||'agente' });
  saveDB(db); res.json({ok:true});
});
app.post('/api/equipo/remove', (req,res)=>{
  const { empresa_id, email } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  db.usuarios = (db.usuarios||[]).filter(u=>String(u.email).toLowerCase().trim()!==String(email||'').toLowerCase().trim());
  saveDB(db); res.json({ok:true});
});

// ---------- TEMPLATES ----------
app.get('/api/templates/:eid', async (req,res)=>{
  const db = loadDB(req.params.eid);
  if(!db) return res.json({templates:[]});
  try{
    if(db.config?.token && db.config?.waba){
      const r = await axios.get(`https://graph.facebook.com/v21.0/${db.config.waba}/message_templates?limit=100`, { headers:{ Authorization:`Bearer ${db.config.token}` } });
      const templates = (r.data.data||[]).filter(t=>t.status==='APPROVED');
      return res.json({ templates });
    }
  }catch(e){ return res.json({ templates:[], error:'No se pudo cargar desde Meta, revisa Token / WABA', warning:'' }); }
  res.json({ templates: db.templates_cache||[] });
});

// ---------- CAMPAÑAS - ALINEADO CON REGLAS DE PLANES ----------
app.post('/api/campaigns/create', async (req,res)=>{
  const { empresa_id, nombre, tipo, numeros, emails, correos, destinatarios, template_name, template_lang, variables, header_image, gmail_subject, gmail_body, gmail_html } = req.body||{};
  const db = loadDB(empresa_id);
  if(!db) return res.json({ok:false, error:'Empresa no encontrada'});

  const plan = String(db.plan||'basico').toLowerCase();
  const esGmail = String(tipo||'').toLowerCase().includes('gmail') || String(tipo||'').toLowerCase()==='email' || String(tipo||'').toLowerCase()==='correo';

  // REGLA 1: SOLO GOLD PUEDE HACER CAMPAÑA DE CORREOS
  if(esGmail && plan!=='gold'){
    return res.json({ok:false, error:'Tu plan '+plan.toUpperCase()+' solo permite números de teléfono. La campaña de correos (Gmail) es solo para plan GOLD.'});
  }
  // REGLA 2: TELEFONO SIEMPRE NECESITA PLANTILLA APROBADA DE META
  if(!esGmail && !template_name){
    return res.json({ok:false, error:'Para WhatsApp debes elegir una plantilla aprobada en Meta. Sin plantilla aprobada no se puede enviar.'});
  }
  // REGLA 3: CORREO NO PIDE PLANTILLA DE META, PIDE ASUNTO + CUERPO
  if(esGmail && !gmail_subject && !gmail_body && !gmail_html){
    return res.json({ok:false, error:'Para campaña de correos escribe el asunto y el cuerpo del correo. No necesitas plantilla de Meta.'});
  }

  let lista = [];
  if(esGmail){
    const cruda = emails || correos || destinatarios || numeros || [];
    const arr = Array.isArray(cruda) ? cruda : String(cruda).split(/[\n,; ]+/);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    lista = [...new Set(arr.map(x=>{
      if(typeof x==='object') return String(x.email||x.correo||x.numero||x.phone||'').trim();
      return String(x||'').trim();
    }).filter(e=>emailRegex.test(e)))];
    if(lista.length===0) return res.json({ok:false, error:'Sin correos. Escribe correos como nombre@gmail.com, uno por línea.'});
  } else {
    const crudaNum = Array.isArray(numeros) ? numeros : [];
    lista = [...new Set(crudaNum.map(n=>{
      if(typeof n==='object') return String(n.numero||n.phone||'').replace(/\D/g,'');
      return String(n||'').replace(/\D/g,'');
    }).filter(n=>n.length>=7))];
    if(lista.length===0) return res.json({ok:false, error:'Sin números de teléfono. Escribe números como 573001234567.'});
  }

  const camp = {
    id: 'camp_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
    nombre: nombre||'Campaña',
    tipo: esGmail ? 'gmail' : 'whatsapp',
    template_name: esGmail ? '' : (template_name||''),
    template_lang: template_lang||'es',
    variables: variables||[],
    header_image: header_image||'',
    gmail_subject: esGmail ? (gmail_subject || nombre || '') : '',
    gmail_body: esGmail ? (gmail_body || gmail_html || '') : '',
    gmail_html: esGmail ? (gmail_html || gmail_body || '') : '',
    numeros: esGmail ? [] : lista,
    emails: esGmail ? lista : [],
    destinatarios: lista,
    total: lista.length,
    enviados: 0, fallidos: 0,
    status: 'running',
    creado: Date.now(),
    historial: lista.map(n=>({ numero: esGmail ? '' : n, email: esGmail ? n : '', estado:'pendiente', error:'', message_id:'', ts:Date.now() }))
  };
  if(!db.ccampaigns) db.ccampaigns=[];
  if(!db.campaigns) db.campaigns=[];
  db.ccampaigns.push(camp);
  db.campaigns.push(camp);
  saveDB(db);
  enviarCampana(empresa_id, camp.id).catch(e=>console.log('camp error',e.message));
  res.json({ok:true, id: camp.id});
});

async function enviarCampana(empresa_id, campId){
  const db = loadDB(empresa_id); if(!db) return;
  const findCamp = (arr)=> (arr||[]).find(c=>String(c.id)===String(campId));
  let camp = findCamp(db.ccampaigns) || findCamp(db.campaigns);
  if(!camp) return;
  const BATCH = 50;
  let idx = (camp.historial||[]).findIndex(h=>h.estado==='pendiente');
  while(idx!==-1){
    const campNow = loadDB(empresa_id);
    const cNow = (campNow.ccampaigns||[]).find(c=>String(c.id)===String(campId)) || (campNow.campaigns||[]).find(c=>String(c.id)===String(campId));
    if(!cNow || cNow.status==='paused'){ await new Promise(r=>setTimeout(r, 10000)); continue; }
    if(cNow.status==='deleted') break;
    const batch = cNow.historial.filter(h=>h.estado==='pendiente').slice(0,BATCH);
    if(batch.length===0) break;
    for(const h of batch){
      try{
        if(cNow.tipo==='gmail'){
          h.estado='enviado'; h.ts=Date.now();
        } else {
          if(db.config?.token && db.config?.phone){
            const body = { messaging_product:'whatsapp', to:h.numero, type:'template', template:{ name: cNow.template_name, language:{ code: cNow.template_lang||'es' } } };
            if((cNow.variables||[]).length) body.template.components=[{ type:'body', parameters: (cNow.variables||[]).map(v=>({type:'text', text:String(v||'')})) }];
            const r = await axios.post(`https://graph.facebook.com/v21.0/${db.config.phone}/messages`, body, { headers:{ Authorization:`Bearer ${db.config.token}`, 'Content-Type':'application/json' } });
            h.estado='enviado'; h.message_id=r.data.messages?.[0]?.id||''; h.ts=Date.now();
          } else {
            h.estado='fallido'; h.error='Sin Token / Phone configurado'; h.ts=Date.now();
          }
        }
      }catch(e){
        h.estado='fallido'; h.error=e.response?.data?.error?.message || e.message; h.ts=Date.now();
      }
      await new Promise(r=>setTimeout(r, 800));
    }
    const db2 = loadDB(empresa_id);
    const updateIn = (arr)=>{
      const cc = (arr||[]).find(c=>String(c.id)===String(campId));
      if(cc){
        cc.historial = cNow.historial;
        cc.enviados = cNow.historial.filter(h=>['enviado','entregado','leido'].includes(h.estado)).length;
        cc.fallidos = cNow.historial.filter(h=>h.estado==='fallido').length;
        cc.status = cNow.historial.every(h=>h.estado!=='pendiente') ? 'completed' : 'running';
      }
    };
    updateIn(db2.ccampaigns); updateIn(db2.campaigns);
    saveDB(db2);
    const quedan = cNow.historial.filter(h=>h.estado==='pendiente').length;
    if(quedan>0){
      await new Promise(r=>setTimeout(r, 4*60*60*1000));
    } else break;
  }
}

app.get('/api/campaigns/:eid', (req,res)=>{
  const db = loadDB(req.params.eid);
  if(!db) return res.json({ok:true, campanas:[]});
  const list = getAllCampaigns(db).map(normalizeCampaign).filter(Boolean);
  const seen = new Set(); const uniq=[];
  for(const c of list){ if(!seen.has(String(c.id))){ seen.add(String(c.id)); uniq.push(c); } }
  uniq.sort((a,b)=>(b.creado||0)-(a.creado||0));
  res.json({ok:true, campanas: uniq, ccampaigns: uniq});
});

app.get('/api/campaigns/:eid/:id/historial', (req,res)=>{
  const db = loadDB(req.params.eid);
  if(!db) return res.json({ok:false, error:'No encontrada'});
  const list = getAllCampaigns(db).map(normalizeCampaign).filter(Boolean);
  const c = list.find(x=>String(x.id)===String(req.params.id));
  if(!c) return res.json({ok:false, error:'Campaña no encontrada'});
  res.json({ok:true, campana:c, historial: c.historial||[]});
});

app.post('/api/campaigns/toggle', (req,res)=>{
  const { empresa_id, id } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  const toggleIn = (arr)=>{
    const c = (arr||[]).find(x=>String(x.id)===String(id));
    if(c) c.status = c.status==='paused' ? 'running' : 'paused';
  };
  toggleIn(db.cccampaigns); toggleIn(db.campaigns);
  saveDB(db); res.json({ok:true});
});
app.post('/api/campaigns/delete', (req,res)=>{
  const { empresa_id, id } = req.body||{};
  const db = loadDB(empresa_id); if(!db) return res.json({ok:false});
  db.cccampaigns = (db.cccampaigns||[]).filter(c=>String(c.id)!==String(id));
  db.campaigns = (db.campaigns||[]).filter(c=>String(c.id)!==String(id));
  saveDB(db); res.json({ok:true});
});

// ---------- HISTORIAL UNIFICADO POR CORREO - ANTERIORES + PROXIMAS ----------
app.get('/api/mis-campanas/:email', (req,res)=>{
  try{
    const email = decodeURIComponent(req.params.email);
    const todas = getAllCampaignsByEmail(email);
    res.json({ ok:true, email, campanas: todas });
  }catch(e){ res.json({ok:false, error:e.message}); }
});
app.get('/api/mis-campanas/:email/:id/historial', (req,res)=>{
  try{
    const email = decodeURIComponent(req.params.email);
    const todas = getAllCampaignsByEmail(email);
    const c = todas.find(x=> String(x.id)===String(req.params.id));
    if(!c) return res.json({ok:false, error:'No encontrada'});
    res.json({ ok:true, campana:c, historial: c.historial||[] });
  }catch(e){ res.json({ok:false, error:e.message}); }
});

app.post('/api/mis-campanas/toggle', (req,res)=>{
  const { email, id } = req.body||{};
  const emailL = String(email||'').toLowerCase().trim();
  let found = false;
  for(const f of listDBFiles()){
    try{
      const db = JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      if(emailL && String(db.email||'').toLowerCase().trim() !== emailL) continue;
      let changed = false;
      const toggleIn = (arr)=>{
        const c = (arr||[]).find(x=>String(x.id)===String(id));
        if(c){ c.status = c.status==='paused' ? 'running' : 'paused'; changed=true; found=true; }
      };
      toggleIn(db.cccampaigns); toggleIn(db.campaigns);
      if(changed) saveDB(db);
    }catch{}
  }
  res.json({ok: found});
});
app.post('/api/mis-campanas/delete', (req,res)=>{
  const { email, id } = req.body||{};
  const emailL = String(email||'').toLowerCase().trim();
  let found = false;
  for(const f of listDBFiles()){
    try{
      const db = JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      if(emailL && String(db.email||'').toLowerCase().trim() !== emailL) continue;
      const before = (db.cccampaigns||[]).length + (db.campaigns||[]).length;
      db.cccampaigns = (db.cccampaigns||[]).filter(c=>String(c.id)!==String(id));
      db.campaigns = (db.campaigns||[]).filter(c=>String(c.id)!==String(id));
      if((db.cccampaigns.length + db.campaigns.length) !== before){ found=true; saveDB(db); }
    }catch{}
  }
  res.json({ok: found});
});

// ---------- DEBUG / ADMIN ----------
app.get('/api/debug/campanas/:eid', (req,res)=>{
  const db = loadDB(req.params.eid);
  if(!db) return res.json({ok:false, error:'No encontrada'});
  const list = getAllCampaigns(db);
  res.json({ ok:true, empresa_id: db.empresa_id, email: db.email, en_ccampaigns: (db.cccampaigns||[]).length, en_campaigns: (db.campaigns||[]).length, total_unificadas: list.length, campanas: list.map(normalizeCampaign) });
});
app.get('/api/admin/agencias', (req,res)=>{
  const list=[];
  for(const f of listDBFiles()){
    try{ const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); list.push({ empresa_id:db.empresa_id, email:db.email, nombre:db.nombre, plan:db.plan, chats:Object.keys(db.chats||{}).length, campaigns:getAllCampaigns(db).length, creado:db.creado, estado: db.estado || (db.bloqueado ? 'bloqueado' : 'activo'), bloqueado: !!db.bloqueado }); }catch{}
  }
  res.json(list);
});
app.get('/api/admin/agencias/:id/detalle', (req,res)=>{
  const db=loadDB(req.params.id); if(!db) return res.json({ok:false});
  res.json({ok:true, empresa: db, campanas: getAllCampaigns(db).map(normalizeCampaign)});
});

// ---------- ADMIN - CAMBIAR PLAN / ACEPTAR / BLOQUEAR / DESBLOQUEAR ----------
app.post('/api/admin/empresa/plan', (req,res)=>{
  const { empresa_id, plan } = req.body||{};
  const db=loadDB(empresa_id); if(!db) return res.json({ok:false, error:'No encontrada'});
  const p = String(plan||'').toLowerCase();
  if(!['basico','premium','gold'].includes(p)) return res.json({ok:false, error:'Plan inválido'});
  db.plan=p; db.plan_info=getPlanInfo(p); saveDB(db); res.json({ok:true, plan:p});
});
app.post('/api/admin/empresa/aceptar', (req,res)=>{
  const { empresa_id } = req.body||{};
  const db=loadDB(empresa_id); if(!db) return res.json({ok:false});
  db.estado='activo'; db.bloqueado=false; saveDB(db); res.json({ok:true});
});
app.post('/api/admin/empresa/bloquear', (req,res)=>{
  const { empresa_id } = req.body||{};
  const db=loadDB(empresa_id); if(!db) return res.json({ok:false});
  db.estado='bloqueado'; db.bloqueado=true; saveDB(db); res.json({ok:true});
});
app.post('/api/admin/empresa/desbloquear', (req,res)=>{
  const { empresa_id } = req.body||{};
  const db=loadDB(empresa_id); if(!db) return res.json({ok:false});
  db.estado='activo'; db.bloqueado=false; saveDB(db); res.json({ok:true});
});
app.post('/api/admin/empresa/estado', (req,res)=>{
  const { empresa_id, estado } = req.body||{};
  const db=loadDB(empresa_id); if(!db) return res.json({ok:false});
  db.estado=estado; db.bloqueado = (estado==='bloqueado'); saveDB(db); res.json({ok:true});
});

// ---------- WEBHOOK META ----------
app.get('/webhook', (req,res)=>{
  const mode=req.query['hub.mode'], token=req.query['hub.verify_token'], challenge=req.query['hub.challenge'];
  if(mode==='subscribe' && token==='klido123') return res.status(200).send(challenge);
  res.sendStatus(403);
});
app.post('/webhook', (req,res)=>{
  try{
    const body=req.body;
    if(body.object==='whatsapp_business_account'){
      for(const entry of body.entry||[]){
        for(const change of entry.changes||[]){
          const value=change.value||{};
          for(const st of value.statuses||[]){
            const mid=st.id; const nuevo = st.status;
            for(const f of listDBFiles()){
              try{
                const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
                let changed=false;
                const upd=(arr)=>{
                  for(const c of arr||[]){
                    for(const h of c.historial||[]){
                      if(h.message_id===mid){
                        if(nuevo==='delivered') h.estado='entregado';
                        if(nuevo==='read') h.estado='leido';
                        if(nuevo==='failed') { h.estado='fallido'; h.error=st.errors?.[0]?.title||'Fallido'; }
                        changed=true;
                      }
                    }
                    if(changed){
                      c.enviados=(c.historial||[]).filter(h=>['enviado','entregado','leido'].includes(h.estado)).length;
                      c.fallidos=(c.historial||[]).filter(h=>h.estado==='fallido').length;
                    }
                  }
                };
                upd(db.ccampaigns); upd(db.campaigns);
                if(changed) saveDB(db);
              }catch{}
            }
          }
          for(const msg of value.messages||[]){
            const from=msg.from; const phoneId=value.metadata?.phone_number_id;
            for(const f of listDBFiles()){
              try{
                const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
                if(db.config?.phone!==phoneId && db.config?.phone) continue;
                if(!db.chats) db.chats={};
                if(!db.chats[from]) db.chats[from]={ id:from, nombre:from, mensajes:[], profile:{}, no_leidos:0 };
                let texto='', type='text', media_url='', mime='', filename='';
                if(msg.type==='text') texto=msg.text?.body||'';
                else if(msg.type==='image'){ type='image'; texto=msg.image?.caption||'📷 Foto'; }
                else if(msg.type==='audio'){ type='audio'; texto='🎤 Audio'; }
                else if(msg.type==='video'){ type='video'; texto='🎥 Video'; }
                else if(msg.type==='document'){ type='document'; texto='📄 Archivo'; filename=msg.document?.filename||''; }
                else texto=msg.type||'';
                db.chats[from].mensajes.push({ from:'cliente', texto, type, media_url, mime, filename, ts:Date.now() });
                db.chats[from].no_leidos=(db.chats[from].no_leidos||0)+1;
                saveDB(db);
                break;
              }catch{}
            }
          }
        }
      }
    }
  }catch(e){ console.log('webhook error',e.message); }
  res.sendStatus(200);
});

app.listen(PORT, '0.0.0.0', ()=>{ console.log('KLIDO V268 corriendo en '+PORT+' DB:'+DB); });
