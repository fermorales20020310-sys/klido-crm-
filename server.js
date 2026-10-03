import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import path from 'path'; import { fileURLToPath } from 'url';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); app.use(cors()); app.use(express.json({limit:'100mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v126-resend-debug-2026-3133181851';
const PHONE_ENV=process.env.PHONE_NUMBER_ID||'1338474282683914'; const WABA_ENV=process.env.WABA_ID||'2317286332424288';
let TOKEN_ENV=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||''; if(!TOKEN_ENV){ for(const v of Object.values(process.env)){ if(typeof v==='string'&&v.startsWith('EAAT')&&v.length>80){TOKEN_ENV=v;break;}}}
const PLANES={basico:{id:'basico',nombre:'BÁSICO',anual:800000,mant:80000,limite:5000,ia:false,llamadas:false,gmail:false,usuarios:3},premium:{id:'premium',nombre:'PREMIUM + IA',anual:1400000,mant:95000,limite:15000,ia:true,llamadas:false,gmail:false,usuarios:10},gold:{id:'gold',nombre:'GOLD TOTAL',anual:2500000,mant:135000,limite:50000,ia:true,llamadas:true,gmail:true,usuarios:999}};
async function initDB(){
await pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT DEFAULT 'basico', plan_activo BOOLEAN DEFAULT true, token TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, equipo JSONB DEFAULT '[]', creado BIGINT, mantenimiento BIGINT, api_status TEXT DEFAULT 'pendiente', limite_usado INT DEFAULT 0, contrato_firmado BOOLEAN DEFAULT false)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS clientes_klido (id TEXT PRIMARY KEY, agencia_id TEXT, telefono TEXT, nombre TEXT, datos JSONB DEFAULT '{}', recordatorio TIMESTAMP, etiqueta TEXT DEFAULT 'nuevo', estado_embudo TEXT DEFAULT 'nuevo', asesor_id TEXT, ultimo_mensaje TIMESTAMP DEFAULT NOW(), score INT DEFAULT 0, origen_campana TEXT, leido BOOLEAN DEFAULT false, email TEXT, direccion TEXT, notas TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS mensajes_klido (id SERIAL PRIMARY KEY, agencia_id TEXT, cliente_id TEXT, telefono TEXT, tipo TEXT, contenido TEXT, url TEXT, timestamp BIGINT, direccion TEXT, leido BOOLEAN DEFAULT false, mime TEXT, media_id TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', pausada BOOLEAN DEFAULT false, historial JSONB DEFAULT '[]', creada BIGINT, terminada BIGINT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS asesores (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, telefono TEXT, email TEXT, activo BOOLEAN DEFAULT true)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS logs_gmail (id SERIAL PRIMARY KEY, agencia_id TEXT, destinatario TEXT, asunto TEXT, estado TEXT, timestamp BIGINT)`);
console.log('✅ KLIDO V126 RESEND DEBUG - DB LISTA - soporte@klidoapp.com.co - 3133181851');
} initDB();
function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }}
async function checkPlan(req,res,next){
const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const emp=rows[0]; if(!emp) return res.status(403).json({error:'No existe'});
if(!emp.plan_activo) return res.status(403).json({bloqueado:true, error:'PLAN BLOQUEADO POR MORA - Contacta 3133181851', wpp:'573133181851', link:`https://wa.me/573133181851?text=Mi%20plan%20${emp.plan}%20vencio%20agencia%20${emp.id}`});
if(emp.mantenimiento && Date.now()>Number(emp.mantenimiento)){ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[emp.id]); return res.status(403).json({bloqueado:true, error:'MANTENIMIENTO VENCIDO $'+PLANES[emp.plan].mant, wpp:'573133181851'}); }
if(emp.limite_usado>=PLANES[emp.plan].limite) return res.status(403).json({error:'LIMITE ALCANZADO'});
if(req.path.includes('/ia')&&!PLANES[emp.plan].ia) return res.status(403).json({error:'IA solo PREMIUM/GOLD', upgrade:true, wpp:'573133181851'});
if(req.path.includes('/llamada')&&!PLANES[emp.plan].llamadas) return res.status(403).json({error:'Llamadas solo GOLD'});
if(req.path.includes('/gmail')&&!PLANES[emp.plan].gmail) return res.status(403).json({error:'Gmail solo GOLD'});
req.empresa=emp; next();
}
async function obtenerEmpresas(){ const {rows}=await pgPool.query('SELECT * FROM agencias'); return rows.map(r=>({id:r.id,plan:r.plan,phoneId:r.phone_id,wabaId:r.waba_id,metaToken:r.meta_token,phoneIdEfectivo:r.phone_id||PHONE_ENV,wabaIdEfectivo:r.waba_id||WABA_ENV,metaTokenEfectivo:r.meta_token||TOKEN_ENV})); }

const codigosTemp = new Map();

async function enviarMail(para,asunto,html){
 try{
  const RESEND_KEY = process.env.RESEND_API_KEY;
  let FROM = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
  console.log('--- RESEND DEBUG ---');
  console.log('FROM env:',FROM);
  console.log('TO:',para);
  console.log('KEY exists:',!!RESEND_KEY,' startsWith re_:',RESEND_KEY?.startsWith('re_'));
  if(!RESEND_KEY){ console.error('❌ FALTA RESEND_API_KEY'); return {error:'Falta RESEND_API_KEY - Configura en Railway Variables'}; }

  // Intento 1 con tu dominio
  let r = await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:FROM,to:para,subject:asunto,html})});
  let j = await r.json();
  console.log('Resend intento 1 status:',r.status,' body:',JSON.stringify(j));

  // Si falla por dominio no verificado, fallback automatico a onboarding@resend.dev para que SI llegue hoy
  if(j.error && (JSON.stringify(j.error).toLowerCase().includes('domain') || JSON.stringify(j.error).toLowerCase().includes('verify') || r.status===422)){
    console.log('⚠️ Dominio no verificado, haciendo fallback a onboarding@resend.dev para que llegue HOY');
    FROM = 'KLIDO <onboarding@resend.dev>';
    r = await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:FROM,to:para,subject:asunto,html})});
    j = await r.json();
    console.log('Resend fallback status:',r.status,' body:',JSON.stringify(j));
  }

  if(j.error){ console.error('❌ Resend error final:',j.error); return {error:j.error, status:r.status}; }
  console.log('✅ Resend OK id',j.id,' to',para,' from',FROM);
  return j;
 }catch(e){ console.error('❌ enviarMail exception',e); return {error:e.message}; }
}

