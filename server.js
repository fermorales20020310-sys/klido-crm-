const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'klido-secreto-2025';

app.get('/health', (req,res) => res.status(200).send('ok'));
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Klido 12.4 FINAL Seguro Online ${PORT}`));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
if(!fs.existsSync('uploads')) fs.mkdirSync('uploads',{recursive:true});

const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
const db = (name) => {
  const f = path.join(DATA_DIR, name+'.json');
  if(!fs.existsSync(f)) fs.writeFileSync(f, '[]');
  return { get: () => JSON.parse(fs.readFileSync(f,'utf8')), set: (d) => fs.writeFileSync(f, JSON.stringify(d,null,2)) }
}
const empresasDB = db('empresas');
const usuariosDB = db('usuarios');
const campanasDB = db('campanas');
const contactosDB = db('contactos');
const chatsDB = db('chats');
const codigosDB = db('codigos');

// CORREO REAL - GMAIL SMTP - LLEGA SI O SI
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: (process.env.EMAIL_PASS||'').replace(/\s/g,'')
  },
  tls: { rejectUnauthorized: false }
});
transporter.verify((err)=>{
  if(err) console.log('❌ MAIL ERROR:', err.message, '- Revisa EMAIL_USER y EMAIL_PASS en Railway Variables');
  else console.log('✅ Correo listo para enviar desde:', process.env.EMAIL_USER);
});

const FER_EMAIL = "fermorales20020310@gmail.com";
const FER_PASS = "Mafe2002@";
let users = usuariosDB.get();
let fer = users.find(u=>u.email.toLowerCase()===FER_EMAIL.toLowerCase());
if(!fer){
  users.push({ id: uuidv4(), nombre:'Fer Morales SuperAdmin', email:FER_EMAIL, password:bcrypt.hashSync(FER_PASS,10), rol:'superadmin', empresaId:null, plan:'all', createdAt:new Date() });
} else {
  fer.password = bcrypt.hashSync(FER_PASS,10);
  fer.rol='superadmin'; fer.empresaId=null; fer.plan='all';
}
usuariosDB.set(users);
console.log('✅ SuperAdmin funcional: '+FER_EMAIL);

function auth(req,res,next){
  const token = req.headers.authorization?.split(' ')[1];
  if(!token) return res.status(401).json({error:'no token'});
  try{ req.user = jwt.verify(token, JWT_SECRET); next(); }catch{ res.status(401).json({error:'token invalido'}); }
}

// LOGIN FINAL - SIN CODIGO - NOMBRE EMPRESA + CORREO + CONTRASEÑA
app.post('/api/login', async (req,res)=>{
  try{
    const {email,password,nombre} = req.body;
    const emailClean = String(email||'').trim().toLowerCase();
    if(!emailClean ||!password) return res.status(400).json({error:'Correo y contraseña requeridos'});
    let allUsers = usuariosDB.get();
    let user = allUsers.find(u=>u.email.toLowerCase()===emailClean);
    if(!user) return res.status(401).json({error:'Usuario no existe'});
    const ok = await bcrypt.compare(String(password), user.password);
    if(!ok) return res.status(401).json({error:'Clave incorrecta'});
    const empresas = empresasDB.get();
    const emp = empresas.find(e=> e.id===user.empresaId);
    if(nombre && emp && user.rol!=='superadmin'){
      console.log(`LOGIN: ${emailClean} ingresó empresa "${nombre}" | real "${emp.nombre}"`);
    }
    const token = jwt.sign({id:user.id, rol:user.rol, empresaId:user.empresaId, plan:emp?.plan||'all', codigoAcceso:emp?.codigoAcceso}, JWT_SECRET, {expiresIn:'7d'});
    console.log(`LOGIN OK: ${emailClean} | Empresa:${emp?.nombre||'SUPERADMIN'}`);
    res.json({token, user:{id:user.id, nombre:user.nombre, empresaNombre: emp?.nombre||'SuperAdmin', email:user.email, rol:user.rol, empresaId:user.empresaId, plan:emp?.plan||'all', codigoAcceso:emp?.codigoAcceso, montoAnual:emp?.montoAnual}});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// CREAR EMPRESA - CODIGO SOLO SE GENERA UNA VEZ Y LLEGA AL CORREO
app.post('/api/public/crear-empresa', async (req,res)=>{
  try{
    const {nombre,email,password,plan,codigoIngresado,aceptaTerminos} = req.body;
    if(!nombre||!email||!password||!plan) return res.status(400).json({error:'Faltan datos'});
    if(!codigoIngresado ||!String(codigoIngresado).trim()) return res.status(400).json({error:'Debes ingresar tu CÓDIGO DE INGRESO recibido tras el pago'});
    if(!aceptaTerminos) return res.status(400).json({error:'Acepta términos'});
    let allUsers = usuariosDB.get();
    if(allUsers.find(u=>u.email.toLowerCase()===String(email).toLowerCase())) return res.status(400).json({error:'Correo ya registrado'});
    const codigo = String(codigoIngresado).toUpperCase().trim();
    if(codigo.length < 5) return res.status(400).json({error:'Código inválido'});
    const empresas = empresasDB.get();
    if(empresas.find(e=>e.codigoAcceso===codigo)){
      return res.status(400).json({error:`El código ${codigo} ya fue usado. Cada código solo activa una agencia.`});
    }
    const precios = { basico:800000, premium:1400000, gold:2400000 };
    const monto = precios[plan]||800000;
    const empresaId = uuidv4();
    const nueva = { id:empresaId, nombre, codigoAcceso: codigo, plan, montoAnual:monto, estado:'activo', multiagencia:true, metaApi:true, accesoExclusivo:true, createdAt:new Date() };
    empresas.push(nueva); empresasDB.set(empresas);
    allUsers.push({ id: uuidv4(), nombre:'Admin '+nombre, email:email.toLowerCase(), password:bcrypt.hashSync(password,10), rol:'admin', empresaId, createdAt:new Date() });
    usuariosDB.set(allUsers);

    if(process.env.EMAIL_USER && process.env.EMAIL_PASS){
      try{
        await transporter.sendMail({
          from: `"Klido Avanza Consulting" <${process.env.EMAIL_USER}>`,
          to: email.toLowerCase(),
          subject: `✅ Agencia ${nombre} activada - Código ${codigo}`,
          html: `<div style="font-family:Arial;background:#f6f8fb;padding:30px"><div style="max-width:520px;margin:auto;background:white;border-radius:20px;padding:32px;text-align:center;border:1px solid #e6ecf7"><h2 style="color:#0a1931">KLIDO AVANZA CONSULTING</h2><p style="color:#173a80;font-weight:700">Agencia ${nombre} activada</p><p>Plan: <b>${plan.toUpperCase()} - $${monto.toLocaleString('es-CO')}/año</b></p><div style="background:#eef3ff;border:2px solid #173a80;color:#173a80;font-size:28px;font-weight:900;letter-spacing:4px;padding:14px;border-radius:14px;margin:18px 0">${codigo}</div><p style="font-size:12px">Guarda este código, es tu acceso exclusivo.</p></div></div>`
        });
        console.log(`📧 Confirmación enviada a ${email}`);
      }catch(e){ console.log('❌ Mail error crear empresa:', e.message); }
    }
    console.log(`✅ AGENCIA CREADA: ${nombre} Plan:${plan} CODIGO:${codigo}`);
    res.json({ok:true, empresa:nueva, codigoAcceso:codigo});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// OLVIDE CONTRASEÑA - SOLO AL CORREO, NUNCA EN PANTALLA
app.post('/api/auth/forgot', async (req,res)=>{
  try{
    const {email} = req.body;
    const emailClean = String(email||'').toLowerCase().trim();
    const user = usuariosDB.get().find(u=>u.email.toLowerCase()===emailClean);
    if(!user) return res.status(404).json({error:'Correo no registrado'});
    const code = Math.floor(100000 + Math.random()*900000).toString();
    const codigos = codigosDB.get();
    codigos.push({ email: emailClean, code, expira: Date.now()+15*60*1000, usado:false });
    codigosDB.set(codigos);
    console.log(`🔐 Código ${code} generado para ${emailClean}`);
    if(!process.env.EMAIL_USER ||!process.env.EMAIL_PASS){
      return res.status(500).json({error:'Correo no configurado en servidor. Configura EMAIL_USER y EMAIL_PASS en Railway'});
    }
    try{
      const info = await transporter.sendMail({
        from: `"Klido Avanza - Seguridad" <${process.env.EMAIL_USER}>`,
        to: emailClean,
        subject: `Tu código de recuperación Klido es ${code}`,
        html: `<div style="font-family:Arial;background:#f6f8fb;padding:30px"><div style="max-width:480px;margin:auto;background:white;border-radius:16px;padding:28px;text-align:center;border:1px solid #e6ecf7"><h2 style="color:#0a1931">KLIDO AVANZA</h2><p style="font-size:14px">Tu código de recuperación es:</p><div style="background:#173a80;color:white;font-size:34px;font-weight:900;letter-spacing:8px;padding:16px;border-radius:12px;margin:18px 0">${code}</div><p style="font-size:11px;color:#6b7da1">Expira en 15 minutos. Revisa SPAM si no lo ves.</p></div></div>`,
        text: `Tu código Klido es: ${code} - Expira en 15 min`
      });
      console.log(`✅ Código ${code} ENVIADO a ${emailClean} ${info.messageId}`);
      return res.json({message:`Código enviado a ${emailClean}. Revisa tu correo y SPAM. Expira en 15 minutos.`});
    }catch(mailErr){
      console.log('❌ SMTP ERROR:', mailErr.message);
      return res.status(500).json({error:`Error enviando correo: ${mailErr.message}`});
    }
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/auth/reset', async (req,res)=>{
  try{
    const {email, code, newPassword} = req.body;
    if(!email||!code||!newPassword) return res.status(400).json({error:'Faltan datos'});
    const emailClean = String(email).toLowerCase().trim();
    const codigos = codigosDB.get();
    const reg = codigos.find(c=> c.email===emailClean && c.code===String(code).trim() &&!c.usado && c.expira>Date.now());
    if(!reg) return res.status(400).json({error:'Código inválido o expirado'});
    if(String(newPassword).length < 6) return res.status(400).json({error:'Contraseña mínimo 6 caracteres'});
    const usuarios = usuariosDB.get(); const u = usuarios.find(x=>x.email.toLowerCase()===emailClean);
    if(!u) return res.status(404).json({error:'Usuario no existe'});
    u.password = await bcrypt.hash(newPassword, 10); usuariosDB.set(usuarios);
    reg.usado=true; codigosDB.set(codigos);
    console.log(`✅ Contraseña cambiada para ${emailClean}`);
    res.json({message:'Contraseña cambiada correctamente. Ya puedes ingresar.'});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/test-mail', async (req,res)=>{
  try{
    const to = process.env.EMAIL_USER || FER_EMAIL;
    await transporter.sendMail({
      from: `"Test Klido" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Test Klido funciona',
      html: '<h2>Si ves esto, el correo YA funciona ✅</h2>'
    });
    res.json({ok:true, message:`Correo de prueba enviado a ${to}`});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.get('/api/empresas', auth, (req,res)=> res.json(empresasDB.get()));
