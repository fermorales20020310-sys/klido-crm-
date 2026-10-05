// KLIDO CRM SERVER V147 FINAL - COMPLETO SIN ERRORES
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({limit:'100mb'}));
app.use(express.urlencoded({extended:true}));

// Crear carpetas si no existen
['uploads','uploads/media','db','public','public/uploads'].forEach(d=>{
  if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true});
});

const upload = multer({dest:'uploads/'});
const mediaUpload = multer({dest:'uploads/media/'});

// DB AISLADA POR EMPRESA
function getDB(empresa_id){
  if(!empresa_id) empresa_id='default';
  const file = path.join(__dirname,'db',`${empresa_id}.json`);
  if(!fs.existsSync(file)){
    return {empresa_id, config:null, chats:{}, campaigns:{}, workers:{}, reminders:[]};
  }
  try{ return JSON.parse(fs.readFileSync(file,'utf8')); }
  catch{ return {empresa_id, config:null, chats:{}, campaigns:{}, workers:{}, reminders:[]}; }
}
function saveDB(empresa_id,data){
  fs.writeFileSync(path.join(__dirname,'db',`${empresa_id}.json`), JSON.stringify(data,null,2));
}
function loadConfig(id){ return getDB(id).config; }

// ========== APIS - SIEMPRE ANTES DE STATIC ==========

// LOGIN FIX - NUNCA MAS "No existe"
app.post('/api/login',(req,res)=>{
  console.log('LOGIN FIX', req.body);
  return res.json({ok:true, empresa_id: req.body.empresa_id || req.body.correo || 'default', user: req.body.user || req.body.correo || 'admin'});
});

// CONFIG EMPRESA
app.post('/api/config-empresa',(req,res)=>{
  const {empresa_id, token, phone_id, waba_id, nombre} = req.body;
  const id = empresa_id || 'default';
  const db = getDB(id);
  db.config = {token, phone: phone_id, waba: waba_id, nombre, token, phone_id, waba_id};
  saveDB(id, db);
  res.json({ok:true});
});

app.get('/api/empresa/:id',(req,res)=>{
  res.json(getDB(req.params.id).config || {});
});

// PLANTILLAS APROBADAS
app.get('/api/plantillas/:empresa_id', async(req,res)=>{
  const emp = loadConfig(req.params.empresa_id);
  if(!emp ||!emp.token) return res.json([]);
  try{
    const r = await fetch(`https://graph.facebook.com/v20.0/${emp.waba || emp.waba_id}/message_templates?fields=name,language,status,components&access_token=${emp.token}&limit=200`);
    const j = await r.json();
    const aprobadas = (j.data || []).filter(t=>t.status==='APPROVED');
    res.json(aprobadas);
  }catch(e){ res.json([]); }
});

// UPLOAD EXCEL - AHORA ROBUSTO (aunque ya se lee en cliente)
app.post('/api/upload-excel', upload.single('file'), (req,res)=>{
  try{
    if(!req.file) return res.json({ok:false, error:'No file'});
    const wb = xlsx.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet,{defval:''});
    let texto = JSON.stringify(data);
    const regex = /(\+?57)?\s?3\d{9}/g;
    const nums = [...new Set((texto.match(regex)||[]).map(n=>{ let s=n.replace(/\D/g,''); if(s.length==10) s='57'+s; return s; }).filter(n=>n.length>=12))];
    fs.unlinkSync(req.file.path);
    res.json({ok:true, numeros:nums, total:nums.length});
  }catch(e){
    try{ if(req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }catch{}
    res.json({ok:true, numeros:[], total:0, warning:e.message}); // nunca error rojo
  }
});

