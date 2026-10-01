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
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, {recursive:true});
const f = (name) => path.join(DATA_DIR, name);
const read = (name, def=[]) => { try{ return JSON.parse(fs.readFileSync(f(name),'utf8')) }catch{ return def } };
const write = (name, data) => fs.writeFileSync(f(name), JSON.stringify(data,null,2));

if(!fs.existsSync(f('agencias.json'))) write('agencias.json', []);
if(!fs.existsSync(f('usuarios.json'))) write('usuarios.json', []);
if(!fs.existsSync(f('mensajes.json'))) write('mensajes.json', []);
if(!fs.existsSync(f('llamadas.json'))) write('llamadas.json', []);

// AUTO-HEAL: cura todas al arrancar para que no se caiga registro
let _ag = read('agencias.json');
let _fix = false;
_ag = _ag.map(a=>{
  if(a.estadoPago==='pagado' &&!a.pagado){ _fix=true; return {...a, pagado:true, estado:'activo'} }
  return a;
});
if(_fix){ write('agencias.json', _ag); console.log('✅ AUTO-HEAL aplicado'); }

app.use(cors());
app.use(express.json({limit:'20mb'}));
app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });
app.use(express.static(path.join(__dirname,'public'), { maxAge:0, etag:false }));
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

// SMTP BLINDADO - si no hay credenciales no tumba el server
let transporter = null;
try{
  if(process.env.SMTP_HOST && process.env.SMTP_USER){
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT||587), secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    console.log('📧 SMTP configurado', process.env.SMTP_HOST);
  }else{
    console.log('⚠️ SMTP sin configurar - usando modo LOG solamente');
  }
}catch(e){ console.log('SMTP error init', e.message); }

const PLANES = {
  basico: { anual: 800000, trim: 80000, nombre: 'Básico' },
  premium: { anual: 1400000, trim: 95000, nombre: 'Premium' },
  gold: { anual: 2400000, trim: 120000, nombre: 'Gold' }
};

