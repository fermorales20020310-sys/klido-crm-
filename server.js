// KLIDO V256 - TU V254 EXACTO + FIX SI APROBADA SE ENVIA AUTO IMAGEN - NO BORRA NADA
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
app.use('/media', express.static(PUB_MEDIA));

// SI NO LE PONES URL EN LA CAMPAÑA, USA ESTA - PON AQUI TU IMAGEN DE RAILWAY
const DEFAULT_ACOL_IMAGE = process.env.DEFAULT_IMAGE || 'https://images.unsplash.com/photo-1558008258-3256797b43f3?w=1080';

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
  basico:{nombre:'Básico', precio:800000, trim:80000, asesores:2, envios:1, mensajes:1000, ia:false, gmail:false, llamadas:false},
  premium:{nombre:'Premium + IA', precio:1300000, trim:95000, asesores:5, envios:5, mensajes:5000, ia:true, gmail:false, llamadas:false},
  gold:{nombre:'Gold + IA + Llamadas', precio:2400000, trim:130000, asesores:999, envios:999, mensajes:999999, ia:true, gmail:true, llamadas:true}
};

const VERIFY=(process.env.META_VERIFY_TOKEN||'klido123').trim();
app.get('/health',(req,res)=>res.status(200).send('OK V256 AUTO IMAGEN FULL'));
app.get('/api/health',(req,res)=>res.json({ok:true, v:'V256 AUTO IMAGEN - SI APROBADA SE ENVIA', time:Date.now(), planes:PLANES}));

const verifyHook=(req,res)=>{
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY){
    console.log('✅ WEBHOOK VERIFICADO CON META - token klido123 OK');
    return res.send(req.query['hub.challenge']);
  }
  console.log('❌ WEBHOOK VERIFY FAIL', req.query['hub.verify_token']);
  res.sendStatus(403);
};
app.get('/webhook',verifyHook);
app.get('/webhook/:empresa_id',verifyHook);

async function handleWebhook(body){
  try{
    if(body.object!=='whatsapp_business_account') return;
    for(const entry of body.entry||[]){
      for(const change of entry.changes||[]){
        const val=change.value;
        if(!val) continue;
        const phoneId=val.metadata?.phone_number_id;
        if(!phoneId) continue;
        let eid=null, db=null;
        try{
          for(const f of fs.readdirSync(DB)){
            try{
              const j=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'));
              if(String(j.config?.phone)===String(phoneId)){ eid=j.empresa_id; db=j; break; }
            }catch{}
          }
        }catch{}
        if(!eid ||!db) { console.log(`❌ No empresa con phone ${phoneId}`); continue; }
        if(!db.chats) db.chats={};
        if(val.messages){
          for(const m of val.messages){
            const from=m.from;
            if(!db.chats[from]){
              db.chats[from]={
                id:from,
                nombre:val.contacts?.[0]?.profile?.name||from,
                mensajes:[],
                notas:[],
                tags:['Nuevo'],
                no_leidos:0,
                last:Date.now(),
                estado:'nuevo',
                origen:'',
                campana:'',
                empresa:'',
                email:'',
                ciudad:'',
                profesion:''
              };
            }
            let texto='';
            let type=m.type||'text';
            let media_url=null;
            let mime='';
            let filename='';
            if(type==='text'){
              texto=m.text?.body||'';
            }
            else if(['image','audio','voice','video','document','sticker','location','contacts'].includes(type)){
              texto=m[type]?.caption|| (type==='audio'?'🎤 Audio': type==='voice'?'🎤 Nota de voz': type==='image'?'📷 Foto': type==='video'?'🎥 Video': type==='document'?'📄 Archivo': '📎 '+type);
              const mediaId=m[type]?.id;
              mime=m[type]?.mime_type||'';
              filename=m[type]?.filename||'';
              if(mediaId && db.config?.token){
                try{
                  const rr=await fetch(`https://graph.facebook.com/v20.0/${mediaId}`,{headers:{Authorization:`Bearer ${db.config.token}`}});
                  const jj=await rr.json();
                  if(jj.url){
                    const mediaResp=await fetch(jj.url,{headers:{Authorization:`Bearer ${db.config.token}`}});
                    const buffer=Buffer.from(await mediaResp.arrayBuffer());
                    let ext=(mime.split('/')[1]||'bin').split(';')[0];
                    if(type==='voice' || type==='audio') ext= mime.includes('ogg')?'ogg':'mp3';
                    if(type==='image') ext= mime.includes('png')?'png':'jpg';
                    if(type==='video') ext='mp4';
                    if(type==='document' && filename) ext=filename.split('.').pop();
                    const fname=Date.now()+'_'+mediaId+'.'+ext;
                    fs.writeFileSync(path.join(PUB_MEDIA, fname), buffer);
                    media_url='/media/'+fname;
                    console.log(`✅ Media ${type} guardada: ${fname} para ${from}`);
                  }
                }catch(e){ console.log('media err', e.message); }
              }
              if(type==='location'){
                texto=`📍 Ubicación: ${m.location?.latitude},${m.location?.longitude}`;
              }
            }
            db.chats[from].mensajes.push({
              id:m.id||Date.now().toString(),
              from:'cliente',
              texto,
              type,
              media_url,
              mime,
              filename,
              ts: Date.now(),
              wa_timestamp: m.timestamp
            });
            db.chats[from].no_leidos=(db.chats[from].no_leidos||0)+1;
            db.chats[from].last=Date.now();
          }
          saveDB(eid,db);
          console.log(`💬 Mensajes guardados para ${db.nombre} (${eid})`);
        }
        if(val.statuses){
          for(const st of val.statuses){
            console.log(`📊 Status ${st.status} id:${st.id} to:${st.recipient_id}`);
          }
        }
      }
    }
  }catch(e){console.log('hook err',e.message, e.stack);}
}
app.post('/webhook',(req,res)=>{ res.sendStatus(200); handleWebhook(req.body); });
app.post('/webhook/:empresa_id',(req,res)=>{ res.sendStatus(200); handleWebhook(req.body); });

