// KLIDO V218 - SERVER COMPLETO - LOGIN INTACTO + CRM AVANZA INTACTO + API CONFIG POR EMPRESA
const express=require('express');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true}));

const PUB=path.join(__dirname,'public');
if(!fs.existsSync(PUB)) fs.mkdirSync(PUB,{recursive:true});
if(!fs.existsSync(path.join(PUB,'crm'))) fs.mkdirSync(path.join(PUB,'crm'),{recursive:true});
if(!fs.existsSync(path.join(PUB,'app'))) fs.mkdirSync(path.join(PUB,'app'),{recursive:true});
app.use(express.static(PUB));

const DB='/app/db'; if(!fs.existsSync(DB)) fs.mkdirSync(DB,{recursive:true});
const S=s=>String(s||'').replace(/[^a-z0-9_\-@.]/gi,'').slice(0,80);
const getDB=id=>{const f=path.join(DB,`${S(id)}.json`); if(!fs.existsSync(f)) return null; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return null}};
const saveDB=(id,d)=>fs.writeFileSync(path.join(DB,`${S(id)}.json`),JSON.stringify(d,null,2));
const genCode=()=>Math.floor(100000+Math.random()*900000).toString();

// RESEND - COMPATIBLE CON TUS 2 VARIABLES DE LA FOTO
async function sendEmail(to, subject, html){
  const API_KEY=(process.env.RESEND_API_KEY||process.env.RESEND_API||'').trim();
  let FROM=(process.env.RESEND_FROM||process.env.SOPORTE_EMAIL||'soporte@klidoapp.com.co').trim();
  if(FROM &&!FROM.includes('<')) FROM=`KLIDO Avanza Consulting <${FROM}>`;
  if(!FROM.includes('<')) FROM=`KLIDO <soporte@klidoapp.com.co>`;
  console.log('V218 EMAIL intentando:',to,' FROM:',FROM,' hasKey:',!!API_KEY);
  if(!API_KEY){console.log('SIN API KEY'); return {ok:false, error:'Falta RESEND_API_KEY'};}
  try{
    const r=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${API_KEY}`},
      body:JSON.stringify({from:FROM, to, subject, html})
    });
    const j=await r.json();
    console.log('RESEND RESPUESTA:',j);
    return j;
  }catch(e){console.log('RESEND ERROR',e.message); return {ok:false, error:e.message};}
}

const PLANES={
  basico:{nombre:'Básico', precio:800000, trim:80000, asesores:3, desc:'API Meta'},
  premium:{nombre:'Premium + IA', precio:1400000, trim:95000, asesores:10, desc:'IA incluida'},
  gold:{nombre:'Gold + IA + Llamadas', precio:2400000, trim:120000, asesores:'Ilimitado', desc:'IA + Llamadas'}
};

const VERIFY=(process.env.META_VERIFY_TOKEN||'klido123').trim();
console.log('V218 - FROM:',process.env.RESEND_FROM,' VERIFY:',VERIFY,' PORT:',process.env.PORT);

app.get('/health',(req,res)=>res.status(200).send('OK V218'));
app.get('/api/health',(req,res)=>res.json({ok:true, v:'V218', from:process.env.RESEND_FROM, verify:VERIFY}));

// WEBHOOK
const verifyHook=(req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY){console.log('WEBHOOK VERIFICADO OK'); return res.send(req.query['hub.challenge']);} res.sendStatus(403);};
app.get('/webhook',verifyHook); app.get('/webhook/:empresa_id',verifyHook);

async function handleWebhook(body){
  try{
    const val=body.entry?.[0]?.changes?.[0]?.value; if(!val) return;
    const phoneId=val.metadata?.phone_number_id;
    let eid=null;
    try{ for(const f of fs.readdirSync(DB)){ try{ const j=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); if(String(j.config?.phone)===String(phoneId)) {eid=j.empresa_id; break;} }catch{}} }catch{}
    if(!eid){ console.log('No empresa para phone',phoneId); return; }
    let db=getDB(eid); if(!db) return;
    if(!db.chats) db.chats={};
    if(val.messages){
      for(const m of val.messages){
        const from=m.from;
        if(!db.chats[from]) db.chats[from]={id:from, nombre:val.contacts?.[0]?.profile?.name||from, mensajes:[], notas:[], tags:['Hot Lead'], no_leidos:0, last:Date.now(), email:'', empresa:'Natura Goods'};
        let texto=m.type==='text'?m.text.body:'📎 '+m.type;
        let media_url=null;
        // Intentar bajar media si hay token
        if(m[m.type]?.id && db.config?.token){
          try{
            const rr=await fetch(`https://graph.facebook.com/v20.0/${m[m.type].id}`,{headers:{Authorization:`Bearer ${db.config.token}`}});
            const jj=await rr.json(); media_url=jj.url;
          }catch{}
        }
        db.chats[from].mensajes.push({from:'cliente', texto, type:m.type, media_url, ts:Date.now()});
        db.chats[from].no_leidos++; db.chats[from].last=Date.now();
      }
      saveDB(eid,db);
    }
  }catch(e){console.log('handle error',e.message);}
}
app.post('/webhook',(req,res)=>{handleWebhook(req.body); res.sendStatus(200);});
app.post('/webhook/:empresa_id',(req,res)=>{handleWebhook(req.body); res.sendStatus(200);});

