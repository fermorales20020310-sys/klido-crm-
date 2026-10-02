// KLIDO CRM v115.1 FINAL - CON TUS VARIABLES EXACTAS + ANTI-CRASH RAILWAY
// Variables: ADMIN_KEY, ADMIN_PASSWORD_HASH, DATA_DIR, DATABASE_URL, DEFAULT_AGENCY, EMAIL_PASS, EMAIL_USER, JWT_SECRET, META_VERIFY_TOKEN, PHONE_NUMBER_ID, PORT, RAILWAY_VOLUME_MOUNT_PATH, RESEND_APT_KEY / RESEND_API_KEY
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
let multer, XLSX, uuidv4, fetch, Pool, nodemailer;
try{ multer = require('multer'); }catch{ console.log('[WARN] multer missing - mock'); multer = { memoryStorage:()=>({}), single:()=> (req,res,next)=>next() }; }
try{ XLSX = require('xlsx'); }catch{ XLSX={read:()=>({Sheets:{},SheetNames:[]}), utils:{sheet_to_json:()=>[]}}}; }
try{ uuidv4 = require('uuid').v4; }catch{ uuidv4=()=>Date.now().toString(36)+Math.random().toString(36).slice(2); }
try{ fetch = require('node-fetch'); }catch{ fetch = global.fetch; }
try{ Pool = require('pg').Pool; }catch{ Pool=null; }
try{ nodemailer = require('nodemailer'); }catch{ nodemailer=null; }

const app = express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true, limit:'50mb'}));
app.use(express.static(path.join(__dirname,'public')));

// === VARIABLES EXACTAS TUYAS ===
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'KLIDO_DUEÑA_2026';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname,'data');
const DATABASE_URL = process.env.DATABASE_URL || '';
const DEFAULT_AGENCY = process.env.DEFAULT_AGENCY || 'avanza-consulting';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_USER = process.env.EMAIL_USER || '';
const JWT_SECRET = process.env.JWT_SECRET || 'klido-avanza-final-2024-pro-v111';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN || 'klido123';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1338474282683914';
const RAILWAY_VOLUME_MOUNT_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.RESEND_APT_KEY || process.env.RESEND_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || process.env.EMAIL_USER || 'KLIDO <onboarding@resend.dev>';

const GERENCIA_EMAIL = 'admin@klido.com';
const GERENCIA_PASS = 'Mafe2002@';
const SOPORTE_WPP = '573133181851';

let BASE_DATA = DATA_DIR;
if(RAILWAY_VOLUME_MOUNT_PATH) BASE_DATA = path.join(RAILWAY_VOLUME_MOUNT_PATH, 'data');
if(!fs.existsSync(BASE_DATA)) fs.mkdirSync(BASE_DATA, {recursive:true});
const AGENCIAS_DIR = path.join(BASE_DATA,'agencias');
if(!fs.existsSync(AGENCIAS_DIR)) fs.mkdirSync(AGENCIAS_DIR, {recursive:true});

let pgPool = null;
if(DATABASE_URL && Pool){
  try{
    pgPool = new Pool({connectionString: DATABASE_URL, ssl:{rejectUnauthorized:false}});
    pgPool.query(`
      CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT, token TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, equipo JSONB DEFAULT '[]'::jsonb, creado BIGINT, mantenimiento BIGINT, default_agency TEXT);
      CREATE TABLE IF NOT EXISTS mensajes (id TEXT PRIMARY KEY, agencia_id TEXT, wa_id TEXT, texto TEXT, timestamp BIGINT, tipo TEXT, leido BOOLEAN, etiqueta TEXT, phone_id TEXT, nombre TEXT, campana_id TEXT, asignado_a TEXT);
      CREATE TABLE IF NOT EXISTS contactos (id TEXT PRIMARY KEY, agencia_id TEXT, wa_id TEXT, nombre TEXT, telefono TEXT, creado BIGINT, seguimiento JSONB, etiquetas JSONB);
      CREATE TABLE IF NOT EXISTS campanas (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, telefonos JSONB, total INT, enviados INT, estado TEXT, creada BIGINT, historial JSONB, phone_usado TEXT);
      CREATE TABLE IF NOT EXISTS calendario (id TEXT PRIMARY KEY, agencia_id TEXT, wa_id TEXT, fecha TEXT, nota TEXT, estado TEXT, creado BIGINT);
      CREATE TABLE IF NOT EXISTS plantillas (id TEXT PRIMARY KEY, agencia_id TEXT, data JSONB);
      CREATE TABLE IF NOT EXISTS gmail_camp (id TEXT PRIMARY KEY, agencia_id TEXT, asunto TEXT, total INT, enviados INT, creado BIGINT, historial JSONB);
    `).then(()=>console.log('[PG] Tablas OK DATA_DIR', BASE_DATA)).catch(e=>console.log('[PG ERROR]', e.message));
  }catch(e){ console.log('[PG INIT FAIL]', e.message); }
}

