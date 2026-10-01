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
const JWT_SECRET = process.env.JWT_SECRET || 'klido-avanza-real-2026';
const ADMIN_KEY = process.env.ADMIN_KEY || 'KLIDO_DUEÑA_2026';

const DATA_DIR = path.join(__dirname,'data');
const PUBLIC_DIR = path.join(__dirname,'public');
const UPLOAD_DIR = path.join(__dirname,'uploads');
[DATA_DIR,PUBLIC_DIR,UPLOAD_DIR].forEach(d=>{if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true})});

const f = n => path.join(DATA_DIR,n);
const read = (n,d=[]) => { try{return JSON.parse(fs.readFileSync(f(n),'utf8'))}catch{return d}};
const write = (n,data) => fs.writeFileSync(f(n), JSON.stringify(data,null,2));

['agencias.json','usuarios.json','mensajes.json','llamadas.json','codigos.json','campanas.json','clientes.json'].forEach(file=>{if(!fs.existsSync(f(file))) write(file,[])});

let transporter=null;
const SMTP_USER = process.env.SMTP_USER || 'fermorales20020310@gmail.com';
try{
  transporter = nodemailer.createTransport({
    service:'gmail',
    auth:{user:SMTP_USER, pass:process.env.SMTP_PASS}
  });
}catch(e){console.log('SMTP no configurado, poner SMTP_PASS en Railway')}

const PLANES={ basico:{anual:800000,trim:80000,nombre:'Básico',ia:false,call:false}, premium:{anual:1400000,trim:95000,nombre:'Premium',ia:true,call:false}, gold:{anual:2400000,trim:120000,nombre:'Gold',ia:true,call:true} };

const AVANZA_EMAIL='avanzaconsultingyl@gmail.com';
let agencias=read('agencias.json'); let usuarios=read('usuarios.json');
if(!agencias.find(a=>a.nombre.toLowerCase().includes('avanza'))){ agencias.push({id:'avanza-gold-1',nombre:'Avanza Consulting',plan:'gold',planNombre:'Gold',anual:2400000,mantenimiento:120000,codigo:'KLIDO-GOLD-MAFE-2026',pagado:true,estado:'activo',estadoPago:'pagado',created:new Date()}); write('agencias.json',agencias); agencias=read('agencias.json');}
let avanzaAg=agencias.find(a=>a.nombre.toLowerCase().includes('avanza'));
let avanzaUser=usuarios.find(u=>u.email.toLowerCase()===AVANZA_EMAIL);
if(!avanzaUser){ usuarios.push({id:avanzaAg.id+'_1',email:AVANZA_EMAIL,password:bcrypt.hashSync('Mafe2002@',10),nombre:'Avanza Consulting',rol:'jefe',agenciaId:avanzaAg.id,plan:'gold',aceptoTerminos:true}); write('usuarios.json',usuarios); }
else{ avanzaUser.password=bcrypt.hashSync('Mafe2002@',10); avanzaUser.plan='gold'; avanzaUser.agenciaId=avanzaAg.id; write('usuarios.json',usuarios); }

app.use(cors()); app.use(express.json({limit:'20mb'})); app.use(express.urlencoded({extended:true}));
app.use(express.static(PUBLIC_DIR));

function genCodigo(){ return Math.floor(100000+Math.random()*900000).toString(); }

app.post('/api/public/solicitar-codigo', async (req,res)=>{
  const {email, tipo} = req.body;
  const codigo=genCodigo(); let codigos=read('codigos.json');
  codigos = codigos.filter(c=>c.email.toLowerCase()!==email.toLowerCase()); 
  codigos.push({email:email.toLowerCase(), codigo, tipo, expira: Date.now()+15*60*1000, usado:false});
  write('codigos.json', codigos);
  if(transporter){
    try{ 
      await transporter.sendMail({ 
        from:`KLIDO CRM <${SMTP_USER}>`, 
        to: email, 
        subject: tipo==='registro' || tipo==='recuperacion' ? (tipo==='registro' ? 'Código de verificación KLIDO' : 'Código recuperación KLIDO') : 'Código KLIDO',
        html:`<div style="font-family:sans-serif;max-width:400px"><h2 style="color:#0f172a">KLIDO CRM</h2><p>Tu código de verificación es:</p><h1 style="background:#0f172a;color:#f59e0b;padding:16px;border-radius:10px;letter-spacing:5px;text-align:center">${codigo}</h1><p>Expira en 15 minutos. Si no solicitaste esto, ignora este correo.</p><p style="font-size:11px;color:#94a3b8">Enviado desde ${SMTP_USER} a solicitud de ${email}</p></div>` 
      }); 
    }catch(e){console.log('Error enviando mail',e.message)}
  }
  // LINEA FINAL CORREGIDA - YA NO MUESTRA EL CODIGO EN PRODUCCION
  res.json({ok:true, mensaje:`Código enviado a ${email} - Revisa tu bandeja y spam`});
});