// ========= AUTH + EMPRESA =========
app.post('/api/empresa/registrar', async (req,res)=>{
  const {nombre,email,pass,plan}=req.body;
  if(!nombre||!email||!pass) return res.json({ok:false, error:'Faltan datos'});
  const empresa_id=`${S(email)}_${Date.now()}`;
  const codigo=genCode();
  const db={
    empresa_id, nombre, email, plan:plan||'basico', plan_activo:false,
    codigo_activacion:codigo, codigo_usado:false, creado:Date.now(),
    config:{phone:'', token:'', waba:''},
    usuarios:[{id:'admin', nombre:'Admin', email, pass, rol:'admin'}],
    chats:{}, reset_codes:[], calendar:[]
  };
  saveDB(empresa_id,db);
  const html=`<div style="font-family:Arial;background:#0b1020;color:#fff;padding:28px;border-radius:14px"><h2 style="margin:0">KLIDO Avanza Consulting</h2><p>Hola ${nombre},</p><p>Plan seleccionado: <b>${PLANES[plan]?.nombre||plan} - $${(PLANES[plan]?.precio||0).toLocaleString()}/año + $${(PLANES[plan]?.trim||0).toLocaleString()}/trim mant.</b></p><p>Tu código de activación después del pago:</p><div style="font-size:36px;letter-spacing:6px;background:#fff;color:#000;padding:14px;border-radius:10px;text-align:center;font-weight:800">${codigo}</div><p style="margin-top:16px;font-size:13px;color:#94a3b8">Este código fue enviado desde soporte@klidoapp.com.co. Ingrésalo en app.klidoapp.com.co para desbloquear tu panel Avanza. Webhook: ${req.headers.host}/webhook/${empresa_id}</p></div>`;
  const sent=await sendEmail(email, `KLIDO - Código activación ${codigo}`, html);
  res.json({ok:true, empresa_id, sent, webhook_url:`https://${req.headers.host}/webhook/${empresa_id}`});
});

