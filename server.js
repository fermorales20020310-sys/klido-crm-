// KLIDO V228 FINAL COMPLETO - CAMPAÑAS TODO ESPACIO PLANTILLAS APROBADAS 50 CADA 4H PAUSAR CONTINUAR SEGUIMIENTO - SIN DAÑAR NADA
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

app.get('/health',(req,res)=>res.status(200).send('OK V228'));
app.get('/api/health',(req,res)=>res.json({ok:true, v:'V228'}));

// WEBHOOK META - MEDIA VISIBLE REPRODUCIBLE
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
          db.chats[from]={
            id:from, nombre:val.contacts?.[0]?.profile?.name||from,
            mensajes:[], notas:[], tags:['Nuevo'], no_leidos:0, last:Date.now(),
            estado:'nuevo', origen:'', campana:'', empresa:'', email:'', ciudad:'', profesion:'', prioridad:'media', ubicacion:''
          };
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
                const fpath=path.join(PUB_MEDIA, fname);
                fs.writeFileSync(fpath, buffer);
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

// EMPRESA REGISTRO + ACTIVACION + LOGIN
app.post('/api/empresa/registrar', async (req,res)=>{
  const {nombre,email,pass,plan}=req.body;
  if(!nombre||!email||!pass) return res.json({ok:false, error:'Faltan datos'});
  const empresa_id=`${S(email)}_${Date.now()}`;
  const codigo=genCode();
  const db={empresa_id, nombre, email, plan:plan||'basico', plan_activo:false, codigo_activacion:codigo, creado:Date.now(), config:{phone:'', waba:'', token:''}, usuarios:[{id:'admin', nombre:'Admin', email, pass, rol:'admin'}], chats:{}, reset_codes:[], calendar:[], campaigns:[]};
  saveDB(empresa_id,db);
  const info=PLANES[plan]||PLANES.basico;
  const html=`<div style="font-family:Arial;background:#0b1020;color:#fff;padding:28px;border-radius:14px"><h2>KLIDO Avanza Consulting</h2><p>Hola ${nombre}</p><p>Plan: <b>${info.nombre}</b></p><div style="font-size:36px;letter-spacing:6px;background:#fff;color:#000;padding:14px;border-radius:10px;text-align:center;font-weight:800">${codigo}</div></div>`;
  const sent=await sendEmail(email, `KLIDO - Código ${codigo}`, html);
  res.json({ok:true, empresa_id, sent});
});
app.post('/api/empresa/activar',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if(String(db.codigo_activacion)!==String(req.body.codigo).trim()) return res.json({ok:false, error:'Código incorrecto'}); db.plan_activo=true; saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/login',(req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const u=db.usuarios.find(x=>x.email===req.body.email && x.pass===req.body.pass); if(u){ if(!db.plan_activo) return res.json({ok:false, bloqueado:true, empresa_id:db.empresa_id}); return res.json({ok:true, user:u, empresa_id:db.empresa_id, plan:db.plan, nombre:db.nombre});}}catch{} } res.json({ok:false});});
app.post('/api/auth/forgot', async (req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const u=db.usuarios.find(x=>x.email===req.body.email); if(u){const code=genCode(); db.reset_codes=db.reset_codes||[]; db.reset_codes.push({code, email:req.body.email, ts:Date.now(), usado:false}); saveDB(db.empresa_id,db); const html=`<div>Código: ${code}</div>`; const sent=await sendEmail(req.body.email, `KLIDO - Código ${code}`, html); return res.json({ok:true, sent});}}catch{}} res.json({ok:false});});
app.post('/api/auth/reset',(req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const rc=(db.reset_codes||[]).find(c=>c.email===req.body.email && c.code===String(req.body.code).trim() &&!c.usado && Date.now()-c.ts < 900000); if(rc){const u=db.usuarios.find(x=>x.email===req.body.email); u.pass=req.body.newPass; rc.usado=true; saveDB(db.empresa_id,db); return res.json({ok:true});}}catch{}} res.json({ok:false});});

