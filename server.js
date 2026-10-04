// KLIDO FINAL - EXCEL AUTO + PLANTILLA APROBADA + SIN 132012
import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import path from 'path'; import { fileURLToPath } from 'url'; import multer from 'multer'; import xlsx from 'xlsx'; import fs from 'fs'; import Bottleneck from 'bottleneck';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); app.use(cors({origin:"*"})); app.use(express.json({limit:'100mb'})); app.use(express.static(path.join(__dirname,'public')));

const uploadDir=path.join(__dirname,'public','uploads'); if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
const storage=multer.diskStorage({destination:uploadDir, filename:(req,file,cb)=>cb(null, Date.now()+'-'+file.originalname)}); const upload=multer({storage});
const uploadMem=multer({storage:multer.memoryStorage()});

const {Pool}=pg; const pool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-final'; const META_TOKEN_GLOBAL=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||'';
const limiter=new Bottleneck({maxConcurrent:1, minTime:3500}); // Meta pide 3.5 seg

async function initDB(){
 await pool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, creado BIGINT)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', creada BIGINT, numeros JSONB, bloque_actual INT DEFAULT 0, imagen_url TEXT, variables JSONB)`);
 console.log('✅ KLIDO FINAL DB OK');
} initDB();

function auth(req,res,next){const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{req.user=jwt.verify(h.replace('Bearer ',''),JWT); next();}catch{res.status(401).json({error:'Token invalido'});}}
async function getEmp(id){if(!id) return {phone:process.env.PHONE_NUMBER_ID, waba:process.env.WABA_ID, token:META_TOKEN_GLOBAL}; const {rows}=await pool.query('SELECT * FROM agencias WHERE id=$1',[id]); const r=rows[0]; return {phone:r?.phone_id||process.env.PHONE_NUMBER_ID, waba:r?.waba_id||process.env.WABA_ID, token:r?.meta_token||META_TOKEN_GLOBAL};}

// DETECTOR DE NUMEROS INTELIGENTE - NO IMPORTA COLUMNA NI ORDEN
function extraeNumerosDeTexto(texto){
  let nums=[];
  String(texto).split(/[\s,;|\n]+/).forEach(p=>{
    let d=p.replace(/\D/g,'');
    if(d.length===10 && d.startsWith('3')) d='57'+d;
    if(d.length===12 && d.startsWith('57') && d[2]==='3') nums.push(d);
    if(d.length===11 && d.startsWith('573')) nums.push('57'+d.slice(1)); // por si viene sin un digito
  });
  return nums;
}
function numerosDeWorkbook(workbook){
  let todos=[];
  workbook.SheetNames.forEach(sheetName=>{
    const sheet=workbook.Sheets[sheetName];
    const json=xlsx.utils.sheet_to_json(sheet, {header:1, defval:''});
    json.forEach(row=>{
      row.forEach(cell=>{
        todos.push(...extraeNumerosDeTexto(cell));
      });
    });
  });
  // Unicos y validos
  let unicos=[...new Set(todos)].filter(n=>/^57[3][0-9]{9}$/.test(n));
  return unicos;
}

// 1. SUBIR EXCEL Y DETECTAR NUMEROS AUTOMATICAMENTE
app.post('/api/upload-excel', auth, uploadMem.single('file'), (req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:'No file'});
    const wb=xlsx.read(req.file.buffer, {type:'buffer'});
    const numeros=numerosDeWorkbook(wb);
    if(!numeros.length) return res.status(400).json({error:'No encontre numeros en el Excel. Asegurate que tenga numeros 3xx...'});
    res.json({ok:true, total:numeros.length, numeros});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// 2. SUBIR IMAGEN PARA PLANTILLAS CON FOTO
app.post('/api/upload-imagen', auth, upload.single('file'), (req,res)=>{
  const url=`https://app.klidoapp.com.co/uploads/${req.file.filename}`;
  res.json({ok:true, url});
});

