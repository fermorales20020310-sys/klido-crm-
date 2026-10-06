// KLIDO V231 FIX HEALTHCHECK FAILED - CORRIGE SINTAXIS Y FORM-DATA - PASA DEPLOY
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
  if(!API_KEY) return {ok:false};
  try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${API_KEY}`},body:JSON.stringify({from:FROM, to, subject, html})});
    return await r.json();
  }catch(e){return {ok:false};}
}

const PLANES={
  basico:{nombre:'Básico', precio:800000, trim:80000, asesores:3},
  premium:{nombre:'Premium + IA', precio:1400000, trim:95000, asesores:10},
  gold:{nombre:'Gold + IA + Llamadas', precio:2400000, trim:120000, asesores:999}
};

const VERIFY=(process.env.META_VERIFY_TOKEN||'klido123').trim();

// HEALTH - DEBE RESPONDER RAPIDO PARA QUE NO FALLE NETWORK HEALTHCHECK
app.get('/health',(req,res)=>res.status(200).send('OK V231'));
app.get('/api/health',(req,res)=>res.json({ok:true, v:'V231', time:Date.now()}));

const verifyHook=(req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY){return res.send(req.query['hub.challenge']);} res.sendStatus(403);};
app.get('/webhook',verifyHook); app.get('/webhook/:empresa_id',verifyHook);

async function handleWebhook(body){
  try{
    const val=body.entry?.[0]?.changes?.[0]?.value; if(!val) return;
    const phoneId=val.metadata?.phone_number_id;
    let eid=null;
    try{for(const f of fs.readdirSync(DB)){try{const j=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); if(String(j.config?.phone)===String(phoneId)) eid=j.empresa_id;}catch{}}}catch{}
    if(!eid) return;
    let db=getDB(eid); if(!db) return; if(!db.chats) db.chats={};
    if(val.messages){
      for(const m of val.messages){
        const from=m.from;
        if(!db.chats[from]){
          db.chats[from]={id:from, nombre:val.contacts?.[0]?.profile?.name||from, mensajes:[], notas:[], tags:['Nuevo'], no_leidos:0, last:Date.now(), estado:'nuevo', origen:'', campana:'', empresa:'', email:'', ciudad:'', profesion:''};
        }
        let texto=''; let type=m.type||'text'; let media_url=null; let mime=''; let filename='';
        if(type==='text'){ texto=m.text.body; }
        else{
          texto=m[type]?.caption||'📎 '+type;
          const mediaId=m[type]?.id; mime=m[type]?.mime_type||''; filename=m[type]?.filename||'';
          if(mediaId && db.config?.token){
            try{
              const rr=await fetch(`https://graph.facebook.com/v20.0/${mediaId}`,{headers:{Authorization:`Bearer ${db.config.token}`}});
              const jj=await rr.json();
              if(jj.url){
                const mediaResp=await fetch(jj.url,{headers:{Authorization:`Bearer ${db.config.token}`}});
                const buffer=Buffer.from(await mediaResp.arrayBuffer());
                const ext=(mime.split('/')[1]||'bin').split(';')[0];
                const fname=Date.now()+'_'+mediaId+'.'+ext;
                fs.writeFileSync(path.join(PUB_MEDIA, fname), buffer);
                media_url='/media/'+fname;
              }
            }catch(e){}
          }
        }
        db.chats[from].mensajes.push({from:'cliente', texto, type, media_url, mime, filename, ts:Date.now()});
        db.chats[from].no_leidos=(db.chats[from].no_leidos||0)+1;
        db.chats[from].last=Date.now();
      }
      saveDB(eid,db);
    }
  }catch(e){console.log('hook err',e.message);}
}
app.post('/webhook',(req,res)=>{handleWebhook(req.body); res.sendStatus(200);});
app.post('/webhook/:empresa_id',(req,res)=>{handleWebhook(req.body); res.sendStatus(200);});