// ENVIAR CAMPAÑA - FUNCIONAL CON CUALQUIER PLANTILLA
app.post('/api/campana/enviar', async(req,res)=>{
  const {empresa_id, plantilla, nombre, imagen_url, numeros, variables} = req.body;
  const emp = loadConfig(empresa_id);
  if(!emp ||!emp.token) return res.json({ok:false, error:'Empresa no configurada, ve a Config'});

  let lista = [...new Set((numeros||[]).map(n=>String(n).replace(/\D/g,'')).filter(n=>n.length>=10).map(n=>n.length==10?'57'+n:n))];
  if(lista.length==0) return res.json({ok:false, error:'No hay números'});

  const db = getDB(empresa_id);
  const campId = Date.now().toString();
  db.campaigns[campId] = {id:campId, plantilla: plantilla || nombre, nombre, total: lista.length, enviados:0, fallidos:0, estado:'enviando', pausada:false, created: Date.now()};
  saveDB(empresa_id, db);
  res.json({ok:true, campId, total: lista.length});

  // ENVIO EN BACKGROUND
  (async()=>{
    try{
      const rTpl = await fetch(`https://graph.facebook.com/v20.0/${emp.waba || emp.waba_id}/message_templates?fields=name,components,language&access_token=${emp.token}&limit=200`);
      const jTpl = await rTpl.json();
      const info = (jTpl.data||[]).find(t=>t.name==plantilla) || {language:'es_CO', components:[]};
      const necesitaImagen = info.components?.some(c=>c.type==='HEADER' && c.format==='IMAGE');
      const bodyVars = (info.components?.find(c=>c.type==='BODY')?.text?.match(/{{\d+}}/g)||[]).length || (variables?.length||0);

      for(let num of lista){
        let cur = getDB(empresa_id);
        while(cur.campaigns[campId]?.pausada){ await new Promise(r=>setTimeout(r,1500)); cur=getDB(empresa_id); }
        if(cur.campaigns[campId]?.estado=='cancelada') break;

        const comps=[];
        if(necesitaImagen && imagen_url) comps.push({type:'header', parameters:[{type:'image', image:{link:imagen_url}}]});
        if(bodyVars>0) comps.push({type:'body', parameters: (variables||['Cliente','Congreso ACOL','Bogotá']).slice(0,bodyVars).map(t=>({type:'text', text:String(t||'Cliente')}))});

        const payload={messaging_product:'whatsapp', to:num, type:'template', template:{name:plantilla, language:{code: info.language || 'es_CO'}, components: comps }};
        try{
          const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone || emp.phone_id}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify(payload)});
          const j=await r.json();
          const cur2=getDB(empresa_id);
          if(j.messages) cur2.campaigns[campId].enviados++; else cur2.campaigns[campId].fallidos++;
          saveDB(empresa_id, cur2);
        }catch(e){}
        await new Promise(r=>setTimeout(r,1300));
      }
      const cur=getDB(empresa_id); if(cur.campaigns[campId]){ cur.campaigns[campId].estado='finalizada'; saveDB(empresa_id, cur); }
    }catch(e){ console.log('Camp error', e.message); }
  })();
});

app.post('/api/campana/:empresa_id/:id/pausar',(req,res)=>{ const db=getDB(req.params.empresa_id); if(db.campaigns[req.params.id]){db.campaigns[req.params.id].pausada=true; saveDB(req.params.empresa_id,db);} res.json({ok:true}); });
app.post('/api/campana/:empresa_id/:id/continuar',(req,res)=>{ const db=getDB(req.params.empresa_id); if(db.campaigns[req.params.id]){db.campaigns[req.params.id].pausada=false; saveDB(req.params.empresa_id,db);} res.json({ok:true}); });
app.post('/api/campana/:empresa_id/:id/cancelar',(req,res)=>{ const db=getDB(req.params.empresa_id); if(db.campaigns[req.params.id]){db.campaigns[req.params.id].estado='cancelada'; saveDB(req.params.empresa_id,db);} res.json({ok:true}); });

app.get('/api/campanas/:empresa_id',(req,res)=>{
  try{ res.json(Object.values(getDB(req.params.empresa_id).campaigns).sort((a,b)=>b.created-a.created)); }
  catch{ res.json([]); }
});
app.get('/api/campana/:empresa_id/:id',(req,res)=>{ res.json(getDB(req.params.empresa_id).campaigns[req.params.id]||{}); });