app.get('/api/usuarios', auth, (req,res)=>{
  let us = usuariosDB.get(); if(req.user.rol!=='superadmin') us=us.filter(u=>u.empresaId===req.user.empresaId);
  res.json(us.map(({password,...u})=>u));
});
app.get('/api/campanas', auth, (req,res)=>{
  let c=campanasDB.get(); if(req.user.rol!=='superadmin') c=c.filter(x=>x.empresaId===req.user.empresaId); res.json(c);
});
app.post('/api/campanas', auth, (req,res)=>{
  const {nombre} = req.body; const empresaId = req.user.rol==='superadmin'? req.body.empresaId : req.user.empresaId;
  const camps=campanasDB.get(); const n={id:uuidv4(),nombre,empresaId,estado:'activa',totalContactos:0,createdAt:new Date()}; camps.push(n); campanasDB.set(camps); res.json(n);
});
const upload = multer({ dest: 'uploads/' });
app.post('/api/campanas/:id/upload', auth, upload.single('file'), (req,res)=>{
  try{
    const wb = xlsx.readFile(req.file.path); const sheet = wb.Sheets[wb.SheetNames[0]]; const rows = xlsx.utils.sheet_to_json(sheet);
    const contactos=contactosDB.get(); let count=0;
    rows.forEach(r=>{ const tel=r.telefono||r.celular||r.phone; if(!tel) return; contactos.push({id:uuidv4(),campanaId:req.params.id,empresaId:req.user.empresaId,telefono:String(tel),estado:'pendiente',createdAt:new Date(),data:r}); count++; });
    contactosDB.set(contactos); fs.unlinkSync(req.file.path); res.json({ok:true, importados:count});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/contactos/:campanaId', auth, (req,res)=> res.json(contactosDB.get().filter(c=>c.campanaId===req.params.campanaId)));
app.post('/api/whatsapp/webhook', (req,res)=>{ const chats=chatsDB.get(); chats.push({id:uuidv4(),...req.body,createdAt:new Date()}); chatsDB.set(chats); io.emit('mensaje_nuevo', req.body); res.json({ok:true}); });
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
