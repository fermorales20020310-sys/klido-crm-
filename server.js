// KLIDO V221 FINAL COMPLETO - SIN BORRAR NADA + BANDEJA SEGMENTADA PUNTO ROJO HISTORIAL MEDIA DATOS
const express=require('express');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
const multer=require('multer');
const upload=multer({dest:'/tmp'});
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use(express.urlencoded({extended:true}));

const PUB=path.join(__dirname,'public');
if(!fs.existsSync(PUB)) fs.mkdirSync(PUB,{recursive:true});
const PUB_MEDIA=path.join(PUB,'media');
if(!fs.existsSync(PUB_MEDIA)) fs.mkdirSync(PUB_MEDIA,{recursive:true});
app.use(express.static(PUB));

const DB='/app/db'; if(!fs.existsSync(DB)) fs.mkdirSync(DB,{recursive:true});
const S=s=>String(s||'').replace(/[^a-z0-9_\-@.]/gi,'').slice(0,80);
const getDB=id=>{const f=path.join(DB,`${S(id)}.json`); if(!fs.existsSync(f)) return null; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return null}};
const saveDB=(id,d)=>fs.writeFileSync(path.join(DB,`${S(id)}.json`),JSON.stringify(d,null,2));
const genCode=()=>Math.floor(100000+Math.random()*900000).toString();

async function sendEmail(to, subject, html){
  const API_KEY=(process.env.RESEND_API_KEY||process.env.RESEND_API||'').trim();
  let FROM=(process.env.RESEND_FROM||process.env.SOPORTE_EMAIL||'soporte@klidoapp.com.co').trim();
  if(FROM &&!FROM.includes('<')) FROM=`KLIDO Avanza Consulting <${FROM}>`;
  if(!FROM.includes('<')) FROM=`KLIDO <soporte@klidoapp.com.co>`;
  console.log('V221 EMAIL:',to,' FROM:',FROM,' hasKey:',!!API_KEY);
  if(!API_KEY) return {ok:false, error:'Falta RESEND_API_KEY'};
  try{
    const r=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${API_KEY}`},
      body:JSON.stringify({from:FROM, to, subject, html})
    });
    const j=await r.json(); console.log('RESEND:',j); return j;
  }catch(e){console.log('RESEND ERR',e.message); return {ok:false};}
}

const PLANES={
  basico:{nombre:'Básico', precio:800000, trim:80000, asesores:3},
  premium:{nombre:'Premium + IA', precio:1400000, trim:95000, asesores:10},
  gold:{nombre:'Gold + IA + Llamadas', precio:2400000, trim:120000, asesores:999}
};

const VERIFY=(process.env.META_VERIFY_TOKEN||'klido123').trim();
console.log('V221 FINAL - FROM:',process.env.RESEND_FROM,' VERIFY:',VERIFY);

app.get('/health',(req,res)=>res.status(200).send('OK V221'));
app.get('/api/health',(req,res)=>res.json({ok:true, v:'V221', from:process.env.RESEND_FROM}));

// WEBHOOK META - CON MEDIA VISIBLE REPRODUCIBLE
const verifyHook=(req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY){console.log('WEBHOOK VERIFICADO OK'); return res.send(req.query['hub.challenge']);} res.sendStatus(403);};
app.get('/webhook',verifyHook); app.get('/webhook/:empresa_id',verifyHook);

async function handleWebhook(body){
  try{
    const val=body.entry?.[0]?.changes?.[0]?.value; if(!val) return;
    const phoneId=val.metadata?.phone_number_id;
    let eid=null;
    try{for(const f of fs.readdirSync(DB)){try{const j=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); if(String(j.config?.phone)===String(phoneId)) eid=j.empresa_id;}catch{}}}catch{}
    if(!eid){console.log('No empresa para phone',phoneId); return;}
    let db=getDB(eid); if(!db) return; if(!db.chats) db.chats={};
    if(val.messages){
      for(const m of val.messages){
        const from=m.from;
        if(!db.chats[from]){
          db.chats[from]={
            id:from, nombre:val.contacts?.[0]?.profile?.name||from,
            mensajes:[], notas:[], tags:['Nuevo'], no_leidos:0, last:Date.now(),
            estado:'nuevo', origen:'', campana:'', empresa:'', email:'', ubicacion:'Natura Goods'
          };
        }
        let texto=''; let type=m.type||'text'; let media_url=null; let mime=''; let filename='';
        if(type==='text'){ texto=m.text.body; }
        else{
          texto=m[type]?.caption||'📎 '+type;
          const mediaId=m[type]?.id;
          mime=m[type]?.mime_type||'';
          filename=m[type]?.filename||'';
          if(mediaId && db.config?.token){
            try{
              // Obtener url real de Meta
              const rr=await fetch(`https://graph.facebook.com/v20.0/${mediaId}`,{headers:{Authorization:`Bearer ${db.config.token}`}});
              const jj=await rr.json();
              if(jj.url){
                const mediaResp=await fetch(jj.url,{headers:{Authorization:`Bearer ${db.config.token}`}});
                const buffer=Buffer.from(await mediaResp.arrayBuffer());
                const ext=(mime.split('/')[1]||'bin').split(';')[0];
                const fname=Date.now()+'_'+mediaId+'.'+ext;
                const fpath=path.join(PUB_MEDIA, fname);
                fs.writeFileSync(fpath, buffer);
                media_url='/media/'+fname;
                console.log('MEDIA GUARDADO:',media_url);
              }
            }catch(e){console.log('media download err',e.message);}
          }
        }
        db.chats[from].mensajes.push({from:'cliente', texto, type, media_url, mime, filename, ts:Date.now()});
        db.chats[from].no_leidos=(db.chats[from].no_leidos||0)+1;
        db.chats[from].last=Date.now();
        // Si no tiene estado, queda como nuevo para segmentación
        if(!db.chats[from].estado) db.chats[from].estado='nuevo';
      }
      saveDB(eid,db);
    }
  }catch(e){console.log('handle err',e.message);}
}
app.post('/webhook',(req,res)=>{handleWebhook(req.body); res.sendStatus(200);});
app.post('/webhook/:empresa_id',(req,res)=>{handleWebhook(req.body); res.sendStatus(200);});

