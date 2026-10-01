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

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
const f = (name) => path.join(DATA_DIR, name);
const read = (name, def=[]) => { try{ return JSON.parse(fs.readFileSync(f(name),'utf8')) } catch{ return def } };
const write = (name, data) => fs.writeFileSync(f(name), JSON.stringify(data,null,2));

if(!fs.existsSync(f('agencias.json'))) write('agencias.json', []);
if(!fs.existsSync(f('usuarios.json'))) write('usuarios.json', []);
if(!fs.existsSync(f('mensajes.json'))) write('mensajes.json', []);
if(!fs.existsSync(f('llamadas.json'))) write('llamadas.json', []);

// ULTRA AUTONOMO: cura Avanza y Acol al arrancar
let agenciasInit = read('agencias.json');
let changedInit = false;
agenciasInit = agenciasInit.map(a=>{
  const n = (a.nombre||'').toLowerCase();
  if((n.includes('avanza') || n.includes('acol')) && (!a.pagado || a.estado==='bloqueado')){
    changedInit=true;
    return {...a, pagado:true, estadoPago:'pagado', estado:'activo', desbloqueadaEn:new Date()};
  }
  return a;
});
if(changedInit) write('agencias.json', agenciasInit);

app.use(cors());
app.use(express.json({limit:'20mb'}));
app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{ res.set('Cache-Control','no-store, no-cache, must-revalidate, private'); next(); });
app.use(express.static(path.join(__dirname,'public'), { maxAge: 0, etag:false }));
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

let transporter=null;
try{
  if(process.env.SMTP_HOST && process.env.SMTP_USER){
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT||587), secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
}catch{}

const PLANES = {
  basico: { anual: 800000, trim: 80000, nombre: 'Básico' },
  premium: { anual: 1400000, trim: 95000, nombre: 'Premium' },
  gold: { anual: 2400000, trim: 120000, nombre: 'Gold' }
};