// ENDPOINT DEBUG - entra a /api/debug/resend para ver error real
app.get('/api/debug/resend', async(req,res)=>{
  const key = process.env.RESEND_API_KEY? 'SI existe '+process.env.RESEND_API_KEY.substring(0,6)+'...' : 'NO EXISTE RESEND_API_KEY';
  const from = process.env.RESEND_FROM || 'NO SET';
  const testTo = req.query.to || 'fermorales20020310@gmail.com';
  try{
    const test = await enviarMail(testTo,'KLIDO TEST RESEND '+Date.now(),`<h1>Test KLIDO ${Date.now()}</h1><p>FROM: ${from}</p><p>Si ves esto, Resend OK. Si usas onboarding@resend.dev es porque tu dominio klidoapp.com.co aun no esta verificado en resend.com/domains</p><p>Soporte 3133181851</p>`);
    res.json({ok:true,key,from,to:testTo,test, instruccion:'Si test.error contiene Domain not verified, ve a resend.com/domains y verifica klidoapp.com.co con los TXT DKIM. Mientras tanto el sistema usa onboarding@resend.dev automatico para que SI llegue'});
  }catch(e){ res.json({ok:false,key,from,error:e.message}); }
});

app.get('/api/health',(req,res)=>res.json({ok:true,version:'v126-resend-debug-fallback-onboarding',planes:PLANES,wpp:'573133181851',resend_from:process.env.RESEND_FROM||'KLIDO <soporte@klidoapp.com.co>',has_key:!!process.env.RESEND_API_KEY}));
app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.post('/api/auth/register-init', async(req,res)=>{
try{
const {nombre,email,password,plan}=req.body;
if(!nombre||!email||!password) return res.status(400).json({error:'Faltan nombre, correo y contraseña'});
const {rows}=await pgPool.query('SELECT email FROM agencias WHERE email=$1',[email]);
if(rows[0]) return res.status(400).json({error:'Ya existe agencia con ese correo - Si olvidaste clave usa Recuperar'});
const codigo=Math.floor(100000+Math.random()*900000).toString();
codigosTemp.set(email,{codigo,expira:Date.now()+30*60*1000,datos:{nombre,email,password,plan:plan||'basico'},intentos:0});
const resMail = await enviarMail(email,`KLIDO - Código activación Plan ${(plan||'basico').toUpperCase()} - ${codigo}`, `<div style="font-family:Arial;padding:20px;background:#f8fafc"><div style="background:white;padding:20px;border-radius:14px;border:1px solid #e2e8f0"><img src="https://klido-production.up.railway.app/logo.png" width="80" style="background:#0a1931;border-radius:12px;padding:8px"><h2 style="color:#0a1931">KLIDO AVANZA - Activación</h2><p>Hola <b>${nombre}</b>, plan <b>${(plan||'basico').toUpperCase()} $${PLANES[plan||'basico']?.anual}</b> + trim $${PLANES[plan||'basico']?.mant}</p><p style="font-size:36px;font-weight:900;letter-spacing:10px;background:#eef5ff;padding:14px 22px;border-radius:12px;color:#1e40af;border:2px dashed #2563eb;text-align:center">${codigo}</p><p>Ingresa en klido-production.up.railway.app campo Código activación. Vence 30 min. Soporte 3133181851<br>Desde ${process.env.RESEND_FROM||'soporte@klidoapp.com.co'} vía Resend</p></div></div>`);
if(resMail?.error) return res.status(500).json({error:'Error Resend: '+JSON.stringify(resMail.error)+' - Ve a /api/debug/resend?to='+email+' para ver detalle. Si dice Domain not verified, verifica klidoapp.com.co en resend.com/domains o deja RESEND_FROM=KLIDO <onboarding@resend.dev> temporal'});
res.json({ok:true,mensaje:'Código enviado desde '+(process.env.RESEND_FROM||'soporte@klidoapp.com.co')+' a '+email+' - Revisa spam y bandeja - Si no llega revisa /api/debug/resend'});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/auth/register-verify', async(req,res)=>{
try{
const {email,codigo}=req.body; const t=codigosTemp.get(email); if(!t) return res.status(400).json({error:'No hay código solicitado - Solicita nuevo'});
if(Date.now()>t.expira){codigosTemp.delete(email); return res.status(400).json({error:'Código vencido - Solicita nuevo 3133181851'});}
if(t.codigo!==codigo){t.intentos++; if(t.intentos>=5){codigosTemp.delete(email); return res.status(400).json({error:'Bloqueado 5 intentos - Solicita nuevo'});} return res.status(400).json({error:'Código inválido - Te quedan '+(5-t.intentos)});}
const {nombre,password,plan}=t.datos; const id='ag_'+Date.now(); const hash=await bcrypt.hash(password,10); const ahora=Date.now(); const mant=ahora+90*24*60*60*1000;
await pgPool.query('INSERT INTO agencias (id,nombre,email,password,plan,plan_activo,token,creado,mantenimiento,api_status,limite_usado,contrato_firmado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,nombre,email,hash,plan||'basico',true,jwt.sign({agenciaId:id,email},JWT),ahora,mant,'pendiente',0,true]);
await enviarMail(email,`Contrato KLIDO Ley 1581 - ${nombre} - ${plan}`, `<div><h1>Contrato KLIDO ${nombre} ID ${id}</h1><p>Plan ${plan} Anual $${PLANES[plan]?.anual} + Trim $${PLANES[plan]?.mant}</p><p>Ley 1581 Habeas Data - Soporte 3133181851 - soporte@klidoapp.com.co</p></div>`);
codigosTemp.delete(email); res.json({ok:true,token:jwt.sign({agenciaId:id,email},JWT),agencia:{id,nombre,email,plan}});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/auth/login',async(req,res)=>{
try{
const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); const emp=rows[0]; if(!emp) return res.status(404).json({error:'No existe agencia con ese correo'});
if(!await bcrypt.compare(password,emp.password)) return res.status(401).json({error:'Clave mala - Usa ¿Olvidaste?'});
if(!emp.plan_activo) return res.status(403).json({bloqueado:true, error:'🚫 PLAN BLOQUEADO POR MORA - Agencia '+emp.nombre+' - Contacta 3133181851', wpp:'573133181851', link:`https://wa.me/573133181851?text=Hola%20soy%20${encodeURIComponent(emp.nombre)}%20mi%20plan%20${emp.plan}%20bloqueado%20${emp.id}`});
if(emp.mantenimiento && Date.now()>Number(emp.mantenimiento)){ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[emp.id]); return res.status(403).json({bloqueado:true, error:'MANTENIMIENTO VENCIDO $'+PLANES[emp.plan].mant+' - Paga 3133181851', wpp:'573133181851'}); }
res.json({ok:true,token:jwt.sign({agenciaId:emp.id,email:emp.email},JWT),agencia:emp});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/auth/forgot', async(req,res)=>{
try{
const {email}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); if(!rows[0]) return res.status(404).json({error:'No existe agencia con ese correo'});
const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosTemp.set(email,{codigo,expira:Date.now()+15*60*1000,intentos:0,datos:{email}});
await enviarMail(email,'KLIDO - Código recuperación '+codigo, `<div style="font-family:Arial;padding:20px"><p>Código recuperación KLIDO: <b style="font-size:32px;letter-spacing:8px;background:#eef5ff;padding:10px 18px;border-radius:10px;border:2px dashed #2563eb">${codigo}</b></p><p>Vence 15 min - Soporte 3133181851 - soporte@klidoapp.com.co</p></div>`);
res.json({ok:true,mensaje:'Código enviado desde '+(process.env.RESEND_FROM||'soporte@klidoapp.com.co')+' a '+email});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/auth/reset', async(req,res)=>{
try{
const {email,codigo,password}=req.body; const t=codigosTemp.get(email); if(!t||t.codigo!==codigo||Date.now()>t.expira) return res.status(400).json({error:'Código inválido o vencido'});
const hash=await bcrypt.hash(password,10); await pgPool.query('UPDATE agencias SET password=$1 WHERE email=$2',[hash,email]); codigosTemp.delete(email);
res.json({ok:true,mensaje:'Contraseña actualizada'});
}catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/config',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const e=rows[0]; res.json({tieneConfig:!!e.phone_id, phoneId:e.phone_id||'', wabaId:e.waba_id||'', phoneIdEfectivo:e.phone_id||PHONE_ENV, wabaIdEfectivo:e.waba_id||WABA_ENV, plan:e.plan, limite:PLANES[e.plan].limite, usado:e.limite_usado, mantenimiento:e.mantenimiento?new Date(Number(e.mantenimiento)).toLocaleDateString():'90 días', api_status:e.api_status}); });
app.post('/api/config',auth,async(req,res)=>{ const {phoneId,wabaId,metaToken}=req.body; if(!phoneId||!wabaId) return res.status(400).json({error:'Falta Phone y WABA'}); await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3,api_status=$4 WHERE id=$5',[phoneId,wabaId,metaToken||TOKEN_ENV,'conectado',req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/plantillas',auth,async(req,res)=>{
const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId);
try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=200`); const j=await r.json(); if(j.error) throw j.error; res.json(j.data?.filter(t=>t.status==='APPROVED')||j.data||[]); }catch(e){ res.json([{name:'hello_world',status:'APPROVED'}]); }
});
app.post('/api/campanas',auth,checkPlan,async(req,res)=>{
try{
const {nombre,plantilla,numeros}=req.body; if(!plantilla||!numeros?.length) return res.status(400).json({error:'Falta plantilla y números'});
const id='camp_'+Date.now(); const validos=[...new Set(numeros.map(n=>n.replace(/\D/g,'')).filter(n=>n.length>=10))];
await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada,historial) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,req.user.agenciaId,nombre||'Campaña '+(new Date().toLocaleDateString()),plantilla,validos.length,Date.now(),JSON.stringify([{accion:'creada',fecha:Date.now(),total:validos.length}])]);
const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId);
(async()=>{
for(let i=0;i<validos.length;i++){ const num=validos[i]; const {rows}=await pgPool.query('SELECT pausada FROM campanas_klido WHERE id=$1',[id]); if(rows[0]?.pausada){ await pgPool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['pausada',id]); break; }
try{ const resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:num,type:'template',template:{name:plantilla,language:{code:'es_CO'}}}),}); const jr=await resp.json(); if(jr.error) throw jr.error; await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1 WHERE id=$1',[id]); await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[req.user.agenciaId]); await pgPool.query(`INSERT INTO clientes_klido (id,agencia_id,telefono,origen_campana,etiqueta,estado_embudo) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,[`cli_${num}`,req.user.agenciaId,num,id,'nuevo','nuevo']); }catch(e){ await pgPool.query('UPDATE campanas_klido SET fallidos=fallidos+1 WHERE id=$1',[id]); } await new Promise(r=>setTimeout(r,900)); }
await pgPool.query('UPDATE campanas_klido SET estado=$1,terminada=$2 WHERE id=$3',['terminada',Date.now(),id]);
})();
res.json({ok:true,total:validos.length,id,mensaje:'Campaña '+validos.length+' iniciada - Pausa/continuar disponible'});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true,estado=$1 WHERE id=$2',['pausada',req.params.id]); res.json({ok:true,mensaje:'⏸️ Campaña pausada'}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false,estado=$1 WHERE id=$2',['activa',req.params.id]); res.json({ok:true,mensaje:'▶️ Campaña continuada'}); });
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });
app.get('/api/clientes',auth,async(req,res)=>{
const {filtro,asesor}=req.query; let q='SELECT * FROM clientes_klido WHERE agencia_id=$1'; const params=[req.user.agenciaId];
if(filtro==='amarillas'){ q+=' AND etiqueta=$2'; params.push('respuesta_campana'); }
if(asesor){ q+=` AND asesor_id=$${params.length+1}`; params.push(asesor); }
q+=' ORDER BY CASE WHEN etiqueta=$'+(params.length+1)+' THEN 0 ELSE 1 END, ultimo_mensaje DESC'; params.push('respuesta_campana');
const {rows}=await pgPool.query(q,params); res.json(rows);
});
app.post('/api/clientes/:id/datos',auth,async(req,res)=>{
const {nombre,datos,etiqueta,estado_embudo,recordatorio,asesor_id,email,direccion,notas}=req.body;
await pgPool.query('UPDATE clientes_klido SET nombre=$1,datos=$2,etiqueta=$3,estado_embudo=$4,recordatorio=$5,asesor_id=$6,email=$7,direccion=$8,notas=$9 WHERE id=$10 AND agencia_id=$11',[nombre||null,JSON.stringify(datos||{}),etiqueta||'nuevo',estado_embudo||'nuevo',recordatorio||null,asesor_id||null,email||null,direccion||null,notas||null,req.params.id,req.user.agenciaId]);
res.json({ok:true});
});
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE agencia_id=$1 AND cliente_id=$2 ORDER BY timestamp ASC',[req.user.agenciaId,req.params.clienteId]); res.json(rows); });
app.post('/api/mensajes/:clienteId',auth,checkPlan,async(req,res)=>{
const {contenido,tipo,url}=req.body; const clienteId=req.params.clienteId;
const {rows:cl}=await pgPool.query('SELECT telefono FROM clientes_klido WHERE id=$1',[clienteId]); if(!cl[0]) return res.status(404).json({error:'Cliente no existe'});
const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId);
try{
const payload={messaging_product:'whatsapp',to:cl[0].telefono,type:tipo||'text',...(tipo==='text'?{text:{body:contenido}}:{})};
const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify(payload)});
const j=await r.json(); if(j.error) throw j.error;
await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,url,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[req.user.agenciaId,clienteId,cl[0].telefono,tipo||'text',contenido,url||'',Date.now(),'saliente']);
await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[req.user.agenciaId]);
res.json({ok:true});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/ia/responder',auth,checkPlan,async(req,res)=>{
try{
const {texto,clienteId}=req.body; let score=20, etiqueta='nuevo';
if(/cuanto|precio|pago|interesa|comprar|cuesta|valor|orden|pedido/i.test(texto)){ score=90; etiqueta='caliente'; }
else if(/hola|info|informacion|quisiera|saber/i.test(texto)){ score=65; etiqueta='respuesta_campana'; }
else if(/no|gracias/i.test(texto)){ score=10; etiqueta='frio'; }
if(clienteId){ await pgPool.query('UPDATE clientes_klido SET score=$1,etiqueta=$2 WHERE id=$3',[score,etiqueta,clienteId]); }
res.json({respuesta:`Hola! Soy KLIDO IA. Vi: "${texto}". Score ${score}. ¿Asigno asesor?`, score, etiqueta});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/gmail/campana',auth,checkPlan,async(req,res)=>{
try{
const {asunto,html,destinatarios}=req.body; if(!destinatarios?.length) return res.status(400).json({error:'Falta lista'});
let enviados=0;
for(const dest of destinatarios){
try{ await enviarMail(dest,asunto,html); await pgPool.query('INSERT INTO logs_gmail (agencia_id,destinatario,asunto,estado,timestamp) VALUES ($1,$2,$3,$4,$5)',[req.user.agenciaId,dest,asunto,'enviado',Date.now()]); enviados++; }catch{ await pgPool.query('INSERT INTO logs_gmail (agencia_id,destinatario,asunto,estado,timestamp) VALUES ($1,$2,$3,$4,$5)',[req.user.agenciaId,dest,asunto,'fallido',Date.now()]); }
await new Promise(r=>setTimeout(r, 1200 + Math.random()*1800));
}
res.json({ok:true,enviados,mensaje:`Gmail anti-baneo via Resend: ${enviados}/${destinatarios.length}`});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/llamada',auth,checkPlan,async(req,res)=>{
const {telefono}=req.body; const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId);
res.json({ok:true,mensaje:`📞 Llamada desde tu número API ${emp.phoneIdEfectivo} a ${telefono} - Solo GOLD - Requiere Calling API habilitado`});
});
app.get('/api/dashboard',auth,async(req,res)=>{
try{
const tot=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]);
const ama=await pgPool.query("SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND etiqueta='respuesta_campana'",[req.user.agenciaId]);
const cal=await pgPool.query("SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND etiqueta='caliente'",[req.user.agenciaId]);
const ven=await pgPool.query("SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND estado_embudo='cerrado'",[req.user.agenciaId]);
const ms=await pgPool.query('SELECT * FROM mensajes_klido WHERE agencia_id=$1 ORDER BY timestamp DESC LIMIT 30',[req.user.agenciaId]);
const camps=await pgPool.query('SELECT COUNT(*) FROM campanas_klido WHERE agencia_id=$1',[req.user.agenciaId]);
const {rows:ag}=await pgPool.query('SELECT plan,limite_usado,mantenimiento FROM agencias WHERE id=$1',[req.user.agenciaId]);
res.json({total:tot.rows[0].count, amarillas:ama.rows[0].count, calientes:cal.rows[0].count, vendidos:ven.rows[0].count, mensajes:ms.rows, campanas:camps.rows[0].count, plan:PLANES[ag[0].plan], usado:ag[0].limite_usado});
}catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/asesores',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM asesores WHERE agencia_id=$1',[req.user.agenciaId]); res.json(rows); });
app.post('/api/asesores',auth,async(req,res)=>{ const id='as_'+Date.now(); const {nombre,telefono,email}=req.body; await pgPool.query('INSERT INTO asesores (id,agencia_id,nombre,telefono,email) VALUES ($1,$2,$3,$4,$5)',[id,req.user.agenciaId,nombre,telefono,email]); res.json({ok:true,id}); });
app.get('/api/admin/agencias', auth, async(req,res)=>{
try{
const {rows:me}=await pgPool.query('SELECT email FROM agencias WHERE id=$1',[req.user.agenciaId]);
if(me[0]?.email!=='admin@klido.com' && req.user.email!=='admin@klido.com') return res.status(403).json({error:'Solo admin@klido.com - GERENCIA 3133181851'});
const {rows}=await pgPool.query('SELECT * FROM agencias ORDER BY creado DESC');
res.json({ok:true,total:rows.length,wpp:'573133181851',version:'v126-debug',agencias:rows.map(r=>({id:r.id,nombre:r.nombre,email:r.email,plan:r.plan,plan_activo:r.plan_activo,mantenimiento:r.mantenimiento? new Date(Number(r.mantenimiento)).toLocaleDateString():'90 días',limite:`${r.limite_usado||0}/${PLANES[r.plan]?.limite||0}`,usado:r.limite_usado,api:r.api_status,creado:r.creado? new Date(Number(r.creado)).toLocaleString():'',phone:r.phone_id,waba:r.waba_id}))});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/admin/bloquear', auth, async(req,res)=>{
const {rows:me}=await pgPool.query('SELECT email FROM agencias WHERE id=$1',[req.user.agenciaId]);
if(me[0]?.email!=='admin@klido.com' && req.user.email!=='admin@klido.com') return res.status(403).json({error:'Solo GERENCIA'});
const {agenciaId,activo,motivo}=req.body; await pgPool.query('UPDATE agencias SET plan_activo=$1 WHERE id=$2',[activo,agenciaId]);
res.json({ok:true,mensaje: activo?'✅ Desbloqueada':'❌ Bloqueada por mora: '+(motivo||'Mora')+' - WPP 3133181851'});
});
app.get('/api/admin/stats', auth, async(req,res)=>{
const tot=await pgPool.query('SELECT COUNT(*) FROM agencias'); const act=await pgPool.query('SELECT COUNT(*) FROM agencias WHERE plan_activo=true'); const bloq=await pgPool.query('SELECT COUNT(*) FROM agencias WHERE plan_activo=false');
const bas=await pgPool.query("SELECT COUNT(*) FROM agencias WHERE plan='basico'"); const prem=await pgPool.query("SELECT COUNT(*) FROM agencias WHERE plan='premium'"); const gold=await pgPool.query("SELECT COUNT(*) FROM agencias WHERE plan='gold'");
res.json({total:tot.rows[0].count,activas:act.rows[0].count,bloqueadas:bloq.rows[0].count,basico:bas.rows[0].count,premium:prem.rows[0].count,gold:gold.rows[0].count,wpp:'573133181851'});
});
app.post('/webhook',async(req,res)=>{
try{
const body=req.body; const entry=body.entry?.[0]; const value=entry?.changes?.[0]?.value; const messages=value?.messages; const metadata=value?.metadata;
if(!messages?.[0]) return res.sendStatus(200);
const m=messages[0]; const tel=m.from; const pid=metadata?.phone_number_id;
let agId=null; if(pid){ const {rows}=await pgPool.query('SELECT id FROM agencias WHERE phone_id=$1',[pid]); agId=rows[0]?.id; }
if(!agId){ const {rows}=await pgPool.query('SELECT id FROM agencias LIMIT 1'); agId=rows[0]?.id; }
let score=70, etiqueta='respuesta_campana'; const texto=m.text?.body||'';
if(/cuanto|precio|pago|interesa|comprar|cuesta|valor/i.test(texto)){ score=90; etiqueta='caliente'; }
await pgPool.query(`INSERT INTO clientes_klido (id,agencia_id,telefono,etiqueta,estado_embudo,score,ultimo_mensaje,origen_campana) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7) ON CONFLICT (id) DO UPDATE SET etiqueta=$4, score=GREATEST(clientes_klido.score,$6), ultimo_mensaje=NOW(), leido=false`,[`cli_${tel}`,agId,tel,etiqueta,'contactado',score,'webhook_respuesta']);
await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion,leido) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[agId,`cli_${tel}`,tel,m.type||'text',texto||m.type||'media',Date.now(),'entrante',false]);
}catch(e){} res.sendStatus(200);
});
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido_verify') res.send(req.query['hub.challenge']); else res.sendStatus(403); });
app.get('/admin.html',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/crm.html',(req,res)=>res.sendFile(path.join(__dirname,'public','crm.html')));
app.get('/campanas.html',(req,res)=>res.sendFile(path.join(__dirname,'public','campanas.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 KLIDO V126 RESEND DEBUG + FALLBACK onboarding@resend.dev - LOGO 96px + KLIDO 30px + TODO INTEGRADO - ${PORT}`));