app.post('/api/public/verificar-codigo',(req,res)=>{
  const {email,codigo}=req.body; let codigos=read('codigos.json');
  const c=codigos.find(x=>x.email===email.toLowerCase() && x.codigo===codigo &&!x.usado && x.expira>Date.now());
  if(!c) return res.status(400).json({error:'Código inválido o expirado'});
  c.usado=true; write('codigos.json',codigos);
  res.json({ok:true});
});

app.post('/api/public/crear-empresa', async (req,res)=>{
  const {nombre,email,password,plan, aceptoTerminos}=req.body;
  if(!aceptoTerminos) return res.status(400).json({error:'Debes aceptar Términos y Condiciones'});
  let codigos=read('codigos.json'); const okCode=codigos.find(c=>c.email===email.toLowerCase() && c.usado);
  if(!okCode) return res.status(400).json({error:'Verifica tu correo con el código primero'});
  let agencias=read('agencias.json'); let usuarios=read('usuarios.json');
  if(usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Ya existe, dale Ingresar'});
  const planKey=(plan||'basico').toLowerCase(); const id=Date.now().toString();
  const agencia={id,nombre,plan:planKey,planNombre:PLANES[planKey].nombre,anual:PLANES[planKey].anual,mantenimiento:PLANES[planKey].trim,codigo:`KLIDO-${planKey.toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,pagado:true,estado:'activo',estadoPago:'pagado',created:new Date(),waToken:null,waPhoneId:null};
  const user={id:id+'_1',email:email.toLowerCase(),password:await bcrypt.hash(password,10),nombre,rol:'jefe',agenciaId:id,plan:planKey,aceptoTerminos:true};
  agencias.push(agencia); usuarios.push(user); write('agencias.json',agencias); write('usuarios.json',usuarios);
  res.json({ok:true, mensaje:'Empresa creada y activa'});
});

app.post('/api/public/recuperar-password', async (req,res)=>{
  const {email,nuevaPassword,codigo}=req.body; let codigos=read('codigos.json'); let usuarios=read('usuarios.json');
  const c=codigos.find(x=>x.email===email.toLowerCase() && x.codigo===codigo && x.expira>Date.now());
  if(!c) return res.status(400).json({error:'Código inválido'});
  const u=usuarios.find(x=>x.email.toLowerCase()===email.toLowerCase()); if(!u) return res.status(404).json({error:'No existe'});
  u.password=await bcrypt.hash(nuevaPassword,10); write('usuarios.json',usuarios);
  codigos=codigos.filter(x=>!(x.email===email.toLowerCase() && x.codigo===codigo)); write('codigos.json',codigos);
  res.json({ok:true, mensaje:'Contraseña actualizada'});
});

app.post('/api/login', async (req,res)=>{
  const {email,password}=req.body; const usuarios=read('usuarios.json'); const user=usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase().trim());
  if(!user) return res.status(404).json({error:'No existe'}); if(!await bcrypt.compare(password,user.password)) return res.status(401).json({error:'Contraseña incorrecta'});
  const agencias=read('agencias.json'); const agencia=agencias.find(a=>a.id===user.agenciaId); if(!agencia || agencia.estado==='bloqueado') return res.status(403).json({error:'Agencia bloqueada'});
  agencia.ultimaConexion=new Date(); write('agencias.json',agencias);
  const token=jwt.sign({id:user.id,agenciaId:user.agenciaId,rol:user.rol,email:user.email},JWT_SECRET,{expiresIn:'7d'});
  res.json({token,user:{id:user.id,email:user.email,nombre:user.nombre,rol:user.rol,agenciaId:user.agenciaId,plan:agencia.plan,agencia}});
});

const auth=(req,res,next)=>{ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.split(' ')[1],JWT_SECRET); next()}catch{return res.status(401).json({error:'Token invalido'})}};
const checkRole=(roles)=>(req,res,next)=>{ if(!roles.includes(req.user.rol)) return res.status(403).json({error:'Sin permiso'}); next(); };

app.get('/api/mensajes', auth, (req,res)=>{
  let mensajes=read('mensajes.json');
  let lista=mensajes.filter(m=>m.agenciaId===req.user.agenciaId);
  if(req.user.rol==='trabajador') lista=lista.filter(m=>!m.asignadoA || m.asignadoA===req.user.id);
  const {tipo}=req.query;
  if(tipo==='no_leidos') lista=lista.filter(m=>!m.leido);
  if(tipo==='respondidos') lista=lista.filter(m=>m.respondido);
  if(tipo && ['nuevo','recurrente','irrelevante'].includes(tipo)) lista=lista.filter(m=>m.segmento===tipo);
  res.json(lista.slice(-500).reverse());
});
app.post('/api/mensajes/segmentar', auth, (req,res)=>{ let mensajes=read('mensajes.json'); mensajes=mensajes.map(m=> m.id===req.body.id? {...m, segmento:req.body.segmento} : m); write('mensajes.json',mensajes); res.json({ok:true}); });
app.post('/api/mensajes/seguimiento', auth, (req,res)=>{ let mensajes=read('mensajes.json'); mensajes=mensajes.map(m=> m.id===req.body.id? {...m, seguimiento:req.body.nota, fechaSeguimiento:req.body.fecha, programado:req.body.fecha} : m); write('mensajes.json',mensajes); res.json({ok:true}); });
app.post('/api/mensajes/asignar', auth, checkRole(['jefe','admin']), (req,res)=>{ let mensajes=read('mensajes.json'); mensajes=mensajes.map(m=> m.id===req.body.id? {...m, asignadoA:req.body.trabajadorId} : m); write('mensajes.json',mensajes); res.json({ok:true}); });
app.get('/api/calendario', auth, (req,res)=>{ let mensajes=read('mensajes.json'); res.json(mensajes.filter(m=>m.agenciaId===req.user.agenciaId && m.programado)); });
app.get('/api/clientes', auth, (req,res)=>{ let c=read('clientes.json'); res.json(c.filter(x=>x.agenciaId===req.user.agenciaId)); });
app.post('/api/clientes/clasificar', auth, (req,res)=>{ let c=read('clientes.json'); c=c.map(x=> x.id===req.body.id? {...x, tipo:req.body.tipo} : x); write('clientes.json',c); res.json({ok:true}); });

app.get('/api/templates', auth, async (req,res)=>{
  const agencia=read('agencias.json').find(a=>a.id===req.user.agenciaId);
  if(agencia && agencia.waToken && agencia.waPhoneId){
    try{
      const r=await fetch(`https://graph.facebook.com/v20.0/${agencia.waPhoneId}/message_templates?access_token=${agencia.waToken}`);
      const j=await r.json(); if(j.data) return res.json(j.data);
    }catch(e){}
  }
  res.json([{name:'promo_aprobada', status:'APPROVED', language:'es'},{name:'bienvenida', status:'APPROVED', language:'es'}]);
});

