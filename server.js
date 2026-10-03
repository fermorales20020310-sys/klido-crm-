// KLIDO V146 - AUTOMATICO MULTI-AGENCIA - Sin configurar idiomas ni vars manual
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
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS plan_activo BOOLEAN DEFAULT true`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'basico'`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS mantenimiento BIGINT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS anual_vence BIGINT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS limite_usado INT DEFAULT 0`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS api_status TEXT DEFAULT 'pendiente'`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS token TEXT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS phone_id TEXT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS waba_id TEXT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS meta_token TEXT`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS leido BOOLEAN DEFAULT true`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS notas TEXT`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS recordatorio TIMESTAMP`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS email TEXT`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS estado_embudo TEXT DEFAULT 'nuevo'`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS origen_campana TEXT`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS score INT DEFAULT 0`);
await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS numeros JSONB DEFAULT '[]'`);
await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS pausada BOOLEAN DEFAULT false`);
await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'activa'`);
await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS enviados INT DEFAULT 0`);
await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS fallidos INT DEFAULT 0`);
await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS historial JSONB DEFAULT '[]'`);
await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS terminada BIGINT`);
}catch(e){console.log('migracion v146',e.message)}
console.log('✅ KLIDO V146 - AUTOMATICO MULTI-AGENCIA');
} initDB();
setInterval(async()=>{ try{ const ahora=Date.now(); const q1=await pgPool.query(`UPDATE agencias SET plan_activo=false WHERE plan_activo=true AND mantenimiento IS NOT NULL AND mantenimiento < $1 RETURNING id`,[ahora]); const q2=await pgPool.query(`UPDATE agencias SET plan_activo=false WHERE plan_activo=true AND anual_vence IS NOT NULL AND anual_vence < $1 RETURNING id`,[ahora]); if(q1.rowCount||q2.rowCount) console.log(`🔒 Auto-bloqueo ${q1.rowCount} trim ${q2.rowCount} anual`); }catch(e){console.log('cron',e.message)} },60*60*1000);
function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }}
function isAdmin(req,res,next){ if(!ADMIN_EMAILS.includes(req.user.email)) return res.status(403).json({error:'Solo admin'}); next(); }
async function checkPlan(req,res,next){ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const emp=rows[0]; if(!emp) return res.status(403).json({error:'No existe'}); if(emp.mantenimiento && Date.now()>Number(emp.mantenimiento)){ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[emp.id]); return res.status(403).json({bloqueado:true, error:`MANTENIMIENTO VENCIDO $${PLANES[emp.plan]?.mant} - 3133181851`, wpp:'573133181851'}); } if(emp.anual_vence && Date.now()>Number(emp.anual_vence)){ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[emp.id]); return res.status(403).json({bloqueado:true, error:`ANUAL VENCIDO $${PLANES[emp.plan]?.anual} - 3133181851`, wpp:'573133181851'}); } if(!emp.plan_activo) return res.status(403).json({bloqueado:true, error:'PLAN BLOQUEADO POR MORA - 3133181851', wpp:'573133181851'}); if(emp.limite_usado>=PLANES[emp.plan].limite) return res.status(403).json({error:'LIMITE ALCANZADO'}); req.empresa=emp; next(); }
async function obtenerEmpresas(){ const {rows}=await pgPool.query('SELECT * FROM agencias'); return rows.map(r=>({id:r.id,plan:r.plan,phoneId:r.phone_id,wabaId:r.waba_id,metaToken:r.meta_token,phoneIdEfectivo:r.phone_id||PHONE_ENV,wabaIdEfectivo:r.waba_id||WABA_ENV,metaTokenEfectivo:r.meta_token||TOKEN_ENV})); }
const codigosTemp=new Map();
async function enviarMail(para,asunto,html){ const RESEND_KEY=process.env.RESEND_API_KEY; const ENV_FROM=process.env.RESEND_FROM||'KLIDO <soporte@klidoapp.com.co>'; if(!RESEND_KEY) return {error:'Falta RESEND_API_KEY'}; const intentos=[ENV_FROM,'KLIDO <onboarding@resend.dev>','onboarding@resend.dev']; for(let i=0;i<intentos.length;i++){ try{ const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:intentos[i],to:para,subject:asunto,html})}); const j=await r.json(); if(!j.error) return j; if(i==intentos.length-1) return {error:j.error}; }catch(e){ if(i==intentos.length-1) return {error:e.message}; } } }
function normalizaNumeros(arr){ let out=[]; arr.forEach(raw=>{ let texto=String(raw||'').trim(); if(!texto) return; texto.split(/[,;\n|\/ -]+/).forEach(p=>{ let d=p.replace(/\D/g,''); if(!d) return; if(d.endsWith('.0')) d=d.slice(0,-2); if(d.length===10 && d.startsWith('3')) d='57'+d; if(d.length===12 && d.startsWith('57') && d[2]==='3') out.push(d); if(d.length>12){ const m=d.match(/3\d{9}/g); if(m) m.forEach(x=>out.push('57'+x)); } }); }); out=[...new Set(out)].filter(n=>/^57[3]\d{9}$/.test(n) &&!/(.)\1{6,}/.test(n) &&!n.includes('80808080') &&!n.includes('2237999510')); return out; }

// === V146 AUTOMATICO: DETECTA IDIOMA + VARIABLES + HEADER ===
async function getTemplateAuto(plantilla, emp){
 try{
  const url = `https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`;
  const r = await fetch(url); const j = await r.json();
  if(!j.data){ console.log(`⚠️ No se pudo listar templates WABA ${emp.wabaIdEfectivo}:`, JSON.stringify(j).slice(0,400)); return null; }
  const t = j.data.find(x=>x.name===plantilla && x.status==='APPROVED') || j.data.find(x=>x.name===plantilla);
  if(!t){ console.log(`❌ Plantilla ${plantilla} NO existe en WABA ${emp.wabaIdEfectivo}. Disponibles: ${j.data.map(x=>`${x.name}[${x.language}]`).join(', ').slice(0,500)}`); return null; }
  // Contar variables {{1}}, {{2}} en body y header
  let bodyVars = 0, headerVars = 0, hasHeaderMedia = false;
  const bodyComp = t.components?.find(c=>c.type==='BODY');
  if(bodyComp?.text){ const matches = bodyComp.text.match(/\{\{\d+\}\}/g); bodyVars = matches? new Set(matches).size : 0; }
  if(!bodyVars && bodyComp?.example?.body_text){ bodyVars = bodyComp.example.body_text[0]?.length || 0; }
  const headerComp = t.components?.find(c=>c.type==='HEADER');
  if(headerComp){
    if(headerComp.format==='TEXT' && headerComp.text){ const hm = headerComp.text.match(/\{\{\d+\}\}/g); headerVars = hm? new Set(hm).size : 0; }
    if(['IMAGE','DOCUMENT','VIDEO'].includes(headerComp.format)) hasHeaderMedia = true;
  }
  console.log(`✅ TEMPLATE ${t.name} lang:${t.language} bodyVars:${bodyVars} headerVars:${headerVars} headerMedia:${hasHeaderMedia} - ${t.components?.map(c=>c.type+':'+(c.text||c.format||'').slice(0,50)).join(' | ')}`);
  return { language: t.language, bodyVars, headerVars, hasHeaderMedia, template: t, allTemplates: j.data.map(x=>x.name) };
 }catch(e){ console.log('getTemplateAuto error', e.message); return null; }
}
function buildPayloadAuto(plantilla, variables, meta){
  const lang = meta?.language || (plantilla==='hello_world'?'en_US':'es_CO');
  const needBody = meta?.bodyVars || 0;
  const needHeader = meta?.headerVars || 0;
  // Ajustar variables automaticamente al numero que pide la plantilla
  let vars = Array.isArray(variables)? [...variables] : [];
  if(vars.length < needBody){ // rellenar faltantes con "Cliente"
    while(vars.length < needBody) vars.push(vars.length===0?'Cliente':`Dato${vars.length+1}`);
  }
  if(vars.length > needBody) vars = vars.slice(0, needBody);
  if(needBody===0 && vars.length===0 && plantilla!=='hello_world') vars = ['Cliente'];

  let components = [];
  if(needHeader>0){
    const hVars = vars.slice(0, needHeader);
    components.push({ type:'header', parameters: hVars.map(t=>({type:'text', text:String(t).slice(0,100)})) });
    vars = vars.slice(needHeader);
  }
  // Si tiene media header, no podemos enviar sin url, lo omitimos para que no falle
  if(vars.length>0){
    components.push({ type:'body', parameters: vars.map(t=>({type:'text', text:String(t).slice(0,100)})) });
  }
  const payload = { name: plantilla, language: { code: lang } };
  if(components.length) payload.components = components;
  return payload;
}

async function enviarCampanaProceso(campId, agenciaId){
  try{
    const {rows:campRows}=await pgPool.query('SELECT * FROM campanas_klido WHERE id=$1 AND agencia_id=$2',[campId, agenciaId]); if(!campRows[0]) return;
    const camp=campRows[0]; let numeros=camp.numeros; if(typeof numeros==='string'){ try{ numeros=JSON.parse(numeros); }catch{ numeros=[]; } } numeros=normalizaNumeros(numeros); if(!numeros.length){ await pgPool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['terminada',campId]); return; }
    const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===agenciaId); if(!emp) return;
    let variables=[]; try{ const hist = typeof camp.historial==='string'? JSON.parse(camp.historial): camp.historial; const last = hist?.find(h=>h.variables) || hist?.[0]; if(last?.variables) variables=last.variables; }catch{}

    const meta = await getTemplateAuto(camp.plantilla, emp);
    if(!meta){ await pgPool.query('UPDATE campanas_klido SET fallidos=$1, historial=$2 WHERE id=$3',[numeros.length, JSON.stringify([{error:`Plantilla ${camp.plantilla} no existe en tu WABA ${emp.wabaIdEfectivo}`, fecha:Date.now()}]), campId]); console.log(`❌ Plantilla no encontrada, abortando ${campId}`); return; }

    console.log(`🚀 V146 AUTO ${campId} ${camp.plantilla} total:${numeros.length} vars:${JSON.stringify(variables)} phone:${emp.phoneIdEfectivo} waba:${emp.wabaIdEfectivo} meta:lang=${meta.language} bodyVars=${meta.bodyVars}`);
    const yaEnviados = (camp.enviados||0)+(camp.fallidos||0);
    for(let i=yaEnviados;i<numeros.length;i++){
      const {rows:check}=await pgPool.query('SELECT pausada FROM campanas_klido WHERE id=$1',[campId]); if(check[0]?.pausada){ await pgPool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['pausada',campId]); break; }
      const num=numeros[i]; let enviado=false; let ultimoError=null;
      try{
        const payloadTpl = buildPayloadAuto(camp.plantilla, variables, meta);
        const resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:num,type:'template',template:payloadTpl})});
        const jr=await resp.json(); if(jr.error){ ultimoError=jr.error; throw jr.error; }
        await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1 WHERE id=$1',[campId]);
        await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[agenciaId]);
        await pgPool.query(`INSERT INTO clientes_klido (id,agencia_id,telefono,origen_campana,etiqueta,estado_embudo,leido) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET origen_campana=$4, ultimo_mensaje=NOW()`,[`cli_${num}`,agenciaId,num,campId,'nuevo','nuevo',true]);
        console.log(`✅ ${num} enviado lang:${meta.language} bodyVars:${meta.bodyVars}`); enviado=true;
      }catch(e){ ultimoError=e; }
      if(!enviado){
        const msgErr = (ultimoError?.error_user_msg || ultimoError?.message || JSON.stringify(ultimoError)).slice(0,800);
        await pgPool.query(`UPDATE campanas_klido SET fallidos=fallidos+1, historial = COALESCE(historial,'[]'::jsonb) || $1::jsonb WHERE id=$2`, [JSON.stringify([{error:msgErr, telefono:num, fecha:Date.now()}]), campId]);
        console.log(`❌ ${num} FALLIDO META:`, msgErr);
      }
      await new Promise(r=>setTimeout(r,1200));
    }
    await pgPool.query('UPDATE campanas_klido SET estado=$1,terminada=$2 WHERE id=$3',['terminada',Date.now(),campId]);
    console.log(`🏁 Campaña ${campId} terminada`);
  }catch(e){ console.log('enviarCampanaProceso V146 error', e.message); }
}
app.get('/api/health',(req,res)=>res.json({ok:true,version:'v146-auto-multi-agencia',planes:PLANES,wpp:'573133181851'}));
app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.post('/api/debug/test-meta', auth, async(req,res)=>{
 try{
  const {telefono, plantilla} = req.body; const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId);
  const meta = await getTemplateAuto(plantilla||'acol_invitacion_congreso', emp);
  if(!meta) return res.json({ok:false, error:`Plantilla ${plantilla} no existe en WABA ${emp.wabaIdEfectivo}`, wabaId:emp.wabaIdEfectivo, phoneId:emp.phoneIdEfectivo});
  const tpl = buildPayloadAuto(plantilla, [], meta);
  const testNum = normalizaNumeros([telefono||'573226536669'])[0];
  const r = await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:testNum,type:'template',template:tpl})});
  const j = await r.json();
  res.json({ok:true, meta, payload:tpl, resp:j});
 }catch(e){ res.json({error:e.message}); }
});
app.post('/api/auth/register-init', async(req,res)=>{ try{ const {nombre,email,password,plan}=req.body; if(!nombre||!email||!password) return res.status(400).json({error:'Faltan datos'}); const {rows}=await pgPool.query('SELECT email FROM agencias WHERE email=$1',[email]); if(rows[0]) return res.status(400).json({error:'Ya existe'}); const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosTemp.set(email,{codigo,expira:Date.now()+30*60*1000,datos:{nombre,email,password,plan:plan||'basico'},intentos:0}); const resMail=await enviarMail(email,`KLIDO - Código ${codigo} - Plan ${(plan||'basico').toUpperCase()}`, `<div style="font-family:Arial;padding:20px"><div style="background:white;padding:20px;border-radius:14px"><h2>KLIDO AVANZA - Plan ${(plan||'basico').toUpperCase()}</h2><p>Hola <b>${nombre}</b>, anual $${PLANES[plan||'basico']?.anual} + trim $${PLANES[plan||'basico']?.mant}</p><p style="font-size:36px;letter-spacing:10px;background:#eef5ff;padding:14px 22px;border-radius:12px;border:2px dashed #2563eb;text-align:center">${codigo}</p></div></div>`); if(resMail?.error) return res.status(500).json({error:'Resend: '+JSON.stringify(resMail.error)}); res.json({ok:true,mensaje:'Código enviado'}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/register-verify', async(req,res)=>{ try{ const {email,codigo}=req.body; const t=codigosTemp.get(email); if(!t) return res.status(400).json({error:'No hay código'}); if(Date.now()>t.expira){codigosTemp.delete(email); return res.status(400).json({error:'Vencido'});} if(t.codigo!==codigo){t.intentos++; if(t.intentos>=5){codigosTemp.delete(email); return res.status(400).json({error:'Bloqueado'});} return res.status(400).json({error:'Inválido '+(5-t.intentos)});} const {nombre,password,plan}=t.datos; const id='ag_'+Date.now(); const hash=await bcrypt.hash(password,10); const ahora=Date.now(); const mant=ahora+90*24*60*60*1000; const anual=ahora+365*24*60*60*1000; await pgPool.query('INSERT INTO agencias (id,nombre,email,password,plan,plan_activo,token,creado,mantenimiento,anual_vence,api_status,limite_usado,contrato_firmado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,nombre,email,hash,plan||'basico',true,jwt.sign({agenciaId:id,email},JWT),ahora,mant,anual,'pendiente',0,true]); codigosTemp.delete(email); res.json({ok:true,token:jwt.sign({agenciaId:id,email},JWT),agencia:{id,nombre,email,plan}}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/login',async(req,res)=>{ try{ const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); const emp=rows[0]; if(!emp) return res.status(404).json({error:'No existe'}); if(!await bcrypt.compare(password,emp.password)) return res.status(401).json({error:'Clave mala'}); if(emp.mantenimiento && Date.now()>Number(emp.mantenimiento)){ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[emp.id]); return res.status(403).json({bloqueado:true, error:`MANTENIMIENTO VENCIDO $${PLANES[emp.plan]?.mant}`}); } if(emp.anual_vence && Date.now()>Number(emp.anual_vence)){ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[emp.id]); return res.status(403).json({bloqueado:true, error:`ANUAL VENCIDO $${PLANES[emp.plan]?.anual}`}); } if(!emp.plan_activo) return res.status(403).json({bloqueado:true, error:'🚫 PLAN BLOQUEADO POR MORA'}); res.json({ok:true,token:jwt.sign({agenciaId:emp.id,email:emp.email},JWT),agencia:emp}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/forgot', async(req,res)=>{ try{ const {email}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); if(!rows[0]) return res.status(404).json({error:'No existe'}); const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosTemp.set(email,{codigo,expira:Date.now()+15*60*1000,intentos:0}); await enviarMail(email,'KLIDO - Recuperación '+codigo, `<p>Código: <b style="font-size:32px;letter-spacing:8px;background:#eef5ff;padding:10px 18px;border-radius:10px;border:2px dashed #2563eb">${codigo}</b></p>`); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/reset', async(req,res)=>{ try{ const {email,codigo,password}=req.body; const t=codigosTemp.get(email); if(!t||t.codigo!==codigo||Date.now()>t.expira) return res.status(400).json({error:'Inválido'}); const hash=await bcrypt.hash(password,10); await pgPool.query('UPDATE agencias SET password=$1 WHERE email=$2',[hash,email]); codigosTemp.delete(email); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/config',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const e=rows[0]; res.json({tieneConfig:!!e.phone_id, phoneId:e.phone_id||'', wabaId:e.waba_id||'', phoneIdEfectivo:e.phone_id||PHONE_ENV, wabaIdEfectivo:e.waba_id||WABA_ENV, plan:e.plan, limite:PLANES[e.plan].limite, usado:e.limite_usado, mantenimiento:e.mantenimiento?new Date(Number(e.mantenimiento)).toLocaleDateString():'90 días', anual_vence:e.anual_vence?new Date(Number(e.anual_vence)).toLocaleDateString():'365 días', api_status:e.api_status}); });
app.post('/api/config',auth,async(req,res)=>{ const {phoneId,wabaId,metaToken}=req.body; if(!phoneId||!wabaId) return res.status(400).json({error:'Falta Phone y WABA'}); await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3,api_status=$4 WHERE id=$5',[phoneId,wabaId,metaToken||TOKEN_ENV,'conectado',req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/plantillas',auth,async(req,res)=>{ const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`); const j=await r.json(); if(j.error) throw j.error; res.json(j.data?.filter(t=>t.status==='APPROVED')||j.data||[]); }catch(e){ res.json([{name:'hello_world',status:'APPROVED'},{name:'acol_invitacion_congreso',status:'APPROVED'}]); }});
app.post('/api/campanas/parse-excel',auth,async(req,res)=>{ try{ const {dataBase64}=req.body; if(!dataBase64) return res.status(400).json({error:'Falta archivo'}); const buffer=Buffer.from(dataBase64.split(',').pop(), 'base64'); const wb=XLSX.read(buffer,{type:'buffer'}); let nums=[]; wb.SheetNames.forEach(name=>{ const ws=wb.Sheets[name]; const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}); json.forEach(row=>{ row.forEach(cell=>{ nums.push(...normalizaNumeros([String(cell)])); }); }); }); nums=[...new Set(nums)]; res.json({ok:true,total:nums.length,numeros:nums.slice(0,50000), preview:nums.slice(0,200)}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/campanas',auth,checkPlan,async(req,res)=>{ try{ const {nombre,plantilla,numeros,variables}=req.body; if(!plantilla||!numeros?.length) return res.status(400).json({error:'Falta plantilla y números'}); const id='camp_'+Date.now(); const validos=normalizaNumeros(numeros); if(!validos.length) return res.status(400).json({error:'0 números válidos 57 3...'}); const vars = Array.isArray(variables)? variables : (typeof variables==='string'? variables.split(',').map(s=>s.trim()).filter(Boolean): []); const historialData=[{accion:'creada',fecha:Date.now(),total:validos.length,plantilla,variables:vars}]; await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada,historial,numeros,enviados,fallidos,estado,pausada) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,req.user.agenciaId,nombre||'Campaña '+(new Date().toLocaleDateString()),plantilla,validos.length,Date.now(),JSON.stringify(historialData),JSON.stringify(validos),0,0,'activa',false]); enviarCampanaProceso(id, req.user.agenciaId); res.json({ok:true,total:validos.length,id,mensaje:'Campaña '+validos.length+' iniciada - v146 AUTO'}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true,estado=$1 WHERE id=$2',['pausada',req.params.id]); res.json({ok:true}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false,estado=$1 WHERE id=$2',['activa',req.params.id]); enviarCampanaProceso(req.params.id, req.user.agenciaId); res.json({ok:true, mensaje:'Continuando'}); });
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });
app.get('/api/clientes',auth,async(req,res)=>{ const {rows}=await pgPool.query(`SELECT * FROM clientes_klido WHERE agencia_id=$1 ORDER BY CASE WHEN leido=false THEN 0 ELSE 1 END, CASE WHEN etiqueta='respuesta_campana' THEN 0 ELSE 1 END, ultimo_mensaje DESC`,[req.user.agenciaId]); res.json(rows); });
app.post('/api/clientes/:id/datos',auth,async(req,res)=>{ try{ const {nombre,etiqueta,estado_embudo,notas,recordatorio,email,asesor_id,leido,origen_campana,score}=req.body; const updates=[]; const vals=[]; let idx=1; if(nombre!==undefined){ updates.push(`nombre=$${idx++}`); vals.push(nombre); } if(etiqueta!==undefined){ updates.push(`etiqueta=$${idx++}`); vals.push(etiqueta); } if(estado_embudo!==undefined){ updates.push(`estado_embudo=$${idx++}`); vals.push(estado_embudo); } if(notas!==undefined){ updates.push(`notas=$${idx++}`); vals.push(notas); } if(email!==undefined){ updates.push(`email=$${idx++}`); vals.push(email); } if(asesor_id!==undefined){ updates.push(`asesor_id=$${idx++}`); vals.push(asesor_id||null); } if(leido!==undefined){ updates.push(`leido=$${idx++}`); vals.push(leido); } if(origen_campana!==undefined){ updates.push(`origen_campana=$${idx++}`); vals.push(origen_campana); } if(score!==undefined){ updates.push(`score=$${idx++}`); vals.push(score); } if(recordatorio!==undefined){ updates.push(`recordatorio=$${idx++}`); vals.push(recordatorio? new Date(recordatorio):null); } if(!updates.length) return res.json({ok:true}); vals.push(req.params.id, req.user.agenciaId); await pgPool.query(`UPDATE clientes_klido SET ${updates.join(',')} WHERE id=$${idx} AND agencia_id=$${idx+1}`, vals); res.json({ok:true}); }catch(e){ res.status(500).json({error:e.message}); } });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE agencia_id=$1 AND cliente_id=$2 ORDER BY timestamp ASC',[req.user.agenciaId,req.params.clienteId]); res.json(rows); });
app.post('/api/mensajes/:clienteId',auth,checkPlan,async(req,res)=>{ const {contenido}=req.body; const clienteId=req.params.clienteId; const {rows:cl}=await pgPool.query('SELECT telefono FROM clientes_klido WHERE id=$1 AND agencia_id=$2',[clienteId, req.user.agenciaId]); if(!cl[0]) return res.status(404).json({error:'Cliente no existe'}); const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:cl[0].telefono,type:'text',text:{body:contenido}})}); const j=await r.json(); if(j.error) throw j.error; await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion,leido) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[req.user.agenciaId,clienteId,cl[0].telefono,'text',contenido,Date.now(),'saliente',true]); await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[req.user.agenciaId]); await pgPool.query('UPDATE clientes_klido SET leido=true, ultimo_mensaje=NOW() WHERE id=$1',[clienteId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/dashboard',auth,async(req,res)=>{ try{ const tot=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]); const noleidos=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND leido=false',[req.user.agenciaId]); const ama=await pgPool.query("SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND etiqueta='respuesta_campana'",[req.user.agenciaId]); res.json({total:tot.rows[0].count, noleidos:noleidos.rows[0].count, amarillas:ama.rows[0].count}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/admin/agencias', auth, isAdmin, async(req,res)=>{ const {rows}=await pgPool.query('SELECT id,nombre,email,plan,plan_activo,mantenimiento,anual_vence,limite_usado,creado FROM agencias ORDER BY creado DESC'); res.json({ok:true,agencias:rows}); });
app.post('/api/admin/agencias/:id/activar', auth, isAdmin, async(req,res)=>{ try{ const {plan, dias, tipo} = req.body; const d = Number(dias)||90; const p = plan||'basico'; if(tipo==='anual'){ const nuevoAnual = Date.now() + 365*24*60*60*1000; const nuevoMant = Date.now() + 90*24*60*60*1000; await pgPool.query('UPDATE agencias SET plan_activo=true, plan=$1, mantenimiento=$2, anual_vence=$3, limite_usado=0 WHERE id=$4',[p, nuevoMant, nuevoAnual, req.params.id]); res.json({ok:true}); } else { const nuevoMant = Date.now() + d*24*60*60*1000; await pgPool.query('UPDATE agencias SET plan_activo=true, plan=$1, mantenimiento=$2, limite_usado=0 WHERE id=$3',[p, nuevoMant, req.params.id]); res.json({ok:true}); } }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/admin/agencias/:id/bloquear', auth, isAdmin, async(req,res)=>{ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.post('/webhook',async(req,res)=>{ try{ const body=req.body; const m=body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; const meta=body.entry?.[0]?.changes?.[0]?.value?.metadata; if(!m) return res.sendStatus(200); const tel=m.from; const pid=meta?.phone_number_id; let agId=null; if(pid){ const {rows}=await pgPool.query('SELECT id FROM agencias WHERE phone_id=$1',[pid]); agId=rows[0]?.id; } if(!agId){ const {rows}=await pgPool.query('SELECT id FROM agencias LIMIT 1'); agId=rows[0]?.id; } const {rows:ex}=await pgPool.query('SELECT origen_campana FROM clientes_klido WHERE id=$1',['cli_'+tel]); await pgPool.query(`INSERT INTO clientes_klido (id,agencia_id,telefono,etiqueta,estado_embudo,score,ultimo_mensaje,leido,origen_campana) VALUES ($1,$2,$3,$4,$5,$6,NOW(),false,$7) ON CONFLICT (id) DO UPDATE SET etiqueta=$4, ultimo_mensaje=NOW(), leido=false, score=70`,[`cli_${tel}`,agId,tel,'respuesta_campana','contactado',70,ex[0]?.origen_campana||null]); await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion,leido) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[agId,`cli_${tel}`,tel,m.type||'text',m.text?.body||'media',Date.now(),'entrante',false]); }catch(e){console.log('webhook',e.message)} res.sendStatus(200); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido_verify') res.send(req.query['hub.challenge']); else res.sendStatus(403); });
app.get('/admin.html',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/crm.html',(req,res)=>res.sendFile(path.join(__dirname,'public','crm.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 KLIDO V146 - AUTOMATICO MULTI-AGENCIA - ${PORT}`));
