const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir public - IMPORTANTE para que aparezca logo.png
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
console.log('Public path:', publicPath, 'exists:', fs.existsSync(publicPath));
if(fs.existsSync(publicPath)){
  console.log('Files in public:', fs.readdirSync(publicPath).slice(0,20));
}

// Health para Railway
app.get('/health', (req,res)=> res.send('OK KLIDO'));
app.get('/api/health', (req,res)=> res.json({ok:true}));

// --- MOCK DB (reemplaza con tu DB real si tienes) ---
let empresas = [];
let usuarios = [
  { id:'1', nombre:'Fer Morales', email:'fermorales20020310@gmail.com', password:'Mafe2002@', rol:'SuperAdmin', empresaNombre:'KLIDO AVANZA' }
];
let codigos = {};

function generarCodigo(){
  const num = Math.floor(1000 + Math.random()*9000);
  return 'KLIDO'+String(num).padStart(4,'0');
}

// LOGIN - FIX empresa KLIDO AVANZA no bloquea
app.post('/api/login', (req,res)=>{
  try{
    const { email, password } = req.body;
    if(!email ||!password) return res.status(400).json({error:'Faltan datos'});
    const user = usuarios.find(u=> u.email.toLowerCase()===email.toLowerCase() && u.password===password);
    if(!user) return res.status(401).json({error:'Correo o contraseña incorrecta'});
    const token = 'tok_'+Date.now();
    return res.json({ token, user:{ id:user.id, nombre:user.nombre, email:user.email, rol:user.rol, empresaNombre:user.empresaNombre }});
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'Error interno login'});
  }
});

// CREAR EMPRESA con planes + mantenimiento trimestral
app.post('/api/public/crear-empresa', (req,res)=>{
  try{
    const { nombre, email, password, plan, codigoIngresado } = req.body;
    if(!nombre ||!email ||!password) return res.status(400).json({error:'Faltan datos de empresa'});
    if(!codigoIngresado) return res.status(400).json({error:'Falta código'});
    if(usuarios.some(u=>u.email.toLowerCase()===email.toLowerCase())){
      return res.status(400).json({error:'Ese correo ya existe'});
    }
    const codigoAcceso = generarCodigo();
    const nueva = { id:Date.now().toString(), nombre, email, plan: plan||'basico', codigoAcceso, mantenimiento: plan==='basico'?'120.000/trim':plan==='premium'?'180.000/trim':'Incluido', createdAt:new Date() };
    empresas.push(nueva);
    usuarios.push({ id:nueva.id, nombre, email, password, rol:'Admin', empresaNombre:nombre });
    codigos[codigoAcceso] = { empresaId:nueva.id, plan };
    console.log('Empresa creada:', nueva);
    return res.json({ ok:true, codigoAcceso, empresa:nueva, message:'Agencia creada con éxito. Código: '+codigoAcceso });
  }catch(e){
    console.error(e);
    return res.status(500).json({error:'Error creando empresa'});
  }
});

// FORGOT / RESET
let resetCodes = {};
app.post('/api/auth/forgot', (req,res)=>{
  const { email } = req.body;
  const code = String(Math.floor(100000+Math.random()*900000));
  resetCodes[email.toLowerCase()] = code;
  console.log('RESET CODE para',email,':',code);
  return res.json({ ok:true, message:'Código enviado a tu correo (revisa logs en Railway): '+code });
});
app.post('/api/auth/reset', (req,res)=>{
  const { email, code, newPassword } = req.body;
  const saved = resetCodes[email.toLowerCase()];
  if(!saved || saved!==code) return res.status(400).json({error:'Código inválido'});
  const u = usuarios.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(!u) return res.status(404).json({error:'Usuario no encontrado'});
  u.password = newPassword;
  delete resetCodes[email.toLowerCase()];
  return res.json({ ok:true, message:'Contraseña cambiada con éxito' });
});

// Fallback a index.html para SPA
app.get('*', (req,res)=>{
  const indexPath = path.join(publicPath, 'index.html');
  if(fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send('index.html no encontrado en public/');
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`KLIDO CRM corriendo en puerto ${PORT}`);
});