// CONFIG
app.get('/api/config/:eid',(req,res)=>{const db=getDB(req.params.eid); res.json({ok:true, config:db?.config||{}});});
app.post('/api/config/api',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); db.config={phone:String(req.body.phone||'').trim(), waba:String(req.body.waba||'').trim(), token:String(req.body.token||'').trim()}; saveDB(req.body.empresa_id,db); res.json({ok:true, config:db.config, webhook:`/webhook/${req.body.empresa_id}`});});

// EMPRESAS EQUIPOS
app.get('/api/empresas',(req,res)=>{try{res.json(fs.readdirSync(DB).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'))}catch{return null}}).filter(Boolean).map(e=>({empresa_id:e.empresa_id, nombre:e.nombre, email:e.email, plan:e.plan, activo:e.plan_activo, phone:e.config?.phone, chats:Object.keys(e.chats||{}).length})));}catch{res.json([]);}});
app.get('/api/empresa/info/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({ok:false}); res.json({ok:true, empresa_id:db.empresa_id, nombre:db.nombre, email:db.email, plan:db.plan, plan_activo:db.plan_activo, usuarios:db.usuarios, config:db.config, chats_count:Object.keys(db.chats||{}).length});});
app.post('/api/equipo/add',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); const max=PLANES[db.plan]?.asesores||3; if(db.usuarios.length>=max && max!==999) return res.json({ok:false, error:`Plan ${db.plan} max ${max}`}); db.usuarios.push({id:'u'+Date.now(), nombre:req.body.email.split('@')[0], email:req.body.email, pass:req.body.pass, rol:req.body.rol||'agente'}); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/equipo/remove',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if((db.usuarios||[]).length<=1) return res.json({ok:false, error:'No puedes eliminar al último'}); if(db.usuarios.filter(u=>u.rol==='admin').length===1 && db.usuarios.find(u=>u.email===req.body.email)?.rol==='admin') return res.json({ok:false, error:'No puedes eliminar al único admin'}); db.usuarios=db.usuarios.filter(u=>u.email!==req.body.email); saveDB(req.body.empresa_id,db); res.json({ok:true});});

// ESTADISTICAS Y METRICAS
app.get('/api/stats/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({ok:false}); const chats=Object.values(db.chats||{}); const msgs=chats.reduce((a,c)=>a+(c.mensajes?.length||0),0); const no_leidos=chats.reduce((a,c)=>a+(c.no_leidos||0),0); const cals=db.calendar||[]; res.json({ok:true, chats:chats.length, mensajes:msgs, no_leidos, agentes:db.usuarios.length, calendar:cals.length});});
app.get('/api/metrics/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({}); const chats=Object.values(db.chats||{}); const cals=db.calendar||[]; const tags={}; chats.forEach(c=>(c.tags||[]).forEach(t=>tags[t]=(tags[t]||0)+1)); res.json({ok:true, total_chats:chats.length, no_leidos:chats.reduce((a,c)=>a+(c.no_leidos||0),0), tags, calendar_total:cals.length, clientes:chats.filter(x=>x.estado==='cliente').length, interesados:chats.filter(x=>x.estado==='interesado').length});});

// CALENDARIO
app.get('/api/calendar/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json([]); res.json(db.calendar||[]);});
app.post('/api/calendar/agendar',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); const chat=db.chats?.[req.body.chat_id]; if(!chat) return res.json({ok:false}); db.calendar=db.calendar||[]; chat.tags=chat.tags||[]; if(req.body.estado_agenda==='pendiente' &&!chat.tags.includes('Pendiente')) chat.tags.push('Pendiente'); if(req.body.estado_agenda==='agendado'){ const label=`Agendado ${req.body.fecha?new Date(req.body.fecha).toLocaleDateString():''}`; if(!chat.tags.some(t=>t.toLowerCase().includes('agendado'))) chat.tags.push(label);} const entry={id:Date.now().toString(), chat_id:req.body.chat_id, chat_nombre:chat.nombre||req.body.chat_id, estado_agenda:req.body.estado_agenda, date:req.body.fecha||new Date().toISOString(), nota:req.body.nota||'', alarma:true, hecho:false, creado:Date.now()}; db.calendar.push(entry); saveDB(req.body.empresa_id,db); res.json({ok:true, entry});});
app.post('/api/calendar/done',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); const c=(db.calendar||[]).find(x=>String(x.id)===String(req.body.id)); if(c){ c.hecho=true; const chat=db.chats?.[c.chat_id]; if(chat) chat.tags=(chat.tags||[]).filter(t=>!t.toLowerCase().includes('pendiente')&&!t.toLowerCase().includes('agendado')); saveDB(req.body.empresa_id,db);} res.json({ok:true});});
app.post('/api/calendar/delete',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); db.calendar=(db.calendar||[]).filter(x=>String(x.id)!==String(req.body.id)); saveDB(req.body.empresa_id,db); res.json({ok:true});});

// INBOX - SOLO TODOS Y NO LEIDOS + PUNTO ROJO
app.get('/api/chats/:eid/:uid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json([]); const chats=Object.values(db.chats||{}).map(c=>({id:c.id, nombre:c.nombre||c.id, email:c.email||'', empresa:c.empresa||'', ciudad:c.ciudad||'', profesion:c.profesion||'', campana:c.campana||'', origen:c.origen||'', estado:c.estado||'nuevo', tags:c.tags||['Nuevo'], no_leidos:c.no_leidos||0, last:c.last||0, mensajes:c.mensajes||[]})).sort((a,b)=>b.last-a.last); res.json(chats);});
app.get('/api/mensajes/:eid/:cid',(req,res)=>{const db=getDB(req.params.eid); const c=db?.chats?.[req.params.cid]; if(!c) return res.json({mensajes:[], profile:{}}); res.json({mensajes:(c.mensajes||[]).sort((a,b)=>a.ts-b.ts), profile:{id:c.id, nombre:c.nombre, email:c.email||'', empresa:c.empresa||'', ciudad:c.ciudad||'', profesion:c.profesion||'', campana:c.campana||'', origen:c.origen||'', estado:c.estado||'nuevo', tags:c.tags||[], notas:c.notas||[]}});});
app.post('/api/chat/leido',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false}); db.chats[req.body.chat_id].no_leidos=0; if(db.chats[req.body.chat_id].estado==='nuevo') db.chats[req.body.chat_id].estado='interesado'; saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/profile',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.nombre=req.body.nombre||c.nombre; c.ciudad=req.body.ciudad||c.ciudad; c.profesion=req.body.profesion||c.profesion; c.email=req.body.email||c.email; c.empresa=req.body.empresa||c.empresa; c.estado=req.body.estado||c.estado; c.origen=req.body.origen||c.origen; c.campana=req.body.campana||c.campana; if(req.body.notas){ c.notas=[{texto:req.body.notas, ts:Date.now()}]; } saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/tag/add',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.tags=c.tags||[]; if(!c.tags.includes(req.body.tag)) c.tags.push(req.body.tag); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/tag/remove',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.tags=(c.tags||[]).filter(x=>x!==req.body.tag); saveDB(req.body.empresa_id,db); res.json({ok:true});});

// MENSAJES
app.post('/api/mensaje/enviar',async(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if(!db.config?.phone||!db.config?.token) return res.json({ok:false, error:'Configura API'}); try{const r=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},body:JSON.stringify({messaging_product:'whatsapp', to:String(req.body.chat_id).replace(/\D/g,''), type:'text', text:{body:req.body.texto}})}); const j=await r.json(); if(j.error) return res.json({ok:false, error:j.error.message}); if(!db.chats[req.body.chat_id]) db.chats[req.body.chat_id]={id:req.body.chat_id, nombre:req.body.chat_id, mensajes:[], no_leidos:0, last:Date.now(), tags:['Nuevo'], estado:'nuevo'}; db.chats[req.body.chat_id].mensajes.push({from:'agente', texto:req.body.texto, type:'text', ts:Date.now()}); db.chats[req.body.chat_id].last=Date.now(); db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db); res.json({ok:true});}catch(e){res.json({ok:false, error:e.message});}});
app.post('/api/mensaje/media',upload.single('file'),async(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); const chatId=req.body.chat_id; if(!db.chats[chatId]) db.chats[chatId]={id:chatId, nombre:chatId, mensajes:[], no_leidos:0, last:Date.now(), tags:['Nuevo'], estado:'nuevo'}; try{const file=req.file; if(!file) return res.json({ok:false}); const mime=file.mimetype; let type='document'; if(mime.startsWith('image/')) type='image'; else if(mime.startsWith('video/')) type='video'; else if(mime.startsWith('audio/')) type='audio'; const ext=mime.split('/')[1]?.split(';')[0]||'bin'; const fname=Date.now()+'_'+S(file.originalname).slice(0,30)+'.'+ext; const dest=path.join(PUB_MEDIA, fname); fs.copyFileSync(file.path, dest); const localUrl='/media/'+fname; if(db.config?.phone && db.config?.token){try{const FormData=require('form-data'); const formData=new FormData(); formData.append('file', fs.createReadStream(file.path), {contentType:mime, filename:file.originalname}); formData.append('type', mime); formData.append('messaging_product','whatsapp'); const up=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/media`,{method:'POST',headers:{Authorization:`Bearer ${db.config.token}`}, body:formData}); const ju=await up.json(); if(ju.id){ await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},body:JSON.stringify({messaging_product:'whatsapp', to:chatId.replace(/\D/g,''), type, [type]:{id:ju.id, caption:file.originalname}})});}}catch(e){}} db.chats[chatId].mensajes.push({from:'agente', texto:file.originalname, type, mime, media_url:localUrl, filename:file.originalname, ts:Date.now()}); db.chats[chatId].last=Date.now(); db.chats[chatId].no_leidos=0; saveDB(req.body.empresa_id,db); res.json({ok:true, url:localUrl});}catch(e){res.json({ok:false, error:e.message});}});

// CAMPAÑAS - PLANTILLAS APROBADAS DE TU API CONECTADA TOKEN WABA PHONE - 50 CADA 4 HORAS - HISTORIAL PAUSAR CONTINUAR SEGUIMIENTO
app.get('/api/templates/:eid', async (req,res)=>{
  const db=getDB(req.params.eid); if(!db) return res.json({templates:[]});
  const {waba, token}=db.config||{};
  if(!waba||!token) return res.json({templates:[], error:'Configura WABA y Token en Configuración API'});
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?limit=250`,{headers:{Authorization:`Bearer ${token}`}});
    const j=await r.json();
    if(j.data){
      const approved=j.data.filter(t=>t.status==='APPROVED');
      return res.json({templates:approved, all:j.data.length});
    }
    return res.json({templates:[], raw:j});
  }catch(e){ res.json({templates:[], error:e.message}); }
});