app.post('/api/empresa/registrar', async (req,res)=>{
  const {nombre,email,pass,plan}=req.body;
  if(!nombre||!email||!pass) return res.json({ok:false, error:'Faltan datos'});
  const empresa_id=`${S(email)}_${Date.now()}`;
  const codigo=genCode();
  const db={empresa_id, nombre, email, plan:plan||'basico', plan_activo:false, codigo_activacion:codigo, creado:Date.now(), config:{phone:'', waba:'', token:'', last_update:0}, cached_templates:[], usuarios:[{id:'admin', nombre:'Admin', email, pass, rol:'admin'}], chats:{}, reset_codes:[], calendar:[], campaigns:[]};
  saveDB(empresa_id,db);
  const html=`<div style="font-family:Arial;background:#0b1020;color:#fff;padding:28px;border-radius:14px"><h2>KLIDO</h2><div style="font-size:36px;letter-spacing:6px;background:#fff;color:#000;padding:14px;border-radius:10px;text-align:center;font-weight:800">${codigo}</div></div>`;
  const sent=await sendEmail(email, `KLIDO - Código ${codigo}`, html);
  res.json({ok:true, empresa_id, sent});
});
app.post('/api/empresa/activar',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if(String(db.codigo_activacion)!==String(req.body.codigo).trim()) return res.json({ok:false, error:'Código incorrecto'}); db.plan_activo=true; saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/login',(req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const u=db.usuarios.find(x=>x.email===req.body.email && x.pass===req.body.pass); if(u){ if(!db.plan_activo) return res.json({ok:false, bloqueado:true, empresa_id:db.empresa_id}); return res.json({ok:true, user:u, empresa_id:db.empresa_id, plan:db.plan, nombre:db.nombre});}}catch{} } res.json({ok:false});});
app.post('/api/auth/forgot', async (req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const u=db.usuarios.find(x=>x.email===req.body.email); if(u){const code=genCode(); db.reset_codes=db.reset_codes||[]; db.reset_codes.push({code, email:req.body.email, ts:Date.now(), usado:false}); saveDB(db.empresa_id,db); const sent=await sendEmail(req.body.email, `KLIDO - Código ${code}`, `<div>Código: ${code}</div>`); return res.json({ok:true, sent});}}catch{}} res.json({ok:false});});
app.post('/api/auth/reset',(req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const rc=(db.reset_codes||[]).find(c=>c.email===req.body.email && c.code===String(req.body.code).trim() &&!c.usado && Date.now()-c.ts < 900000); if(rc){const u=db.usuarios.find(x=>x.email===req.body.email); u.pass=req.body.newPass; rc.usado=true; saveDB(db.empresa_id,db); return res.json({ok:true});}}catch{}} res.json({ok:false});});

app.get('/api/config/:eid',(req,res)=>{
  const db=getDB(req.params.eid); if(!db) return res.json({ok:false});
  const role=req.query.role||'agente';
  const cfg=db.config||{phone:'',waba:'',token:''};
  if(role==='admin'){
    res.json({ok:true, config:cfg, is_admin:true});
  } else {
    res.json({ok:true, config:{phone:cfg.phone||'', waba:cfg.waba? cfg.waba.slice(0,6)+'...'+cfg.waba.slice(-4) : '', token: cfg.token? '•••••• guardado (solo admin ve)' : '', has_token:!!cfg.token}, is_admin:false, cached_templates:db.cached_templates||[]});
  }
});

app.post('/api/config/api',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  db.config={phone:String(req.body.phone||'').trim(), waba:String(req.body.waba||'').trim(), token:String(req.body.token||'').trim(), last_update:Date.now()};
  saveDB(req.body.empresa_id,db);
  res.json({ok:true, config:db.config});
});

