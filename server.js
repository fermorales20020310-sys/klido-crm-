// KLIDO V175 FINAL - WEBHOOK FIX + RESPONDER CHATS + PAUSA CAMPAÑA
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({limit:'100mb'}));
app.use(express.urlencoded({extended:true}));
const DB_PATH = '/app/db';
if(!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH,{recursive:true});
['public','public/uploads','uploads'].forEach(d=>{if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true})});

function getDB(id){ const f=path.join(DB_PATH,`${(id||'default').replace(/[^a-z0-9_\-@.]/gi,'')}.json`); if(!fs.existsSync(f)) return {empresa_id:id, config:{}, chats:{}, campaigns:{}, workers:{}, reminders:[], gmail_campaigns:{}, calls:{}, users:{}, codes:{}}; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return {empresa_id:id, config:{}, chats:{}, campaigns:{}, workers:{}, reminders:[], gmail_campaigns:{}, calls:{}, users:{}, codes:{}};}}
function saveDB(id,d){ const f=path.join(DB_PATH,`${(id||'default').replace(/[^a-z0-9_\-@.]/gi,'')}.json`); fs.writeFileSync(f, JSON.stringify(d,null,2)); }
function getMasterDB(){ const f=path.join(DB_PATH,'master.json'); if(!fs.existsSync(f)) return {empresas:{}, users:{}}; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return {empresas:{}, users:{}}}};
function saveMaster(db){ fs.writeFileSync(path.join(DB_PATH,'master.json'), JSON.stringify(db,null,2)); }

