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

console.log('=== KLIDO CRM PRO 100% META FINAL ===');
console.log(`VERIFY:${VERIFY_TOKEN} PHONE:${PHONE_ID} WABA MANUAL:${WABA_ID||'NO - AUTO'} TOKEN:${!!META_TOKEN}`);

let memMessages=[], memContacts={}, memCampaigns=[], cacheTemplates=[];
let pool=null;

async function initDB(){
 if(!process.env.DATABASE_URL) return;
 try{
  const {Pool}=require('pg');
  pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{ await pool.query(`SELECT wa_id FROM messages LIMIT 1`); }catch(e){
   if(e.message.includes('wa_id')){
    console.log('🛠️ FIX wa_id - recreando tablas...');
    await pool.query(`DROP TABLE IF EXISTS messages CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS contacts CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS campaigns CASCADE`);
   }
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts(wa_id TEXT PRIMARY KEY, name TEXT, last_msg TEXT, updated_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, type TEXT, direction TEXT, source TEXT, template_name TEXT, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, name TEXT, total INT, sent INT DEFAULT 0, delivered INT DEFAULT 0, read INT DEFAULT 0, failed INT DEFAULT 0, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  const {rows}=await pool.query(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 1000`);
  memMessages=rows||[];
  const c=await pool.query(`SELECT * FROM contacts`); c.rows.forEach(r=>memContacts[r.wa_id]=r);
  const camp=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 50`); memCampaigns=camp.rows||[];
  console.log(`✅ HISTORIAL DB ACTIVO - ${memMessages.length} mensajes, ${Object.keys(memContacts).length} chats`);
 }catch(e){ console.log('DB err',e.message); }
}
initDB();

// DISCOVERY 100% META - 3 INTENTOS
async function discoverWABA(){
 if(WABA_ID && /^\d{10,20}$/.test(WABA_ID)) return WABA_ID;
 if(!META_TOKEN) return null;
 console.log('🔍 Buscando WABA_ID por API META...');

 // Intento 1: me/whatsapp_business_accounts
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/me/whatsapp_business_accounts?fields=id`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  console.log('INTENTO 1 me/waba:', JSON.stringify(j).slice(0,300));
  if(j.data && j.data[0]?.id){ WABA_ID=j.data[0].id; console.log(`✅ WABA ENCONTRADO INTENTO 1: ${WABA_ID}`); return WABA_ID; }
 }catch(e){ console.log('int1 err',e.message); }

 // Intento 2: me/owned_whatsapp_business_accounts
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/me/owned_whatsapp_business_accounts?fields=id`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  console.log('INTENTO 2 owned:', JSON.stringify(j).slice(0,300));
  if(j.data && j.data[0]?.id){ WABA_ID=j.data[0].id; console.log(`✅ WABA ENCONTRADO INTENTO 2: ${WABA_ID}`); return WABA_ID; }
 }catch(e){ console.log('int2 err',e.message); }

 // Intento 3: via businesses
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/me/businesses?fields=id`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  console.log('INTENTO 3 businesses:', JSON.stringify(j).slice(0,300));
  if(j.data){
   for(const b of j.data){
    const r2=await fetch(`https://graph.facebook.com/v20.0/${b.id}/owned_whatsapp_business_accounts?fields=id`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
    const j2=await r2.json();
    console.log(`Business ${b.id} waba:`, JSON.stringify(j2).slice(0,300));
    if(j2.data && j2.data[0]?.id){ WABA_ID=j2.data[0].id; console.log(`✅ WABA ENCONTRADO INTENTO 3: ${WABA_ID}`); return WABA_ID; }
   }
  }
 }catch(e){ console.log('int3 err',e.message); }

 console.log('⚠️ NO SE PUDO AUTO-DESCUBRIR WABA - PON WABA_ID MANUAL EN RAILWAY');
 return WABA_ID||null;
}