const upload=multer({dest:UPLOAD_DIR});
app.post('/api/campanas/excel', auth, upload.single('excel'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:'Excel requerido'});
  const wb=XLSX.readFile(req.file.path); const sheet=wb.Sheets[wb.SheetNames[0]]; const rows=XLSX.utils.sheet_to_json(sheet);
  const nums=rows.map(r=>{ const v= r.telefono||r.Telefono||r.numero||r.Numero||r.phone||Object.values(r)[0]; return String(v).replace(/\D/g,''); }).filter(n=>n.length>=10);
  fs.unlinkSync(req.file.path);
  let campanas=read('campanas.json'); campanas.push({id:Date.now().toString(), agenciaId:req.user.agenciaId, total:nums.length, numeros:nums, plantilla:req.body.plantilla||'promo_aprobada', fecha:new Date(), por:req.user.id, estado:'pendiente'});
  write('campanas.json',campanas);
  res.json({ok:true,total:nums.length, numeros:nums.slice(0,5)});
});
app.get('/api/campanas/historial', auth, (req,res)=>{ let c=read('campanas.json'); res.json(c.filter(x=>x.agenciaId===req.user.agenciaId).reverse()); });
app.get('/api/metricas', auth, (req,res)=>{
  let mensajes=read('mensajes.json').filter(m=>m.agenciaId===req.user.agenciaId);
  let campanas=read('campanas.json').filter(c=>c.agenciaId===req.user.agenciaId);
  let llamadas=read('llamadas.json').filter(l=>l.agenciaId===req.user.agenciaId);
  res.json({ totalMensajes:mensajes.length, noLeidos:mensajes.filter(m=>!m.leido).length, respondidos:mensajes.filter(m=>m.respondido).length, campanas:campanas.length, llamadas:llamadas.length, conversion: mensajes.filter(m=>m.segmento==='recurrente').length });
});

app.post('/api/planes/cambiar', auth, checkRole(['jefe']), (req,res)=>{
  let agencias=read('agencias.json'); agencias=agencias.map(a=> a.id===req.user.agenciaId? {...a, plan:req.body.plan, planNombre:PLANES[req.body.plan].nombre} : a); write('agencias.json',agencias);
  let usuarios=read('usuarios.json'); usuarios=usuarios.map(u=> u.agenciaId===req.user.agenciaId? {...u, plan:req.body.plan} : u); write('usuarios.json',usuarios);
  res.json({ok:true, mensaje:`Cambiado a ${PLANES[req.body.plan].nombre}`});
});