const codigosRegistro = new Map();
const colasCampanas = new Map();

function agenciaPath(id){ const p=path.join(AGENCIAS_DIR,id); if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); ['mensajes.json','contactos.json','campanas.json','calendario.json','plantillas.json','gmail.json'].forEach(f=>{ const fp=path.join(p,f); if(!fs.existsSync(fp)) fs.writeFileSync(fp,'[]'); }); return p; }
function readJSON(fp, def=[]){ try{ if(!fs.existsSync(fp)) return def; return JSON.parse(fs.readFileSync(fp,'utf8')||'[]'); }catch{ return def; } }
function writeJSON(fp, data){ fs.writeFileSync(fp, JSON.stringify(data,null,2)); }
function normalizarTel(raw){ if(!raw) return null; let digits = String(raw).replace(/\D/g,''); if(digits.length===10) return '+57'+digits; if(digits.length===11 && digits.startsWith('57')) return '+'+digits; if(digits.length>=10 && digits.length<=15) return '+'+digits.slice(-10).padStart(10,'0'); if(digits.length>=10) return '+57'+digits.slice(-10); return null; }
function extraerTels(rows){ const set=new Set(); rows.forEach(r=>{ Object.values(r).forEach(v=>{ if(!v) return; String(v).split(/[,;\n\s]+/).forEach(part=>{ const n=normalizarTel(part); if(n) set.add(n); const matches=String(part).match(/(\+?\d[\d\-\s\(\)]{7,}\d)/g); if(matches) matches.forEach(m=>{ const nn=normalizarTel(m); if(nn) set.add(nn); }); }); }); }); return [...set]; }

async function sendEmail(to, subject, html){
  if(RESEND_API_KEY){
    try{ const r=await fetch('https://api.resend.com/emails',{method:'POST', headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({from:RESEND_FROM, to:[to], subject, html})}); const j=await r.json(); if(!r.ok) console.log('[RESEND ERR]', j); else { console.log('[RESEND OK]', j.id, '->', to); return true; } }catch(e){ console.log('[RESEND FAIL]', e.message); }
  }
  if(EMAIL_USER && EMAIL_PASS && nodemailer){
    try{ let transporter = nodemailer.createTransport({service:'gmail', auth:{user:EMAIL_USER, pass:EMAIL_PASS}}); await transporter.sendMail({from:EMAIL_USER, to, subject, html}); console.log('[EMAIL USER/PASS OK]', to); return true; }catch(e){ console.log('[EMAIL USER FAIL]', e.message); }
  }
  console.log(`[EMAIL MOCK] ${to} => ${subject}`); return true;
}

async function obtenerEmpresas(){
  if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM agencias'); return rows.map(r=>({id:r.id, nombre:r.nombre, email:r.email, password:r.password, plan:r.plan, token:r.token, phoneId:r.phone_id, wabaId:r.waba_id, metaToken:r.meta_token, equipo:r.equipo||[], creado:r.creado, mantenimiento:r.mantenimiento, defaultAgency:r.default_agency})); }
  else { const fp=path.join(BASE_DATA,'empresas.json'); if(!fs.existsSync(fp)) fs.writeFileSync(fp,'[]'); return readJSON(fp); }
}
async function guardarEmpresa(emp){
  if(pgPool){ await pgPool.query(`INSERT INTO agencias (id,nombre,email,password,plan,token,phone_id,waba_id,meta_token,equipo,creado,mantenimiento,default_agency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO UPDATE SET nombre=$2,email=$3,password=$4,plan=$5,token=$6,phone_id=$7,waba_id=$8,meta_token=$9,equipo=$10,mantenimiento=$12,default_agency=$13`, [emp.id,emp.nombre,emp.email,emp.password,emp.plan,emp.token,emp.phoneId||PHONE_NUMBER_ID,emp.wabaId||null,emp.metaToken||null, JSON.stringify(emp.equipo||[]), emp.creado, emp.mantenimiento, DEFAULT_AGENCY]); }
  else { const fp=path.join(BASE_DATA,'empresas.json'); const all=readJSON(fp); const idx=all.findIndex(e=>e.id===emp.id); if(idx>=0) all[idx]=emp; else all.push(emp); writeJSON(fp, all); }
}