app.post('/api/empresa/registrar', async (req,res)=>{
  const {nombre,email,pass,plan}=req.body;
  if(!nombre||!email||!pass) return res.json({ok:false, error:'Faltan datos'});
  const empresa_id=`${S(email)}_${Date.now()}`;
  const codigo=genCode();
  const db={empresa_id, nombre, email, plan:(plan||'basico').toLowerCase(), plan_activo:false, codigo_activacion:codigo, creado:Date.now(), mantenimiento:0, config:{phone:'', waba:'', token:'', last_update:0, guardado_permanente:false}, cached_templates:[], usuarios:[{id:'admin', nombre:'Admin', email, pass, rol:'admin'}], chats:{}, reset_codes:[], calendar:[], campaigns:[]};
  saveDB(empresa_id,db);
  const html=`<div style="font-family:Arial;background:#0b1020;color:#fff;padding:28px;border-radius:14px"><h2>KLIDO</h2><div style="font-size:36px;letter-spacing:6px;background:#fff;color:#000;padding:14px;border-radius:10px;text-align:center;font-weight:800">${codigo}</div></div>`;
  const sent=await sendEmail(email, `KLIDO - Código ${codigo}`, html);
  res.json({ok:true, empresa_id, sent});
});
app.post('/api/empresa/activar',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if(String(db.codigo_activacion)!==String(req.body.codigo).trim()) return res.json({ok:false, error:'Código incorrecto'}); db.plan_activo=true; db.mantenimiento=Date.now() + (90*24*60*60*1000); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/login',(req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const u=db.usuarios.find(x=>x.email===req.body.email && x.pass===req.body.pass); if(u){ if(!db.plan_activo) return res.json({ok:false, bloqueado:true, empresa_id:db.empresa_id, msg:'Bloqueado por mora - contacta soporte 3133181851'}); return res.json({ok:true, user:u, empresa_id:db.empresa_id, plan:db.plan, nombre:db.nombre});}}catch{} } res.json({ok:false});});
app.post('/api/auth/forgot', async (req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const u=db.usuarios.find(x=>x.email===req.body.email); if(u){const code=genCode(); db.reset_codes=db.reset_codes||[]; db.reset_codes.push({code, email:req.body.email, ts:Date.now(), usado:false}); saveDB(db.empresa_id,db); const sent=await sendEmail(req.body.email, `KLIDO - Código ${code}`, `<div>Código: ${code}</div>`); return res.json({ok:true, sent});}}catch{}} res.json({ok:false});});
app.post('/api/auth/reset',(req,res)=>{for(const f of fs.readdirSync(DB)){try{const db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); const rc=(db.reset_codes||[]).find(c=>c.email===req.body.email && c.code===String(req.body.code).trim() &&!c.usado && Date.now()-c.ts < 900000); if(rc){const u=db.usuarios.find(x=>x.email===req.body.email); u.pass=req.body.newPass; rc.usado=true; saveDB(db.empresa_id,db); return res.json({ok:true});}}catch{}} res.json({ok:false});});

