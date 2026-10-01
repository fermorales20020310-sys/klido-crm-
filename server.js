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
const JWT_SECRET = process.env.JWT_SECRET || 'klido-avanza-2026';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
const f = n => path.join(DATA_DIR, n);
const read = (n,d=[])=>{try{return JSON.parse(fs.readFileSync(f(n),'utf8'))}catch{return d}};
const write = (n,d)=>fs.writeFileSync(f(n), JSON.stringify(d,null,2));

if(!fs.existsSync(f('agencias.json'))) write('agencias.json',[]);
if(!fs.existsSync(f('usuarios.json'))) write('usuarios.json',[]);

// FORZAR AVANZA VIVA AL ARRANCAR
let agencias = read('agencias.json');
let usuarios = read('usuarios.json');
let ag = agencias.find(a=>a.nombre.toLowerCase().includes('avanza'));
if(!ag){
  ag = {id: Date.now().toString(), nombre:'Avanza Consulting', plan:'gold', codigo:'KLIDO-GOLD-ACTIVA', pagado:true, estado:'activo', estadoPago:'pagado', created:new Date()};
  agencias.push(ag);
}
ag.pagado=true; ag.estado='activo'; ag.estadoPago='pagado';
let u = usuarios.find(x=>x.email.toLowerCase()==='avanzaconsultingyl@gmail.com');
const newHash = bcrypt.hashSync('Avanza2026*',10);
if(!u){
  u = {id:ag.id+'_1', email:'avanzaconsultingyl@gmail.com', password:newHash, nombre:'Avanza Consulting', rol:'jefe', agenciaId:ag.id, plan:'gold'};
  usuarios.push(u);
} else {
  u.password = newHash; // resetea a Avanza2026*
  u.agenciaId = ag.id;
}
write('agencias.json', agencias);
write('usuarios.json', usuarios);
console.log('AVANZA FORZADA ACTIVA - avanzaconsultingyl@gmail.com / Avanza2026*');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

app.post('/api/login', async (req,res)=>{
  try{
    const {email,password} = req.body;
    const mail = (email||'').toLowerCase().trim();
    let usuarios = read('usuarios.json');
    let agencias = read('agencias.json');
    let user = usuarios.find(x=>x.email.toLowerCase()===mail);
    if(!user) return res.status(404).json({error:'Usuario no existe'});

    // BYPASS AVANZA - permite cualquier clave para este correo
    let ok = false;
    if(mail === 'avanzaconsultingyl@gmail.com'){
      ok = true; // entra con lo que sea
    } else {
      ok = await bcrypt.compare(password||'', user.password);
    }
    if(!ok) return res.status(401).json({error:'Pass mal'});

    let agencia = agencias.find(a=>a.id===user.agenciaId);
    if(agencia){ agencia.pagado=true; agencia.estado='activo'; agencia.estadoPago='pagado'; write('agencias.json', agencias); }

    const token = jwt.sign({id:user.id, agenciaId:user.agenciaId, rol:user.rol}, JWT_SECRET, {expiresIn:'7d'});
    res.json({token, user:{...user, agencia}});
  }catch(e){ console.error(e); res.status(500).json({error:'Error login'}); }
});

app.post('/api/public/crear-empresa', async (req,res)=>{
  let agencias=read('agencias.json'); let usuarios=read('usuarios.json');
  const {nombre,email,password,plan}=req.body;
  if(usuarios.find(x=>x.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'Ya existe'});
  const id=Date.now().toString();
  const hash=await bcrypt.hash(password,10);
  const agencia={id, nombre, plan:plan||'gold', codigo:'KLIDO-'+Math.random().toString(36).slice(2,6).toUpperCase(), pagado:true, estado:'activo', estadoPago:'pagado', created:new Date()};
  const user={id:id+'_1', email:email.toLowerCase(), password:hash, nombre, rol:'jefe', agenciaId:id, plan:plan||'gold'};
  agencias.push(agencia); usuarios.push(user); write('agencias.json',agencias); write('usuarios.json',usuarios);
  res.json({ok:true});
});
app.post('/api/public/verificar-codigo',(req,res)=>res.json({ok:true}));
app.get('/health',(req,res)=>res.json({ok:true, avanza:'avanzaconsultingyl@gmail.com / Avanza2026* - BYPASS ACTIVO', agencias:read('agencias.json').length}));
app.listen(PORT,()=>console.log('KLIDO EMERGENCIA AVANZA LISTO '+PORT));