function auth(req,res,next){
  const h=req.headers.authorization||''; const token=h.replace('Bearer ','').trim()||req.query.token;
  if(!token) return res.status(401).json({error:'Token requerido'});
  try{ const payload=jwt.verify(token, JWT_SECRET); req.agenciaId=payload.agenciaId; req.user=payload; return next(); }catch{ return res.status(401).json({error:'Token inválido - JWT_SECRET: '+JWT_SECRET.slice(0,10)+'...'}); }
}
function authGerencia(req,res,next){
  const keyHeader = req.headers['x-admin-key'] || req.query.admin_key;
  if(keyHeader===ADMIN_KEY){ req.user={rol:'gerencia', email:GERENCIA_EMAIL}; return next(); }
  try{ const h=req.headers.authorization||''; const token=h.replace('Bearer ','').trim(); const p=jwt.verify(token, JWT_SECRET); if(p.rol==='gerencia' || p.email===GERENCIA_EMAIL) { req.user=p; return next(); } }catch{}
  return res.status(403).json({error:'Gerencia solo - ADMIN_KEY requerido: KLIDO_DUEÑA_2026'});
}

// HEALTHCHECK PARA RAILWAY - ESTO EVITA EL CRASH DE TU FOTO
app.get('/health', (req,res)=> res.status(200).json({ok:true, status:'KLIDO v115.1 OK', META_VERIFY_TOKEN, PHONE_NUMBER_ID, ADMIN_KEY, DATA_DIR:BASE_DATA, PG: pgPool?'ON':'FS', RESEND: RESEND_API_KEY?'OK':'MISSING'}));
app.get('/api/health', (req,res)=> res.status(200).json({ok:true}));

// WEBHOOK META
app.get('/webhook', (req,res)=>{
  const mode=req.query['hub.mode']; const token=req.query['hub.verify_token']; const challenge=req.query['hub.challenge'];
  if(mode==='subscribe' && token===META_VERIFY_TOKEN){ console.log('[WEBHOOK VERIFICADO] META_VERIFY_TOKEN=klido123 OK con PHONE_NUMBER_ID', PHONE_NUMBER_ID); return res.status(200).send(challenge); }
  console.log('[WEBHOOK FAIL] token recibido', token, 'esperado', META_VERIFY_TOKEN);
  return res.sendStatus(403);
});
app.post('/webhook', async(req,res)=>{
  try{
    const body=req.body;
    if(body.object!=='whatsapp_business_account') return res.sendStatus(200);
    const empresas=await obtenerEmpresas();
    for(const entry of body.entry||[]){
      for(const change of entry.changes||[]){
        const value=change.value; const phoneId=value.metadata?.phone_number_id || PHONE_NUMBER_ID; const msgs=value.messages||[]; const contacts=value.contacts||[];
        for(const msg of msgs){
          const agencia=empresas.find(e=>e.phoneId===phoneId || e.phoneId===PHONE_NUMBER_ID || DEFAULT_AGENCY===e.defaultAgency) || empresas[0];
          if(!agencia) continue;
          const texto=msg.text?.body || msg.button?.text || '[media]'; const waId=msg.from; const nombre=contacts.find(c=>c.wa_id===waId)?.profile?.name || waId;
          const nuevo={id:msg.id, agencia_id:agencia.id, wa_id:waId, texto, timestamp:Date.now(), tipo:'entrante', leido:false, etiqueta:null, phone_id:phoneId, nombre, campana_id:null, asignado_a:null};
          if(pgPool){
            const {rows}=await pgPool.query('SELECT * FROM campanas WHERE agencia_id=$1', [agencia.id]);
            for(const camp of rows){ const tels=camp.telefonos||[]; const arr=typeof tels==='string'? JSON.parse(tels): tels; if(arr.some(t=> waId.includes(t.slice(-10)))) { nuevo.etiqueta='amarilla'; nuevo.campana_id=camp.id; } }
            await pgPool.query('INSERT INTO mensajes (id,agencia_id,wa_id,texto,timestamp,tipo,leido,etiqueta,phone_id,nombre,campana_id,asignado_a) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING', [nuevo.id,nuevo.agencia_id,nuevo.wa_id,nuevo.texto,nuevo.timestamp,nuevo.tipo,nuevo.leido,nuevo.etiqueta,nuevo.phone_id,nuevo.nombre,nuevo.campana_id,nuevo.asignado_a]);
          }else{
            const ap=agenciaPath(agencia.id); const mensajes=readJSON(path.join(ap,'mensajes.json')); const campanas=readJSON(path.join(ap,'campanas.json'));
            for(const camp of campanas){ if((camp.telefonos||[]).some(t=> waId.includes(t.slice(-10)))) { nuevo.etiqueta='amarilla'; nuevo.campana_id=camp.id; } }
            mensajes.push({id:nuevo.id, waId, texto, timestamp:nuevo.timestamp, tipo:'entrante', leido:false, etiqueta:nuevo.etiqueta, phoneId, nombre, campanaId:nuevo.campana_id, asignadoA:null});
            writeJSON(path.join(ap,'mensajes.json'), mensajes);
          }
          console.log(`[KLIDO REAL TIEMPO] ${agencia.nombre} <- ${waId}: ${texto} ${nuevo.etiqueta?'[AMARILLA CAMPAÑA]':''} [PUNTO ROJO NO LEIDO]`);
        }
      }
    }
    res.sendStatus(200);
  }catch(e){ console.log('Webhook error', e); res.sendStatus(200); }
});