app.get('/api/campaigns/:eid',(req,res)=>{
  const db=getDB(req.params.eid); if(!db) return res.json({campaigns:[]});
  res.json({campaigns:(db.campaigns||[]).sort((a,b)=>b.creado-a.creado)});
});

app.post('/api/campaigns/create',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  if(req.body.tipo==='gmail' && db.plan!=='gold') return res.json({ok:false, error:'Gmail solo disponible en plan Gold'});
  db.campaigns=db.campaigns||[];
  const camp={
    id:Date.now().toString(),
    nombre:req.body.nombre,
    tipo:req.body.tipo||'whatsapp',
    numeros:req.body.numeros||[],
    total:(req.body.numeros||[]).length,
    template_name:req.body.template_name||'',
    template_lang:req.body.template_lang||'es',
    variables:req.body.variables||[],
    header_image:req.body.header_image||'',
    gmail_subject:req.body.gmail_subject||'',
    gmail_body:req.body.gmail_body||'',
    status:'running',
    enviados:0,
    fallidos:0,
    indice:0,
    next_send:0,
    creado:Date.now(),
    logs:[]
  };
  db.campaigns.push(camp);
  saveDB(req.body.empresa_id,db);
  res.json({ok:true, camp});
});

app.post('/api/campaigns/toggle',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  const c=(db.campaigns||[]).find(x=>String(x.id)===String(req.body.id));
  if(c){ c.status=c.status==='paused'?'running':'paused'; if(c.status==='running' && c.next_send && Date.now()>c.next_send) c.next_send=0; saveDB(req.body.empresa_id,db); }
  res.json({ok:true});
});

