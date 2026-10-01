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

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
if(!fs.existsSync('uploads')) fs.mkdirSync('uploads',{recursive:true});
const DATA_DIR = path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
const db = (n) => { const f=path.join(DATA_DIR,n+'.json'); if(!fs.existsSync(f)) fs.writeFileSync(f,'[]'); return {get:()=>JSON.parse(fs.readFileSync(f,'utf8')), set:(d)=>fs.writeFileSync(f, JSON.stringify(d,null,2))} }
const empresasDB=db('empresas'), usuariosDB=db('usuarios'), campanasDB=db('campanas'), contactosDB=db('contactos'), chatsDB=db('chats'), codigosDB=db('codigos');

// TRANSPORTER SMTP (respaldo) + RESEND por HTTPS (principal - no da timeout en Railway)
let transporter = null;
if(process.env.EMAIL_USER && process.env.EMAIL_PASS){
  transporter = nodemailer.createTransport({
    host:'smtp.gmail.com', port:465, secure:true,
    auth:{ user:process.env.EMAIL_USER, pass:String(process.env.EMAIL_PASS).replace(/\s/g,'') },
    connectionTimeout:10000, greetingTimeout:10000, socketTimeout:10000
  });
  console.log('📧 SMTP configurado:', process.env.EMAIL_USER);
}
if(process.env.RESEND_API_KEY){
  console.log('📧 Resend HTTPS configurado - sin timeout');
}

const FER_EMAIL="fermorales20020310@gmail.com", FER_PASS="Mafe2002@";
let users=usuariosDB.get(); let fer=users.find(u=>u.email.toLowerCase()===FER_EMAIL.toLowerCase());
if(!fer){ users.push({id:uuidv4(),nombre:'Fer Morales SuperAdmin',email:FER_EMAIL,password:bcrypt.hashSync(FER_PASS,10),rol:'superadmin',empresaId:null,plan:'all',createdAt:new Date()}); }
else{ fer.password=bcrypt.hashSync(FER_PASS,10); fer.rol='superadmin'; fer.empresaId=null; fer.plan='all'; }
usuariosDB.set(users);

function auth(req,res,next){
  const t=req.headers.authorization?.split(' ')[1];
  if(!t) return res.status(401).json({error:'no token'});
  try{ req.user=jwt.verify(t,JWT_SECRET); next(); }catch{ res.status(401).json({error:'token invalido'}); }
}

app.get('/health', (req,res) => res.status(200).send('ok'));

