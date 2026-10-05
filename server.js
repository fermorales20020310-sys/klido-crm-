// KLIDO V139 - SE AUTO-CORRIGE CON EL ERROR DE META
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Bottleneck from 'bottleneck';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors({origin:"*"}));
app.use(express.json({limit:'100mb'}));

const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-final-2026';
const PHONE_ID=process.env.PHONE_NUMBER_ID;
const WABA_ID=process.env.WABA_ID;
const META_TOKEN=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN;
const limiter=new Bottleneck({maxConcurrent:1, minTime:4000});

const uploadDir=path.join(__dirname,'public','uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
const uploadDisk=multer({storage: multer.diskStorage({destination:uploadDir, filename:(req,file,cb)=>cb(null,Date.now()+'-'+file.originalname.replace(/\s/g,'_'))})});
const uploadMem=multer({storage: multer.memoryStorage()});

app.get('/health',(req,res)=>res.json({version:'KLIDO-V139-AUTO-FIX', time:Date.now()}));

async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, creado BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', creada BIGINT, numeros JSONB, bloque_actual INT DEFAULT 0, imagen_url TEXT, variables JSONB)`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS imagen_url TEXT`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS variables JSONB`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS bloque_actual INT DEFAULT 0`);
  console.log('✅ DB V139 OK');
}
initDB();

function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{req.user=jwt.verify(h.replace('Bearer ',''),JWT); next();}catch{res.status(401).json({error:'Token invalido'});} }
async function getEmp(id){ const {rows}=await pool.query('SELECT * FROM agencias WHERE id=$1',[id]); const r=rows[0]; return {phone:r?.phone_id||PHONE_ID, waba:r?.waba_id||WABA_ID, token:r?.meta_token||META_TOKEN}; }

function extraeNumeros(wb){
  let todos=[];
  wb.SheetNames.forEach(n=>{
    const data=xlsx.utils.sheet_to_json(wb.Sheets[n],{header:1, defval:''});
    data.forEach(row=>row.forEach(c=>{
      String(c).match(/\d{10,13}/g)?.forEach(p=>{
        let d=p.replace(/\D/g,''); if(d.length===10&&d.startsWith('3')) d='57'+d; if(/^57[3][0-9]{9}$/.test(d)) todos.push(d);
      });
    }));
  });
  return [...new Set(todos)];
}

app.post('/api/login', async(req,res)=>{
  const {email,password}=req.body;
  const {rows}=await pool.query('SELECT * FROM agencias WHERE email=$1',[email]);
  if(!rows[0]) return res.status(401).json({error:'No existe'});
  const ok=await bcrypt.compare(password,rows[0].password); if(!ok) return res.status(401).json({error:'Clave mal'});
  const token=jwt.sign({agenciaId:rows[0].id},JWT,{expiresIn:'30d'}); res.json({ok:true,token});
});
app.post('/api/upload-excel', auth, uploadMem.single('file'), (req,res)=>{
  try{ const wb=xlsx.read(req.file.buffer,{type:'buffer'}); const nums=extraeNumeros(wb); res.json({ok:true,total:nums.length,numeros:nums}); }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/upload-imagen', auth, uploadDisk.single('file'), (req,res)=>{ res.json({ok:true, url:`https://${req.headers.host}/uploads/${req.file.filename}`}); });
app.get('/api/plantillas', auth, async(req,res)=>{
  try{
    const emp=await getEmp(req.user.agenciaId);
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=name,language,status,components&limit=200&access_token=${emp.token}`);
    const j=await r.json();
    const list=(j.data||[]).filter(t=>t.status==='APPROVED').map(t=>({name:t.name,language:t.language,status:t.status, necesitaImagen:t.components?.some(c=>c.type==='HEADER'&&c.format==='IMAGE'), body:t.components?.find(c=>c.type==='BODY')?.text}));
    res.json(list);
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/campanas', auth, async(req,res)=>{
  const {plantilla,numeros,imagen_url,variables}=req.body;
  const id='camp_'+Date.now();
  await pool.query('INSERT INTO campanas_klido (id,agencia_id,plantilla,total,creada,numeros,bloque_actual,estado,imagen_url,variables) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,req.user.agenciaId,plantilla,numeros.length,Date.now(),JSON.stringify(numeros),0,'activa',imagen_url||null,JSON.stringify(variables||[])]);
  procesaCampana(id); res.json({ok:true,id});
});
app.get('/api/campanas', auth, async(req,res)=>{ const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });

async function enviarUnNumero(emp, plantilla, lang, imagen_url, varsFinal, numero){
  let necesitaImagen=false;
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=components&access_token=${emp.token}&limit=200`);
    const j=await r.json(); const info=(j.data||[]).find(t=>t.name===plantilla);
    if(info) necesitaImagen=info.components?.some(x=>x.type==='HEADER'&&x.format==='IMAGE');
  }catch{}

  const components=[];
  if(necesitaImagen && imagen_url) components.push({type:'header', parameters:[{type:'image', image:{link:imagen_url}}]});
  if(varsFinal.length>0) components.push({type:'body', parameters: varsFinal.map(v=>({type:'text', text:String(v).slice(0,1024)}))});

  const payload={messaging_product:'whatsapp', to:numero, type:'template', template:{name:plantilla, language:{code:lang}, ...(components.length?{components}:{}) }};

  return await limiter.schedule(async()=>{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify(payload)});
    return r.json();
  });
}

