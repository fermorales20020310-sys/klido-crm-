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
// Acepta WABA_ID de varias formas como lo tengas registrado
const WABA_ID=(process.env.WABA_ID||process.env.WHATSAPP_BUSINESS_ID||process.env.WHATSAPP_BUSINESS_ACCOUNT_ID||'').trim();
const META_TOKEN=process.env.WHATSAPP_TOKEN;
const PHONE_ID=process.env.PHONE_NUMBER_ID;

console.log('=== KLIDO 100% META API + HISTORIAL ===');
console.log('VERIFY:',VERIFY_TOKEN,'PHONE:',PHONE_ID,'WABA:',WABA_ID||'NO REGISTRADO','TOKEN:',!!META_TOKEN);

let memMessages=[], memContacts={}, memCampaigns=[], cacheTemplates=[];
let pool=null;

// HISTORIAL PERMANENTE - Postgres Railway si existe
try{
 if(process.env.DATABASE_URL){
  const {Pool}=require('pg');
  pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  (async()=>{
   await pool.query(`CREATE TABLE IF NOT EXISTS contacts(wa_id TEXT PRIMARY KEY, name TEXT, avatar TEXT, last_msg TEXT, updated_at TIMESTAMP DEFAULT NOW())`);
   await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, file_url TEXT, type TEXT, direction TEXT, source TEXT DEFAULT 'inbox', template_name TEXT, status TEXT DEFAULT 'sent', created_at TIMESTAMP DEFAULT NOW())`);
   await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, name TEXT, total INT, sent INT DEFAULT 0, delivered INT DEFAULT 0, read INT DEFAULT 0, failed INT DEFAULT 0, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
   console.log('✅ HISTORIAL DB ACTIVO - mensajes no se borran');
   const {rows}=await pool.query(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 1000`);
   if(rows.length){ memMessages=rows; console.log(`✅ Cargados ${rows.length} mensajes del historial`); }
   const c=await pool.query(`SELECT * FROM contacts`);
   c.rows.forEach(r=>memContacts[r.wa_id]=r);
   const camp=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC`);
   if(camp.rows.length) memCampaigns=camp.rows;
  })();
 }else{ console.log('⚠️ Sin DATABASE_URL - historial en memoria (se borra al reiniciar) - agrega Postgres en Railway'); }
}catch(e){ console.log('DB error',e.message); }

// FETCH PLANTILLAS 100% API META
async function fetchMetaTemplates(){
  if(!WABA_ID||!META_TOKEN) return cacheTemplates;
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?fields=name,status,language,category,components&limit=100`,{
      headers:{Authorization:`Bearer ${META_TOKEN}`}
    });
    const j=await r.json();
    if(j.data){
      cacheTemplates=j.data.filter(t=>t.status==='APPROVED').map(t=>{
        const h=t.components.find(c=>c.type==='HEADER');
        const b=t.components.find(c=>c.type==='BODY');
        const btn=t.components.find(c=>c.type==='BUTTONS');
        return {name:t.name,status:t.status,language:t.language,category:t.category,hasImage:h?.format==='IMAGE',bodyText:b?.text||'',buttons:btn?.buttons||[],components:t.components};
      });
    }
    return cacheTemplates;
  }catch(e){ console.log('templates err',e.message); return cacheTemplates; }
}
fetchMetaTemplates();
setInterval(fetchMetaTemplates, 15000);