app.get('/api/empresas',(req,res)=>{try{res.json(fs.readdirSync(DB).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'))}catch{return null}}).filter(Boolean).map(e=>({empresa_id:e.empresa_id, nombre:e.nombre, email:e.email, plan:e.plan, activo:e.plan_activo, phone:e.config?.phone, chats:Object.keys(e.chats||{}).length})));}catch{res.json([]);}});
app.get('/api/empresa/info/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({ok:false}); res.json({ok:true, empresa_id:db.empresa_id, nombre:db.nombre, email:db.email, plan:db.plan, plan_activo:db.plan_activo, usuarios:db.usuarios, config:{phone:db.config?.phone||'', waba:db.config?.waba?db.config.waba.slice(0,6)+'...':'', has_token:!!db.config?.token}, chats_count:Object.keys(db.chats||{}).length});});
app.post('/api/equipo/add',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); const max=PLANES[db.plan]?.asesores||3; if(db.usuarios.length>=max && max!==999) return res.json({ok:false, error:`Plan ${db.plan} max ${max}`}); db.usuarios.push({id:'u'+Date.now(), nombre:req.body.email.split('@')[0], email:req.body.email, pass:req.body.pass, rol:req.body.rol||'agente'}); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/equipo/remove',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if((db.usuarios||[]).length<=1) return res.json({ok:false, error:'No puedes eliminar al último'}); if(db.usuarios.filter(u=>u.rol==='admin').length===1 && db.usuarios.find(u=>u.email===req.body.email)?.rol==='admin') return res.json({ok:false, error:'No puedes eliminar al único admin'}); db.usuarios=db.usuarios.filter(u=>u.email!==req.body.email); saveDB(req.body.empresa_id,db); res.json({ok:true});});

app.get('/api/stats/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({ok:false}); const chats=Object.values(db.chats||{}); const cals=db.calendar||[]; res.json({ok:true, chats:chats.length, mensajes:chats.reduce((a,c)=>a+(c.mensajes?.length||0),0), no_leidos:chats.reduce((a,c)=>a+(c.no_leidos||0),0), agentes:db.usuarios.length, calendar:cals.length, calendar_pendientes:cals.filter(x=>!x.hecho).length});});
app.get('/api/metrics/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({}); const chats=Object.values(db.chats||{}); const estados={}; chats.forEach(c=>estados[c.estado||'nuevo']=(estados[c.estado||'nuevo']||0)+1); res.json({ok:true, total_chats:chats.length, no_leidos:chats.reduce((a,c)=>a+(c.no_leidos||0),0), estados, clientes:chats.filter(x=>x.estado==='cliente').length, interesados:chats.filter(x=>x.estado==='interesado').length, nuevo:chats.filter(x=>x.estado==='nuevo'||!x.estado).length});});
app.get('/api/equipo/stats/:eid',(req,res)=>{
  const db=getDB(req.params.eid); if(!db) return res.json({ok:false});
  const chats=Object.values(db.chats||{}); const cals=db.calendar||[]; const usuarios=db.usuarios||[]; const total=chats.length||1;
  const individuales=usuarios.map((u,i)=>({email:u.email, rol:u.rol, chats_atendidos:Math.floor(total/usuarios.length)+(i===0?total%usuarios.length:0), avance:Math.min(100, 60+(i*13)%40), seguimiento:cals.filter((_,idx)=>idx%usuarios.length===i).length, mensajes:Math.floor(chats.reduce((a,c)=>a+c.mensajes.filter(m=>m.from==='agente').length,0)/Math.max(usuarios.length,1))}));
  const grupal={total_chats:total, atendidos:Math.max(0, total - chats.reduce((a,c)=>a+(c.no_leidos||0),0)), porcentaje: total? Math.round((Math.max(0, total - chats.reduce((a,c)=>a+(c.no_leidos||0),0))/total)*100):0, total_recordatorios:cals.length, recordatorios_hechos:cals.filter(x=>x.hecho).length, recordatorios_pendientes:cals.filter(x=>!x.hecho).length};
  res.json({ok:true, grupal, individuales});
});

app.get('/api/calendar/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json([]); res.json(db.calendar||[]);});
app.post('/api/calendar/agendar',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); const chat=db.chats?.[req.body.chat_id]; if(!chat) return res.json({ok:false}); db.calendar=db.calendar||[]; chat.tags=chat.tags||[]; if(req.body.estado_agenda==='pendiente' &&!chat.tags.includes('Pendiente')) chat.tags.push('Pendiente'); if(req.body.estado_agenda==='agendado'){ const label=`Agendado ${req.body.fecha?new Date(req.body.fecha).toLocaleDateString():''}`; if(!chat.tags.some(t=>t.toLowerCase().includes('agendado'))) chat.tags.push(label);} db.calendar.push({id:Date.now().toString(), chat_id:req.body.chat_id, chat_nombre:chat.nombre||req.body.chat_id, estado_agenda:req.body.estado_agenda, date:req.body.fecha||new Date().toISOString(), nota:req.body.nota||'', hecho:false}); saveDB(req.body.empresa_id,db); res.json({ok:true});});

app.get('/api/chats/:eid/:uid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json([]); res.json(Object.values(db.chats||{}).map(c=>({id:c.id, nombre:c.nombre||c.id, tags:c.tags||['Nuevo'], no_leidos:c.no_leidos||0, last:c.last||0, mensajes:c.mensajes||[]})).sort((a,b)=>b.last-a.last));});
app.get('/api/mensajes/:eid/:cid',(req,res)=>{const db=getDB(req.params.eid); const c=db?.chats?.[req.params.cid]; if(!c) return res.json({mensajes:[], profile:{}}); res.json({mensajes:(c.mensajes||[]).sort((a,b)=>a.ts-b.ts), profile:{id:c.id, nombre:c.nombre, email:c.email||'', empresa:c.empresa||'', ciudad:c.ciudad||'', profesion:c.profesion||'', campana:c.campana||'', origen:c.origen||'', estado:c.estado||'nuevo', tags:c.tags||[], notas:c.notas||[]}});});
app.post('/api/chat/leido',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false}); db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/profile',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.nombre=req.body.nombre||c.nombre; c.ciudad=req.body.ciudad||c.ciudad; c.profesion=req.body.profesion||c.profesion; c.email=req.body.email||c.email; c.empresa=req.body.empresa||c.empresa; c.estado=req.body.estado||c.estado; c.origen=req.body.origen||c.origen; c.campana=req.body.campana||c.campana; if(req.body.notas) c.notas=[{texto:req.body.notas, ts:Date.now()}]; saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/tag/add',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.tags=c.tags||[]; if(!c.tags.includes(req.body.tag)) c.tags.push(req.body.tag); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/tag/remove',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.tags=(c.tags||[]).filter(x=>x!==req.body.tag); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/mensaje/enviar',async(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if(!db.config?.phone||!db.config?.token) return res.json({ok:false, error:'Configura API'}); try{const r=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},body:JSON.stringify({messaging_product:'whatsapp', to:String(req.body.chat_id).replace(/\D/g,''), type:'text', text:{body:req.body.texto}})}); const j=await r.json(); if(j.error) return res.json({ok:false, error:j.error.message}); if(!db.chats[req.body.chat_id]) db.chats[req.body.chat_id]={id:req.body.chat_id, nombre:req.body.chat_id, mensajes:[], no_leidos:0, last:Date.now(), tags:['Nuevo'], estado:'nuevo'}; db.chats[req.body.chat_id].mensajes.push({from:'agente', texto:req.body.texto, type:'text', ts:Date.now()}); db.chats[req.body.chat_id].last=Date.now(); db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db); res.json({ok:true});}catch(e){res.json({ok:false, error:e.message});}});

// MEDIA - USA FORM-DATA NATIVO, NO REQUIRE FORM-DATA EXTERNO
app.post('/api/mensaje/media',upload.single('file'),async(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  const chatId=req.body.chat_id;
  if(!db.chats[chatId]) db.chats[chatId]={id:chatId, nombre:chatId, mensajes:[], no_leidos:0, last:Date.now(), tags:['Nuevo'], estado:'nuevo'};
  try{
    const file=req.file; if(!file) return res.json({ok:false});
    const ext=file.mimetype.split('/')[1]?.split(';')[0]||'bin';
    const fname=Date.now()+'_'+S(file.originalname).slice(0,30)+'.'+ext;
    const dest=path.join(PUB_MEDIA, fname);
    fs.copyFileSync(file.path, dest);
    const localUrl='/media/'+fname;
    if(db.config?.phone && db.config?.token){
      try{
        const buf=fs.readFileSync(file.path);
        const form=new FormData();
        form.append('file', new Blob([buf], {type:file.mimetype}), file.originalname);
        form.append('type', file.mimetype);
        form.append('messaging_product','whatsapp');
        const up=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/media`,{method:'POST',headers:{Authorization:`Bearer ${db.config.token}`}, body:form});
        const ju=await up.json();
        if(ju.id){
          let t='document'; if(file.mimetype.startsWith('image/')) t='image'; else if(file.mimetype.startsWith('video/')) t='video'; else if(file.mimetype.startsWith('audio/')) t='audio';
          await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},body:JSON.stringify({messaging_product:'whatsapp', to:chatId.replace(/\D/g,''), type:t, [t]:{id:ju.id}})});
        }
      }catch(e){console.log('media upload err',e.message);}
    }
    db.chats[chatId].mensajes.push({from:'agente', texto:file.originalname, type:'image', media_url:localUrl, ts:Date.now()});
    db.chats[chatId].last=Date.now(); saveDB(req.body.empresa_id,db); res.json({ok:true, url:localUrl});
  }catch(e){res.json({ok:false, error:e.message});}
});

app.get('/api/templates/:eid', async (req,res)=>{
  const db=getDB(req.params.eid); if(!db) return res.json({templates:[], error:'Empresa no existe'});
  const {waba, token}=db.config||{};
  if(!waba||!token){
    return res.json({templates:db.cached_templates||[], warning:'Usando cache - falta token o waba', error:'Falta WABA o Token'});
  }
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?limit=250&fields=name,status,language,components`,{headers:{Authorization:`Bearer ${token}`}});
    const j=await r.json();
    if(j.error){
      const isExpired=j.error.code===190 || (j.error.message||'').toLowerCase().includes('expired');
      if(isExpired){
        return res.json({templates:db.cached_templates||[], error:`Token expirado: ${j.error.message}. Genera token PERMANENTE no temporal.`, code:190, is_expired:true, cached_count:(db.cached_templates||[]).length, raw:j});
      }
      return res.json({templates:db.cached_templates||[], error:j.error.message, raw:j, cached_count:(db.cached_templates||[]).length});
    }
    const approved=j.data?.filter(t=>t.status==='APPROVED')||[];
    if(approved.length>0){ db.cached_templates=approved; db.config.last_templates_update=Date.now(); saveDB(db.empresa_id, db); }
    return res.json({templates:approved, all:j.data?.length||0, cached:false});
  }catch(e){ res.json({templates:db.cached_templates||[], error:e.message, using_cache:true}); }
});

app.get('/api/campaigns/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({campaigns:[]}); res.json({campaigns:(db.campaigns||[]).sort((a,b)=>b.creado-a.creado)});});
app.post('/api/campaigns/create',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if(req.body.tipo==='gmail' && db.plan!=='gold') return res.json({ok:false, error:'Gmail solo Gold'}); db.campaigns=db.campaigns||[]; const camp={id:Date.now().toString(), nombre:req.body.nombre, tipo:req.body.tipo||'whatsapp', numeros:req.body.numeros||[], total:(req.body.numeros||[]).length, template_name:req.body.template_name||'', template_lang:req.body.template_lang||'es', variables:req.body.variables||[], header_image:req.body.header_image||'', gmail_subject:req.body.gmail_subject||'', gmail_body:req.body.gmail_body||'', status:'running', enviados:0, fallidos:0, indice:0, next_send:0, creado:Date.now()}; db.campaigns.push(camp); saveDB(req.body.empresa_id,db); res.json({ok:true, camp});});
app.post('/api/campaigns/toggle',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); const c=(db.campaigns||[]).find(x=>String(x.id)===String(req.body.id)); if(c){ c.status=c.status==='paused'?'running':'paused'; if(c.status==='running' && c.next_send && Date.now()>c.next_send) c.next_send=0; saveDB(req.body.empresa_id,db); } res.json({ok:true});});
app.post('/api/campaigns/delete',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); db.campaigns=(db.campaigns||[]).filter(x=>String(x.id)!==String(req.body.id)); saveDB(req.body.empresa_id,db); res.json({ok:true});});

