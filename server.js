// KLIDO CRM v116.0 AUTO TOTAL - Lee WABA_ID, PHONE_NUMBER_ID, TOKEN automatico de Variables Railway
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
// AUTO LECTURA DE TUS VARIABLES DE LA FOTO
const PHONE_NUMBER_ID=process.env.PHONE_NUMBER_ID||'1338474282683914';
const WABA_ID=process.env.WABA_ID||'2317286332424288';
const META_TOKEN=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||process.env.WHATSAPP_ACCESS_TOKEN||process.env.EAAT1049iTDMB||process.env.TOKEN||'';
const RAILWAY_VOLUME_MOUNT_PATH=process.env.RAILWAY_VOLUME_MOUNT_PATH||'';
const RESEND_API_KEY=process.env.RESEND_API_KEY||process.env.RESEND_APT_KEY||'';
const RESEND_FROM=process.env.RESEND_FROM||EMAIL_USER||'KLIDO <onboarding@resend.dev>';
const GERENCIA_EMAIL='admin@klido.com';
const GERENCIA_PASS='Mafe2002@';
const SOPORTE_WPP='573133181851';

let BASE_DATA=DATA_DIR_RAW.replace(/\/app\/data\/data/g,'/data').replace(/\/data\/data/g,'/data').replace(/\/+/g,'/').replace(/\/$/,'');
if(RAILWAY_VOLUME_MOUNT_PATH) BASE_DATA='/data';
if(['','/app','/app/data'].includes(BASE_DATA)) BASE_DATA='/data';
try{if(!fs.existsSync(BASE_DATA)) fs.mkdirSync(BASE_DATA,{recursive:true})}catch{BASE_DATA=path.join(__dirname,'data'); if(!fs.existsSync(BASE_DATA)) fs.mkdirSync(BASE_DATA,{recursive:true})}
const AGENCIAS_DIR=path.join(BASE_DATA,'agencias');
try{if(!fs.existsSync(AGENCIAS_DIR)) fs.mkdirSync(AGENCIAS_DIR,{recursive:true})}catch{}
console.log(`[KLIDO v116.0 AUTO] PHONE=${PHONE_NUMBER_ID} WABA=${WABA_ID} TOKEN=${META_TOKEN?META_TOKEN.slice(0,15)+'...OK':'FALTA - Agrega WHATSAPP_TOKEN en Variables'}`);

app.get('/health',(req,res)=>res.json({ok:true,status:'KLIDO v116.0 AUTO TOTAL',META_VERIFY_TOKEN,PHONE_NUMBER_ID,WABA_ID,TOKEN:META_TOKEN?'OK':'FALTA',ADMIN_KEY,DATA_DIR:BASE_DATA,PG:DATABASE_URL?'SI':'FS'}));
app.get('/api/health',(req,res)=>res.json({ok:true,waba:WABA_ID,phone:PHONE_NUMBER_ID,token:META_TOKEN?'OK':'FALTA'}));
app.listen(PORT,'0.0.0.0',()=>console.log(`[KLIDO v116.0 AUTO OK] Puerto ${PORT}`));

app.get('/crm.html',(req,res)=>res.sendFile(path.join(__dirname,'public','crm.html')));
app.get('/campana.html',(req,res)=>res.sendFile(path.join(__dirname,'public','campana.html')));
app.get(['/campanas.html','/campaña.html','/campañas.html'],(req,res)=>res.sendFile(path.join(__dirname,'public','campana.html')));

