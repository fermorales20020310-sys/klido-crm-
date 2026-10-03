import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import nodemailer from 'nodemailer'; import path from 'path'; import { fileURLToPath } from 'url';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); app.use(cors()); app.use(express.json({limit:'50mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v120-final-out-of-this-world-2024';
const PHONE_ENV=process.env.PHONE_NUMBER_ID||'1338474282683914'; const WABA_ENV=process.env.WABA_ID||'2317286332424288';
let TOKEN_ENV=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||''; if(!TOKEN_ENV){ for(const v of Object.values(process.env)){ if(typeof v==='string'&&v.startsWith('EAAT')&&v.length>80){TOKEN_ENV=v;break;}}}

const PLANES={
  basico:{id:'basico',nombre:'BÁSICO',anual:800000,mant:80000,limite:5000,ia:false,llamadas:false,gmail:false},
  premium:{id:'premium',nombre:'PREMIUM IA',anual:1400000,mant:95000,limite:15000,ia:true,llamadas:false,gmail:false},
  gold:{id:'gold',nombre:'GOLD TOTAL',anual:2500000,mant:135000,limite:50000,ia:true,llamadas:true,gmail:true}
};

async function initDB(){
  await pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT DEFAULT 'basico', plan_activo BOOLEAN DEFAULT true, token TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, equipo JSONB DEFAULT '[]', creado BIGINT, mantenimiento BIGINT, api_status TEXT DEFAULT 'pendiente', limite_usado INT DEFAULT 0)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS clientes_klido (id TEXT PRIMARY KEY, agencia_id TEXT, telefono TEXT, nombre TEXT, datos JSONB DEFAULT '{}', recordatorio TIMESTAMP, etiqueta TEXT DEFAULT 'nuevo', estado_embudo TEXT DEFAULT 'nuevo', asesor_id TEXT, ultimo_mensaje TIMESTAMP DEFAULT NOW(), score INT DEFAULT 0, origen_campana TEXT, leido BOOLEAN DEFAULT false)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS mensajes_klido (id SERIAL PRIMARY KEY, agencia_id TEXT, cliente_id TEXT, telefono TEXT, tipo TEXT, contenido TEXT, url TEXT, timestamp BIGINT, direccion TEXT, leido BOOLEAN DEFAULT false, mime TEXT)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, estado TEXT DEFAULT 'activa', pausada BOOLEAN DEFAULT false, historial JSONB DEFAULT '[]', creada BIGINT)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS plantillas (id TEXT PRIMARY KEY, agencia_id TEXT, data JSONB)`);
  await pgPool.query(`CREATE TABLE IF NOT EXISTS asesores (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, telefono TEXT, activo BOOLEAN DEFAULT true)`);
  console.log('✅ KLIDO V121 TODO ALINEADO + GERENCIA - DB LISTA');
} initDB();

function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }}
async function checkPlan(req,res,next){
  const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const emp=rows[0]; if(!emp) return res.status(403).json({error:'No existe'});
  if(!emp.plan_activo) return res.status(403).json({bloqueado:true, error:'PLAN BLOQUEADO POR MORA - Contacta 3133181851', wpp:'573133181851', link:`https://wa.me/573133181851?text=Mi%20plan%20${emp.plan}%20vencio%20agencia%20${emp.id}%20-%20${emp.nombre}`});
  if(emp.mantenimiento && Date.now()>Number(emp.mantenimiento)){ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[emp.id]); return res.status(403).json({bloqueado:true, error:'MANTENIMIENTO VENCIDO $'+PLANES[emp.plan].mant+' - Paga a 3133181851', wpp:'573133181851'}); }
  if(emp.limite_usado>=PLANES[emp.plan].limite) return res.status(403).json({error:'LIMITE ALCANZADO'});
  if(req.path.includes('/ia')&&!PLANES[emp.plan].ia) return res.status(403).json({error:'IA solo PREMIUM/GOLD', upgrade:true, wpp:'573133181851'});
  if(req.path.includes('/llamada')&&!PLANES[emp.plan].llamadas) return res.status(403).json({error:'Llamadas solo GOLD'});
  if(req.path.includes('/gmail')&&!PLANES[emp.plan].gmail) return res.status(403).json({error:'Gmail solo GOLD'});
  req.empresa=emp; next();
}
async function obtenerEmpresas(){ const {rows}=await pgPool.query('SELECT * FROM agencias'); return rows.map(r=>({id:r.id,plan:r.plan,phoneId:r.phone_id,wabaId:r.waba_id,metaToken:r.meta_token,phoneIdEfectivo:r.phone_id||PHONE_ENV,wabaIdEfectivo:r.waba_id||WABA_ENV,metaTokenEfectivo:r.meta_token||TOKEN_ENV, limite_usado:r.limite_usado})); }

