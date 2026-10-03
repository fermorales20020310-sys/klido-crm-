// KLIDO V148 - FINAL - SOPORTE {{nombre_cliente}} + AUTO MULTI-EMPRESA
import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import path from 'path'; import { fileURLToPath } from 'url'; import * as XLSX from 'xlsx';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); app.use(cors()); app.use(express.json({limit:'100mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v127-resend-force-2026-3133181851';
const PHONE_ENV=process.env.PHONE_NUMBER_ID||'1338474282683914'; const WABA_ENV=process.env.WABA_ID||'2317286332424288';
let TOKEN_ENV=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||''; if(!TOKEN_ENV){ for(const v of Object.values(process.env)){ if(typeof v==='string'&&v.startsWith('EAAT')&&v.length>80){TOKEN_ENV=v;break;}}}
const PLANES={basico:{id:'basico',nombre:'BÁSICO',anual:800000,mant:80000,limite:5000,usuarios:3},premium:{id:'premium',nombre:'PREMIUM + IA',anual:1400000,mant:95000,limite:15000,usuarios:10},gold:{id:'gold',nombre:'GOLD TOTAL',anual:2500000,mant:135000,limite:50000,usuarios:999}};
async function initDB(){
await pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT DEFAULT 'basico', plan_activo BOOLEAN DEFAULT true, token TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, equipo JSONB DEFAULT '[]', creado BIGINT, mantenimiento BIGINT, anual_vence BIGINT, api_status TEXT DEFAULT 'pendiente', limite_usado INT DEFAULT 0, contrato_firmado BOOLEAN DEFAULT false)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS clientes_klido (id TEXT PRIMARY KEY, agencia_id TEXT, telefono TEXT, nombre TEXT, datos JSONB DEFAULT '{}', recordatorio TIMESTAMP, etiqueta TEXT DEFAULT 'nuevo', estado_embudo TEXT DEFAULT 'nuevo', asesor_id TEXT, ultimo_mensaje TIMESTAMP DEFAULT NOW(), score INT DEFAULT 0, origen_campana TEXT, leido BOOLEAN DEFAULT true, email TEXT, direccion TEXT, notas TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS mensajes_klido (id SERIAL PRIMARY KEY, agencia_id TEXT, cliente_id TEXT, telefono TEXT, tipo TEXT, contenido TEXT, url TEXT, timestamp BIGINT, direccion TEXT, leido BOOLEAN DEFAULT false, mime TEXT, media_id TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', pausada BOOLEAN DEFAULT false, historial JSONB DEFAULT '[]', creada BIGINT, terminada BIGINT, numeros JSONB DEFAULT '[]')`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS asesores (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, telefono TEXT, email TEXT, activo BOOLEAN DEFAULT true)`);
console.log('✅ KLIDO V148 - SOPORTE {{nombre_cliente}}');
// AUTO-GUARDADO
try{ if(TOKEN_ENV){ await pgPool.query(`UPDATE agencias SET meta_token=COALESCE(NULLIF(meta_token,''),$1), phone_id=COALESCE(NULLIF(phone_id,''),$2), waba_id=COALESCE(NULLIF(waba_id,''),$3), api_status='conectado' WHERE meta_token IS NULL OR meta_token='' OR phone_id IS NULL OR phone_id=''`,[TOKEN_ENV, PHONE_ENV, WABA_ENV]); console.log('🔧 Auto-guardado ENV a agencias vacias'); } }catch(e){console.log(e.message)}
} initDB();
function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }}
function isAdmin(req,res,next){ if(!['admin@klido.com','fermorales20020310@gmail.com'].includes(req.user.email)) return res.status(403).json({error:'Solo admin'}); next(); }
async function checkPlan(req,res,next){ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); if(!rows[0]?.plan_activo) return res.status(403).json({bloqueado:true, error:'BLOQUEADO'}); req.empresa=rows[0]; next(); }
async function obtenerEmpresas(){ const {rows}=await pgPool.query('SELECT * FROM agencias'); return rows.map(r=>({id:r.id,phoneIdEfectivo:r.phone_id||PHONE_ENV,wabaIdEfectivo:r.waba_id||WABA_ENV,metaTokenEfectivo:r.meta_token||TOKEN_ENV})); }
const codigosTemp=new Map();
async function enviarMail(para,asunto,html){ const KEY=process.env.RESEND_API_KEY; if(!KEY) return; try{ const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'KLIDO <soporte@klidoapp.com.co>',to:para,subject:asunto,html})}); return await r.json(); }catch(e){} }
function normalizaNumeros(arr){ let out=[]; arr.forEach(raw=>{ String(raw||'').split(/[,;\n|]+/).forEach(p=>{ let d=p.replace(/\D/g,''); if(d.endsWith('.0')) d=d.slice(0,-2); if(d.length===10&&d.startsWith('3')) d='57'+d; if(d.length===12&&d.startsWith('57')) out.push(d); }); }); return [...new Set(out)].filter(n=>/^57[3]\d{9}$/.test(n)); }
async function getTemplateAuto(plantilla, emp){
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`); const j=await r.json();
  const t=j.data?.find(x=>x.name===plantilla && x.status==='APPROVED')||j.data?.find(x=>x.name===plantilla); if(!t) return null;
  const bodyComp=t.components?.find(c=>c.type==='BODY'); let varNames=[]; if(bodyComp?.text){ const matches=[...bodyComp.text.matchAll(/\{\{([^}]+)\}\}/g)]; varNames=matches.map(m=>m[1].trim()); }
  console.log(`✅ TEMPLATE ${t.name} lang:${t.language} vars:${JSON.stringify(varNames)} text:${bodyComp?.text?.slice(0,120)}`);
  return { language:t.language, varNames, template:t };
 }catch(e){ return null; }
}
function buildPayloadAuto(plantilla, variables, meta){
  const lang=meta?.language||'es_CO'; const varNames=meta?.varNames||[]; let vars=Array.isArray(variables)?[...variables]:[];
  if(!vars.length) vars=['Cliente']; // valor por defecto si no mandan nada
  // Ajustar cantidad
  if(vars.length < varNames.length) while(vars.length < varNames.length) vars.push('Cliente');
  if(vars.length > varNames.length) vars=vars.slice(0,varNames.length);
  const payload={name:plantilla, language:{code:lang}};
  if(varNames.length){
    const params=varNames.map((name,idx)=>{
      const val=String(vars[idx]||'Cliente').slice(0,100);
      if(/^\d+$/.test(name)){ return {type:'text', text:val}; } // {{1}}
      else { return {type:'text', text:val, parameter_name:name}; } // {{nombre_cliente}}
    });
    payload.components=[{type:'body', parameters:params}];
  }
  return payload;
}
async function enviarCampanaProceso(campId, agenciaId){
  try{
    const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE id=$1',[campId]); if(!rows[0]) return; let camp=rows[0]; let numeros=camp.numeros; if(typeof numeros==='string') numeros=JSON.parse(numeros); numeros=normalizaNumeros(numeros);
    const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===agenciaId);
    let variables=[]; try{ const hist=typeof camp.historial==='string'?JSON.parse(camp.historial):camp.historial; variables=hist?.[0]?.variables||['Cliente']; }catch{}
    const meta=await getTemplateAuto(camp.plantilla, emp); if(!meta){ await pgPool.query(`UPDATE campanas_klido SET fallidos=$1 WHERE id=$2`,[numeros.length, campId]); return; }
    console.log(`🚀 V148 ${campId} lang:${meta.language} vars:${JSON.stringify(meta.varNames)} enviando:${JSON.stringify(variables)}`);
    for(const num of numeros){
      try{
        const tpl=buildPayloadAuto(camp.plantilla, variables, meta);
        console.log(`📤 Payload ${num}:`, JSON.stringify(tpl).slice(0,400));
        const resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:num,type:'template',template:tpl})});
        const jr=await resp.json(); if(jr.error) throw jr.error;
        await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1 WHERE id=$1',[campId]);
        await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[agenciaId]);
        console.log(`✅ ${num} ENVIADO`);
      }catch(e){ const msg=(e.error_user_msg||e.message||JSON.stringify(e)).slice(0,500); await pgPool.query(`UPDATE campanas_klido SET fallidos=fallidos+1, historial=COALESCE(historial,'[]'::jsonb)||$1::jsonb WHERE id=$2`,[JSON.stringify([{error:msg, telefono:num}]), campId]); console.log(`❌ ${num} FALLIDO:`,msg); }
      await new Promise(r=>setTimeout(r,1500));
    }
    await pgPool.query('UPDATE campanas_klido SET estado=$1,terminada=$2 WHERE id=$3',['terminada',Date.now(),campId]);
  }catch(e){ console.log(e.message); }
}
app.get('/api/health',(req,res)=>res.json({ok:true,version:'v148-named-vars-final'}));
app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.post('/api/auth/register-init', async(req,res)=>{ const {nombre,email,password,plan}=req.body; const {rows}=await pgPool.query('SELECT email FROM agencias WHERE email=$1',[email]); if(rows[0]) return res.status(400).json({error:'Ya existe'}); const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosTemp.set(email,{codigo,expira:Date.now()+30*60*1000,datos:{nombre,email,password,plan}}); await enviarMail(email,`Código ${codigo}`,`<p>${codigo}</p>`); res.json({ok:true}); });
app.post('/api/auth/register-verify', async(req,res)=>{ const {email,codigo}=req.body; const t=codigosTemp.get(email); if(!t||t.codigo!==codigo) return res.status(400).json({error:'Código malo'}); const {nombre,password,plan}=t.datos; const id='ag_'+Date.now(); const hash=await bcrypt.hash(password,10); const ahora=Date.now(); await pgPool.query('INSERT INTO agencias (id,nombre,email,password,plan,plan_activo,token,creado,mantenimiento,anual_vence,api_status,limite_usado,phone_id,waba_id,meta_token) VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,0,$11,$12,$13)',[id,nombre,email,hash,plan||'basico',jwt.sign({agenciaId:id,email},JWT),ahora,ahora+90*24*60*60*1000,ahora+365*24*60*60*1000,'conectado',PHONE_ENV,WABA_ENV,TOKEN_ENV]); codigosTemp.delete(email); console.log(`✅ Nueva agencia ${id} auto-guardada con ENV ${PHONE_ENV}`); res.json({ok:true,token:jwt.sign({agenciaId:id,email},JWT)}); });
app.post('/api/auth/login',async(req,res)=>{ const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); const emp=rows[0]; if(!emp) return res.status(404).json({error:'No existe'}); if(!await bcrypt.compare(password,emp.password)) return res.status(401).json({error:'Clave mala'}); res.json({ok:true,token:jwt.sign({agenciaId:emp.id,email},JWT),agencia:emp}); });
app.get('/api/config',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const e=rows[0]; res.json({tieneConfig:!!e.phone_id, phoneId:e.phone_id||PHONE_ENV, wabaId:e.waba_id||WABA_ENV, tieneToken:!!(e.meta_token||TOKEN_ENV), auto:true}); });
app.post('/api/config',auth,async(req,res)=>{ const {phoneId,wabaId,metaToken}=req.body; await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3 WHERE id=$4',[phoneId||PHONE_ENV,wabaId||WABA_ENV,metaToken||TOKEN_ENV,req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/plantillas',auth,async(req,res)=>{ const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`); const j=await r.json(); res.json(j.data?.filter(t=>t.status==='APPROVED')||[]); }catch{ res.json([]); }});
app.post('/api/campanas/parse-excel',auth,async(req,res)=>{ const {dataBase64}=req.body; const buffer=Buffer.from(dataBase64.split(',').pop(), 'base64'); const wb=XLSX.read(buffer,{type:'buffer'}); let nums=[]; wb.SheetNames.forEach(n=>{ const ws=wb.Sheets[n]; const json=XLSX.utils.sheet_to_json(ws,{header:1}); json.forEach(row=>row.forEach(c=>nums.push(...normalizaNumeros([String(c)])))); }); nums=[...new Set(nums)]; res.json({ok:true,total:nums.length,numeros:nums}); });
app.post('/api/campanas',auth,checkPlan,async(req,res)=>{ const {nombre,plantilla,numeros,variables}=req.body; const id='camp_'+Date.now(); const validos=normalizaNumeros(numeros); const vars=variables||['Cliente']; await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada,historial,numeros,enviados,fallidos,estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9)',[id,req.user.agenciaId,nombre||'Camp',plantilla,validos.length,Date.now(),JSON.stringify([{variables:vars}]),JSON.stringify(validos),'activa']); enviarCampanaProceso(id, req.user.agenciaId); res.json({ok:true,total:validos.length,id}); });
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });
app.get('/api/clientes',auth,async(req,res)=>{ const {rows}=await pgPool.query(`SELECT * FROM clientes_klido WHERE agencia_id=$1 ORDER BY ultimo_mensaje DESC`,[req.user.agenciaId]); res.json(rows); });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE cliente_id=$1 ORDER BY timestamp ASC',[req.params.clienteId]); res.json(rows); });
app.post('/api/mensajes/:clienteId',auth,checkPlan,async(req,res)=>{ const {contenido}=req.body; const {rows:cl}=await pgPool.query('SELECT telefono FROM clientes_klido WHERE id=$1',[req.params.clienteId]); const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:cl[0].telefono,type:'text',text:{body:contenido}})}); const j=await r.json(); if(j.error) throw j.error; await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7)',[req.user.agenciaId,req.params.clienteId,cl[0].telefono,'text',contenido,Date.now(),'saliente']); res.json({ok:true}); });
app.get('/api/dashboard',auth,async(req,res)=>{ const tot=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]); res.json({total:tot.rows[0].count}); });
app.post('/webhook',async(req,res)=>{ res.sendStatus(200); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido_verify') res.send(req.query['hub.challenge']); else res.sendStatus(403); });
const PORT=process.env.PORT||3000; app.listen(PORT,()=>console.log(`🚀 KLIDO V148 - NAMED VARS FINAL - ${PORT}`));