// ===== EMPRESA REGISTRO + ACTIVACION =====
app.post('/api/empresa/registrar', async (req,res)=>{
  const {nombre,email,pass,plan}=req.body;
  if(!nombre||!email||!pass) return res.json({ok:false, error:'Faltan datos'});
  const empresa_id=`${S(email)}_${Date.now()}`;
  const codigo=genCode();
  const db={
    empresa_id, nombre, email, plan:plan||'basico', plan_activo:false,
    codigo_activacion:codigo, creado:Date.now(),
    config:{phone:'', waba:'', token:''},
    usuarios:[{id:'admin', nombre:'Admin', email, pass, rol:'admin'}],
    chats:{}, reset_codes:[], calendar:[], metrics:{}
  };
  saveDB(empresa_id,db);
  const info=PLANES[plan]||PLANES.basico;
  const html=`<div style="font-family:Arial;background:#0b1020;color:#fff;padding:28px;border-radius:14px"><h2>KLIDO Avanza Consulting</h2><p>Hola ${nombre}</p><p>Plan: <b>${info.nombre} $${info.precio.toLocaleString()}/año + $${info.trim.toLocaleString()}/trim mant.</b></p><div style="font-size:36px;letter-spacing:6px;background:#fff;color:#000;padding:14px;border-radius:10px;text-align:center;font-weight:800">${codigo}</div><p style="font-size:12px;color:#94a3b8">Webhook: ${req.headers.host}/webhook/${empresa_id} - Desde soporte@klidoapp.com.co</p></div>`;
  const sent=await sendEmail(email, `KLIDO - Código activación ${codigo}`, html);
  res.json({ok:true, empresa_id, sent});
});

app.post('/api/empresa/activar',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false, error:'No existe'});
  if(String(db.codigo_activacion)!==String(req.body.codigo).trim()) return res.json({ok:false, error:'Código incorrecto'});
  db.plan_activo=true; saveDB(req.body.empresa_id,db); res.json({ok:true});
});

