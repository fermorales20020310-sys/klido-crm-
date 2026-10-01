const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));
const publicPath = path.join(__dirname,'public');
app.use(express.static(publicPath));
console.log('Public:',fs.existsSync(publicPath) ? fs.readdirSync(publicPath) : 'no existe');

app.get('/health',(req,res)=>res.send('OK'));

let usuarios=[{id:'1',nombre:'Fer Morales',email:'fermorales20020310@gmail.com',password:'Mafe2002@',rol:'SuperAdmin'}];
let empresas=[];
let resetCodes={};

app.post('/api/login',(req,res)=>{
  const {email,password}=req.body;
  const u=usuarios.find(x=>x.email.toLowerCase()===email.toLowerCase() && x.password===password);
  if(!u) return res.status(401).json({error:'Correo o contraseña incorrecta'});
  return res.json({token:'tok_'+Date.now(), user:{id:u.id,nombre:u.nombre,email:u.email,rol:u.rol}});
});

app.post('/api/public/crear-empresa',(req,res)=>{
  const {nombre,email,password,plan,codigoIngresado}=req.body;
  if(!nombre||!email||!password) return res.status(400).json({error:'Faltan datos'});
  if(usuarios.some(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Correo ya existe'});
  const codigoAcceso='KLIDO'+Math.floor(1000+Math.random()*9000);
  empresas.push({nombre,email,plan,codigoAcceso,createdAt:new Date()});
  usuarios.push({id:Date.now().toString(),nombre,email,password,rol:'Admin'});
  return res.json({ok:true,codigoAcceso});
});

app.post('/api/auth/forgot',(req,res)=>{
  const code=String(Math.floor(100000+Math.random()*900000));
  resetCodes[req.body.email.toLowerCase()]=code;
  console.log('CODE',req.body.email,code);
  return res.json({ok:true,message:'Código: '+code});
});
app.post('/api/auth/reset',(req,res)=>{
  const {email,code,newPassword}=req.body;
  if(resetCodes[email.toLowerCase()]!==code) return res.status(400).json({error:'Código inválido'});
  const u=usuarios.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(u) u.password=newPassword;
  delete resetCodes[email.toLowerCase()];
  return res.json({ok:true,message:'Contraseña cambiada'});
});

app.get('*',(req,res)=>res.sendFile(path.join(publicPath,'index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log('KLIDO OK en '+PORT));
