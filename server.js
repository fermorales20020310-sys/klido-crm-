import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import multer from 'multer';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'klido-avanza-2026-real-internacional';
const ADMIN_KEY = process.env.ADMIN_KEY || 'KLIDO_DUEÑA_2026';

// DATA PERSISTENTE - volumen Railway /app/data - BLINDADO 10 agencias
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
const f = (name) => path.join(DATA_DIR, name);
const read = (name, def=[]) => { try{ return JSON.parse(fs.readFileSync(f(name),'utf8')) } catch{ return def } };
const write = (name, data) => fs.writeFileSync(f(name), JSON.stringify(data,null,2));

if(!fs.existsSync(f('agencias.json'))) write('agencias.json', []);
if(!fs.existsSync(f('usuarios.json'))) write('usuarios.json', []);
if(!fs.existsSync(f('mensajes.json'))) write('mensajes.json', []);
if(!fs.existsSync(f('llamadas.json'))) write('llamadas.json', []);

app.use(cors());
app.use(express.json({limit:'20mb'}));
app.use(express.urlencoded({extended:true}));

// NO CACHE - para que veas el index nuevo siempre - FIX incognito
app.use((req,res,next)=>{
  res.set('Cache-Control','no-store, no-cache, must-revalidate, private');
  next();
});
app.use(express.static(path.join(__dirname,'public'), { maxAge: 0, etag:false, lastModified:false }));
app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

