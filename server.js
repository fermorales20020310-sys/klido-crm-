// KLIDO V217 - FINAL - LOGIN + CRM AVANZA INTACTO + RESEND SOPORTE
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

// RESEND CON TUS 2 VARIABLES DE RAILWAY
async function sendEmail(to, subject, html){
  const API_KEY=(process.env.RESEND_API_KEY||'').trim();
  const FROM=(process.env.RESEND_FROM||'KLIDO <soporte@klidoapp.com.co>').trim();
  console.log('EMAIL intentando:',to,' FROM:',FROM,' hasKey:',!!API_KEY);
  if(!API_KEY) return {ok:false, error:'Falta RESEND_API_KEY'};
  try{
    const r=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${API_KEY}`},
      body:JSON.stringify({from:FROM, to, subject, html})
    });
    const j=await r.json();
    console.log('RESEND RESPUESTA:',j);
    return j;
  }catch(e){console.log('RESEND ERROR',e.message); return {ok:false};}
}

const VERIFY=(process.env.META_VERIFY_TOKEN||'klido123').trim();
console.log('V217 - FROM:',process.env.RESEND_FROM,' VERIFY:',VERIFY);

app.get('/health',(req,res)=>res.status(200).send('OK V217'));
app.get('/api/health',(req,res)=>res.json({ok:true, v:'V217', from:process.env.RESEND_FROM}));

// WEBHOOK
const verify=(req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY){console.log('WEBHOOK OK'); return res.send(req.query['hub.challenge']);} res.sendStatus(403);};
app.get('/webhook',verify); app.get('/webhook/:id',verify);
async function handle(b){try{const v=b.entry?.[0]?.changes?.[0]?.value; if(!v) return; const phone=v.metadata?.phone_number_id; let eid=null; try{for(const f of fs.readdirSync(DB)){try{const j=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); if(String(j.config?.phone)===String(phone)) eid=j.empresa_id;}catch{}}}catch{} if(!eid) return; let db=getDB(eid); if(!db) return; if(!db.chats) db.chats={}; if(v.messages){for(const m of v.messages){const from=m.from; if(!db.chats[from]) db.chats[from]={id:from, nombre:v.contacts?.[0]?.profile?.name||from, mensajes:[], notas:[], tags:['Hot Lead'], no_leidos:0, last:Date.now()}; let texto=m.type==='text'?m.text.body:'📎 '+m.type; let media_url=null; if(m[m.type]?.id && db.config?.token){try{const r=await fetch(`https://graph.facebook.com/v20.0/${m[m.type].id}`,{headers:{Authorization:`Bearer ${db.config.token}`}}); const jj=await r.json(); media_url=jj.url;}catch{}} db.chats[from].mensajes.push({from:'cliente', texto, type:m.type, media_url, ts:Date.now()}); db.chats[from].no_leidos++; db.chats[from].last=Date.now();} saveDB(eid,db);}}catch(e){console.log(e.message);}}
app.post('/webhook',(req,res)=>{handle(req.body); res.sendStatus(200);}); app.post('/webhook/:id',(req,res)=>{handle(req.body); res.sendStatus(200);});

// APIS AUTH
app.post('/api/empresa/registrar', async (req,res)=>{
  const {nombre,email,pass,plan}=req.body;
  if(!nombre||!email||!pass) return res.json({ok:false, error:'Faltan datos'});
  const empresa_id=`${S(email)}_${Date.now()}`;
  const codigo=genCode();
  const db={empresa_id, nombre, email, plan:plan||'basico', plan_activo:false, codigo_activacion:codigo, codigo_usado:false, creado:Date.now(), config:{phone:'', token:''}, usuarios:[{id:'admin', nombre:'Admin', email, pass, rol:'admin'}], chats:{}, reset_codes:[]};
  saveDB(empresa_id,db);
  const html=`<div style="font-family:Arial;background:#0b1020;color:#fff;padding:28px;border-radius:14px"><h2 style="margin:0">KLIDO Avanza Consulting</h2><p>Hola ${nombre},</p><p>Plan seleccionado: <b>${plan}</b></p><p>Tu código de activación después del pago:</p><div style="font-size:36px;letter-spacing:6px;background:#fff;color:#000;padding:14px;border-radius:10px;text-align:center;font-weight:800">${codigo}</div><p style="margin-top:16px;font-size:13px;color:#94a3b8">Este código fue enviado desde soporte@klidoapp.com.co. Ingrésalo en app.klidoapp.com.co para desbloquear tu panel Avanza.</p></div>`;
  const sent=await sendEmail(email, `KLIDO - Código activación ${codigo}`, html);
  res.json({ok:true, empresa_id, sent});
});

app.post('/api/empresa/activar',(req,res)=>{
  const {empresa_id, codigo}=req.body; const db=getDB(empresa_id); if(!db) return res.json({ok:false, error:'No existe'});
  if(String(db.codigo_activacion)!==String(codigo).trim()) return res.json({ok:false, error:'Código incorrecto'});
  db.plan_activo=true; saveDB(empresa_id,db); res.json({ok:true});
});

app.post('/api/login',(req,res)=>{
  try{
    for(const f of fs.readdirSync(DB)){
      try{
        const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
        const u=db.usuarios.find(x=>x.email===req.body.email && x.pass===req.body.pass);
        if(u){
          if(!db.plan_activo) return res.json({ok:false, bloqueado:true, empresa_id:db.empresa_id, plan:db.plan});
          return res.json({ok:true, user:u, empresa_id:db.empresa_id, plan:db.plan});
        }
      }catch{}
    }
    res.json({ok:false, error:'Credenciales incorrectas'});
  }catch{res.json({ok:false});}
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
      if(rc){ const u=db.usuarios.find(x=>x.email===email); u.pass=newPass; rc.usado=true; saveDB(db.empresa_id,db); return res.json({ok:true});}
    }catch{}
  }
  res.json({ok:false, error:'Código inválido o expirado'});
});

