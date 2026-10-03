import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import nodemailer from 'nodemailer'; import path from 'path'; import { fileURLToPath } from 'url';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); app.use(cors()); app.use(express.json({limit:'50mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v120-final-out-of-this-world-2024';
const PHONE_ENV=process.env.PHONE_NUMBER_ID||'1338474282683914'; const WABA_ENV=process.env.WABA_ID||'2317286332424288';
let TOKEN_ENV=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||'';
if(!TOKEN_ENV){ for(const v of Object.values(process.env)){ if(typeof v==='string'&&v.startsWith('EAAT')&&v.length>80){TOKEN_ENV=v;break;} } }

const PLANES={
  basico:{id:'basico',nombre:'BÁSICO',anual:800000,mant:80000,dias:90,limite:5000,ia:false,llamadas:false,gmail:false,masivos:true,score:false},
  premium:{id:'premium',nombre:'PREMIUM IA',anual:1400000,mant:95000,dias:90,limite:15000,ia:true,llamadas:false,gmail:false,masivos:true,score:true},
  gold:{id:'gold',nombre:'GOLD TOTAL',anual:2500000,mant:135000,dias:90,limite:50000,ia:true,llamadas:true,gmail:true,masivos:true,score:true,voz:true,cobro:true}
};

async function initDB(){
  await pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT DEFAULT 'basico', plan_activo BOOLEAN DEFAULT true, token TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, equipo JSONB DEFAULT '[]', creado BIGINT, mantenimiento BIGINT, api_status TEXT DEFAULT 'pendiente', limite_usado INT DEFAULT 0, contrato_enviado BOOLEAN DEFAULT false)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS clientes_klido (id TEXT PRIMARY KEY, agencia_id TEXT, telefono TEXT, nombre TEXT, datos JSONB DEFAULT '{}', recordatorio TIMESTAMP, etiqueta TEXT DEFAULT 'nuevo', estado_embudo TEXT DEFAULT 'nuevo', asesor_id TEXT, ultimo_mensaje TIMESTAMP DEFAULT NOW(), score INT DEFAULT 0, origen_campana TEXT, leido BOOLEAN DEFAULT false)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS mensajes_klido (id SERIAL PRIMARY KEY, agencia_id TEXT, cliente_id TEXT, telefono TEXT, tipo TEXT, contenido TEXT, url TEXT, timestamp BIGINT, direccion TEXT, leido BOOLEAN DEFAULT false)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, estado TEXT DEFAULT 'activa', pausada BOOLEAN DEFAULT false, historial JSONB DEFAULT '[]', creada BIGINT)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS plantillas (id TEXT PRIMARY KEY, agencia_id TEXT, data JSONB)`);
  console.log('✅ KLIDO V120 DB LISTA - TODO AUTONOMO POR PLANES');
} initDB();

// AUTH
function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ const d=jwt.verify(h.replace('Bearer ',''),JWT); req.user=d; next(); }catch{ res.status(401).json({error:'Token invalido'}); } }

// BLOQUEO AUTOMATICO + PLANES
async function checkPlan(req,res,next){
  try{
    const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const emp=rows[0]; if(!emp) return res.status(403).json({error:'No existe'});
    if(!emp.plan_activo) return res.status(403).json({bloqueado:true, error:'PLAN BLOQUEADO - Mantenimiento vencido', wpp:'573133181851', link:`https://wa.me/573133181851?text=Hola%20KLIDO%20mi%20agencia%20${emp.id}%20plan%20${emp.plan}%20vencido%20quiero%20renovar`, monto:PLANES[emp.plan]?.mant});
    if(emp.mantenimiento && Date.now()>Number(emp.mantenimiento)){ await pgPool.query('UPDATE agencias SET plan_activo=false, api_status=$1 WHERE id=$2',['bloqueado_mantenimiento',emp.id]); return res.status(403).json({bloqueado:true, error:'MANTENIMIENTO TRIMESTRAL VENCIDO', wpp:'573133181851', monto:PLANES[emp.plan]?.mant}); }
    if(emp.limite_usado>=PLANES[emp.plan].limite) return res.status(403).json({error:'LIMITE DE MENSAJES ALCANZADO', limite:true, plan:emp.plan});
    if(req.path.includes('/ia')&&!PLANES[emp.plan].ia) return res.status(403).json({error:'IA solo en PREMIUM y GOLD', upgrade:'premium', wpp:'573133181851'});
    if(req.path.includes('/llamada')&&!PLANES[emp.plan].llamadas) return res.status(403).json({error:'Llamadas solo en GOLD', upgrade:'gold', wpp:'573133181851'});
    if(req.path.includes('/gmail')&&!PLANES[emp.plan].gmail) return res.status(403).json({error:'Gmail masivo solo en GOLD', upgrade:'gold'});
    req.empresa=emp; req.planCfg=PLANES[emp.plan]; next();
  }catch(e){ res.status(500).json({error:e.message}); }
}

