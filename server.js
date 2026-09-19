const express=require('express');
const fs=require('fs');
const path=require('path');
const cors=require('cors');
const app=express();
app.use(cors());
app.use(express.json({limit:'50mb'}));

const publicPath=path.join(__dirname,'public');
const uploadDir=path.join(publicPath,'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
app.use('/uploads',express.static(uploadDir));

console.log('=== KLIDO CRM PRO INICIANDO ===');
console.log('Public files:', fs.existsSync(publicPath)? fs.readdirSync(publicPath) : 'NO PUBLIC');
console.log('ENV check:', {
  VERIFY: process.env.VERIFY_TOKEN,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  HAS_TOKEN:!!process.env.WHATSAPP_TOKEN,
  HAS_PHONE:!!process.env.PHONE_NUMBER_ID,
  HAS_DB:!!process.env.DATABASE_URL
});

// MEMORIA - historial que no se borra aunque falle DB
let memMessages=[
  {wa_id:'573001111111', text:'Hola, necesito info', direction:'in', source:'inbox', type:'text', created_at: new Date(Date.now()-3600000), file_url:null},
];
let memContacts={ '573001111111': {wa_id:'573001111111', name:'Cliente Prueba'} };
let memCampaigns=[
  {id:1, name:'Campaña Alion - 14/09', total:591, sent:591, created_at:'2026-09-14T10:00:00Z'},
  {id:2, name:'Campaña Alion - 17/09', total:591, sent:591, created_at:'2026-09-17T10:00:00Z'},
];

// DB opcional - si existe guarda, si no usa memoria
let pool=null;
try{
  if(process.env.DATABASE_URL){
    const {Pool}=require('pg');
    pool=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
    (async()=>{
      try{
        await pool.query(`CREATE TABLE IF NOT EXISTS contacts(wa_id TEXT PRIMARY KEY, name TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, wa_id TEXT, text TEXT, file_url TEXT, type TEXT, direction TEXT, source TEXT DEFAULT 'inbox', created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, name TEXT, total INT DEFAULT 0, sent INT DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
        try{ await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total INT DEFAULT 0`);}catch{}
        try{ await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sent INT DEFAULT 0`);}catch{}
        try{ await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Campaña'`);}catch{}
        console.log('✅ DB conectada - historial permanente activo');
        const {rows}=await pool.query(`SELECT * FROM messages ORDER BY created_at DESC LIMIT 500`);
        if(rows.length>0){ memMessages=rows; console.log(`✅ Cargados ${rows.length} mensajes de DB`); }
      }catch(e){ console.log('DB init error:', e.message); }
    })();
  }else{ console.log('⚠️ Sin DATABASE_URL - usando memoria (historial se borra al reiniciar Railway)'); }
}catch(e){ console.log('No PG:', e.message); }

const TOKEN=process.env.WHATSAPP_TOKEN;
const PHONE_ID=process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN=process.env.VERIFY_TOKEN || 'klido123';

async function downloadMedia(id, name){
  try{
    if(!TOKEN) return null;
    const r1=await fetch(`https://graph.facebook.com/v20.0/${id}`,{headers:{Authorization:`Bearer ${TOKEN}`}});
    const j=await r1.json(); if(!j.url) return null;
    const r2=await fetch(j.url,{headers:{Authorization:`Bearer ${TOKEN}`}});
    const buf=Buffer.from(await r2.arrayBuffer());
    fs.writeFileSync(path.join(uploadDir,name),buf);
    return `/uploads/${name}`;
  }catch{ return null; }
}

// LOGIN - con tu correo fermorales20020310@gmail.com
app.post('/api/login',(req,res)=>{
  const email=(req.body.email||'').trim().toLowerCase();
  const password=(req.body.password||'').trim();
  const validEmail=(process.env.ADMIN_EMAIL||'fermorales20020310@gmail.com').toLowerCase();
  const validPass=process.env.ADMIN_PASS||'Mafe2002@';
  console.log(`Login intento: ${email} / ${password===validPass?'OK':'FAIL'}`);
  if(email===validEmail && password===validPass){
    return res.json({ok:true, user: email});
  }
  res.json({ok:false, msg:'Correo o clave incorrecta'});
});

