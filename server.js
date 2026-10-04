// KLIDO v145 FIX CAMPAÑAS - TU V144 + FIX TABLA CAMPANAS
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
// FIX TABLAS VIEJAS
await pgPool.query(`ALTER TABLE mensajes_klido ADD COLUMN IF NOT EXISTS media_id TEXT`); await pgPool.query(`ALTER TABLE mensajes_klido ADD COLUMN IF NOT EXISTS mime TEXT`); await pgPool.query(`ALTER TABLE mensajes_klido ADD COLUMN IF NOT EXISTS url TEXT`); await pgPool.query(`ALTER TABLE mensajes_klido ADD COLUMN IF NOT EXISTS direccion TEXT`);
await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS bloque_actual INT DEFAULT 0`); await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS programada BIGINT`); await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS numeros JSONB DEFAULT '[]'`); await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS historial JSONB DEFAULT '[]'`); await pgPool.query(`ALTER TABLE campanas_klido ADD COLUMN IF NOT EXISTS pausada BOOLEAN DEFAULT false`);
console.log('✅ V145 DB OK + migracion campanas');
} initDB();
function auth(req,res,next){ const h=req.headers.authorization; if(!h) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(h.replace('Bearer ',''),JWT); next(); }catch{ res.status(401).json({error:'Token invalido'}); }}
function authGerente(req,res,next){ const k=req.headers['x-gerente-clave']||req.query.clave; if(k!==GERENTE_CLAVE) return res.status(401).json({error:'Clave gerente mala'}); next(); }
async function getEmp(id){ if(!id){ return {id:'default', phone:PHONE_ENV, waba:WABA_ENV, token:TOKEN_ENV, plan:'basico'}; } const {rows}=await pgPool.query('SELECT * FROM agencias WHERE id=$1',[id]); let r=rows[0]; if(!r){ const {rows:all}=await pgPool.query('SELECT * FROM agencias ORDER BY creado ASC LIMIT 1'); r=all[0]; } if(!r) return {id:'default', phone:PHONE_ENV, waba:WABA_ENV, token:TOKEN_ENV, plan:'basico'}; return {id:r.id, phone:r.phone_id||PHONE_ENV, waba:r.waba_id||WABA_ENV, token:r.meta_token||TOKEN_ENV, plan:r.plan||'basico', nombre:r.nombre, activo:r.plan_activo}; }
function normalizaNumeros(arr){ let out=[]; (arr||[]).forEach(raw=>{ String(raw||'').split(/[,;\n|]+/).forEach(p=>{ let d=p.replace(/\D/g,''); if(d.endsWith('.0')) d=d.slice(0,-2); if(d.length===10&&d.startsWith('3')) d='57'+d; if(d.length===12&&d.startsWith('57')) out.push(d); if(d.length>12){ const m=d.match(/3\d{9}/g); if(m) m.forEach(x=>out.push('57'+x)); } }); }); return [...new Set(out)].filter(n=>/^57[3]\d{9}$/.test(n)); }
function extraeEmails(arr){ let out=[]; const re=/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g; (arr||[]).forEach(raw=>{ const ms=String(raw).match(re); if(ms) out.push(...ms); }); return [...new Set(out.map(e=>e.toLowerCase()))]; }
async function getMeta(p,emp){ try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=250`); const j=await r.json(); const t=j.data?.find(x=>x.name===p); if(!t) return null; let v=[]; (t.components||[]).forEach(c=>{ if(c.text){ [...c.text.matchAll(/\{\{([^}]+)\}\}/g)].forEach(m=>v.push(m[1].trim())); } }); return {language:t.language,varNames:v}; }catch{ return null; }}
app.post('/api/auth/login',async(req,res)=>{ try{ const {email,password}=req.body; const {rows}=await pgPool.query('SELECT * FROM agencias WHERE email=$1',[email]); if(!rows[0]){ const {rows:as}=await pgPool.query('SELECT * FROM asesores WHERE email=$1',[email]); if(!as[0]) return res.status(404).json({error:'No existe'}); if(!await bcrypt.compare(password,as[0].password||'')) return res.status(401).json({error:'Clave mala'}); return res.json({ok:true,token:jwt.sign({agenciaId:as[0].agencia_id, asesorId:as[0].id, rol:'worker'},JWT), rol:'worker'}); } if(!await bcrypt.compare(password,rows[0].password)) return res.status(401).json({error:'Clave mala'}); res.json({ok:true,token:jwt.sign({agenciaId:rows[0].id, rol:'admin'},JWT), rol:'admin'}); }catch(e){ res.status(500).json({error:e.message}); }});
app.get('/api/config',auth,async(req,res)=>{ const emp=await getEmp(req.user.agenciaId); res.json({phoneId:emp.phone, wabaId:emp.waba, tieneToken:emp.token.length>50, plan:emp.plan}); });
app.post('/api/config',auth,async(req,res)=>{ await pgPool.query('UPDATE agencias SET phone_id=$1,waba_id=$2,meta_token=$3 WHERE id=$4',[req.body.phoneId,req.body.wabaId,req.body.metaToken,req.user.agenciaId]); res.json({ok:true}); });
app.get('/api/plantillas',auth,async(req,res)=>{ const emp=await getEmp(req.user.agenciaId); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?access_token=${emp.token}&limit=250`); const j=await r.json(); res.json((j.data||[]).filter(t=>t.status==='APPROVED')); }catch{ res.json([]); }});
app.get('/api/clientes',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM clientes_klido WHERE agencia_id=$1 ORDER BY ultimo_mensaje DESC LIMIT 300',[req.user.agenciaId]); res.json(rows); });
app.get('/api/mensajes/:clienteId',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM mensajes_klido WHERE cliente_id=$1 ORDER BY timestamp ASC LIMIT 1000',[req.params.clienteId]); res.json(rows); });
app.post('/api/mensajes/:clienteId',auth,async(req,res)=>{
  try{
    const {contenido}=req.body; const {rows:cl}=await pgPool.query('SELECT telefono FROM clientes_klido WHERE id=$1',[req.params.clienteId]);
    if(!cl[0]) return res.status(404).json({error:'Cliente no encontrado'});
    const emp=await getEmp(req.user.agenciaId); console.log(`📤 Enviando a ${cl[0].telefono} desde ${emp.phone}`);
    let resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify({messaging_product:'whatsapp',to:cl[0].telefono,type:'text',text:{body:contenido}})});
    let j=await resp.json(); console.log('📤 Meta:', JSON.stringify(j).slice(0,800));
    if(j.error && (j.error.code===131047 || j.error.code===470)){
      const plantilla='acol_invitacion_congreso'; const meta=await getMeta(plantilla, emp);
      if(meta){ const tpl={name:plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: [{type:'text', text:contenido.slice(0,80)}]}]}; resp=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify({messaging_product:'whatsapp',to:cl[0].telefono,type:'template',template:tpl})}); j=await resp.json(); }
    }
    if(j.error) return res.status(400).json({error:j.error.message, detalle:j.error});
    await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7)',[req.user.agenciaId,req.params.clienteId,cl[0].telefono,'text',contenido,Date.now(),'saliente']);
    io.emit('new_message',{agencia_id:req.user.agenciaId}); console.log(`✅ ENVIADO OK a ${cl[0].telefono}`); res.json({ok:true, meta:j});
  }catch(e){ console.log('❌ envio error',e.message); res.status(500).json({error:e.message}); }
});
app.post('/api/campanas/parse-excel',auth,async(req,res)=>{ try{ const {dataBase64}=req.body; const buffer=Buffer.from((dataBase64||'').split(',').pop()||'', 'base64'); const wb=XLSX.read(buffer,{type:'buffer'}); let nums=[], emails=[]; wb.SheetNames.forEach(n=>{ const ws=wb.Sheets[n]; const json=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}); json.forEach(r=>{ r.forEach(c=>{ nums.push(...normalizaNumeros([String(c)])); emails.push(...extraeEmails([String(c)])); }); }); }); res.json({ok:true, numeros:[...new Set(nums)], emails:[...new Set(emails)]}); }catch(e){ console.log('❌ parse-excel error',e.message); res.status(500).json({error:e.message}); }});
async function procesaWPP(id){
  try{
    const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return; let c=rows[0];
    if(c.programada && Number(c.programada)>Date.now()){ console.log(`⏰ Campaña ${id} programada`); setTimeout(()=>procesaWPP(id), Number(c.programada)-Date.now()); return; }
    let nums=c.numeros; if(typeof nums==='string') try{ nums=JSON.parse(nums); }catch{ nums=[]; } nums=normalizaNumeros(nums);
    const emp=await getEmp(c.agencia_id); const meta=await getMeta(c.plantilla, emp);
    if(!meta){ console.log(`❌ Plantilla ${c.plantilla} no encontrada`); await pgPool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['error_plantilla',id]); return; }
    let vars=[]; try{ const h=typeof c.historial==='string'?JSON.parse(c.historial):c.historial; vars=h?.[0]?.variables||[]; }catch{}
    if(vars.length<meta.varNames.length) while(vars.length<meta.varNames.length) vars.push('Cliente');
    const isNamed=meta.varNames.length>0 && isNaN(parseInt(meta.varNames[0]));
    const pn={name:c.plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: meta.varNames.map((n,i)=>({type:'text', text:String(vars[i]||'Cliente').slice(0,100), parameter_name:n}))}]};
    const pnum={name:c.plantilla, language:{code:meta.language||'es_CO'}, components:[{type:'body', parameters: vars.map(v=>({type:'text', text:String(v).slice(0,100)}))}]};
    const atts=isNamed?[pn,pnum]:[pnum,pn];
    console.log(`🚀 Campaña ${id} ${c.plantilla} total:${nums.length}`);
    for(let i=c.bloque_actual||0;i<nums.length;i++){
      const {rows:st}=await pgPool.query('SELECT pausada FROM campanas_klido WHERE id=$1',[id]); if(st[0]?.pausada){ await pgPool.query('UPDATE campanas_klido SET bloque_actual=$1 WHERE id=$2',[i,id]); return; }
      let ok=false; for(const att of atts){
        try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${emp.token}`},body:JSON.stringify({messaging_product:'whatsapp',to:nums[i],type:'template',template:att})}); const j=await r.json(); if(j.error) throw j.error; await pgPool.query('UPDATE campanas_klido SET enviados=enviados+1, bloque_actual=$1 WHERE id=$2',[i+1,id]); ok=true; io.emit('campana_update',{id, enviados:i+1}); console.log(`✅ ${nums[i]} campaña ${id}`); break; }catch(e){ console.log(`❌ Fallo ${nums[i]} ${e.message||e}`); }
      } if(!ok) await pgPool.query('UPDATE campanas_klido SET fallidos=fallidos+1 WHERE id=$1',[id]); await new Promise(r=>setTimeout(r,1800));
    }
    await pgPool.query('UPDATE campanas_klido SET estado=$1,terminada=$2 WHERE id=$3',['terminada',Date.now(),id]); console.log(`🏁 Campaña ${id} terminada`); io.emit('campana_terminada',{id});
  }catch(e){ console.log('❌ procesaWPP error', e.message, e.stack); }
}
app.post('/api/campanas',auth,async(req,res)=>{
  try{
    console.log('📢 Nueva campaña req', JSON.stringify(req.body).slice(0,500));
    const {nombre,plantilla,numeros,variables,programada}=req.body; if(!plantilla) return res.status(400).json({error:'Falta plantilla'});
    const validos=normalizaNumeros(numeros||[]); if(!validos.length) return res.status(400).json({error:'No hay números válidos 57 3...' });
    const id='camp_'+Date.now(); const prog=programada?new Date(programada).getTime():null;
    await pgPool.query('INSERT INTO campanas_klido (id,agencia_id,nombre,plantilla,total,creada,historial,numeros,programada,bloque_actual,estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,req.user.agenciaId,nombre||plantilla,plantilla,validos.length,Date.now(),JSON.stringify([{variables:variables||['Cliente']}]),JSON.stringify(validos),prog,0,'activa']);
    console.log(`✅ Campaña creada ${id} total ${validos.length}`); if(!prog) procesaWPP(id); else if(prog>Date.now()) setTimeout(()=>procesaWPP(id), prog-Date.now()); else procesaWPP(id);
    res.json({ok:true,id,total:validos.length});
  }catch(e){ console.log('❌ crear campaña error', e.message, e.stack); res.status(500).json({error:e.message}); }
});
app.get('/api/campanas',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM campanas_klido WHERE agencia_id=$1 ORDER BY creada DESC',[req.user.agenciaId]); res.json(rows); });
app.post('/api/campanas/:id/pausa',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=true WHERE id=$1',[req.params.id]); res.json({ok:true}); });
app.post('/api/campanas/:id/continuar',auth,async(req,res)=>{ await pgPool.query('UPDATE campanas_klido SET pausada=false WHERE id=$1',[req.params.id]); procesaWPP(req.params.id); res.json({ok:true}); });
app.get('/api/trabajadores',auth,async(req,res)=>{ const {rows}=await pgPool.query('SELECT * FROM asesores WHERE agencia_id=$1',[req.user.agenciaId]); res.json(rows); });
app.post('/api/trabajadores',auth,async(req,res)=>{ const id='as_'+Date.now(); const hash=await bcrypt.hash(req.body.password||'123456',10); await pgPool.query('INSERT INTO asesores (id,agencia_id,nombre,email,telefono,password) VALUES ($1,$2,$3,$4,$5,$6)',[id,req.user.agenciaId,req.body.nombre,req.body.email,req.body.telefono,hash]); res.json({ok:true}); });
app.get('/api/dashboard',auth,async(req,res)=>{ const c=await pgPool.query('SELECT COUNT(*) FROM clientes_klido WHERE agencia_id=$1',[req.user.agenciaId]); res.json({clientes:c.rows[0].count}); });
app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==='klido123') return res.send(req.query['hub.challenge']); return res.sendStatus(403); });
app.post('/webhook',async(req,res)=>{
  res.sendStatus(200);
  try{
    const value=req.body.entry?.[0]?.changes?.[0]?.value; const msg=value?.messages?.[0]; const contact=value?.contacts?.[0]; const meta=value?.metadata; if(!msg) return;
    const from=msg.from; const phoneId=meta?.phone_number_id||PHONE_ENV; let {rows:ags}=await pgPool.query('SELECT id FROM agencias WHERE phone_id=$1',[phoneId]); let agenciaId=ags[0]?.id; if(!agenciaId){ const {rows:all}=await pgPool.query('SELECT id FROM agencias LIMIT 1'); agenciaId=all[0]?.id; } if(!agenciaId) return;
    const tipo=msg.type; let cont= tipo==='text'?msg.text?.body:`[${tipo}]`; const mediaId=msg[tipo]?.id||'';
    const cid=`cli_${agenciaId}_${from}`; const {rows:ex}=await pgPool.query('SELECT id FROM clientes_klido WHERE telefono=$1 AND agencia_id=$2',[from,agenciaId]);
    if(!ex[0]){ await pgPool.query('INSERT INTO clientes_klido (id,agencia_id,telefono,nombre,origen,no_leido) VALUES ($1,$2,$3,$4,$5,1)',[cid,agenciaId,from,contact?.profile?.name||from,'manual']); }
    else{ await pgPool.query('UPDATE clientes_klido SET no_leido=no_leido+1, ultimo_mensaje=NOW() WHERE telefono=$1 AND agencia_id=$2',[from,agenciaId]); }
    await pgPool.query('INSERT INTO mensajes_klido (agencia_id,cliente_id,telefono,tipo,contenido,media_id,mime,timestamp,direccion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[agenciaId,cid,from,tipo,cont,mediaId,msg[tipo]?.mime_type||'',Date.now(),'entrante']);
    io.emit('new_message',{agencia_id:agenciaId}); console.log(`📩 RECIBIDO ${from} ${tipo}`);
  }catch(e){ console.log('❌ webhook error',e.message); }
});
app.get('/api/health',(req,res)=>res.json({ok:true, version:'v145-fix-campanas'})); app.get('/health',(req,res)=>res.json({ok:true}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
io.on('connection',s=>{ s.on('join_agencia',id=>s.join(`agencia_${id}`)); });
const PORT=process.env.PORT||3000; server.listen(PORT,()=>console.log(`🚀 V145 FIX CAMPAÑAS - PORT ${PORT}`));