app.post('/api/empresa/activar',(req,res)=>{
  const {empresa_id, codigo}=req.body; const db=getDB(empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  if(String(db.codigo_activacion)!==String(codigo).trim()) return res.json({ok:false, error:'Código incorrecto'});
  db.plan_activo=true; db.codigo_usado=true; saveDB(empresa_id,db); res.json({ok:true});
});

app.post('/api/login',(req,res)=>{
  try{
    const files=fs.readdirSync(DB);
    for(const f of files){
      try{
        const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
        const u=db.usuarios.find(x=>x.email===req.body.email && x.pass===req.body.pass);
        if(u){
          if(!db.plan_activo) return res.json({ok:false, bloqueado:true, empresa_id:db.empresa_id, plan:db.plan});
          return res.json({ok:true, user:u, empresa_id:db.empresa_id, plan:db.plan, nombre:db.nombre});
        }
      }catch{}
    }
    res.json({ok:false, error:'Credenciales incorrectas'});
  }catch(e){res.json({ok:false, error:e.message});}
});

app.post('/api/auth/forgot', async (req,res)=>{
  const {email}=req.body;
  for(const f of fs.readdirSync(DB)){
    try{
      const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      const u=db.usuarios.find(x=>x.email===email);
      if(u){
        const code=genCode();
        db.reset_codes=db.reset_codes||[]; db.reset_codes.push({code, email, ts:Date.now(), usado:false}); saveDB(db.empresa_id,db);
        const html=`<div style="font-family:Arial;background:#0b1020;color:#fff;padding:28px;border-radius:14px"><h2>KLIDO - Recuperar contraseña</h2><p>Tu código de recuperación:</p><div style="font-size:36px;letter-spacing:6px;background:#fff;color:#000;padding:14px;border-radius:10px;text-align:center;font-weight:800">${code}</div><p style="font-size:12px;color:#94a3b8">Expira en 15 minutos. Soporte: soporte@klidoapp.com.co</p></div>`;
        const sent=await sendEmail(email, `KLIDO - Código recuperación ${code}`, html);
        return res.json({ok:true, sent});
      }
    }catch{}
  }
  res.json({ok:false, error:'Email no encontrado'});
});

app.post('/api/auth/reset',(req,res)=>{
  const {email, code, newPass}=req.body;
  for(const f of fs.readdirSync(DB)){
    try{
      const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      const rc=(db.reset_codes||[]).find(c=>c.email===email && c.code===String(code).trim() &&!c.usado && Date.now()-c.ts < 900000);
      if(rc){ const u=db.usuarios.find(x=>x.email===email); if(!u) return res.json({ok:false}); u.pass=newPass; rc.usado=true; saveDB(db.empresa_id,db); return res.json({ok:true});}
    }catch{}
  }
  res.json({ok:false, error:'Código inválido o expirado'});
});

// ========= CONFIGURACION API POR EMPRESA INDIVIDUAL =========
app.get('/api/config/:eid',(req,res)=>{ const db=getDB(req.params.eid); res.json({ok:true, config:db?.config||{phone:'',waba:'',token:''}}); });

app.post('/api/config/api',(req,res)=>{
  const {empresa_id, phone, waba, token}=req.body;
  const db=getDB(empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  db.config={phone:String(phone||'').trim(), waba:String(waba||'').trim(), token:String(token||'').trim()};
  saveDB(empresa_id,db);
  console.log('API CONFIG GUARDADA para',empresa_id, db.config);
  res.json({ok:true, config:db.config, webhook_url:`/webhook/${empresa_id}`});
});

app.get('/api/empresa/info/:eid',(req,res)=>{ const db=getDB(req.params.eid); if(!db) return res.json({ok:false}); res.json({ok:true, empresa_id:db.empresa_id, nombre:db.nombre, email:db.email, plan:db.plan, plan_activo:db.plan_activo, usuarios:db.usuarios, config:db.config, creado:db.creado}); });
app.get('/api/empresas',(req,res)=>{try{res.json(fs.readdirSync(DB).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'))}catch{return null}}).filter(Boolean).map(e=>({empresa_id:e.empresa_id, nombre:e.nombre, email:e.email, plan:e.plan, activo:e.plan_activo, phone:e.config?.phone})));}catch{res.json([]);}});

// EQUIPOS
app.post('/api/equipo/add',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  const planMax={basico:3, premium:10, gold:100}; const max=planMax[db.plan]||3;
  if(db.usuarios.length>=max) return res.json({ok:false, error:`Plan ${db.plan} max ${max} asesores. Actualiza a Gold ilimitado`});
  db.usuarios.push({id:'u'+Date.now(), nombre:req.body.email.split('@')[0], email:req.body.email, pass:req.body.pass, rol:req.body.rol||'agente'});
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});

// CALENDARIO-RECORDATORIO
app.get('/api/calendar/:eid',(req,res)=>{ const db=getDB(req.params.eid); res.json(db?.calendar||[]); });
app.post('/api/calendar/add',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  db.calendar=db.calendar||[]; db.calendar.push({id:Date.now(), title:req.body.title, date:req.body.date, chat_id:req.body.chat_id||null, hecho:false});
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});

// CHATS
app.get('/api/chats/:eid/:uid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json([]); res.json(Object.values(db.chats||{}).sort((a,b)=>b.last-a.last));});
app.get('/api/mensajes/:eid/:cid',(req,res)=>{const db=getDB(req.params.eid); const c=db?.chats?.[req.params.cid]; if(!c) return res.json({mensajes:[], profile:{}}); res.json({mensajes:c.mensajes||[], profile:{id:c.id, nombre:c.nombre, tags:c.tags||['Hot Lead'], notas:c.notas||[], email:c.email||'', empresa:c.empresa||'Natura Goods', phone:c.id}});});
app.post('/api/mensaje/enviar',async(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  if(!db.plan_activo) return res.json({ok:false, error:'Plan bloqueado'});
  if(!db.config?.phone||!db.config?.token) return res.json({ok:false, error:'Configura API primero en Configuración de API'});
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},body:JSON.stringify({messaging_product:'whatsapp', to:String(req.body.chat_id).replace(/\D/g,''), type:'text', text:{body:req.body.texto}})});
    const j=await r.json(); if(j.error){console.log('META ERROR',j.error); return res.json({ok:false, error:j.error.message||JSON.stringify(j.error)});}
    if(!db.chats[req.body.chat_id]) db.chats[req.body.chat_id]={id:req.body.chat_id, nombre:req.body.chat_id, mensajes:[], no_leidos:0, last:Date.now(), tags:['Hot Lead']};
    db.chats[req.body.chat_id].mensajes.push({from:'agente', texto:req.body.texto, type:'text', ts:Date.now()}); db.chats[req.body.chat_id].last=Date.now(); saveDB(req.body.empresa_id,db); res.json({ok:true});
  }catch(e){res.json({ok:false, error:e.message});}
});
app.post('/api/chat/nota',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false}); db.chats[req.body.chat_id].notas=db.chats[req.body.chat_id].notas||[]; db.chats[req.body.chat_id].notas.push({texto:req.body.texto, ts:Date.now()}); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/config/general',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); db.nombre=req.body.nombre||db.nombre; saveDB(req.body.empresa_id,db); res.json({ok:true});});

// RUTAS PUBLIC - LOGIN INTACTO
app.get('/',(req,res)=>res.sendFile(path.join(PUB,'index.html')));
app.get('/crm',(req,res)=>res.sendFile(path.join(PUB,'crm','index.html')));
app.get('/crm/',(req,res)=>res.sendFile(path.join(PUB,'crm','index.html')));
app.get('/app',(req,res)=>res.sendFile(path.join(PUB,'app','index.html')));
app.get('/app/',(req,res)=>res.sendFile(path.join(PUB,'app','index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`V218 COMPLETO OK - FROM ${process.env.RESEND_FROM} en 0.0.0.0:${PORT}`));
