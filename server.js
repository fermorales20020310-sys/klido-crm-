import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import path from 'path'; import { fileURLToPath } from 'url';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); app.use(cors()); app.use(express.json({limit:'100mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v127-resend-force-2026-3133181851';
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
console.log('✅ KLIDO V127 RESEND FORCE FALLBACK - DB LISTA - soporte@klidoapp.com.co - 3133181851');
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

// V127 - RESEND QUE SI LLEGA - 3 intentos forzados
async function enviarMail(para,asunto,html){
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const ENV_FROM = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
  if(!RESEND_KEY){ console.error('❌ FALTA RESEND_API_KEY en Railway Variables'); return {error:'Falta RESEND_API_KEY - Configura en Railway Variables'}; }
  const intentosFROM = [ENV_FROM, 'KLIDO <onboarding@resend.dev>', 'onboarding@resend.dev'];
  for(let i=0;i<intentosFROM.length;i++){
    const FROM = intentosFROM[i];
    try{
      console.log(`--- RESEND intento ${i+1}/3 FROM=${FROM} TO=${para} ---`);
      const r = await fetch('https://api.resend.com/emails',{
        method:'POST',
        headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({from:FROM,to:para,subject:asunto,html})
      });
      const j = await r.json();
      console.log(`Resend intento ${i+1} status ${r.status} body ${JSON.stringify(j).slice(0,600)}`);
      if(!j.error){
        console.log(`✅ Resend OK id ${j.id} FROM ${FROM} TO ${para}`);
        return j;
      }
      // si falla, sigue al siguiente FROM
      console.log(`⚠️ Falló intento ${i+1}, probando siguiente...`);
      if(i < intentosFROM.length-1) continue;
      return {error:j.error, status:r.status};
    }catch(e){
      console.error(`❌ intento ${i+1} exception`,e.message);
      if(i==intentosFROM.length-1) return {error:e.message};
    }
  }
}

app.get('/api/debug/resend', async(req,res)=>{
  const key = process.env.RESEND_API_KEY? 'SI existe '+process.env.RESEND_API_KEY.substring(0,8)+'...' : 'NO EXISTE RESEND_API_KEY';
  const from = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
  const to = req.query.to || 'delivered@resend.dev';
  try{
    const test = await enviarMail(to,'KLIDO TEST RESEND '+Date.now(),`<div style="font-family:Arial;padding:20px"><h1>KLIDO TEST ${Date.now()}</h1><p>FROM env: ${from}</p><p>Si ves esto, Resend OK</p><p>Soporte 3133181851</p></div>`);
    res.json({ok:!test?.error,key,from,to,test,instruccion:'Si test.error dice testing emails only to own address, prueba to= tu email de cuenta resend.com o verifica dominio klidoapp.com.co en resend.com/domains - delivered@resend.dev siempre funciona'});
  }catch(e){ res.json({ok:false,key,from,error:e.message}); }
});

app.get('/api/health',(req,res)=>res.json({ok:true,version:'v127-resend-force-fallback-onboarding',planes:PLANES,wpp:'573133181851',has_key:!!process.env.RESEND_API_KEY,resend_from:process.env.RESEND_FROM||'KLIDO <soporte@klidoapp.com.co>'}));
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
const resMail = await enviarMail(email,`KLIDO - Código activación ${codigo} - Plan ${(plan||'basico').toUpperCase()}`, `<div style="font-family:Arial;padding:20px;background:#f8fafc"><div style="background:white;padding:20px;border-radius:14px;border:1px solid #e2e8f0"><img src="https://klido-production.up.railway.app/logo.png" width="80" style="background:#0a1931;border-radius:12px;padding:8px"><h2 style="color:#0a1931">KLIDO AVANZA - Activación</h2><p>Hola <b>${nombre}</b>, plan <b>${(plan||'basico').toUpperCase()} $${PLANES[plan||'basico']?.anual}</b> + trim $${PLANES[plan||'basico']?.mant}</p><p style="font-size:36px;font-weight:900;letter-spacing:10px;background:#eef5ff;padding:14px 22px;border-radius:12px;color:#1e40af;border:2px dashed #2563eb;text-align:center">${codigo}</p><p>Ingresa en app.klidoapp.com.co campo Código activación. Vence 30 min. Soporte 3133181851</p></div></div>`);
if(resMail?.error) return res.status(500).json({error:'Resend error: '+JSON.stringify(resMail.error)+' - Ve a /api/debug/resend?to='+email});
res.json({ok:true,mensaje:'Código enviado a '+email+' desde soporte@klidoapp.com.co - Revisa spam'});
}catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/auth/register-verify', async(req,res)=>{
try{
const {email,codigo}=req.body; const t=codigosTemp.get(email); if(!t) return res.status(400).json({error:'No hay código solicitado - Solicita nuevo'});
if(Date.now()>t.expira){codigosTemp.delete(email); return res.status(400).json({error:'Código vencido - Solicita nuevo 3133181851'});}
if(t.codigo!==codigo){t.intentos++; if(t.intentos>=5){codigosTemp.delete(email); return res.status(400).json({error:'Bloqueado 5 intentos - Solicita nuevo'});} return res.status(400).json({error:'Código inválido - Te quedan '+(5-t.intentos)});}
const {nombre,password,plan}=t.datos; const id='ag_'+Date.now(); const hash=await bcrypt.hash(password,10); const ahora=Date.now(); const mant=ahora+90*24*60*60*1000;
await pgPool.query('INSERT INTO agencias (id,nombre,email,password,plan,plan_activo,token,creado,mantenimiento,api_status,limite_usado,contrato_firmado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,nombre,email,hash,plan||'basico',true,jwt.sign({agenciaId:id,email},JWT),ahora,mant,'pendiente',0,true]);
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
await enviarMail(email,'KLIDO - Código recuperación '+codigo, `<div style="font-family:Arial;padding:20px"><p>Código recuperación KLIDO: <b style="font-size:32px;letter-spacing:8px;background:#eef5ff;padding:10px 18px;border-radius:10px;border:2px dashed #2563eb">${codigo}</b></p><p>Vence 15 min - Soporte 3133181851</p></div>`);
res.json({ok:true,mensaje:'Código enviado a '+email});
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
app.get('/api/plantillas',auth,async(req,res)=>{ const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=200`); const j=await r.json(); if(j.error) throw j.error; res.json(j.data?.filter(t=>t.status==='APPROVED')||j.data||[]); }catch(e){ res.json([{name:'hello_world',status:'APPROVED'}]); }});
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
res.json({ok:true,total:validos.length,id,mensaje:'Campaña '+validos.length+' iniciada'});
}catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true,estado=$1 WHERE id=$2',['pausada',req.params.id]); res.json({ok:true,mensaje:'⏸️ Pausada'}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false,estado=$1 WHERE id=$2',['activa',req.params.id]); res.json({ok:true,mensaje:'▶️ Continuada'}); });
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });
app.get('/api/clientes',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM clientes_klido WHERE agencia_id=$1 ORDER BY ultimo_mensaje DESC',[req.user.agenciaId]); res.json(rows); });
app.post('/api/clientes/:id/datos',auth,async(req,res)=>{ const {nombre,etiqueta}=req.body; await pgPool.query('UPDATE clientes_klido SET nombre=$1,etiqueta=$2 WHERE id=$3 AND agencia_id=$4',[nombre||null,etiqueta||'nuevo',req.params.id,req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE agencia_id=$1 AND cliente_id=$2 ORDER BY timestamp ASC',[req.user.agenciaId,req.params.clienteId]); res.json(rows); });
app.post('/api/mensajes/:clienteId',auth,checkPlan,async(req,res)=>{ const {contenido}=req.body; const clienteId=req.params.clienteId; const {rows:cl}=await pgPool.query('SELECT telefono FROM clientes_klido WHERE id=$1',[clienteId]); if(!cl[0]) return res.status(404).json({error:'Cliente no existe'}); const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:cl[0].telefono,type:'text',text:{body:contenido}})}); const j=await r.json(); if(j.error) throw j.error; await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7)',[req.user.agenciaId,clienteId,cl[0].telefono,'text',contenido,Date.now(),'saliente']); await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[req.user.agenciaId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/dashboard',auth,async(req,res)=>{ try{ const tot=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]); const ama=await pgPool.query("SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND etiqueta='respuesta_campana'",[req.user.agenciaId]); res.json({total:tot.rows[0].count,amarillas:ama.rows[0].count}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/admin/agencias', auth, async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM agencias ORDER BY creado DESC'); res.json({ok:true,agencias:rows}); });
app.post('/webhook',async(req,res)=>{ try{ const body=req.body; const m=body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; const meta=body.entry?.[0]?.changes?.[0]?.value?.metadata; if(!m) return res.sendStatus(200); const tel=m.from; const pid=meta?.phone_number_id; let agId=null; if(pid){ const {rows}=await pgPool.query('SELECT id FROM agencias WHERE phone_id=$1',[pid]); agId=rows[0]?.id; } if(!agId){ const {rows}=await pgPool.query('SELECT id FROM agencias LIMIT 1'); agId=rows[0]?.id; } await pgPool.query(`INSERT INTO clientes_klido (id,agencia_id,telefono,etiqueta,estado_embudo,score,ultimo_mensaje) VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (id) DO UPDATE SET etiqueta=$4, ultimo_mensaje=NOW(), leido=false`,[`cli_${tel}`,agId,tel,'respuesta_campana','contactado',70]); await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7)',[agId,`cli_${tel}`,tel,m.type||'text',m.text?.body||'media',Date.now(),'entrante']); }catch{} res.sendStatus(200); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido_verify') res.send(req.query['hub.challenge']); else res.sendStatus(403); });
app.get('/admin.html',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/crm.html',(req,res)=>res.sendFile(path.join(__dirname,'public','crm.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 KLIDO V127 RESEND FORCE 3 INTENTOS - SOPORTE@KLIDOAPP.COM.CO FALLBACK ONBOARDING - ${PORT}`));
