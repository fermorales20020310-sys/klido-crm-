const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_v115_final_2026_gerencia';
const RESEND_FROM = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SUPER_ADMIN_EMAIL = 'admin@klido.com';
const SUPER_ADMIN_PASS = 'Mafe2002@';
const VERIFY_TOKEN = 'klido123';

let fetchFn = global.fetch;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }

console.log(`[KLIDO v115.5 FINAL] VERIFY=${VERIFY_TOKEN} GERENCIA=${SUPER_ADMIN_EMAIL} RESEND=${RESEND_API_KEY?'OK':'FALTA'} PORT=${PORT}`);

// ============ 1. WEBHOOK META VA PRIMERO - PARA QUE VALIDE 100% ============
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log(`[WEBHOOK GET] mode=${mode} token=${token} challenge=${challenge}`);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log(`[WEBHOOK VERIFICADO OK ${VERIFY_TOKEN}]`);
    return res.status(200).send(challenge);
  } else {
    console.log(`[WEBHOOK FAIL] esperado ${VERIFY_TOKEN} llego ${token}`);
    return res.sendStatus(403);
  }
});

app.post('/webhook', express.json({limit:'15mb'}), (req, res) => {
  try {
    console.log('[WEBHOOK POST]', JSON.stringify(req.body).substring(0,2000));
    const entry = req.body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const phoneId = value?.metadata?.phone_number_id;
    const messages = value?.messages;

    if (phoneId && messages) {
      const DATA_DIR = path.join(__dirname,'data');
      const EMPRESAS_FILE = path.join(DATA_DIR,'empresas.json');
      const MENSAJES_DIR = path.join(DATA_DIR,'mensajes');
      if (!fs.existsSync(MENSAJES_DIR)) fs.mkdirSync(MENSAJES_DIR,{recursive:true});

      let emps = [];
      try { emps = JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8')); } catch{}

      const idx = emps.findIndex(e => e.waPhoneId === phoneId);
      if (idx === -1) {
        console.log(`[WEBHOOK] PhoneID ${phoneId} no coincide con ninguna agencia. Agencias:`, emps.map(e=>`${e.nombre}=${e.waPhoneId}`));
      } else {
        const file = path.join(MENSAJES_DIR, `${emps[idx].id}.json`);
        let msgs = [];
        if (fs.existsSync(file)) try { msgs = JSON.parse(fs.readFileSync(file,'utf8')); } catch{}
        messages.forEach(m => {
          msgs.push({
            id: m.id,
            contactoId: m.from,
            from: m.from,
            texto: m.text?.body || `[${m.type}]`,
            tipo: m.type,
            de: 'cliente',
            fecha: new Date().toISOString(),
            empresaId: emps[idx].id
          });
        });
        fs.writeFileSync(file, JSON.stringify(msgs.slice(-2000),null,2));
        console.log(`[MENSAJE ENTRANTE] ${emps[idx].nombre} de ${messages[0].from}: ${messages[0].text?.body||messages[0].type}`);
      }
    }
    res.sendStatus(200);
  } catch(e) {
    console.error('[WEBHOOK POST ERROR]', e);
    res.sendStatus(200);
  }
});

// ============ 2. MIDDLEWARE RESTO ============
app.use(express.json({limit:'15mb'}));
app.use(express.urlencoded({extended:true, limit:'15mb'}));
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Headers','Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname,'public')));

// ============ 3. DATA RAILWAY JSON - SIN CRUCE - LISTO POSTGRES ============
const DATA_DIR = path.join(__dirname,'data');
const EMPRESAS_FILE = path.join(DATA_DIR,'empresas.json');
const MENSAJES_DIR = path.join(DATA_DIR,'mensajes');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(MENSAJES_DIR)) fs.mkdirSync(MENSAJES_DIR,{recursive:true});
if(!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE,'[]');

