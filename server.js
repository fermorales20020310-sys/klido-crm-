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

console.log('=== KLIDO FINAL COMPLETO ===');
let memMessages=[], memContacts={}, memCampaigns=[], cacheTemplates=[];
let pool=null;

async function initDB(){
 if(!process.env.DATABASE_URL) return;
 try{
  const {Pool}=require('pg');
  pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts(wa_id TEXT PRIMARY KEY, name TEXT, last_msg TEXT, updated_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, type TEXT, direction TEXT, source TEXT, template_name TEXT, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, name TEXT, total INT, sent INT DEFAULT 0, delivered INT DEFAULT 0, read INT DEFAULT 0, failed INT DEFAULT 0, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  const {rows}=await pool.query(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 5000`);
  memMessages=rows||[];
  const c=await pool.query(`SELECT * FROM contacts`); c.rows.forEach(r=>memContacts[r.wa_id]=r);
  const camp=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`); memCampaigns=camp.rows||[];
  console.log(`✅ HISTORIAL: ${memMessages.length} msgs`);
 }catch(e){ console.log('DB err',e.message); }
}
initDB();

async function discoverWABA(){
 if(WABA_ID && /^\d{10,20}$/.test(WABA_ID)) return WABA_ID;
 if(!META_TOKEN) return null;
 try{let r=await fetch(`https://graph.facebook.com/v20.0/me/whatsapp_business_accounts?fields=id`,{headers:{Authorization:`Bearer ${META_TOKEN}`}}); let j=await r.json(); if(j.data?.[0]?.id){WABA_ID=j.data[0].id; return WABA_ID;}}catch{}
 return WABA_ID||null;
}
async function fetchMetaTemplates(){
 try{
  let waba=WABA_ID||await discoverWABA();
  if(!waba||!META_TOKEN) return cacheTemplates;
  const r=await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?fields=name,status,language,category,components&limit=100`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  if(j.data){
   cacheTemplates=j.data.filter(t=>t.status==='APPROVED').map(t=>{
    const b=t.components.find(c=>c.type==='BODY');
    return {name:t.name,status:t.status,language:t.language,bodyText:b?.text||''};
   });
   console.log(`✅ PLANTILLAS: ${cacheTemplates.map(t=>t.name).join(', ')}`);
  }
  return cacheTemplates;
 }catch{return cacheTemplates;}
}
setTimeout(fetchMetaTemplates,2000); setInterval(fetchMetaTemplates,5000);

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
 if((req.body.email||'').toLowerCase()===e && req.body.password===p) return res.json({ok:true});
 res.json({ok:false});
});
app.get('/webhook',(req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/webhook',async(req,res)=>{
 const v=req.body.entry?.[0]?.changes?.[0]?.value; if(!v) return res.sendStatus(200);
 if(v.statuses){ const st=v.statuses[0]; if(memCampaigns[0]){const c=memCampaigns[0]; if(st.status==='sent')c.sent++; if(st.status==='delivered')c.delivered++; if(st.status==='read')c.read++; if(st.status==='failed')c.failed++; if(pool) pool.query(`UPDATE campaigns SET sent=$1, delivered=$2, read=$3, failed=$4 WHERE id=$5`,[c.sent,c.delivered,c.read,c.failed,c.id]).catch(()=>{}); } }
 if(v.messages){ const m=v.messages[0]; let txt=m.type==='text'?m.text.body:`[${m.type}]`; saveHistory({wa_id:m.from,text:txt,type:m.type,direction:'in',source:'inbox',created_at:new Date(),status:'delivered'}); }
 res.sendStatus(200);
});

app.get('/api/templates',async(_,res)=>res.json(await fetchMetaTemplates()));
app.get('/api/templates/stream',(req,res)=>{ res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive'); res.write(`data: ${JSON.stringify(cacheTemplates)}\n\n`); const iv=setInterval(async()=>{res.write(`data: ${JSON.stringify(await fetchMetaTemplates())}\n\n`);},5000); req.on('close',()=>clearInterval(iv)); });

// ESTA ES LA RUTA QUE ARREGLA TU CAPTURA - AHORA SI MANDA unanswered Y campaign
app.get('/api/chats',async(_,res)=>{
 try{
  if(pool){
   const {rows}=await pool.query(`SELECT last_msg.wa_id, last_msg.text, last_msg.created_at, last_msg.source, last_msg.direction, last_msg.template_name, c.name, CASE WHEN last_msg.direction='in' THEN true ELSE false END as unanswered FROM (SELECT DISTINCT ON (wa_id) wa_id, text, created_at, source, direction, template_name FROM messages ORDER BY wa_id, created_at DESC) last_msg LEFT JOIN contacts c ON c.wa_id=last_msg.wa_id ORDER BY last_msg.created_at DESC LIMIT 500`);
   if(rows.length) return res.json(rows);
  }
 }catch(e){console.log(e.message);}
 res.json([]);
});
app.get('/api/messages/:wa_id',async(req,res)=>{
 try{ if(pool){ const {rows}=await pool.query(`SELECT wa_id, text, type, direction, source, template_name, status, created_at FROM messages WHERE wa_id=$1 ORDER BY created_at ASC LIMIT 2000`,[req.params.wa_id]); if(rows.length) return res.json(rows); } }catch{}
 res.json(memMessages.filter(m=>m.wa_id===req.params.wa_id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)));
});
app.post('/api/send',async(req,res)=>{
 const {to,message}=req.body;
 try{ const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})}); const j=await r.json(); if(j.messages) saveHistory({wa_id:to,text:message,type:'text',direction:'out',source:'inbox',created_at:new Date(),status:'sent'}); res.json({ok:!!j.messages,data:j}); }catch(e){res.json({ok:false});}
});
app.get('/api/campaigns',async(_,res)=>{ try{if(pool){const {rows}=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`); if(rows.length) return res.json(rows);}}catch{} res.json(memCampaigns); });
app.post('/api/campaigns/send-bulk',async(req,res)=>{
 const {numbers,templateName}=req.body; if(!templateName) return res.json({ok:false});
 const tpl=cacheTemplates.find(t=>t.name===templateName); const lang=tpl?.language||'es_CO'; const id=Date.now().toString();
 const camp={id,name:templateName,total:numbers.length,sent:0,failed:0,status:'enviando',created_at:new Date().toISOString()}; memCampaigns.unshift(camp);
 if(pool) await pool.query(`INSERT INTO campaigns(id,name,total,sent,status) VALUES($1,$2,$3,0,$4)`,[id,templateName,numbers.length,'enviando']).catch(()=>{});
 (async()=>{ for(const raw of numbers){ const to=String(raw).replace(/\D/g,''); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:templateName,language:{code:lang}}})}); const j=await r.json(); if(j.messages){camp.sent++; saveHistory({wa_id:to,text:`[Plantilla ${templateName}]`,type:'template',direction:'out',source:'campaign',template_name:templateName,status:'sent',created_at:new Date()});} else camp.failed++; }catch{camp.failed++;} await new Promise(r=>setTimeout(r,600)); } camp.status='completada'; if(pool) pool.query(`UPDATE campaigns SET sent=$1, failed=$2, status='completada' WHERE id=$3`,[camp.sent,camp.failed,id]).catch(()=>{}); })();
 res.json({ok:true});
});
app.use(express.static(publicPath));
app.get('/health',async(_,res)=>res.json({ok:true,waba:WABA_ID||'auto',templates:cacheTemplates.map(t=>t.name),hasDB:!!pool}));
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.listen(process.env.PORT||3000,()=>console.log('🚀 KLIDO LISTO'));