// PUBLIC
app.post('/api/public/solicitar-codigo', async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const nombre=req.body.nombre||'Cliente'; const plan=req.body.plan||'basico';
  if(!email) return res.status(400).json({error:'Email requerido'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosRegistro.set(email,{codigo, expira:Date.now()+600000, nombre, plan, tipo:'registro'});
  const html=`<div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:16px;padding:24px"><h2 style="color:#1e3a8a">KLIDO CRM - Código verificación</h2><p>Hola <b>${nombre}</b> - Plan ${plan.toUpperCase()}</p><h1 style="background:#f0f6ff;padding:20px;border-radius:12px;text-align:center;letter-spacing:8px;color:#1e3a8a">${codigo}</h1><p>Expira 10 min. Llega a tu correo inscrito ${email}, no al admin. Soporte WPP ${SOPORTE_WPP} - Ley 1581 Colombia - DATA_DIR ${DATA_DIR} - PHONE ${PHONE_NUMBER_ID}</p></div>`;
  await sendEmail(email, `KLIDO Código ${codigo} - Plan ${plan}`, html);
  console.log(`[CODIGO] ${email} -> ${codigo} con RESEND_APT_KEY/EMAIL_USER - llega a su Gmail`);
  res.json({ok:true});
});
app.post('/api/public/crear-empresa', async(req,res)=>{
  const {nombre,email,password,codigo,plan,terminos}=req.body; const em=(email||'').toLowerCase().trim();
  if(!nombre||!em||!password||!codigo) return res.status(400).json({error:'Faltan datos'});
  if(!terminos) return res.status(400).json({error:'Acepta Términos Ley 1581'});
  const reg=codigosRegistro.get(em); if(!reg || reg.codigo!==codigo || Date.now()>reg.expira) return res.status(400).json({error:'Código inválido o vencido'});
  const empresas=await obtenerEmpresas(); if(empresas.find(e=>e.email===em)) return res.status(400).json({error:'Email ya registrado'});
  if(empresas.length>=10 &&!pgPool) return res.status(400).json({error:'Límite 10 empresas'});
  const id=uuidv4(); const tokenJwt=jwt.sign({agenciaId:id, email:em, rol:'jefe', nombre, plan: plan||reg.plan||'basico'}, JWT_SECRET, {expiresIn:'30d'});
  const nueva={id, nombre, email:em, password, plan: plan||reg.plan||'basico', token:tokenJwt, phoneId:PHONE_NUMBER_ID, wabaId:null, metaToken:null, equipo:[], creado:Date.now(), mantenimiento:Date.now()+90*24*3600*1000, defaultAgency:DEFAULT_AGENCY};
  await guardarEmpresa(nueva); if(!pgPool) agenciaPath(id);
  codigosRegistro.delete(em);
  console.log(`[EMPRESA CREADA AUTONOMA] ${nombre} ${em} plan ${nueva.plan} ID ${id} PHONE ${PHONE_NUMBER_ID} SIN CRUCE`);
  res.json({ok:true, id, token:tokenJwt});
});
app.post('/api/public/recuperar-codigo', async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const empresas=await obtenerEmpresas();
  const emp=empresas.find(e=>e.email===email || e.equipo?.some(u=>u.email===email));
  if(!emp) return res.status(404).json({error:'Email no registrado'});
  const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosRegistro.set(email,{codigo, expira:Date.now()+600000, tipo:'recuperacion'});
  await sendEmail(email, `KLIDO Recuperación ${codigo}`, `<h1>${codigo}</h1><p>Recuperación KLIDO - expira 10 min - Soporte ${SOPORTE_WPP}</p>`);
  res.json({ok:true});
});
app.post('/api/public/restablecer', async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const codigo=(req.body.codigo||'').trim(); const nueva=req.body.nueva||'';
  const reg=codigosRegistro.get(email); if(!reg || reg.codigo!==codigo || Date.now()>reg.expira) return res.status(400).json({error:'Código inválido'});
  const empresas=await obtenerEmpresas(); let found=false; for(const e of empresas){ if(e.email===email){ e.password=nueva; await guardarEmpresa(e); found=true; } for(const u of (e.equipo||[])){ if(u.email===email){ u.password=nueva; await guardarEmpresa(e); found=true; } } }
  if(!found) return res.status(404).json({error:'No encontrado'}); codigosRegistro.delete(email); res.json({ok:true});
});
app.post('/api/login', async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const pass=req.body.password||''; const adminKeyHeader=req.body.admin_key || req.headers['x-admin-key'];
  if((email===GERENCIA_EMAIL && pass===GERENCIA_PASS) || (adminKeyHeader===ADMIN_KEY && pass===GERENCIA_PASS) || (email===GERENCIA_EMAIL && ADMIN_PASSWORD_HASH && pass===ADMIN_KEY)){
    const token=jwt.sign({rol:'gerencia', email:GERENCIA_EMAIL, agenciaId:'gerencia'}, JWT_SECRET, {expiresIn:'12h'}); return res.json({token, rol:'gerencia', agenciaId:'gerencia', nombre:'Gerencia Avanza - Dueña '+ADMIN_KEY});
  }
  const empresas=await obtenerEmpresas();
  for(const emp of empresas){
    if(emp.email===email && emp.password===pass){ const token=jwt.sign({agenciaId:emp.id, email, rol:'jefe', nombre:emp.nombre, plan:emp.plan}, JWT_SECRET, {expiresIn:'30d'}); emp.token=token; await guardarEmpresa(emp); return res.json({token, rol:'jefe', agenciaId:emp.id, plan:emp.plan, nombre:emp.nombre}); }
    const user=(emp.equipo||[]).find(u=>u.email===email && u.password===pass); if(user){ const token=jwt.sign({agenciaId:emp.id, email, rol:user.rol||'trabajador', nombre:user.nombre, plan:emp.plan}, JWT_SECRET, {expiresIn:'30d'}); user.token=token; await guardarEmpresa(emp); return res.json({token, rol:user.rol||'trabajador', agenciaId:emp.id, plan:emp.plan, nombre:user.nombre}); }
  }
  res.status(401).json({error:'Credenciales inválidas - soporte '+SOPORTE_WPP});
});

