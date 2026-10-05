// KLIDO V140 COMPLETO - FIX #100 + 132000 + DETECTOR REAL DE PLANTILLA
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
const limiter=new Bottleneck({maxConcurrent:1, minTime:3500});

const uploadDir=path.join(__dirname,'public','uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
const uploadDisk=multer({storage: multer.diskStorage({destination:uploadDir, filename:(req,file,cb)=>cb(null,Date.now()+'-'+file.originalname.replace(/\s/g,'_'))})});
const uploadMem=multer({storage: multer.memoryStorage()});

app.get('/health',(req,res)=>res.json({version:'KLIDO-V140-FIX-100-132000', time:Date.now(), phone:!!PHONE_ID, waba:!!WABA_ID, token:!!META_TOKEN}));

async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, creado BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', creada BIGINT, numeros JSONB, bloque_actual INT DEFAULT 0, imagen_url TEXT, variables JSONB)`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS imagen_url TEXT`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS variables JSONB`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS bloque_actual INT DEFAULT 0`);
  await pool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS numeros JSONB`);
  console.log('✅ DB KLIDO V140 OK');
}
initDB();

function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{req.user=jwt.verify(h.replace('Bearer ',''),JWT); next();}catch{res.status(401).json({error:'Token invalido'});} }
async function getEmp(id){
  if(!id) return {phone:PHONE_ID, waba:WABA_ID, token:META_TOKEN};
  const {rows}=await pool.query('SELECT * FROM agencias WHERE id=$1',[id]);
  const r=rows[0];
  return {phone:r?.phone_id||PHONE_ID, waba:r?.waba_id||WABA_ID, token:r?.meta_token||META_TOKEN};
}

function extraeNumeros(wb){
  let todos=[];
  wb.SheetNames.forEach(n=>{
    const data=xlsx.utils.sheet_to_json(wb.Sheets[n],{header:1, defval:''});
    data.forEach(row=>row.forEach(c=>{
      String(c).match(/\d{10,13}/g)?.forEach(p=>{
        let d=p.replace(/\D/g,'');
        if(d.length===10&&d.startsWith('3')) d='57'+d;
        if(d.length===11&&d.startsWith('573')) d='57'+d.slice(1);
        if(/^57[3][0-9]{9}$/.test(d)) todos.push(d);
      });
    }));
  });
  return [...new Set(todos)];
}

// API LOGIN
app.post('/api/login', async(req,res)=>{
  const {email,password}=req.body;
  const {rows}=await pool.query('SELECT * FROM agencias WHERE email=$1',[email]);
  if(!rows[0]) return res.status(401).json({error:'No existe'});
  const ok=await bcrypt.compare(password,rows[0].password); if(!ok) return res.status(401).json({error:'Clave mal'});
  const token=jwt.sign({agenciaId:rows[0].id},JWT,{expiresIn:'30d'}); res.json({ok:true,token});
});

// SUBIR EXCEL
app.post('/api/upload-excel', auth, uploadMem.single('file'), (req,res)=>{
  try{
    const wb=xlsx.read(req.file.buffer,{type:'buffer'});
    const nums=extraeNumeros(wb);
    if(!nums.length) return res.status(400).json({ok:false, error:'No encontre numeros validos'});
    res.json({ok:true,total:nums.length,numeros:nums});
  }catch(e){res.status(500).json({error:e.message});}
});

// SUBIR IMAGEN
app.post('/api/upload-imagen', auth, uploadDisk.single('file'), (req,res)=>{
  const url=`https://${req.headers.host}/uploads/${req.file.filename}`;
  console.log(`🖼️ Imagen subida: ${url}`);
  res.json({ok:true, url});
});