app.get('/api/config/:eid',(req,res)=>{
  const db=getDB(req.params.eid); if(!db) return res.json({ok:false});
  const role=req.query.role||'agente';
  const cfg=db.config||{phone:'',waba:'',token:''};
  if(role==='admin'){
    res.json({ok:true, config:cfg, is_admin:true, plan:db.plan, plan_info:PLANES[db.plan]||PLANES.basico, guardado_permanente:!!(cfg.phone && cfg.waba && cfg.token)});
  } else {
    res.json({ok:true, config:{phone:cfg.phone||'', waba:cfg.waba? cfg.waba.slice(0,6)+'...'+cfg.waba.slice(-4) : '', token: cfg.token? '•••••• guardado permanente (solo admin ve)' : '', has_token:!!cfg.token}, is_admin:false, cached_templates:db.cached_templates||[], plan:db.plan, plan_info:PLANES[db.plan]||PLANES.basico});
  }
});
app.post('/api/config/api',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  const phone=String(req.body.phone||'').trim();
  const waba=String(req.body.waba||'').trim();
  const token=String(req.body.token||'').trim();
  if(!phone ||!waba ||!token) return res.json({ok:false, error:'Faltan datos'});
  db.config=db.config||{};
  db.config.phone=phone; db.config.waba=waba; db.config.token=token;
  db.config.last_update=Date.now(); db.config.guardado_permanente=true; db.config_primer_guardado=db.config_primer_guardado||Date.now();
  saveDB(req.body.empresa_id,db);
  console.log(`✅ CONFIG PERMANENTE ${db.nombre} - phone:${phone} waba:${waba}`);
  (async()=>{try{const url=`https://graph.facebook.com/v20.0/${waba}/message_templates?limit=250&fields=name,status,language,components`; const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}}); const j=await r.json(); if(j.data){ db.cached_templates=j.data; db.config.last_templates_update=Date.now(); saveDB(req.body.empresa_id,db); }}catch{}})();
  res.json({ok:true, config:db.config, mensaje:'Guardado permanente'});
});

