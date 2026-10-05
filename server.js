// KLIDO FINAL COMPLETO - APROBADAS + EXCEL AUTO + SIN 132012
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

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'klido-final-2026';
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;
const META_TOKEN = process.env.META_TOKEN || process.env.WHATSAPP_TOKEN;
const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 4000 });

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const diskStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (req,file,cb) => cb(null, Date.now()+'-'+file.originalname.replace(/\s/g,'_'))
});
const uploadDisk = multer({ storage: diskStorage });
const uploadMem = multer({ storage: multer.memoryStorage() });

// MIDDLEWARE - API PRIMERO PARA QUE NUNCA DEVUELVA HTML
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '100mb' }));

app.get('/health', (req,res) => {
  res.json({ version: 'KLIDO-FINAL-SIRVE', phone:!!PHONE_ID, waba:!!WABA_ID, token:!!META_TOKEN, time: Date.now() });
});

async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, creado BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', creada BIGINT, numeros JSONB, bloque_actual INT DEFAULT 0, imagen_url TEXT, variables JSONB)`);
  console.log('✅ DB KLIDO FINAL OK');
}
initDB();

function auth(req,res,next){
  const h = req.headers.authorization;
  if(!h) return res.status(401).json({ ok:false, error:'No token' });
  try{ req.user = jwt.verify(h.replace('Bearer ',''), JWT_SECRET); next(); }
  catch{ return res.status(401).json({ ok:false, error:'Token invalido' }); }
}
async function getEmp(agenciaId){
  if(!agenciaId) return { phone: PHONE_ID, waba: WABA_ID, token: META_TOKEN };
  const { rows } = await pool.query('SELECT * FROM agencias WHERE id=$1',[agenciaId]);
  const r = rows[0];
  return { phone: r?.phone_id || PHONE_ID, waba: r?.waba_id || WABA_ID, token: r?.meta_token || META_TOKEN };
}

// DETECTOR INTELIGENTE DE NUMEROS - CUALQUIER COLUMNA, CUALQUIER ORDEN
function extraeNumerosWorkbook(wb){
  let todos=[];
  wb.SheetNames.forEach(sheetName=>{
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header:1, defval:'' });
    rows.forEach(row=>{
      row.forEach(cell=>{
        const txt = String(cell);
        // busca 3xxxxxxxxx o 57 3xxxxxxxxx en cualquier texto
        const encontrados = txt.match(/(\d{10,13})/g) || [];
        encontrados.forEach(p=>{
          let d = p.replace(/\D/g,'');
          if(d.length===10 && d.startsWith('3')) d='57'+d;
          if(d.length===12 && /^57[3]/.test(d)) todos.push(d);
          if(d.length===11 && d.startsWith('573')) todos.push('57'+d.slice(1));
        });
      });
    });
  });
  return [...new Set(todos)].filter(n=>/^57[3][0-9]{9}$/.test(n));
}

// LOGIN / REGISTER (para tu crm.html)
app.post('/api/login', async(req,res)=>{
  const {email,password} = req.body;
  const {rows}=await pool.query('SELECT * FROM agencias WHERE email=$1',[email]);
  if(!rows[0]) return res.status(401).json({error:'No existe'});
  const ok=await bcrypt.compare(password, rows[0].password);
  if(!ok) return res.status(401).json({error:'Clave mal'});
  const token=jwt.sign({agenciaId: rows[0].id, email}, JWT_SECRET, {expiresIn:'30d'});
  res.json({ok:true, token, agencia: rows[0]});
});

