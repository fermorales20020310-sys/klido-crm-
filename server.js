// KLIDO v187 AUTOMATICO - NUNCA MAS TOCAR CODIGO POR PLANTILLA
import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import path from 'path'; import { fileURLToPath } from 'url'; import http from 'http'; import { Server } from 'socket.io';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); const server=http.createServer(app); const io=new Server(server,{cors:{origin:"*", methods:["GET","POST"]}});
app.use(cors({origin:"*"})); app.use(express.json({limit:'100mb'})); app.use(express.urlencoded({extended:true, limit:'100mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v187'; const PHONE_ID=process.env.PHONE_NUMBER_ID||'1338474282683914'; const WABA_ID=process.env.WABA_ID||'2317286332424288'; let META_TOKEN=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||''; if(!META_TOKEN){ for(const v of Object.values(process.env)){ if(typeof v==='string'&&v.startsWith('EAAT')&&v.length>80){META_TOKEN=v;break;}}}
const EN_PROCESO=new Map(); const CACHE_PLANTILLAS=new Map();

async function initDB(){
 await pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT DEFAULT 'basico', phone_id TEXT, waba_id TEXT, meta_token TEXT, creado BIGINT)`);
 await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', pausada BOOLEAN DEFAULT false, historial JSONB DEFAULT '[]', creada BIGINT, terminada BIGINT, numeros JSONB DEFAULT '[]', bloque_actual INT DEFAULT 0, imagen_url TEXT)`);
 console.log('✅ V187 AUTOMATICO DB OK');
} initDB();

function auth(req,res,next){const h=req.headers.authorization;if(!h) return res.status(401).json({error:'No token'});try{req.user=jwt.verify(h.replace('Bearer ',''),JWT);next();}catch{res.status(401).json({error:'Token invalido'});}}
async function getEmp(id){if(!id) return {phone:PHONE_ID,waba:WABA_ID,token:META_TOKEN};const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[id]);const r=rows[0];return {phone:r?.phone_id||PHONE_ID,waba:r?.waba_id||WABA_ID,token:r?.meta_token||META_TOKEN};}
function normalizaNumeros(arr){let out=[];(arr||[]).forEach(raw=>{String(raw||'').split(/[,;\n|]+/).forEach(p=>{let d=p.replace(/\D/g,'');if(d.length===10&&d.startsWith('3')) d='57'+d;if(/^57[3]\d{9}$/.test(d)) out.push(d);});});return [...new Set(out)];}

async function getPlantillaInfo(agenciaId, nombrePlantilla){
 try{
  const emp=await getEmp(agenciaId);
  if(CACHE_PLANTILLAS.has(nombrePlantilla)) return CACHE_PLANTILLAS.get(nombrePlantilla);
  const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=200`);
  const j=await r.json();
  const t=(j.data||[]).find(x=>x.name===nombrePlantilla);
  if(t){ CACHE_PLANTILLAS.set(nombrePlantilla, t); return t; }
 }catch(e){ console.log('No pude leer plantilla', e.message); }
 return null;
}

async function procesaWPP(id){
 if(EN_PROCESO.get(id)) return; EN_PROCESO.set(id,true);
 try{
  const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return;
  let c=rows[0]; let nums=c.numeros; if(typeof nums==='string') try{nums=JSON.parse(nums)}catch{nums=[]} nums=normalizaNumeros(nums);
  const emp=await getEmp(c.agencia_id);
  const info=await getPlantillaInfo(c.agencia_id, c.plantilla);
  const tieneImagenHeader = info?.components?.some(comp=>comp.type==='HEADER' && comp.format==='IMAGE');
  console.log(`🚀 V187 ${c.plantilla} tieneImagen=${tieneImagenHeader} imagen=${c.imagen_url}`);

  for(let i=c.bloque_actual||0;i<nums.length;i++){
    let components=[];
    // 1. Si plantilla necesita imagen, la mandamos
    if(tieneImagenHeader){
      const linkImg = c.imagen_url || process.env.IMAGE_URL || 'https://app.klidoapp.com.co/img/banner.jpg';
      components.push({type:'header', parameters:[{type:'image', image:{link:linkImg}}]});
    }
    // 2. Body siempre con variable Cliente
    components.push({type:'body', parameters:[{type:'text', text:'Cliente'}]});

    const payload={messaging_product:'whatsapp',to:nums[i],type:'template',template:{name:c.plantilla, language:{code:'es_CO'}, components}};
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify(payload)});
    const j=await r.json(); console.log(`📨 ${nums[i]} ->`,JSON.stringify(j).slice(0,500));
    if(j.messages?.[0]?.id){ await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1,bloque_actual=$1 WHERE id=$2',[i+1,id]); }
    else{ await pgPool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]); }
    await new Promise(r=>setTimeout(r,3500));
  }
  await pgPool.query('UPDATE campanas_klido SET estado=$1,terminada=$2 WHERE id=$3',['terminada',Date.now(),id]);
 }catch(e){console.log('❌ V187',e.message);}finally{EN_PROCESO.delete(id);}
}

app.post('/api/auth/login',async(req,res)=>{try{const {email,password}=req.body;const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]);if(!rows[0]) return res.status(404).json({error:'No existe'});if(!await bcrypt.compare(password,rows[0].password)) return res.status(401).json({error:'Clave mala'});res.json({ok:true,token:jwt.sign({agenciaId:rows[0].id,rol:'admin'},JWT)});}catch(e){res.status(500).json({error:e.message});}});

// AHORA DEVUELVE SI NECESITA IMAGEN O NO
app.get('/api/plantillas',auth,async(req,res)=>{
 const emp=await getEmp(req.user.agenciaId);
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=100`);
  const j=await r.json();
  const filtradas=(j.data||[]).filter(t=>t.status==='APPROVED').map(t=>{
    const necesitaImg = t.components?.some(c=>c.type==='HEADER' && c.format==='IMAGE');
    return {...t, necesitaImagen: necesitaImg };
  });
  res.json(filtradas);
 }catch{res.json([{name:'acol_invitacion_congreso',status:'APPROVED',language:'es_CO', necesitaImagen:true}]);}
});

// AHORA ACEPTA imagen_url
app.post('/api/campanas',auth,async(req,res)=>{
 try{
  const {plantilla,numeros,imagen_url}=req.body;
  const validos=normalizaNumeros(numeros||[]); if(!validos.length) return res.status(400).json({error:'No hay números'});
  const id='camp_'+Date.now();
  await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada,historial,numeros,bloque_actual,estado,imagen_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,req.user.agenciaId,plantilla,plantilla,validos.length,Date.now(),JSON.stringify([{variables:['Cliente']}]),JSON.stringify(validos),0,'activa',imagen_url||null]);
  procesaWPP(id); res.json({ok:true,id,total:validos.length});
 }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/campanas',auth,async(req,res)=>{const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]);res.json(rows);});
app.get('/health',(req,res)=>res.json({ok:true,version:'v187-automatico'}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log(`🚀 V187 AUTOMATICO PORT ${PORT}`));
setTimeout(async()=>{const {rows}=await pgPool.query("SELECT id FROM campanas_klido WHERE estado='activa'");rows.forEach(r=>procesaWPP(r.id));},5000);