function saveHistory(msg){
  memMessages.push(msg);
  memContacts[msg.wa_id]={wa_id:msg.wa_id,name:memContacts[msg.wa_id]?.name||msg.wa_id,last_msg:msg.text,updated_at:new Date()};
  if(pool){
    pool.query(`INSERT INTO contacts(wa_id,name,last_msg,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(wa_id) DO UPDATE SET last_msg=$3, updated_at=NOW()`,[msg.wa_id,memContacts[msg.wa_id].name,msg.text]).catch(()=>{});
    pool.query(`INSERT INTO messages(wa_id,text,file_url,type,direction,source,template_name,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[msg.wa_id,msg.text,msg.file_url||null,msg.type,msg.direction,msg.source,msg.template_name||null,msg.status||'sent']).catch(()=>{});
  }
}

// LOGIN
app.post('/api/login',(req,res)=>{
  const e=(process.env.ADMIN_EMAIL||'fermorales20020310@gmail.com').toLowerCase();
  const p=process.env.ADMIN_PASS||'Mafe2002@';
  if((req.body.email||'').toLowerCase()===e && (req.body.password||'')===p) return res.json({ok:true});
  res.json({ok:false});
});

// WEBHOOK
app.get('/webhook',(req,res)=>{
  if(req.query['hub.mode']==='subscribe' && (req.query['hub.verify_token']||'').trim()===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook',async(req,res)=>{
  const value=req.body.entry?.[0]?.changes?.[0]?.value;
  if(!value) return res.sendStatus(200);
  if(value.statuses){
    const st=value.statuses[0];
    console.log(`📊 HISTORIAL STATUS API: ${st.recipient_id} -> ${st.status}`);
    memCampaigns.forEach(c=>{ if(st.status==='sent') c.sent++; if(st.status==='delivered') c.delivered++; if(st.status==='read') c.read++; if(st.status==='failed') c.failed++; });
    if(pool) try{ await pool.query(`UPDATE messages SET status=$1 WHERE wa_id=$2 ORDER BY created_at DESC LIMIT 1`,[st.status,st.recipient_id]); }catch{}
    if(pool) try{ await pool.query(`UPDATE campaigns SET sent=sent+1 WHERE id IN (SELECT id FROM campaigns ORDER BY created_at DESC LIMIT 1)`); }catch{}
  }
  if(value.messages){
    const m=value.messages[0];
    const contact=value.contacts?.[0];
    const wa_id=m.from;
    const name=contact?.profile?.name||wa_id;
    let txt=m.type==='text'?m.text.body:`[${m.type}]`;
    const obj={wa_id,text:txt,type:m.type,direction:'in',source:'inbox',created_at:new Date(),status:'delivered'};
    memContacts[wa_id]={wa_id,name};
    saveHistory(obj);
    console.log(`💬 HISTORIAL GUARDADO: ${wa_id} ${txt}`);
  }
  res.sendStatus(200);
});

// API TEMPLATES TIEMPO REAL 100% META
app.get('/api/templates', async(_,res)=>{ const d=await fetchMetaTemplates(); res.json(d.length?d:[{name:'alion_co',status:'APPROVED',language:'es',hasImage:true,bodyText:'Hola {{1}}'}]); });
app.get('/api/templates/stream',(req,res)=>{
  res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive');
  const iv=setInterval(async()=>{ const data=await fetchMetaTemplates(); res.write(`data: ${JSON.stringify(data)}\n\n`); },3000);
  req.on('close',()=>clearInterval(iv));
});

// API HISTORIAL MENSAJES - 100% con historial
app.get('/api/chats',async(_,res)=>{
  if(pool){ try{ const {rows}=await pool.query(`SELECT m.wa_id,m.text,m.created_at,m.source,m.status,c.name FROM (SELECT DISTINCT ON (wa_id) wa_id,text,created_at,source,status FROM messages ORDER BY wa_id,created_at DESC) m LEFT JOIN contacts c ON c.wa_id=m.wa_id ORDER BY m.created_at DESC LIMIT 200`); if(rows.length) return res.json(rows); }catch(e){ console.log('chats err',e.message); } }
  const map={}; memMessages.forEach(m=>{ if(!map[m.wa_id]||new Date(m.created_at)>new Date(map[m.wa_id].created_at)) map[m.wa_id]={wa_id:m.wa_id,text:m.text,created_at:m.created_at,source:m.source,status:m.status,name:memContacts[m.wa_id]?.name||m.wa_id}; });
  res.json(Object.values(map).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
});

app.get('/api/messages/:wa_id',async(req,res)=>{
  const id=req.params.wa_id;
  if(pool){ try{ const {rows}=await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC LIMIT 500`,[id]); if(rows.length) return res.json(rows); }catch{} }
  res.json(memMessages.filter(m=>m.wa_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)));
});

// BUSCADOR HISTORIAL
app.get('/api/history/search',(req,res)=>{
  const q=(req.query.q||'').toLowerCase();
  if(!q) return res.json([]);
  const filtered=memMessages.filter(m=>m.text.toLowerCase().includes(q)||m.wa_id.includes(q)).slice(-100);
  res.json(filtered);
});

// BANDEJA ENVIO 100% API META
app.post('/api/send',async(req,res)=>{
  const {to,message}=req.body;
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{
      method:'POST', headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})
    });
    const j=await r.json();
    const obj={wa_id:to,text:message,type:'text',direction:'out',source:'inbox',created_at:new Date(),status:j.messages?'sent':'failed'};
    saveHistory(obj);
    res.json({ok:!!j.messages,data:j});
  }catch(e){ res.json({ok:false,error:e.message}); }
});

// CAMPAÑAS 100% API META + HISTORIAL
app.get('/api/campaigns',(_,res)=>res.json(memCampaigns));
app.get('/api/campaigns/stream',(req,res)=>{
  res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive');
  const iv=setInterval(()=>res.write(`data: ${JSON.stringify(memCampaigns)}\n\n`),2000);
  req.on('close',()=>clearInterval(iv));
});

app.post('/api/campaigns/send-bulk',async(req,res)=>{
  const {numbers,templateName}=req.body;
  const tplName=templateName||'alion_co';
  const id=Date.now().toString();
  const camp={id,name:tplName,total:numbers.length,sent:0,delivered:0,read:0,failed:0,status:'enviando API META',created_at:new Date().toISOString()};
  memCampaigns.unshift(camp);
  if(pool) try{ await pool.query(`INSERT INTO campaigns(id,name,total,sent,status) VALUES($1,$2,$3,0,$4)`,[id,tplName,numbers.length,'enviando']); }catch{}

  (async()=>{
    for(const raw of numbers){
      const to=String(raw).replace(/\D/g,'');
      try{
        const payload={messaging_product:'whatsapp',to,type:'template',template:{name:tplName,language:{code:'es'}}};
        const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const j=await r.json();
        if(j.messages){ camp.sent++; saveHistory({wa_id:to,text:`[Plantilla ${tplName}]`,type:'template',direction:'out',source:'campaign',template_name:tplName,status:'sent',created_at:new Date()}); }
        else camp.failed++;
      }catch{ camp.failed++; }
      await new Promise(r=>setTimeout(r,400));
    }
    camp.status='completada'; if(pool) try{ await pool.query(`UPDATE campaigns SET status='completada', sent=$1 WHERE id=$2`,[camp.sent,id]); }catch{}
  })();
  res.json({ok:true,id,total:numbers.length,template:tplName});
});

app.use(express.static(publicPath));
app.get('/health',(req,res)=>res.json({ok:true,api:'100% META + HISTORIAL',verify:VERIFY_TOKEN,hasToken:!!META_TOKEN,hasWaba:!!WABA_ID,waba:WABA_ID,templates:cacheTemplates.map(t=>t.name),messages:memMessages.length,chats:Object.keys(memContacts).length,campaigns:memCampaigns.length,hasDB:!!pool}));
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.listen(process.env.PORT||3000,()=>console.log(`🚀 KLIDO 100% META API + HISTORIAL LISTO - ${VERIFY_TOKEN}`));