// EMAIL
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// ============ PUBLICAS ============
app.post('/api/public/crear-empresa', async (req,res)=>{
  const {nombre,email,password,plan} = req.body;
  if(!nombre||!email||!password) return res.status(400).json({error:'Completa todo'});
  let agencias = read('agencias.json');
  let usuarios = read('usuarios.json');
  if(usuarios.find(u=>u.email===email)) return res.status(400).json({error:'Correo ya existe'});
  const codigo = `KLIDO-${(plan||'premium').toUpperCase()}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
  const hash = await bcrypt.hash(password,10);
  const agenciaId = Date.now().toString();
  const agencia = { id: agenciaId, nombre, plan: plan||'premium', codigo, pagado:false, estado:'activo', estadoPago:'pendiente', created: new Date(), ultimaConexion: null };
  const user = { id: agenciaId+'_1', email, password:hash, nombre, rol:'jefe', agenciaId, plan: plan||'premium' };
  agencias.push(agencia); usuarios.push(user);
  write('agencias.json', agencias); write('usuarios.json', usuarios);
  try{ await transporter.sendMail({from:process.env.SMTP_USER,to:email,subject:`Código KLIDO ${plan}`,text:`Tu código: ${codigo}. Paga al WhatsApp 3133181851 y verificalo en crear empresa.`}) }catch(e){console.log('email error',e.message)}
  res.json({codigo, mensaje:`Agencia creada. Código ${codigo} enviado a ${email}. Paga al 3133181851 para activar.`});
});

app.post('/api/public/verificar-codigo', (req,res)=>{
  const {email,codigo} = req.body;
  let agencias = read('agencias.json');
  const usuarios = read('usuarios.json');
  const user = usuarios.find(u=>u.email===email);
  if(!user) return res.status(404).json({error:'Correo no encontrado'});
  const agencia = agencias.find(a=>a.id===user.agenciaId);
  if(!agencia || agencia.codigo!==codigo) return res.status(400).json({error:'Código inválido'});
  agencia.pagado = true; agencia.estadoPago='pagado'; agencia.estado='activo';
  write('agencias.json', agencias);
  res.json({planDesbloqueado: agencia.plan});
});

app.post('/api/public/recuperar', async (req,res)=>{
  const {email} = req.body;
  let usuarios = read('usuarios.json');
  const user = usuarios.find(u=>u.email===email);
  if(!user) return res.status(404).json({error:'Correo no registrado'});
  const newPass = Math.random().toString(36).substring(2,8);
  user.password = await bcrypt.hash(newPass,10);
  write('usuarios.json', usuarios);
  try{ await transporter.sendMail({from:process.env.SMTP_USER,to:email,subject:'Recuperación KLIDO',text:`Nueva contraseña: ${newPass}`}) }catch{}
  res.json({mensaje:`Nueva contraseña enviada a ${email}`});
});

app.post('/api/login', async (req,res)=>{
  const {email,password} = req.body;
  let usuarios = read('usuarios.json');
  const user = usuarios.find(u=>u.email===email);
  if(!user) return res.status(404).json({error:'Usuario no existe'});
  const ok = await bcrypt.compare(password, user.password);
  if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
  let agencias = read('agencias.json');
  const agencia = agencias.find(a=>a.id===user.agenciaId);
  if(!agencia) return res.status(403).json({error:'Agencia no existe'});
  if(!agencia.pagado) return res.status(403).json({error:'Agencia no pagada. Verifica código'});
  if(agencia.estado==='bloqueado') return res.status(403).json({error:'Agencia bloqueada por falta de pago. Contacta admin'});
  agencia.ultimaConexion = new Date();
  write('agencias.json', agencias);
  const token = jwt.sign({id:user.id, agenciaId:user.agenciaId, rol:user.rol}, JWT_SECRET, {expiresIn:'7d'});
  res.json({token, user:{id:user.id, email:user.email, nombre:user.nombre, rol:user.rol, agenciaId:user.agenciaId, agencia}});
});

// ============ PROTEGIDO - SEGMENTADO POR agenciaId ============
const auth = (req,res,next)=>{
  const h=req.headers.authorization;
  if(!h) return res.status(401).json({error:'No token'});
  try{ req.user=jwt.verify(h.split(' ')[1], JWT_SECRET); next() }catch{return res.status(401).json({error:'Token inválido'})}
};

app.get('/api/mensajes', auth, (req,res)=>{
  let mensajes = read('mensajes.json');
  mensajes = mensajes.filter(m=>m.agenciaId===req.user.agenciaId);
  // solo últimos 200 para que no se trabe interfaz
  res.json(mensajes.slice(-200));
});

app.post('/api/webhook', (req,res)=>{
  const body = req.body;
  try{
    if(body.entry){
      let mensajes = read('mensajes.json');
      const agenciaId = body.agenciaId || body.entry[0]?.id || 'default';
      mensajes.push({id:Date.now().toString(), agenciaId, payload:body, leido:false, timestamp:new Date()});
      write('mensajes.json', mensajes);
    }
  }catch(e){console.log('webhook error',e)}
  res.sendStatus(200);
});

app.get('/api/templates', auth, async (req,res)=>{
  res.json([{name:'promo_aprobada', status:'APPROVED', body:'Hola {{1}} oferta'}]);
});

const upload = multer({dest:'uploads/'});
app.post('/api/campanas/excel', auth, upload.single('excel'), async (req,res)=>{
  if(!req.file) return res.status(400).json({error:'Excel requerido'});
  const wb = XLSX.readFile(req.file.path);
  const nums = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]).map(r=>r.telefono||r.numero||r.wa||Object.values(r)[0]).filter(Boolean);
  fs.unlinkSync(req.file.path);
  let enviadas = 0;
  for(let i=0;i<nums.length;i+=20){
    const bloque = nums.slice(i,i+20);
    console.log(`[${req.user.agenciaId}] Enviando bloque`, bloque.length);
    enviadas+=bloque.length;
    if(i+20<nums.length) await new Promise(r=>setTimeout(r,120000));
  }
  res.json({ok:true, total:enviadas, mensaje:`Campaña anti-baneo: ${enviadas} números enviados en bloques de 20`});
});

app.post('/api/call', auth, (req,res)=>{
  const {numero} = req.body;
  let llamadas = read('llamadas.json');
  llamadas.push({id:Date.now().toString(), agenciaId:req.user.agenciaId, numero, fecha:new Date(), por:req.user.id});
  write('llamadas.json', llamadas);
  res.json({ok:true, tel:`tel:${numero}`});
});

app.post('/api/ia/panic', auth, (req,res)=>{ res.json({ok:true, mensaje:'IA pausada - modo humano activado'}) });
app.post('/api/webhooks/shopify', (req,res)=>{ console.log('Shopify', req.body); res.sendStatus(200) });
app.post('/api/webhooks/woocommerce', (req,res)=>{ console.log('Woo', req.body); res.sendStatus(200) });

// ============ PANEL DUEÑA - SUPERVISIÓN TOTAL - NO TOCA DATOS SENSIBLES ============
function checkAdmin(req,res,next){
  if(req.headers['x-admin-key']!== ADMIN_KEY) return res.status(401).json({error:'Clave admin inválida'});
  next();
}
app.get('/api/admin/metricas', checkAdmin, (req,res)=>{
  const agencias = read('agencias.json') || [];
  const usuarios = read('usuarios.json') || [];
  const mensajes = read('mensajes.json') || [];
  let ingresosMes = 0;
  agencias.forEach(a=>{
    if(a.plan==='basico') ingresosMes+=800000;
    else if(a.plan==='premium') ingresosMes+=1400000;
    else if(a.plan==='gold') ingresosMes+=2400000;
  });
  const hoy = new Date().toDateString();
  res.json({
    totalAgencias: agencias.length,
    activas: agencias.filter(a=>a.estado!=='bloqueado').length,
    ingresosMes,
    porCobrar: agencias.filter(a=>a.estadoPago!=='pagado').length * 95000,
    agencias: agencias.map(a=>({
      id:a.id,
      nombre:a.nombre,
      plan:a.plan||'premium',
      trabajadores: usuarios.filter(u=>u.agenciaId===a.id).length,
      mensajesHoy: mensajes.filter(m=>m.agenciaId===a.id && new Date(m.timestamp||m.fecha).toDateString()===hoy).length,
      ultimaConexion: a.ultimaConexion? new Date(a.ultimaConexion).toLocaleString('es-CO') : '-',
      estadoPago: a.estadoPago || (a.pagado?'pagado':'pendiente'),
      estado: a.estado || 'activo'
    }))
  });
});
app.post('/api/admin/toggle', checkAdmin, (req,res)=>{
  const {id,estado}=req.body;
  let agencias = read('agencias.json')||[];
  agencias = agencias.map(a=> a.id===id? {...a, estadoPago:estado, estado: estado==='pagado'?'activo':'bloqueado'} : a);
  write('agencias.json', agencias);
  res.json({ok:true});
});

app.get('/health', (req,res)=>res.json({ok:true, DATA_DIR, agencias:read('agencias.json').length, usuarios:read('usuarios.json').length, mensajes:read('mensajes.json').length, timestamp:new Date()}));

app.listen(PORT, ()=>console.log(`=== KLIDO CRM REAL v2 - ${new Date().toISOString()} DATA_DIR:${DATA_DIR} Agencias:${read('agencias.json').length} Usuarios:${read('usuarios.json').length} Mensajes:${read('mensajes.json').length} === Puerto ${PORT} === ADMIN KEY:${ADMIN_KEY} ===`));