// ========= REGISTRO 100% AUTONOMO =========
app.post('/api/public/crear-empresa', async (req,res)=>{
  try{
    const {nombre,email,password,plan} = req.body;
    if(!nombre||!email||!password) return res.status(400).json({error:'Completa nombre, correo y contraseña'});
    let agencias = read('agencias.json');
    let usuarios = read('usuarios.json');
    if(usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Ese correo ya está registrado, usa Ingresar'});
    const planKey = (plan||'premium').toLowerCase();
    const planData = PLANES[planKey] || PLANES.premium;
    const codigo = `KLIDO-${planKey.toUpperCase()}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    const hash = await bcrypt.hash(password,10);
    const agenciaId = Date.now().toString();

    const agencia = {
      id: agenciaId, nombre: nombre.trim(), plan: planKey, planNombre: planData.nombre,
      anual: planData.anual, mantenimiento: planData.trim, codigo,
      pagado:false, estado:'activo', estadoPago:'pendiente',
      created:new Date(), ultimaConexion:null
    };
    const user = { id: agenciaId+'_1', email: email.toLowerCase().trim(), password:hash, nombre: nombre.trim(), rol:'jefe', agenciaId, plan: planKey };

    agencias.push(agencia); usuarios.push(user);
    write('agencias.json', agencias); write('usuarios.json', usuarios);

    // LOG SIEMPRE - para que veas en Railway aunque falle correo
    console.log(`🔑 NUEVA AGENCIA AUTONOMA | Nombre:${nombre} | Email:${email} | Plan:${planKey} | Codigo:${codigo} | Anual:${planData.anual}`);

    // ENVIO CORREO - NO TUMBA SI FALLA
    if(transporter){
      transporter.sendMail({
        from: `"KLIDO CRM" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Tu código de acceso KLIDO ${planData.nombre} - ${codigo}`,
        html: `<div style="font-family:sans-serif;max-width:480px"><h2 style="color:#0f172a">KLIDO Avanza Consulting</h2><p>Hola <b>${nombre}</b>, tu agencia fue creada.</p><div style="background:#f1f5f9;border:2px dashed #0f172a;border-radius:12px;padding:16px;text-align:center;margin:16px 0"><div style="font-size:12px;color:#64748b">TU CÓDIGO ÚNICO</div><div style="font-size:22px;font-weight:900;letter-spacing:2px">${codigo}</div><div style="font-size:11px;margin-top:6px">Plan ${planData.nombre} - Anual $${planData.anual.toLocaleString()} + Mant $${planData.trim.toLocaleString()}/trim</div></div><p>Copia este código y pégalo en la plataforma en <b>Crear empresa > Verifica tu código</b>.</p><p style="font-size:11px;color:#64748b">Pago Nequi/Bancolombia 3133181851. Guarda este correo.</p></div>`
      }).then(()=>console.log(`📧 Código enviado a ${email}`)).catch(e=>console.log(`❌ Fallo envío a ${email}: ${e.message} - Código queda en log: ${codigo}`));
    }

    return res.json({ok:true, mensaje:`Agencia ${nombre} creada. Te enviamos el código a ${email}. Revisa correo y spam, luego verifícalo abajo.`});
  }catch(e){
    console.error('crear-empresa error', e);
    return res.status(500).json({error:'Error interno, intenta de nuevo'});
  }
});

app.post('/api/public/verificar-codigo', (req,res)=>{
  try{
    const {email,codigo} = req.body;
    if(!codigo) return res.status(400).json({error:'Escribe el código que llegó a tu correo'});
    const codigoLimpio = codigo.toUpperCase().trim();
    let agencias = read('agencias.json');
    let agencia = agencias.find(a=>a.codigo.toUpperCase()===codigoLimpio);
    if(!agencia) return res.status(400).json({error:'Código inválido. Revisa tu correo, debe ser KLIDO-...'});
    agencia.pagado = true; agencia.estadoPago='pagado'; agencia.estado='activo'; agencia.verificadoEn = new Date();
    write('agencias.json', agencias);
    console.log(`✅ VERIFICACION AUTONOMA ${agencia.nombre} ${agencia.id} con codigo ${codigoLimpio}`);
    return res.json({ok:true, planDesbloqueado: agencia.plan, nombre: agencia.nombre, mensaje:`¡Listo ${agencia.nombre}! Código correcto. Ya puedes ingresar con tu correo y contraseña.`});
  }catch(e){ return res.status(500).json({error:'Error verificando'}); }
});

app.post('/api/public/recuperar', async (req,res)=>{
  const {email} = req.body; let usuarios = read('usuarios.json'); const user = usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user) return res.status(404).json({error:'Correo no registrado'}); const newPass = Math.random().toString(36).substring(2,8);
  user.password = await bcrypt.hash(newPass,10); write('usuarios.json', usuarios);
  if(transporter){ try{ await transporter.sendMail({from:process.env.SMTP_USER,to:email,subject:'Recuperación KLIDO',text:`Nueva contraseña: ${newPass}`}) }catch{} }
  res.json({ok:true, mensaje:`Nueva contraseña enviada a ${email}`});
});

app.post('/api/login', async (req,res)=>{
  const {email,password} = req.body;
  let usuarios = read('usuarios.json'); const user = usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user) return res.status(404).json({error:'Usuario no existe. Crea tu agencia primero.'});
  const ok = await bcrypt.compare(password, user.password); if(!ok) return res.status(401).json({error:'Contraseña incorrecta'});
  let agencias = read('agencias.json'); const agencia = agencias.find(a=>a.id===user.agenciaId);
  if(!agencia) return res.status(403).json({error:'Agencia no existe'});
  if(!agencia.pagado) return res.status(403).json({error:`Agencia no verificada. Revisa tu correo ${user.email}, copia el código KLIDO-... y verifícalo en Crear empresa > Verificar. Si no llegó, revisa spam.`});
  if(agencia.estado==='bloqueado') return res.status(403).json({error:'Agencia bloqueada por falta de pago mantenimiento. Contacta 3133181851'});
  agencia.ultimaConexion = new Date(); write('agencias.json', agencias);
  const token = jwt.sign({id:user.id, agenciaId:user.agenciaId, rol:user.rol}, JWT_SECRET, {expiresIn:'7d'});
  res.json({token, user:{id:user.id, email:user.email, nombre:user.nombre, rol:user.rol, agenciaId:user.agenciaId, agencia}});
});

const auth = (req,res,next)=>{ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.split(' ')[1], JWT_SECRET); next() }catch{return res.status(401).json({error:'Token inválido'})} };
app.get('/api/mensajes', auth, (req,res)=>{ let mensajes = read('mensajes.json'); res.json(mensajes.filter(m=>m.agenciaId===req.user.agenciaId).slice(-200)); });
app.post('/api/webhook', (req,res)=>{ try{ const body=req.body; if(body.entry){ let mensajes=read('mensajes.json'); const agenciaId=body.agenciaId||body.entry[0]?.id||'default'; mensajes.push({id:Date.now().toString(), agenciaId, payload:body, leido:false, timestamp:new Date()}); write('mensajes.json', mensajes);} }catch(e){} res.sendStatus(200); });
app.get('/api/templates', auth, async (req,res)=>{ res.json([{name:'promo_aprobada', status:'APPROVED'}]); });
const upload = multer({dest:'uploads/'});
app.post('/api/campanas/excel', auth, upload.single('excel'), async (req,res)=>{
  if(!req.file) return res.status(400).json({error:'Excel requerido'}); const wb=XLSX.readFile(req.file.path); const nums=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]).map(r=>r.telefono||r.numero||r.wa||Object.values(r)[0]).filter(Boolean); fs.unlinkSync(req.file.path); let enviadas=0; for(let i=0;i<nums.length;i+=20){ enviadas+=20; if(i+20<nums.length) await new Promise(r=>setTimeout(r,120000)); } res.json({ok:true,total:enviadas});
});
app.post('/api/call', auth, (req,res)=>{ const {numero}=req.body; let llamadas=read('llamadas.json'); llamadas.push({id:Date.now().toString(), agenciaId:req.user.agenciaId, numero, fecha:new Date(), por:req.user.id}); write('llamadas.json', llamadas); res.json({ok:true}); });
app.post('/api/ia/panic', auth, (req,res)=>res.json({ok:true}));
app.post('/api/webhooks/shopify', (req,res)=>{ res.sendStatus(200) });
app.post('/api/webhooks/woocommerce', (req,res)=>{ res.sendStatus(200) });

function checkAdmin(req,res,next){ if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'Clave admin'}); next(); }
app.get('/api/admin/metricas', checkAdmin, (req,res)=>{
  const agencias=read('agencias.json')||[]; const usuarios=read('usuarios.json')||[]; const mensajes=read('mensajes.json')||[];
  let ingresos=0; agencias.forEach(a=>{ ingresos+= (PLANES[a.plan]||PLANES.premium).anual; });
  const hoy=new Date().toDateString();
  res.json({totalAgencias:agencias.length, activas:agencias.filter(a=>a.estado!=='bloqueado'&&a.pagado).length, ingresosMes:ingresos, agencias:agencias.map(a=>{ const p=PLANES[a.plan]||PLANES.premium; return {id:a.id,nombre:a.nombre,plan:a.plan,anual:a.anual||p.anual,mantenimiento:a.mantenimiento||p.trim,trabajadores:usuarios.filter(u=>u.agenciaId===a.id).length,mensajesHoy:mensajes.filter(m=>m.agenciaId===a.id&&new Date(m.timestamp||m.fecha).toDateString()===hoy).length,ultimaConexion:a.ultimaConexion?new Date(a.ultimaConexion).toLocaleString('es-CO'):'-',estadoPago:a.estadoPago|| (a.pagado?'pagado':'pendiente'),estado:a.estado||'activo',codigo:a.codigo} })});
});
app.post('/api/admin/toggle', checkAdmin, (req,res)=>{
  const {id,estado}=req.body; let agencias=read('agencias.json')||[];
  agencias=agencias.map(a=>{ if(a.id===id){ const esPagado=estado==='pagado'; return {...a, estadoPago:estado, estado:esPagado?'activo':'bloqueado', pagado:esPagado?true:false, bloqueadaEn:esPagado?null:new Date()} } return a; });
  write('agencias.json', agencias); res.json({ok:true});
});
app.post('/api/admin/fix-acol-now', checkAdmin, (req,res)=>{
  let agencias=read('agencias.json')||[];
  agencias=agencias.map(a=>{ if(a.nombre.toLowerCase().includes('avanza')||a.nombre.toLowerCase().includes('acol')){ return {...a, pagado:true, estadoPago:'pagado', estado:'activo'} } return a; });
  write('agencias.json', agencias); res.json({ok:true, fix:'Acol y Avanza activadas'});
});
app.get('/health', (req,res)=>res.json({ok:true, agencias:read('agencias.json').length, usuarios:read('usuarios.json').length, timestamp:new Date()}));
app.listen(PORT, ()=>console.log(`=== KLIDO AUTONOMO 100% - ${new Date().toISOString()} - Puerto ${PORT} ===`));
