// KLIDO V147 - AUTO-GUARDADO TOKEN + AUTOMATICO MULTI-AGENCIA - FINAL
import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import path from 'path'; import { fileURLToPath } from 'url'; import * as XLSX from 'xlsx';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); app.use(cors()); app.use(express.json({limit:'100mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v127-resend-force-2026-3133181851';
const PHONE_ENV=process.env.PHONE_NUMBER_ID||'1338474282683914'; const WABA_ENV=process.env.WABA_ID||'2317286332424288';
let TOKEN_ENV=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||''; if(!TOKEN_ENV){ for(const v of Object.values(process.env)){ if(typeof v==='string'&&v.startsWith('EAAT')&&v.length>80){TOKEN_ENV=v;break;}}}
const ADMIN_EMAILS=['admin@klido.com','fermorales20020310@gmail.com','soporte@klidoapp.com.co'];
const PLANES={basico:{id:'basico',nombre:'BÁSICO',anual:800000,mant:80000,limite:5000,ia:false,llamadas:false,gmail:false,usuarios:3},premium:{id:'premium',nombre:'PREMIUM + IA',anual:1400000,mant:95000,limite:15000,ia:true,llamadas:false,gmail:false,usuarios:10},gold:{id:'gold',nombre:'GOLD TOTAL',anual:2500000,mant:135000,limite:50000,ia:true,llamadas:true,gmail:true,usuarios:999}};
async function initDB(){
await pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT DEFAULT 'basico', plan_activo BOOLEAN DEFAULT true, token TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, equipo JSONB DEFAULT '[]', creado BIGINT, mantenimiento BIGINT, anual_vence BIGINT, api_status TEXT DEFAULT 'pendiente', limite_usado INT DEFAULT 0, contrato_firmado BOOLEAN DEFAULT false)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS clientes_klido (id TEXT PRIMARY KEY, agencia_id TEXT, telefono TEXT, nombre TEXT, datos JSONB DEFAULT '{}', recordatorio TIMESTAMP, etiqueta TEXT DEFAULT 'nuevo', estado_embudo TEXT DEFAULT 'nuevo', asesor_id TEXT, ultimo_mensaje TIMESTAMP DEFAULT NOW(), score INT DEFAULT 0, origen_campana TEXT, leido BOOLEAN DEFAULT true, email TEXT, direccion TEXT, notas TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS mensajes_klido (id SERIAL PRIMARY KEY, agencia_id TEXT, cliente_id TEXT, telefono TEXT, tipo TEXT, contenido TEXT, url TEXT, timestamp BIGINT, direccion TEXT, leido BOOLEAN DEFAULT false, mime TEXT, media_id TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', pausada BOOLEAN DEFAULT false, historial JSONB DEFAULT '[]', creada BIGINT, terminada BIGINT, numeros JSONB DEFAULT '[]')`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS asesores (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, telefono TEXT, email TEXT, activo BOOLEAN DEFAULT true)`);
try{
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS meta_token TEXT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS phone_id TEXT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS waba_id TEXT`);
}catch(e){}
console.log('✅ KLIDO V147 - AUTO-GUARDADO TOKEN');
// AUTO-MIGRA TOKEN ENV a agencias sin token
try{
 if(TOKEN_ENV && PHONE_ENV && WABA_ENV){
  const {rows}=await pgPool.query(`SELECT id, meta_token, phone_id FROM agencias WHERE (meta_token IS NULL OR meta_token='')`);
  for(const ag of rows){
    await pgPool.query(`UPDATE agencias SET meta_token=$1, phone_id=COALESCE(phone_id,$2), waba_id=COALESCE(waba_id,$3), api_status='conectado' WHERE id=$4`,[TOKEN_ENV, PHONE_ENV, WABA_ENV, ag.id]);
    console.log(`🔧 Auto-guardado token ENV a agencia ${ag.id}`);
  }
 }
}catch(e){console.log('auto token',e.message)}
} initDB();
setInterval(async()=>{ try{ const ahora=Date.now(); await pgPool.query(`UPDATE agencias SET plan_activo=false WHERE plan_activo=true AND mantenimiento < $1`,[ahora]); await pgPool.query(`UPDATE agencias SET plan_activo=false WHERE plan_activo=true AND anual_vence < $1`,[ahora]); }catch(e){} },60*60*1000);
function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }}
function isAdmin(req,res,next){ if(!ADMIN_EMAILS.includes(req.user.email)) return res.status(403).json({error:'Solo admin'}); next(); }
async function checkPlan(req,res,next){ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const emp=rows[0]; if(!emp) return res.status(403).json({error:'No existe'}); if(!emp.plan_activo) return res.status(403).json({bloqueado:true, error:'PLAN BLOQUEADO 3133181851'}); req.empresa=emp; next(); }
async function obtenerEmpresas(){ const {rows}=await pgPool.query('SELECT * FROM agencias'); return rows.map(r=>({id:r.id,plan:r.plan,phoneId:r.phone_id,wabaId:r.waba_id,metaToken:r.meta_token,phoneIdEfectivo:r.phone_id||PHONE_ENV,wabaIdEfectivo:r.waba_id||WABA_ENV,metaTokenEfectivo:r.meta_token||TOKEN_ENV})); }
const codigosTemp=new Map();
async function enviarMail(para,asunto,html){ const RESEND_KEY=process.env.RESEND_API_KEY; if(!RESEND_KEY) return {error:'Falta KEY'}; try{ const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'KLIDO <soporte@klidoapp.com.co>',to:para,subject:asunto,html})}); return await r.json(); }catch(e){ return {error:e.message}; } }
function normalizaNumeros(arr){ let out=[]; arr.forEach(raw=>{ let texto=String(raw||'').trim(); if(!texto) return; texto.split(/[,;\n|\/ -]+/).forEach(p=>{ let d=p.replace(/\D/g,''); if(!d) return; if(d.endsWith('.0')) d=d.slice(0,-2); if(d.length===10 && d.startsWith('3')) d='57'+d; if(d.length===12 && d.startsWith('57') && d[2]==='3') out.push(d); if(d.length>12){ const m=d.match(/3\d{9}/g); if(m) m.forEach(x=>out.push('57'+x)); } }); }); out=[...new Set(out)].filter(n=>/^57[3]\d{9}$/.test(n)); return out; }
async function getTemplateAuto(plantilla, emp){
 try{
  const url = `https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`;
  const r = await fetch(url); const j = await r.json();
  if(!j.data) return null;
  const t = j.data.find(x=>x.name===plantilla && x.status==='APPROVED') || j.data.find(x=>x.name===plantilla);
  if(!t){ console.log(`❌ ${plantilla} NO existe en WABA ${emp.wabaIdEfectivo}. Disponibles: ${j.data.map(x=>x.name).join(', ')}`); return null; }
  let bodyVars=0; const bodyComp=t.components?.find(c=>c.type==='BODY'); if(bodyComp?.text){ const m=bodyComp.text.match(/\{\{\d+\}\}/g); bodyVars=m? new Set(m).size : 0; } if(!bodyVars && bodyComp?.example?.body_text) bodyVars=bodyComp.example.body_text[0]?.length||0;
  console.log(`✅ TEMPLATE ${t.name} lang:${t.language} bodyVars:${bodyVars} - ${bodyComp?.text?.slice(0,100)}`);
  return { language:t.language, bodyVars, template:t };
 }catch(e){ console.log('getTemplateAuto',e.message); return null; }
}
function buildPayloadAuto(plantilla, variables, meta){
  const lang=meta?.language||'es_CO'; const need=meta?.bodyVars||0; let vars=Array.isArray(variables)?[...variables]:[];
  if(vars.length<need) while(vars.length<need) vars.push(vars.length===0?'Cliente':`Dato${vars.length+1}`);
  if(vars.length>need) vars=vars.slice(0,need); if(need===0 && vars.length===0 && plantilla!=='hello_world') vars=['Cliente'];
  const payload={name:plantilla, language:{code:lang}}; if(vars.length) payload.components=[{type:'body', parameters:vars.map(t=>({type:'text', text:String(t).slice(0,100)}))}]; return payload;
}
async function enviarCampanaProceso(campId, agenciaId){
  try{
    const {rows:campRows}=await pgPool.query('SELECT * FROM campanas_klido WHERE id=$1 AND agencia_id=$2',[campId, agenciaId]); if(!campRows[0]) return;
    const camp=campRows[0]; let numeros=camp.numeros; if(typeof numeros==='string'){ try{ numeros=JSON.parse(numeros); }catch{ numeros=[]; } } numeros=normalizaNumeros(numeros); if(!numeros.length) return;
    const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===agenciaId); if(!emp) return;
    let variables=[]; try{ const hist=typeof camp.historial==='string'?JSON.parse(camp.historial):camp.historial; const last=hist?.find(h=>h.variables)||hist?.[0]; if(last?.variables) variables=last.variables; }catch{}
    const meta=await getTemplateAuto(camp.plantilla, emp);
    if(!meta){ await pgPool.query('UPDATE campanas_klido SET fallidos=$1, historial=$2 WHERE id=$3',[numeros.length, JSON.stringify([{error:`Plantilla ${camp.plantilla} no existe en WABA ${emp.wabaIdEfectivo}. Revisa Config API TOKEN` }]), campId]); return; }
    console.log(`🚀 V147 AUTO ${campId} ${camp.plantilla} total:${numeros.length} lang:${meta.language} need:${meta.bodyVars} phone:${emp.phoneIdEfectivo}`);
    for(let i=0;i<numeros.length;i++){
      const num=numeros[i]; try{
        const payloadTpl=buildPayloadAuto(camp.plantilla, variables, meta);
        const resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:num,type:'template',template:payloadTpl})});
        const jr=await resp.json(); if(jr.error) throw jr.error;
        await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1 WHERE id=$1',[campId]);
        await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[agenciaId]);
        console.log(`✅ ${num} enviado ${meta.language}`);
      }catch(e){ const msg=(e.error_user_msg||e.message||JSON.stringify(e)).slice(0,400); await pgPool.query(`UPDATE campanas_klido SET fallidos=fallidos+1, historial=COALESCE(historial,'[]'::jsonb)||$1::jsonb WHERE id=$2`,[JSON.stringify([{error:msg, telefono:num}]), campId]); console.log(`❌ ${num} FALLIDO:`,msg); }
      await new Promise(r=>setTimeout(r,1200));
    }
    await pgPool.query('UPDATE campanas_klido SET estado=$1,terminada=$2 WHERE id=$3',['terminada',Date.now(),campId]);
  }catch(e){ console.log('proc',e.message); }
}
app.get('/api/health',(req,res)=>res.json({ok:true,version:'v147-auto-guardado-final'}));
app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.post('/api/auth/register-init', async(req,res)=>{ try{ const {nombre,email,password,plan}=req.body; const {rows}=await pgPool.query('SELECT email FROM agencias WHERE email=$1',[email]); if(rows[0]) return res.status(400).json({error:'Ya existe'}); const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosTemp.set(email,{codigo,expira:Date.now()+30*60*1000,datos:{nombre,email,password,plan:plan||'basico'},intentos:0}); await enviarMail(email,`Código ${codigo}`,`<p>${codigo}</p>`); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/register-verify', async(req,res)=>{ try{ const {email,codigo}=req.body; const t=codigosTemp.get(email); if(!t||t.codigo!==codigo) return res.status(400).json({error:'Inválido'}); const {nombre,password,plan}=t.datos; const id='ag_'+Date.now(); const hash=await bcrypt.hash(password,10); const ahora=Date.now(); await pgPool.query('INSERT INTO agencias (id,nombre,email,password,plan,plan_activo,token,creado,mantenimiento,anual_vence,api_status,limite_usado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,nombre,email,hash,plan||'basico',true,jwt.sign({agenciaId:id,email},JWT),ahora,ahora+90*24*60*60*1000,ahora+365*24*60*60*1000,'conectado',0]); codigosTemp.delete(email); res.json({ok:true,token:jwt.sign({agenciaId:id,email},JWT)}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/login',async(req,res)=>{ try{ const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); const emp=rows[0]; if(!emp) return res.status(404).json({error:'No existe'}); if(!await bcrypt.compare(password,emp.password)) return res.status(401).json({error:'Clave mala'}); if(!emp.plan_activo) return res.status(403).json({bloqueado:true, error:'BLOQUEADO'}); res.json({ok:true,token:jwt.sign({agenciaId:emp.id,email:emp.email},JWT),agencia:emp}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/forgot', async(req,res)=>{ try{ const {email}=req.body; const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosTemp.set(email,{codigo,expira:Date.now()+15*60*1000}); await enviarMail(email,`Recup ${codigo}`,`<p>${codigo}</p>`); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/reset', async(req,res)=>{ try{ const {email,codigo,password}=req.body; const t=codigosTemp.get(email); if(!t||t.codigo!==codigo) return res.status(400).json({error:'Inválido'}); const hash=await bcrypt.hash(password,10); await pgPool.query('UPDATE agencias SET password=$1 WHERE email=$2',[hash,email]); codigosTemp.delete(email); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/config',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const e=rows[0]; res.json({tieneConfig:!!e.phone_id, phoneId:e.phone_id||'', wabaId:e.waba_id||'', phoneIdEfectivo:e.phone_id||PHONE_ENV, wabaIdEfectivo:e.waba_id||WABA_ENV, tieneToken:!!(e.meta_token||TOKEN_ENV), plan:e.plan, limite:5000, usado:e.limite_usado}); });
app.post('/api/config',auth,async(req,res)=>{ const {phoneId,wabaId,metaToken}=req.body; if(!phoneId||!wabaId) return res.status(400).json({error:'Falta Phone y WABA'}); const tokenFinal=metaToken||TOKEN_ENV; await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3,api_status=$4 WHERE id=$5',[phoneId,wabaId,tokenFinal,'conectado',req.user.agenciaId]); res.json({ok:true, autoGuardado:!metaToken}); });
app.get('/api/plantillas',auth,async(req,res)=>{ const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`); const j=await r.json(); if(j.error) throw j.error; res.json(j.data?.filter(t=>t.status==='APPROVED')||j.data||[]); }catch(e){ res.json([]); }});
app.post('/api/campanas/parse-excel',auth,async(req,res)=>{ try{ const {dataBase64}=req.body; const buffer=Buffer.from(dataBase64.split(',').pop(), 'base64'); const wb=XLSX.read(buffer,{type:'buffer'}); let nums=[]; wb.SheetNames.forEach(name=>{ const ws=wb.Sheets[name]; const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}); json.forEach(row=>{ row.forEach(cell=>{ nums.push(...normalizaNumeros([String(cell)])); }); }); }); nums=[...new Set(nums)]; res.json({ok:true,total:nums.length,numeros:nums.slice(0,50000)}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/campanas',auth,checkPlan,async(req,res)=>{ try{ const {nombre,plantilla,numeros,variables}=req.body; const id='camp_'+Date.now(); const validos=normalizaNumeros(numeros); const vars=Array.isArray(variables)?variables:[]; await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada,historial,numeros,enviados,fallidos,estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,req.user.agenciaId,nombre||'Camp',plantilla,validos.length,Date.now(),JSON.stringify([{variables:vars}]),JSON.stringify(validos),0,0,'activa']); enviarCampanaProceso(id, req.user.agenciaId); res.json({ok:true,total:validos.length,id}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false WHERE id=$1',[req.params.id]); enviarCampanaProceso(req.params.id, req.user.agenciaId); res.json({ok:true}); });
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });
app.get('/api/clientes',auth,async(req,res)=>{ const {rows}=await pgPool.query(`SELECT * FROM clientes_klido WHERE agencia_id=$1 ORDER BY ultimo_mensaje DESC`,[req.user.agenciaId]); res.json(rows); });
app.post('/api/clientes/:id/datos',auth,async(req,res)=>{ const {etiqueta}=req.body; await pgPool.query(`UPDATE clientes_klido SET etiqueta=$1 WHERE id=$2`,[etiqueta, req.params.id]); res.json({ok:true}); });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE cliente_id=$1 ORDER BY timestamp ASC',[req.params.clienteId]); res.json(rows); });
app.post('/api/mensajes/:clienteId',auth,checkPlan,async(req,res)=>{ const {contenido}=req.body; const {rows:cl}=await pgPool.query('SELECT telefono FROM clientes_klido WHERE id=$1',[req.params.clienteId]); try{ const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:cl[0].telefono,type:'text',text:{body:contenido}})}); const j=await r.json(); if(j.error) throw j.error; await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7)',[req.user.agenciaId,req.params.clienteId,cl[0].telefono,'text',contenido,Date.now(),'saliente']); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/dashboard',auth,async(req,res)=>{ const tot=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]); res.json({total:tot.rows[0].count}); });
app.get('/api/admin/agencias', auth, isAdmin, async(req,res)=>{ const {rows}=await pgPool.query('SELECT id,nombre,email,plan,plan_activo FROM agencias'); res.json({ok:true,agencias:rows}); });
app.post('/webhook',async(req,res)=>{ try{ const m=req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; if(!m) return res.sendStatus(200); const tel=m.from; await pgPool.query(`INSERT INTO clientes_klido (id,agencia_id,telefono,etiqueta) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,[`cli_${tel}`, 'ag_1', tel, 'respuesta_campana']); }catch(e){} res.sendStatus(200); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido_verify') res.send(req.query['hub.challenge']); else res.sendStatus(403); });
const PORT=process.env.PORT||3000; app.listen(PORT,()=>console.log(`🚀 KLIDO V147 - AUTO-GUARDADO FINAL - ${PORT}`));
