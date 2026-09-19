const express=require('express');
const fs=require('fs');
const path=require('path');
const app=express();
app.use(express.json({limit:'50mb'}));
app.use(require('cors')());
const publicPath=path.join(__dirname,'public');
const uploadDir=path.join(publicPath,'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
app.use('/uploads',express.static(uploadDir));

const VERIFY_TOKEN=(process.env.VERIFY_TOKEN||'klido123').trim();
let WABA_ID=(process.env.WABA_ID||'').trim();
if(WABA_ID.startsWith('EAAT')||WABA_ID.length>50) WABA_ID='';
const META_TOKEN=(process.env.WHATSAPP_TOKEN||'').trim();
const PHONE_ID=(process.env.PHONE_NUMBER_ID||'').trim();

console.log('=== KLIDO CRM DYNAMIC TEMPLATES + HISTORIAL PERMANENTE ===');

let memMessages=[], memContacts={}, memCampaigns=[], cacheTemplates=[];
let pool=null;

async function initDB(){
 if(!process.env.DATABASE_URL){ console.log('Sin DATABASE_URL'); return; }
 try{
  const {Pool}=require('pg');
  pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{ await pool.query(`SELECT wa_id FROM messages LIMIT 1`); }catch(e){
   if(e.message.includes('wa_id')){
    await pool.query(`DROP TABLE IF EXISTS messages CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS contacts CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS campaigns CASCADE`);
   }
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts(wa_id TEXT PRIMARY KEY, name TEXT, last_msg TEXT, updated_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, type TEXT, direction TEXT, source TEXT, template_name TEXT, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, name TEXT, total INT, sent INT DEFAULT 0, delivered INT DEFAULT 0, read INT DEFAULT 0, failed INT DEFAULT 0, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  const {rows}=await pool.query(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 2000`);
  memMessages=rows||[];
  const c=await pool.query(`SELECT * FROM contacts`); c.rows.forEach(r=>memContacts[r.wa_id]=r);
  const camp=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`); memCampaigns=camp.rows||[];
  console.log(`✅ HISTORIAL PERMANENTE ACTIVO - ${memMessages.length} mensajes guardados`);
 }catch(e){ console.log('DB err',e.message); }
}
initDB();

async function discoverWABA(){
 if(WABA_ID && /^\d{10,20}$/.test(WABA_ID)) return WABA_ID;
 if(!META_TOKEN) return null;
 console.log('🔍 Buscando WABA_ID...');
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/me/whatsapp_business_accounts?fields=id`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  if(j.data?.[0]?.id){ WABA_ID=j.data[0].id; return WABA_ID; }
 }catch{}
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/me/owned_whatsapp_business_accounts?fields=id`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  if(j.data?.[0]?.id){ WABA_ID=j.data[0].id; return WABA_ID; }
 }catch{}
 return WABA_ID||null;
}

async function fetchMetaTemplates(){
 try{
  let waba= WABA_ID || await discoverWABA();
  if(!waba||!META_TOKEN) return cacheTemplates;
  const r=await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?fields=name,status,language,category,components&limit=100`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  if(j.error){ console.log('Templates err:', j.error.message); return cacheTemplates; }
  if(j.data){
   const approved=j.data.filter(t=>t.status==='APPROVED');
   cacheTemplates=approved.map(t=>{
    const b=t.components.find(c=>c.type==='BODY');
    const h=t.components.find(c=>c.type==='HEADER');
    const btn=t.components.find(c=>c.type==='BUTTONS');
    return {name:t.name,status:t.status,language:t.language,category:t.category,hasImage:h?.format==='IMAGE',bodyText:b?.text||'',buttons:btn?.buttons||[]};
   });
   console.log(`✅ PLANTILLAS DINÁMICAS (${cacheTemplates.length}): ${cacheTemplates.map(t=>t.name+'['+t.language+']').join(', ')||'ninguna aprobada aún'}`);
  }
  return cacheTemplates;
 }catch(e){ console.log('fetch err',e.message); return cacheTemplates; }
}
setTimeout(fetchMetaTemplates,2000);
setInterval(fetchMetaTemplates,5000);

function saveHistory(msg){
 memMessages.push(msg);
 memContacts[msg.wa_id]={wa_id:msg.wa_id,name:memContacts[msg.wa_id]?.name||msg.wa_id,last_msg:msg.text,updated_at:new Date()};
 if(pool){
  pool.query(`INSERT INTO contacts(wa_id,name,last_msg,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(wa_id) DO UPDATE SET last_msg=$3, updated_at=NOW()`,[msg.wa_id,memContacts[msg.wa_id].name,msg.text]).catch(()=>{});
  pool.query(`INSERT INTO messages(wa_id,text,type,direction,source,template_name,status) VALUES($1,$2,$3,$4,$5,$6,$7)`,[msg.wa_id,msg.text,msg.type,msg.direction,msg.source,msg.template_name||null,msg.status||'sent']).catch(()=>{});
 }
}

app.post('/api/login',(req,res)=>{
 const e=(process.env.ADMIN_EMAIL||'fermorales20020310@gmail.com').toLowerCase();
 const p=process.env.ADMIN_PASS||'Mafe2002@';
 if((req.body.email||'').toLowerCase()===e && (req.body.password||'')===p) return res.json({ok:true});
 res.json({ok:false});
});

app.get('/webhook',(req,res)=>{
 if(req.query['hub.mode']==='subscribe' && (req.query['hub.verify_token']||'').trim()===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
 res.sendStatus(403);
});

app.post('/webhook',async(req,res)=>{
 const v=req.body.entry?.[0]?.changes?.[0]?.value;
 if(!v) return res.sendStatus(200);
 if(v.statuses){
  const st=v.statuses[0];
  console.log(`📊 STATUS ${st.recipient_id} -> ${st.status}`);
  if(memCampaigns[0]){ const c=memCampaigns[0]; if(st.status==='sent') c.sent++; if(st.status==='delivered') c.delivered++; if(st.status==='read') c.read++; if(st.status==='failed') c.failed++; }
 }
 if(v.messages){
  const m=v.messages[0];
  const wa_id=m.from;
  let txt=''; if(m.type==='text') txt=m.text.body; else if(m.type==='image') txt='[Imagen]'; else if(m.type==='button') txt=m.button.text; else txt=`[${m.type}]`;
  console.log(`💬 NUEVO MENSAJE ENTRANTE ${wa_id}: ${txt} - GUARDANDO EN HISTORIAL`);
  saveHistory({wa_id,text:txt,type:m.type,direction:'in',source:'inbox',created_at:new Date(),status:'delivered'});
 }
 res.sendStatus(200);
});

app.get('/api/templates',async(_,res)=>{ const d=await fetchMetaTemplates(); res.json(d); });
app.get('/api/templates/stream',(req,res)=>{
 res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive');
 res.write(`data: ${JSON.stringify(cacheTemplates)}\n\n`);
 const iv=setInterval(async()=>{ const data=await fetchMetaTemplates(); res.write(`data: ${JSON.stringify(data)}\n\n`); },5000);
 req.on('close',()=>clearInterval(iv));
});

app.get('/api/chats',async(_,res)=>{
 try{
  if(pool){
   const {rows}=await pool.query(`SELECT m.wa_id, m.text, m.created_at, m.source, m.status, c.name FROM (SELECT DISTINCT ON (wa_id) wa_id, text, created_at, source, status FROM messages ORDER BY wa_id, created_at DESC) m LEFT JOIN contacts c ON c.wa_id=m.wa_id ORDER BY m.created_at DESC LIMIT 300`);
   if(rows.length) return res.json(rows);
  }
 }catch(e){ console.log('chats err',e.message); }
 const map={}; memMessages.forEach(m=>{ if(!map[m.wa_id]||new Date(m.created_at)>new Date(map[m.wa_id].created_at)) map[m.wa_id]={wa_id:m.wa_id,text:m.text,created_at:m.created_at,source:m.source,status:m.status,name:memContacts[m.wa_id]?.name||m.wa_id}; });
 res.json(Object.values(map).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
});

app.get('/api/messages/:wa_id',(req,res)=>{
 const list=memMessages.filter(m=>m.wa_id===req.params.wa_id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
 res.json(list);
});

app.post('/api/send',async(req,res)=>{
 const {to,message}=req.body;
 console.log(`📤 ENVIANDO BANDEJA a ${to}: ${message}`);
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})});
  const j=await r.json();
  console.log('SEND RESP:', JSON.stringify(j).slice(0,300));
  if(j.messages){ saveHistory({wa_id:to,text:message,type:'text',direction:'out',source:'inbox',created_at:new Date(),status:'sent'}); }
  res.json({ok:!!j.messages,data:j});
 }catch(e){ res.json({ok:false,error:e.message}); }
});

app.get('/api/campaigns',(_,res)=>res.json(memCampaigns));
app.get('/api/campaigns/stream',(req,res)=>{
 res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive');
 const iv=setInterval(()=>res.write(`data: ${JSON.stringify(memCampaigns)}\n\n`),1500);
 req.on('close',()=>clearInterval(iv));
});

// ENVIO DINAMICO - USA EL IDIOMA REAL DE LA PLANTILLA
app.post('/api/campaigns/send-bulk',async(req,res)=>{
 const {numbers,templateName}=req.body;
 if(!templateName) return res.json({ok:false,error:'Selecciona plantilla'});
 const tplObj=cacheTemplates.find(t=>t.name===templateName);
 if(!tplObj){ console.log(`⚠️ Plantilla ${templateName} no encontrada en cache, intentando igual...`); }
 const lang=tplObj?.language||'es_CO';
 const id=Date.now().toString();
 const camp={id,name:templateName,total:numbers.length,sent:0,delivered:0,read:0,failed:0,status:'enviando',created_at:new Date().toISOString()};
 memCampaigns.unshift(camp);
 if(pool) try{ await pool.query(`INSERT INTO campaigns(id,name,total,sent,status) VALUES($1,$2,$3,0,$4)`,[id,templateName,numbers.length,'enviando']); }catch{}
 console.log(`🚀 CAMPAÑA DINÁMICA ${templateName} [${lang}] -> ${numbers.length} contactos`);
 (async()=>{
  for(const raw of numbers){
   const to=String(raw).replace(/\D/g,'');
   try{
    const payload={messaging_product:'whatsapp',to,type:'template',template:{name:templateName,language:{code:lang}}};
    const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json();
    if(j.messages){ camp.sent++; saveHistory({wa_id:to,text:`[Plantilla ${templateName}]`,type:'template',direction:'out',source:'campaign',template_name:templateName,status:'sent',created_at:new Date()}); console.log(`✅ ${to} ${templateName} OK`); }
    else{ camp.failed++; console.log(`❌ ${to} FAIL:`, JSON.stringify(j.error||j).slice(0,400)); }
   }catch(e){ camp.failed++; console.log(`❌ ${to} EXC:`,e.message); }
   await new Promise(r=>setTimeout(r,600));
  }
  camp.status='completada';
  if(pool) try{ await pool.query(`UPDATE campaigns SET sent=$1, failed=$2, status='completada' WHERE id=$3`,[camp.sent,camp.failed,id]); }catch{}
  console.log(`🏁 CAMPAÑA ${id} FIN sent=${camp.sent} failed=${camp.failed}`);
 })();
 res.json({ok:true,id,total:numbers.length,template:templateName,language:lang});
});

app.use(express.static(publicPath));
app.get('/health',async(_,res)=>{
 const waba= WABA_ID || await discoverWABA();
 res.json({ok:true,mode:'DYNAMIC TEMPLATES + HISTORIAL PERMANENTE',verify:VERIFY_TOKEN,phone:PHONE_ID,waba:waba||'NO - pon WABA_ID manual',hasToken:!!META_TOKEN,templates:cacheTemplates,templates_names:cacheTemplates.map(t=>t.name),messages:memMessages.length,chats:Object.keys(memContacts).length,hasDB:!!pool,autoUpdate:true});
});
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.listen(process.env.PORT||3000,()=>console.log(`🚀 KLIDO DYNAMIC LISTO - WABA:${WABA_ID||'AUTO'}`));