app.get('/api/empresas',(req,res)=>{try{res.json(fs.readdirSync(DB).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'))}catch{return null}}).filter(Boolean).map(e=>({empresa_id:e.empresa_id, nombre:e.nombre, email:e.email, plan:e.plan, activo:e.plan_activo, phone:e.config?.phone, chats:Object.keys(e.chats||{}).length})));}catch{res.json([]);}});
app.get('/api/empresa/info/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({ok:false}); res.json({ok:true, empresa_id:db.empresa_id, nombre:db.nombre, email:db.email, plan:db.plan, plan_activo:db.plan_activo, plan_info:PLANES[db.plan]||PLANES.basico, mantenimiento:db.mantenimiento||0, usuarios:db.usuarios, config:{phone:db.config?.phone||'', waba:db.config?.waba?db.config.waba.slice(0,6)+'...':'', has_token:!!db.config?.token}, chats_count:Object.keys(db.chats||{}).length});});
app.post('/api/empresa/plan/update',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  const nuevoPlan=(req.body.plan||'').toLowerCase();
  if(!['basico','premium','gold'].includes(nuevoPlan)) return res.json({ok:false, error:'Plan invalido'});
  db.plan=nuevoPlan; db.plan_activo=true; db.plan_actualizado=Date.now(); db.plan_actualizado_por=req.body.admin_email||'admin 3133181851';
  saveDB(req.body.empresa_id,db);
  res.json({ok:true, plan:nuevoPlan, plan_info:PLANES[nuevoPlan]});
});
app.get('/api/planes',(req,res)=>{res.json({ok:true, planes:PLANES});});

app.post('/api/equipo/add',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); const max=PLANES[db.plan]?.asesores||2; if(db.usuarios.length>=max && max!==999) return res.json({ok:false, error:`Plan ${db.plan} max ${max} usuarios`}); db.usuarios.push({id:'u'+Date.now(), nombre:req.body.email.split('@')[0], email:req.body.email, pass:req.body.pass, rol:req.body.rol||'agente'}); saveDB(req.body.empresa_id,db); res.json({ok:true});});
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
app.post('/api/calendar/agendar',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  const chat=db.chats?.[req.body.chat_id]; if(!chat) return res.json({ok:false});
  db.calendar=db.calendar||[]; chat.tags=chat.tags||[];
  if(req.body.estado_agenda==='pendiente' &&!chat.tags.includes('Pendiente')) chat.tags.push('Pendiente');
  if(req.body.estado_agenda==='agendado'){ const label=`Agendado ${req.body.fecha?new Date(req.body.fecha).toLocaleDateString():''}`; if(!chat.tags.some(t=>t.toLowerCase().includes('agendado'))) chat.tags.push(label); }
  db.calendar.push({
    id:Date.now().toString(), chat_id:req.body.chat_id, chat_nombre:chat.nombre||req.body.chat_id,
    estado_agenda:req.body.estado_agenda, date:req.body.fecha||new Date().toISOString(), nota:req.body.nota||'', hecho:false,
    empresa:chat.empresa||'', ciudad:chat.ciudad||'', profesion:chat.profesion||'', origen:chat.origen||'', campana:chat.campana||'', tags:chat.tags||[], email:chat.email||'', telefono:req.body.chat_id
  });
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});
app.post('/api/calendar/hecho',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  const c=(db.calendar||[]).find(x=>String(x.id)===String(req.body.id)); if(c){ c.hecho=!c.hecho; saveDB(req.body.empresa_id,db); }
  res.json({ok:true});
});
app.post('/api/calendar/delete',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  db.calendar=(db.calendar||[]).filter(x=>String(x.id)!==String(req.body.id)); saveDB(req.body.empresa_id,db); res.json({ok:true});
});