app.post('/api/login',(req,res)=>{
  for(const f of fs.readdirSync(DB)){
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
});

app.post('/api/auth/forgot', async (req,res)=>{
  for(const f of fs.readdirSync(DB)){
    try{
      const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      const u=db.usuarios.find(x=>x.email===req.body.email);
      if(u){
        const code=genCode(); db.reset_codes=db.reset_codes||[]; db.reset_codes.push({code, email:req.body.email, ts:Date.now(), usado:false}); saveDB(db.empresa_id,db);
        const html=`<div style="font-family:Arial;background:#0b1020;color:#fff;padding:28px;border-radius:14px"><h2>Recuperar contraseña KLIDO</h2><div style="font-size:36px;letter-spacing:6px;background:#fff;color:#000;padding:14px;border-radius:10px;text-align:center;font-weight:800">${code}</div><p style="font-size:12px;color:#94a3b8">Expira 15 min. soporte@klidoapp.com.co</p></div>`;
        const sent=await sendEmail(req.body.email, `KLIDO - Recuperación ${code}`, html);
        return res.json({ok:true, sent});
      }
    }catch{}
  }
  res.json({ok:false, error:'Email no encontrado'});
});

app.post('/api/auth/reset',(req,res)=>{
  for(const f of fs.readdirSync(DB)){
    try{
      const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
      const rc=(db.reset_codes||[]).find(c=>c.email===req.body.email && c.code===String(req.body.code).trim() &&!c.usado && Date.now()-c.ts < 900000);
      if(rc){ const u=db.usuarios.find(x=>x.email===req.body.email); u.pass=req.body.newPass; rc.usado=true; saveDB(db.empresa_id,db); return res.json({ok:true});}
    }catch{}
  }
  res.json({ok:false, error:'Código inválido'});
});

// ===== CONFIGURACION API POR EMPRESA INDIVIDUAL =====
app.get('/api/config/:eid',(req,res)=>{const db=getDB(req.params.eid); res.json({ok:true, config:db?.config||{phone:'',waba:'',token:''}});});
app.post('/api/config/api',(req,res)=>{
  const {empresa_id, phone, waba, token}=req.body;
  const db=getDB(empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  db.config={phone:String(phone||'').trim(), waba:String(waba||'').trim(), token:String(token||'').trim()};
  saveDB(empresa_id,db);
  console.log('API CONFIG GUARDADA',empresa_id,db.config);
  res.json({ok:true, config:db.config, webhook:`/webhook/${empresa_id}`});
});
app.post('/api/config/general',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); db.nombre=req.body.nombre||db.nombre; saveDB(req.body.empresa_id,db); res.json({ok:true});});