// 3. SOLO PLANTILLAS APROBADAS - NO IMPORTA SI TIENEN FOTO O NO
app.get('/api/plantillas', auth, async(req,res)=>{
  const emp=await getEmp(req.user.agenciaId);
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=200`);
    const j=await r.json();
    const aprobadas=(j.data||[]).filter(t=>t.status==='APPROVED').map(t=>{
      const header=t.components?.find(c=>c.type==='HEADER');
      const body=t.components?.find(c=>c.type==='BODY');
      return {
        name:t.name,
        language:t.language,
        necesitaImagen: header?.format==='IMAGE',
        necesitaVideo: header?.format==='VIDEO',
        necesitaDocumento: header?.format==='DOCUMENT',
        variables: (body?.text?.match(/{{\d+}}/g)||[]).length,
        componentes:t.components
      };
    });
    res.json(aprobadas);
  }catch(e){ res.status(500).json({error:e.message}); }
});

// 4. CREAR CAMPAÑA - ACEPTA CUALQUIER PLANTILLA APROBADA
app.post('/api/campanas', auth, async(req,res)=>{
  const {plantilla, numeros, imagen_url, variables} = req.body;
  const validos=[...new Set((numeros||[]).map(n=>String(n).replace(/\D/g,'')).map(d=>d.length===10?'57'+d:d).filter(n=>/^57[3][0-9]{9}$/.test(n)))];
  if(!validos.length) return res.status(400).json({error:'Sin numeros validos'});
  const id='camp_'+Date.now();
  await pool.query('INSERT INTO campanas_klido (id,agencia_id,plantilla,total,creada,numeros,bloque_actual,estado,imagen_url,variables) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,req.user.agenciaId,plantilla,validos.length,Date.now(),JSON.stringify(validos),0,'activa',imagen_url||null,JSON.stringify(variables||[])]);
  procesa(id);
  res.json({ok:true, id, total:validos.length});
});

// 5. PROCESADOR QUE NUNCA DA 132012
async function procesa(id){
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return;
  const c=rows[0]; let nums=c.numeros; if(typeof nums==='string') nums=JSON.parse(nums);
  const emp=await getEmp(c.agencia_id);
  
  // Averiguar que necesita la plantilla
  let necesitaImagen=false; let lang='es_CO';
  try{
    const rT=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=200`);
    const jT=await rT.json(); const info=(jT.data||[]).find(t=>t.name===c.plantilla);
    if(info){ necesitaImagen=info.components?.some(x=>x.type==='HEADER'&&x.format==='IMAGE'); lang=info.language||'es_CO'; }
  }catch{}

  let vars=c.variables; if(typeof vars==='string') try{vars=JSON.parse(vars)}catch{vars=[]}

  for(let i=c.bloque_actual||0;i<nums.length;i++){
    const sendFn=async()=>{
      let components=[];
      if(necesitaImagen && c.imagen_url){
        components.push({type:'header', parameters:[{type:'image', image:{link:c.imagen_url}}]});
      }
      if(vars && vars.length>0){
        components.push({type:'body', parameters: vars.map(v=>({type:'text', text:String(v||'').slice(0,1024)}))});
      }
      const payload={messaging_product:'whatsapp', to:nums[i], type:'template', template:{name:c.plantilla, language:{code:lang}, ...(components.length?{components}:{})}};
      const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify(payload)});
      const j=await r.json();
      console.log(`📨 ${c.plantilla} -> ${nums[i]} ->`, j.messages?'OK '+j.messages[0].id:JSON.stringify(j));
      return j;
    };
    try{
      const j=await limiter.schedule(()=>sendFn());
      if(j.messages?.[0]?.id) await pool.query('UPDATE campanas_klido SET enviados=enviados+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
      else await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
    }catch(e){ await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]); }
  }
  await pool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['terminada',id]);
  console.log(`🏁 ${id} terminada`);
}

app.get('/api/campanas', auth, async(req,res)=>{const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows);});
app.get('/health',(req,res)=>res.json({version:'klido-final-excel-auto', status:'ok'}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000; app.listen(PORT,()=>console.log(`🚀 KLIDO FINAL PORT ${PORT}`));