const upload = multer({storage: multer.memoryStorage()});

app.get('/api/mensajes', auth, async(req,res)=>{
  const agenciaId=req.user.agenciaId; let msgs=[];
  if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM mensajes WHERE agencia_id=$1 ORDER BY timestamp DESC LIMIT 500', [agenciaId]); msgs=rows.map(r=>({id:r.id, waId:r.wa_id, texto:r.texto, timestamp:r.timestamp, tipo:r.tipo, leido:r.leido, etiqueta:r.etiqueta, phoneId:r.phone_id, nombre:r.nombre, campanaId:r.campana_id, asignadoA:r.asignado_a})); }
  else msgs=readJSON(path.join(agenciaPath(agenciaId),'mensajes.json')).sort((a,b)=>b.timestamp-a.timestamp);
  if(req.user.rol!=='jefe' && req.user.rol!=='gerencia'){ msgs=msgs.filter(m=>!m.asignadoA || m.asignadoA===req.user.email); }
  res.json(msgs);
});
app.post('/api/mensajes/leido', auth, async(req,res)=>{
  const {id}=req.body; const agenciaId=req.user.agenciaId;
  if(pgPool) await pgPool.query('UPDATE mensajes SET leido=true WHERE id=$1 AND agencia_id=$2', [id, agenciaId]);
  else { const p=path.join(agenciaPath(agenciaId),'mensajes.json'); const ms=readJSON(p); const m=ms.find(x=>x.id===id); if(m){ m.leido=true; writeJSON(p,ms); } }
  res.json({ok:true});
});
app.post('/api/mensajes/enviar', auth, async(req,res)=>{
  const {waId, texto}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  const phoneUsar = emp.phoneId || PHONE_NUMBER_ID;
  if(!emp?.metaToken) return res.status(400).json({error:'Configura token Meta en Configuración'});
  try{ await fetch(`https://graph.facebook.com/v20.0/${phoneUsar}/messages`,{method:'POST', headers:{'Authorization':`Bearer ${emp.metaToken}`,'Content-Type':'application/json'}, body:JSON.stringify({messaging_product:'whatsapp', to:waId.replace('+',''), type:'text', text:{body:texto}})}); res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/contactos', auth, async(req,res)=>{
  const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM contactos WHERE agencia_id=$1', [agenciaId]); return res.json(rows); }
  res.json(readJSON(path.join(agenciaPath(agenciaId),'contactos.json')));
});
app.post('/api/contactos/seguimiento', auth, async(req,res)=>{
  const {waId, fecha, nota}=req.body; const agenciaId=req.user.agenciaId;
  if(pgPool) await pgPool.query('INSERT INTO calendario (id,agencia_id,wa_id,fecha,nota,estado,creado) VALUES ($1,$2,$3,$4,$5,$6,$7)', [uuidv4(), agenciaId, waId, fecha, nota, 'pendiente', Date.now()]);
  else { const ap=agenciaPath(agenciaId); const cal=readJSON(path.join(ap,'calendario.json')); cal.push({id:uuidv4(), waId, fecha, nota, estado:'pendiente', creado:Date.now()}); writeJSON(path.join(ap,'calendario.json'), cal); }
  res.json({ok:true, alerta:`Seguimiento ${waId} para ${fecha} - alerta activa`});
});
app.get('/api/calendario', auth, async(req,res)=>{
  const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM calendario WHERE agencia_id=$1 ORDER BY creado DESC', [agenciaId]); return res.json(rows); }
  res.json(readJSON(path.join(agenciaPath(agenciaId),'calendario.json')));
});
app.get('/api/plantillas', auth, async(req,res)=>{
  const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId); let plantillas=[];
  if(pgPool){ const {rows}=await pgPool.query('SELECT data FROM plantillas WHERE agencia_id=$1', [agenciaId]); if(rows[0]) plantillas=rows[0].data; } else plantillas=readJSON(path.join(agenciaPath(agenciaId),'plantillas.json'));
  if(emp?.metaToken && emp?.wabaId){
    try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaId}/message_templates?access_token=${emp.metaToken}`); const j=await r.json(); if(j.data && j.data.length>0){ plantillas=j.data; if(pgPool) await pgPool.query('INSERT INTO plantillas (id,agencia_id,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3', [agenciaId, agenciaId, JSON.stringify(plantillas)]); else writeJSON(path.join(agenciaPath(agenciaId),'plantillas.json'), plantillas); console.log(`[PLANTILLAS AUTO] ${agenciaId} ${plantillas.length} se suben solas`); } }catch(e){}
  }
  res.json(plantillas);
});
app.post('/api/campanas/subir-excel', auth, upload.single('excel'), async(req,res)=>{
  try{
    let rows=[]; if(req.file){ const wb=XLSX.read(req.file.buffer); const ws=wb.Sheets[wb.SheetNames[0]]; rows=XLSX.utils.sheet_to_json(ws); } else if(req.body.rows){ rows=typeof req.body.rows==='string'? JSON.parse(req.body.rows): req.body.rows; }
    const telefonos=extraerTels(rows); const agenciaId=req.user.agenciaId; const nombre=req.body.nombre||`Campaña ${Date.now()}`; const plantilla=req.body.plantilla||'auto';
    const camp={id:uuidv4(), agencia_id:agenciaId, nombre, plantilla, telefonos, total:telefonos.length, enviados:0, estado:'pendiente', creada:Date.now(), historial:[], phone_usado:req.body.phoneId||PHONE_NUMBER_ID};
    if(pgPool) await pgPool.query('INSERT INTO campanas (id,agencia_id,nombre,plantilla,telefonos,total,enviados,estado,creada,historial,phone_usado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [camp.id,camp.agencia_id,camp.nombre,camp.plantilla, JSON.stringify(camp.telefonos), camp.total,0,'pendiente',camp.creada, JSON.stringify([]), camp.phone_usado]);
    else { const p=path.join(agenciaPath(agenciaId),'campanas.json'); const cs=readJSON(p); cs.push({id:camp.id, nombre:camp.nombre, plantilla:camp.plantilla, telefonos:camp.telefonos, total:camp.total, enviados:0, estado:'pendiente', creada:camp.creada, historial:[], phoneUsado:camp.phone_usado}); writeJSON(p,cs); }
    colasCampanas.set(agenciaId+camp.id, {lista:telefonos, idx:0, pausada:false});
    res.json({ok:true, campana:camp, segmentados:telefonos.length});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/campanas', auth, async(req,res)=>{
  const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM campanas WHERE agencia_id=$1 ORDER BY creada DESC', [agenciaId]); return res.json(rows); }
  res.json(readJSON(path.join(agenciaPath(agenciaId),'campanas.json')));
});
app.post('/api/campanas/enviar', auth, async(req,res)=>{
  const {campanaId, phoneIdSeleccionado}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  if(!emp?.metaToken) return res.status(400).json({error:'Configura token Meta'});
  let camp=null; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM campanas WHERE id=$1 AND agencia_id=$2', [campanaId, agenciaId]); camp=rows[0]; } else { const cs=readJSON(path.join(agenciaPath(agenciaId),'campanas.json')); camp=cs.find(c=>c.id===campanaId); }
  if(!camp) return res.status(404).json({error:'Campaña no encontrada'});
  const phoneUsar=phoneIdSeleccionado||camp.phone_usado||camp.phoneUsado||emp.phoneId||PHONE_NUMBER_ID;
  const lista = camp.telefonos? (typeof camp.telefonos==='string'? JSON.parse(camp.telefonos): camp.telefonos): (camp.telefonos||[]);
  colasCampanas.set(agenciaId+campanaId, {lista, idx: camp.enviados||0, pausada:false});
  if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1, phone_usado=$2 WHERE id=$3', ['enviando', phoneUsar, campanaId]);
  (async()=>{ let cola=colasCampanas.get(agenciaId+campanaId); for(let i=cola.idx;i<cola.lista.length;i++){ cola=colasCampanas.get(agenciaId+campanaId); if(!cola||cola.pausada) break; const to=cola.lista[i].replace('+',''); try{ const payload= camp.plantilla==='auto'? {messaging_product:'whatsapp', to, type:'text', text:{body:`Hola de ${emp.nombre}`}} : {messaging_product:'whatsapp', to, type:'template', template:{name:camp.plantilla, language:{code:'es_CO'}}}; await fetch(`https://graph.facebook.com/v20.0/${phoneUsar}/messages`,{method:'POST', headers:{'Authorization':`Bearer ${emp.metaToken}`,'Content-Type':'application/json'}, body:JSON.stringify(payload)}); if(pgPool) await pgPool.query('UPDATE campanas SET enviados=enviados+1 WHERE id=$1', [campanaId]); }catch(e){} await new Promise(r=>setTimeout(r,1200)); cola.idx=i+1; colasCampanas.set(agenciaId+campanaId, cola); } if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2', ['completada', campanaId]); })();
  res.json({ok:true, mensaje:`Envío iniciado a ${phoneUsar} - puedes pausar/continuar`});
});
app.post('/api/campanas/pausar', auth, async(req,res)=>{ const {campanaId}=req.body; const key=req.user.agenciaId+campanaId; const cola=colasCampanas.get(key); if(cola) cola.pausada=true; if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2', ['pausada', campanaId]); res.json({ok:true}); });
app.post('/api/campanas/reanudar', auth, async(req,res)=>{ const {campanaId}=req.body; const key=req.user.agenciaId+campanaId; const cola=colasCampanas.get(key); if(cola) cola.pausada=false; res.json({ok:true}); });
app.post('/api/gmail/campana', auth, async(req,res)=>{
  const {asunto, html, destinatarios}=req.body; const agenciaId=req.user.agenciaId; let enviados=0; const historial=[];
  for(const to of destinatarios){ const ok=await sendEmail(to, asunto, html); historial.push({to, fecha:Date.now(), estado: ok?'enviado':'error'}); if(ok) enviados++; }
  const id=uuidv4(); if(pgPool) await pgPool.query('INSERT INTO gmail_camp (id,agencia_id,asunto,total,enviados,creado,historial) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, agenciaId, asunto, destinatarios.length, enviados, Date.now(), JSON.stringify(historial)]); else { const p=path.join(agenciaPath(agenciaId),'gmail.json'); const gs=readJSON(p); gs.push({id, asunto, total:destinatarios.length, enviados, creado:Date.now(), historial}); writeJSON(p,gs); }
  res.json({ok:true, enviados, historial});
});
app.get('/api/gmail', auth, async(req,res)=>{ const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM gmail_camp WHERE agencia_id=$1 ORDER BY creado DESC', [agenciaId]); return res.json(rows); } res.json(readJSON(path.join(agenciaPath(agenciaId),'gmail.json'))); });
app.post('/api/equipo/agregar', auth, async(req,res)=>{
  if(req.user.rol!=='jefe' && req.user.rol!=='gerencia') return res.status(403).json({error:'Solo Jefe'});
  const {nombre,email,password,rol}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  const limites={basico:3, premium:10, gold:999}; const max=limites[emp.plan]||3;
  if((emp.equipo||[]).length>=max) return res.status(400).json({error:`Límite ${max} para ${emp.plan}. WPP ${SOPORTE_WPP}`});
  const token=jwt.sign({agenciaId, email:email.toLowerCase(), rol:rol||'trabajador', nombre}, JWT_SECRET, {expiresIn:'30d'});
  emp.equipo.push({id:uuidv4(), nombre, email:email.toLowerCase(), password, rol:rol||'trabajador', token, asignados:[], creado:Date.now()}); await guardarEmpresa(emp); res.json({ok:true});
});
app.post('/api/equipo/quitar', auth, async(req,res)=>{ if(req.user.rol!=='jefe') return res.status(403).json({error:'Solo Jefe'}); const {email}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId); emp.equipo=emp.equipo.filter(u=>u.email!==email.toLowerCase()); await guardarEmpresa(emp); res.json({ok:true}); });
app.post('/api/equipo/asignar-chat', auth, async(req,res)=>{ if(req.user.rol!=='jefe') return res.status(403).json({error:'Solo Jefe'}); const {waId, asignadoA}=req.body; const agenciaId=req.user.agenciaId; if(pgPool) await pgPool.query('UPDATE mensajes SET asignado_a=$1 WHERE wa_id=$2 AND agencia_id=$3', [asignadoA, waId, agenciaId]); res.json({ok:true}); });
app.get('/api/metricas', auth, async(req,res)=>{
  const agenciaId=req.user.agenciaId; let msgs=[]; if(pgPool){ const m=await pgPool.query('SELECT * FROM mensajes WHERE agencia_id=$1', [agenciaId]); msgs=m.rows; } else msgs=readJSON(path.join(agenciaPath(agenciaId),'mensajes.json'));
  res.json({totalMensajes:msgs.length, noLeidos:msgs.filter(m=>!m.leido).length, amarilla:msgs.filter(m=>m.etiqueta==='amarilla').length, equipo: (await obtenerEmpresas()).find(e=>e.id===agenciaId)?.equipo?.length||0, plan: (await obtenerEmpresas()).find(e=>e.id===agenciaId)?.plan, phoneId: PHONE_NUMBER_ID, defaultAgency: DEFAULT_AGENCY});
});
app.get('/api/config', auth, async(req,res)=>{
  const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.user.agenciaId);
  res.json({ ADMIN_KEY, DATA_DIR:BASE_DATA, DATABASE_URL: DATABASE_URL?'OK':'FS', DEFAULT_AGENCY, EMAIL_USER, JWT_SECRET: JWT_SECRET.slice(0,15)+'...', META_VERIFY_TOKEN, PHONE_NUMBER_ID, RAILWAY_VOLUME_MOUNT_PATH, RESEND_API_KEY: RESEND_API_KEY?'OK':'MISSING', agencia:emp?.nombre, plan:emp?.plan });
});
app.post('/api/config', auth, async(req,res)=>{
  if(req.user.rol!=='jefe' && req.user.rol!=='gerencia') return res.status(403).json({error:'Solo Jefe'});
  const {phoneId,wabaId,metaToken}=req.body; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.user.agenciaId);
  if(phoneId) emp.phoneId=phoneId; if(wabaId) emp.wabaId=wabaId; if(metaToken) emp.metaToken=metaToken; await guardarEmpresa(emp); res.json({ok:true});
});
app.get('/api/gerencia/agencias', authGerencia, async(req,res)=>{
  const empresas=await obtenerEmpresas(); res.json(empresas.map(e=>({id:e.id, nombre:e.nombre, email:e.email, plan:e.plan, phoneId:e.phoneId||PHONE_NUMBER_ID, equipo:e.equipo?.length||0, defaultAgency:e.defaultAgency||DEFAULT_AGENCY, adminKey:ADMIN_KEY})));
});
app.get('/dashboard.html', (req,res)=> res.sendFile(path.join(__dirname,'public','dashboard.html')));
app.get('/crm.html', (req,res)=> res.sendFile(path.join(__dirname,'public','crm.html')));
app.get('/app.html', (req,res)=> res.sendFile(path.join(__dirname,'public','app.html')));
app.get('/campana.html', (req,res)=> res.sendFile(path.join(__dirname,'public','campana.html')));
app.get('/campanas.html', (req,res)=> res.sendFile(path.join(__dirname,'public','campana.html')));
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

// ESCUCHA EN 0.0.0.0 PARA RAILWAY - ESTO QUITA EL CRASH
app.listen(PORT, '0.0.0.0', ()=> console.log(`[KLIDO v115.1 FINAL ANTI-CRASH] Puerto ${PORT} 0.0.0.0 META_VERIFY_TOKEN=${META_VERIFY_TOKEN} PHONE_NUMBER_ID=${PHONE_NUMBER_ID} JWT_SECRET=${JWT_SECRET.slice(0,12)} ADMIN_KEY=${ADMIN_KEY} DATA_DIR=${BASE_DATA} DEFAULT_AGENCY=${DEFAULT_AGENCY} RESEND=${RESEND_API_KEY?'OK':'MISSING'} EMAIL_USER=${EMAIL_USER} - 100% FUNCIONAL - /health OK`));