async function obtenerEmpresas(){ const {rows}=await pgPool.query('SELECT * FROM agencias'); return rows.map(r=>({id:r.id,nombre:r.nombre,email:r.email,password:r.password,plan:r.plan,plan_activo:r.plan_activo,token:r.token,phoneId:r.phone_id,wabaId:r.waba_id,metaToken:r.meta_token,phoneIdEfectivo:r.phone_id||PHONE_ENV,wabaIdEfectivo:r.waba_id||WABA_ENV,metaTokenEfectivo:r.meta_token||TOKEN_ENV,equipo:r.equipo||[],creado:r.creado,mantenimiento:r.mantenimiento,apiStatus:r.api_status,limite_usado:r.limite_usado})); }

// LOGIN / REGISTRO
app.post('/api/auth/register', async(req,res)=>{
  try{
    const {nombre,email,password}=req.body; if(!nombre||!email||!password) return res.status(400).json({error:'Faltan datos'});
    const id='ag_'+Date.now(); const hash=await bcrypt.hash(password,10); const ahora=Date.now(); const mant=ahora+90*24*60*60*1000;
    await pgPool.query('INSERT INTO agencias (id,nombre,email,password,plan,plan_activo,token,creado,mantenimiento,api_status,limite_usado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,nombre,email,hash,'basico',true,jwt.sign({agenciaId:id,email,rol:'jefe'},JWT),ahora,mant,'pendiente',0]);
    // Contrato legal Colombia automatico
    try{ const trans=nodemailer.createTransport({service:'gmail',auth:{user:process.env.MAIL_USER,pass:process.env.MAIL_PASS}}); await trans.sendMail({from:process.env.MAIL_USER,to:email,subject:`Contrato KLIDO ${nombre} - Ley 1581 Habeas Data Colombia`,html:`<div style="font-family:Arial;background:#020617;color:white;padding:30px"><img src="https://klido.app/logo.png" style="width:80px"><h1>Contrato KLIDO - ${nombre}</h1><p>Plan BÁSICO Anual $800.000 + $80.000 trim mantenimiento</p><p>Ley 1581 de 2012 - Protección datos personales Colombia</p><p>Agencia: ${nombre} - ID: ${id} - Fecha: ${new Date().toLocaleDateString('es-CO')}</p><p>Al aceptar, autorizas tratamiento de datos según política KLIDO.</p></div>`}); }catch{}
    res.json({ok:true,id,token:jwt.sign({agenciaId:id,email,rol:'jefe'},JWT)});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/auth/login', async(req,res)=>{
  const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); const emp=rows[0]; if(!emp) return res.status(404).json({error:'No existe'});
  const ok=await bcrypt.compare(password,emp.password); if(!ok) return res.status(401).json({error:'Clave mala'});
  const token=jwt.sign({agenciaId:emp.id,email:emp.email,rol:'jefe'},JWT); res.json({ok:true,token,agencia:emp});
});

// CONFIG API 1 VEZ AUTONOMA
app.get('/api/config',auth,async(req,res)=>{
  const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId);
  res.json({tieneConfig:!!(emp.phoneId&&emp.wabaId&&emp.metaToken), phoneId:emp.phoneId||'', wabaId:emp.wabaId||'', phoneIdEfectivo:emp.phoneIdEfectivo, wabaIdEfectivo:emp.wabaIdEfectivo, apiStatus:emp.apiStatus, plan:emp.plan, planActivo:emp.plan_activo, limite:PLANES[emp.plan].limite, usado:emp.limite_usado});
});
app.post('/api/config',auth,async(req,res)=>{
  const {phoneId,wabaId,metaToken}=req.body; if(!phoneId||!wabaId||!metaToken) return res.status(400).json({error:'Faltan 3 datos'});
  try{ const t=await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?access_token=${metaToken}&limit=1`); const j=await t.json(); if(j.error) return res.status(400).json({error:'API invalida: '+j.error.message}); }catch(e){ return res.status(400).json({error:'No valida: '+e.message}); }
  await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3,api_status=$4 WHERE id=$5',[phoneId,wabaId,metaToken,'conectado',req.user.agenciaId]);
  // Sync plantillas aprobadas de su API propia
  try{ const r=await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?access_token=${metaToken}&limit=100`); const j=await r.json(); if(j.data){ const ap=j.data.filter(t=>t.status==='APPROVED'); await pgPool.query('INSERT INTO plantillas (id,agencia_id,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3',[req.user.agenciaId,req.user.agenciaId,JSON.stringify(ap.length?ap:j.data)]); } }catch{}
  res.json({ok:true,mensaje:'✅ API guardada autonoma para siempre'});
});

