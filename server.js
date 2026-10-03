// KLIDO V153 - COMPLETO DEFINITIVO - TODO TU HISTORIAL + FIX NAMED acol_invitacion_congreso
import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import path from 'path'; import { fileURLToPath } from 'url'; import * as XLSX from 'xlsx'; import http from 'http'; import { Server } from 'socket.io';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); const server=http.createServer(app); const io=new Server(server,{cors:{origin:"*"}});
app.use(cors()); app.use(express.json({limit:'100mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v127-resend-force-2026-3133181851';
const PHONE_ENV=process.env.PHONE_NUMBER_ID||'1338474282683914'; const WABA_ENV=process.env.WABA_ID||'2317286332424288';
let TOKEN_ENV=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||''; if(!TOKEN_ENV){ for(const v of Object.values(process.env)){ if(typeof v==='string'&&v.startsWith('EAAT')&&v.length>80){TOKEN_ENV=v;break;}}}

async function initDB(){
await pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT DEFAULT 'basico', plan_activo BOOLEAN DEFAULT true, token TEXT, phone_id TEXT, waba_id TEXT, meta_token TEXT, equipo JSONB DEFAULT '[]', creado BIGINT, mantenimiento BIGINT, anual_vence BIGINT, api_status TEXT DEFAULT 'pendiente', limite_usado INT DEFAULT 0, contrato_firmado BOOLEAN DEFAULT false)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS clientes_klido (id TEXT PRIMARY KEY, agencia_id TEXT, telefono TEXT, nombre TEXT, datos JSONB DEFAULT '{}', recordatorio TIMESTAMP, etiqueta TEXT DEFAULT 'nuevo', estado_embudo TEXT DEFAULT 'nuevo', asesor_id TEXT, ultimo_mensaje TIMESTAMP DEFAULT NOW(), score INT DEFAULT 0, origen_campana TEXT, leido BOOLEAN DEFAULT true, email TEXT, direccion TEXT, notas TEXT, no_leido INT DEFAULT 0, origen TEXT DEFAULT 'manual')`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS mensajes_klido (id SERIAL PRIMARY KEY, agencia_id TEXT, cliente_id TEXT, telefono TEXT, tipo TEXT, contenido TEXT, url TEXT, timestamp BIGINT, direccion TEXT, leido BOOLEAN DEFAULT false, mime TEXT, media_id TEXT, estado TEXT DEFAULT 'enviado')`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', pausada BOOLEAN DEFAULT false, historial JSONB DEFAULT '[]', creada BIGINT, terminada BIGINT, numeros JSONB DEFAULT '[]', bloque_actual INT DEFAULT 0)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS asesores (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, telefono TEXT, email TEXT, activo BOOLEAN DEFAULT true, rol TEXT DEFAULT 'worker')`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS otps (id SERIAL PRIMARY KEY, email TEXT, codigo TEXT, tipo TEXT, expira TIMESTAMP)`);
try{
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS meta_token TEXT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS phone_id TEXT`);
await pgPool.query(`ALTER TABLE agencias ADD COLUMN IF NOT EXISTS waba_id TEXT`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS no_leido INT DEFAULT 0`);
await pgPool.query(`ALTER TABLE clientes_klido ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'manual'`);
}catch{}
try{ if(TOKEN_ENV){ await pgPool.query(`UPDATE agencias SET meta_token=COALESCE(NULLIF(meta_token,''),$1), phone_id=COALESCE(NULLIF(phone_id,''),$2), waba_id=COALESCE(NULLIF(waba_id,''),$3), api_status='conectado' WHERE meta_token IS NULL OR meta_token='' OR phone_id IS NULL OR phone_id=''`,[TOKEN_ENV,PHONE_ENV,WABA_ENV]); console.log('🔧 V153 Auto-guardado ENV OK - no borra nada'); } }catch(e){}
console.log('✅ KLIDO V153 COMPLETO - NO BORRA DATOS - FIX NAMED');
} initDB();

function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }}
async function obtenerEmpresas(){ const {rows}=await pgPool.query('SELECT * FROM agencias'); return rows.map(r=>({id:r.id,phoneIdEfectivo:r.phone_id||PHONE_ENV,wabaIdEfectivo:r.waba_id||WABA_ENV,metaTokenEfectivo:r.meta_token||TOKEN_ENV})); }
const codigosTemp=new Map();
async function enviarMail(para,asunto,html){ const KEY=process.env.RESEND_API_KEY; if(!KEY) return; try{ await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'KLIDO <soporte@klidoapp.com.co>',to:para,subject:asunto,html})}); }catch{} }
function normalizaNumeros(arr){ let out=[]; arr.forEach(raw=>{ String(raw||'').split(/[,;\n|]+/).forEach(p=>{ let d=p.replace(/\D/g,''); if(d.endsWith('.0')) d=d.slice(0,-2); if(d.length===10&&d.startsWith('3')) d='57'+d; if(d.length===12&&d.startsWith('57')) out.push(d); if(d.length>12){ const m=d.match(/3\d{9}/g); if(m) m.forEach(x=>out.push('57'+x)); } }); }); return [...new Set(out)].filter(n=>/^57[3]\d{9}$/.test(n)); }