// WEBHOOK VERIFY - ESTO HACE QUE META TE ACEPTE
app.get('/webhook',(req,res)=>{
  const mode=req.query['hub.mode'];
  const token=req.query['hub.verify_token'];
  const challenge=req.query['hub.challenge'];
  console.log(`Webhook verify: mode=${mode} token=${token} vs expected=${VERIFY_TOKEN}`);
  if(mode==='subscribe' && token===VERIFY_TOKEN){
    console.log('✅ WEBHOOK VERIFICADO CORRECTAMENTE');
    return res.status(200).send(challenge);
  }
  console.log('❌ VERIFY_TOKEN no coincide');
  res.sendStatus(403);
});

// WEBHOOK RECIBE MENSAJES - AQUI LLEGAN
app.post('/webhook',async(req,res)=>{
  console.log('=== NUEVO WEBHOOK ===');
  try{
    const entry=req.body.entry?.[0];
    const change=entry?.changes?.[0];
    const value=change?.value;
    if(!value?.messages){
      console.log('Es status update, no mensaje:', JSON.stringify(value?.statuses?.[0]||{}).slice(0,200));
      return res.sendStatus(200);
    }
    const m=value.messages[0];
    const contact=value.contacts?.[0];
    const wa_id=m.from;
    const name=contact?.profile?.name||wa_id;

    let txt='', url=null;
    if(m.type==='text') txt=m.text.body;
    else if(m.type==='image'){ url=await downloadMedia(m.image.id, `${m.id}.jpg`); txt=m.image.caption||'📷 Imagen'; }
    else if(m.type==='document'){ url=await downloadMedia(m.document.id, m.document.filename||`${m.id}.pdf`); txt=`📄 ${m.document.filename||'Doc'}`; }
    else if(m.type==='audio'){ url=await downloadMedia(m.audio.id, `${m.id}.ogg`); txt='🎤 Audio'; }
    else if(m.type==='video'){ url=await downloadMedia(m.video.id, `${m.id}.mp4`); txt='🎥 Video'; }
    else if(m.type==='button') txt=m.button.text;
    else txt=`[${m.type}]`;

    console.log(`💬 MENSAJE DE ${wa_id} (${name}): ${txt}`);

    memContacts[wa_id]={wa_id, name};
    const msgObj={wa_id, text:txt, file_url:url, type:m.type||'text', direction:'in', source:'inbox', created_at:new Date()};
    memMessages.push(msgObj);

    if(pool){
      try{
        await pool.query(`INSERT INTO contacts(wa_id,name) VALUES($1,$2) ON CONFLICT(wa_id) DO UPDATE SET name=$2`,[wa_id,name]);
        await pool.query(`INSERT INTO messages(wa_id,text,file_url,type,direction,source) VALUES($1,$2,$3,$4,'in','inbox')`,[wa_id,txt,url,m.type||'text']);
        console.log('✅ Mensaje guardado en DB');
      }catch(e){ console.log('Error DB save:', e.message); }
    }

    res.sendStatus(200);
  }catch(e){
    console.log('Webhook error:', e);
    res.sendStatus(200);
  }
});

// ENVIAR MENSAJE
app.post('/api/send',async(req,res)=>{
  const {to,message,source}=req.body;
  if(!to||!message) return res.json({ok:false});
  console.log(`📤 Enviando a ${to}: ${message.slice(0,80)}`);
  if(TOKEN&&PHONE_ID){
    try{
      const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{
        method:'POST',
        headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},
        body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})
      });
      const j=await r.json();
      console.log('Meta send response:', JSON.stringify(j).slice(0,300));
    }catch(e){ console.log('Error enviando a Meta:', e.message); }
  }else{ console.log('⚠️ No TOKEN/PHONE_ID - solo guarda local'); }
  const obj={wa_id:to,text:message,direction:'out',type:'text',source:source||'inbox',created_at:new Date(),file_url:null};
  memMessages.push(obj);
  if(pool) try{ await pool.query(`INSERT INTO messages(wa_id,text,direction,type,source) VALUES($1,$2,'out','text',$3)`,[to,message,source||'inbox']); }catch{}
  res.json({ok:true});
});