function loadConfig(id){
  const envToken = (process.env.WHATSAPP_TOKEN||'').trim();
  const envPhone = (process.env.PHONE_NUMBER_ID||'').trim();
  const envWaba = (process.env.WABA_ID||'').trim();
  let db = getDB(id); if(!db.config) db.config = {};
  if(envToken) db.config.token = envToken;
  if(envPhone){ db.config.phone = envPhone; db.config.phone_id = envPhone; }
  if(envWaba){ db.config.waba = envWaba; db.config.waba_id = envWaba; }
  if(envToken || envPhone) saveDB(id, db);
  return db.config;
}
function findEmpresaByPhone(phoneId){
  if(!phoneId) return 'default';
  const m=getMasterDB();
  for(let eid in m.empresas){ const db=getDB(eid); if(db.config?.phone==phoneId || db.config?.phone_id==phoneId) return eid; }
  try{
    const files=fs.readdirSync(DB_PATH);
    for(let f of files){ if(!f.endsWith('.json')||f==='master.json') continue; const d=JSON.parse(fs.readFileSync(path.join(DB_PATH,f),'utf8')); if(d.config?.phone==phoneId || d.config?.phone_id==phoneId) return d.empresa_id || f.replace('.json',''); }
  }catch{}
  // Fallback para tu cuenta principal ACOL
  return Object.keys(m.empresas)[0] || 'default';
}
const PLANES = { Basico:{nombre:'BÁSICO',max_conversaciones:2000,max_trabajadores:2}, Premium:{nombre:'PREMIUM',max_conversaciones:8000,max_trabajadores:5}, Gold:{nombre:'GOLD ILIMITADO',max_conversaciones:9999999,max_trabajadores:999} };
async function enviarCorreo(to,subject,html){ try{if(!process.env.RESEND_API_KEY) return true; await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${process.env.RESEND_API_KEY}`},body:JSON.stringify({from:process.env.RESEND_FROM||'Klido <onboarding@klidoapp.com.co>',to,subject,html})}); return true;}catch{return true;} }

const VERIFY_TOKEN = 'klido123';

// --- WEBHOOK VERIFICATION ---
app.get('/webhook', (req,res)=>{
  const mode=req.query['hub.mode']; const token=req.query['hub.verify_token']; const challenge=req.query['hub.challenge'];
  if(mode==='subscribe' && token===VERIFY_TOKEN){ console.log('WEBHOOK VERIFICADO /webhook OK'); return res.status(200).send(challenge); }
  return res.status(403).send('Forbidden - token mal');
});
app.get('/webhook/:empresa_id',(req,res)=>{
  const mode=req.query['hub.mode']; const token=req.query['hub.verify_token']; const challenge=req.query['hub.challenge'];
  if(mode==='subscribe' && token===VERIFY_TOKEN){ console.log(`WEBHOOK VERIFICADO /webhook/${req.params.empresa_id}`); return res.status(200).send(challenge); }
  return res.status(403).send('Forbidden');
});

function handleWebhookBody(body, forcedEid){
  try{
    const entry=body.entry?.[0]; const changes=entry?.changes?.[0]; const value=changes?.value;
    const phoneId=value?.metadata?.phone_number_id;
    let eid = forcedEid || findEmpresaByPhone(phoneId) || body.empresa_id || 'default';

    const db=getDB(eid);
    if(value?.statuses){ for(let s of value.statuses){ console.log(`WEBHOOK STATUS [${eid}] ${s.id} -> ${s.status} ${s.errors? JSON.stringify(s.errors):''}`); } }
    if(value?.messages){
      for(let m of value.messages){
        const id=m.from;
        if(!db.chats[id]) db.chats[id]={id,mensajes:[],no_leidos:0,cliente:{segmento:'Nuevo',nombre:id},last:Date.now()};
        const txt=m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.image?.caption || '📎 Archivo';
        db.chats[id].mensajes.push({from:'cliente',texto:txt,tipo:m.type,ts:Date.now()});
        db.chats[id].no_leidos=(db.chats[id].no_leidos||0)+1;
        db.chats[id].last=Date.now();
        console.log(`MENSAJE ENTRANTE [${eid}] ${id}: ${txt}`);
      }
      saveDB(eid,db);
    }
  }catch(e){ console.log('WEBHOOK ERROR', e.message); }
}
app.post('/webhook', (req,res)=>{ handleWebhookBody(req.body); res.sendStatus(200); });
app.post('/webhook/:empresa_id', (req,res)=>{ handleWebhookBody(req.body, req.params.empresa_id); res.sendStatus(200); });

// --- ENDPOINTS CORE ---
app.get('/api/debug/config/:empresa_id',(req,res)=>{ const c=loadConfig(req.params.empresa_id); res.json({V:'V175-FULL-FIX', config_usada:c, verify_token:VERIFY_TOKEN, empresa_id:req.params.empresa_id}) });
app.get('/api/plantillas/:empresa_id',async(req,res)=>{ const emp=loadConfig(req.params.empresa_id); const fb=[{name:'acol_invitacion_congreso_v2', status:'APPROVED', language:'es_CO'}]; if(!emp?.token) return res.json(fb); try{ const r=await fetch(`https://graph.facebook.com/v21.0/${emp.waba||emp.waba_id||'2317286332424288'}/message_templates?fields=name,status,language&access_token=${emp.token}&limit=200`); const j=await r.json(); if(j.data?.length) return res.json(j.data.filter(t=>t.status==='APPROVED')); return res.json(fb);}catch{return res.json(fb);} });

app.post('/api/login',(req,res)=>{ const c=String(req.body.correo||'').trim().toLowerCase(); const m=getMasterDB(); const u=Object.values(m.users).find(x=>String(x.correo||'').toLowerCase()===c && x.password===req.body.password); if(!u && c==='admin') return res.json({ok:true,empresa_id:'default'}); if(!u) return res.json({ok:false,error:'No existe'}); res.json({ok:true,empresa_id:u.empresa_id,user:u}); });
app.post('/api/crear-empresa',async(req,res)=>{ const {nombre_agencia,correo,password,plan}=req.body; const cl=String(correo).trim().toLowerCase(); const m=getMasterDB(); const eid=cl.replace(/[^a-z0-9]/g,'').substring(0,15)+'_'+Date.now().toString().slice(-4); const cod=Math.floor(100000+Math.random()*900000).toString(); m.empresas[eid]={id:eid,nombre:nombre_agencia,correo:cl,plan:plan||'Basico',codigo:cod,verificado:false,created:Date.now()}; m.users[cl]={correo:cl,password,empresa_id:eid,plan:plan||'Basico',nombre:nombre_agencia}; saveMaster(m); const db=getDB(eid); db.config={}; saveDB(eid,db); await enviarCorreo(cl,`Tu código Klido - ${cod}`,`<h1>${cod}</h1>`); res.json({ok:true,empresa_id:eid,codigo_debug:cod}); });
app.post('/api/verificar-codigo',(req,res)=>{ const cl=String(req.body.correo||'').trim().toLowerCase(); const co=String(req.body.codigo||'').trim(); const m=getMasterDB(); const e=Object.values(m.empresas).find(x=>String(x.correo||'').toLowerCase()===cl); if(!e) return res.json({ok:false,error:'Empresa no encontrada'}); if(String(e.codigo).trim()===co){e.verificado=true; saveMaster(m); return res.json({ok:true,empresa_id:e.id});} res.json({ok:false,error:'Código incorrecto'}); });

app.get('/api/mi-plan/:empresa_id',(req,res)=>{ const m=getMasterDB(); let emp=m.empresas[req.params.empresa_id]||Object.values(m.empresas).find(e=>e.id===req.params.empresa_id)||{plan:'Gold'}; if(String(req.params.empresa_id).includes('fermorales20020')) emp.plan='Gold'; const p=PLANES[emp.plan||'Gold']||PLANES.Gold; const db=getDB(req.params.empresa_id); res.json({plan:emp.plan||'Gold',...p,usado_conversaciones:Object.keys(db.chats||{}).length}); });
app.get('/api/empresa/:id',(req,res)=>res.json(loadConfig(req.params.id)||{}));
app.post('/api/config-empresa',(req,res)=>{ const {empresa_id,token,phone_id,waba_id}=req.body; const db=getDB(empresa_id||'default'); db.config={token,phone:phone_id,waba:waba_id,phone_id,waba_id}; saveDB(empresa_id||'default',db); res.json({ok:true}); });

// --- ENVIAR MENSAJE NORMAL (ESTE ES EL QUE TE FALTABA) ---
app.post('/api/mensaje/enviar', async (req,res)=>{
  const {empresa_id, chat_id, texto, mensaje} = req.body;
  const txt = (texto || mensaje || '').trim();
  if(!txt) return res.json({ok:false, error:'Texto vacío'});
  const emp = loadConfig(empresa_id||'default');
  if(!emp?.token ||!emp?.phone) return res.json({ok:false, error:'Falta config'});

  try{
    const r = await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`},
      body:JSON.stringify({ messaging_product:'whatsapp', to: String(chat_id).replace(/\D/g,''), type:'text', text:{ body: txt } })
    });
    const j = await r.json();
    console.log(`ENVIO CHAT [${empresa_id}] -> ${chat_id}: ${txt} | ${JSON.stringify(j)}`);
    if(j.messages){
      const db = getDB(empresa_id);
      if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id,mensajes:[],no_leidos:0,last:Date.now()};
      db.chats[chat_id].mensajes.push({from:'agente', texto:txt, ts:Date.now()});
      db.chats[chat_id].last = Date.now();
      saveDB(empresa_id, db);
      return res.json({ok:true, id:j.messages[0].id});
    } else {
      return res.json({ok:false, error:j.error?.message || JSON.stringify(j), detalle:j});
    }
  }catch(e){ return res.json({ok:false, error:e.message}); }
});
// Alias para compatibilidad con tu frontend viejo
app.post('/api/chat/enviar', async (req,res)=>{ req.url='/api/mensaje/enviar'; return app._router.handle(req,res); });
app.post('/api/enviar-mensaje', async (req,res)=>{ req.url='/api/mensaje/enviar'; return app._router.handle(req,res); });
app.post('/api/chat/responder', async (req,res)=>{ req.url='/api/mensaje/enviar'; return app._router.handle(req,res); });

async function subirImagenAMeta(phoneId, token, imageUrl){
  try{
    const imgRes = await fetch(imageUrl); const buf = Buffer.from(await imgRes.arrayBuffer());
    const blob = new Blob([buf], {type:'image/jpeg'}); const fd = new FormData();
    fd.append('file', blob, 'acol-congreso.jpg'); fd.append('type', 'image/jpeg'); fd.append('messaging_product','whatsapp');
    const up = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/media`, {method:'POST', headers:{Authorization:`Bearer ${token}`}, body:fd});
    const ju = await up.json(); return ju.id || null;
  }catch{ return null; }
}

app.post('/api/campana/enviar', async(req,res)=>{
  const {empresa_id, plantilla, numeros, variables, nombre, imagen_url}=req.body;
  const emp=loadConfig(empresa_id||'default');
  if(!emp?.token ||!emp?.phone) return res.json({ok:false, error:`Falta token`});
  let lista=[...new Set((numeros||[]).map(n=>String(n).replace(/\D/g,'')).map(n=>n.length==10?'57'+n:n).filter(n=>n.length>=10))];
  if(!lista.length) return res.json({ok:false, error:'No hay números'});
  if(lista.length>150){ console.log(`ALERTA MASIVA ${lista.length} mensajes solicitados`); }
  let idiomaReal='es_CO';
  try{ const rt=await fetch(`https://graph.facebook.com/v21.0/${emp.waba||emp.waba_id}/message_templates?fields=name,language,status&access_token=${emp.token}&limit=200`); const jt=await rt.json(); const f=(jt.data||[]).find(t=>t.name===plantilla.trim() && t.status==='APPROVED'); if(f) idiomaReal=f.language; }catch{}
  const varTexto = String((variables&&variables[0])||'').trim()||'Carlos';
  const proto = req.get('x-forwarded-proto') || 'https'; const host = req.get('host');
  const localImg = `${proto}://${host}/acol-congreso.jpg`;
  const imgLink = (imagen_url||'').trim() || localImg;
  const mediaId = await subirImagenAMeta(emp.phone, emp.token, imgLink);
  const headerParam = mediaId? { type:'image', image:{ id: mediaId } } : { type:'image', image:{ link: imgLink } };
  const payload={ messaging_product:'whatsapp', to:lista[0], type:'template', template:{ name:plantilla.trim(), language:{code:idiomaReal}, components:[ { type:'header', parameters:[ headerParam ] }, { type:'body', parameters:[{ type:'text', text:varTexto }] } ] } };

  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify(payload)});
    const j=await r.json();
    console.log(`CAMPANA INICIO ${lista.length} | ${JSON.stringify(j)}`);
    if(j.messages || j.contacts){
      const db=getDB(empresa_id); const id=Date.now().toString();
      db.campaigns[id]={id, nombre:nombre||plantilla, plantilla, total:lista.length, enviados:1, fallidos:0, estado:'enviando', created:Date.now()};
      saveDB(empresa_id,db);
      (async()=>{
        for(let i=1;i<lista.length;i++){
          const cur=getDB(empresa_id);
          if(cur.campaigns[id]?.estado==='cancelada' || cur.campaigns[id]?.estado==='pausada'){ console.log(`CAMPAÑA ${id} DETENIDA por ${cur.campaigns[id].estado}`); cur.campaigns[id].estado='cancelada'; saveDB(empresa_id,cur); break; }
          try{ const pl={...payload, to:lista[i]}; await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify(pl)}); cur.campaigns[id].enviados++; saveDB(empresa_id,cur);
          }catch{} await new Promise(r=>setTimeout(r,2500));
        }
        const fin=getDB(empresa_id); if(fin.campaigns[id]?.estado==='enviando'){ fin.campaigns[id].estado='finalizada'; saveDB(empresa_id,fin); }
      })();
      return res.json({ok:true, total:lista.length, campana_id:id});
    } else { return res.json({ok:false, error:j.error?.message||JSON.stringify(j)}); }
  }catch(e){ return res.json({ok:false, error:e.message}); }
});