async function procesaCampana(id){
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return; const c=rows[0];
  let nums=c.numeros; if(typeof nums==='string') nums=JSON.parse(nums);
  let varsInput=c.variables; if(typeof varsInput==='string') try{varsInput=JSON.parse(varsInput)}catch{varsInput=[]}
  const emp=await getEmp(c.agencia_id);

  // FIX DEFINITIVO: Meta dice que espera 1, mandamos 1. Tu plantilla acol_ es 1 variable.
  let lang='es'; // tu plantilla esta en 'es' no 'es_CO'
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=name,language&access_token=${emp.token}&limit=200`);
    const j=await r.json(); const info=(j.data||[]).find(t=>t.name===c.plantilla);
    if(info) lang=info.language;
  }catch{}

  // Si mandaste 3 pero Meta espera 1, usamos solo el primero: "Cliente" o "Fer"
  const defaults=["Fer"];
  let varsBase = varsInput.length>0 ? varsInput : defaults;
  
  for(let i=c.bloque_actual||0;i<nums.length;i++){
    let intento=0;
    let enviado=false;
    let varsIntento=[...varsBase];

    while(intento<3 && !enviado){
      const result=await enviarUnNumero(emp, c.plantilla, lang, c.imagen_url, varsIntento, nums[i]);
      console.log(`📨 ${c.plantilla} -> ${nums[i]} con ${varsIntento.length} vars ${JSON.stringify(varsIntento)} ->`, JSON.stringify(result).slice(0,500));

      if(result.messages?.[0]?.id){
        await pool.query('UPDATE campanas_klido SET enviados=enviados+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
        enviado=true;
      }else if(result.error?.code===132000){
        // META NOS DICE CUANTOS ESPERA - LO LEEMOS DEL MENSAJE
        const msg=result.error?.error_data?.details||result.error?.message||'';
        const match=msg.match(/expected.*?(\d+)/i) || result.error.message.match(/\((\d+)\)/);
        let esperado=1;
        if(match) esperado=parseInt(match[1]||match[0].match(/\d+/)[0]);
        // Si el mensaje dice "expected number of params (1)" -> esperado=1
        const m2 = result.error.message.match(/\(1\)/); if(m2) esperado=1;
        // El detalle dice: (0) vs (1) -> el segundo es el esperado
        const todosNumeros=[...msg.matchAll(/\((\d+)\)/g)].map(m=>parseInt(m[1]));
        const todosMsg=[...result.error.message.matchAll(/\((\d+)\)/g)].map(m=>parseInt(m[1]));
        if(todosMsg.length>=1) esperado=todosMsg[todosMsg.length-1];
        else if(todosNumeros.length>=1) esperado=todosNumeros[todosNumeros.length-1];

        console.log(`🔄 AUTO-FIX: Meta esperaba ${esperado}, habia mandado ${varsIntento.length}. Reintentando...`);
        if(esperado===0) varsIntento=[];
        else if(varsIntento.length>esperado) varsIntento=varsIntento.slice(0,esperado);
        else if(varsIntento.length<esperado){ while(varsIntento.length<esperado) varsIntento.push(defaults[varsIntento.length]||"Cliente"); }
        intento++;
        if(intento>=3){ await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]); break; }
      }else{
        await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
        break;
      }
    }
  }
  await pool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['terminada',id]);
}

app.use(express.static(path.join(__dirname,'public')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000,()=>console.log(`🚀 KLIDO V139 EN ${process.env.PORT||3000}`));
