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
const PUBLIC_DIR = path.join(__dirname, 'public');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR,{recursive:true});

const f = (name) => path.join(DATA_DIR, name);
const read = (name, def=[]) => { try{ return JSON.parse(fs.readFileSync(f(name),'utf8')) } catch{ return def } };
const write = (name, data) => fs.writeFileSync(f(name), JSON.stringify(data,null,2));

if(!fs.existsSync(f('agencias.json'))) write('agencias.json', []);
if(!fs.existsSync(f('usuarios.json'))) write('usuarios.json', []);
if(!fs.existsSync(f('mensajes.json'))) write('mensajes.json', []);
if(!fs.existsSync(f('llamadas.json'))) write('llamadas.json', []);

// ===== PARCHE ANTI Cannot GET /crm.html =====
if(!fs.existsSync(path.join(PUBLIC_DIR,'index.html'))){
  fs.writeFileSync(path.join(PUBLIC_DIR,'index.html'), `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KLIDO CRM</title></head><body><h1 style="font-family:sans-serif;text-align:center;margin-top:100px;">KLIDO CRM - Cargando sistema...</h1><p style="text-align:center;">Si ves esto, sube tu public original con: git add -f public/*</p><script>if(location.pathname==='/') setTimeout(()=>{fetch('/api/public/crm-check').then(r=>r.json()).then(d=>{if(d.hasCrm) location.href='/crm.html'}).catch(()=>{});},1500)</script></body></html>`);
}

// ===== ULTRA AUTONOMO + FIX AVANZA GOLD DEFINITIVO =====
const AVANZA_EMAIL = 'avanzaconsultingyl@gmail.com';
const AVANZA_PASS = 'Mafe2002@';
let agenciasInit = read('agencias.json');
let usuariosInit = read('usuarios.json');
let changed = false;

let avanzaAg = agenciasInit.find(a => (a.nombre||'').toLowerCase().includes('avanza'));
if(!avanzaAg){
  avanzaAg = { id: 'avanza-gold-'+Date.now(), nombre:'Avanza Consulting', plan:'gold', planNombre:'Gold', anual:2400000, mantenimiento:120000, codigo:'KLIDO-GOLD-MAFE-2026', pagado:true, estado:'activo', estadoPago:'pagado', created:new Date(), ultimaConexion:new Date() };
  agenciasInit.push(avanzaAg); changed=true;
} else {
  avanzaAg.plan='gold'; avanzaAg.planNombre='Gold'; avanzaAg.pagado=true; avanzaAg.estado='activo'; avanzaAg.estadoPago='pagado'; changed=true;
}
let avanzaUser = usuariosInit.find(u => u.email.toLowerCase()===AVANZA_EMAIL);
const hashMafe = bcrypt.hashSync(AVANZA_PASS, 10);
if(!avanzaUser){
  avanzaUser = { id: avanzaAg.id+'_1', email: AVANZA_EMAIL, password: hashMafe, nombre:'Avanza Consulting', rol:'jefe', agenciaId: avanzaAg.id, plan:'gold' };
  usuariosInit.push(avanzaUser); changed=true;
} else {
  avanzaUser.password = hashMafe; avanzaUser.agenciaId = avanzaAg.id; avanzaUser.plan='gold'; changed=true;
}
agenciasInit = agenciasInit.map(a=>{ const n=(a.nombre||'').toLowerCase(); if(n.includes('acol')||n.includes('avanza')) return {...a, pagado:true, estado:'activo', estadoPago:'pagado', plan: n.includes('avanza')?'gold':a.plan}; return a; });
if(changed){ write('agencias.json', agenciasInit); write('usuarios.json', usuariosInit); console.log('AVANZA GOLD FORZADA: '+AVANZA_EMAIL+' / '+AVANZA_PASS); }

app.use(cors());
app.use(express.json({limit:'20mb'}));
app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });
app.use(express.static(PUBLIC_DIR));

let transporter=null;
try{ if(process.env.SMTP_HOST && process.env.SMTP_USER){ transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT||587), secure:false, auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS} }); } }catch{}
const PLANES = { basico:{anual:800000, trim:80000, nombre:'Básico'}, premium:{anual:1400000, trim:95000, nombre:'Premium'}, gold:{anual:2400000, trim:120000, nombre:'Gold'} };

