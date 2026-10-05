// KLIDO FINAL V138 - AUTO AJUSTA VARIABLES + AUTO MIGRA DB
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

app.get('/health',(req,res)=>res.json({version:'KLIDO-FINAL-V138-FIX-132000', fix:'auto-vars', time:Date.now()}));

async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, creado BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', creada BIGINT, numeros JSONB, bloque_actual INT DEFAULT 0, imagen_url TEXT, variables JSONB)`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS imagen_url TEXT`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS variables JSONB`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS bloque_actual INT DEFAULT 0`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS numeros JSONB`);
  console.log('✅ DB KLIDO FINAL OK V138');
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
  try{ const wb=xlsx.read(req.file.buffer,{type:'buffer'}); const nums=extraeNumeros(wb); if(!nums.length) return res.status(400).json({error:'No numeros'}); res.json({ok:true,total:nums.length,numeros:nums}); }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/upload-imagen', auth, uploadDisk.single('file'), (req,res)=>{ res.json({ok:true, url:`https://${req.headers.host}/uploads/${req.file.filename}`}); });
app.get('/api/plantillas', auth, async(req,res)=>{
  try{
    const emp=await getEmp(req.user.agenciaId);
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=name,language,status,components&limit=200&access_token=${emp.token}`);
    const j=await r.json(); const list=(j.data||[]).filter(t=>t.status==='APPROVED').map(t=>({name:t.name,language:t.language,status:t.status, necesitaImagen:t.components?.some(c=>c.type==='HEADER'&&c.format==='IMAGE'), vars:(t.components?.find(c=>c.type==='BODY')?.text?.match(/{{\d+}}/g)||[]).length}));
    res.json(list);
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/campanas', auth, async(req,res)=>{
  const {plantilla,numeros,imagen_url,variables}=req.body;
  const limpios=[...new Set(numeros||[])].filter(Boolean);
  const id='camp_'+Date.now();
  await pool.query('INSERT INTO campanas_klido (id,agencia_id,plantilla,total,creada,numeros,bloque_actual,estado,imagen_url,variables) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,req.user.agenciaId,plantilla,limpios.length,Date.now(),JSON.stringify(limpios),0,'activa',imagen_url||null,JSON.stringify(variables||[])]);
  procesaCampana(id); res.json({ok:true,id,total:limpios.length});
});
app.get('/api/campanas', auth, async(req,res)=>{ const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });

// ESTA ES LA FUNCION QUE ARREGLA TU ERROR 132000
async function procesaCampana(id){
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return; const c=rows[0];
  let nums=c.numeros; if(typeof nums==='string') nums=JSON.parse(nums);
  let varsInput=c.variables; if(typeof varsInput==='string') try{varsInput=JSON.parse(varsInput)}catch{varsInput=[]}
  const emp=await getEmp(c.agencia_id);
  let necesitaImagen=false; let lang='es_CO'; let esperaVars=0;
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=name,language,components&access_token=${emp.token}&limit=200`);
    const j=await r.json(); const info=(j.data||[]).find(t=>t.name===c.plantilla);
    if(info){ lang=info.language; necesitaImagen=info.components?.some(x=>x.type==='HEADER'&&x.format==='IMAGE'); const body=info.components?.find(x=>x.type==='BODY')?.text||''; esperaVars=(body.match(/{{\d+}}/g)||[]).length; console.log(`📋 ${c.plantilla} en Meta espera ${esperaVars} vars, tu mandaste ${varsInput.length}`); }
  }catch{}
  // FIX AUTOMATICO
  const defaults=["Fer","Congreso ACOL","Bogotá"];
  let varsFinal=[];
  if(esperaVars===0) varsFinal=[];
  else{
    if(varsInput.length===0) varsFinal=defaults.slice(0,esperaVars);
    else if(varsInput.length>=esperaVars) varsFinal=varsInput.slice(0,esperaVars);
    else{ varsFinal=[...varsInput]; while(varsFinal.length<esperaVars) varsFinal.push(defaults[varsFinal.length]||"Cliente"); }
  }

  for(let i=c.bloque_actual||0;i<nums.length;i++){
    const components=[];
    if(necesitaImagen&&c.imagen_url) components.push({type:'header',parameters:[{type:'image',image:{link:c.imagen_url}}]});
    if(varsFinal.length>0) components.push({type:'body',parameters:varsFinal.map(v=>({type:'text',text:String(v).slice(0,1024)}))});
    const payload={messaging_product:'whatsapp',to:nums[i],type:'template',template:{name:c.plantilla,language:{code:lang},...(components.length?{components}:{})}};
    try{
      const result=await limiter.schedule(async()=>{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify(payload)}); return r.json(); });
      console.log(`📨 ${c.plantilla} -> ${nums[i]} con ${varsFinal.length} vars ->`, result.messages?`OK ${result.messages[0].id}`:JSON.stringify(result).slice(0,300));
      if(result.messages?.[0]?.id) await pool.query('UPDATE campanas_klido SET enviados=enviados+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
      else await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
    }catch(e){ await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]); }
  }
  await pool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['terminada',id]); console.log(`🏁 ${id} TERMINADA`);
}

app.use(express.static(path.join(__dirname,'public')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 KLIDO FINAL QUE SIRVE EN ${PORT}`));