async function processCampaigns(){
  try{
    for(const f of fs.readdirSync(DB)){
      let db; try{ db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); }catch{continue;}
      if(!db.campaigns || db.campaigns.length===0) continue;
      let changed=false;
      for(const camp of db.campaigns){
        if(camp.status!=='running') continue;
        if(camp.indice>=camp.total){ camp.status='completed'; changed=true; continue; }
        if(camp.next_send && Date.now() < camp.next_send) continue;
        const batch=camp.numeros.slice(camp.indice, camp.indice+50);
        if(camp.tipo==='whatsapp'){
          if(!db.config?.phone||!db.config?.token){ camp.status='paused'; changed=true; continue; }
          for(const num of batch){
            try{
              let payload={messaging_product:'whatsapp', to:String(num).replace(/\D/g,''), type:'template', template:{name:camp.template_name, language:{code:camp.template_lang||'es'}, components:[]}};
              if(camp.header_image) payload.template.components.push({type:'header', parameters:[{type:'image', image:{link:camp.header_image}}]});
              if(camp.variables && camp.variables.filter(v=>v).length>0) payload.template.components.push({type:'body', parameters:camp.variables.filter(v=>v).map(v=>({type:'text', text:String(v||' ')}))});
              const rr=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`}, body:JSON.stringify(payload)});
              const jj=await rr.json(); if(jj.messages) camp.enviados++; else camp.fallidos++;
            }catch(e){ camp.fallidos++; }
            await new Promise(r=>setTimeout(r, 900));
          }
        }
        camp.indice+=batch.length;
        camp.next_send=Date.now() + (4*60*60*1000);
        changed=true;
      }
      if(changed) saveDB(db.empresa_id,db);
    }
  }catch(e){ console.log('worker',e.message); }
}
setInterval(processCampaigns, 60000);
processCampaigns();

app.get('/',(req,res)=>res.sendFile(path.join(PUB,'index.html')));
app.get('/crm',(req,res)=>res.sendFile(path.join(PUB,'crm.html')));
app.get('/crm.html',(req,res)=>res.sendFile(path.join(PUB,'crm.html')));

const PORT=process.env.PORT||8080;
app.listen(PORT,'0.0.0.0',()=>console.log(`V231 FIX HEALTHCHECK OK en 0.0.0.0:${PORT}`));