app.post('/api/login', async (req,res)=>{
  try{
    const emailClean=String(req.body.email||'').toLowerCase().trim();
    const user=usuariosDB.get().find(u=>u.email.toLowerCase()===emailClean);
    if(!user) return res.status(401).json({error:'Usuario no existe'});
    const ok=await bcrypt.compare(String(req.body.password), user.password);
    if(!ok) return res.status(401).json({error:'Clave incorrecta'});
    const emp=empresasDB.get().find(e=>e.id===user.empresaId);
    const token=jwt.sign({id:user.id,rol:user.rol,empresaId:user.empresaId,plan:emp?.plan||'all',codigoAcceso:emp?.codigoAcceso}, JWT_SECRET, {expiresIn:'7d'});
    res.json({token, user:{id:user.id,nombre:user.nombre,empresaNombre:emp?.nombre||'SuperAdmin',email:user.email,rol:user.rol,empresaId:user.empresaId,plan:emp?.plan||'all',codigoAcceso:emp?.codigoAcceso,montoAnual:emp?.montoAnual}});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/public/crear-empresa', async (req,res)=>{
  try{
    const {nombre,email,password,plan,codigoIngresado,aceptaTerminos}=req.body;
    if(!nombre||!email||!password||!plan||!codigoIngresado) return res.status(400).json({error:'Faltan datos'});
    if(!aceptaTerminos) return res.status(400).json({error:'Acepta términos'});
    let allUsers=usuariosDB.get();
    if(allUsers.find(u=>u.email.toLowerCase()===String(email).toLowerCase())) return res.status(400).json({error:'Correo ya registrado'});
    const codigo=String(codigoIngresado).toUpperCase().trim();
    const empresas=empresasDB.get();
    if(empresas.find(e=>e.codigoAcceso===codigo)) return res.status(400).json({error:`Código ${codigo} ya usado`});
    const precios={basico:800000,premium:1400000,gold:2400000}; const monto=precios[plan]||800000;
    const empresaId=uuidv4(); const nueva={id:empresaId,nombre,codigoAcceso:codigo,plan,montoAnual:monto,estado:'activo',multiagencia:true,metaApi:true,accesoExclusivo:true,createdAt:new Date()};
    empresas.push(nueva); empresasDB.set(empresas);
    allUsers.push({id:uuidv4(),nombre:'Admin '+nombre,email:email.toLowerCase(),password:bcrypt.hashSync(password,10),rol:'admin',empresaId,createdAt:new Date()}); usuariosDB.set(allUsers);
    res.json({ok:true,empresa:nueva,codigoAcceso:codigo});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// FIX DEFINITIVO: ENVIO POR HTTPS - YA NO DA CONNECTION TIMEOUT
app.post('/api/auth/forgot', async (req,res)=>{
  try{
    const emailClean=String(req.body.email||'').toLowerCase().trim();
    if(!emailClean) return res.status(400).json({error:'Ingresa correo'});
    const user=usuariosDB.get().find(u=>u.email.toLowerCase()===emailClean);
    if(!user) return res.status(404).json({error:'Correo no registrado'});
    const code=Math.floor(100000+Math.random()*900000).toString();
    const codigos=codigosDB.get(); codigos.push({email:emailClean,code,expira:Date.now()+15*60*1000,usado:false}); codigosDB.set(codigos);
    console.log(`CODIGO ${code} para ${emailClean}`);
    res.json({message:`Código enviado a ${emailClean}. Revisa tu correo y SPAM. Llega en 30 segundos.`});

    // 1. Intenta por Resend HTTPS (no lo bloquea Railway)
    if(process.env.RESEND_API_KEY){
      try{
        const resp = await fetch('https://api.resend.com/emails',{
          method:'POST',
          headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
          body:JSON.stringify({
            from:'Klido Avanza <onboarding@resend.dev>',
            to:emailClean,
            subject:`Tu código Klido: ${code}`,
            html:`<div style="font-family:Arial;background:#f6f8fb;padding:30px"><div style="max-width:480px;margin:auto;background:white;border-radius:16px;padding:28px;text-align:center;border:1px solid #e6ecf7"><h2 style="color:#0a1931;margin:0">KLIDO AVANZA</h2><p style="color:#4b5a7a">Tu código de recuperación:</p><div style="background:#173a80;color:white;font-size:34px;font-weight:900;letter-spacing:8px;padding:16px;border-radius:12px;margin:18px 0">${code}</div><p style="font-size:11px;color:#6b7da1">Expira en 15 minutos.<br>Si no fuiste tú, ignora este correo.</p></div></div>`
          })
        });
        const data = await resp.json();
        if(data.error) console.log('❌ Resend error:', JSON.stringify(data.error));
        else console.log(`✅ CORREO ENVIADO por Resend a ${emailClean} id:${data.id}`);
      }catch(e){ console.log('❌ Resend fetch error:', e.message); }
    }
    // 2. Respaldo SMTP por 465
    else if(transporter){
      transporter.sendMail({
        from:`"Klido Avanza" <${process.env.EMAIL_USER}>`,
        to:emailClean,
        subject:`Tu código Klido: ${code}`,
        html:`<div style="font-family:Arial;padding:30px"><div style="max-width:480px;margin:auto;text-align:center"><h2>KLIDO</h2><div style="background:#173a80;color:white;font-size:34px;padding:16px;border-radius:12px;letter-spacing:8px">${code}</div></div></div>`
      }).then(()=>console.log(`✅ Enviado SMTP a ${emailClean}`)).catch(e=>console.log('❌ Mail error:', e.message));
    } else {
      console.log('⚠️ Sin RESEND_API_KEY ni EMAIL_USER/PASS - código solo en logs');
    }
  }catch(e){
    console.log('Error forgot:', e.message);
    if(!res.headersSent) res.status(500).json({error:e.message});
  }
});

app.post('/api/auth/reset', async (req,res)=>{
  try{
    const {email,code,newPassword}=req.body;
    const emailClean=String(email).toLowerCase().trim();
    const codigos=codigosDB.get();
    const reg=codigos.find(c=>c.email===emailClean && c.code===String(code).trim() &&!c.usado && c.expira>Date.now());
    if(!reg) return res.status(400).json({error:'Código inválido o expirado. Pide uno nuevo'});
    if(String(newPassword).length<6) return res.status(400).json({error:'Min 6 caracteres'});
    const usuarios=usuariosDB.get(); const u=usuarios.find(x=>x.email.toLowerCase()===emailClean);
    if(!u) return res.status(404).json({error:'Usuario no existe'});
    u.password=await bcrypt.hash(newPassword,10); usuariosDB.set(usuarios);
    reg.usado=true; codigosDB.set(codigos);
    res.json({message:'Contraseña cambiada correctamente. Ya puedes ingresar'});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/test-mail', async (req,res)=>{
  if(!process.env.RESEND_API_KEY &&!transporter) return res.json({ok:false, error:'Falta RESEND_API_KEY o EMAIL_USER/PASS en Railway'});
  const emailTest = process.env.EMAIL_USER || 'fermorales20020310@gmail.com';
  try{
    if(process.env.RESEND_API_KEY){
      const r = await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Klido Test <onboarding@resend.dev>',to:emailTest,subject:'Test Klido OK',html:'<h2>Correo funciona ✅ por Resend</h2>'})});
      const j = await r.json();
      return res.json({ok:true, via:'resend', response:j});
    }else{
      const info=await transporter.sendMail({from:`"Test Klido" <${process.env.EMAIL_USER}>`,to:emailTest,subject:'Test Klido OK',html:'<h2>Funciona por SMTP</h2>'});
      return res.json({ok:true, via:'smtp', id:info.messageId});
    }
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.get('/api/empresas',auth,(req,res)=>res.json(empresasDB.get()));
app.get('/api/usuarios',auth,(req,res)=>{ let us=usuariosDB.get(); if(req.user.rol!=='superadmin') us=us.filter(u=>u.empresaId===req.user.empresaId); res.json(us.map(({password,...u})=>u)); });
app.get('/api/campanas',auth,(req,res)=>{ let c=campanasDB.get(); if(req.user.rol!=='superadmin') c=c.filter(x=>x.empresaId===req.user.empresaId); res.json(c); });
app.post('/api/campanas',auth,(req,res)=>{ const {nombre}=req.body; const empresaId=req.user.rol==='superadmin'?req.body.empresaId:req.user.empresaId; const camps=campanasDB.get(); const n={id:uuidv4(),nombre,empresaId,estado:'activa',totalContactos:0,createdAt:new Date()}; camps.push(n); campanasDB.set(camps); res.json(n); });
const upload=multer({dest:'uploads/'});
app.post('/api/campanas/:id/upload',auth,upload.single('file'),(req,res)=>{ try{ const wb=xlsx.readFile(req.file.path); const sheet=wb.Sheets[wb.SheetNames[0]]; const rows=xlsx.utils.sheet_to_json(sheet); const contactos=contactosDB.get(); let count=0; rows.forEach(r=>{ const tel=r.telefono||r.celular||r.phone; if(!tel) return; contactos.push({id:uuidv4(),campanaId:req.params.id,empresaId:req.user.empresaId,telefono:String(tel),estado:'pendiente',createdAt:new Date(),data:r}); count++; }); contactosDB.set(contactos); fs.unlinkSync(req.file.path); res.json({ok:true,importados:count}); }catch(e){ res.status(500).json({error:e.message}); } });
app.get('/api/contactos/:campanaId',auth,(req,res)=>res.json(contactosDB.get().filter(c=>c.campanaId===req.params.campanaId)));
app.post('/api/whatsapp/webhook',(req,res)=>{ const chats=chatsDB.get(); chats.push({id:uuidv4(),...req.body,createdAt:new Date()}); chatsDB.set(chats); io.emit('mensaje_nuevo',req.body); res.json({ok:true}); });
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Klido Online ${PORT}`));