app.get('/api/trabajadores', auth, checkRole(['jefe']), (req,res)=>{ let u=read('usuarios.json'); res.json(u.filter(x=>x.agenciaId===req.user.agenciaId)); });
app.post('/api/trabajadores', auth, checkRole(['jefe']), async (req,res)=>{
  let usuarios=read('usuarios.json'); const hash=await bcrypt.hash(req.body.password,10);
  usuarios.push({id:Date.now().toString(), email:req.body.email.toLowerCase(), password:hash, nombre:req.body.nombre, rol:'trabajador', agenciaId:req.user.agenciaId, plan:read('agencias.json').find(a=>a.id===req.user.agenciaId).plan});
  write('usuarios.json',usuarios); res.json({ok:true});
});
app.delete('/api/trabajadores/:id', auth, checkRole(['jefe']), (req,res)=>{ let u=read('usuarios.json'); u=u.filter(x=>x.id!==req.params.id); write('usuarios.json',u); res.json({ok:true}); });

app.post('/api/call', auth, (req,res)=>{
  let llamadas=read('llamadas.json'); const agencia=read('agencias.json').find(a=>a.id===req.user.agenciaId);
  if(agencia.plan!=='gold') return res.status(403).json({error:'Solo plan Gold tiene llamadas directas'});
  llamadas.push({id:Date.now().toString(), agenciaId:req.user.agenciaId, numero:req.body.numero, por:req.user.id, fecha:new Date()});
  write('llamadas.json',llamadas);
  res.json({ok:true, tel:`tel:${req.body.numero}`});
});

app.post('/api/webhook', (req,res)=>{ let m=read('mensajes.json'); const body=req.body; const numero=body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from || body.from || 'desconocido'; const texto=body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || body.text || JSON.stringify(body).slice(0,200); m.push({id:Date.now().toString(), agenciaId: body.agenciaId || agencias[0]?.id, numero, texto, leido:false, respondido:false, segmento:'nuevo', timestamp:new Date(), raw:body}); write('mensajes.json',m); res.sendStatus(200); });

function checkAdmin(req,res,next){ if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'No autorizado dueña'}); next(); }
app.get('/api/admin/metricas', checkAdmin, (req,res)=>{
  const agencias=read('agencias.json'); const usuarios=read('usuarios.json'); const campanas=read('campanas.json');
  res.json({ totalAgencias:agencias.length, activas:agencias.filter(a=>a.estado!=='bloqueado').length, porPlan:{basico:agencias.filter(a=>a.plan==='basico').length, premium:agencias.filter(a=>a.plan==='premium').length, gold:agencias.filter(a=>a.plan==='gold').length}, ingresos:agencias.reduce((s,a)=>s+(a.anual||0),0), agencias:agencias.map(a=>({id:a.id,nombre:a.nombre,plan:a.plan,anual:a.anual,estado:a.estado,estadoPago:a.estadoPago,trabajadores:usuarios.filter(u=>u.agenciaId===a.id).length,campanas:campanas.filter(c=>c.agenciaId===a.id).length, ultimaConexion:a.ultimaConexion})) });
});
app.post('/api/admin/toggle', checkAdmin, (req,res)=>{ let agencias=read('agencias.json'); agencias=agencias.map(a=> a.id===req.body.id? {...a, estado:req.body.estado==='pagado'?'activo':'bloqueado', estadoPago:req.body.estado, pagado:req.body.estado==='pagado'} : a); write('agencias.json',agencias); res.json({ok:true}); });

app.get('/health',(req,res)=>res.json({ok:true, modo:'KLIDO REAL PRODUCTION FINAL', smtp:!!transporter, smtp_user: SMTP_USER, agencias:read('agencias.json').length, avanza:'avanzaconsultingyl@gmail.com / Mafe2002@ GOLD'}));

app.get('/admin.html',(req,res)=>{ const p=path.join(PUBLIC_DIR,'admin.html'); if(fs.existsSync(p)) return res.sendFile(p); return res.sendFile(path.join(PUBLIC_DIR,'index.html')); });
app.get('/crm.html',(req,res)=>{ const p=path.join(PUBLIC_DIR,'crm.html'); if(fs.existsSync(p)) return res.sendFile(p); return res.sendFile(path.join(PUBLIC_DIR,'index.html')); });
app.get('*',(req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'api no existe'});
  const idx=path.join(PUBLIC_DIR,'index.html'); if(fs.existsSync(idx)) return res.sendFile(idx);
  return res.send('KLIDO REAL ACTIVO - Sube public/index.html');
});

app.listen(PORT, ()=>console.log(`KLIDO REAL FINAL ${PORT} GOLD Mafe2002@ SMTP:${SMTP_USER}`));
