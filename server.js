const express=require('express');
const fs=require('fs');
const path=require('path');
const app=express();
app.use(express.json({limit:'50mb'}));
app.use(require('cors')());
const publicPath=path.join(__dirname,'public');
if(!fs.existsSync(path.join(publicPath,'uploads'))) fs.mkdirSync(path.join(publicPath,'uploads'),{recursive:true});
app.use('/uploads',express.static(path.join(publicPath,'uploads')));

const VERIFY_TOKEN=(process.env.VERIFY_TOKEN||'klido123').trim();
let WABA_ID=(process.env.WABA_ID||'').trim();
if(WABA_ID.startsWith('EAAT')||WABA_ID.length>50) WABA_ID='';
const META_TOKEN=(process.env.WHATSAPP_TOKEN||'').trim();
const PHONE_ID=(process.env.PHONE_NUMBER_ID||'').trim();

let memMessages=[], memContacts={}, memCampaigns=[], cacheTemplates=[], pool=null;

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
  console.log(`✅ HISTORIAL ${memMessages.length}`);
 }catch(e){console.log(e.message);}
}
initDB();

async function discoverWABA(){
 if(WABA_ID && /^\d{10,20}$/.test(WABA_ID)) return WABA_ID;
 if(!META_TOKEN) return null;
 try{const r=await fetch(`https://graph.facebook.com/v20.0/me/whatsapp_business_accounts?fields=id`,{headers:{Authorization:`Bearer ${META_TOKEN}`}}); const j=await r.json(); if(j.data?.[0]?.id){WABA_ID=j.data[0].id; return WABA_ID;}}catch{}
 return WABA_ID;
}
async function fetchMetaTemplates(){
 try{
  let waba=WABA_ID||await discoverWABA();
  if(!waba||!META_TOKEN) return cacheTemplates;
  const r=await fetch(`https://graph.facebook.com/v20.0/${waba}/message_templates?fields=name,status,language,components&limit=100`,{headers:{Authorization:`Bearer ${META_TOKEN}`}});
  const j=await r.json();
  if(j.data){cacheTemplates=j.data.filter(t=>t.status==='APPROVED').map(t=>({name:t.name,language:t.language})); console.log(`✅ PLANTILLAS: ${cacheTemplates.map(t=>t.name).join(', ')}`);}
  return cacheTemplates;
 }catch{return cacheTemplates;}
}
setTimeout(fetchMetaTemplates,2000); setInterval(fetchMetaTemplates,5000);

function saveHistory(m){memMessages.push(m); memContacts[m.wa_id]={wa_id:m.wa_id,name:memContacts[m.wa_id]?.name||m.wa_id,last_msg:m.text,updated_at:new Date()}; if(pool){pool.query(`INSERT INTO contacts(wa_id,name,last_msg,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(wa_id) DO UPDATE SET last_msg=$3, updated_at=NOW()`,[m.wa_id,m.wa_id,m.text]).catch(()=>{}); pool.query(`INSERT INTO messages(wa_id,text,type,direction,source,template_name,status) VALUES($1,$2,$3,$4,$5,$6,$7)`,[m.wa_id,m.text,m.type,m.direction,m.source,m.template_name||null,m.status||'sent']).catch(()=>{});} }

app.get('/webhook',(req,res)=>{if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']); res.sendStatus(403);});
app.post('/webhook',async(req,res)=>{
 const v=req.body.entry?.[0]?.changes?.[0]?.value; if(!v) return res.sendStatus(200);
 if(v.statuses){const st=v.statuses[0]; if(memCampaigns[0]){const c=memCampaigns[0]; if(st.status==='sent')c.sent++; if(st.status==='delivered')c.delivered++; if(st.status==='read')c.read++; if(st.status==='failed')c.failed++;}}
 if(v.messages){const m=v.messages[0]; saveHistory({wa_id:m.from,text:m.type==='text'?m.text.body:`[${m.type}]`,type:m.type,direction:'in',source:'inbox',created_at:new Date(),status:'delivered'});}
 res.sendStatus(200);
});

app.get('/api/templates',async(_,res)=>res.json(await fetchMetaTemplates()));
app.get('/api/chats',async(_,res)=>{
 try{if(pool){const {rows}=await pool.query(`SELECT last_msg.wa_id, last_msg.text, last_msg.created_at, last_msg.source, last_msg.direction, last_msg.template_name, c.name, CASE WHEN last_msg.direction='in' THEN true ELSE false END as unanswered FROM (SELECT DISTINCT ON (wa_id) wa_id, text, created_at, source, direction, template_name FROM messages ORDER BY wa_id, created_at DESC) last_msg LEFT JOIN contacts c ON c.wa_id=last_msg.wa_id ORDER BY last_msg.created_at DESC LIMIT 500`); if(rows.length) return res.json(rows);}}catch(e){}
 res.json([]);
});
app.get('/api/messages/:wa_id',async(req,res)=>{
 try{if(pool){const {rows}=await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC LIMIT 2000`,[req.params.wa_id]); if(rows.length) return res.json(rows);}}catch{}
 res.json(memMessages.filter(m=>m.wa_id===req.params.wa_id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)));
});
app.post('/api/send',async(req,res)=>{
 const {to,message}=req.body;
 try{const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})}); const j=await r.json(); if(j.messages) saveHistory({wa_id:to,text:message,type:'text',direction:'out',source:'inbox',created_at:new Date(),status:'sent'}); res.json({ok:!!j.messages});}catch{res.json({ok:false});}
});
app.get('/api/campaigns',async(_,res)=>{try{if(pool){const {rows}=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 100`); if(rows.length) return res.json(rows);}}catch{} res.json(memCampaigns);});
app.post('/api/campaigns/send-bulk',async(req,res)=>{
 const {numbers,templateName}=req.body; const tpl=cacheTemplates.find(t=>t.name===templateName); const lang=tpl?.language||'es_CO'; const id=Date.now().toString();
 const camp={id,name:templateName,total:numbers.length,sent:0,failed:0,status:'enviando',created_at:new Date().toISOString()}; memCampaigns.unshift(camp);
 if(pool) await pool.query(`INSERT INTO campaigns(id,name,total,sent,status) VALUES($1,$2,$3,0,$4)`,[id,templateName,numbers.length,'enviando']).catch(()=>{});
 (async()=>{for(const raw of numbers){const to=String(raw).replace(/\D/g,''); try{const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:templateName,language:{code:lang}}})}); const j=await r.json(); if(j.messages){camp.sent++; saveHistory({wa_id:to,text:`[Plantilla ${templateName}]`,type:'template',direction:'out',source:'campaign',template_name:templateName,status:'sent',created_at:new Date()});} else camp.failed++;}catch{camp.failed++;} await new Promise(r=>setTimeout(r,600));} camp.status='completada';})();
 res.json({ok:true});
});
app.use(express.static(publicPath));
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.listen(process.env.PORT||3000,()=>console.log('🚀 LISTO'));