let pgPool=null;
if(DATABASE_URL && Pool){
  try{
    pgPool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});
    pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY,nombre TEXT,email TEXT UNIQUE,password TEXT,plan TEXT,token TEXT,phone_id TEXT,waba_id TEXT,meta_token TEXT,equipo JSONB DEFAULT '[]'::jsonb,creado BIGINT,mantenimiento BIGINT,default_agency TEXT); CREATE TABLE IF NOT EXISTS mensajes (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,texto TEXT,timestamp BIGINT,tipo TEXT,leido BOOLEAN,etiqueta TEXT,phone_id TEXT,nombre TEXT,campana_id TEXT,asignado_a TEXT,media_url TEXT,media_tipo TEXT); CREATE TABLE IF NOT EXISTS contactos (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,nombre TEXT,telefono TEXT,creado BIGINT,seguimiento JSONB,etiquetas JSONB,online BIGINT); CREATE TABLE IF NOT EXISTS campanas (id TEXT PRIMARY KEY,agencia_id TEXT,nombre TEXT,plantilla TEXT,telefonos JSONB,total INT,enviados INT,estado TEXT,creada BIGINT,historial JSONB,phone_usado TEXT,fallidos INT DEFAULT 0); CREATE TABLE IF NOT EXISTS calendario (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,fecha TEXT,nota TEXT,estado TEXT,creado BIGINT,asignado_a TEXT); CREATE TABLE IF NOT EXISTS plantillas (id TEXT PRIMARY KEY,agencia_id TEXT,data JSONB); CREATE TABLE IF NOT EXISTS gmail_camp (id TEXT PRIMARY KEY,agencia_id TEXT,asunto TEXT,total INT,enviados INT,creado BIGINT,historial JSONB);`).then(async()=>{
      try{
        await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS plan_precio TEXT; ALTER TABLE agencias ADD COLUMN IF NOT EXISTS plan_trimestral TEXT; ALTER TABLE agencias ADD COLUMN IF NOT EXISTS api_status TEXT DEFAULT 'pendiente'; ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS media_url TEXT; ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS media_tipo TEXT; ALTER TABLE contactos ADD COLUMN IF NOT EXISTS online BIGINT; ALTER TABLE campanas ADD COLUMN IF NOT EXISTS fallidos INT DEFAULT 0;`);
        // AUTO MIGRACION: Si ya existen agencias sin WABA/TOKEN, actualizarlas automatico con ENV
        await pgPool.query(`UPDATE agencias SET phone_id=$1, waba_id=$2, meta_token=$3, api_status='conectado' WHERE (phone_id IS NULL OR waba_id IS NULL OR meta_token IS NULL)`,[PHONE_NUMBER_ID,WABA_ID,META_TOKEN]);
        console.log('[PG] MIGRACION v116.0 AUTO OK - Agencias actualizadas con ENV');
      }catch(e){ console.log('[MIGRACION ERR]',e.message); }
    }).catch(e=>console.log(e.message))
  }catch(e){ console.log('[PG INIT FAIL]',e.message); }
}

const codigosRegistro=new Map(),colasCampanas=new Map();
function agenciaPath(id){ const p=path.join(AGENCIAS_DIR,id); if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); ['mensajes.json','contactos.json','campanas.json','calendario.json','plantillas.json','gmail.json'].forEach(f=>{const fp=path.join(p,f); if(!fs.existsSync(fp)) fs.writeFileSync(fp,'[]')}); return p; }
function readJSON(fp,def=[]){try{if(!fs.existsSync(fp)) return def; return JSON.parse(fs.readFileSync(fp,'utf8')||'[]')}catch{return def}}
function writeJSON(fp,d){fs.writeFileSync(fp,JSON.stringify(d,null,2))}
function normalizarTel(raw){if(!raw) return null; let dig=String(raw).replace(/\D/g,''); if(dig.length<7) return null; if(dig.length===10) return '+57'+dig; if(dig.length===11&&dig.startsWith('57')) return '+'+dig; if(dig.length===12) return '+'+dig; return '+57'+dig.slice(-10)}
function extraerTels(rows){const s=new Set(); rows.forEach(r=>{Object.values(r).forEach(v=>{if(!v) return; String(v).split(/[,;\n\s]+/).forEach(part=>{const n=normalizarTel(part); if(n) s.add(n); const m=String(part).match(/(\+?\d[\d\s\-()]{7,}\d)/g); if(m) m.forEach(x=>{const nn=normalizarTel(x); if(nn) s.add(nn)})})})}); return [...s].filter(t=>t.length>=12)}
async function sendEmail(to,subj,html){ if(RESEND_API_KEY){ try{ const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:RESEND_FROM,to:[to],subject:subj,html})}); const j=await r.json(); return true;}catch{}} return true;}