// PLANTILLAS APROBADAS
app.get('/api/plantillas',auth,async(req,res)=>{
  const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); let pls=[];
  try{ const {rows}=await pgPool.query('SELECT data FROM plantillas WHERE agencia_id=$1',[req.user.agenciaId]); if(rows[0]){ let d=rows[0].data; pls=typeof d==='string'?JSON.parse(d):d; } }catch{}
  try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=100`); const j=await r.json(); if(j.data?.length){ const ap=j.data.filter(t=>t.status==='APPROVED'); pls=ap.length?ap:j.data; await pgPool.query('INSERT INTO plantillas (id,agencia_id,data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3',[req.user.agenciaId,req.user.agenciaId,JSON.stringify(pls)]); } }catch{}
  if(!pls.length) pls=[{name:'hello_world',status:'APPROVED',language:'es_CO'}]; res.json(pls);
});

// CAMPAÑAS EXCEL CON PAUSA/CONTINUAR + HISTORIAL + SEGMENTACION
app.post('/api/campanas',auth,checkPlan,async(req,res)=>{
  const {nombre,plantilla,numeros}=req.body; const id='camp_'+Date.now(); const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId);
  const validos=[...new Set(numeros.map(n=>n.replace(/\D/g,'')).filter(n=>n.length>=10))]; // segmentacion real
  await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,enviados,estado,pausada,historial,creada) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,req.user.agenciaId,nombre,plantilla,validos.length,0,'activa',false,JSON.stringify([]),Date.now()]);
  // Envio en background con su API propia
  (async()=>{
    for(let i=0;i<validos.length;i++){
      const {rows:campRows}=await pgPool.query('SELECT pausada FROM campanas_klido WHERE id=$1',[id]); if(campRows[0]?.pausada) break;
      try{ await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:validos[i],type:'template',template:{name:plantilla,language:{code:'es_CO'}}})}); await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1 WHERE id=$1',[id]); await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[req.user.agenciaId]); }catch{} await new Promise(r=>setTimeout(r,800));
    }
  })();
  res.json({ok:true,id,total:validos.length,mensaje:`Campaña ${nombre} iniciada con ${validos.length} numeros segmentados`});
});
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true WHERE id=$1 AND agencia_id=$2',[req.params.id,req.user.agenciaId]); res.json({ok:true,mensaje:'Pausada'}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false WHERE id=$1 AND agencia_id=$2',[req.params.id,req.user.agenciaId]); res.json({ok:true,mensaje:'Continuada'}); });
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });

// BANDEJA SEGMENTADA CON ETIQUETA AMARILLA + DATOS + RECORDATORIO ALARMA
app.get('/api/clientes',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM clientes_klido WHERE agencia_id=$1 ORDER BY ultimo_mensaje DESC',[req.user.agenciaId]); res.json(rows); });
app.post('/api/clientes/:id/datos',auth,async(req,res)=>{ const {nombre,datos,etiqueta,estado_embudo,recordatorio,asesor_id}=req.body; await pgPool.query('UPDATE clientes_klido SET nombre=$1,datos=$2,etiqueta=$3,estado_embudo=$4,recordatorio=$5,asesor_id=$6 WHERE id=$7 AND agencia_id=$8',[nombre,JSON.stringify(datos||{}),etiqueta,estado_embudo,recordatorio||null,asesor_id,req.params.id,req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE agencia_id=$1 AND cliente_id=$2 ORDER BY timestamp ASC',[req.user.agenciaId,req.params.clienteId]); res.json(rows); });

// WEBHOOK - Etiqueta amarilla automatica cuando responden campaña
app.post('/webhook',async(req,res)=>{
  try{
    const entry=req.body.entry?.[0]?.changes?.[0]?.value; const msg=entry?.messages?.[0]; if(!msg) return res.sendStatus(200);
    const telefono=msg.from; const phoneId=entry?.metadata?.phone_number_id;
    const {rows:agRows}=await pgPool.query('SELECT id FROM agencias WHERE phone_id=$1 OR id IN (SELECT agencia_id FROM plantillas)',[phoneId]); // busca agencia por phone_id
    const agenciaId=agRows[0]?.id || (await pgPool.query('SELECT id FROM agencias LIMIT 1')).rows[0]?.id;
    const clienteId=`cli_${telefono}`;
    await pgPool.query('INSERT INTO clientes_klido (id,agencia_id,telefono,nombre,etiqueta,estado_embudo,ultimo_mensaje,origen_campana,score) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8) ON CONFLICT (id) DO UPDATE SET ultimo_mensaje=NOW(), etiqueta=$5, score=score+10',[clienteId,agenciaId,telefono,telefono,'respuesta_campana','caliente','campana',80]);
    await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7)',[agenciaId,clienteId,telefono,msg.type,msg.text?.body||msg.type,Date.now(),'entrante']);
  }catch{} res.sendStatus(200);
});
app.get('/webhook',(req,res)=>{ if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']==='klido_verify'){ res.send(req.query['hub.challenge']); } else res.sendStatus(403); });

// DASHBOARD CON ARCHIVOS REPRODUCIBLES
app.get('/api/dashboard',auth,async(req,res)=>{
  const agenciaId=req.user.agenciaId;
  const tot=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[agenciaId]);
  const amarillos=await pgPool.query("SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND etiqueta='respuesta_campana'",[agenciaId]);
  const enviados=await pgPool.query('SELECT COUNT(*) FROM mensajes_klido WHERE agencia_id=$1 AND direccion=$2',[agenciaId,'saliente']);
  const camp=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC LIMIT 5',[agenciaId]);
  res.json({totalClientes:tot.rows[0].count, respuestasAmarillas:amarillos.rows[0].count, enviados:enviados.rows[0].count, campanas:camp.rows, plan: (await pgPool.query('SELECT plan,limite_usado,mantenimiento FROM agencias WHERE id=$1',[agenciaId])).rows[0]});
});

const PORT=process.env.PORT||3000; app.listen(PORT,()=>console.log(`🚀 KLIDO V120 TODO INTEGRADO en ${PORT}`));
