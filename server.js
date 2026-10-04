// KLIDO v143 TU V140 + FIX media_id - SIN DAÑAR NADA
import express from 'express'; import cors from 'cors'; import pg from 'pg'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import path from 'path'; import { fileURLToPath } from 'url'; import * as XLSX from 'xlsx'; import http from 'http'; import { Server } from 'socket.io';
const __filename=fileURLToPath(import.meta.url); const __dirname=path.dirname(__filename);
const app=express(); const server=http.createServer(app); const io=new Server(server,{cors:{origin:"*", methods:["GET","POST"]}});
app.use(cors({origin:"*"})); app.use(express.json({limit:'100mb'})); app.use(express.static(path.join(__dirname,'public')));
const {Pool}=pg; const pgPool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const JWT=process.env.JWT_SECRET||'klido-v139-full-fix'; const GERENTE_CLAVE='klido123'; const GERENTE_LINK='/gerente-klido-3133181851';
const PHONE_ENV=process.env.PHONE_NUMBER_ID||'1338474282683914'; const WABA_ENV=process.env.WABA_ID||'2317286332424288'; let TOKEN_ENV=process.env.META_TOKEN||process.env.WHATSAPP_TOKEN||''; if(!TOKEN_ENV){ for(const v of Object.values(process.env)){ if(typeof v==='string'&&v.startsWith('EAAT')&&v.length>80){TOKEN_ENV=v;break;}}}

async function initDB(){
await pgPool.query(`CREATE TABLE IF NOT EXISTS agencias (id TEXT PRIMARY KEY, nombre TEXT, email TEXT UNIQUE, password TEXT, plan TEXT DEFAULT 'basico', plan_activo BOOLEAN DEFAULT true, phone_id TEXT, waba_id TEXT, meta_token TEXT, creado BIGINT, limite_usado INT DEFAULT 0, mantenimiento BIGINT, anual_vence BIGINT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS clientes_klido (id TEXT PRIMARY KEY, agencia_id TEXT, telefono TEXT, nombre TEXT, email TEXT, datos JSONB DEFAULT '{}', recordatorio TIMESTAMP, etiqueta TEXT DEFAULT 'Nuevo', estado_embudo TEXT DEFAULT 'Nuevo', asesor_id TEXT, ultimo_mensaje TIMESTAMP DEFAULT NOW(), origen TEXT DEFAULT 'manual', no_leido INT DEFAULT 0, notas TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS mensajes_klido (id SERIAL PRIMARY KEY, agencia_id TEXT, cliente_id TEXT, telefono TEXT, tipo TEXT, contenido TEXT, url TEXT, timestamp BIGINT, direccion TEXT, mime TEXT, media_id TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_klido (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, plantilla TEXT, tipo TEXT DEFAULT 'whatsapp', total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', pausada BOOLEAN DEFAULT false, historial JSONB DEFAULT '[]', creada BIGINT, terminada BIGINT, numeros JSONB DEFAULT '[]', bloque_actual INT DEFAULT 0, programada BIGINT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS campanas_gmail (id TEXT PRIMARY KEY, agencia_id TEXT, asunto TEXT, cuerpo TEXT, total INT, enviados INT DEFAULT 0, fallidos INT DEFAULT 0, estado TEXT DEFAULT 'activa', creada BIGINT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS asesores (id TEXT PRIMARY KEY, agencia_id TEXT, nombre TEXT, telefono TEXT, email TEXT, activo BOOLEAN DEFAULT true, rol TEXT DEFAULT 'worker', password TEXT)`);
await pgPool.query(`CREATE TABLE IF NOT EXISTS soporte_klido (id SERIAL PRIMARY KEY, agencia_id TEXT, mensaje TEXT, fecha BIGINT)`);
// --- FIX UNICO QUE FALTABA: tu tabla vieja no tenia media_id ---
await pgPool.query(`ALTER TABLE mensajes_klido ADD COLUMN IF NOT EXISTS media_id TEXT`);
await pgPool.query(`ALTER TABLE mensajes_klido ADD COLUMN IF NOT EXISTS mime TEXT`);
await pgPool.query(`ALTER TABLE mensajes_klido ADD COLUMN IF NOT EXISTS url TEXT`);
await pgPool.query(`ALTER TABLE mensajes_klido ADD COLUMN IF NOT EXISTS direccion TEXT`);
console.log('✅ V143 DB OK + migracion media_id - Webhook klido123 - Envio fix 24h');
} initDB();