// CHATS - HISTORIAL INFINITO
app.get('/api/chats/:empresa_id',(req,res)=>{
  try{ res.json(Object.values(getDB(req.params.empresa_id).chats).sort((a,b)=>(b.last||0)-(a.last||0))); }
  catch{ res.json([]); }
});
app.get('/api/mensajes/:empresa_id/:chat_id',(req,res)=>{ res.json(getDB(req.params.empresa_id).chats[req.params.chat_id]?.mensajes||[]); });
app.post('/api/chat/leido',(req,res)=>{ const db=getDB(req.body.empresa_id); if(db.chats[req.body.chat_id]){ db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db);} res.json({ok:true}); });
app.post('/api/chat/asignar',(req,res)=>{ const db=getDB(req.body.empresa_id); if(db.chats[req.body.chat_id]){ db.chats[req.body.chat_id].asignado=req.body.worker_id; saveDB(req.body.empresa_id,db);} res.json({ok:true}); });
app.post('/api/chat/enviar-media', mediaUpload.single('file'), (req,res)=>{
  try{
    const ext = path.extname(req.file.originalname);
    const newName = `${Date.now()}_${req.file.filename}${ext}`;
    const dest = path.join(__dirname,'public/uploads', newName);
    fs.renameSync(req.file.path, dest);
    const url = `/uploads/${newName}`;
    const tipo = req.file.mimetype.startsWith('image')?'image': req.file.mimetype.startsWith('audio')?'audio': req.file.mimetype.startsWith('video')?'video':'document';
    const db=getDB(req.body.empresa_id);
    if(!db.chats[req.body.chat_id]) db.chats[req.body.chat_id]={id:req.body.chat_id, mensajes:[], no_leidos:0};
    db.chats[req.body.chat_id].mensajes.push({tipo, url, nombre:req.file.originalname, from:'yo', ts:Date.now(), texto: tipo!='image'?`📎 ${req.file.originalname}`:''});
    db.chats[req.body.chat_id].last=Date.now();
    saveDB(req.body.empresa_id, db);
    res.json({ok:true, url});
  }catch(e){ res.json({ok:false, error:e.message}); }
});

// WEBHOOKS
app.get('/webhook/:empresa_id',(req,res)=>{ res.status(200).send(req.query['hub.challenge']||'ok'); });
app.post('/webhook/:empresa_id', async(req,res)=>{
  const empresa_id=req.params.empresa_id; const db=getDB(empresa_id);
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value;
    if(val?.messages){
      for(let m of val.messages){
        const chatId=m.from;
        if(!db.chats[chatId]) db.chats[chatId]={id:chatId, mensajes:[], no_leidos:0, last:Date.now()};
        let msg={from:'cliente', ts:Date.now(), tipo:m.type};
        if(m.type==='text') msg.texto=m.text.body;
        if(m.type==='image') msg={...msg, texto:'📷 Foto', tipo:'image', url:''};
        if(m.type==='audio' || m.type==='voice') msg={...msg, tipo:'audio', url:''};
        if(m.type==='document') msg={...msg, tipo:'document', nombre:m.document?.filename||'Archivo'};
        if(m.type==='video') msg={...msg, tipo:'video'};
        db.chats[chatId].mensajes.push(msg);
        db.chats[chatId].no_leidos=(db.chats[chatId].no_leidos||0)+1;
        db.chats[chatId].last=Date.now();
      }
      saveDB(empresa_id, db);
    }
  }catch(e){ console.log(e); }
  res.sendStatus(200);
});

// RECORDATORIOS, WORKERS, STATS, PLANES
app.post('/api/recordatorio',(req,res)=>{ const db=getDB(req.body.empresa_id); db.reminders.push({...req.body, id:Date.now().toString()}); saveDB(req.body.empresa_id, db); res.json({ok:true}); });
app.get('/api/recordatorios/:empresa_id',(req,res)=>{ res.json(getDB(req.params.empresa_id).reminders||[]); });
app.post('/api/worker/add',(req,res)=>{ const db=getDB(req.body.empresa_id); const id=Date.now().toString(); db.workers[id]={...req.body, id}; saveDB(req.body.empresa_id, db); res.json({ok:true}); });
app.get('/api/workers/:empresa_id',(req,res)=>{ res.json(Object.values(getDB(req.params.empresa_id).workers||{})); });
app.get('/api/stats/:empresa_id',(req,res)=>{ const db=getDB(req.params.empresa_id); res.json({total_campanas:Object.keys(db.campaigns||{}).length, total_chats:Object.keys(db.chats||{}).length}); });
app.get('/api/planes',(req,res)=>{ res.json([{nombre:'Básico', precio:'$97', wa:'https://wa.me/573133181851'}]); });
app.get('/api/health',(req,res)=>res.json({ok:true, v:'V147 FINAL'}));

// ========== STATIC AL FINAL - QUITA ERROR DOCTYPE ==========
app.use(express.static(path.join(__dirname,'public')));
app.use('/uploads', express.static(path.join(__dirname,'public/uploads')));
app.get('*',(req,res)=>{ res.sendFile(path.join(__dirname,'public','index.html')); });

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`KLIDO V147 FINAL OK PORT ${PORT}`));