// HISTORIAL CHATS
app.get('/api/chats',async(_,res)=>{
  try{
    if(pool){
      try{
        const {rows}=await pool.query(`SELECT m.wa_id,m.text,m.created_at,m.source,c.name FROM (SELECT DISTINCT ON (wa_id) wa_id,text,created_at,source FROM messages ORDER BY wa_id,created_at DESC) m LEFT JOIN contacts c ON c.wa_id=m.wa_id ORDER BY m.created_at DESC`);
        if(rows.length>0) return res.json(rows);
      }catch{}
    }
    const map={};
    memMessages.forEach(m=>{ if(!map[m.wa_id] || new Date(m.created_at)>new Date(map[m.wa_id].created_at)){ map[m.wa_id]={wa_id:m.wa_id,text:m.text,created_at:m.created_at,source:m.source,name:memContacts[m.wa_id]?.name||m.wa_id}; }});
    const list=Object.values(map).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
    res.json(list);
  }catch{ res.json([]); }
});

app.get('/api/messages/:wa_id',async(req,res)=>{
  const id=req.params.wa_id;
  try{
    if(pool){
      try{
        const {rows}=await pool.query(`SELECT * FROM messages WHERE wa_id=$1 ORDER BY created_at ASC`,[id]);
        if(rows.length>0) return res.json(rows);
      }catch{}
    }
    res.json(memMessages.filter(m=>m.wa_id===id).sort((a,b)=> new Date(a.created_at)-new Date(b.created_at)));
  }catch{ res.json([]); }
});

// CAMPAÑAS
app.get('/api/campaigns',async(_,res)=>{
  if(pool){ try{ const {rows}=await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC`); if(rows.length>0) return res.json(rows); }catch{} }
  res.json(memCampaigns);
});
app.post('/api/campaigns/upload',(req,res)=>res.json({ok:true}));
app.post('/api/campaigns/send-bulk',async(req,res)=>{
  const {numbers,message}=req.body;
  let sent=0;
  for(const raw of (numbers||[])){
    const clean=String(raw).replace(/\D/g,'');
    if(clean.length<10) continue;
    if(TOKEN&&PHONE_ID){
      try{ await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:clean,type:'text',text:{body:message}})}); await new Promise(r=>setTimeout(r,350)); }catch{}
    }
    memMessages.push({wa_id:clean,text:message,direction:'out',type:'text',source:'campaign',created_at:new Date()});
    if(pool) try{ await pool.query(`INSERT INTO messages(wa_id,text,direction,type,source) VALUES($1,$2,'out','text','campaign')`,[clean,message]); }catch{}
    sent++;
  }
  res.json({ok:true,sent});
});

// FRONTEND
function findFile(n){ const p=path.join(publicPath,n); return fs.existsSync(p)?p:null; }
app.get('/campaigns',(req,res)=>{ const f=findFile('campaigns.html')||findFile('campanas.html'); if(f) return res.sendFile(f); res.status(404).send('Falta public/campaigns.html'); });
app.get('/campaigns.html',(req,res)=>{ const f=findFile('campaigns.html')||findFile('campanas.html'); if(f) return res.sendFile(f); res.status(404).send('Falta public/campaigns.html'); });
app.get('/campanas.html',(req,res)=>{ const f=findFile('campanas.html')||findFile('campaigns.html'); if(f) return res.sendFile(f); res.status(404).send('Falta public/campanas.html'); });
app.get('/bandeja',(req,res)=>{ const f=findFile('bandeja.html'); if(f) return res.sendFile(f); res.redirect('/index.html'); });
app.use(express.static(publicPath));
app.get('/health',(req,res)=>res.json({ok:true, files:fs.existsSync(publicPath)?fs.readdirSync(publicPath):[], messages:memMessages.length, verify:VERIFY_TOKEN, hasToken:!!TOKEN, hasPhone:!!PHONE_ID, admin:process.env.ADMIN_EMAIL}));
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 KLIDO CRM PRO LISTO en ${PORT} - ${process.env.ADMIN_EMAIL}`));