// ===== EMPRESAS, EQUIPOS, ESTADISTICAS, METRICAS, CALENDARIO, PLANES =====
app.get('/api/empresas',(req,res)=>{try{res.json(fs.readdirSync(DB).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'))}catch{return null}}).filter(Boolean).map(e=>({empresa_id:e.empresa_id, nombre:e.nombre, email:e.email, plan:e.plan, activo:e.plan_activo, phone:e.config?.phone, chats:Object.keys(e.chats||{}).length})));}catch{res.json([]);}});
app.get('/api/empresa/info/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({ok:false}); res.json({ok:true, empresa_id:db.empresa_id, nombre:db.nombre, email:db.email, plan:db.plan, plan_activo:db.plan_activo, usuarios:db.usuarios, config:db.config, chats_count:Object.keys(db.chats||{}).length, creado:db.creado});});
app.post('/api/equipo/add',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  const max=PLANES[db.plan]?.asesores||3;
  if(db.usuarios.length>=max && max!==999) return res.json({ok:false, error:`Plan ${db.plan} max ${max} asesores. Pasa a Gold ilimitado`});
  db.usuarios.push({id:'u'+Date.now(), nombre:req.body.email.split('@')[0], email:req.body.email, pass:req.body.pass, rol:req.body.rol||'agente'});
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});
app.get('/api/stats/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({ok:false}); const chats=Object.values(db.chats||{}); const msgs=chats.reduce((a,c)=>a+(c.mensajes?.length||0),0); res.json({ok:true, chats:chats.length, mensajes:msgs, agentes:db.usuarios.length, plan:db.plan, activo:db.plan_activo});});
app.get('/api/metrics/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({}); const chats=Object.values(db.chats||{}); res.json({ok:true, total_chats:chats.length, no_leidos:chats.reduce((a,c)=>a+(c.no_leidos||0),0), tags:chats.reduce((acc,c)=>{ (c.tags||[]).forEach(t=>acc[t]=(acc[t]||0)+1); return acc; },{})});});
app.get('/api/calendar/:eid',(req,res)=>{const db=getDB(req.params.eid); res.json(db?.calendar||[]);});
app.post('/api/calendar/add',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); db.calendar=db.calendar||[]; db.calendar.push({id:Date.now(), title:req.body.title, date:req.body.date, chat_id:req.body.chat_id||null, hecho:false}); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/calendar/done',(req,res)=>{const db=getDB(req.body.empresa_id); const c=(db.calendar||[]).find(x=>x.id==req.body.id); if(c) c.hecho=true; saveDB(req.body.empresa_id,db); res.json({ok:true});});

// ===== BANDEJA DE ENTRADA AVANZADA - SEGMENTACION + PUNTO ROJO + HISTORIAL + MEDIA + DATOS =====
app.get('/api/chats/:eid/:uid',(req,res)=>{
  const db=getDB(req.params.eid); if(!db) return res.json([]);
  const chats=Object.values(db.chats||{}).map(c=>({
    id:c.id, nombre:c.nombre||c.id, email:c.email||'', empresa:c.empresa||'', ubicacion:c.ubicacion||'',
    campana:c.campana||'', origen:c.origen||'', estado:c.estado||'nuevo',
    tags:c.tags||['Nuevo'], no_leidos:c.no_leidos||0, last:c.last||0,
    mensajes:c.mensajes||[], notas:c.notas||[]
  })).sort((a,b)=>b.last-a.last);
  res.json(chats);
});

app.get('/api/mensajes/:eid/:cid',(req,res)=>{
  const db=getDB(req.params.eid); const c=db?.chats?.[req.params.cid];
  if(!c) return res.json({mensajes:[], profile:{}});
  res.json({
    mensajes:(c.mensajes||[]).sort((a,b)=>a.ts-b.ts),
    profile:{
      id:c.id, nombre:c.nombre, email:c.email||'', empresa:c.empresa||'', ubicacion:c.ubicacion||'',
      campana:c.campana||'', origen:c.origen||'', estado:c.estado||'nuevo',
      tags:c.tags||[], notas:c.notas||[], no_leidos:c.no_leidos||0, last:c.last||0
    }
  });
});

// punto rojo desaparece SOLO al responder
app.post('/api/chat/leido',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false});
  db.chats[req.body.chat_id].no_leidos=0;
  if(db.chats[req.body.chat_id].estado==='nuevo') db.chats[req.body.chat_id].estado='interesado';
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});
app.post('/api/chat/no_leido',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false});
  db.chats[req.body.chat_id].no_leidos=(db.chats[req.body.chat_id].no_leidos||0)+1;
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});

app.post('/api/chat/profile',(req,res)=>{
  const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false});
  c.estado=req.body.estado||c.estado; c.origen=req.body.origen||c.origen; c.email=req.body.email||c.email;
  c.empresa=req.body.empresa||c.empresa; c.ubicacion=req.body.ubicacion||c.ubicacion; c.campana=req.body.campana||c.campana; c.nombre=req.body.nombre||c.nombre;
  if(req.body.notas){ c.notas=[{texto:req.body.notas, ts:Date.now()}]; }
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});

app.post('/api/chat/tag/add',(req,res)=>{
  const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false});
  c.tags=c.tags||[]; if(!c.tags.includes(req.body.tag)) c.tags.push(req.body.tag);
  const t=req.body.tag.toLowerCase();
  if(t==='cliente') c.estado='cliente';
  if(t==='campaña' || t==='campana') c.origen='campana_meta';
  if(t==='afiliación' || t==='afiliacion') c.origen='afiliacion';
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});
app.post('/api/chat/tag/remove',(req,res)=>{
  const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false});
  c.tags=(c.tags||[]).filter(x=>x!==req.body.tag); saveDB(req.body.empresa_id,db); res.json({ok:true});
});

app.post('/api/chat/nota',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false});
  db.chats[req.body.chat_id].notas=db.chats[req.body.chat_id].notas||[];
  db.chats[req.body.chat_id].notas.push({texto:req.body.texto, ts:Date.now()});
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});

