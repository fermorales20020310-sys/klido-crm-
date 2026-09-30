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
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Klido 12.2 Multiagencia Meta API Online ${PORT}`));

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

// CORREO - USA TUS VARIABLES YA CREADAS EN RAILWAY
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify((err)=>{
  if(err) console.log('⚠️ Mail pendiente config:', err.message);
  else console.log('✅ Correo activo:', process.env.EMAIL_USER);
});

// SUPERADMIN FER - SIEMPRE FUNCIONAL
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

// LOGIN - CÓDIGO DE INGRESO OBLIGATORIO PARA AGENCIAS
app.post('/api/login', async (req,res)=>{
  try{
    const {email,password,empresa} = req.body;
    const emailClean = String(email||'').trim().toLowerCase();
    const codigo = String(empresa||'').trim().toUpperCase();
    let allUsers = usuariosDB.get();

    // SuperAdmin entra sin código
    if(emailClean===FER_EMAIL.toLowerCase()){
      let user = allUsers.find(u=>u.email.toLowerCase()===emailClean);
      const ok = await bcrypt.compare(String(password), user.password);
      if(!ok) return res.status(401).json({error:'Clave incorrecta'});
      const token = jwt.sign({id:user.id, rol:user.rol, empresaId:null, plan:'all'}, JWT_SECRET, {expiresIn:'7d'});
      return res.json({token, user:{id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresaId:null, plan:'all'}});
    }

    if(!codigo) return res.status(401).json({error:'Debes colocar tu CÓDIGO DE INGRESO'});
    const emp = empresasDB.get().find(e=> e.codigoAcceso===codigo);
    if(!emp) return res.status(401).json({error:'CÓDIGO DE INGRESO inválido. Verifica el código que recibiste tras el pago'});

    let user = allUsers.find(u=> u.empresaId===emp.id && u.email.toLowerCase()===emailClean);
    if(!user) return res.status(401).json({error:`Este correo no pertenece al código ${codigo}. Este código solo da acceso al plan ${emp.plan.toUpperCase()}`});

    const ok = await bcrypt.compare(String(password), user.password);
    if(!ok) return res.status(401).json({error:'Clave incorrecta'});

    const token = jwt.sign({id:user.id, rol:user.rol, empresaId:emp.id, plan:emp.plan, codigoAcceso:emp.codigoAcceso}, JWT_SECRET, {expiresIn:'7d'});
    console.log(`LOGIN OK: ${emailClean} | Codigo:${codigo} | Plan:${emp.plan}`);
    res.json({token, user:{id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresaId:emp.id, plan:emp.plan, codigoAcceso:emp.codigoAcceso, montoAnual:emp.montoAnual}});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// CREAR EMPRESA - CON CASILLA DE CÓDIGO DEBAJO DEL PLAN (PROFESIONAL)
app.post('/api/public/crear-empresa', async (req,res)=>{
  try{
    const {nombre,email,password,plan,codigoIngresado,aceptaTerminos} = req.body;
    if(!nombre||!email||!password||!plan) return res.status(400).json({error:'Faltan datos'});
    if(!codigoIngresado ||!String(codigoIngresado).trim()) return res.status(400).json({error:'Debes ingresar tu CÓDIGO DE INGRESO recibido tras el pago'});
    if(!aceptaTerminos) return res.status(400).json({error:'Acepta términos'});

    let allUsers = usuariosDB.get();
    if(allUsers.find(u=>u.email.toLowerCase()===String(email).toLowerCase())) return res.status(400).json({error:'Correo ya registrado'});

    const codigo = String(codigoIngresado).toUpperCase().trim();
    if(codigo.length < 5) return res.status(400).json({error:'Código de ingreso inválido'});

    const empresas = empresasDB.get();
    if(empresas.find(e=>e.codigoAcceso===codigo)){
      return res.status(400).json({error:`El código ${codigo} ya fue usado. Cada código solo activa una agencia y solo da acceso al plan que se pagó.`});
    }

    const precios = { basico:800000, premium:1400000, gold:2400000 };
    const monto = precios[plan]||800000;
    const empresaId = uuidv4();
    const nueva = {
      id:empresaId, nombre, codigoAcceso: codigo, plan, montoAnual:monto,
      estado:'activo', multiagencia:true, metaApi:true, accesoExclusivo:true,
      createdAt:new Date()
    };
    empresas.push(nueva); empresasDB.set(empresas);
    allUsers.push({ id: uuidv4(), nombre:'Admin '+nombre, email:email.toLowerCase(), password:bcrypt.hashSync(password,10), rol:'admin', empresaId, createdAt:new Date() });
    usuariosDB.set(allUsers);

    // ENVIA CONFIRMACIÓN AL CORREO DE QUIEN SE REGISTRA
    if(process.env.EMAIL_USER && process.env.EMAIL_PASS){
      const htmlCorreo = `
        <div style="font-family:Arial,sans-serif;background:#f6f8fb;padding:30px">
          <div style="max-width:520px;margin:auto;background:white;border-radius:20px;padding:32px;text-align:center;border:1px solid #e6ecf7">
            <h2 style="color:#0a1931;margin:0">KLIDO <span style="font-weight:400;letter-spacing:3px;font-size:12px">AVANZA CONSULTING</span></h2>
            <p style="color:#173a80;font-weight:700;margin-top:16px">Agencia ${nombre} activada correctamente</p>
            <p style="font-size:13px;color:#333">Plan: <b>${plan.toUpperCase()} - $${monto.toLocaleString('es-CO')}/año</b></p>
            <div style="background:#eef3ff;border:2px solid #173a80;color:#173a80;font-size:28px;font-weight:900;letter-spacing:4px;padding:14px;border-radius:14px;margin:18px 0">${codigo}</div>
            <div style="text-align:left;background:#f8faff;border-radius:12px;padding:14px;font-size:12px;line-height:1.6">
              <b>Acceso:</b><br>
              Código: <b>${codigo}</b> (solo habilita el plan ${plan.toUpperCase()})<br>
              Correo: <b>${email.toLowerCase()}</b><br>
            </div>
            <p style="font-size:11px;color:#8aa0c7;margin-top:18px">CRM Multiagencia certificado para API oficial de Meta</p>
          </div>
        </div>`;
      try{
        await transporter.sendMail({
          from: `"Klido Avanza Consulting" <${process.env.EMAIL_USER}>`,
          to: email.toLowerCase(),
          subject: `✅ Agencia ${nombre} activada - Plan ${plan.toUpperCase()} - Código ${codigo}`,
          html: htmlCorreo
        });
        console.log(`📧 Confirmación enviada a ${email} con código ${codigo}`);
      }catch(e){ console.log('❌ Error mail:', e.message); }
    }

    console.log(`✅ AGENCIA ACTIVADA: ${nombre} Plan:${plan} CODIGO:${codigo} Email:${email}`);
    res.json({ok:true, empresa:nueva, codigoAcceso:codigo});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/auth/forgot', (req,res)=>{
  const {email} = req.body;
  const user = usuariosDB.get().find(u=>u.email.toLowerCase()===String(email).toLowerCase());
  if(!user) return res.status(404).json({error:'No registrado'});
  const code = Math.floor(100000 + Math.random()*900000).toString();
  const codigos = codigosDB.get(); codigos.push({ email: email.toLowerCase(), code, expira: Date.now()+15*60*1000, usado:false }); codigosDB.set(codigos);
  console.log(`CODIGO RECUP ${email}: ${code}`);
  res.json({message:`Código enviado a ${email}`, testCode: code});
});

app.post('/api/auth/reset', async (req,res)=>{
  const {email, code, newPassword} = req.body;
  const codigos = codigosDB.get();
  const reg = codigos.find(c=> c.email===String(email).toLowerCase() && c.code===String(code) &&!c.usado && c.expira>Date.now());
  if(!reg) return res.status(400).json({error:'Código inválido'});
  const usuarios = usuariosDB.get(); const u = usuarios.find(x=>x.email.toLowerCase()===String(email).toLowerCase());
  if(!u) return res.status(404).json({error:'no existe'});
  u.password = await bcrypt.hash(newPassword, 10); usuariosDB.set(usuarios);
  reg.usado=true; codigosDB.set(codigos);
  res.json({message:'Contraseña cambiada'});
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