// --- FIX DEFINITIVO PARA acol_invitacion_congreso ---
async function getTemplateAuto(plantilla, emp){
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`);
  const j=await r.json(); const t=j.data?.find(x=>x.name===plantilla && x.status==='APPROVED')||j.data?.find(x=>x.name===plantilla); if(!t) return null;
  let varNames=[]; (t.components||[]).forEach(c=>{ if(c.text){ const ms=[...c.text.matchAll(/\{\{([^}]+)\}\}/g)]; ms.forEach(m=>varNames.push(m[1].trim())); } });
  console.log(`✅ TEMPLATE ${t.name} lang:${t.language} vars:${JSON.stringify(varNames)}`);
  return { language:t.language, varNames };
 }catch{ return null; }
}

async function enviarCampanaProceso(campId, agenciaId){
  try{
    const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE id=$1',[campId]); if(!rows[0]) return;
    let camp=rows[0]; let numeros=camp.numeros; if(typeof numeros==='string') numeros=JSON.parse(numeros); numeros=normalizaNumeros(numeros);
    const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===agenciaId);
    let variables=[]; try{ const hist=typeof camp.historial==='string'?JSON.parse(camp.historial):camp.historial; variables=hist?.[0]?.variables||['Cliente']; }catch{}
    const meta=await getTemplateAuto(camp.plantilla, emp); if(!meta){ await pgPool.query('UPDATE campanas_klido SET fallidos=$1 WHERE id=$2',[numeros.length,campId]); return; }
    const isNamed = meta.varNames.length>0 && isNaN(parseInt(meta.varNames[0]));
    let vars=variables.length?variables:['Cliente']; if(vars.length<meta.varNames.length) while(vars.length<meta.varNames.length) vars.push('Cliente'); if(vars.length>meta.varNames.length) vars=vars.slice(0,meta.varNames.length);
    const payloadNamed={name:camp.plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: meta.varNames.map((n,i)=>({type:'text', text:String(vars[i]||'Cliente').slice(0,100), parameter_name:n}))}]};
    const payloadNumbered={name:camp.plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: vars.map(v=>({type:'text', text:String(v).slice(0,100)}))}]};
    const attempts = isNamed? [payloadNamed, payloadNumbered] : [payloadNumbered, payloadNamed];
    console.log(`🚀 V153 ${campId} ${camp.plantilla} isNamed:${isNamed} lang:${meta.language} vars:${JSON.stringify(meta.varNames)} total:${numeros.length}`);
    for(const num of numeros){
      const {rows:st}=await pgPool.query('SELECT pausada FROM campanas_klido WHERE id=$1',[campId]); if(st[0]?.pausada){ console.log('⏸️ Pausada'); break; }
      let ok=false;
      for(const attempt of attempts){
        try{
          const tipo=attempt.components[0].parameters[0]?.parameter_name?'NAMED':'NUMBERED';
          const resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify({messaging_product:'whatsapp',to:num,type:'template',template:attempt})});
          const jr=await resp.json(); if(jr.error) throw jr.error;
          await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1, bloque_actual=bloque_actual+1 WHERE id=$1',[campId]); await pgPool.query('UPDATE agencias SET limite_usado=limite_usado+1 WHERE id=$1',[agenciaId]);
          await pgPool.query(`INSERT INTO clientes_klido (id,agencia_id,telefono,nombre,origen,etiqueta) VALUES ($1,$2,$3,$4,'campana','campana') ON CONFLICT (id) DO UPDATE SET origen='campana'`,[`cli_${num}`,agenciaId,num,vars[0]||'Cliente']);
          console.log(`✅ ${num} ENVIADO con ${tipo} ID:${jr.messages?.[0]?.id}`); ok=true; break;
        }catch(e){ const msg=(e.error_user_msg||e.message||JSON.stringify(e)).slice(0,400); console.log(`⚠️ ${num} falló: ${msg}`); }
      }
      if(!ok) await pgPool.query(`UPDATE campanas_klido SET fallidos=fallidos+1 WHERE id=$1`,[campId]);
      await new Promise(r=>setTimeout(r,1500));
    }
    await pgPool.query('UPDATE campanas_klido SET estado=$1,terminada=$2 WHERE id=$3',['terminada',Date.now(),campId]);
    io.emit('campana_terminada',{campId});
  }catch(e){ console.log('proc error',e.message); }
}

// --- RUTAS COMPLETAS - NO TE QUITA NADA ---
app.get('/api/health',(req,res)=>res.json({ok:true,version:'v153-completo-no-borra-fix-named'}));
app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

// Auth completo
app.post('/api/auth/register-init', async(req,res)=>{ try{ const {nombre,email,password,plan}=req.body; const {rows}=await pgPool.query('SELECT email FROM agencias WHERE email=$1',[email]); if(rows[0]) return res.status(400).json({error:'Ya existe'}); const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosTemp.set(email,{codigo,expira:Date.now()+15*60*1000,datos:{nombre,email,password,plan:plan||'basico'}}); await enviarMail(email,`Código Klido ${codigo}`,`<h1>${codigo}</h1><p>Plan ${plan} - Activa en wa.me/573133181851</p>`); res.json({ok:true, whatsapp:`https://wa.me/573133181851?text=Quiero%20Plan%20${plan}%20Empresa:${nombre}`}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/register-verify', async(req,res)=>{ try{ const {email,codigo}=req.body; const t=codigosTemp.get(email); if(!t||t.codigo!==codigo) return res.status(400).json({error:'Código inválido'}); const {nombre,password,plan}=t.datos; const id='ag_'+Date.now(); const hash=await bcrypt.hash(password,10); const ahora=Date.now(); await pgPool.query('INSERT INTO agencias (id,nombre,email,password,plan,plan_activo,token,creado,mantenimiento,anual_vence,api_status,limite_usado,phone_id,waba_id,meta_token) VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,0,$11,$12,$13)',[id,nombre,email,hash,plan||'basico',jwt.sign({agenciaId:id,email},JWT),ahora,ahora+90*24*60*60*1000,ahora+365*24*60*60*1000,'conectado',PHONE_ENV,WABA_ENV,TOKEN_ENV]); codigosTemp.delete(email); res.json({ok:true,token:jwt.sign({agenciaId:id,email,rol:'admin'},JWT)}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/login',async(req,res)=>{ try{ const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); const emp=rows[0]; if(!emp) return res.status(404).json({error:'No existe'}); if(!await bcrypt.compare(password,emp.password)) return res.status(401).json({error:'Clave mala'}); if(!emp.plan_activo) return res.status(403).json({bloqueado:true}); res.json({ok:true,token:jwt.sign({agenciaId:emp.id,email:emp.email,rol:'admin'},JWT),agencia:emp}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/auth/forgot', async(req,res)=>{ const {email}=req.body; const codigo=Math.floor(100000+Math.random()*900000).toString(); codigosTemp.set(email,{codigo}); await enviarMail(email,`Recuperar Klido ${codigo}`,`<h1>${codigo}</h1>`); res.json({ok:true}); });
app.post('/api/auth/reset', async(req,res)=>{ const {email,codigo,password}=req.body; const t=codigosTemp.get(email); if(!t||t.codigo!==codigo) return res.status(400).json({error:'Inválido'}); const hash=await bcrypt.hash(password,10); await pgPool.query('UPDATE agencias SET password=$1 WHERE email=$2',[hash,email]); codigosTemp.delete(email); res.json({ok:true}); });

// Config, Planes, Plantillas
app.get('/api/config',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[req.user.agenciaId]); const e=rows[0]; res.json({phoneId:e.phone_id||'', wabaId:e.waba_id||'', phoneIdEfectivo:e.phone_id||PHONE_ENV, wabaIdEfectivo:e.waba_id||WABA_ENV, tieneToken:!!(e.meta_token||TOKEN_ENV), plan:e.plan, limite:5000, usado:e.limite_usado}); });
app.post('/api/config',auth,async(req,res)=>{ const {phoneId,wabaId,metaToken}=req.body; await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3,api_status=$4 WHERE id=$5',[phoneId||PHONE_ENV,wabaId||WABA_ENV,metaToken||TOKEN_ENV,'conectado',req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/planes',(req,res)=>res.json([{id:'basico',nombre:'BÁSICO',anual:800000,mant:80000,desc:'Básico $800k anual + $80k trimestral',wa:'https://wa.me/573133181851?text=Plan BASICO'},{id:'premium',nombre:'PREMIUM + IA',anual:1300000,mant:95000,desc:'Premium $1.3M anual + $95k trimestral con IA',wa:'https://wa.me/573133181851?text=Plan PREMIUM'},{id:'gold',nombre:'GOLD TOTAL IA+Llamadas',anual:2400000,mant:120000,desc:'Gold $2.4M anual + $120k trimestral IA+Llamadas',wa:'https://wa.me/573133181851?text=Plan GOLD'}]));
app.get('/api/config-info',(req,res)=>res.json({api:'API Oficial WhatsApp Business - Verificada Meta', beneficios:['Plantillas APPROVED auto-sync','Fotos audios archivos nativos','Anti-baneo bloques 50','IA Premium/Gold','Llamadas Gold','Tiempo real socket.io'], wa:'https://wa.me/573133181851'}));
app.get('/api/plantillas',auth,async(req,res)=>{ const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`); const j=await r.json(); res.json(j.data?.filter(t=>t.status==='APPROVED')||j.data||[]); }catch{ res.json([]); }});

// Campañas - Excel + Envío + Pausa
app.post('/api/campanas/parse-excel',auth,async(req,res)=>{ try{ const {dataBase64}=req.body; const buffer=Buffer.from(dataBase64.split(',').pop(), 'base64'); const wb=XLSX.read(buffer,{type:'buffer'}); let nums=[]; wb.SheetNames.forEach(name=>{ const ws=wb.Sheets[name]; const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}); json.forEach(row=>{ row.forEach(cell=>{ nums.push(...normalizaNumeros([String(cell)])); }); }); }); nums=[...new Set(nums)]; res.json({ok:true,total:nums.length,numeros:nums.slice(0,50000)}); }catch(e){ res.status(500).json({error:e.message}); } });
app.post('/api/campanas',auth,async(req,res)=>{ try{ const {nombre,plantilla,numeros,variables}=req.body; const id='camp_'+Date.now(); const validos=normalizaNumeros(numeros); const vars=Array.isArray(variables)?variables:['Cliente']; await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada,historial,numeros,enviados,fallidos,estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9)',[id,req.user.agenciaId,nombre||'Campaña',plantilla,validos.length,Date.now(),JSON.stringify([{variables:vars}]),JSON.stringify(validos),'activa']); enviarCampanaProceso(id, req.user.agenciaId); res.json({ok:true,total:validos.length,id}); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false WHERE id=$1',[req.params.id]); enviarCampanaProceso(req.params.id, req.user.agenciaId); res.json({ok:true}); });
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });

// Clientes con filtros 🔴🟡🟢 + Mensajes con archivos
app.get('/api/clientes',auth,async(req,res)=>{ const {filtro}=req.query; let q=`SELECT * FROM clientes_klido WHERE agencia_id=$1`; if(filtro==='no_leidos') q+=` AND no_leido>0`; if(filtro==='campana') q+=` AND origen='campana'`; if(filtro==='online') q+=` AND ultimo_mensaje > NOW() - INTERVAL '5 minutes'`; q+=` ORDER BY ultimo_mensaje DESC LIMIT 200`; const {rows}=await pgPool.query(q,[req.user.agenciaId]); res.json(rows); });
app.post('/api/clientes/:id/datos',auth,async(req,res)=>{ const {etiqueta}=req.body; await pgPool.query(`UPDATE clientes_klido SET etiqueta=$1 WHERE id=$2`,[etiqueta, req.params.id]); res.json({ok:true}); });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE cliente_id=$1 ORDER BY timestamp ASC',[req.params.clienteId]); res.json(rows); });
app.post('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {contenido,tipo,url}=req.body; const {rows:cl}=await pgPool.query('SELECT telefono FROM clientes_klido WHERE id=$1',[req.params.clienteId]); const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); try{ const payload={messaging_product:'whatsapp',to:cl[0].telefono,type:tipo||'text',...(tipo==='text'?{text:{body:contenido}}:{})}; await fetch(`https://graph.facebook.com/v20.0/${emp.phoneIdEfectivo}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.metaTokenEfectivo}`},body:JSON.stringify(payload)}); }catch{} await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,url,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[req.user.agenciaId,req.params.clienteId,cl[0].telefono,tipo||'text',contenido,url||null,Date.now(),'saliente']); io.emit('new_message',{agencia_id:req.user.agenciaId}); res.json({ok:true}); });

// Dashboard + Trabajadores + Admin
app.get('/api/dashboard',auth,async(req,res)=>{ const tot=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]); const camp=await pgPool.query('SELECT COUNT(*) FROM campanas_klido WHERE agencia_id=$1',[req.user.agenciaId]); const trab=await pgPool.query('SELECT COUNT(*) FROM asesores WHERE agencia_id=$1',[req.user.agenciaId]); res.json({total:tot.rows[0].count, campanas:camp.rows[0].count, trabajadores:trab.rows[0].count}); });
app.get('/api/trabajadores',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM asesores WHERE agencia_id=$1 ORDER BY nombre ASC',[req.user.agenciaId]); res.json(rows); });
app.post('/api/trabajadores',auth,async(req,res)=>{ const {nombre,email,telefono,rol}=req.body; const id='as_'+Date.now(); await pgPool.query('INSERT INTO asesores (id,agencia_id,nombre,email,telefono,rol) VALUES ($1,$2,$3,$4,$5,$6)',[id,req.user.agenciaId,nombre,email,telefono,rol||'worker']); res.json({ok:true,id}); });
app.delete('/api/trabajadores/:id',auth,async(req,res)=>{ await pgPool.query('DELETE FROM asesores WHERE id=$1 AND agencia_id=$2',[req.params.id,req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/admin/agencias',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT id,nombre,email,plan,plan_activo,limite_usado FROM agencias'); res.json({ok:true,agencias:rows}); });

// Webhook + Debug
app.post('/webhook',async(req,res)=>{ try{ const m=req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; if(m){ const tel=m.from; await pgPool.query(`INSERT INTO clientes_klido (id,agencia_id,telefono,etiqueta,no_leido) VALUES ($1,$2,$3,$4,1) ON CONFLICT (id) DO UPDATE SET ultimo_mensaje=NOW(), no_leido=clientes_klido.no_leido+1`,[`cli_${tel}`,'ag_1',tel,'nuevo']); io.emit('new_message',{telefono:tel}); } }catch{} res.sendStatus(200); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido_verify') res.send(req.query['hub.challenge']); else res.sendStatus(403); });
app.get('/api/debug/template-raw',auth,async(req,res)=>{ const emps=await obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.agenciaId); const r=await fetch(`https://graph.facebook.com/v20.0/${emp.wabaIdEfectivo}/message_templates?access_token=${emp.metaTokenEfectivo}&limit=250`); const j=await r.json(); const t=j.data?.find(x=>x.name===req.query.name); res.json(t||{disponibles:j.data?.map(x=>x.name)}); });

io.on('connection',socket=>{ socket.on('join_agencia',id=>socket.join(`agencia_${id}`)); });
const PORT=process.env.PORT||3000; server.listen(PORT,()=>console.log(`🚀 KLIDO V153 COMPLETO - NO BORRA - FIX NAMED ${PORT}`));