function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }}
function authGerente(req,res,next){ const k=req.headers['x-gerente-clave']||req.query.clave; if(k!==GERENTE_CLAVE) return res.status(401).json({error:'Clave gerente mala'}); next(); }
async function getEmp(id){
  if(!id){ return {id:'default', phone:PHONE_ENV, waba:WABA_ENV, token:TOKEN_ENV, plan:'basico'}; }
  const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[id]);
  let r=rows[0]; if(!r){ const {rows:all}=await pgPool.query('SELECT * FROM agencias ORDER BY creado ASC LIMIT 1'); r=all[0]; }
  if(!r) return {id:'default', phone:PHONE_ENV, waba:WABA_ENV, token:TOKEN_ENV, plan:'basico'};
  return {id:r.id, phone:r.phone_id||PHONE_ENV, waba:r.waba_id||WABA_ENV, token:r.meta_token||TOKEN_ENV, plan:r.plan||'basico', nombre:r.nombre, activo:r.plan_activo};
}
function normalizaNumeros(arr){ let out=[]; arr.forEach(raw=>{ String(raw||'').split(/[,;\n|]+/).forEach(p=>{ let d=p.replace(/\D/g,''); if(d.endsWith('.0')) d=d.slice(0,-2); if(d.length===10&&d.startsWith('3')) d='57'+d; if(d.length===12&&d.startsWith('57')) out.push(d); if(d.length>12){ const m=d.match(/3\d{9}/g); if(m) m.forEach(x=>out.push('57'+x)); } }); }); return [...new Set(out)].filter(n=>/^57[3]\d{9}$/.test(n)); }
function extraeEmails(arr){ let out=[]; const re=/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g; arr.forEach(raw=>{ const ms=String(raw).match(re); if(ms) out.push(...ms); }); return [...new Set(out.map(e=>e.toLowerCase()))]; }
async function enviarMailResend(para,asunto,html){ const KEY=process.env.RESEND_API_KEY; if(!KEY) throw new Error('Falta RESEND_API_KEY en Railway'); await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'KLIDO <soporte@klidoapp.com.co>',to:para,subject:asunto,html})}); }
async function getMeta(p,emp){ try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=250`); const j=await r.json(); const t=j.data?.find(x=>x.name===p); if(!t) return null; let v=[]; (t.components||[]).forEach(c=>{ if(c.text){ [...c.text.matchAll(/\{\{([^}]+)\}\}/g)].forEach(m=>v.push(m[1].trim())); } }); return {language:t.language,varNames:v}; }catch{ return null; }}

// LOGIN INTACTO
app.post('/api/auth/login',async(req,res)=>{ try{ const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); if(!rows[0]){ const {rows:as}=await pgPool.query('SELECT * FROM asesores WHERE email=$1',[email]); if(!as[0]) return res.status(404).json({error:'No existe'}); if(!await bcrypt.compare(password,as[0].password||'')) return res.status(401).json({error:'Clave mala'}); const emp=await getEmp(as[0].agencia_id); if(!emp.activo) return res.status(403).json({error:'Agencia bloqueada por Gerente KLIDO'}); return res.json({ok:true,token:jwt.sign({agenciaId:as[0].agencia_id, asesorId:as[0].id, rol:'worker'},JWT), rol:'worker'}); } if(!await bcrypt.compare(password,rows[0].password)) return res.status(401).json({error:'Clave mala'}); if(!rows[0].plan_activo) return res.status(403).json({error:'Agencia bloqueada por Gerente'}); res.json({ok:true,token:jwt.sign({agenciaId:rows[0].id, rol:'admin'},JWT), rol:'admin'}); }catch(e){ res.status(500).json({error:e.message}); }});

// CONFIG
app.get('/api/config',auth,async(req,res)=>{ const emp=await getEmp(req.user.agenciaId); res.json({phoneId:emp.phone, wabaId:emp.waba, tieneToken:emp.token.length>50, plan:emp.plan, empresa:emp.nombre}); });
app.post('/api/config',auth,async(req,res)=>{ const {phoneId,wabaId,metaToken}=req.body; if(!phoneId||!wabaId||!metaToken) return res.status(400).json({error:'Faltan datos'}); await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3 WHERE id=$4',[phoneId,wabaId,metaToken,req.user.agenciaId]); console.log(`✅ Config guardada ${req.user.agenciaId} phone:${phoneId}`); res.json({ok:true}); });
app.get('/api/config-info',(req,res)=>res.json({que:'KLIDO CRM Oficial API Verificada', beneficios:['Multi-empresa individual','Bandeja fotos/videos/archivos/audios con play','Historial seguimiento','Calendario + recordatorios','Excel auto telefonos','Excel auto emails @','Plantillas auto','Pausa programar','Tiempo real'], premium:'IA + Pasar a humano', gold:'IA + Llamadas directas + Gmail', wa:'https://wa.me/573133181851'}));
app.get('/api/planes',(req,res)=>res.json([{id:'basico',nombre:'BÁSICO',anual:800000,trimestral:80000},{id:'premium',nombre:'PREMIUM + IA',anual:1300000,trimestral:95000},{id:'gold',nombre:'GOLD TOTAL',anual:2400000,trimestral:120000}]));
app.get('/api/plantillas',auth,async(req,res)=>{ const emp=await getEmp(req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=250`); const j=await r.json(); const ap=(j.data||[]).filter(t=>t.status==='APPROVED'); console.log(`📋 ${ap.length} plantillas aprobadas ${emp.id}`); res.json(ap); }catch(e){ console.log('plantillas error',e.message); res.json([]); }});