function obtenerEmpresas(){ try{ return JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8')); }catch{ return []; } }
function guardarEmpresas(l){ fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(l,null,2)); }

const codigosRegistro = new Map();
const codigosReset = new Map();

function auth(req,res,next){
  const t = (req.headers.authorization||'').replace('Bearer ','').trim() || req.query.token || '';
  if(!t) return res.status(401).json({error:'No token'});
  try{ req.user = jwt.verify(t, JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Token vencido'}); }
}

async function enviarResend(to,subject,html){
  if(!RESEND_API_KEY){ console.log(`[RESEND MOCK] to ${to}`); return {id:'mock'}; }
  const r = await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:RESEND_FROM,to:to.toLowerCase(),subject,html})});
  const j = await r.json(); console.log('[RESEND]', r.status, j); if(!r.ok) throw new Error(j.message||JSON.stringify(j)); return j;
}

// ============ 4. PUBLIC ENDPOINTS - NO ROMPE LO QUE YA TIENES ============
app.post('/api/public/solicitar-codigo', async (req,res)=>{
  const {email}=req.body; if(!email) return res.status(400).json({error:'Correo requerido'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosRegistro.set(email.toLowerCase(),{codigo,expira:Date.now()+10*60*1000});
  try{
    await enviarResend(email.toLowerCase(),`KLIDO Código ${codigo}`,`<div style="font-family:Arial;padding:20px"><h2>Código KLIDO ${codigo}</h2><p>Expira 10 min</p><p>Ley 1581</p></div>`);
    res.json({ok:true,mensaje:`Código enviado a ${email}`});
  }catch(e){ res.json({ok:true,mensaje:`Código: ${codigo} - ${e.message}`}); }
});

app.post('/api/public/crear-empresa',(req,res)=>{
  const {nombre,email,password,plan,codigo,terminos}=req.body;
  if(!terminos) return res.status(400).json({error:'Acepta términos Ley 1581'});
  const reg=codigosRegistro.get(email.toLowerCase()); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código inválido'});
  if(Date.now()>reg.expira) return res.status(400).json({error:'Código expirado'});
  let emps=obtenerEmpresas();
  if(emps.length>=10) return res.status(400).json({error:'Límite 10 empresas'});
  if(emps.find(e=>e.email===email.toLowerCase())) return res.status(400).json({error:'Ya existe'});
  const nueva={
    id:'emp_'+Date.now(), nombre, email:email.toLowerCase(), password, plan,
    estado:'activa', pagado:true, codigoActivacion:'KLIDO-'+Date.now(),
    waPhoneId:'', waToken:'', metaAppId:'', metaBusinessId:'',
    consumo:{mensajes:0,usuarios:plan==='gold'?10:plan==='premium'?5:2,contactos:0},
    equipo:[{id:'jefe_'+Date.now(),nombre,email:email.toLowerCase(),rol:'jefe',password}],
    contactos:[], campanas:[], citas:[], fechaRegistro:new Date().toISOString()
  };
  emps.push(nueva); guardarEmpresas(emps); codigosRegistro.delete(email.toLowerCase());
  res.status(201).json({ok:true,mensaje:'Empresa creada activa'});
});

app.post('/api/public/forgot-password', async (req,res)=>{
  const {email}=req.body; const low=email.toLowerCase();
  let emps=obtenerEmpresas();
  const existe=emps.find(e=>e.email===low)||emps.find(e=>e.equipo.some(u=>u.email===low));
  if(!existe) return res.status(404).json({error:'Correo no registrado'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  codigosReset.set(low,{codigo,expira:Date.now()+10*60*1000});
  try{ await enviarResend(low,`KLIDO Reset ${codigo}`,`<h2>Código reset ${codigo}</h2><p>Expira 10 min</p>`); res.json({ok:true,mensaje:`Código enviado a ${low}`}); }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/public/reset-password',(req,res)=>{
  const {email,codigo,nuevaPassword}=req.body; const low=email.toLowerCase();
  const reg=codigosReset.get(low); if(!reg||reg.codigo!==codigo) return res.status(400).json({error:'Código inválido'});
  if(Date.now()>reg.expira) return res.status(400).json({error:'Expirado'});
  let emps=obtenerEmpresas();
  emps=emps.map(e=>{ if(e.email===low) e.password=nuevaPassword; e.equipo=e.equipo.map(u=>{ if(u.email===low) u.password=nuevaPassword; return u; }); return e; });
  guardarEmpresas(emps); codigosReset.delete(low); res.json({ok:true,mensaje:'Contraseña actualizada'});
});

// ============ 5. LOGIN - MANTIENE ACOL Y AVANZA ============
app.post('/api/login',(req,res)=>{
  const {email,password}=req.body; if(!email||!password) return res.status(400).json({error:'Faltan datos'});
  const low=email.toLowerCase().trim(); console.log('[LOGIN]',low);
  if(low===SUPER_ADMIN_EMAIL.toLowerCase()&&password===SUPER_ADMIN_PASS){
    const token=jwt.sign({id:'SUPER',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold',empresaId:'SUPER'},JWT_SECRET,{expiresIn:'7d'});
    return res.json({ok:true,token,user:{id:'SUPER',nombre:'GERENCIA AVANZA',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold'}});
  }
  let emps=obtenerEmpresas();
  for(let e of emps){
    if(e.email===low&&e.password===password){
      const token=jwt.sign({id:e.id,email:e.email,rol:'jefe',plan:e.plan,empresaId:e.id},JWT_SECRET,{expiresIn:'7d'});
      return res.json({ok:true,token,user:{id:e.id,nombre:e.nombre,email:e.email,plan:e.plan,rol:'jefe',empresaId:e.id,empresaNombre:e.nombre,estado:'activa'}});
    }
    const u=e.equipo.find(u=>u.email===low&&u.password===password);
    if(u){
      const token=jwt.sign({id:u.id,email:u.email,rol:u.rol,plan:e.plan,empresaId:e.id},JWT_SECRET,{expiresIn:'7d'});
      return res.json({ok:true,token,user:{id:u.id,nombre:u.nombre,email:u.email,plan:e.plan,rol:u.rol,empresaId:e.id,empresaNombre:e.nombre,estado:'activa'}});
    }
  }
  return res.status(401).json({error:'Credenciales incorrectas'});
});

app.get('/api/me',auth,(req,res)=>{
  if(req.user.rol==='super') return res.json({id:'SUPER',nombre:'GERENCIA',email:SUPER_ADMIN_EMAIL,rol:'super',plan:'gold'});
  const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);
  if(!emp) return res.status(404).json({error:'No empresa'});
  return res.json({id:req.user.id,nombre:emp.nombre,email:req.user.email,plan:emp.plan,rol:req.user.rol,empresaId:emp.id,empresaNombre:emp.nombre,estado:emp.estado,waPhoneId:emp.waPhoneId||'VACIO',waToken:emp.waToken?'CONFIGURADO':'VACIO',consumo:emp.consumo});
});

// ============ 6. GERENCIA ============
app.get('/api/admin/agencias',auth,(req,res)=>{ if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'}); const emps=obtenerEmpresas(); res.json({total:emps.length,restan:Math.max(0,10-emps.length),wpp:'3133181851',agencias:emps}); });
app.post('/api/gerente/desbloquear/:id',auth,(req,res)=>{ if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'}); let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.params.id); if(i!==-1){ emps[i].estado='activa'; emps[i].pagado=true; guardarEmpresas(emps); } res.json({mensaje:'Desbloqueada'}); });
app.post('/api/admin/bloquear',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.body.agenciaId); if(i!==-1){ emps[i].estado=req.body.estado; emps[i].pagado=req.body.pagado; guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/admin/activar',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.body.agenciaId); if(i!==-1){ emps[i].estado='activa'; emps[i].pagado=true; guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/debug/empresas',auth,(req,res)=>{ if(req.user.rol!=='super') return res.status(403).json({error:'Solo gerencia'}); res.json(obtenerEmpresas()); });
app.get('/api/contrato/:id',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.params.id); res.send(`<html><body style="font-family:Arial;padding:30px"><h2>Contrato KLIDO ${emp?.nombre||''}</h2><p>Plan ${emp?.plan||''} Ley 1581</p></body></html>`); });

// ============ 7. CRM REAL POR AGENCIA - MENSAJES REALES META API ============
app.post('/api/mensajes',auth, async (req,res)=>{
  try{
    const {contactoId,texto}=req.body; if(!contactoId||!texto) return res.status(400).json({error:'Falta contacto o texto'});
    let emps=obtenerEmpresas(); const idx=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id);
    if(idx===-1) return res.status(404).json({error:'Empresa no encontrada'});
    const emp=emps[idx];
    console.log(`[ENVIO INTENTO] ${emp.nombre} -> ${contactoId} : ${texto} PhoneID=${emp.waPhoneId} Token=${emp.waToken?'OK':'VACIO'}`);
    if(!emp.waPhoneId||!emp.waToken){
      return res.status(400).json({error:`Agencia ${emp.nombre} sin WA Phone ID o Token. Ve a Configuración y guarda credenciales META. Actual: PhoneID=${emp.waPhoneId||'VACIO'}`});
    }
    const url=`https://graph.facebook.com/v20.0/${emp.waPhoneId}/messages`;
    const payload={messaging_product:'whatsapp',to:contactoId.replace(/\D/g,''),type:'text',text:{body:texto}};
    const r=await fetchFn(url,{method:'POST',headers:{'Authorization':`Bearer ${emp.waToken}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json(); console.log('[META RESP]', r.status, JSON.stringify(j));
    if(!r.ok) return res.status(400).json({error:`META: ${j.error?.message||JSON.stringify(j)} - Code ${j.error?.code}`,meta:j});

    const file=path.join(MENSAJES_DIR, `${emp.id}.json`);
    let msgs=[]; if(fs.existsSync(file)) try{msgs=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
    msgs.push({id:'msg_'+Date.now(),contactoId,texto,de:'yo',fecha:new Date().toISOString(),empresaId:emp.id});
    fs.writeFileSync(file, JSON.stringify(msgs.slice(-2000),null,2));
    emps[idx].consumo.mensajes=(emps[idx].consumo.mensajes||0)+1; guardarEmpresas(emps);
    res.json({ok:true,mensaje:'Enviado META API OK',meta:j});
  }catch(e){ console.error('[ENVIO ERROR]',e); res.status(500).json({error:e.message}); }
});

app.get('/api/mensajes',auth,(req,res)=>{
  const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);
  if(!emp) return res.json([]); const file=path.join(MENSAJES_DIR, `${emp.id}.json`);
  if(!fs.existsSync(file)) return res.json([]); try{ res.json(JSON.parse(fs.readFileSync(file,'utf8'))); }catch{ res.json([]); }
});

app.get('/api/contactos',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.contactos||[]); });
app.post('/api/contactos',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].contactos.push({id:Date.now().toString(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/campanas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.campanas||[]); });
app.post('/api/campanas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].campanas.push({id:'camp_'+Date.now(),...req.body,fecha:new Date().toISOString()}); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/equipo',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.equipo||[]); });
app.post('/api/equipo',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].equipo.push({id:'user_'+Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.delete('/api/equipo/:uid',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].equipo=emps[i].equipo.filter(u=>u.id!==req.params.uid); guardarEmpresas(emps); } res.json({ok:true}); });
app.get('/api/citas',auth,(req,res)=>{ const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id); res.json(emp?.citas||[]); });
app.post('/api/citas',auth,(req,res)=>{ let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i!==-1){ emps[i].citas.push({id:Date.now(),...req.body}); guardarEmpresas(emps); } res.json({ok:true}); });
app.post('/api/config/meta',auth,(req,res)=>{
  let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId||e.id===req.user.id); if(i===-1) return res.status(404).json({error:'No empresa'});
  const {waPhoneId,waToken,metaAppId,metaBusinessId}=req.body; if(waPhoneId) emps[i].waPhoneId=waPhoneId; if(waToken) emps[i].waToken=waToken; if(metaAppId) emps[i].metaAppId=metaAppId; if(metaBusinessId) emps[i].metaBusinessId=metaBusinessId; guardarEmpresas(emps);
  console.log(`[META CONFIG] ${emps[i].nombre} Phone ${waPhoneId} Token ${waToken?'OK':'VACIO'}`);
  res.json({ok:true,mensaje:`Credenciales guardadas ${emps[i].nombre}`});
});

app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,()=>console.log(`KLIDO v115.5 FINAL TODO ACTUALIZADO VERIFY=${VERIFY_TOKEN} PORT=${PORT} WEBHOOK=https://app.klidoapp.com.co/webhook LISTO`));