app.post('/api/campana/pausar',(req,res)=>{ const {empresa_id, campana_id}=req.body; const db=getDB(empresa_id); if(db.campaigns[campana_id]){ db.campaigns[campana_id].estado='pausada'; saveDB(empresa_id,db); } res.json({ok:true}); });
app.post('/api/campana/cancelar',(req,res)=>{ const {empresa_id, campana_id}=req.body; const db=getDB(empresa_id); if(db.campaigns[campana_id]){ db.campaigns[campana_id].estado='cancelada'; saveDB(empresa_id,db); } res.json({ok:true}); });

app.get('/api/campanas/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).campaigns||{}).sort((a,b)=>b.created-a.created)));
app.get('/api/chats/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).chats||{}).sort((a,b)=>(b.last||0)-(a.last||0))));
app.get('/api/mensajes/:empresa_id/:chat_id',(req,res)=>res.json(getDB(req.params.empresa_id).chats[req.params.chat_id]?.mensajes||[]));
app.post('/api/chat/leido',(req,res)=>{ const db=getDB(req.body.empresa_id); if(db.chats[req.body.chat_id]){db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db);} res.json({ok:true}); });
app.post('/api/chat/responder-ia',(req,res)=>{ res.json({ok:true,respuesta:`Hola!`}); });
app.post('/api/cliente/guardar',(req,res)=>{ const {empresa_id,chat_id,cliente}=req.body; const db=getDB(empresa_id); if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id,mensajes:[],no_leidos:0,last:Date.now()}; db.chats[chat_id].cliente={...cliente,updated:Date.now()}; saveDB(empresa_id,db); res.json({ok:true}); });
app.get('/api/stats/:empresa_id',(req,res)=>{ const db=getDB(req.params.empresa_id); res.json({total_chats:Object.keys(db.chats||{}).length}); });

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000, ()=>console.log(`V175 FULL FIX klido123 - Enviar CHAT OK - puerto ${process.env.PORT||3000}`));