// BANDEJA
app.get('/api/clientes',auth,async(req,res)=>{ const {filtro,buscar}=req.query; let q=`SELECT * FROM clientes_klido WHERE agencia_id=$1`; let p=[req.user.agenciaId]; if(req.user.rol==='worker'){ q+=` AND asesor_id=$2`; p=[req.user.agenciaId, req.user.asesorId]; } if(filtro==='no_leidos') q+=` AND no_leido>0`; if(filtro==='campana') q+=` AND origen='campana'`; if(buscar){ q+=` AND (telefono ILIKE $${p.length+1} OR nombre ILIKE $${p.length+1})`; p.push(`%${buscar}%`); } q+=` ORDER BY ultimo_mensaje DESC LIMIT 300`; const {rows}=await pgPool.query(q,p); res.json(rows); });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE cliente_id=$1 ORDER BY timestamp ASC LIMIT 1000',[req.params.clienteId]); res.json(rows); });

// --- ENVIO ARREGLADO 24H + PLANTILLA FALLBACK ---
app.post('/api/mensajes/:clienteId',auth,async(req,res)=>{
  try{
    const {contenido}=req.body; if(!contenido) return res.status(400).json({error:'Sin contenido'});
    const {rows:cl}=await pgPool.query('SELECT telefono FROM clientes_klido WHERE id=$1',[req.params.clienteId]);
    if(!cl[0]) return res.status(404).json({error:'Cliente no encontrado'});
    const emp=await getEmp(req.user.agenciaId);
    console.log(`📤 Enviando a ${cl[0].telefono} desde ${emp.phone} agencia ${emp.id}`);
    let resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify({messaging_product:'whatsapp',to:cl[0].telefono,type:'text',text:{body:contenido}})});
    let j=await resp.json();
    console.log('📤 Meta texto:', JSON.stringify(j).slice(0,800));
    if(j.error){
      const msgErr=(j.error.message||'').toLowerCase();
      const isWindow = j.error.code===131047 || j.error.code===470 || msgErr.includes('24') || msgErr.includes('window') || msgErr.includes('outside');
      if(isWindow){
        console.log('⚠️ Fuera de 24h, enviando plantilla acol_invitacion_congreso');
        const plantilla='acol_invitacion_congreso';
        const meta=await getMeta(plantilla, emp);
        if(meta){
          const isNamed=meta.varNames.length>0 && isNaN(parseInt(meta.varNames[0]));
          const tpl=isNamed? {name:plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: meta.varNames.map(n=>({type:'text', text:contenido.slice(0,80), parameter_name:n}))}]} : {name:plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: [{type:'text', text:contenido.slice(0,80)}]}]};
          resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify({messaging_product:'whatsapp',to:cl[0].telefono,type:'template',template:tpl})});
          j=await resp.json();
          console.log('📤 Meta plantilla fallback:', JSON.stringify(j).slice(0,800));
        }
      }
      if(j.error){
        console.log('❌ Error final Meta:', j.error);
        return res.status(400).json({error:j.error.message, detalle:j.error, tip:'Si es fuera de 24h, usa Campaña con plantilla'});
      }
    }
    await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7)',[req.user.agenciaId,req.params.clienteId,cl[0].telefono,'text',contenido,Date.now(),'saliente']);
    await pgPool.query('UPDATE clientes_klido SET ultimo_mensaje=NOW(), no_leido=0 WHERE id=$1',[req.params.clienteId]);
    io.to(`agencia_${req.user.agenciaId}`).emit('new_message',{agencia_id:req.user.agenciaId}); io.emit('new_message',{agencia_id:req.user.agenciaId});
    console.log(`✅ ENVIADO OK a ${cl[0].telefono}`);
    res.json({ok:true, meta:j});
  }catch(e){ console.log('❌ envio error',e.message); res.status(500).json({error:e.message}); }
});