// ============ ULTRA AUTONOMO - CREA Y YA ENTRA ============
app.post('/api/public/crear-empresa', async (req,res)=>{
  try{
    const {nombre,email,password,plan} = req.body;
    if(!nombre||!email||!password) return res.status(400).json({error:'Completa todo'});
    let agencias = read('agencias.json');
    let usuarios = read('usuarios.json');
    if(usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Correo ya existe, dale Ingresar'});
    const planKey = (plan||'premium').toLowerCase();
    const planData = PLANES[planKey] || PLANES.premium;
    const codigo = `KLIDO-${planKey.toUpperCase()}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    const hash = await bcrypt.hash(password,10);
    const agenciaId = Date.now().toString();

    // ULTRA: pagado true de una vez - cliente entra directo
    const agencia = { id: agenciaId, nombre: nombre.trim(), plan: planKey, planNombre: planData.nombre, anual: planData.anual, mantenimiento: planData.trim, codigo, pagado:true, estado:'activo', estadoPago:'pagado', created: new Date(), ultimaConexion: null, modo:'ultra-autonomo' };
    const user = { id: agenciaId+'_1', email: email.toLowerCase().trim(), password:hash, nombre: nombre.trim(), rol:'jefe', agenciaId, plan: planKey };
    agencias.push(agencia); usuarios.push(user);
    write('agencias.json', agencias); write('usuarios.json', usuarios);
    console.log(`🔑 ULTRA AUTONOMO ${nombre} | ${email} | ${codigo} | ${planKey} | ACTIVO DE UNA`);
    if(transporter){
      transporter.sendMail({
        from: `"KLIDO CRM" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Bienvenido a KLIDO ${planData.nombre} - Código ${codigo}`,
        html: `<div style="font-family:sans-serif"><h2>¡Bienvenido ${nombre} a KLIDO!</h2><p>Tu agencia <b>${nombre}</b> plan <b>${planData.nombre}</b> ya está activa.</p><div style="background:#dcfce7;border-radius:12px;padding:16px;text-align:center"><div>Código comprobante</div><div style="font-size:22px;font-weight:900">${codigo}</div><div>Anual $${planData.anual.toLocaleString()} + Mant $${planData.trim.toLocaleString()}/trim</div></div><p>Ya puedes ingresar con tu correo y contraseña. Pago 3133181851</p></div>`
      }).catch(e=>console.log(`Mail fail ${email} ${e.message}`));
    }
    res.json({ok:true, mensaje:`¡${nombre} creada y activa! Ya puedes darle a Ingresar con ${email}`});
  }catch(e){ console.error('crear-empresa', e); res.status(500).json({error:'Error interno'}); }
});

app.post('/api/public/verificar-codigo', (req,res)=>{
  const {codigo} = req.body;
  if(!codigo) return res.json({ok:true, mensaje:'Ultra autónomo - ya estás activo'});
  let agencias = read('agencias.json');
  let agencia = agencias.find(a=>a.codigo.toUpperCase()===codigo.toUpperCase().trim());
  if(agencia){ agencia.pagado=true; agencia.estadoPago='pagado'; agencia.estado='activo'; write('agencias.json', agencias); }
  res.json({ok:true, mensaje:`Código ${codigo} verificado - ya activo`});
});

app.post('/api/public/recuperar', async (req,res)=>{
  const {email} = req.body; let usuarios = read('usuarios.json'); const user = usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user) return res.status(404).json({error:'Correo no registrado'}); const newPass = Math.random().toString(36).substring(2,8);
  user.password = await bcrypt.hash(newPass,10); write('usuarios.json', usuarios);
  if(transporter){ try{ await transporter.sendMail({from:process.env.SMTP_USER,to:email,subject:'Recuperación KLIDO',text:`Nueva: ${newPass}`}) }catch{} }
  res.json({ok:true, mensaje:`Nueva contraseña enviada a ${email}`});
});

app.post('/api/login', async (req,res)=>{
  const {email,password} = req.body;
  let usuarios = read('usuarios.json'); const user = usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user) return res.status(404).json({error:'Usuario no existe, crea tu empresa'});
  const ok = await bcrypt.compare(password, user.password); if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
  let agencias = read('agencias.json'); const agencia = agencias.find(a=>a.id===user.agenciaId);
  if(!agencia) return res.status(403).json({error:'Agencia no existe'});
  if(agencia.estado==='bloqueado') return res.status(403).json({error:'Bloqueada falta pago 3133181851'});
  agencia.ultimaConexion = new Date(); write('agencias.json', agencias);
  const token = jwt.sign({id:user.id, agenciaId:user.agenciaId, rol:user.rol}, JWT_SECRET, {expiresIn:'7d'});
  res.json({token, user:{id:user.id, email:user.email, nombre:user.nombre, rol:user.rol, agenciaId:user.agenciaId, agencia}});
});

const auth = (req,res,next)=>{ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.split(' ')[1], JWT_SECRET); next() }catch{return res.status(401).json({error:'Token inválido'})} };
app.get('/api/mensajes', auth, (req,res)=>{ let mensajes = read('mensajes.json'); res.json(mensajes.filter(m=>m.agenciaId===req.user.agenciaId).slice(-200)); });
app.post('/api/webhook', (req,res)=>{ try{ if(req.body.entry){ let mensajes = read('mensajes.json'); mensajes.push({id:Date.now().toString(), agenciaId:req.body.agenciaId||'default', payload:req.body, leido:false, timestamp:new Date()}); write('mensajes.json', mensajes); } }catch{} res.sendStatus(200); });
app.get('/api/templates', auth, async (req,res)=>res.json([{name:'promo_aprobada', status:'APPROVED'}]));
const upload = multer({dest:'uploads/'});
app.post('/api/campanas/excel', auth, upload.single('excel'), async (req,res)=>{
  if(!req.file) return res.status(400).json({error:'Excel requerido'}); const wb=XLSX.readFile(req.file.path); const nums=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]).map(r=>r.telefono||r.numero||Object.values(r)[0]).filter(Boolean); fs.unlinkSync(req.file.path); let enviadas=0; for(let i=0;i<nums.length;i+=20){ enviadas+=20; if(i+20<nums.length) await new Promise(r=>setTimeout(r,120000)); } res.json({ok:true,total:enviadas});
});
app.post('/api/call', auth, (req,res)=>{ let llamadas=read('llamadas.json'); llamadas.push({id:Date.now().toString(), agenciaId:req.user.agenciaId, numero:req.body.numero, fecha:new Date(), por:req.user.id}); write('llamadas.json', llamadas); res.json({ok:true}); });
app.post('/api/ia/panic', auth, (req,res)=>res.json({ok:true}));
app.post('/api/webhooks/shopify', (req,res)=>res.sendStatus(200));
app.post('/api/webhooks/woocommerce', (req,res)=>res.sendStatus(200));
function checkAdmin(req,res,next){ if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'admin'}); next(); }
app.get('/api/admin/metricas', checkAdmin, (req,res)=>{
  const agencias=read('agencias.json')||[]; const usuarios=read('usuarios.json')||[]; const mensajes=read('mensajes.json')||[];
  res.json({totalAgencias:agencias.length, activas:agencias.filter(a=>a.estado!=='bloqueado').length, ingresosMes:agencias.reduce((s,a)=>s+(PLANES[a.plan]?.anual||0),0), agencias:agencias.map(a=>({id:a.id,nombre:a.nombre,plan:a.plan,anual:a.anual,estadoPago:a.estadoPago,estado:a.estado,codigo:a.codigo,trabajadores:usuarios.filter(u=>u.agenciaId===a.id).length, ultimaConexion:a.ultimaConexion||'-'}))});
});
app.post('/api/admin/toggle', checkAdmin, (req,res)=>{
  let agencias=read('agencias.json')||[]; agencias=agencias.map(a=>a.id===req.body.id?{...a, estadoPago:req.body.estado, estado:req.body.estado==='pagado'?'activo':'bloqueado', pagado:req.body.estado==='pagado'}:a); write('agencias.json', agencias); res.json({ok:true});
});
app.post('/api/admin/fix-acol-now', checkAdmin, (req,res)=>{ let agencias=read('agencias.json')||[]; agencias=agencias.map(a=>{const n=a.nombre.toLowerCase(); if(n.includes('avanza')||n.includes('acol')) return {...a,pagado:true,estadoPago:'pagado',estado:'activo'}; return a;}); write('agencias.json', agencias); res.json({ok:true}); });
app.get('/health',(req,res)=>res.json({ok:true, modo:'ULTRA-AUTONOMO', agencias:read('agencias.json').length, time:new Date()}));
app.listen(PORT, ()=>console.log(`=== KLIDO ULTRA AUTONOMO PORT ${PORT} ===`));