async function obtenerEmpresas(){
  if(pgPool){
    const {rows}=await pgPool.query('SELECT * FROM agencias');
    let emps=rows.map(r=>({id:r.id,nombre:r.nombre,email:r.email,password:r.password,plan:r.plan,token:r.token,phoneId:r.phone_id||PHONE_NUMBER_ID,wabaId:r.waba_id||WABA_ID,metaToken:r.meta_token||META_TOKEN,equipo:r.equipo||[],creado:r.creado,mantenimiento:r.mantenimiento,defaultAgency:r.default_agency,planPrecio:r.plan_precio,planTrimestral:r.plan_trimestral,apiStatus:r.api_status||'conectado'}));
    // AUTO FIX: Si alguna no tiene token, actualizarla
    for(const e of emps){ if(!e.metaToken ||!e.wabaId){ try{ await pgPool.query(`UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3,api_status='conectado' WHERE id=$4`,[PHONE_NUMBER_ID,WABA_ID,META_TOKEN,e.id]); }catch{} e.phoneId=PHONE_NUMBER_ID; e.wabaId=WABA_ID; e.metaToken=META_TOKEN; } }
    return emps;
  } else {
    const fp=path.join(BASE_DATA,'empresas.json');
    if(!fs.existsSync(fp)) fs.writeFileSync(fp,'[]');
    let data=readJSON(fp);
    if(data.length===0){
      const id=uuidv4(); const token=jwt.sign({agenciaId:id,email:'fermorales20020310@gmail.com',rol:'jefe',nombre:'Avanza Consulting',plan:'gold'},JWT_SECRET,{expiresIn:'30d'});
      const def={id,nombre:'Avanza Consulting',email:'fermorales20020310@gmail.com',password:'Mafe2002@',plan:'gold',token,phoneId:PHONE_NUMBER_ID,wabaId:WABA_ID,metaToken:META_TOKEN,equipo:[],creado:Date.now(),mantenimiento:Date.now()+90*24*3600*1000,defaultAgency:DEFAULT_AGENCY,planPrecio:'$2.400.000 anual',planTrimestral:'$120.000 trim + IA + Llamadas + Gmail',apiStatus:'conectado'};
      writeJSON(fp,[def]); agenciaPath(id); return [def];
    }
    data=data.map(e=>({...e,phoneId:e.phoneId||PHONE_NUMBER_ID,wabaId:e.wabaId||WABA_ID,metaToken:e.metaToken||META_TOKEN,apiStatus:'conectado'}));
    writeJSON(fp,data);
    return data;
  }
}
async function guardarEmpresa(emp){
  const precios={basico:{precio:'$800.000 anual',trim:'$80.000 trim'},premium:{precio:'$1.300.000 anual',trim:'$95.000 trim'},gold:{precio:'$2.400.000 anual',trim:'$120.000 trim + IA + Llamadas + Gmail'}};
  const p=precios[emp.plan]||precios.gold;
  emp.phoneId=emp.phoneId||PHONE_NUMBER_ID; emp.wabaId=emp.wabaId||WABA_ID; emp.metaToken=emp.metaToken||META_TOKEN; emp.apiStatus='conectado';
  if(pgPool){
    try{ await pgPool.query(`INSERT INTO agencias (id,nombre,email,password,plan,token,phone_id,waba_id,meta_token,equipo,creado,mantenimiento,default_agency,plan_precio,plan_trimestral,api_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO UPDATE SET nombre=$2,email=$3,password=$4,plan=$5,token=$6,phone_id=$7,waba_id=$8,meta_token=$9,equipo=$10,mantenimiento=$12,default_agency=$13,plan_precio=$14,plan_trimestral=$15,api_status=$16`,[emp.id,emp.nombre,emp.email,emp.password,emp.plan,emp.token,emp.phoneId,emp.wabaId,emp.metaToken,JSON.stringify(emp.equipo||[]),emp.creado,emp.mantenimiento,DEFAULT_AGENCY,p.precio,p.trim,'conectado']); }catch(e){ console.log('[GUARDAR ERR]',e.message); }
  } else {
    emp.planPrecio=p.precio; emp.planTrimestral=p.trim;
    const fp=path.join(BASE_DATA,'empresas.json'); const all=readJSON(fp); const idx=all.findIndex(e=>e.id===emp.id); if(idx>=0) all[idx]=emp; else all.push(emp); writeJSON(fp,all);
  }
}
function auth(req,res,next){ const h=req.headers.authorization||''; const token=h.replace('Bearer ','').trim()||req.query.token; if(!token) return res.status(401).json({error:'Token requerido'}); try{ const pay=jwt.verify(token,JWT_SECRET); req.agenciaId=pay.agenciaId; req.user=pay; return next(); }catch{return res.status(401).json({error:'Token inválido'})} }
function authGerencia(req,res,next){ const k=req.headers['x-admin-key']||req.query.admin_key; if(k===ADMIN_KEY){req.user={rol:'gerencia'}; return next();} try{const h=req.headers.authorization||''; const t=h.replace('Bearer ','').trim(); const p=jwt.verify(t,JWT_SECRET); if(p.rol==='gerencia'){req.user=p; return next();}}catch{} return res.status(403).json({error:'Gerencia solo'})}
app.get('/webhook',(req,res)=>{ const mode=req.query['hub.mode'],token=req.query['hub.verify_token'],ch=req.query['hub.challenge']; if(mode==='subscribe'&&token===META_VERIFY_TOKEN){ return res.status(200).send(ch); } return res.sendStatus(403); });
app.post('/webhook',async(req,res)=>{
  try{
    const body=req.body; if(body.object!=='whatsapp_business_account') return res.sendStatus(200);
    const empresas=await obtenerEmpresas();
    for(const entry of body.entry||[]){
      for(const change of entry.changes||[]){
        const value=change.value; const phoneId=value.metadata?.phone_number_id||PHONE_NUMBER_ID; const msgs=value.messages||[]; const contacts=value.contacts||[];
        for(const msg of msgs){
          const agencia=empresas.find(e=>e.phoneId===phoneId||e.phoneId===PHONE_NUMBER_ID)||empresas[0]; if(!agencia) continue;
          let texto=msg.text?.body||''; let mediaUrl=null,mediaTipo=null;
          if(msg.image){ texto=`[Foto] ${msg.image.caption||''}`; mediaUrl=msg.image.id; mediaTipo='image'; }
          if(msg.audio){ texto=`[Audio]`; mediaUrl=msg.audio.id; mediaTipo='audio'; }
          if(msg.document){ texto=`[Archivo]`; mediaUrl=msg.document.id; mediaTipo='document'; }
          if(msg.video){ texto=`[Video]`; mediaUrl=msg.video.id; mediaTipo='video'; }
          const waId=msg.from; const nombre=contacts.find(c=>c.wa_id===waId)?.profile?.name||waId;
          const nuevo={id:msg.id,agencia_id:agencia.id,wa_id:waId,texto,timestamp:Date.now(),tipo:'entrante',leido:false,etiqueta:null,phone_id:phoneId,nombre,campana_id:null,asignado_a:null,media_url:mediaUrl,media_tipo:mediaTipo};
          if(pgPool){
            const {rows}=await pgPool.query('SELECT * FROM campanas WHERE agencia_id=$1',[agencia.id]);
            for(const camp of rows){ const tels=camp.telefonos||[]; const arr=typeof tels==='string'?JSON.parse(tels):tels; if(arr.some(t=>waId.includes(t.slice(-10)))){nuevo.etiqueta='amarilla'; nuevo.campana_id=camp.id;}}
            await pgPool.query('INSERT INTO mensajes (id,agencia_id,wa_id,texto,timestamp,tipo,leido,etiqueta,phone_id,nombre,campana_id,asignado_a,media_url,media_tipo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING',[nuevo.id,nuevo.agencia_id,nuevo.wa_id,nuevo.texto,nuevo.timestamp,nuevo.tipo,nuevo.leido,nuevo.etiqueta,nuevo.phone_id,nuevo.nombre,nuevo.campana_id,nuevo.asignado_a,nuevo.media_url,nuevo.media_tipo]);
            await pgPool.query(`INSERT INTO contactos (id,agencia_id,wa_id,nombre,telefono,creado,online) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET online=$7, nombre=$4`,[waId,agencia.id,waId,nombre,waId,Date.now(),Date.now()]);
          } else {
            const ap=agenciaPath(agencia.id); const mensajes=readJSON(path.join(ap,'mensajes.json')); const campanas=readJSON(path.join(ap,'campanas.json'));
            for(const camp of campanas){ if((camp.telefonos||[]).some(t=>waId.includes(t.slice(-10)))){nuevo.etiqueta='amarilla'; nuevo.campana_id=camp.id;}}
            mensajes.push({id:nuevo.id,waId,texto:nuevo.texto,timestamp:nuevo.timestamp,tipo:'entrante',leido:false,etiqueta:nuevo.etiqueta,phoneId,nombre,campanaId:nuevo.campana_id,mediaUrl,mediaTipo});
            writeJSON(path.join(ap,'mensajes.json'),mensajes);
            const contactos=readJSON(path.join(ap,'contactos.json')); let c=contactos.find(x=>x.waId===waId); if(!c){ contactos.push({id:waId,waId,nombre,telefono:waId,creado:Date.now(),online:Date.now()}); } else { c.online=Date.now(); c.nombre=nombre; } writeJSON(path.join(ap,'contactos.json'),contactos);
          }
        }
      }
    }
    res.sendStatus(200);
  }catch(e){ res.sendStatus(200); }
});
app.post('/api/public/solicitar-codigo',async(req,res)=>{ const email=(req.body.email||'').toLowerCase().trim(); const nombre=req.body.nombre||'Cliente'; const plan=req.body.plan||'basico'; if(!email) return res.status(400).json({error:'Email requerido'}); const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosRegistro.set(email,{codigo,expira:Date.now()+600000,nombre,plan}); await sendEmail(email,`KLIDO Código ${codigo}`,`<h1>${codigo}</h1><p>Plan ${plan}</p>`); res.json({ok:true}); });
app.post('/api/public/crear-empresa',async(req,res)=>{ const {nombre,email,password,codigo,plan,terminos}=req.body; const em=(email||'').toLowerCase().trim(); if(!nombre||!em||!password||!codigo) return res.status(400).json({error:'Faltan datos'}); const reg=codigosRegistro.get(em); if(!reg || reg.codigo!==codigo || Date.now()>reg.expira) return res.status(400).json({error:'Código inválido'}); const empresas=await obtenerEmpresas(); if(empresas.find(e=>e.email===em)) return res.status(400).json({error:'Email ya registrado'}); const id=uuidv4(); const tokenJwt=jwt.sign({agenciaId:id,email:em,rol:'jefe',nombre,plan:plan||reg.plan||'basico'},JWT_SECRET,{expiresIn:'30d'}); const nueva={id,nombre,email:em,password,plan:plan||reg.plan||'basico',token:tokenJwt,phoneId:PHONE_NUMBER_ID,wabaId:WABA_ID,metaToken:META_TOKEN,equipo:[],creado:Date.now(),mantenimiento:Date.now()+90*24*3600*1000,defaultAgency:DEFAULT_AGENCY,apiStatus:'conectado'}; await guardarEmpresa(nueva); if(!pgPool) agenciaPath(id); codigosRegistro.delete(em); res.json({ok:true,id,token:tokenJwt}); });
app.post('/api/public/recuperar-codigo',async(req,res)=>{ const email=(req.body.email||'').toLowerCase().trim(); const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.email===email); if(!emp) return res.status(404).json({error:'Email no registrado'}); const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosRegistro.set(email,{codigo,expira:Date.now()+600000}); await sendEmail(email,`Recuperación ${codigo}`,`<h1>${codigo}</h1>`); res.json({ok:true}); });
app.post('/api/public/restablecer',async(req,res)=>{ const email=(req.body.email||'').toLowerCase().trim(); const codigo=(req.body.codigo||'').trim(); const nueva=req.body.nueva||''; const reg=codigosRegistro.get(email); if(!reg || reg.codigo!==codigo || Date.now()>reg.expira) return res.status(400).json({error:'Código inválido'}); const empresas=await obtenerEmpresas(); for(const e of empresas){ if(e.email===email){ e.password=nueva; await guardarEmpresa(e); } } codigosRegistro.delete(email); res.json({ok:true}); });
app.post('/api/login',async(req,res)=>{ try{ const email=(req.body.email||'').toLowerCase().trim(); const pass=String(req.body.password||'').trim(); if((email===GERENCIA_EMAIL && pass===GERENCIA_PASS)){ const token=jwt.sign({rol:'gerencia',email:GERENCIA_EMAIL,agenciaId:'gerencia'},JWT_SECRET,{expiresIn:'12h'}); return res.json({token,rol:'gerencia',agenciaId:'gerencia',nombre:'Gerencia Avanza'}); } const empresas=await obtenerEmpresas(); for(const emp of empresas){ if(emp.email.toLowerCase()===email && String(emp.password).trim()===pass){ const token=jwt.sign({agenciaId:emp.id,email,rol:'jefe',nombre:emp.nombre,plan:emp.plan},JWT_SECRET,{expiresIn:'30d'}); emp.token=token; await guardarEmpresa(emp); return res.json({token,rol:'jefe',agenciaId:emp.id,plan:emp.plan,nombre:emp.nombre}); } const user=(emp.equipo||[]).find(u=>u.email.toLowerCase()===email && String(u.password).trim()===pass); if(user){ const token=jwt.sign({agenciaId:emp.id,email,rol:user.rol||'trabajador',nombre:user.nombre,plan:emp.plan},JWT_SECRET,{expiresIn:'30d'}); user.token=token; await guardarEmpresa(emp); return res.json({token,rol:user.rol||'trabajador',agenciaId:emp.id,plan:emp.plan,nombre:user.nombre}); } } return res.status(401).json({error:'Credenciales inválidas'}); }catch(e){ return res.status(500).json({error:e.message}); } });
const upload=multer({storage:multer.memoryStorage()});
app.get('/api/mensajes',auth,async(req,res)=>{ const agenciaId=req.user.agenciaId; let msgs=[]; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM mensajes WHERE agencia_id=$1 ORDER BY timestamp DESC LIMIT 1000',[agenciaId]); msgs=rows.map(r=>({id:r.id,waId:r.wa_id,texto:r.texto,timestamp:r.timestamp,tipo:r.tipo,leido:r.leido,etiqueta:r.etiqueta,phoneId:r.phone_id,nombre:r.nombre,campanaId:r.campana_id,asignadoA:r.asignado_a,mediaUrl:r.media_url,mediaTipo:r.media_tipo})); } else msgs=readJSON(path.join(agenciaPath(agenciaId),'mensajes.json')).sort((a,b)=>b.timestamp-a.timestamp); if(req.user.rol!=='jefe' && req.user.rol!=='gerencia'){ msgs=msgs.filter(m=>!m.asignadoA || m.asignadoA===req.user.email); } res.json(msgs); });
app.post('/api/mensajes/leido',auth,async(req,res)=>{ const {id}=req.body; const agenciaId=req.user.agenciaId; if(pgPool) await pgPool.query('UPDATE mensajes SET leido=true WHERE id=$1 AND agencia_id=$2',[id,agenciaId]); else { const p=path.join(agenciaPath(agenciaId),'mensajes.json'); const ms=readJSON(p); const m=ms.find(x=>x.id===id); if(m){ m.leido=true; writeJSON(p,ms); } } res.json({ok:true}); });
app.post('/api/mensajes/enviar',auth,async(req,res)=>{ const {waId,texto}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId); const phoneUsar=emp.phoneId||PHONE_NUMBER_ID; const tokenUsar=emp.metaToken||META_TOKEN; if(!tokenUsar) return res.status(400).json({error:'Falta TOKEN - Configura WHATSAPP_TOKEN en Variables Railway'}); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${phoneUsar}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${tokenUsar}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:waId.replace('+',''),type:'text',text:{body:texto}})}); const j=await r.json(); if(!r.ok) throw new Error(JSON.stringify(j)); if(pgPool) await pgPool.query('INSERT INTO mensajes (id,agencia_id,wa_id,texto,timestamp,tipo,leido,etiqueta,phone_id,nombre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[uuidv4(),agenciaId,waId,texto,Date.now(),'saliente',true,null,phoneUsar,req.user.nombre]); else { const p=path.join(agenciaPath(agenciaId),'mensajes.json'); const ms=readJSON(p); ms.push({id:uuidv4(),waId,texto,timestamp:Date.now(),tipo:'saliente',leido:true,etiqueta:null,phoneId:phoneUsar,nombre:req.user.nombre}); writeJSON(p,ms); } res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}); } });
app.get('/api/contactos',auth,async(req,res)=>{ const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM contactos WHERE agencia_id=$1',[agenciaId]); return res.json(rows.map(r=>({id:r.id,waId:r.wa_id,nombre:r.nombre,telefono:r.telefono,online:r.online}))); } res.json(readJSON(path.join(agenciaPath(agenciaId),'contactos.json'))); });
app.post('/api/contactos/seguimiento',auth,async(req,res)=>{ const {waId,fecha,nota}=req.body; const agenciaId=req.user.agenciaId; if(pgPool) await pgPool.query('INSERT INTO calendario (id,agencia_id,wa_id,fecha,nota,estado,creado,asignado_a) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[uuidv4(),agenciaId,waId,fecha,nota,'pendiente',Date.now(),req.user.email]); else { const ap=agenciaPath(agenciaId); const cal=readJSON(path.join(ap,'calendario.json')); cal.push({id:uuidv4(),waId,fecha,nota,estado:'pendiente',creado:Date.now(),asignadoA:req.user.email}); writeJSON(path.join(ap,'calendario.json'),cal); } res.json({ok:true}); });
app.get('/api/calendario',auth,async(req,res)=>{ const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM calendario WHERE agencia_id=$1 ORDER BY creado DESC',[agenciaId]); return res.json(rows); } res.json(readJSON(path.join(agenciaPath(agenciaId),'calendario.json'))); });
// PLANTILLAS AUTO TOTAL - Lee ENV automatico
app.get('/api/plantillas',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  let plantillas=[]; try{ if(pgPool){ const {rows}=await pgPool.query('SELECT data FROM plantillas WHERE agencia_id=$1',[agenciaId]); if(rows[0]){ let d=rows[0].data; plantillas=typeof d==='string'?JSON.parse(d):d; }} else plantillas=readJSON(path.join(agenciaPath(agenciaId),'plantillas.json')); }catch{}
  const wabaUsar=emp?.wabaId||WABA_ID; const tokenUsar=emp?.metaToken||META_TOKEN;
  if(wabaUsar && tokenUsar){
    try{
      const r=await fetch(`https://graph.facebook.com/v20.0/${wabaUsar}/message_templates?access_token=${tokenUsar}&limit=100`);
      const j=await r.json(); console.log('[PLANTILLAS AUTO]',wabaUsar,j.data?.length||0,j.error?JSON.stringify(j.error).slice(0,200):'OK');
      if(j.data && j.data.length>0){ const aprobadas=j.data.filter(t=>t.status==='APPROVED'); plantillas=aprobadas.length>0?aprobadas:j.data; if(pgPool) await pgPool.query('INSERT INTO plantillas (id,agencia_id,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3',[agenciaId,agenciaId,JSON.stringify(plantillas)]); else writeJSON(path.join(agenciaPath(agenciaId),'plantillas.json'),plantillas); }
    }catch(e){ console.log('[PLANTILLAS ERR]',e.message); }
  }
  if(!plantillas||!plantillas.length) plantillas=[{name:'auto',status:'AUTO'}];
  res.json(plantillas);
});
app.get('/api/plantillas/sync',auth,async(req,res)=>{
  const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.user.agenciaId);
  const wabaUsar=emp?.wabaId||WABA_ID; const tokenUsar=emp?.metaToken||META_TOKEN;
  if(!wabaUsar||!tokenUsar) return res.status(400).json({error:'Falta WABA_ID o TOKEN en Variables Railway - Agrega WHATSAPP_TOKEN y WABA_ID'});
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${wabaUsar}/message_templates?access_token=${tokenUsar}&limit=100`);
    const j=await r.json(); if(j.error) return res.status(400).json({error:j.error,waba:wabaUsar});
    const aprobadas=(j.data||[]).filter(t=>t.status==='APPROVED'); const guardar=aprobadas.length>0?aprobadas:j.data||[];
    if(pgPool) await pgPool.query('INSERT INTO plantillas (id,agencia_id,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3',[req.user.agenciaId,req.user.agenciaId,JSON.stringify(guardar)]); else writeJSON(path.join(agenciaPath(req.user.agenciaId),'plantillas.json'),guardar);
    res.json({ok:true,waba:wabaUsar,total:j.data?.length||0,aprobadas:aprobadas.length,plantillas:guardar});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/campanas/subir-excel',auth,upload.single('excel'),async(req,res)=>{
  try{
    let rows=[]; if(req.file){ const wb=XLSX.read(req.file.buffer); const ws=wb.Sheets[wb.SheetNames[0]]; rows=XLSX.utils.sheet_to_json(ws,{defval:''}); }
    const telefonos=extraerTels(rows); if(telefonos.length===0) return res.status(400).json({error:'No se detectaron números en Excel'});
    const agenciaId=req.user.agenciaId; const nombre=req.body.nombre||`Campaña ${new Date().toLocaleDateString()}`; const plantilla=req.body.plantilla||'auto';
    const camp={id:uuidv4(),agencia_id:agenciaId,nombre,plantilla,telefonos,total:telefonos.length,enviados:0,estado:'pendiente',creada:Date.now(),historial:[],phone_usado:PHONE_NUMBER_ID,fallidos:0};
    if(pgPool) await pgPool.query('INSERT INTO campanas (id,agencia_id,nombre,plantilla,telefonos,total,enviados,estado,creada,historial,phone_usado,fallidos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[camp.id,camp.agencia_id,camp.nombre,camp.plantilla,JSON.stringify(camp.telefonos),camp.total,0,'pendiente',camp.creada,JSON.stringify([]),camp.phone_usado,0]);
    else { const p=path.join(agenciaPath(agenciaId),'campanas.json'); const cs=readJSON(p); cs.push({id:camp.id,nombre:camp.nombre,plantilla:camp.plantilla,telefonos:camp.telefonos,total:camp.total,enviados:0,estado:'pendiente',creada:camp.creada,historial:[],phoneUsado:camp.phone_usado,fallidos:0}); writeJSON(p,cs); }
    colasCampanas.set(agenciaId+camp.id,{lista:telefonos,idx:0,pausada:false});
    res.json({ok:true,campana:camp,segmentados:telefonos.length,telefonos});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/campanas',auth,async(req,res)=>{ const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM campanas WHERE agencia_id=$1 ORDER BY creada DESC',[agenciaId]); return res.json(rows.map(r=>({...r,telefonos: typeof r.telefonos==='string'? JSON.parse(r.telefonos): r.telefonos}))); } res.json(readJSON(path.join(agenciaPath(agenciaId),'campanas.json'))); });
app.post('/api/campanas/enviar',auth,async(req,res)=>{
  const {campanaId}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  const tokenUsar=emp.metaToken||META_TOKEN; const phoneUsar=emp.phoneId||PHONE_NUMBER_ID;
  if(!tokenUsar) return res.status(400).json({error:'Falta TOKEN'});
  let camp=null; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM campanas WHERE id=$1 AND agencia_id=$2',[campanaId,agenciaId]); camp=rows[0]; if(camp && typeof camp.telefonos==='string') camp.telefonos=JSON.parse(camp.telefonos); } else { const cs=readJSON(path.join(agenciaPath(agenciaId),'campanas.json')); camp=cs.find(c=>c.id===campanaId); }
  if(!camp) return res.status(404).json({error:'Campaña no encontrada'});
  const lista=camp.telefonos||[]; colasCampanas.set(agenciaId+campanaId,{lista,idx:camp.enviados||0,pausada:false});
  if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2',['enviando',campanaId]);
  (async()=>{
    let cola=colasCampanas.get(agenciaId+campanaId); let fallidos=0; let enviados=cola.idx;
    for(let i=cola.idx;i<cola.lista.length;i++){
      cola=colasCampanas.get(agenciaId+campanaId); if(!cola||cola.pausada) break;
      const to=cola.lista[i].replace('+','');
      try{
        const payload=camp.plantilla==='auto'? {messaging_product:'whatsapp',to,type:'text',text:{body:`Hola de ${emp.nombre}`}} : {messaging_product:'whatsapp',to,type:'template',template:{name:camp.plantilla,language:{code:'es_CO'}}};
        const r=await fetch(`https://graph.facebook.com/v20.0/${phoneUsar}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${tokenUsar}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if(r.ok) enviados++; else fallidos++;
        if(pgPool) await pgPool.query('UPDATE campanas SET enviados=$1,fallidos=$2 WHERE id=$3',[enviados,fallidos,campanaId]);
      }catch{ fallidos++; }
      if((i+1)%25===0) await new Promise(r=>setTimeout(r,45000)); else await new Promise(r=>setTimeout(r,1800));
      cola.idx=i+1; colasCampanas.set(agenciaId+campanaId,cola);
    }
    if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2',['completada',campanaId]);
  })();
  res.json({ok:true,mensaje:`Envío iniciado ${lista.length} números a ${phoneUsar} plantilla ${camp.plantilla} - Anti-baneo bloques 25`,total:lista.length});
});
app.post('/api/campanas/pausar',auth,async(req,res)=>{ const {campanaId}=req.body; const key=req.user.agenciaId+campanaId; const cola=colasCampanas.get(key); if(cola) cola.pausada=true; if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2',['pausada',campanaId]); res.json({ok:true}); });
app.post('/api/campanas/reanudar',auth,async(req,res)=>{ const {campanaId}=req.body; const key=req.user.agenciaId+campanaId; const cola=colasCampanas.get(key); if(cola) cola.pausada=false; res.json({ok:true}); });
app.get('/api/config',auth,async(req,res)=>{ const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.user.agenciaId); res.json({ADMIN_KEY,DATA_DIR:BASE_DATA,DATABASE_URL:DATABASE_URL?'OK':'FS',DEFAULT_AGENCY,EMAIL_USER,META_VERIFY_TOKEN,PHONE_NUMBER_ID,WABA_ID,TOKEN:META_TOKEN?'OK '+META_TOKEN.slice(0,10)+'...':'FALTA',RESEND_API_KEY:RESEND_API_KEY?'OK':'MISSING',agencia:emp?.nombre,plan:emp?.plan,phoneId:emp?.phoneId||PHONE_NUMBER_ID,wabaId:emp?.wabaId||WABA_ID,metaToken:emp?.metaToken?'OK':'FALTA',auto:true}); });
app.post('/api/config',auth,async(req,res)=>{ if(req.user.rol!=='jefe'&&req.user.rol!=='gerencia') return res.status(403).json({error:'Solo Jefe'}); const {phoneId,wabaId,metaToken}=req.body; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.user.agenciaId); if(phoneId) emp.phoneId=phoneId; if(wabaId) emp.wabaId=wabaId; if(metaToken) emp.metaToken=metaToken; emp.apiStatus='conectado'; await guardarEmpresa(emp); res.json({ok:true,auto:true}); });
app.get('/api/gerencia/agencias',authGerencia,async(req,res)=>{ const empresas=await obtenerEmpresas(); res.json(empresas.map(e=>({id:e.id,nombre:e.nombre,email:e.email,plan:e.plan,phoneId:e.phoneId||PHONE_NUMBER_ID,wabaId:e.wabaId||WABA_ID,token:e.metaToken?'OK':'FALTA'}))); });
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