app.post('/api/clientes/:id/datos',auth,async(req,res)=>{ const {etiqueta,embudo,asesor,notas,recordatorio,nombre,email}=req.body; await pgPool.query(`UPDATE clientes_klido SET etiqueta=COALESCE($1,etiqueta), estado_embudo=COALESCE($2,estado_embudo), asesor_id=COALESCE($3,asesor_id), notas=COALESCE($4,notas), recordatorio=COALESCE($5,recordatorio), nombre=COALESCE($6,nombre), email=COALESCE($7,email) WHERE id=$8`,[etiqueta,embudo,asesor,notas,recordatorio?new Date(recordatorio):null,nombre,email,req.params.id]); io.emit('update_cliente',{id:req.params.id}); res.json({ok:true}); });
app.get('/api/recordatorios',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM clientes_klido WHERE agencia_id=$1 AND recordatorio IS NOT NULL ORDER BY recordatorio ASC',[req.user.agenciaId]); res.json(rows); });

// CAMPAÑAS
app.post('/api/campanas/parse-excel',auth,async(req,res)=>{ try{ const {dataBase64}=req.body; const buffer=Buffer.from(dataBase64.split(',').pop(),'base64'); const wb=XLSX.read(buffer,{type:'buffer'}); let nums=[], emails=[]; wb.SheetNames.forEach(n=>{ const ws=wb.Sheets[n]; const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}); json.forEach(r=>{ r.forEach(c=>{ nums.push(...normalizaNumeros([String(c)])); emails.push(...extraeEmails([String(c)])); }); }); }); res.json({ok:true, numeros:[...new Set(nums)], emails:[...new Set(emails)], total:nums.length, totalEmails:emails.length}); }catch(e){ res.status(500).json({error:e.message}); }});
async function procesaWPP(id){
  const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return; let c=rows[0]; if(c.programada && c.programada>Date.now()){ console.log(`⏰ Campaña ${id} programada para ${new Date(c.programada)}`); setTimeout(()=>procesaWPP(id), c.programada-Date.now()); return; }
  let nums=c.numeros; if(typeof nums==='string') nums=JSON.parse(nums); nums=normalizaNumeros(nums); const emp=await getEmp(c.agencia_id); const meta=await getMeta(c.plantilla, emp); if(!meta){ console.log(`❌ Plantilla ${c.plantilla} no encontrada ${emp.id}`); return; }
  let vars=[]; try{ const h=typeof c.historial==='string'?JSON.parse(c.historial):c.historial; vars=h?.[0]?.variables||[]; }catch{} if(vars.length<meta.varNames.length) while(vars.length<meta.varNames.length) vars.push('Cliente'); vars=vars.slice(0,meta.varNames.length);
  const isNamed=meta.varNames.length>0 && isNaN(parseInt(meta.varNames[0])); const pn={name:c.plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: meta.varNames.map((n,i)=>({type:'text', text:String(vars[i]||'Cliente').slice(0,100), parameter_name:n}))}]}; const pnum={name:c.plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: vars.map(v=>({type:'text', text:String(v).slice(0,100)}))}]}; const atts=isNamed?[pn,pnum]:[pnum,pn];
  console.log(`🚀 Campaña ${id} ${c.plantilla} total:${nums.length}`);
  for(let i=c.bloque_actual||0;i<nums.length;i++){ const {rows:st}=await pgPool.query('SELECT pausada FROM campanas_klido WHERE id=$1',[id]); if(st[0]?.pausada){ await pgPool.query('UPDATE campanas_klido SET bloque_actual=$1 WHERE id=$2',[i,id]); return; } let ok=false; for(const att of atts){ try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify({messaging_product:'whatsapp',to:nums[i],type:'template',template:att})}); const j=await r.json(); if(j.error) throw j.error; await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1, bloque_actual=$1 WHERE id=$2',[i+1,id]); ok=true; io.to(`agencia_${c.agencia_id}`).emit('campana_update',{id, enviados:i+1, total:nums.length}); console.log(`✅ ${nums[i]} enviado campaña ${id}`); break; }catch(e){ console.log(`❌ Fallo ${nums[i]}`, e.message||e); } } if(!ok) await pgPool.query('UPDATE campanas_klido SET fallidos=fallidos+1 WHERE id=$1',[id]); await new Promise(r=>setTimeout(r,1800)); if((i+1)%50===0){ await new Promise(r=>setTimeout(r,60000)); } }
  await pgPool.query('UPDATE campanas_klido SET estado=$1,terminada=$2 WHERE id=$3',['terminada',Date.now(),id]); io.emit('campana_terminada',{id});
}
app.post('/api/campanas',auth,async(req,res)=>{ try{ const {nombre,plantilla,numeros,variables,programada}=req.body; if(!plantilla||!numeros) return res.status(400).json({error:'Falta plantilla o numeros'}); const id='camp_'+Date.now(); const prog=programada?new Date(programada).getTime():null; const validos=normalizaNumeros(numeros); await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada,historial,numeros,programada) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,req.user.agenciaId,nombre||plantilla,plantilla,validos.length,Date.now(),JSON.stringify([{variables:variables||['Cliente']}]),JSON.stringify(validos),prog]); if(!prog) procesaWPP(id); else setTimeout(()=>procesaWPP(id), prog-Date.now()); res.json({ok:true,id,total:validos.length}); }catch(e){ res.status(500).json({error:e.message}); }});
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false WHERE id=$1',[req.params.id]); procesaWPP(req.params.id); res.json({ok:true}); });
app.post('/api/campanas/gmail',auth,async(req,res)=>{ try{ const {asunto,cuerpo,emails}=req.body; const id='gmail_'+Date.now(); const vals=extraeEmails(emails); if(!vals.length) return res.status(400).json({error:'No emails con @'}); await pgPool.query('INSERT INTO campanas_gmail (id,agencia_id,asunto,cuerpo,total,creada) VALUES ($1,$2,$3,$4,$5,$6)',[id,req.user.agenciaId,asunto,cuerpo,vals.length,Date.now()]); (async()=>{ for(const e of vals){ try{ await enviarMailResend(e,asunto,cuerpo); await pgPool.query('UPDATE campanas_gmail SET enviados=enviados+1 WHERE id=$1',[id]); io.emit('gmail_update',{id}); }catch{ await pgPool.query('UPDATE campanas_gmail SET fallidos=fallidos+1 WHERE id=$1',[id]); } await new Promise(r=>setTimeout(r,800)); } await pgPool.query('UPDATE campanas_gmail SET estado=$1 WHERE id=$2',['terminada',id]); })(); res.json({ok:true,id,total:vals.length}); }catch(e){ res.status(500).json({error:e.message}); }});
app.get('/api/campanas/gmail',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_gmail WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });
app.get('/api/trabajadores',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM asesores WHERE agencia_id=$1',[req.user.agenciaId]); res.json(rows); });
app.post('/api/trabajadores',auth,async(req,res)=>{ const id='as_'+Date.now(); const hash=await bcrypt.hash(req.body.password||'123456',10); await pgPool.query('INSERT INTO asesores (id,agencia_id,nombre,email,telefono,password,rol) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,req.user.agenciaId,req.body.nombre,req.body.email,req.body.telefono,hash,'worker']); res.json({ok:true,id}); });
app.delete('/api/trabajadores/:id',auth,async(req,res)=>{ await pgPool.query('DELETE FROM asesores WHERE id=$1 AND agencia_id=$2',[req.params.id,req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/dashboard',auth,async(req,res)=>{ const c=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]); const m=await pgPool.query('SELECT COUNT(*) FROM mensajes_klido WHERE agencia_id=$1',[req.user.agenciaId]); const camp=await pgPool.query('SELECT COUNT(*) FROM campanas_klido WHERE agencia_id=$1',[req.user.agenciaId]); const no=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1 AND no_leido>0',[req.user.agenciaId]); res.json({clientes:c.rows[0].count, mensajes:m.rows[0].count, campanas:camp.rows[0].count, no_leidos:no.rows[0].count, rol:req.user.rol}); });
app.post('/api/soporte',auth,async(req,res)=>{ await pgPool.query('INSERT INTO soporte_klido (agencia_id,mensaje,fecha) VALUES ($1,$2,$3)',[req.user.agenciaId,req.body.mensaje,Date.now()]); res.json({ok:true, wa:`https://wa.me/573133181851?text=${encodeURIComponent(req.body.mensaje)}`, logo:'wpp'}); });
app.get('/api/soporte/info',(req,res)=>res.json({wa:'https://wa.me/573133181851', logo:'wpp'}));
app.get(GERENTE_LINK,(req,res)=>{ res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gerente KLIDO</title><style>body{font-family:Inter,sans-serif;background:#0A1931;color:#fff;margin:0;padding:20px}h1{color:#3B82F6}.card{background:#132A53;padding:15px;border-radius:12px;margin:10px 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap}.btn{padding:8px 12px;border-radius:8px;border:0;cursor:pointer;font-weight:bold;margin:2px}.bloquear{background:#EF4444;color:#fff}.desbloquear{background:#10B981;color:#fff}.plan{background:#3B82F6;color:#fff}input,select{padding:8px;border-radius:8px;border:0;margin:2px}</style></head><body><h1>🔐 Gerente General KLIDO</h1><div><input id="clave" type="password" placeholder="Clave klido123"><button class="btn plan" onclick="login()">Entrar</button></div><div id="panel" style="display:none"><h2>Agencias</h2><div id="stats"></div><div id="lista"></div></div><script>let CLAVE='';async function login(){CLAVE=document.getElementById('clave').value;if(CLAVE!=='klido123'){alert('Clave mala');return;}document.getElementById('panel').style.display='block';cargar();stats();}async function stats(){const r=await fetch('/api/superadmin/metricas',{headers:{'x-gerente-clave':CLAVE}});const j=await r.json();document.getElementById('stats').innerHTML='<div class=card>Total:'+j.agencias+' | Clientes:'+j.clientes+' | Mens:'+j.mensajes+'</div>';}async function cargar(){const r=await fetch('/api/superadmin/agencias',{headers:{'x-gerente-clave':CLAVE}});const j=await r.json();const div=document.getElementById('lista');div.innerHTML='';j.forEach(a=>{div.innerHTML+='<div class=card><div><b>'+a.nombre+'</b> ('+a.email+')<br>Plan:'+a.plan+' | Estado:'+(a.plan_activo?'✅':'🔴')+'</div><div><button class=btn '+(a.plan_activo?'bloquear':'desbloquear')+' onclick=toggle("'+a.id+'",'+a.plan_activo+')>'+(a.plan_activo?'Bloquear':'Desbloquear')+'</button></div></div>';});}async function toggle(id,activo){await fetch('/api/superadmin/agencias/'+id+'/'+(activo?'bloquear':'desbloquear'),{method:'POST',headers:{'x-gerente-clave':CLAVE}});cargar();}</script></body></html>`);});
app.get('/api/superadmin/agencias',authGerente,async(req,res)=>{ const {rows}=await pgPool.query(`SELECT a.*, (SELECT COUNT(*) FROM clientes_klido c WHERE c.agencia_id=a.id) as total_clientes, (SELECT COUNT(*) FROM mensajes_klido m WHERE m.agencia_id=a.id) as total_mensajes, (SELECT COUNT(*) FROM asesores t WHERE t.agencia_id=a.id) as total_trabajadores FROM agencias a ORDER BY a.creado DESC`); res.json(rows); });
app.post('/api/superadmin/agencias/:id/bloquear',authGerente,async(req,res)=>{ await pgPool.query('UPDATE agencias SET plan_activo=false WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.post('/api/superadmin/agencias/:id/desbloquear',authGerente,async(req,res)=>{ await pgPool.query('UPDATE agencias SET plan_activo=true WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.post('/api/superadmin/agencias/:id/plan',authGerente,async(req,res)=>{ await pgPool.query('UPDATE agencias SET plan=$1 WHERE id=$2',[req.body.plan, req.params.id]); res.json({ok:true}); });
app.get('/api/superadmin/metricas',authGerente,async(req,res)=>{ const a=await pgPool.query('SELECT COUNT(*) FROM agencias'); const c=await pgPool.query('SELECT COUNT(*) FROM clientes_klido'); const m=await pgPool.query('SELECT COUNT(*) FROM mensajes_klido'); const camp=await pgPool.query('SELECT COUNT(*) FROM campanas_klido'); res.json({agencias:a.rows[0].count, clientes:c.rows[0].count, mensajes:m.rows[0].count, campanas:camp.rows[0].count}); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido123'){ console.log('✅ Webhook verificado klido123'); return res.send(req.query['hub.challenge']); } return res.sendStatus(403); });
app.post('/webhook',async(req,res)=>{
  res.sendStatus(200);
  try{
    const value=req.body.entry?.[0]?.changes?.[0]?.value; const msg=value?.messages?.[0]; const contact=value?.contacts?.[0]; const meta=value?.metadata;
    if(!msg) return;
    const from=msg.from; const phoneId=meta?.phone_number_id||PHONE_ENV;
    let {rows:ags}=await pgPool.query('SELECT id FROM agencias WHERE phone_id=$1',[phoneId]);
    let agenciaId=ags[0]?.id; if(!agenciaId){ const {rows:all}=await pgPool.query('SELECT id FROM agencias ORDER BY creado ASC LIMIT 1'); agenciaId=all[0]?.id; }
    if(!agenciaId) return;
    const tipo=msg.type; let cont= tipo==='text'?msg.text?.body:`[${tipo}] ${msg[tipo]?.caption||''}`; const mediaId=msg[tipo]?.id||'';
    const cid=`cli_${agenciaId}_${from}`;
    const {rows:ex}=await pgPool.query('SELECT id FROM clientes_klido WHERE telefono=$1 AND agencia_id=$2',[from,agenciaId]);
    if(!ex[0]){ await pgPool.query('INSERT INTO clientes_klido (id,agencia_id,telefono,nombre,origen,no_leido,ultimo_mensaje) VALUES ($1,$2,$3,$4,$5,1,NOW())',[cid,agenciaId,from,contact?.profile?.name||from,'manual']); }
    else{ await pgPool.query('UPDATE clientes_klido SET no_leido=no_leido+1, ultimo_mensaje=NOW() WHERE telefono=$1 AND agencia_id=$2',[from,agenciaId]); }
    await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,media_id,mime,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[agenciaId,cid,from,tipo,cont,mediaId,msg[tipo]?.mime_type||'',Date.now(),'entrante']);
    io.to(`agencia_${agenciaId}`).emit('new_message',{agencia_id:agenciaId, telefono:from}); io.emit('new_message',{agencia_id:agenciaId});
    console.log(`📩 RECIBIDO ${from} ${tipo} agencia ${agenciaId}`);
  }catch(e){ console.log('❌ webhook error',e.message); }
});
app.get('/api/media/:mediaId',auth,async(req,res)=>{ const emp=await getEmp(req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${req.params.mediaId}?access_token=${emp.token}`); const j=await r.json(); if(!j.url) return res.status(404).json({error:'No url media'}); const m=await fetch(j.url,{headers:{Authorization:`Bearer ${emp.token}`}}); res.set('Content-Type', m.headers.get('content-type')||'application/octet-stream'); res.send(Buffer.from(await m.arrayBuffer())); }catch(e){ res.status(500).json({error:e.message}); }});
app.get('/api/health',(req,res)=>res.json({ok:true, version:'v143-tu-v140-fix-media', webhook:'klido123', gerente:GERENTE_LINK})); app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
io.on('connection',s=>{ s.on('join_agencia',id=>{ s.join(`agencia_${id}`); }); });
const PORT=process.env.PORT||3000; server.listen(PORT,()=>console.log(`🚀 V143 TU V140 + FIX media_id - PORT ${PORT}`));
