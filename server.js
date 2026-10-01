import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = 'klido-avanza-2026';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
const f = n => path.join(DATA_DIR, n);
const read = (n,d=[])=>{try{return JSON.parse(fs.readFileSync(f(n),'utf8'))}catch{return d}};
const write = (n,d)=>fs.writeFileSync(f(n), JSON.stringify(d,null,2));

if(!fs.existsSync(f('agencias.json'))) write('agencias.json',[]);
if(!fs.existsSync(f('usuarios.json'))) write('usuarios.json',[]);

// EMERGENCIA: si Avanza no existe, la crea con clave Avanza2026*
let agencias = read('agencias.json');
let usuarios = read('usuarios.json');
let avanzaAg = agencias.find(a=>a.nombre.toLowerCase().includes('avanza'));
if(!avanzaAg){
  const id = Date.now().toString();
  avanzaAg = {id, nombre:'Avanza Consulting', plan:'gold', anual:2400000, mantenimiento:120000, codigo:'KLIDO-GOLD-EMERGENCIA', pagado:true, estado:'activo', estadoPago:'pagado', created:new Date()};
  agencias.push(avanzaAg);
  console.log('CREADA AVANZA AGENCIA EMERGENCIA');
}
let avanzaUser = usuarios.find(u=>u.email==='avanzaconsultingyl@gmail.com');
if(!avanzaUser){
  const hash = await bcrypt.hash('Avanza2026*',10);
  avanzaUser = {id:avanzaAg.id+'_1', email:'avanzaconsultingyl@gmail.com', password:hash, nombre:'Avanza Consulting', rol:'jefe', agenciaId:avanzaAg.id, plan:'gold'};
  usuarios.push(avanzaUser);
  console.log('CREADO USUARIO AVANZA Avanza2026*');
} else {
  // resetea clave a Avanza2026*
  const hash = await bcrypt.hash('Avanza2026*',10);
  avanzaUser.password = hash;
  console.log('RESET CLAVE AVANZA a Avanza2026*');
  // asegura agencia activa
  const ag = agencias.find(a=>a.id===avanzaUser.agenciaId);
  if(ag){ ag.pagado=true; ag.estado='activo'; ag.estadoPago='pagado'; }
}
write('agencias.json', agencias);
write('usuarios.json', usuarios);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
app.post('/api/login', async (req,res)=>{
  const {email,password}=req.body;
  let usuarios = read('usuarios.json');
  const u = usuarios.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(!u) return res.status(404).json({error:'No existe '+email});
  if(!await bcrypt.compare(password, u.password)) return res.status(401).json({error:'Pass mal'});
  let agencias = read('agencias.json');
  const ag = agencias.find(a=>a.id===u.agenciaId);
  if(ag){ ag.pagado=true; ag.estado='activo'; ag.estadoPago='pagado'; write('agencias.json', agencias); }
  const token = jwt.sign({id:u.id, agenciaId:u.agenciaId}, JWT_SECRET, {expiresIn:'7d'});
  res.json({token, user:{...u, agencia:ag}});
});
app.get('/health',(req,res)=>res.json({ok:true, agencias:read('agencias.json').length, usuarios:read('usuarios.json').length, avanza:'avanzaconsultingyl@gmail.com / Avanza2026*'}));
app.listen(PORT,()=>console.log(`EMERGENCIA AVANZA ACTIVA PORT ${PORT}`));