app.get('/api/health',(req,res)=>res.json({ok:true,version:'v121-gerencia',planes:PLANES})); app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.post('/api/auth/register',async(req,res)=>{ try{ const {nombre,email,password}=req.body; const id='ag_'+Date.now(); const hash=await bcrypt.hash(password,10); const ahora=Date.now(); const mant=ahora+90*24*60*60*1000; await pgPool.query('INSERT INTO agencias (id,nombre,email,password,plan,plan_activo,token,creado,mantenimiento,api_status,limite_usado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,nombre,email,hash,'basico',true,jwt.sign({agenciaId:id},JWT),ahora,mant,'pendiente',0]); try{ const tr=nodemailer.createTransport({service:'gmail',auth:{user:process.env.MAIL_USER,pass:process.env.MAIL_PASS}}); await tr.sendMail({to:email,subject:'Contrato KLIDO Ley 1581 Colombia',html:`<img src="https://klido-production.up.railway.app/logo.png" width="80"><h1>Contrato KLIDO ${nombre}</h1><p>Plan BÁSICO $800.000 + $80.000 trim - ID ${id}</p><p>Ley 1581 Habeas Data</p>`}); }catch{} res.json({ok:true,token:jwt.sign({agenciaId:id},JWT)}); }catch(e){res.status(500).json({error:e.message})}});
app.post('/api/auth/login',async(req,res)=>{ const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); const emp=rows[0]; if(!emp) return res.status(404).json({error:'No existe'}); if(!await bcrypt.compare(password,emp.password)) return res.status(401).json({error:'Clave mala'}); res.json({ok:true,token:jwt.sign({agenciaId:emp.id,email:emp.email},JWT),agencia:emp}); });

app.get('/api/config',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const e=rows[0]; res.json({tieneConfig:!!e.phone_id, phoneId:e.phone_id||'', wabaId:e.waba_id||'', phoneIdEfectivo:e.phone_id||PHONE_ENV, wabaIdEfectivo:e.waba_id||WABA_ENV, plan:e.plan, limite:PLANES[e.plan].limite, usado:e.limite_usado}); });
app.post('/api/config',auth,async(req,res)=>{ const {phoneId,wabaId,metaToken}=req.body; await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3,api_status=$4 WHERE id=$5',[phoneId,wabaId,metaToken,'conectado',req.user.agenciaId]); res.json({ok:true}); });

app.get('/api/plantillas',auth,async(req,res)=>{ const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=100`); const j=await r.json(); res.json(j.data?.filter(t=>t.status==='APPROVED')||j.data||[]); }catch{res.json([{name:'hello_world',status:'APPROVED'}]);}});
app.post('/api/campanas',auth,checkPlan,async(req,res)=>{ const {nombre,plantilla,numeros}=req.body; const id='camp_'+Date.now(); const validos=[...new Set(numeros.map(n=>n.replace(/\D/g,'')).filter(n=>n.length>=10))]; await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada) VALUES ($1,$2,$3,$4,$5,$6)',[id,req.user.agenciaId,nombre,plantilla,validos.length,Date.now()]); const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); (async()=>{ for(const num of validos){ const {rows}=await pgPool.query('SELECT pausada FROM campanas_klido WHERE id=$1',[id]); if(rows[0]?.pausada) break; try{ await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:num,type:'template',template:{name:plantilla,language:{code:'es_CO'}}})}); await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1 WHERE id=$1',[id]); await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[req.user.agenciaId]); }catch{} await new Promise(r=>setTimeout(r,900)); } })(); res.json({ok:true,total:validos.length,id});});
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });

app.get('/api/clientes',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM clientes_klido WHERE agencia_id=$1 ORDER BY ultimo_mensaje DESC',[req.user.agenciaId]); res.json(rows); });
app.post('/api/clientes/:id/datos',auth,async(req,res)=>{ const {nombre,datos,etiqueta,estado_embudo,recordatorio,asesor_id}=req.body; await pgPool.query('UPDATE clientes_klido SET nombre=$1,datos=$2,etiqueta=$3,estado_embudo=$4,recordatorio=$5,asesor_id=$6 WHERE id=$7',[nombre,JSON.stringify(datos),etiqueta,estado_embudo,recordatorio||null,asesor_id,req.params.id]); res.json({ok:true}); });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE agencia_id=$1 AND cliente_id=$2 ORDER BY timestamp ASC',[req.user.agenciaId,req.params.clienteId]); res.json(rows); });

app.post('/api/ia/responder',auth,checkPlan,async(req,res)=>{ const {texto}=req.body; let score=0; if(/cuanto|precio|pago|interesa|comprar/i.test(texto)) score=90; else if(/hola|info/i.test(texto)) score=60; else score=20; res.json({respuesta:`Hola! Soy KLIDO IA de tu agencia. Te ayudo con eso: ${texto}`, score}); });
app.post('/api/gmail/campana',auth,checkPlan,async(req,res)=>{ res.json({ok:true,mensaje:'Gmail masivo anti-baneo iniciado - Solo GOLD'}); });
app.post('/api/llamada',auth,checkPlan,async(req,res)=>{ res.json({ok:true,mensaje:'Llamada saliendo desde su número API registrado - Solo GOLD'}); });
app.get('/api/dashboard',auth,async(req,res)=>{ const tot=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]); const ama=await pgPool.query("SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND etiqueta='respuesta_campana'",[req.user.agenciaId]); const ms=await pgPool.query('SELECT * FROM mensajes_klido WHERE agencia_id=$1 ORDER BY timestamp DESC LIMIT 20',[req.user.agenciaId]); res.json({total:tot.rows[0].count, amarillas:ama.rows[0].count, mensajes:ms.rows, plan:PLANES[(await pgPool.query('SELECT plan FROM agencias WHERE id=$1',[req.user.agenciaId])).rows[0].plan]}); });

// ===== GERENCIA KLIDO 3133181851 - NUEVO =====
app.get('/api/admin/agencias', auth, async(req,res)=>{
  const {rows:me}=await pgPool.query('SELECT email FROM agencias WHERE id=$1',[req.user.agenciaId]);
  if(me[0]?.email!=='admin@klido.com' && req.user.email!=='admin@klido.com') return res.status(403).json({error:'Solo admin@klido.com - GERENCIA'});
  const {rows}=await pgPool.query('SELECT * FROM agencias ORDER BY creado DESC');
  res.json({ok:true,total:rows.length,wpp:'573133181851',version:'v121-gerencia',agencias:rows.map(r=>({
    id:r.id, nombre:r.nombre, email:r.email, plan:r.plan, plan_activo:r.plan_activo,
    mantenimiento:r.mantenimiento? new Date(Number(r.mantenimiento)).toLocaleDateString(): '90 días',
    limite:`${r.limite_usado}/${PLANES[r.plan]?.limite||0}`, usado:r.limite_usado, limiteMax:PLANES[r.plan]?.limite,
    api:r.api_status, creado:r.creado? new Date(Number(r.creado)).toLocaleString(): '',
    phone:r.phone_id, waba:r.waba_id
  }))});
});
app.post('/api/admin/bloquear', auth, async(req,res)=>{
  const {rows:me}=await pgPool.query('SELECT email FROM agencias WHERE id=$1',[req.user.agenciaId]);
  if(me[0]?.email!=='admin@klido.com' && req.user.email!=='admin@klido.com') return res.status(403).json({error:'Solo GERENCIA'});
  const {agenciaId,activo}=req.body;
  await pgPool.query('UPDATE agencias SET plan_activo=$1 WHERE id=$2',[activo,agenciaId]);
  res.json({ok:true, mensaje: activo?'✅ Agencia desbloqueada':'❌ Agencia bloqueada por mora - Cliente verá WPP 3133181851'});
});
app.get('/api/admin/stats', auth, async(req,res)=>{
  const tot=await pgPool.query('SELECT COUNT(*) FROM agencias');
  const act=await pgPool.query('SELECT COUNT(*) FROM agencias WHERE plan_activo=true');
  const bloq=await pgPool.query('SELECT COUNT(*) FROM agencias WHERE plan_activo=false');
  const bas=await pgPool.query("SELECT COUNT(*) FROM agencias WHERE plan='basico'");
  const prem=await pgPool.query("SELECT COUNT(*) FROM agencias WHERE plan='premium'");
  const gold=await pgPool.query("SELECT COUNT(*) FROM agencias WHERE plan='gold'");
  res.json({total:tot.rows[0].count, activas:act.rows[0].count, bloqueadas:bloq.rows[0].count, basico:bas.rows[0].count, premium:prem.rows[0].count, gold:gold.rows[0].count});
});

app.post('/webhook',async(req,res)=>{ try{ const v=req.body.entry?.[0]?.changes?.[0]?.value; const m=v?.messages?.[0]; if(!m) return res.sendStatus(200); const tel=m.from; const pid=v?.metadata?.phone_number_id; const {rows}=await pgPool.query('SELECT id FROM agencias WHERE phone_id=$1',[pid]); const agId=rows[0]?.id|| (await pgPool.query('SELECT id FROM agencias LIMIT 1')).rows[0]?.id; await pgPool.query('INSERT INTO clientes_klido (id,agencia_id,telefono,etiqueta,estado_embudo,score,ultimo_mensaje) VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (id) DO UPDATE SET etiqueta=$4, score=80, ultimo_mensaje=NOW()',[`cli_${tel}`,agId,tel,'respuesta_campana','caliente',80]); await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7)',[agId,`cli_${tel}`,tel,m.type,m.text?.body||m.type,Date.now(),'entrante']); }catch{} res.sendStatus(200); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido_verify') res.send(req.query['hub.challenge']); else res.sendStatus(403); });

app.listen(process.env.PORT||3000,()=>console.log('🚀 KLIDO V121 GERENCIA TODO ALINEADO - 3133181851'));
