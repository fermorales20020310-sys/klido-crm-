// KLIDO v116.1 AUTO SCAN - Encuentra TOKEN aunque este sin nombre en Variables
require('dotenv').config();
const express=require('express'),cors=require('cors'),fs=require('fs'),path=require('path'),jwt=require('jsonwebtoken');
let multer,XLSX,uuidv4,fetch,Pool,nodemailer;
try{multer=require('multer')}catch{multer={memoryStorage:()=>({}),single:()=>(req,res,next)=>next()}}
try{XLSX=require('xlsx')}catch{XLSX={read:()=>({Sheets:{},SheetNames:[]}),utils:{sheet_to_json:()=>[]}}}
try{uuidv4=require('uuid').v4}catch{uuidv4=()=>Date.now().toString(36)+Math.random().toString(36).slice(2)}
try{fetch=require('node-fetch')}catch{fetch=global.fetch}
try{Pool=require('pg').Pool}catch{Pool=null}
try{nodemailer=require('nodemailer')}catch{nodemailer=null}

const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true,limit:'50mb'}));
app.use(express.static(path.join(__dirname,'public')));
const PORT=process.env.PORT||3000;
const ADMIN_KEY=process.env.ADMIN_KEY||'KLIDO_DUEÑA_2026';
const DATA_DIR_RAW=process.env.DATA_DIR||path.join(__dirname,'data');
const DATABASE_URL=process.env.DATABASE_URL||'';
const DEFAULT_AGENCY=process.env.DEFAULT_AGENCY||'avanza-consulting';
const EMAIL_USER=process.env.EMAIL_USER||'';
const EMAIL_PASS=process.env.EMAIL_PASS||'';
const JWT_SECRET=process.env.JWT_SECRET||'klido-avanza-final-2024-pro-v111';
const META_VERIFY_TOKEN=process.env.META_VERIFY_TOKEN||'klido123';
const PHONE_NUMBER_ID=process.env.PHONE_NUMBER_ID||'1338474282683914';
const WABA_ID=process.env.WABA_ID||'2317286332424288';
// AUTO SCAN TOKEN: Busca en TODAS las variables alguna que empiece por EAAT aunque no tenga nombre correcto
let META_TOKEN=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||process.env.WHATSAPP_ACCESS_TOKEN||'';
if(!META_TOKEN){
  for(const [k,v] of Object.entries(process.env)){
    if(typeof v==='string' && v.startsWith('EAAT') && v.length>50){ META_TOKEN=v; console.log(`[AUTO TOKEN ENCONTRADO en variable ${k}]`); break; }
    if(typeof k==='string' && k.startsWith('EAAT') && k.length>50){ META_TOKEN=k; console.log(`[AUTO TOKEN ENCONTRADO como NOMBRE de variable]`); break; }
  }
}
const RAILWAY_VOLUME_MOUNT_PATH=process.env.RAILWAY_VOLUME_MOUNT_PATH||'';
const RESEND_API_KEY=process.env.RESEND_API_KEY||'';
const RESEND_FROM=process.env.RESEND_FROM||EMAIL_USER;
const GERENCIA_EMAIL='admin@klido.com'; const GERENCIA_PASS='Mafe2002@';

let BASE_DATA=DATA_DIR_RAW.replace(/\/app\/data\/data/g,'/data').replace(/\/data\/data/g,'/data').replace(/\/+/g,'/').replace(/\/$/,'');
if(RAILWAY_VOLUME_MOUNT_PATH) BASE_DATA='/data';
if(['','/app','/app/data'].includes(BASE_DATA)) BASE_DATA='/data';
try{if(!fs.existsSync(BASE_DATA)) fs.mkdirSync(BASE_DATA,{recursive:true})}catch{BASE_DATA=path.join(__dirname,'data'); if(!fs.existsSync(BASE_DATA)) fs.mkdirSync(BASE_DATA,{recursive:true})}
const AGENCIAS_DIR=path.join(BASE_DATA,'agencias');
try{if(!fs.existsSync(AGENCIAS_DIR)) fs.mkdirSync(AGENCIAS_DIR,{recursive:true})}catch{}
console.log(`[KLIDO v116.1 AUTO] PHONE=${PHONE_NUMBER_ID} WABA=${WABA_ID} TOKEN=${META_TOKEN?META_TOKEN.slice(0,20)+'...OK':'FALTA'}`);