// CHATS
app.get('/api/empresas',(req,res)=>{try{res.json(fs.readdirSync(DB).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'))}catch{return null}}).filter(Boolean).map(e=>({empresa_id:e.empresa_id, nombre:e.nombre, plan:e.plan, activo:e.plan_activo})));}catch{res.json([]);}});
app.get('/api/chats/:eid/:uid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json([]); res.json(Object.values(db.chats||{}).sort((a,b)=>b.last-a.last));});
app.get('/api/mensajes/:eid/:cid',(req,res)=>{const db=getDB(req.params.eid); const c=db?.chats?.[req.params.cid]; res.json({mensajes:c?.mensajes||[], profile:{id:c?.id, nombre:c?.nombre, tags:c?.tags||['Hot Lead'], notas:c?.notas||[], email:c?.email||'', phone:c?.id}});});
app.post('/api/mensaje/enviar',async(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); try{const r=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},body:JSON.stringify({messaging_product:'whatsapp', to:String(req.body.chat_id).replace(/\D/g,''), type:'text', text:{body:req.body.texto}})}); const j=await r.json(); if(j.error) return res.json({ok:false, error:j.error}); if(!db.chats[req.body.chat_id]) db.chats[req.body.chat_id]={id:req.body.chat_id, nombre:req.body.chat_id, mensajes:[], last:Date.now()}; db.chats[req.body.chat_id].mensajes.push({from:'agente', texto:req.body.texto, ts:Date.now()}); db.chats[req.body.chat_id].last=Date.now(); saveDB(req.body.empresa_id,db); res.json({ok:true});}catch(e){res.json({ok:false});}});
app.post('/api/chat/nota',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false}); db.chats[req.body.chat_id].notas=db.chats[req.body.chat_id].notas||[]; db.chats[req.body.chat_id].notas.push({texto:req.body.texto, ts:Date.now()}); saveDB(req.body.empresa_id,db); res.json({ok:true});});

// RUTAS
app.get('/',(req,res)=>res.sendFile(path.join(PUB,'index.html')));
app.get('/crm',(req,res)=>res.sendFile(path.join(PUB,'crm','index.html')));
app.get('/app',(req,res)=>res.sendFile(path.join(PUB,'app','index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`V217 OK - FROM ${process.env.RESEND_FROM} en ${PORT}`));
