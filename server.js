// KLIDO V176 FINAL - FIX HISTORIAL Y RESPUESTA
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
['public','public/uploads'].forEach(d=>{if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true})});

function getDB(id){ const f=path.join(DB_PATH,`${(id||'default').replace(/[^a-z0-9_\-@.]/gi,'')}.json`); if(!fs.existsSync(f)) return {empresa_id:id, config:{}, chats:{}, campaigns:{}}; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return {empresa_id:id, config:{}, chats:{}, campaigns:{}};}}
function saveDB(id,d){ const f=path.join(DB_PATH,`${(id||'default').replace(/[^a-z0-9_\-@.]/gi,'')}.json`); fs.writeFileSync(f, JSON.stringify(d,null,2)); }
function getMasterDB(){ const f=path.join(DB_PATH,'master.json'); if(!fs.existsSync(f)) return {empresas:{}, users:{}}; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return {empresas:{}, users:{}};}
function saveMaster(db){ fs.writeFileSync(path.join(DB_PATH,'master.json'), JSON.stringify(db,null,2)); }
function loadConfig(id){
  let db=getDB(id);
  if(process.env.WHATSAPP_TOKEN) db.config.token=process.env.WHATSAPP_TOKEN.trim();
  if(process.env.PHONE_NUMBER_ID) db.config.phone=process.env.PHONE_NUMBER_ID.trim();
  if(process.env.WABA_ID) db.config.waba=process.env.WABA_ID.trim();
  saveDB(id,db); return db.config;
}
function findEmpresaByPhone(phoneId){
  if(!phoneId) return null;
  try{
    const files=fs.readdirSync(DB_PATH);
    for(let f of files){
      if(!f.endsWith('.json')||f==='master.json') continue;
      const d=JSON.parse(fs.readFileSync(path.join(DB_PATH,f),'utf8'));
      if(d.config?.phone==phoneId) return d.empresa_id;
    }
  }catch{}
  const m=getMasterDB(); return Object.keys(m.empresas)[0] || 'default';
}

const VERIFY_TOKEN = 'klido123';
app.get('/webhook', (req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']); res.sendStatus(403); });
app.get('/webhook/:empresa_id', (req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']); res.sendStatus(403); });

function handleWebhook(body, forced){
  const val=body.entry?.[0]?.changes?.[0]?.value;
  if(!val) return;
  const phoneId=val.metadata?.phone_number_id;
  const eid = forced || findEmpresaByPhone(phoneId) || 'default';
  const db=getDB(eid);
  if(val.statuses){ val.statuses.forEach(s=>console.log(`STATUS [${eid}] ${s.id} -> ${s.status}`)); }
  if(val.messages){
    val.messages.forEach(m=>{
      const id=m.from;
      if(!db.chats[id]) db.chats[id]={id,mensajes:[],no_leidos:0,last:Date.now()};
      const txt=m.text?.body || m.button?.text || m.interactive?.button_reply?.title || '📎 Mensaje';
      db.chats[id].mensajes.push({from:'cliente',texto:txt,ts:Date.now()});
      db.chats[id].no_leidos=(db.chats[id].no_leidos||0)+1;
      db.chats[id].last=Date.now();
      console.log(`ENTRANTE [${eid}] ${id}: ${txt}`);
    });
    saveDB(eid,db);
  }
}
app.post('/webhook', (req,res)=>{ handleWebhook(req.body); res.sendStatus(200); });
app.post('/webhook/:empresa_id', (req,res)=>{ handleWebhook(req.body, req.params.empresa_id); res.sendStatus(200); });

app.post('/api/mensaje/enviar', async (req,res)=>{
  const {empresa_id, chat_id, texto}=req.body;
  const emp=loadConfig(empresa_id||'default');
  if(!emp.token) return res.json({ok:false,error:'Falta token'});
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{
      method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`},
      body:JSON.stringify({messaging_product:'whatsapp', to:String(chat_id).replace(/\D/g,''), type:'text', text:{body:texto}})
    });
    const j=await r.json();
    if(j.messages){
      const db=getDB(empresa_id); if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id,mensajes:[],no_leidos:0,last:Date.now()};
      db.chats[chat_id].mensajes.push({from:'agente',texto,ts:Date.now()});
      db.chats[chat_id].last=Date.now(); saveDB(empresa_id,db);
      return res.json({ok:true});
    }
    res.json({ok:false,error:j});
  }catch(e){ res.json({ok:false,error:e.message}); }
});
app.post('/api/chat/enviar',(req,res)=>{ req.url='/api/mensaje/enviar'; app._router.handle(req,res); });

app.get('/api/chats/:empresa_id',(req,res)=>{ const db=getDB(req.params.empresa_id); res.json(Object.values(db.chats||{}).sort((a,b)=>(b.last||0)-(a.last||0))); });
app.get('/api/mensajes/:empresa_id/:chat_id',(req,res)=>{ const db=getDB(req.params.empresa_id); const arr=db.chats[req.params.chat_id]?.mensajes||[]; arr.sort((a,b)=>(a.ts||0)-(b.ts||0)); res.json(arr); });
app.post('/api/chat/leido',(req,res)=>{ const db=getDB(req.body.empresa_id); if(db.chats[req.body.chat_id]){db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db);} res.json({ok:true}); });
app.get('/api/plantillas/:empresa_id',async(req,res)=>{ res.json([{name:'acol_invitacion_congreso',status:'APPROVED',language:'es_CO'}]); });
app.post('/api/config-empresa',(req,res)=>{ const db=getDB(req.body.empresa_id); db.config={token:req.body.token,phone:req.body.phone_id,waba:req.body.waba_id}; saveDB(req.body.empresa_id,db); res.json({ok:true}); });
app.get('/api/empresa/:id',(req,res)=>res.json(getDB(req.params.id).config||{}));
app.get('/api/mi-plan/:empresa_id',(req,res)=>res.json({plan:'Gold',nombre:'GOLD',max_conversaciones:9999999}));
app.get('/api/debug/config/:empresa_id',(req,res)=>res.json({V:'V176',config:loadConfig(req.params.empresa_id)}));

app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000,()=>console.log('V176 OK'));