app.get('/api/chats/:eid/:uid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json([]); res.json(Object.values(db.chats||{}).map(c=>({id:c.id, nombre:c.nombre||c.id, tags:c.tags||['Nuevo'], no_leidos:c.no_leidos||0, last:c.last||0, mensajes:c.mensajes||[]})).sort((a,b)=>b.last-a.last));});
app.get('/api/mensajes/:eid/:cid',(req,res)=>{const db=getDB(req.params.eid); const c=db?.chats?.[req.params.cid]; if(!c) return res.json({mensajes:[], profile:{}}); res.json({mensajes:(c.mensajes||[]).sort((a,b)=>a.ts-b.ts), profile:{id:c.id, nombre:c.nombre, email:c.email||'', empresa:c.empresa||'', ciudad:c.ciudad||'', profesion:c.profesion||'', campana:c.campana||'', origen:c.origen||'', estado:c.estado||'nuevo', tags:c.tags||[], notas:c.notas||[]}});});
app.post('/api/chat/leido',(req,res)=>{const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false}); db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/profile',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.nombre=req.body.nombre||c.nombre; c.ciudad=req.body.ciudad||c.ciudad; c.profesion=req.body.profesion||c.profesion; c.email=req.body.email||c.email; c.empresa=req.body.empresa||c.empresa; c.estado=req.body.estado||c.estado; c.origen=req.body.origen||c.origen; c.campana=req.body.campana||c.campana; if(req.body.notas) c.notas=[{texto:req.body.notas, ts:Date.now()}]; saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/tag/add',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.tags=c.tags||[]; if(!c.tags.includes(req.body.tag)) c.tags.push(req.body.tag); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/chat/tag/remove',(req,res)=>{const db=getDB(req.body.empresa_id); const c=db?.chats?.[req.body.chat_id]; if(!c) return res.json({ok:false}); c.tags=(c.tags||[]).filter(x=>x!==req.body.tag); saveDB(req.body.empresa_id,db); res.json({ok:true});});
app.post('/api/mensaje/enviar',async(req,res)=>{const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false}); if(!db.config?.phone||!db.config?.token) return res.json({ok:false, error:'Configura API'}); try{const r=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`},body:JSON.stringify({messaging_product:'whatsapp', to:String(req.body.chat_id).replace(/\D/g,''), type:'text', text:{body:req.body.texto}})}); const j=await r.json(); if(j.error) return res.json({ok:false, error:j.error.message}); if(!db.chats[req.body.chat_id]) db.chats[req.body.chat_id]={id:req.body.chat_id, nombre:req.body.chat_id, mensajes:[], no_leidos:0, last:Date.now(), tags:['Nuevo'], estado:'nuevo'}; db.chats[req.body.chat_id].mensajes.push({from:'agente', texto:req.body.texto, type:'text', ts:Date.now()}); db.chats[req.body.chat_id].last=Date.now(); db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db); res.json({ok:true});}catch(e){res.json({ok:false, error:e.message});}});

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
    db.chats[chatId].mensajes.push({from:'agente', texto:file.originalname, type: file.mimetype.startsWith('image/')?'image': file.mimetype.startsWith('audio/')?'audio':'document', media_url:localUrl, mime:file.mimetype, filename:file.originalname, ts:Date.now()});
    db.chats[chatId].last=Date.now(); saveDB(req.body.empresa_id,db); res.json({ok:true, url:localUrl});
  }catch(e){res.json({ok:false, error:e.message});}
});

app.get('/api/templates/:eid', async (req,res)=>{
  const db=getDB(req.params.eid);
  if(!db) return res.json({templates:[], error:'Empresa no existe'});
  const waba=String(db.config?.waba||'').trim();
  const token=String(db.config?.token||'').trim();
  if(!waba||!token){
    return res.json({templates:db.cached_templates||[], error:`Falta config`, cached_count:(db.cached_templates||[]).length});
  }
  try{
    const url=`https://graph.facebook.com/v20.0/${waba}/message_templates?limit=250&fields=name,status,language,components`;
    const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    const j=await r.json();
    if(j.error){
      return res.json({templates: db.cached_templates||[], error:`Meta ${j.error.code}: ${j.error.message}`, cached_count:(db.cached_templates||[]).length});
    }
    const all=j.data||[]; const approved=all.filter(t=>t.status==='APPROVED');
    if(all.length>0){ db.cached_templates=all; db.config.last_templates_update=Date.now(); saveDB(db.empresa_id, db); }
    let warning=`✅ ${approved.length} APPROVED de ${all.length}`;
    return res.json({templates: approved.length>0? approved : all, all: all.length, approved: approved.length, warning});
  }catch(e){ return res.json({templates:db.cached_templates||[], error:e.message, using_cache:true}); }
});

app.get('/api/campaigns/:eid',(req,res)=>{const db=getDB(req.params.eid); if(!db) return res.json({campaigns:[]});
  const list = Array.isArray(db.campaigns)? db.campaigns : Object.values(db.campaigns||{});
  res.json({campaigns:list.sort((a,b)=>b.creado-a.creado)});});

