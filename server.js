// server.js - KLIDO FINAL QUE SIRVE - COPIA Y PEGA TODO
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import jwt from 'jsonwebtoken';
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
app.use(express.json({limit:'50mb'}));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, {recursive:true});
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req,file,cb) => cb(null, Date.now()+'-'+file.originalname.replace(/\s/g,'_'))
});
const uploadDisk = multer({storage});
const uploadMem = multer({storage: multer.memoryStorage()});

const {Pool} = pg;
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT = process.env.JWT_SECRET || 'klido-final-2026';
const limiter = new Bottleneck({maxConcurrent:1, minTime:4000});

const PHONE_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;
const META_TOKEN = process.env.META_TOKEN || process.env.WHATSAPP_TOKEN;

async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, creado BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', creada BIGINT, numeros JSONB, bloque_actual INT DEFAULT 0, imagen_url TEXT, variables JSONB)`);
  console.log('✅ DB OK - KLIDO FINAL');
}
initDB();

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h) return res.status(401).json({error:'No token'});
  try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }
}
async function getEmp(id){
  const {rows}=await pool.query('SELECT * FROM agencias WHERE id=$1',[id]);
  const r=rows[0];
  return {
    phone: r?.phone_id || PHONE_ID,
    waba: r?.waba_id || WABA_ID,
    token: r?.meta_token || META_TOKEN
  };
}

// DETECTOR DE NUMEROS - NO IMPORTA COLUMNA
function extraeNumeros(wb){
  let todos=[];
  wb.SheetNames.forEach(name=>{
    const sheet=wb.Sheets[name];
    const data=xlsx.utils.sheet_to_json(sheet,{header:1, defval:''});
    data.forEach(row=>{
      row.forEach(cell=>{
        String(cell).split(/[^0-9]+/).forEach(p=>{
          let d=p.replace(/\D/g,'');
          if(d.length===10 && d.startsWith('3')) d='57'+d;
          if(/^57[3][0-9]{9}$/.test(d)) todos.push(d);
        });
        // también por si viene pegado en texto
        let txt=String(cell);
        let match=txt.match(/3\d{9}/g);
        if(match) match.forEach(m=> todos.push('57'+m));
      });
    });
  });
  return [...new Set(todos)];
}

// ENDPOINTS
app.get('/health',(req,res)=>res.json({version:'KLIDO-FINAL-SIRVE', phone:PHONE_ID?'OK':'NO', token:META_TOKEN?'OK':'NO'}));

app.post('/api/upload-excel', auth, uploadMem.single('file'), (req,res)=>{
  try{
    const wb=xlsx.read(req.file.buffer,{type:'buffer'});
    const numeros=extraeNumeros(wb);
    if(!numeros.length) return res.status(400).json({error:'No encontre numeros. Sube un Excel que tenga numeros 3xxxxxxxxx'});
    res.json({ok:true, total:numeros.length, numeros});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/upload-imagen', auth, uploadDisk.single('file'), (req,res)=>{
  res.json({ok:true, url:`https://${req.headers.host}/uploads/${req.file.filename}`});
});

app.get('/api/plantillas', auth, async(req,res)=>{
  const emp=await getEmp(req.user.agenciaId);
  const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=100`);
  const j=await r.json();
  const list=(j.data||[]).filter(t=>t.status==='APPROVED').map(t=>({
    name:t.name,
    language:t.language,
    necesitaImagen: t.components?.some(c=>c.type==='HEADER' && c.format==='IMAGE'),
    variables: (t.components?.find(c=>c.type==='BODY')?.text?.match(/{{\d+}}/g)||[]).length
  }));
  res.json(list);
});

app.post('/api/campanas', auth, async(req,res)=>{
  const {plantilla, numeros, imagen_url, variables} = req.body;
  if(!plantilla) return res.status(400).json({error:'Falta plantilla'});
  if(!numeros || !numeros.length) return res.status(400).json({error:'Falta numeros'});
  const id='camp_'+Date.now();
  await pool.query('INSERT INTO campanas_klido (id,agencia_id,plantilla,total,creada,numeros,bloque_actual,estado,imagen_url,variables) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id, req.user.agenciaId, plantilla, numeros.length, Date.now(), JSON.stringify(numeros), 0, 'activa', imagen_url||null, JSON.stringify(variables||[])]);
  procesaCampana(id);
  res.json({ok:true, id, total:numeros.length});
});

async function procesaCampana(id){
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return;
  const c=rows[0]; let nums=c.numeros; if(typeof nums==='string') nums=JSON.parse(nums);
  const emp=await getEmp(c.agencia_id);

  // Saber si necesita imagen
  let necesitaImagen=false; let lang='es_CO';
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=100`);
    const j=await r.json(); const t=(j.data||[]).find(x=>x.name===c.plantilla);
    if(t){ necesitaImagen=t.components?.some(x=>x.type==='HEADER'&&x.format==='IMAGE'); lang=t.language; }
  }catch{}

  let vars=c.variables; if(typeof vars==='string') try{vars=JSON.parse(vars)}catch{vars=[]}

  for(let i=c.bloque_actual||0;i<nums.length;i++){
    const payload={
      messaging_product:'whatsapp',
      to: nums[i],
      type:'template',
      template:{
        name: c.plantilla,
        language:{code: lang},
        components: []
      }
    };
    if(necesitaImagen && c.imagen_url){
      payload.template.components.push({type:'header', parameters:[{type:'image', image:{link:c.imagen_url}}]});
    }
    if(vars && vars.length>0){
      payload.template.components.push({type:'body', parameters: vars.map(v=>({type:'text', text:String(v)}))});
    }
    if(payload.template.components.length===0) delete payload.template.components;

    console.log('ENVIANDO', nums[i], c.plantilla, 'imagen?', necesitaImagen?'SI':'NO');

    try{
      const j=await limiter.schedule(async()=>{
        const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify(payload)});
        return r.json();
      });
      console.log('RESPUESTA META', JSON.stringify(j).slice(0,500));
      if(j.messages?.[0]?.id) await pool.query('UPDATE campanas_klido SET enviados=enviados+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
      else await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]);
    }catch(e){ console.log('ERROR',e.message); await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1,bloque_actual=$1 WHERE id=$2',[i+1,id]); }
  }
  await pool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['terminada',id]);
  console.log(`🏁 ${id} TERMINADA`);
}

app.get('/api/campanas', auth, async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]);
  res.json(rows);
});

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 KLIDO FINAL QUE SIRVE EN ${PORT}`));