app.get('/health',(req,res)=>res.json({ok:true,status:'KLIDO v116.1 AUTO SCAN',PHONE_NUMBER_ID,WABA_ID,TOKEN:META_TOKEN?'OK':'FALTA',PG:DATABASE_URL?'SI':'FS'}));
app.get('/api/health',(req,res)=>res.json({ok:true,waba:WABA_ID,phone:PHONE_NUMBER_ID,token:META_TOKEN?'OK':'FALTA',auto:true}));
app.listen(PORT,'0.0.0.0',()=>console.log(`[KLIDO v116.1 LISTO] Puerto ${PORT}`));

app.get('/crm.html',(req,res)=>res.sendFile(path.join(__dirname,'public','crm.html')));
app.get('/campana.html',(req,res)=>res.sendFile(path.join(__dirname,'public','campana.html')));
app.get(['/campanas.html','/campaña.html','/campañas.html'],(req,res)=>res.sendFile(path.join(__dirname,'public','campana.html')));

let pgPool=null;
if(DATABASE_URL && Pool){
  try{
    pgPool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});
    pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY,nombre TEXT,email TEXT UNIQUE,password TEXT,plan TEXT,token TEXT,phone_id TEXT,waba_id TEXT,meta_token TEXT,equipo JSONB DEFAULT '[]'::jsonb,creado BIGINT,mantenimiento BIGINT,default_agency TEXT); CREATE TABLE IF NOT EXISTS mensajes (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,texto TEXT,timestamp BIGINT,tipo TEXT,leido BOOLEAN,etiqueta TEXT,phone_id TEXT,nombre TEXT,campana_id TEXT,asignado_a TEXT,media_url TEXT,media_tipo TEXT); CREATE TABLE IF NOT EXISTS contactos (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,nombre TEXT,telefono TEXT,creado BIGINT,seguimiento JSONB,etiquetas JSONB,online BIGINT); CREATE TABLE IF NOT EXISTS campanas (id TEXT PRIMARY KEY,agencia_id TEXT,nombre TEXT,plantilla TEXT,telefonos JSONB,total INT,enviados INT,estado TEXT,creada BIGINT,historial JSONB,phone_usado TEXT,fallidos INT DEFAULT 0); CREATE TABLE IF NOT EXISTS calendario (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,fecha TEXT,nota TEXT,estado TEXT,creado BIGINT,asignado_a TEXT); CREATE TABLE IF NOT EXISTS plantillas (id TEXT PRIMARY KEY,agencia_id TEXT,data JSONB); CREATE TABLE IF NOT EXISTS gmail_camp (id TEXT PRIMARY KEY,agencia_id TEXT,asunto TEXT,total INT,enviados INT,creado BIGINT,historial JSONB);`).then(async()=>{
      await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS plan_precio TEXT; ALTER TABLE agencias ADD COLUMN IF NOT EXISTS plan_trimestral TEXT; ALTER TABLE agencias ADD COLUMN IF NOT EXISTS api_status TEXT DEFAULT 'pendiente'; ALTER TABLE campanas ADD COLUMN IF NOT EXISTS fallidos INT DEFAULT 0;`);
      await pgPool.query(`UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3,api_status='conectado'`,[PHONE_NUMBER_ID,WABA_ID,META_TOKEN]);
      console.log('[PG] AUTO MIGRACION OK');
    }).catch(e=>console.log(e.message))
  }catch(e){}
}
const codigosRegistro=new Map(),colasCampanas=new Map();
function agenciaPath(id){ const p=path.join(AGENCIAS_DIR,id); if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); ['mensajes.json','contactos.json','campanas.json','calendario.json','plantillas.json','gmail.json'].forEach(f=>{const fp=path.join(p,f); if(!fs.existsSync(fp)) fs.writeFileSync(fp,'[]')}); return p; }
function readJSON(fp,def=[]){try{if(!fs.existsSync(fp)) return def; return JSON.parse(fs.readFileSync(fp,'utf8')||'[]')}catch{return def}}
function writeJSON(fp,d){fs.writeFileSync(fp,JSON.stringify(d,null,2))}
function normalizarTel(raw){if(!raw) return null; let dig=String(raw).replace(/\D/g,''); if(dig.length<7) return null; if(dig.length===10) return '+57'+dig; if(dig.length===11&&dig.startsWith('57')) return '+'+dig; if(dig.length===12) return '+'+dig; return '+57'+dig.slice(-10)}
function extraerTels(rows){const s=new Set(); rows.forEach(r=>{Object.values(r).forEach(v=>{if(!v) return; String(v).split(/[,;\n\s]+/).forEach(part=>{const n=normalizarTel(part); if(n) s.add(n)})})}); return [...s].filter(t=>t.length>=12)}
async function sendEmail(to,subj,html){ return true; }
async function obtenerEmpresas(){
  if(pgPool){
    const {rows}=await pgPool.query('SELECT * FROM agencias');
    return rows.map(r=>({id:r.id,nombre:r.nombre,email:r.email,password:r.password,plan:r.plan,token:r.token,phoneId:r.phone_id||PHONE_NUMBER_ID,wabaId:r.waba_id||WABA_ID,metaToken:r.meta_token||META_TOKEN,equipo:r.equipo||[],creado:r.creado,mantenimiento:r.mantenimiento,defaultAgency:r.default_agency,planPrecio:r.plan_precio,planTrimestral:r.plan_trimestral,apiStatus:'conectado'}));
  } else {
    const fp=path.join(BASE_DATA,'empresas.json'); if(!fs.existsSync(fp)) fs.writeFileSync(fp,'[]'); let data=readJSON(fp);
    if(data.length===0){ const id=uuidv4(); const token=jwt.sign({agenciaId:id,email:'fermorales20020310@gmail.com',rol:'jefe',nombre:'Avanza Consulting',plan:'gold'},JWT_SECRET,{expiresIn:'30d'}); const def={id,nombre:'Avanza Consulting',email:'fermorales20020310@gmail.com',password:'Mafe2002@',plan:'gold',token,phoneId:PHONE_NUMBER_ID,wabaId:WABA_ID,metaToken:META_TOKEN,equipo:[],creado:Date.now(),mantenimiento:Date.now()+90*24*3600*1000,defaultAgency:DEFAULT_AGENCY,apiStatus:'conectado'}; writeJSON(fp,[def]); agenciaPath(id); return [def]; }
    data=data.map(e=>({...e,phoneId:PHONE_NUMBER_ID,wabaId:WABA_ID,metaToken:META_TOKEN,apiStatus:'conectado'})); writeJSON(fp,data); return data;
  }
}
async function guardarEmpresa(emp){ emp.phoneId=PHONE_NUMBER_ID; emp.wabaId=WABA_ID; emp.metaToken=META_TOKEN; emp.apiStatus='conectado'; if(pgPool){ try{ await pgPool.query(`INSERT INTO agencias (id,nombre,email,password,plan,token,phone_id,waba_id,meta_token,equipo,creado,mantenimiento,default_agency,api_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO UPDATE SET phone_id=$7,waba_id=$8,meta_token=$9,equipo=$10,api_status=$14`,[emp.id,emp.nombre,emp.email,emp.password,emp.plan,emp.token,emp.phoneId,emp.wabaId,emp.metaToken,JSON.stringify(emp.equipo||[]),emp.creado,emp.mantenimiento,DEFAULT_AGENCY,'conectado']); }catch(e){console.log(e.message)}} else { const fp=path.join(BASE_DATA,'empresas.json'); const all=readJSON(fp); const idx=all.findIndex(x=>x.id===emp.id); if(idx>=0) all[idx]=emp; else all.push(emp); writeJSON(fp,all); } }
function auth(req,res,next){ const h=req.headers.authorization||''; const token=h.replace('Bearer ','').trim()||req.query.token; if(!token) return res.status(401).json({error:'Token requerido'}); try{ const pay=jwt.verify(token,JWT_SECRET); req.agenciaId=pay.agenciaId; req.user=pay; return next(); }catch{return res.status(401).json({error:'Token inválido'})} }
function authGerencia(req,res,next){ const k=req.headers['x-admin-key']||req.query.admin_key; if(k===ADMIN_KEY){req.user={rol:'gerencia'}; return next();} try{const h=req.headers.authorization||''; const t=h.replace('Bearer ','').trim(); const p=jwt.verify(t,JWT_SECRET); if(p.rol==='gerencia'){req.user=p; return next();}}catch{} return res.status(403).json({error:'Gerencia solo'})}
app.get('/webhook',(req,res)=>{ const mode=req.query['hub.mode'],token=req.query['hub.verify_token'],ch=req.query['hub.challenge']; if(mode==='subscribe'&&token===META_VERIFY_TOKEN){ return res.status(200).send(ch); } return res.sendStatus(403); });
app.post('/webhook',async(req,res)=>{ res.sendStatus(200); });
app.post('/api/public/solicitar-codigo',async(req,res)=>{ const email=(req.body.email||'').toLowerCase().trim(); const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosRegistro.set(email,{codigo,expira:Date.now()+600000,nombre:req.body.nombre||'Cliente',plan:req.body.plan||'basico'}); res.json({ok:true,codigo}); });
app.post('/api/public/crear-empresa',async(req,res)=>{ const {nombre,email,password,codigo,plan}=req.body; const em=(email||'').toLowerCase().trim(); const reg=codigosRegistro.get(em); if(!reg || reg.codigo!==codigo) return res.status(400).json({error:'Código inválido'}); const empresas=await obtenerEmpresas(); if(empresas.find(e=>e.email===em)) return res.status(400).json({error:'Email ya registrado'}); const id=uuidv4(); const tokenJwt=jwt.sign({agenciaId:id,email:em,rol:'jefe',nombre,plan:plan||'basico'},JWT_SECRET,{expiresIn:'30d'}); const nueva={id,nombre,email:em,password,plan:plan||'basico',token:tokenJwt,phoneId:PHONE_NUMBER_ID,wabaId:WABA_ID,metaToken:META_TOKEN,equipo:[],creado:Date.now(),mantenimiento:Date.now()+90*24*3600*1000,defaultAgency:DEFAULT_AGENCY,apiStatus:'conectado'}; await guardarEmpresa(nueva); if(!pgPool) agenciaPath(id); codigosRegistro.delete(em); res.json({ok:true,id,token:tokenJwt}); });
app.post('/api/login',async(req,res)=>{ const email=(req.body.email||'').toLowerCase().trim(); const pass=String(req.body.password||'').trim(); const empresas=await obtenerEmpresas(); for(const emp of empresas){ if(emp.email.toLowerCase()===email && String(emp.password).trim()===pass){ const token=jwt.sign({agenciaId:emp.id,email,rol:'jefe',nombre:emp.nombre,plan:emp.plan},JWT_SECRET,{expiresIn:'30d'}); emp.token=token; await guardarEmpresa(emp); return res.json({token,rol:'jefe',agenciaId:emp.id,plan:emp.plan,nombre:emp.nombre}); } } return res.status(401).json({error:'Credenciales inválidas'}); });
const upload=multer({storage:multer.memoryStorage()});
app.get('/api/config',auth,async(req,res)=>{ const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.user.agenciaId); res.json({PHONE_NUMBER_ID,WABA_ID,TOKEN:META_TOKEN?'OK':'FALTA',phoneId:emp?.phoneId||PHONE_NUMBER_ID,wabaId:emp?.wabaId||WABA_ID,metaToken:emp?.metaToken?'OK':'FALTA',auto:true,agencia:emp?.nombre}); });
app.get('/api/plantillas',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId; let plantillas=[];
  try{ if(pgPool){ const {rows}=await pgPool.query('SELECT data FROM plantillas WHERE agencia_id=$1',[agenciaId]); if(rows[0]){ let d=rows[0].data; plantillas=typeof d==='string'?JSON.parse(d):d; }} }catch{}
  if(WABA_ID && META_TOKEN){
    try{ const r=await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?access_token=${META_TOKEN}&limit=100`); const j=await r.json(); console.log('[PLANTILLAS AUTO]',j.data?.length||0,j.error||'OK'); if(j.data && j.data.length>0){ const aprobadas=j.data.filter(t=>t.status==='APPROVED'); plantillas=aprobadas.length>0?aprobadas:j.data; if(pgPool) await pgPool.query('INSERT INTO plantillas (id,agencia_id,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3',[agenciaId,agenciaId,JSON.stringify(plantillas)]); } }catch(e){ console.log(e.message); }
  }
  if(!plantillas.length) plantillas=[{name:'auto',status:'AUTO'}]; res.json(plantillas);
});
app.get('/api/plantillas/sync',auth,async(req,res)=>{
  if(!WABA_ID||!META_TOKEN) return res.status(400).json({error:'Falta WABA o TOKEN - Verifica Variables Railway'});
  try{ const r=await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?access_token=${META_TOKEN}&limit=100`); const j=await r.json(); if(j.error) return res.status(400).json({error:j.error}); const aprobadas=(j.data||[]).filter(t=>t.status==='APPROVED'); const guardar=aprobadas.length>0?aprobadas:j.data||[]; if(pgPool) await pgPool.query('INSERT INTO plantillas (id,agencia_id,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3',[req.user.agenciaId,req.user.agenciaId,JSON.stringify(guardar)]); res.json({ok:true,waba:WABA_ID,total:j.data?.length||0,aprobadas:aprobadas.length,plantillas:guardar}); }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/campanas/subir-excel',auth,upload.single('excel'),async(req,res)=>{ let rows=[]; if(req.file){ const wb=XLSX.read(req.file.buffer); const ws=wb.Sheets[wb.SheetNames[0]]; rows=XLSX.utils.sheet_to_json(ws,{defval:''}); } const telefonos=extraerTels(rows); if(!telefonos.length) return res.status(400).json({error:'No números'}); const agenciaId=req.user.agenciaId; const camp={id:uuidv4(),agencia_id:agenciaId,nombre:req.body.nombre||`Campaña ${new Date().toLocaleDateString()}`,plantilla:req.body.plantilla||'auto',telefonos,total:telefonos.length,enviados:0,estado:'pendiente',creada:Date.now(),historial:[],phone_usado:PHONE_NUMBER_ID,fallidos:0}; if(pgPool) await pgPool.query('INSERT INTO campanas (id,agencia_id,nombre,plantilla,telefonos,total,enviados,estado,creada,historial,phone_usado,fallidos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[camp.id,camp.agencia_id,camp.nombre,camp.plantilla,JSON.stringify(camp.telefonos),camp.total,0,'pendiente',camp.creada,JSON.stringify([]),camp.phone_usado,0]); colasCampanas.set(agenciaId+camp.id,{lista:telefonos,idx:0,pausada:false}); res.json({ok:true,campana:camp,segmentados:telefonos.length,telefonos}); });
