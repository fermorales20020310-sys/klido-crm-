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
const TOKEN=process.env.WHATSAPP_TOKEN;
const PHONE_ID=process.env.PHONE_NUMBER_ID;

console.log('=== KLIDO CRM PRO v2 ===');
console.log('Files:', fs.readdirSync(publicPath));
console.log('VERIFY_TOKEN esperado:', VERIFY_TOKEN);
console.log('HAS_TOKEN:',!!TOKEN, 'HAS_PHONE:',!!PHONE_ID);
console.log('ADMIN:', process.env.ADMIN_EMAIL);

let memMessages=[];
let memContacts={};
let pool=null;
try{
 if(process.env.DATABASE_URL){
  const {Pool}=require('pg');
  pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  (async()=>{
   try{
    await pool.query(`CREATE TABLE IF NOT EXISTS contacts(wa_id TEXT PRIMARY KEY, name TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, file_url TEXT, type TEXT, direction TEXT, source TEXT DEFAULT 'inbox', created_at TIMESTAMP DEFAULT NOW())`);
    console.log('✅ DB OK');
    const {rows}=await pool.query(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 300`);
    if(rows.length) memMessages=rows;
   }catch(e){console.log('DB error',e.message);}
  })();
 }
}catch{}

async function dl(id,name){
 try{
  if(!TOKEN) return null;
  const r1=await fetch(`https://graph.facebook.com/v20.0/${id}`,{headers:{Authorization:`Bearer ${TOKEN}`}});
  const j=await r1.json(); if(!j.url) return null;
  const r2=await fetch(j.url,{headers:{Authorization:`Bearer ${TOKEN}`}});
  const b=Buffer.from(await r2.arrayBuffer());
  fs.writeFileSync(path.join(uploadDir,name),b);
  return `/uploads/${name}`;
 }catch{return null;}
}

app.post('/api/login',(req,res)=>{
 const email=(req.body.email||'').trim().toLowerCase();
 const pass=(req.body.password||'').trim();
 const validE=(process.env.ADMIN_EMAIL||'fermorales20020310@gmail.com').toLowerCase();
 const validP=process.env.ADMIN_PASS||'Mafe2002@';
 if(email===validE && pass===validP) return res.json({ok:true});
 res.json({ok:false});
});

// WEBHOOK VERIFY - ESTO ES LO QUE TE FALTA
app.get('/webhook',(req,res)=>{
 console.log('--- INTENTO VERIFY ---', req.query);
 const mode=req.query['hub.mode'];
 const token=(req.query['hub.verify_token']||'').trim();
 const challenge=req.query['hub.challenge'];
 if(mode==='subscribe' && token===VERIFY_TOKEN){
  console.log('✅ VERIFY OK - devolviendo challenge');
  return res.status(200).send(challenge);
 }
 console.log(`❌ VERIFY FAIL: recibido "${token}" esperado "${VERIFY_TOKEN}"`);
 res.sendStatus(403);
});

app.post('/webhook',async(req,res)=>{
 console.log('=== MENSAJE LLEGO ===', JSON.stringify(req.body).slice(0,800));
 try{
  const val=req.body.entry?.[0]?.changes?.[0]?.value;
  if(!val?.messages) return res.sendStatus(200);
  const m=val.messages[0];
  const contact=val.contacts?.[0];
  const wa_id=m.from;
  const name=contact?.profile?.name||wa_id;
  let txt='',url=null;
  if(m.type==='text') txt=m.text.body;
  else if(m.type==='image'){ url=await dl(m.image.id,`${m.id}.jpg`); txt=m.image.caption||'📷 Imagen'; }
  else if(m.type==='document'){ url=await dl(m.document.id, m.document.filename||`${m.id}.pdf`); txt=`📄 ${m.document.filename}`; }
  else if(m.type==='audio'){ url=await dl(m.audio.id,`${m.id}.ogg`); txt='🎤 Audio'; }
  else if(m.type==='video'){ url=await dl(m.video.id,`${m.id}.mp4`); txt='🎥 Video'; }
  else txt=`[${m.type}]`;
  console.log(`💬 ${wa_id} (${name}): ${txt}`);
  memContacts[wa_id]={wa_id,name};
  const obj={wa_id,text:txt,file_url:url,type:m.type||'text',direction:'in',source:'inbox',created_at:new Date()};
  memMessages.push(obj);
  if(pool) try{ await pool.query(`INSERT INTO contacts(wa_id,name) VALUES($1,$2) ON CONFLICT(wa_id) DO UPDATE SET name=$2`,[wa_id,name]); await pool.query(`INSERT INTO messages(wa_id,text,file_url,type,direction,source) VALUES($1,$2,$3,$4,'in','inbox')`,[wa_id,txt,url,m.type||'text']); }catch(e){console.log('save err',e.message);}
  res.sendStatus(200);
 }catch(e){console.log('webhook err',e.message); res.sendStatus(200);}
});

app.post('/api/send',async(req,res)=>{
 const {to,message,source}=req.body;
 console.log(`📤 Enviando a ${to}`);
 if(TOKEN&&PHONE_ID){
  try{
   const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})});
   console.log('Meta send:', await r.text().then(t=>t.slice(0,300)));
  }catch(e){console.log('send err',e.message);}
 }
 memMessages.push({wa_id:to,text:message,direction:'out',type:'text',source:source||'inbox',created_at:new Date()});
 if(pool) try{ await pool.query(`INSERT INTO messages(wa_id,text,direction,type,source) VALUES($1,$2,'out','text',$3)`,[to,message,source||'inbox']); }catch{}
 res.json({ok:true});
});