async function fetchMetaTemplates(){
 try{
  let waba= WABA_ID || await discoverWABA();
  if(!waba||!META_TOKEN){ console.log('Sin WABA_ID para templates'); return cacheTemplates; }
  const r=await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?fields=name,status,language,category,components&limit=100`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  if(j.error){ console.log('❌ Templates error:', j.error.message, '- Revisa que WABA_ID sea correcto'); return cacheTemplates; }
  if(j.data){
   cacheTemplates=j.data.filter(t=>t.status==='APPROVED').map(t=>{
    const h=t.components.find(c=>c.type==='HEADER');
    const b=t.components.find(c=>c.type==='BODY');
    const btn=t.components.find(c=>c.type==='BUTTONS');
    return {name:t.name,status:t.status,language:t.language,category:t.category,hasImage:h?.format==='IMAGE',bodyText:b?.text||'',buttons:btn?.buttons||[],components:t.components};
   });
   if(cacheTemplates.length) console.log(`✅ ${cacheTemplates.length} PLANTILLAS API META: ${cacheTemplates.map(t=>t.name).join(', ')}`);
   else console.log('⚠️ 0 plantillas aprobadas en este WABA - crea alion_co en Meta');
  }
  return cacheTemplates;
 }catch(e){ console.log('tpl err',e.message); return cacheTemplates; }
}
setTimeout(fetchMetaTemplates,2500);
setInterval(fetchMetaTemplates,10000);

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
  if(memCampaigns.length){ const last=memCampaigns[0]; if(st.status==='sent') last.sent++; if(st.status==='delivered') last.delivered++; if(st.status==='read') last.read++; if(st.status==='failed') last.failed++; }
 }
 if(v.messages){
  const m=v.messages[0]; const contact=v.contacts?.[0];
  const wa_id=m.from; const txt=m.type==='text'?m.text.body:`[${m.type}]`;
  saveHistory({wa_id,text:txt,type:m.type,direction:'in',source:'inbox',created_at:new Date(),status:'delivered'});
  console.log(`💬 IN: ${wa_id} ${txt}`);
 }
 res.sendStatus(200);
});

app.get('/api/templates',async(_,res)=>{ const d=await fetchMetaTemplates(); res.json(d); });
app.get('/api/templates/stream',(req,res)=>{
 res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive');
 res.write(`data: ${JSON.stringify(cacheTemplates)}\n\n`);
 const iv=setInterval(async()=>{ const data=await fetchMetaTemplates(); res.write(`data: ${JSON.stringify(data)}\n\n`); },4000);
 req.on('close',()=>clearInterval(iv));
});

app.get('/api/chats',async(_,res)=>{
 try{
  if(pool){
   const {rows}=await pool.query(`SELECT m.wa_id, m.text, m.created_at, m.source, m.status, c.name FROM (SELECT DISTINCT ON (wa_id) wa_id, text, created_at, source, status FROM messages ORDER BY wa_id, created_at DESC) m LEFT JOIN contacts c ON c.wa_id=m.wa_id ORDER BY m.created_at DESC LIMIT 200`);
   if(rows.length) return res.json(rows);
  }
 }catch(e){ console.log('chats err',e.message); }
 const map={}; memMessages.forEach(m=>{ if(!map[m.wa_id]||new Date(m.created_at)>new Date(map[m.wa_id].created_at)) map[m.wa_id]={wa_id:m.wa_id,text:m.text,created_at:m.created_at,source:m.source,status:m.status,name:memContacts[m.wa_id]?.name||m.wa_id}; });
 res.json(Object.values(map).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
});

app.get('/api/messages/:wa_id',(req,res)=>{ res.json(memMessages.filter(m=>m.wa_id===req.params.wa_id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))); });

app.post('/api/send',async(req,res)=>{
 const {to,message}=req.body;
 try{
  const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})});
  const j=await r.json();
  console.log('SEND INBOX:', JSON.stringify(j).slice(0,300));
  saveHistory({wa_id:to,text:message,type:'text',direction:'out',source:'inbox',created_at:new Date(),status:j.messages?'sent':'failed'});
  res.json({ok:!!j.messages,data:j});
 }catch(e){ res.json({ok:false,error:e.message}); }
});

app.get('/api/campaigns',(_,res)=>res.json(memCampaigns));
app.get('/api/campaigns/stream',(req,res)=>{
 res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive');
 const iv=setInterval(()=>res.write(`data: ${JSON.stringify(memCampaigns)}\n\n`),1500);
 req.on('close',()=>clearInterval(iv));
});

app.post('/api/campaigns/send-bulk',async(req,res)=>{
 const {numbers,templateName}=req.body;
 const tpl=templateName||'alion_co';
 const id=Date.now().toString();
 const camp={id,name:tpl,total:numbers.length,sent:0,delivered:0,read:0,failed:0,status:'enviando API META',created_at:new Date().toISOString()};
 memCampaigns.unshift(camp);
 if(pool) try{ await pool.query(`INSERT INTO campaigns(id,name,total,sent,status) VALUES($1,$2,$3,0,$4)`,[id,tpl,numbers.length,'enviando']); }catch{}
 console.log(`🚀 CAMPAÑA ${tpl} -> ${numbers.length} contactos - 100% API META`);
 (async()=>{
  for(const raw of numbers){
   const to=String(raw).replace(/\D/g,'');
   try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:tpl,language:{code:'es_CO'}}} )});
    const j=await r.json();
    if(j.messages){ camp.sent++; saveHistory({wa_id:to,text:`[Plantilla ${tpl}]`,type:'template',direction:'out',source:'campaign',template_name:tpl,status:'sent',created_at:new Date()}); console.log(`✅ ${to} OK`); }
    else{ camp.failed++; console.log(`❌ ${to} FAIL:`, JSON.stringify(j.error||j).slice(0,300)); }
   }catch(e){ camp.failed++; console.log(`❌ ${to} EXC:`,e.message); }
   await new Promise(r=>setTimeout(r,600));
  }
  camp.status='completada';
  if(pool) try{ await pool.query(`UPDATE campaigns SET sent=$1, failed=$2, status='completada' WHERE id=$3`,[camp.sent,camp.failed,id]); }catch{}
  console.log(`🏁 CAMPAÑA ${id} FIN sent=${camp.sent} failed=${camp.failed}`);
 })();
 res.json({ok:true,id,total:numbers.length,template:tpl});
});

app.use(express.static(publicPath));
app.get('/health',async(_,res)=>{
 const waba= WABA_ID || await discoverWABA();
 res.json({ok:true,api:'KLIDO 100% META FINAL',verify:VERIFY_TOKEN,phone:PHONE_ID,waba:waba||'NO REGISTRADO',hasToken:!!META_TOKEN,templates:cacheTemplates.map(t=>t.name),messages:memMessages.length,chats:Object.keys(memContacts).length,hasDB:!!pool,autoUpdate:true});
});
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.listen(process.env.PORT||3000,()=>console.log(`🚀 KLIDO FINAL LISTO`));