app.get('/api/campanas',auth,async(req,res)=>{ if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM campanas WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); return res.json(rows.map(r=>({...r,telefonos: typeof r.telefonos==='string'? JSON.parse(r.telefonos): r.telefonos}))); } res.json([]); });
app.post('/api/campanas/enviar',auth,async(req,res)=>{ const {campanaId}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId); const lista=(await (async()=>{ if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM campanas WHERE id=$1',[campanaId]); return typeof rows[0].telefonos==='string'?JSON.parse(rows[0].telefonos):rows[0].telefonos; } return []; })()); colasCampanas.set(agenciaId+campanaId,{lista,idx:0,pausada:false}); if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2',['enviando',campanaId]); (async()=>{ let cola=colasCampanas.get(agenciaId+campanaId); let enviados=0,fallidos=0; for(let i=0;i<cola.lista.length;i++){ cola=colasCampanas.get(agenciaId+campanaId); if(!cola||cola.pausada) break; const to=cola.lista[i].replace('+',''); try{ const payload={messaging_product:'whatsapp',to,type:'template',template:{name:'hello_world',language:{code:'en_US'}}}; const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}); if(r.ok) enviados++; else fallidos++; if(pgPool) await pgPool.query('UPDATE campanas SET enviados=$1,fallidos=$2 WHERE id=$3',[enviados,fallidos,campanaId]); }catch{fallidos++;} if((i+1)%25===0) await new Promise(r=>setTimeout(r,45000)); else await new Promise(r=>setTimeout(r,1800)); cola.idx=i+1; } if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2',['completada',campanaId]); })(); res.json({ok:true,mensaje:`Envío iniciado ${lista.length} números - ${PHONE_NUMBER_ID} - AUTO`}); });
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