app.post('/api/campaigns/create',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  const planInfo=PLANES[db.plan]||PLANES.basico;
  if(req.body.tipo==='gmail' &&!planInfo.gmail) return res.json({ok:false, error:`⛔ Gmail solo Gold`});
  if(!Array.isArray(db.campaigns)) db.campaigns = db.campaigns? Object.values(db.campaigns) : [];
  const existing=db.campaigns.length;
  if(existing>=planInfo.envios && planInfo.envios!==999) return res.json({ok:false, error:`⛔ Plan ${db.plan} max ${planInfo.envios} campañas`});
  let cleanVars = (req.body.variables||[]).map(v=> String(v||'').trim()).filter(v=> v!=='' );
  const camp={id:Date.now().toString(), nombre:req.body.nombre, tipo:req.body.tipo||'whatsapp', numeros:req.body.numeros||[], total:(req.body.numeros||[]).length, template_name:req.body.template_name||'', template_lang:req.body.template_lang||'es', variables:cleanVars, header_image:req.body.header_image||'', gmail_subject:req.body.gmail_subject||'', gmail_body:req.body.gmail_body||'', status:'running', enviados:0, fallidos:0, indice:0, next_send:0, creado:Date.now()};
  db.campaigns.push(camp); saveDB(req.body.empresa_id,db); res.json({ok:true, camp});
});

app.post('/api/campaigns/toggle',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  if(!Array.isArray(db.campaigns)) db.campaigns = Object.values(db.campaigns||{});
  const c=db.campaigns.find(x=>String(x.id)===String(req.body.id));
  if(c){ c.status=c.status==='paused'?'running':'paused'; if(c.status==='running' && c.next_send && Date.now()>c.next_send) c.next_send=0; saveDB(req.body.empresa_id,db); }
  res.json({ok:true});
});

app.post('/api/campaigns/delete',(req,res)=>{
  const db=getDB(req.body.empresa_id); if(!db) return res.json({ok:false});
  if(!Array.isArray(db.campaigns)) db.campaigns = Object.values(db.campaigns||{});
  db.campaigns=db.campaigns.filter(x=>String(x.id)!==String(req.body.id));
  saveDB(req.body.empresa_id,db); res.json({ok:true});
});

