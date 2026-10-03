// KLIDO CRM v115.5 FINAL - FIX column plan_precio does not exist - MIGRACION AUTO - MULTIAGENCIA REAL
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
console.log('[KLIDO v115.5] DATA_DIR',BASE_DATA,'PHONE',PHONE_NUMBER_ID,'VERIFY',META_VERIFY_TOKEN);

app.get('/health',(req,res)=>res.json({ok:true,status:'KLIDO v115.5 FIX plan_precio',META_VERIFY_TOKEN,PHONE_NUMBER_ID,ADMIN_KEY,DATA_DIR:BASE_DATA,PG:DATABASE_URL?'SI':'FS',RESEND:RESEND_API_KEY?'OK':'MISSING'}));
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.listen(PORT,'0.0.0.0',()=>console.log(`[KLIDO v115.5 OK] Puerto ${PORT} - LOGIN FIX - SOPORTE 24/7`));

app.get('/campana.html',(req,res)=>res.sendFile(path.join(__dirname,'public','crm.html')));
app.get('/campanas.html',(req,res)=>res.sendFile(path.join(__dirname,'public','campana.html')));
app.get(['/campaña.html','/campañas.html'],(req,res)=>res.sendFile(path.join(__dirname,'public','campana.html')));

let pgPool=null;
if(DATABASE_URL && Pool){
  try{
    pgPool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});
    pgPool.query(`
      CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY,nombre TEXT,email TEXT UNIQUE,password TEXT,plan TEXT,token TEXT,phone_id TEXT,waba_id TEXT,meta_token TEXT,equipo JSONB DEFAULT '[]'::jsonb,creado BIGINT,mantenimiento BIGINT,default_agency TEXT);
      CREATE TABLE IF NOT EXISTS mensajes (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,texto TEXT,timestamp BIGINT,tipo TEXT,leido BOOLEAN,etiqueta TEXT,phone_id TEXT,nombre TEXT,campana_id TEXT,asignado_a TEXT,media_url TEXT,media_tipo TEXT);
      CREATE TABLE IF NOT EXISTS contactos (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,nombre TEXT,telefono TEXT,creado BIGINT,seguimiento JSONB,etiquetas JSONB,online BIGINT);
      CREATE TABLE IF NOT EXISTS campanas (id TEXT PRIMARY KEY,agencia_id TEXT,nombre TEXT,plantilla TEXT,telefonos JSONB,total INT,enviados INT,estado TEXT,creada BIGINT,historial JSONB,phone_usado TEXT,fallidos INT DEFAULT 0);
      CREATE TABLE IF NOT EXISTS calendario (id TEXT PRIMARY KEY,agencia_id TEXT,wa_id TEXT,fecha TEXT,nota TEXT,estado TEXT,creado BIGINT,asignado_a TEXT);
      CREATE TABLE IF NOT EXISTS plantillas (id TEXT PRIMARY KEY,agencia_id TEXT,data JSONB);
      CREATE TABLE IF NOT EXISTS gmail_camp (id TEXT PRIMARY KEY,agencia_id TEXT,asunto TEXT,total INT,enviados INT,creado BIGINT,historial JSONB);
    `).then(async()=>{
      try{
        await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS plan_precio TEXT;`);
        await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS plan_trimestral TEXT;`);
        await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS api_status TEXT DEFAULT 'pendiente';`);
        await pgPool.query(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS media_url TEXT;`);
        await pgPool.query(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS media_tipo TEXT;`);
        await pgPool.query(`ALTER TABLE contactos ADD COLUMN IF NOT EXISTS online BIGINT;`);
        await pgPool.query(`ALTER TABLE campanas ADD COLUMN IF NOT EXISTS fallidos INT DEFAULT 0;`);
        console.log('[PG] MIGRACION v115.5 OK - plan_precio, plan_trimestral, api_status, media, online, fallidos');
      }catch(e){ console.log('[MIGRACION ERR]',e.message); }
    }).catch(e=>console.log('[PG CREATE ERR]',e.message));
  }catch(e){ console.log('[PG INIT FAIL]',e.message); }
}

const codigosRegistro=new Map(),colasCampanas=new Map();
function agenciaPath(id){ const p=path.join(AGENCIAS_DIR,id); if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); ['mensajes.json','contactos.json','campanas.json','calendario.json','plantillas.json','gmail.json'].forEach(f=>{const fp=path.join(p,f); if(!fs.existsSync(fp)) fs.writeFileSync(fp,'[]')}); return p; }
function readJSON(fp,def=[]){try{if(!fs.existsSync(fp)) return def; return JSON.parse(fs.readFileSync(fp,'utf8')||'[]')}catch{return def}}
function writeJSON(fp,d){fs.writeFileSync(fp,JSON.stringify(d,null,2))}
function normalizarTel(raw){if(!raw) return null; let dig=String(raw).replace(/\D/g,''); if(dig.length===10) return '+57'+dig; if(dig.length===11&&dig.startsWith('57')) return '+'+dig; if(dig.length===12) return '+'+dig; return '+57'+dig.slice(-10)}
function extraerTels(rows){const s=new Set(); rows.forEach(r=>{Object.values(r).forEach(v=>{if(!v) return; String(v).split(/[,;\n\s]+/).forEach(part=>{const n=normalizarTel(part); if(n) s.add(n); const m=String(part).match(/(\+?\d[\d\s\-()]{7,}\d)/g); if(m) m.forEach(x=>{const nn=normalizarTel(x); if(nn) s.add(nn)})})})}); return [...s]}
async function sendEmail(to,subj,html){ if(RESEND_API_KEY){ try{ const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:RESEND_FROM,to:[to],subject:subj,html})}); const j=await r.json(); console.log('[RESEND OK]',j.id||j); return true;}catch(e){console.log('[RESEND FAIL]',e.message)}} if(EMAIL_USER&&EMAIL_PASS&&nodemailer){ try{let t=nodemailer.createTransport({service:'gmail',auth:{user:EMAIL_USER,pass:EMAIL_PASS}}); await t.sendMail({from:EMAIL_USER,to,subject:subj,html}); return true}catch(e){console.log('[GMAIL FAIL]',e.message)}} console.log(`[MOCK EMAIL] ${to} ${subj}`); return true;}

async function obtenerEmpresas(){
  if(pgPool){
    const {rows}=await pgPool.query('SELECT * FROM agencias');
    return rows.map(r=>({id:r.id,nombre:r.nombre,email:r.email,password:r.password,plan:r.plan,token:r.token,phoneId:r.phone_id,wabaId:r.waba_id,metaToken:r.meta_token,equipo:r.equipo||[],creado:r.creado,mantenimiento:r.mantenimiento,defaultAgency:r.default_agency,planPrecio:r.plan_precio,planTrimestral:r.plan_trimestral,apiStatus:r.api_status}));
  } else {
    const fp=path.join(BASE_DATA,'empresas.json');
    if(!fs.existsSync(fp)) fs.writeFileSync(fp,'[]');
    let data=readJSON(fp);
    if(data.length===0){
      const id=uuidv4();
      const token=jwt.sign({agenciaId:id,email:'fermorales20020310@gmail.com',rol:'jefe',nombre:'Avanza Consulting',plan:'gold'},JWT_SECRET,{expiresIn:'30d'});
      const def={id,nombre:'Avanza Consulting',email:'fermorales20020310@gmail.com',password:'Mafe2002@',plan:'gold',token,phoneId:PHONE_NUMBER_ID,wabaId:null,metaToken:null,equipo:[],creado:Date.now(),mantenimiento:Date.now()+90*24*3600*1000,defaultAgency:DEFAULT_AGENCY,planPrecio:'$2.400.000 anual',planTrimestral:'$120.000 trim + IA + Llamadas + Gmail',apiStatus:'pendiente'};
      writeJSON(fp,[def]); agenciaPath(id); console.log('[AUTO-CREATE] fermorales20020310@gmail.com / Mafe2002@');
      return [def];
    }
    return data;
  }
}

async function guardarEmpresa(emp){
  const precios={basico:{precio:'$800.000 anual',trim:'$80.000 trim'},premium:{precio:'$1.300.000 anual',trim:'$95.000 trim'},gold:{precio:'$2.400.000 anual',trim:'$120.000 trim + IA + Llamadas + Gmail'}};
  const p=precios[emp.plan]||precios.gold;
  if(pgPool){
    try{
      await pgPool.query(`INSERT INTO agencias (id,nombre,email,password,plan,token,phone_id,waba_id,meta_token,equipo,creado,mantenimiento,default_agency,plan_precio,plan_trimestral,api_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO UPDATE SET nombre=$2,email=$3,password=$4,plan=$5,token=$6,phone_id=$7,waba_id=$8,meta_token=$9,equipo=$10,mantenimiento=$12,default_agency=$13,plan_precio=$14,plan_trimestral=$15,api_status=$16`,[emp.id,emp.nombre,emp.email,emp.password,emp.plan,emp.token,emp.phoneId||PHONE_NUMBER_ID,emp.wabaId||null,emp.metaToken||null,JSON.stringify(emp.equipo||[]),emp.creado,emp.mantenimiento,DEFAULT_AGENCY,p.precio,p.trim,emp.apiStatus||'pendiente']);
    }catch(e){
      console.log('[GUARDAR FALLBACK sin columnas nuevas]',e.message);
      try{
        await pgPool.query(`INSERT INTO agencias (id,nombre,email,password,plan,token,phone_id,waba_id,meta_token,equipo,creado,mantenimiento,default_agency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO UPDATE SET nombre=$2,email=$3,password=$4,plan=$5,token=$6,phone_id=$7,waba_id=$8,meta_token=$9,equipo=$10,mantenimiento=$12,default_agency=$13`,[emp.id,emp.nombre,emp.email,emp.password,emp.plan,emp.token,emp.phoneId||PHONE_NUMBER_ID,emp.wabaId||null,emp.metaToken||null,JSON.stringify(emp.equipo||[]),emp.creado,emp.mantenimiento,DEFAULT_AGENCY]);
      }catch(e2){ console.log('[GUARDAR FALLBACK 2 ERR]',e2.message); }
    }
  } else {
    emp.planPrecio=p.precio; emp.planTrimestral=p.trim;
    const fp=path.join(BASE_DATA,'empresas.json');
    const all=readJSON(fp);
    const idx=all.findIndex(e=>e.id===emp.id);
    if(idx>=0) all[idx]=emp; else all.push(emp);
    writeJSON(fp,all);
  }
}

function auth(req,res,next){ const h=req.headers.authorization||''; const token=h.replace('Bearer ','').trim()||req.query.token; if(!token) return res.status(401).json({error:'Token requerido'}); try{ const pay=jwt.verify(token,JWT_SECRET); req.agenciaId=pay.agenciaId; req.user=pay; return next(); }catch{return res.status(401).json({error:'Token inválido'})} }
function authGerencia(req,res,next){ const k=req.headers['x-admin-key']||req.query.admin_key; if(k===ADMIN_KEY){req.user={rol:'gerencia'}; return next();} try{const h=req.headers.authorization||''; const t=h.replace('Bearer ','').trim(); const p=jwt.verify(t,JWT_SECRET); if(p.rol==='gerencia'){req.user=p; return next();}}catch{} return res.status(403).json({error:'Gerencia solo - ADMIN_KEY requerido'})}

app.get('/webhook',(req,res)=>{ const mode=req.query['hub.mode'],token=req.query['hub.verify_token'],ch=req.query['hub.challenge']; if(mode==='subscribe'&&token===META_VERIFY_TOKEN){ console.log('[WEBHOOK VERIFICADO klido123 OK]'); return res.status(200).send(ch); } return res.sendStatus(403); });

app.post('/webhook',async(req,res)=>{
  try{
    const body=req.body;
    if(body.object!=='whatsapp_business_account') return res.sendStatus(200);
    const empresas=await obtenerEmpresas();
    for(const entry of body.entry||[]){
      for(const change of entry.changes||[]){
        const value=change.value;
        const phoneId=value.metadata?.phone_number_id||PHONE_NUMBER_ID;
        const msgs=value.messages||[];
        const contacts=value.contacts||[];
        for(const msg of msgs){
          const agencia=empresas.find(e=>e.phoneId===phoneId)||empresas[0];
          if(!agencia) continue;
          let texto=msg.text?.body||'';
          let mediaUrl=null,mediaTipo=null;
          if(msg.image){ texto=`[Foto] ${msg.image.caption||''}`; mediaUrl=msg.image.id; mediaTipo='image'; }
          if(msg.audio){ texto=`[Audio]`; mediaUrl=msg.audio.id; mediaTipo='audio'; }
          if(msg.document){ texto=`[Archivo] ${msg.document.filename||''}`; mediaUrl=msg.document.id; mediaTipo='document'; }
          if(msg.video){ texto=`[Video] ${msg.video.caption||''}`; mediaUrl=msg.video.id; mediaTipo='video'; }
          const waId=msg.from;
          const nombre=contacts.find(c=>c.wa_id===waId)?.profile?.name||waId;
          const nuevo={id:msg.id,agencia_id:agencia.id,wa_id:waId,texto,timestamp:Date.now(),tipo:'entrante',leido:false,etiqueta:null,phone_id:phoneId,nombre,campana_id:null,asignado_a:null,media_url:mediaUrl,media_tipo:mediaTipo};
          if(pgPool){
            const {rows}=await pgPool.query('SELECT * FROM campanas WHERE agencia_id=$1',[agencia.id]);
            for(const camp of rows){ const tels=camp.telefonos||[]; const arr=typeof tels==='string'?JSON.parse(tels):tels; if(arr.some(t=>waId.includes(t.slice(-10)))){nuevo.etiqueta='amarilla'; nuevo.campana_id=camp.id;}}
            await pgPool.query('INSERT INTO mensajes (id,agencia_id,wa_id,texto,timestamp,tipo,leido,etiqueta,phone_id,nombre,campana_id,asignado_a,media_url,media_tipo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING',[nuevo.id,nuevo.agencia_id,nuevo.wa_id,nuevo.texto,nuevo.timestamp,nuevo.tipo,nuevo.leido,nuevo.etiqueta,nuevo.phone_id,nuevo.nombre,nuevo.campana_id,nuevo.asignado_a,nuevo.media_url,nuevo.media_tipo]);
            await pgPool.query(`INSERT INTO contactos (id,agencia_id,wa_id,nombre,telefono,creado,online) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET online=$7, nombre=$4`,[waId,agencia.id,waId,nombre,waId,Date.now(),Date.now()]);
          } else {
            const ap=agenciaPath(agencia.id);
            const mensajes=readJSON(path.join(ap,'mensajes.json'));
            const campanas=readJSON(path.join(ap,'campanas.json'));
            for(const camp of campanas){ if((camp.telefonos||[]).some(t=>waId.includes(t.slice(-10)))){nuevo.etiqueta='amarilla'; nuevo.campana_id=camp.id;}}
            mensajes.push({id:nuevo.id,waId,texto:nuevo.texto,timestamp:nuevo.timestamp,tipo:'entrante',leido:false,etiqueta:nuevo.etiqueta,phoneId,nombre,campanaId:nuevo.campana_id,mediaUrl,mediaTipo});
            writeJSON(path.join(ap,'mensajes.json'),mensajes);
            const contactos=readJSON(path.join(ap,'contactos.json'));
            let c=contactos.find(x=>x.waId===waId);
            if(!c){ contactos.push({id:waId,waId,nombre,telefono:waId,creado:Date.now(),online:Date.now()}); } else { c.online=Date.now(); c.nombre=nombre; }
            writeJSON(path.join(ap,'contactos.json'),contactos);
          }
          console.log(`[TIEMPO REAL] ${agencia.nombre} <- ${waId}: ${texto} ${nuevo.etiqueta?'[AMARILLA CAMPAÑA]':''}`);
        }
      }
    }
    res.sendStatus(200);
  }catch(e){ console.log('Webhook error',e); res.sendStatus(200); }
});

app.post('/api/public/solicitar-codigo',async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const nombre=req.body.nombre||'Cliente'; const plan=req.body.plan||'basico';
  if(!email) return res.status(400).json({error:'Email requerido'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosRegistro.set(email,{codigo,expira:Date.now()+600000,nombre,plan});
  const html=`<h2>KLIDO Código ${plan.toUpperCase()}</h2><h1>${codigo}</h1><p>Plan ${plan} - Básico $800K+80K | Premium $1.3M+95K | Gold $2.4M+120K + IA Llamadas Gmail</p><p>Expira 10 min - Soporte 24/7 WPP ${SOPORTE_WPP} - ${PHONE_NUMBER_ID}</p>`;
  await sendEmail(email,`KLIDO Código ${codigo} - ${plan}`,html);
  res.json({ok:true});
});
app.post('/api/public/crear-empresa',async(req,res)=>{
  const {nombre,email,password,codigo,plan,terminos}=req.body; const em=(email||'').toLowerCase().trim();
  if(!nombre||!em||!password||!codigo) return res.status(400).json({error:'Faltan datos'});
  if(!terminos) return res.status(400).json({error:'Acepta Términos Ley 1581'});
  const reg=codigosRegistro.get(em); if(!reg || reg.codigo!==codigo || Date.now()>reg.expira) return res.status(400).json({error:'Código inválido o vencido'});
  const empresas=await obtenerEmpresas(); if(empresas.find(e=>e.email===em)) return res.status(400).json({error:'Email ya registrado'});
  const id=uuidv4(); const tokenJwt=jwt.sign({agenciaId:id,email:em,rol:'jefe',nombre,plan:plan||reg.plan||'basico'},JWT_SECRET,{expiresIn:'30d'});
  const nueva={id,nombre,email:em,password,plan:plan||reg.plan||'basico',token:tokenJwt,phoneId:PHONE_NUMBER_ID,wabaId:null,metaToken:null,equipo:[],creado:Date.now(),mantenimiento:Date.now()+90*24*3600*1000,defaultAgency:DEFAULT_AGENCY,apiStatus:'pendiente'};
  await guardarEmpresa(nueva); if(!pgPool) agenciaPath(id);
  codigosRegistro.delete(em);
  res.json({ok:true,id,token:tokenJwt});
});
app.post('/api/public/recuperar-codigo',async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const empresas=await obtenerEmpresas();
  const emp=empresas.find(e=>e.email===email || e.equipo?.some(u=>u.email===email));
  if(!emp) return res.status(404).json({error:'Email no registrado'});
  const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosRegistro.set(email,{codigo,expira:Date.now()+600000,tipo:'recuperacion'});
  await sendEmail(email,`KLIDO Recuperación ${codigo}`,`<h1>${codigo}</h1><p>Recuperación KLIDO - Soporte 24/7 WPP ${SOPORTE_WPP}</p>`);
  res.json({ok:true});
});
app.post('/api/public/restablecer',async(req,res)=>{
  const email=(req.body.email||'').toLowerCase().trim(); const codigo=(req.body.codigo||'').trim(); const nueva=req.body.nueva||'';
  const reg=codigosRegistro.get(email); if(!reg || reg.codigo!==codigo || Date.now()>reg.expira) return res.status(400).json({error:'Código inválido'});
  const empresas=await obtenerEmpresas(); let found=false; for(const e of empresas){ if(e.email===email){ e.password=nueva; await guardarEmpresa(e); found=true; } for(const u of (e.equipo||[])){ if(u.email===email){ u.password=nueva; await guardarEmpresa(e); found=true; } } }
  if(!found) return res.status(404).json({error:'No encontrado'}); codigosRegistro.delete(email); res.json({ok:true});
});

app.post('/api/login',async(req,res)=>{
  try{
    const email=(req.body.email||'').toLowerCase().trim(); const pass=String(req.body.password||'').trim();
    console.log('[LOGIN INTENTO]',email);
    if((email===GERENCIA_EMAIL && pass===GERENCIA_PASS) || (req.headers['x-admin-key']===ADMIN_KEY && pass===GERENCIA_PASS)){
      const token=jwt.sign({rol:'gerencia',email:GERENCIA_EMAIL,agenciaId:'gerencia'},JWT_SECRET,{expiresIn:'12h'}); return res.json({token,rol:'gerencia',agenciaId:'gerencia',nombre:'Gerencia Avanza'});
    }
    const empresas=await obtenerEmpresas();
    for(const emp of empresas){
      if(emp.email.toLowerCase()===email && String(emp.password).trim()===pass){
        const token=jwt.sign({agenciaId:emp.id,email,rol:'jefe',nombre:emp.nombre,plan:emp.plan},JWT_SECRET,{expiresIn:'30d'}); emp.token=token; await guardarEmpresa(emp); console.log('[LOGIN OK JEFE]',email); return res.json({token,rol:'jefe',agenciaId:emp.id,plan:emp.plan,nombre:emp.nombre});
      }
      const user=(emp.equipo||[]).find(u=>u.email.toLowerCase()===email && String(u.password).trim()===pass);
      if(user){ const token=jwt.sign({agenciaId:emp.id,email,rol:user.rol||'trabajador',nombre:user.nombre,plan:emp.plan},JWT_SECRET,{expiresIn:'30d'}); user.token=token; await guardarEmpresa(emp); console.log('[LOGIN OK TRABAJADOR]',email); return res.json({token,rol:user.rol||'trabajador',agenciaId:emp.id,plan:emp.plan,nombre:user.nombre}); }
    }
    console.log('[LOGIN FAIL]',email); return res.status(401).json({error:'Credenciales inválidas - cuenta no existe, crea agencia'});
  }catch(e){ console.log('[LOGIN ERROR]',e.message); return res.status(500).json({error:e.message}); }
});

const upload=multer({storage:multer.memoryStorage()});
app.get('/api/mensajes',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId; let msgs=[];
  if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM mensajes WHERE agencia_id=$1 ORDER BY timestamp DESC LIMIT 1000',[agenciaId]); msgs=rows.map(r=>({id:r.id,waId:r.wa_id,texto:r.texto,timestamp:r.timestamp,tipo:r.tipo,leido:r.leido,etiqueta:r.etiqueta,phoneId:r.phone_id,nombre:r.nombre,campanaId:r.campana_id,asignadoA:r.asignado_a,mediaUrl:r.media_url,mediaTipo:r.media_tipo})); }
  else msgs=readJSON(path.join(agenciaPath(agenciaId),'mensajes.json')).sort((a,b)=>b.timestamp-a.timestamp);
  if(req.user.rol!=='jefe' && req.user.rol!=='gerencia'){ msgs=msgs.filter(m=>!m.asignadoA || m.asignadoA===req.user.email); }
  res.json(msgs);
});
app.post('/api/mensajes/leido',auth,async(req,res)=>{
  const {id}=req.body; const agenciaId=req.user.agenciaId;
  if(pgPool) await pgPool.query('UPDATE mensajes SET leido=true WHERE id=$1 AND agencia_id=$2',[id,agenciaId]);
  else { const p=path.join(agenciaPath(agenciaId),'mensajes.json'); const ms=readJSON(p); const m=ms.find(x=>x.id===id); if(m){ m.leido=true; writeJSON(p,ms); } }
  res.json({ok:true});
});
app.post('/api/mensajes/enviar',auth,async(req,res)=>{
  const {waId,texto}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  const phoneUsar=emp.phoneId||PHONE_NUMBER_ID;
  if(!emp?.metaToken) return res.status(400).json({error:'Configura token Meta en Configuración - API Oficial'});
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${phoneUsar}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${emp.metaToken}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:waId.replace('+',''),type:'text',text:{body:texto}})});
    const j=await r.json(); if(!r.ok) throw new Error(JSON.stringify(j));
    if(pgPool) await pgPool.query('INSERT INTO mensajes (id,agencia_id,wa_id,texto,timestamp,tipo,leido,etiqueta,phone_id,nombre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[uuidv4(),agenciaId,waId,texto,Date.now(),'saliente',true,null,phoneUsar,req.user.nombre]);
    else { const p=path.join(agenciaPath(agenciaId),'mensajes.json'); const ms=readJSON(p); ms.push({id:uuidv4(),waId,texto,timestamp:Date.now(),tipo:'saliente',leido:true,etiqueta:null,phoneId:phoneUsar,nombre:req.user.nombre}); writeJSON(p,ms); }
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/contactos',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM contactos WHERE agencia_id=$1',[agenciaId]); return res.json(rows.map(r=>({id:r.id,waId:r.wa_id,nombre:r.nombre,telefono:r.telefono,online:r.online}))); }
  res.json(readJSON(path.join(agenciaPath(agenciaId),'contactos.json')));
});
app.post('/api/contactos/seguimiento',auth,async(req,res)=>{
  const {waId,fecha,nota}=req.body; const agenciaId=req.user.agenciaId;
  if(pgPool) await pgPool.query('INSERT INTO calendario (id,agencia_id,wa_id,fecha,nota,estado,creado,asignado_a) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[uuidv4(),agenciaId,waId,fecha,nota,'pendiente',Date.now(),req.user.email]);
  else { const ap=agenciaPath(agenciaId); const cal=readJSON(path.join(ap,'calendario.json')); cal.push({id:uuidv4(),waId,fecha,nota,estado:'pendiente',creado:Date.now(),asignadoA:req.user.email}); writeJSON(path.join(ap,'calendario.json'),cal); }
  res.json({ok:true});
});
app.get('/api/calendario',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM calendario WHERE agencia_id=$1 ORDER BY creado DESC',[agenciaId]); return res.json(rows); }
  res.json(readJSON(path.join(agenciaPath(agenciaId),'calendario.json')));
});
app.get('/api/plantillas',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId); let plantillas=[];
  if(pgPool){ const {rows}=await pgPool.query('SELECT data FROM plantillas WHERE agencia_id=$1',[agenciaId]); if(rows[0]) plantillas=rows[0].data; } else plantillas=readJSON(path.join(agenciaPath(agenciaId),'plantillas.json'));
  if(emp?.metaToken && emp?.wabaId){
    try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaId}/message_templates?access_token=${emp.metaToken}`); const j=await r.json(); if(j.data && j.data.length>0){ plantillas=j.data; if(pgPool) await pgPool.query('INSERT INTO plantillas (id,agencia_id,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3',[agenciaId,agenciaId,JSON.stringify(plantillas)]); else writeJSON(path.join(agenciaPath(agenciaId),'plantillas.json'),plantillas); } }catch(e){}
  }
  res.json(plantillas);
});
app.post('/api/campanas/subir-excel',auth,upload.single('excel'),async(req,res)=>{
  try{
    let rows=[]; if(req.file){ const wb=XLSX.read(req.file.buffer); const ws=wb.Sheets[wb.SheetNames[0]]; rows=XLSX.utils.sheet_to_json(ws); } else if(req.body.rows){ rows=typeof req.body.rows==='string'? JSON.parse(req.body.rows): req.body.rows; }
    const telefonos=extraerTels(rows); const agenciaId=req.user.agenciaId; const nombre=req.body.nombre||`Campaña ${Date.now()}`; const plantilla=req.body.plantilla||'auto';
    const camp={id:uuidv4(),agencia_id:agenciaId,nombre,plantilla,telefonos,total:telefonos.length,enviados:0,estado:'pendiente',creada:Date.now(),historial:[],phone_usado:req.body.phoneId||PHONE_NUMBER_ID,fallidos:0};
    if(pgPool) await pgPool.query('INSERT INTO campanas (id,agencia_id,nombre,plantilla,telefonos,total,enviados,estado,creada,historial,phone_usado,fallidos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[camp.id,camp.agencia_id,camp.nombre,camp.plantilla,JSON.stringify(camp.telefonos),camp.total,0,'pendiente',camp.creada,JSON.stringify([]),camp.phone_usado,0]);
    else { const p=path.join(agenciaPath(agenciaId),'campanas.json'); const cs=readJSON(p); cs.push({id:camp.id,nombre:camp.nombre,plantilla:camp.plantilla,telefonos:camp.telefonos,total:camp.total,enviados:0,estado:'pendiente',creada:camp.creada,historial:[],phoneUsado:camp.phone_usado,fallidos:0}); writeJSON(p,cs); }
    colasCampanas.set(agenciaId+camp.id,{lista:telefonos,idx:0,pausada:false});
    res.json({ok:true,campana:camp,segmentados:telefonos.length});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/campanas',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM campanas WHERE agencia_id=$1 ORDER BY creada DESC',[agenciaId]); return res.json(rows); }
  res.json(readJSON(path.join(agenciaPath(agenciaId),'campanas.json')));
});
app.post('/api/campanas/enviar',auth,async(req,res)=>{
  const {campanaId,phoneIdSeleccionado}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  if(!emp?.metaToken) return res.status(400).json({error:'Configura token Meta'});
  let camp=null; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM campanas WHERE id=$1 AND agencia_id=$2',[campanaId,agenciaId]); camp=rows[0]; } else { const cs=readJSON(path.join(agenciaPath(agenciaId),'campanas.json')); camp=cs.find(c=>c.id===campanaId); }
  if(!camp) return res.status(404).json({error:'Campaña no encontrada'});
  const phoneUsar=phoneIdSeleccionado||camp.phone_usado||camp.phoneUsado||emp.phoneId||PHONE_NUMBER_ID;
  const lista=camp.telefonos? (typeof camp.telefonos==='string'? JSON.parse(camp.telefonos): camp.telefonos): (camp.telefonos||[]);
  colasCampanas.set(agenciaId+campanaId,{lista,idx:camp.enviados||0,pausada:false});
  if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1,phone_usado=$2 WHERE id=$3',['enviando',phoneUsar,campanaId]);
  (async()=>{
    let cola=colasCampanas.get(agenciaId+campanaId); let fallidos=0;
    for(let i=cola.idx;i<cola.lista.length;i++){
      cola=colasCampanas.get(agenciaId+campanaId); if(!cola||cola.pausada) break;
      const to=cola.lista[i].replace('+','');
      try{
        const payload=camp.plantilla==='auto'? {messaging_product:'whatsapp',to,type:'text',text:{body:`Hola de ${emp.nombre}`}} : {messaging_product:'whatsapp',to,type:'template',template:{name:camp.plantilla,language:{code:'es_CO'}}};
        const r=await fetch(`https://graph.facebook.com/v20.0/${phoneUsar}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${emp.metaToken}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if(!r.ok) fallidos++; if(pgPool) await pgPool.query('UPDATE campanas SET enviados=enviados+1, fallidos=$1 WHERE id=$2',[fallidos,campanaId]);
      }catch(e){fallidos++;}
      if((i+1)%25===0) await new Promise(r=>setTimeout(r,45000)); else await new Promise(r=>setTimeout(r,1800));
      cola.idx=i+1; colasCampanas.set(agenciaId+campanaId,cola);
    }
    if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2',['completada',campanaId]);
  })();
  res.json({ok:true,mensaje:`Envío iniciado anti-baneo bloques 25 a ${phoneUsar}`});
});
app.post('/api/campanas/pausar',auth,async(req,res)=>{ const {campanaId}=req.body; const key=req.user.agenciaId+campanaId; const cola=colasCampanas.get(key); if(cola) cola.pausada=true; if(pgPool) await pgPool.query('UPDATE campanas SET estado=$1 WHERE id=$2',['pausada',campanaId]); res.json({ok:true}); });
app.post('/api/campanas/reanudar',auth,async(req,res)=>{ const {campanaId}=req.body; const key=req.user.agenciaId+campanaId; const cola=colasCampanas.get(key); if(cola) cola.pausada=false; res.json({ok:true}); });
app.post('/api/gmail/campana',auth,async(req,res)=>{
  const {asunto,html,destinatarios}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  if(emp.plan!=='gold' && emp.plan!=='premium') return res.status(403).json({error:'Gmail masivo solo Premium y Gold'});
  let enviados=0; const historial=[];
  for(const to of destinatarios){ const ok=await sendEmail(to,asunto,html); historial.push({to,fecha:Date.now(),estado:ok?'enviado':'error'}); if(ok) enviados++; await new Promise(r=>setTimeout(r,800)); }
  const id=uuidv4(); if(pgPool) await pgPool.query('INSERT INTO gmail_camp (id,agencia_id,asunto,total,enviados,creado,historial) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,agenciaId,asunto,destinatarios.length,enviados,Date.now(),JSON.stringify(historial)]); else { const p=path.join(agenciaPath(agenciaId),'gmail.json'); const gs=readJSON(p); gs.push({id,asunto,total:destinatarios.length,enviados,creado:Date.now(),historial}); writeJSON(p,gs); }
  res.json({ok:true,enviados,historial});
});
app.get('/api/gmail',auth,async(req,res)=>{ const agenciaId=req.user.agenciaId; if(pgPool){ const {rows}=await pgPool.query('SELECT * FROM gmail_camp WHERE agencia_id=$1 ORDER BY creado DESC',[agenciaId]); return res.json(rows); } res.json(readJSON(path.join(agenciaPath(agenciaId),'gmail.json'))); });
app.post('/api/equipo/agregar',auth,async(req,res)=>{
  if(req.user.rol!=='jefe' && req.user.rol!=='gerencia') return res.status(403).json({error:'Solo Jefe'});
  const {nombre,email,password,rol}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId);
  const limites={basico:3,premium:10,gold:999}; const max=limites[emp.plan]||3;
  if((emp.equipo||[]).length>=max) return res.status(400).json({error:`Límite ${max} para ${emp.plan}`});
  const token=jwt.sign({agenciaId,email:email.toLowerCase(),rol:rol||'trabajador',nombre},JWT_SECRET,{expiresIn:'30d'});
  emp.equipo.push({id:uuidv4(),nombre,email:email.toLowerCase(),password,rol:rol||'trabajador',token,asignados:[],creado:Date.now()}); await guardarEmpresa(emp); res.json({ok:true});
});
app.post('/api/equipo/quitar',auth,async(req,res)=>{ if(req.user.rol!=='jefe') return res.status(403).json({error:'Solo Jefe'}); const {email}=req.body; const agenciaId=req.user.agenciaId; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===agenciaId); emp.equipo=emp.equipo.filter(u=>u.email!==email.toLowerCase()); await guardarEmpresa(emp); res.json({ok:true}); });
app.get('/api/metricas',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId; let msgs=[]; if(pgPool){ const m=await pgPool.query('SELECT * FROM mensajes WHERE agencia_id=$1',[agenciaId]); msgs=m.rows; } else msgs=readJSON(path.join(agenciaPath(agenciaId),'mensajes.json'));
  const contactos=pgPool? (await pgPool.query('SELECT * FROM contactos WHERE agencia_id=$1',[agenciaId])).rows : readJSON(path.join(agenciaPath(agenciaId),'contactos.json'));
  const equipo=(await obtenerEmpresas()).find(e=>e.id===agenciaId)?.equipo||[];
  const metricasEquipo=equipo.map(u=>{ const mu=msgs.filter(m=>m.asignado_a===u.email); return {email:u.email,nombre:u.nombre,rol:u.rol,total:mu.length,noLeidos:mu.filter(x=>!x.leido).length}; });
  const online=Date.now()-5*60*1000;
  res.json({totalMensajes:msgs.length,noLeidos:msgs.filter(m=>!m.leido).length,amarilla:msgs.filter(m=>m.etiqueta==='amarilla').length,online:contactos.filter(c=>c.online&&c.online>online).length,equipo:equipo.length,metricasEquipo,plan:(await obtenerEmpresas()).find(e=>e.id===agenciaId)?.plan,phoneId:PHONE_NUMBER_ID,defaultAgency:DEFAULT_AGENCY});
});
app.get('/api/config',auth,async(req,res)=>{
  const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.user.agenciaId);
  res.json({ADMIN_KEY,DATA_DIR:BASE_DATA,DATABASE_URL:DATABASE_URL?'OK':'FS',DEFAULT_AGENCY,EMAIL_USER,META_VERIFY_TOKEN,PHONE_NUMBER_ID,RESEND_API_KEY:RESEND_API_KEY?'OK':'MISSING',agencia:emp?.nombre,plan:emp?.plan,planPrecio:emp?.planPrecio,planTrimestral:emp?.planTrimestral,apiStatus:emp?.apiStatus,wabaId:emp?.wabaId,phoneId:emp?.phoneId});
});
app.post('/api/config',auth,async(req,res)=>{
  if(req.user.rol!=='jefe' && req.user.rol!=='gerencia') return res.status(403).json({error:'Solo Jefe'});
  const {phoneId,wabaId,metaToken}=req.body; const empresas=await obtenerEmpresas(); const emp=empresas.find(e=>e.id===req.user.agenciaId);
  if(phoneId) emp.phoneId=phoneId; if(wabaId) emp.wabaId=wabaId; if(metaToken) emp.metaToken=metaToken; emp.apiStatus='conectado'; await guardarEmpresa(emp); res.json({ok:true});
});
app.get('/api/gerencia/agencias',authGerencia,async(req,res)=>{
  const empresas=await obtenerEmpresas(); res.json(empresas.map(e=>({id:e.id,nombre:e.nombre,email:e.email,plan:e.plan,precio:e.planPrecio,trimestral:e.planTrimestral,phoneId:e.phoneId||PHONE_NUMBER_ID,equipo:e.equipo?.length||0,apiStatus:e.apiStatus})));
});
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