// ===== MENSAJES ENVIAR TEXTO =====
app.post('/api/mensaje/enviar',async(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  if(!db.plan_activo) return res.json({ok:false, error:'Plan bloqueado - ingresa código'});
  if(!db.config?.phone||!db.config?.token) return res.json({ok:false, error:'Configura API primero en Configuración de API'});
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},body:JSON.stringify({messaging_product:'whatsapp', to:String(req.body.chat_id).replace(/\D/g,''), type:'text', text:{body:req.body.texto}})});
    const j=await r.json(); if(j.error){console.log('META ERR',j.error); return res.json({ok:false, error:j.error.message||JSON.stringify(j.error)});}
    if(!db.chats[req.body.chat_id]) db.chats[req.body.chat_id]={id:req.body.chat_id, nombre:req.body.chat_id, mensajes:[], no_leidos:0, last:Date.now(), tags:['Nuevo'], estado:'nuevo'};
    db.chats[req.body.chat_id].mensajes.push({from:'agente', texto:req.body.texto, type:'text', ts:Date.now()});
    db.chats[req.body.chat_id].last=Date.now();
    // al responder se borra punto rojo
    db.chats[req.body.chat_id].no_leidos=0;
    saveDB(req.body.empresa_id,db); res.json({ok:true});
  }catch(e){res.json({ok:false, error:e.message});}
});

// ===== MEDIA - FOTOS VIDEOS AUDIOS VISIBLES REPRODUCIBLES - HISTORIAL COMPLETO =====
app.post('/api/mensaje/media',upload.single('file'),async(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  const chatId=req.body.chat_id;
  if(!db.chats[chatId]) db.chats[chatId]={id:chatId, nombre:chatId, mensajes:[], no_leidos:0, last:Date.now(), tags:['Nuevo'], estado:'nuevo'};
  try{
    const file=req.file; if(!file) return res.json({ok:false});
    const mime=file.mimetype; let type='document';
    if(mime.startsWith('image/')) type='image';
    else if(mime.startsWith('video/')) type='video';
    else if(mime.startsWith('audio/')) type='audio';
    const ext=mime.split('/')[1]?.split(';')[0]||'bin';
    const fname=Date.now()+'_'+S(file.originalname).slice(0,30)+'.'+ext;
    const dest=path.join(PUB_MEDIA, fname);
    fs.copyFileSync(file.path, dest);
    const localUrl='/media/'+fname;
    // Intentar enviar por WhatsApp API
    if(db.config?.phone && db.config?.token){
      try{
        const formData=new (require('form-data'))();
        formData.append('file', fs.createReadStream(file.path), {contentType:mime, filename:file.originalname});
        formData.append('type', mime);
        formData.append('messaging_product','whatsapp');
        const up=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/media`,{method:'POST',headers:{Authorization:`Bearer ${db.config.token}`}, body:formData});
        const ju=await up.json();
        if(ju.id){
          await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{
            method:'POST',
            headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},
            body:JSON.stringify({messaging_product:'whatsapp', to:chatId.replace(/\D/g,''), type, [type]:{id:ju.id, caption:file.originalname}})
          });
        }
      }catch(e){console.log('media send err',e.message);}
    }
    db.chats[chatId].mensajes.push({from:'agente', texto:file.originalname, type, mime, media_url:localUrl, filename:file.originalname, ts:Date.now()});
    db.chats[chatId].last=Date.now(); db.chats[chatId].no_leidos=0;
    saveDB(req.body.empresa_id,db);
    res.json({ok:true, url:localUrl});
  }catch(e){console.log(e); res.json({ok:false, error:e.message});}
});

// ===== RUTAS PUBLIC PARA TU ESTRUCTURA REAL =====
app.get('/',(req,res)=>res.sendFile(path.join(PUB,'index.html')));
app.get('/crm',(req,res)=>res.sendFile(path.join(PUB,'crm.html')));
app.get('/crm.html',(req,res)=>res.sendFile(path.join(PUB,'crm.html')));
app.get('/app',(req,res)=>res.sendFile(path.join(PUB,'app.html')));
app.get('/app.html',(req,res)=>res.sendFile(path.join(PUB,'app.html')));
app.get('/crm/',(req,res)=>{
  const p1=path.join(PUB,'crm.html');
  const p2=path.join(PUB,'crm','index.html');
  if(fs.existsSync(p1)) return res.sendFile(p1);
  if(fs.existsSync(p2)) return res.sendFile(p2);
  return res.sendFile(p1);
});

const PORT=process.env.PORT||8080;
app.listen(PORT,'0.0.0.0',()=>console.log(`V221 COMPLETO OK - crm.html + bandeja avanzada + media + datos cliente en 0.0.0.0:${PORT} - FROM ${process.env.RESEND_FROM}`));