app.get('/api/chats',async(_,res)=>{
 if(pool){ try{ const {rows}=await pool.query(`SELECT m.wa_id,m.text,m.created_at,m.source,c.name FROM (SELECT DISTINCT ON (wa_id) wa_id,text,created_at,source FROM messages ORDER BY wa_id,created_at DESC) m LEFT JOIN contacts c ON c.wa_id=m.wa_id ORDER BY m.created_at DESC`); if(rows.length) return res.json(rows);}catch{} }
 const map={}; memMessages.forEach(m=>{ if(!map[m.wa_id] || new Date(m.created_at)>new Date(map[m.wa_id].created_at)) map[m.wa_id]={wa_id:m.wa_id,text:m.text,created_at:m.created_at,source:m.source,name:memContacts[m.wa_id]?.name||m.wa_id}; }); res.json(Object.values(map).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
});
app.get('/api/messages/:wa_id',async(req,res)=>{
 const id=req.params.wa_id;
 if(pool){ try{ const {rows}=await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC`,[id]); if(rows.length) return res.json(rows);}catch{} }
 res.json(memMessages.filter(m=>m.wa_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)));
});
app.get('/api/campaigns',(req,res)=>res.json([{id:1,name:'Campaña Alion 14/09',total:591,sent:591,created_at:new Date().toISOString()},{id:2,name:'Campaña Alion 17/09',total:591,sent:591,created_at:new Date().toISOString()}]));
app.post('/api/campaigns/upload',(req,res)=>res.json({ok:true}));
app.post('/api/campaigns/send-bulk',async(req,res)=>{ let s=0; for(const n of (req.body.numbers||[])){ const c=String(n).replace(/\D/g,''); if(c.length<10)continue; memMessages.push({wa_id:c,text:req.body.message,direction:'out',type:'text',source:'campaign',created_at:new Date()}); s++; } res.json({ok:true,sent:s}); });

function findFile(n){const p=path.join(publicPath,n); return fs.existsSync(p)?p:null;}
app.get('/campaigns',(req,res)=>res.sendFile(findFile('campaigns.html')||findFile('campanas.html')||findFile('index.html')));
app.get('/campaigns.html',(req,res)=>res.sendFile(findFile('campaigns.html')||findFile('campanas.html')||findFile('index.html')));
app.use(express.static(publicPath));
app.get('/health',(req,res)=>res.json({ok:true, files:fs.readdirSync(publicPath), verify:VERIFY_TOKEN, hasToken:!!TOKEN, messages:memMessages.length}));
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.listen(process.env.PORT||3000,()=>console.log(`🚀 LISTO en ${process.env.PORT||3000} - VERIFY=${VERIFY_TOKEN}`));