// SOLO APROBADAS
app.get('/api/plantillas', auth, async(req,res)=>{
  try{
    const emp=await getEmp(req.user.agenciaId);
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=name,language,status,components&limit=200&access_token=${emp.token}`);
    const j=await r.json();
    if(j.error) return res.status(400).json({error:j.error.message});
    const list=(j.data||[]).filter(t=>t.status==='APPROVED').map(t=>{
      const header=t.components?.find(c=>c.type==='HEADER');
      const body=t.components?.find(c=>c.type==='BODY');
      return {
        name:t.name,
        language:t.language,
        status:t.status,
        necesitaImagen: header?.format==='IMAGE',
        necesitaVideo: header?.format==='VIDEO',
        body: body?.text?.slice(0,200),
        vars: (body?.text?.match(/{{\d+}}/g)||[]).length
      };
    });
    res.json(list);
  }catch(e){res.status(500).json({error:e.message});}
});

// CREAR CAMPAÑA
app.post('/api/campanas', auth, async(req,res)=>{
  const {plantilla,numeros,imagen_url,variables}=req.body;
  if(!plantilla) return res.status(400).json({error:'Falta plantilla'});
  const limpios=[...new Set((numeros||[]).map(n=>String(n).replace(/\D/g,'')).map(d=>d.length===10?'57'+d:d))].filter(n=>/^57[3][0-9]{9}$/.test(n));
  if(!limpios.length) return res.status(400).json({error:'Sin numeros validos'});
  const id='camp_'+Date.now();
  await pool.query('INSERT INTO campanas_klido (id,agencia_id,plantilla,total,creada,numeros,bloque_actual,estado,imagen_url,variables) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,req.user.agenciaId,plantilla,limpios.length,Date.now(),JSON.stringify(limpios),0,'activa',imagen_url||null,JSON.stringify(variables||[])]);
  console.log(`🚀 Nueva campaña ${id} - ${plantilla} - ${limpios.length} numeros - imagen: ${imagen_url?'SI':'NO'} - vars: ${JSON.stringify(variables)}`);
  procesaCampana(id);
  res.json({ok:true,id,total:limpios.length});
});

app.get('/api/campanas', auth, async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]);
  res.json(rows);
});

// ENVIO QUE DETECTA PLANTILLA REAL Y ARREGLA #100
async function enviarUnNumero(emp, plantilla, imagen_url, varsFinal, numero){
  let templateInfo=null;
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=name,language,components&access_token=${emp.token}&limit=200`);
    const j=await r.json();
    templateInfo=(j.data||[]).find(t=>t.name===plantilla);
    if(templateInfo){
      console.log(`🔍 PLANTILLA REAL ${plantilla}:`, JSON.stringify(templateInfo).slice(0,1000));
    }
  }catch(e){ console.log('No pude leer plantilla', e.message); }

  if(!templateInfo) throw new Error('Plantilla no encontrada en Meta');

  const necesitaImagen = templateInfo.components?.some(c=>c.type==='HEADER' && c.format==='IMAGE');
  const headerText = templateInfo.components?.find(c=>c.type==='HEADER' && c.format==='TEXT');
  const bodyText = templateInfo.components?.find(c=>c.type==='BODY')?.text || '';
  const bodyVars = (bodyText.match(/{{\d+}}/g)||[]).length;
  const headerVars = headerText? (headerText.text?.match(/{{\d+}}/g)||[]).length : 0;
  const totalEsperado = headerVars + bodyVars;

  console.log(`📊 ${plantilla} lang=${templateInfo.language} necesitaImagen=${necesitaImagen} headerVars=${headerVars} bodyVars=${bodyVars} total=${totalEsperado}`);

  if(necesitaImagen &&!imagen_url){
    throw new Error(`PLANTILLA ${plantilla} NECESITA IMAGEN - Sube imagen en CRM. Si no subes imagen dara error #100`);
  }

  const components=[];
  if(necesitaImagen && imagen_url){
    components.push({type:'header', parameters:[{type:'image', image:{link:imagen_url}}]});
  }

  // Si hay variable en header TEXT
  if(headerVars>0){
    const hVars = varsFinal.slice(0, headerVars);
    components.push({type:'header', parameters: hVars.map(v=>({type:'text', text: String(v).slice(0,1024)}))});
    const bVars = varsFinal.slice(headerVars, headerVars+bodyVars);
    if(bVars.length>0) components.push({type:'body', parameters: bVars.map(v=>({type:'text', text: String(v).slice(0,1024)}))});
  }else{
    if(varsFinal.length>0){
      components.push({type:'body', parameters: varsFinal.map(v=>({type:'text', text: String(v).slice(0,1024)}))});
    }
  }

  const payload={
    messaging_product:'whatsapp',
    to: numero,
    type:'template',
    template:{
      name: plantilla,
      language:{code: templateInfo.language},
     ...(components.length?{components}:{})
    }
  };

  console.log(`📦 PAYLOAD -> ${numero}:`, JSON.stringify(payload).slice(0,700));

  return await limiter.schedule(async()=>{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`},
      body: JSON.stringify(payload)
    });
    const json = await r.json();
    return json;
  });
}

async function procesaCampana(id){
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]);
  if(!rows[0]) return;
  const c=rows[0];
  let nums=c.numeros; if(typeof nums==='string') nums=JSON.parse(nums);
  let varsInput=c.variables; if(typeof varsInput==='string') try{varsInput=JSON.parse(varsInput)}catch{varsInput=[]}
  const emp=await getEmp(c.agencia_id);

  // PARA ACOL_INVITACION_CONGRESO SOLO NECESITA 1 VARIABLE - FORZAMOS 1
  let varsBase = varsInput;
  if(varsInput.length===0) varsBase=["Cliente"];
  // Si mandaste 3, solo usamos la primera para esta plantilla que espera 1
  if(c.plantilla==='acol_invitacion_congreso') varsBase = [varsInput[0] || "Cliente"];

  console.log(`▶️ INICIANDO ${c.id} plantilla=${c.plantilla} con varsBase=${JSON.stringify(varsBase)} imagen=${c.imagen_url?'SI':'NO'}`);

  for(let i=c.bloque_actual||0;i<nums.length;i++){
    try{
      const result=await enviarUnNumero(emp, c.plantilla, c.imagen_url, varsBase, nums[i]);

      if(result.messages?.[0]?.id){
        console.log(`✅ ${c.plantilla} -> ${nums[i]} OK ${result.messages[0].id}`);
        await pool.query('UPDATE campanas_klido SET enviados=enviados+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
      }else{
        console.log(`❌ ${c.plantilla} -> ${nums[i]} ERROR:`, JSON.stringify(result).slice(0,800));

        if(result.error?.code===132000){
          // AUTO-FIX: extrae esperado del mensaje
          const msg=result.error.message||'';
          const detalles=result.error?.error_data?.details||'';
          const todos=[...(msg+detalles).matchAll(/\((\d+)\)/g)].map(m=>parseInt(m[1]));
          const esperado=todos[todos.length-1]?? 1;
          console.log(`🔄 AUTO-FIX 132000: Meta esperaba ${esperado}, habia mandado ${varsBase.length}. Reintentando...`);
          const varsFix = esperado===0? [] : varsBase.slice(0,esperado);
          // Si falta, rellena
          while(varsFix.length<esperado) varsFix.push("Cliente");

          const r2=await enviarUnNumero(emp, c.plantilla, c.imagen_url, varsFix, nums[i]);
          console.log(`📨 RETRY ${c.plantilla} -> ${nums[i]} ->`, JSON.stringify(r2).slice(0,800));
          if(r2.messages?.[0]?.id){
            await pool.query('UPDATE campanas_klido SET enviados=enviados+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
          }else{
            await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
          }
        }else{
          await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
        }
      }
    }catch(e){
      console.log(`💥 ERROR CRITICO ${c.plantilla} -> ${nums[i]}: ${e.message}`);
      await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
    }
  }
  await pool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['terminada',id]);
  console.log(`🏁 ${id} TERMINADA`);
}

app.use(express.static(path.join(__dirname,'public')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 KLIDO V140 QUE SIRVE EN ${PORT}`));