// SUBIR EXCEL - DEVUELVE NUMEROS YA LIMPIOS
app.post('/api/upload-excel', auth, uploadMem.single('file'), (req,res)=>{
  try{
    if(!req.file) return res.status(400).json({ok:false, error:'No file'});
    const wb = xlsx.read(req.file.buffer, {type:'buffer'});
    const numeros = extraeNumerosWorkbook(wb);
    if(!numeros.length) return res.status(400).json({ok:false, error:'No encontré números. El Excel debe tener números tipo 3xxxxxxxxx'});
    res.json({ok:true, total: numeros.length, numeros});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

// SUBIR IMAGEN PARA PLANTILLAS CON HEADER IMAGE
app.post('/api/upload-imagen', auth, uploadDisk.single('file'), (req,res)=>{
  const host = req.headers.host;
  const url = `https://${host}/uploads/${req.file.filename}`;
  res.json({ok:true, url});
});

// SOLO PLANTILLAS APROBADAS - TENGA O NO FOTO, SI ESTA APROBADA LA ACEPTA
app.get('/api/plantillas', auth, async(req,res)=>{
  try{
    const emp = await getEmp(req.user.agenciaId);
    if(!emp.waba ||!emp.token) return res.status(400).json({ok:false, error:'Falta WABA_ID o META_TOKEN en agencia'});
    const r = await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=name,language,status,components&limit=200&access_token=${emp.token}`);
    const j = await r.json();
    if(j.error) return res.status(400).json({ok:false, error:j.error.message});
    const aprobadas = (j.data||[]).filter(t=>t.status==='APPROVED').map(t=>{
      const header = t.components?.find(c=>c.type==='HEADER');
      const body = t.components?.find(c=>c.type==='BODY');
      return {
        name: t.name,
        language: t.language,
        status: t.status,
        necesitaImagen: header?.format==='IMAGE',
        necesitaVideo: header?.format==='VIDEO',
        necesitaDoc: header?.format==='DOCUMENT',
        numVariables: (body?.text?.match(/{{\d+}}/g)||[]).length
      };
    });
    res.json(aprobadas);
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

// CREAR CAMPAÑA
app.post('/api/campanas', auth, async(req,res)=>{
  try{
    const {plantilla, numeros, imagen_url, variables} = req.body;
    if(!plantilla) return res.status(400).json({ok:false, error:'Falta plantilla'});
    const limpios = [...new Set((numeros||[]).map(n=>String(n).replace(/\D/g,'')).map(d=>d.length===10?'57'+d:d))].filter(n=>/^57[3][0-9]{9}$/.test(n));
    if(!limpios.length) return res.status(400).json({ok:false, error:'Sin números válidos'});
    const id='camp_'+Date.now();
    await pool.query(`INSERT INTO campanas_klido (id,agencia_id,plantilla,total,creada,numeros,bloque_actual,estado,imagen_url,variables) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id, req.user.agenciaId, plantilla, limpios.length, Date.now(), JSON.stringify(limpios), 0, 'activa', imagen_url||null, JSON.stringify(variables||[])]);
    procesaCampana(id);
    res.json({ok:true, id, total: limpios.length});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

app.get('/api/campanas', auth, async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]);
  res.json(rows);
});

// PROCESADOR QUE NUNCA DA ERROR 132012
async function procesaCampana(id){
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return;
  const c=rows[0];
  let nums=c.numeros; if(typeof nums==='string') nums=JSON.parse(nums);
  let vars=c.variables; if(typeof vars==='string') try{vars=JSON.parse(vars)}catch{vars=[]}
  const emp=await getEmp(c.agencia_id);

  // Averigua si plantilla necesita imagen y que idioma
  let necesitaImagen=false; let lang='es_CO';
  try{
    const rT=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=200`);
    const jT=await rT.json();
    const info=(jT.data||[]).find(t=>t.name===c.plantilla);
    if(info){ necesitaImagen=info.components?.some(x=>x.type==='HEADER'&&x.format==='IMAGE'); lang=info.language||'es_CO'; }
  }catch{}

  for(let i=c.bloque_actual||0;i<nums.length;i++){
    try{
      const {rows: check} = await pool.query('SELECT estado FROM campanas_klido WHERE id=$1',[id]);
      if(check[0]?.estado==='pausada'){ await pool.query('UPDATE campanas_klido SET bloque_actual=$1 WHERE id=$2',[i,id]); return; }

      const components=[];
      if(necesitaImagen && c.imagen_url){
        components.push({type:'header', parameters:[{type:'image', image:{link:c.imagen_url}}]});
      }
      if(vars && vars.length>0){
        components.push({type:'body', parameters: vars.map(v=>({type:'text', text:String(v||'').slice(0,1024)}))});
      }

      const payload={
        messaging_product:'whatsapp',
        to: nums[i],
        type:'template',
        template:{ name:c.plantilla, language:{code:lang},...(components.length?{components}:{}) }
      };

      const result = await limiter.schedule(async()=>{
        const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{
          method:'POST',
          headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`},
          body: JSON.stringify(payload)
        });
        return r.json();
      });

      console.log(`📨 ${c.plantilla} -> ${nums[i]} ->`, result.messages? `OK ${result.messages[0].id}` : JSON.stringify(result).slice(0,300));

      if(result.messages?.[0]?.id) await pool.query('UPDATE campanas_klido SET enviados=enviados+1, bloque_actual=$1 WHERE id=$2',[i+1,id]);
      else await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1, bloque_actual=$1 WHERE id=$2',[i+1,id]);

    }catch(e){
      console.log('ERROR ENVIO',e.message);
      await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1, bloque_actual=$1 WHERE id=$2',[i+1,id]);
    }
  }
  await pool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['terminada',id]);
  console.log(`🏁 ${id} TERMINADA`);
}

// STATIC AL FINAL - IMPORTANTE PARA NO DEVOLVER HTML EN /api/*
app.use(express.static(path.join(__dirname,'public')));
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT, ()=> console.log(`🚀 KLIDO FINAL QUE SIRVE EN ${PORT}`));