// ===== V256 - SI APROBADA SE ENVIA - AUTO IMAGEN - 0/1 VAR + CON/SIN IMAGEN =====
async function processCampaigns(){
  try{
    for(const f of fs.readdirSync(DB)){
      let db; try{ db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); }catch{continue;}
      if(!db.campaigns) continue;
      const campaignsList = Array.isArray(db.campaigns)? db.campaigns : Object.values(db.campaigns||{});
      if(campaignsList.length===0) continue;
      let changed=false;
      if(!Array.isArray(db.campaigns)){
        db.campaigns = campaignsList;
        changed=true;
      }
      for(const camp of db.campaigns){
        if(camp.status!=='running') continue;
        if(camp.indice>=camp.total){ camp.status='completed'; changed=true; continue; }
        if(camp.next_send && Date.now() < camp.next_send) continue;
        const batch=camp.numeros.slice(camp.indice, camp.indice+50);
        if(camp.tipo==='whatsapp'){
          if(!db.config?.phone||!db.config?.token){ camp.status='paused'; changed=true; continue; }
          for(const num of batch){
            try{
              let tpl=null, expectedVars=0, tplLang=camp.template_lang||'es', hasImageHeader=false;
              try{
                tpl=(db.cached_templates||[]).find(t=> t.name===camp.template_name);
                if(tpl){
                  tplLang=tpl.language||tplLang;
                  const body=(tpl.components||[]).find(c=> c.type==='BODY');
                  if(body?.text){ const m=body.text.match(/{{\d+}}/g); expectedVars=m?m.length:0; }
                  const header=(tpl.components||[]).find(c=> c.type==='HEADER');
                  if(header && header.format==='IMAGE') hasImageHeader=true;
                }
              }catch{}

              let payload={
                messaging_product:'whatsapp',
                to:String(num).replace(/\D/g,''),
                type:'template',
                template:{name:camp.template_name, language:{code:tplLang}, components:[]}
              };

              let hImg=String(camp.header_image||'').trim();
              // V256 AUTO - SI TIENE IMAGEN Y NO PUSISTE URL, USA DEFAULT PARA NO FALLAR 132012
              if(hasImageHeader){
                if(!hImg.startsWith('https://')){
                  hImg = DEFAULT_ACOL_IMAGE; // SIEMPRE MANDA ALGO, NO DEJA VACIO
                  console.log(`🔁 AUTO IMAGEN para ${camp.template_name}: ${hImg}`);
                }
                payload.template.components.push({type:'header', parameters:[{type:'image', image:{link:hImg}}]});
              }

              if(expectedVars>0){
                let vars=(camp.variables||[]).map(v=> String(v||'').trim()).filter(v=> v!=='');
                vars=vars.slice(0,expectedVars);
                while(vars.length<expectedVars) vars.push('Hola');
                payload.template.components.push({type:'body', parameters: vars.map(v=>({type:'text', text:v}))});
              }

              if(payload.template.components.length===0) delete payload.template.components;

              console.log(`📤 ${camp.template_name} -> ${num} | ${expectedVars} vars ${hasImageHeader?'+IMG AUTO':''} | vars:${JSON.stringify(camp.variables)}`);

              const rr=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`}, body:JSON.stringify(payload)});
              const jj=await rr.json();
              if(jj.messages){ camp.enviados++; console.log(`✅ Enviado ${camp.nombre} a ${num} - SI APROBADA SE ENVIA`); }
              else { camp.fallidos++; console.log(`❌ Fallo ${camp.nombre} a ${num}:`, jj.error?.message, JSON.stringify(jj).slice(0,500)); }
            }catch(e){ camp.fallidos++; console.log('send err', e.message); }
            await new Promise(r=>setTimeout(r, 900));
          }
        }
        camp.indice+=batch.length; camp.next_send=Date.now() + (4*60*60*1000); changed=true;
        console.log(`📦 Lote ${camp.nombre}: ${camp.enviados}/${camp.total}`);
      }
      if(changed) saveDB(db.empresa_id,db);
    }
  }catch(e){ console.log('worker',e.message, e.stack); }
}
setInterval(processCampaigns, 60000); processCampaigns();

async function syncPlantillasTodas(){
  try{
    for(const f of fs.readdirSync(DB)){
      let db; try{ db=JSON.parse(fs.readFileSync(path.join(DB,f),'utf8')); }catch{continue;}
      const waba=db.config?.waba, token=db.config?.token;
      if(!waba||!token) continue;
      try{
        const url=`https://graph.facebook.com/v20.0/${waba}/message_templates?limit=250&fields=name,status,language,components`;
        const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
        const j=await r.json();
        if(j.data){ db.cached_templates=j.data; db.config.last_templates_update=Date.now(); saveDB(db.empresa_id,db); }
      }catch{}
      await new Promise(r=>setTimeout(r, 800));
    }
    console.log('🔄 Auto-sync plantillas terminado');
  }catch(e){}
}
setInterval(syncPlantillasTodas, 3*60*60*1000);
setTimeout(syncPlantillasTodas, 15000);

function getAllEmpresas(){
  try{return fs.readdirSync(DB).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(DB,f),'utf8'))}catch{return null}}).filter(Boolean);}catch{return [];}
}
app.get('/api/admin/agencias',(req,res)=>{
  const all=getAllEmpresas();
  const agencias=all.map(e=>{
    const chats=Object.keys(e.chats||{}).length;
    const mensajes=Object.values(e.chats||{}).reduce((a,c)=>a+(c.mensajes?.length||0),0);
    const workers=(e.usuarios||[]).length;
    const campaignsList = Array.isArray(e.campaigns)? e.campaigns : Object.values(e.campaigns||{});
    const campaigns=campaignsList.length;
    const planInfo=PLANES[e.plan]||PLANES.basico;
    return {id:e.empresa_id, nombre:e.nombre, email:e.email, plan:e.plan, plan_activo:e.plan_activo, mantenimiento:e.mantenimiento||0, chats, mensajes, workers, campaigns, mensajesLimite:planInfo.mensajes, enviosLimite:planInfo.envios, plan_info:planInfo, creado:e.creado, phone:e.config?.phone||'', waba:e.config?.waba||'', has_token:!!e.config?.token};
  }).sort((a,b)=>b.creado-a.creado);
  res.json({ok:true, agencias, total:agencias.length});
});
app.post('/api/admin/agencias/:id/activar',(req,res)=>{
  const db=getDB(req.params.id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  const plan=(req.body.plan||db.plan||'basico').toLowerCase(); const dias=Number(req.body.dias||90);
  if(!['basico','premium','gold'].includes(plan)) return res.json({ok:false, error:'Plan invalido'});
  db.plan=plan; db.plan_activo=true; db.mantenimiento=Date.now() + (dias*24*60*60*1000); db.plan_vence=db.mantenimiento; saveDB(req.params.id, db);
  res.json({ok:true, mensaje:`✅ ${db.nombre} activado a ${plan.toUpperCase()} por ${dias} días`, plan, vence:db.mantenimiento});
});
app.post('/api/admin/agencias/:id/bloquear',(req,res)=>{const db=getDB(req.params.id); if(!db) return res.json({ok:false}); db.plan_activo=false; saveDB(req.params.id, db); res.json({ok:true});});
app.post('/api/admin/agencias/:id/desbloquear',(req,res)=>{const db=getDB(req.params.id); if(!db) return res.json({ok:false}); db.plan_activo=true; saveDB(req.params.id, db); res.json({ok:true});});
app.get('/api/admin/agencias/:id/detalle',(req,res)=>{
  const db=getDB(req.params.id); if(!db) return res.json({ok:false});
  const chats=Object.values(db.chats||{}); const cals=db.calendar||[];
  const metrics={total_chats:chats.length, total_mensajes:chats.reduce((a,c)=>a+(c.mensajes?.length||0),0), no_leidos:chats.reduce((a,c)=>a+(c.no_leidos||0),0), clientes:chats.filter(x=>x.estado==='cliente').length, interesados:chats.filter(x=>x.estado==='interesado').length, nuevo:chats.filter(x=>!x.estado||x.estado==='nuevo').length, calendar:cals.length, calendar_pendientes:cals.filter(x=>!x.hecho).length};
  res.json({ok:true, empresa_id:db.empresa_id, nombre:db.nombre, email:db.email, metrics, usuarios:db.usuarios, campaigns:db.campaigns, calendar:cals});
});
app.get('/api/public/:eid',(req,res)=>{
  const db=getDB(req.params.eid); if(!db) return res.json({ok:false});
  const chats=Object.values(db.chats||{});
  res.json({ok:true, empresa:db.nombre, plan:db.plan, plan_activo:db.plan_activo, vence:db.mantenimiento? new Date(Number(db.mantenimiento)).toLocaleDateString() : '-', stats:{chats:chats.length, mensajes:chats.reduce((a,c)=>a+(c.mensajes?.length||0),0), no_leidos:chats.reduce((a,c)=>a+(c.no_leidos||0),0), trabajadores:(db.usuarios||[]).length, campanas:(Array.isArray(db.campaigns)?db.campaigns:Object.values(db.campaigns||{})).length, citas:(db.calendar||[]).length}, updated:Date.now()});
});

app.get('/',(req,res)=>res.sendFile(path.join(PUB,'index.html')));
app.get('/crm',(req,res)=>res.sendFile(path.join(PUB,'crm.html')));
app.get('/crm.html',(req,res)=>res.sendFile(path.join(PUB,'crm.html')));
app.get('/admin',(req,res)=>res.sendFile(path.join(PUB,'admin.html')));
app.get('/admin.html',(req,res)=>res.sendFile(path.join(PUB,'admin.html')));

const PORT=process.env.PORT||8080;
app.listen(PORT,'0.0.0.0',()=>console.log(`V256 AUTO IMAGEN - SI APROBADA SE ENVIA OK en 0.0.0.0:${PORT} - WEBHOOK klido123 FULL`));