app.post('/api/campaigns/delete',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  db.campaigns=(db.campaigns||[]).filter(x=>String(x.id)!==String(req.body.id));
  saveDB(req.body.empresa_id,db);
  res.json({ok:true});
});

// WORKER 50 CADA 4 HORAS - EVITAR BANEOS - CON SEGUIMIENTO HISTORIAL
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
          if(!db.config?.phone||!db.config?.token){ camp.status='paused'; camp.logs.push({ts:Date.now(), msg:'Falta config API'}); changed=true; continue; }
          for(const num of batch){
            try{
              let payload={
                messaging_product:'whatsapp',
                to:String(num).replace(/\D/g,''),
                type:'template',
                template:{name:camp.template_name, language:{code:camp.template_lang||'es'}, components:[]}
              };
              if(camp.header_image){
                payload.template.components.push({type:'header', parameters:[{type:'image', image:{link:camp.header_image}}]});
              }
              if(camp.variables && camp.variables.filter(v=>v).length>0){
                payload.template.components.push({type:'body', parameters:camp.variables.filter(v=>v).map(v=>({type:'text', text:String(v||' ')}))});
              }
              const rr=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`}, body:JSON.stringify(payload)});
              const jj=await rr.json();
              if(jj.messages||jj.contacts) camp.enviados++; else { camp.fallidos++; camp.logs.push({ts:Date.now(), msg:JSON.stringify(jj).slice(0,180)}); }
            }catch(e){ camp.fallidos++; }
            await new Promise(r=>setTimeout(r, 1000));
          }
        } else if(camp.tipo==='gmail'){
          for(const email of batch){
            try{
              const sent=await sendEmail(email, camp.gmail_subject||camp.nombre, `<div style="font-family:Arial">${(camp.gmail_body||'').replace(/\n/g,'<br>')}</div>`);
              if(sent &&!sent.error) camp.enviados++; else camp.fallidos++;
            }catch{ camp.fallidos++; }
            await new Promise(r=>setTimeout(r, 700));
          }
        }
        camp.indice+=batch.length;
        camp.next_send=Date.now() + (4*60*60*1000);
        changed=true;
      }
      if(changed) saveDB(db.empresa_id,db);
    }
  }catch(e){ console.log('camp worker 50 cada 4h',e.message); }
}
setInterval(processCampaigns, 60000);
processCampaigns();

// RUTAS PUBLIC
app.get('/',(req,res)=>res.sendFile(path.join(PUB,'index.html')));
app.get('/crm',(req,res)=>res.sendFile(path.join(PUB,'crm.html')));
app.get('/crm.html',(req,res)=>res.sendFile(path.join(PUB,'crm.html')));
app.get('/app',(req,res)=>res.sendFile(path.join(PUB,'app.html')));

const PORT=process.env.PORT||8080;
app.listen(PORT,'0.0.0.0',()=>console.log(`V228 OK - campañas todo espacio plantillas aprobadas api 50 cada 4h pausar continuar historial seguimiento en 0.0.0.0:${PORT}`));