app.get('/api/public/crm-check',(req,res)=>{ res.json({hasCrm: fs.existsSync(path.join(PUBLIC_DIR,'crm.html'))}); });
app.post('/api/public/crear-empresa', async (req,res)=>{
  try{
    const {nombre,email,password,plan}=req.body;
    if(!nombre||!email||!password) return res.status(400).json({error:'Completa todo'});
    let agencias=read('agencias.json'); let usuarios=read('usuarios.json');
    if(usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Correo ya existe, dale Ingresar'});
    const planKey=(plan||'premium').toLowerCase(); const planData=PLANES[planKey]||PLANES.premium;
    const codigo=`KLIDO-${planKey.toUpperCase()}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    const hash=await bcrypt.hash(password,10); const id=Date.now().toString();
    const agencia={id, nombre:nombre.trim(), plan:planKey, planNombre:planData.nombre, anual:planData.anual, mantenimiento:planData.trim, codigo, pagado:true, estado:'activo', estadoPago:'pagado', created:new Date(), modo:'ultra-autonomo'};
    const user={id:id+'_1', email:email.toLowerCase().trim(), password:hash, nombre:nombre.trim(), rol:'jefe', agenciaId:id, plan:planKey};
    agencias.push(agencia); usuarios.push(user); write('agencias.json', agencias); write('usuarios.json', usuarios);
    res.json({ok:true, mensaje:`¡${nombre} creada y activa! Ya puedes Ingresar`});
  }catch(e){ console.error(e); res.status(500).json({error:'Error interno'}); }
});
app.post('/api/public/verificar-codigo', (req,res)=>res.json({ok:true, mensaje:'Ultra autónomo - ya activo'}));
app.post('/api/public/recuperar', async (req,res)=>{
  const {email}=req.body; let usuarios=read('usuarios.json'); const user=usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user) return res.status(404).json({error:'No existe'}); const newPass=Math.random().toString(36).slice(2,8);
  user.password=await bcrypt.hash(newPass,10); write('usuarios.json', usuarios);
  if(transporter){ try{ await transporter.sendMail({from:process.env.SMTP_USER,to:email,subject:'KLIDO nueva clave',text:`Nueva: ${newPass}`}) }catch{} }
  res.json({ok:true, mensaje:`Nueva clave enviada`});
});
app.post('/api/login', async (req,res)=>{
  const {email,password}=req.body; let usuarios=read('usuarios.json'); const user=usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase().trim());
  if(!user) return res.status(404).json({error:'Usuario no existe'}); if(!await bcrypt.compare(password, user.password)) return res.status(401).json({error:'Contraseña incorrecta'});
  let agencias=read('agencias.json'); const agencia=agencias.find(a=>a.id===user.agenciaId);
  if(!agencia) return res.status(403).json({error:'Agencia no existe'}); agencia.ultimaConexion=new Date(); write('agencias.json', agencias);
  const token=jwt.sign({id:user.id, agenciaId:user.agenciaId, rol:user.rol}, JWT_SECRET, {expiresIn:'7d'});
  res.json({token, user:{id:user.id, email:user.email, nombre:user.nombre, rol:user.rol, agenciaId:user.agenciaId, agencia}});
});
const auth=(req,res,next)=>{ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.split(' ')[1], JWT_SECRET); next() }catch{return res.status(401).json({error:'Token inválido'})} };
app.get('/api/mensajes', auth, (req,res)=>{ let m=read('mensajes.json'); res.json(m.filter(x=>x.agenciaId===req.user.agenciaId).slice(-200)); });
app.post('/api/webhook', (req,res)=>{ try{ let m=read('mensajes.json'); m.push({id:Date.now().toString(), payload:req.body, timestamp:new Date()}); write('mensajes.json', m); }catch{} res.sendStatus(200); });
app.get('/api/templates', auth, async (req,res)=>res.json([{name:'promo_aprobada', status:'APPROVED'}]));
const upload=multer({dest:'uploads/'}); app.post('/api/campanas/excel', auth, upload.single('excel'), async (req,res)=>{ if(!req.file) return res.status(400).json({error:'Excel'}); const wb=XLSX.readFile(req.file.path); const nums=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]).map(r=>r.telefono||r.numero||Object.values(r)[0]).filter(Boolean); fs.unlinkSync(req.file.path); res.json({ok:true,total:nums.length}); });
app.post('/api/call', auth, (req,res)=>{ let ll=read('llamadas.json'); ll.push({id:Date.now().toString(), agenciaId:req.user.agenciaId, numero:req.body.numero, fecha:new Date()}); write('llamadas.json', ll); res.json({ok:true}); });
app.post('/api/ia/panic', auth, (req,res)=>res.json({ok:true}));
app.post('/api/webhooks/shopify',(req,res)=>res.sendStatus(200));
app.post('/api/webhooks/woocommerce',(req,res)=>res.sendStatus(200));
function checkAdmin(req,res,next){ if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'admin'}); next(); }
app.get('/api/admin/metricas', checkAdmin, (req,res)=>{ const agencias=read('agencias.json')||[]; const usuarios=read('usuarios.json')||[]; res.json({totalAgencias:agencias.length, activas:agencias.filter(a=>a.estado!=='bloqueado').length, ingresosMes:agencias.reduce((s,a)=>s+(PLANES[a.plan]?.anual||0),0), agencias:agencias.map(a=>({id:a.id,nombre:a.nombre,plan:a.plan,anual:a.anual,estadoPago:a.estadoPago,estado:a.estado,codigo:a.codigo,trabajadores:usuarios.filter(u=>u.agenciaId===a.id).length, ultimaConexion:a.ultimaConexion||'-'}))}); });
app.post('/api/admin/toggle', checkAdmin, (req,res)=>{ let agencias=read('agencias.json')||[]; agencias=agencias.map(a=>a.id===req.body.id?{...a,estadoPago:req.body.estado,estado:req.body.estado==='pagado'?'activo':'bloqueado',pagado:req.body.estado==='pagado'}:a); write('agencias.json', agencias); res.json({ok:true}); });
app.post('/api/admin/fix-acol-now', checkAdmin, (req,res)=>{ let agencias=read('agencias.json')||[]; agencias=agencias.map(a=>{const n=a.nombre.toLowerCase(); if(n.includes('avanza')||n.includes('acol')) return {...a,pagado:true,estadoPago:'pagado',estado:'activo', plan: n.includes('avanza')?'gold':a.plan}; return a;}); write('agencias.json', agencias); res.json({ok:true}); });
app.get('/health',(req,res)=>res.json({ok:true, modo:'ULTRA-AUTONOMO-GOLD-PARCHEADO', hasCrm:fs.existsSync(path.join(PUBLIC_DIR,'crm.html')), hasIndex:fs.existsSync(path.join(PUBLIC_DIR,'index.html')), agencias:read('agencias.json').length, avanza:'avanzaconsultingyl@gmail.com / Mafe2002@ GOLD'}));

 // ===== PARCHE FINAL ANTI Cannot GET =====
app.get('/crm.html', (req,res)=>{
  const crmPath = path.join(PUBLIC_DIR,'crm.html');
  if(fs.existsSync(crmPath)) return res.sendFile(crmPath);
  const idxPath = path.join(PUBLIC_DIR,'index.html');
  if(fs.existsSync(idxPath)) return res.sendFile(idxPath);
  return res.status(200).send(`<h1>KLIDO ULTRA AUTONOMO GOLD ACTIVO</h1><p>Avanza: avanzaconsultingyl@gmail.com / Mafe2002@</p><p>Sube tu public original con: git add -f public/* && git push</p>`);
});
app.get('*', (req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'api no existe'});
  const idxPath = path.join(PUBLIC_DIR,'index.html');
  if(fs.existsSync(idxPath)) return res.sendFile(idxPath);
  return res.send(`<h1>KLIDO ULTRA AUTONOMO GOLD</h1><p>Entra a /health para verificar</p>`);
});

app.listen(PORT, ()=>console.log(`=== KLIDO ULTRA GOLD PARCHEADO ${PORT} === AVANZA Mafe2002@ ===`));
