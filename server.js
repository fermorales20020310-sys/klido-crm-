const express=require('express');
const {Pool}=require('pg');
const axios=require('axios');
const path=require('path');
const xlsx=require('xlsx');
const bcrypt=require('bcryptjs');
const cron=require('node-cron');
const app=express();
app.use(express.json({limit:'10mb'}));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const G='v22.0';
function getAgency(pid){
  try{const m=JSON.parse(process.env.AGENCY_MAP||'{}');if(pid&&m[pid])return m[pid];return process.env.DEFAULT_AGENCY||'acol';}
  catch{return process.env.DEFAULT_AGENCY||'acol';}
}
async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS conversations(wa_id TEXT,agency_id TEXT,name TEXT,last_message TEXT,last_time BIGINT,unread BOOLEAN DEFAULT true,unread_dot TEXT DEFAULT 'transparent',last_type TEXT DEFAULT 'text',tag TEXT DEFAULT 'nuevo',updated_at BIGINT,UNIQUE(wa_id,agency_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY,wa_id TEXT,agency_id TEXT,direction TEXT,text TEXT,media_type TEXT,media_url TEXT,is_campaign BOOLEAN DEFAULT false,timestamp BIGINT,status TEXT DEFAULT 'sent')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY,agency_id TEXT,template TEXT,total INT DEFAULT 0,sent INT DEFAULT 0,status TEXT DEFAULT 'programada',created_at BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaign_queue(id SERIAL PRIMARY KEY,campaign_id INT,agency_id TEXT,wa_id TEXT,template TEXT,status TEXT DEFAULT 'queued',created_at BIGINT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,agency_id TEXT,username TEXT,password_hash TEXT,role TEXT DEFAULT 'jefe',UNIQUE(agency_id,username))`);
  try{
    const adminUser=process.env.ADMIN_USER;
    const adminAgency=process.env.ADMIN_AGENCY||process.env.DEFAULT_AGENCY||'acol';
    let hash=process.env.ADMIN_PASSWORD_HASH;
    const plain=process.env.ADMIN_PASSWORD||process.env.ADMIN_PASS;
    if(adminUser &&!hash && plain) hash=bcrypt.hashSync(plain,8);
    if(adminUser && hash){
      await pool.query(`INSERT INTO users(agency_id,username,password_hash,role) VALUES($1,$2,$3,'jefe') ON CONFLICT(agency_id,username) DO UPDATE SET password_hash=$3`,[adminAgency,adminUser,hash]);
      console.log('admin OK:'+adminUser);
    }
  }catch(e){console.error(e.message);}
  console.log('GOLD ON');
}
init();
app.use(express.static(path.join(__dirname,'public')));
app.get('/webhook',(req,res)=>{if(req.query['hub.verify_token']===process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);res.sendStatus(403);});
app.post('/webhook',async(req,res)=>{
  try{
    const v=req.body.entry?.[0]?.changes?.[0]?.value;const m=v?.messages?.[0];const ag=getAgency(v?.metadata?.phone_number_id);
    if(m){
      const wa=m.from;const nm=v.contacts?.[0]?.profile?.name||wa;
      let tx='',mt='text',mid=null;const isc=!!m.context;
      if(m.type==='text') tx=m.text.body;
      else if(m.image){tx='📷 Imagen';mt='image';mid=m.image.id;}
      else if(m.audio){tx='🎤 Audio';mt='audio';mid=m.audio.id;}
      else if(m.video){tx='🎥 Video';mt='video';mid=m.video.id;}
      else if(m.document){tx='📄 Documento';mt='document';mid=m.document.id;}
      else tx='['+m.type+']';
      const now=Date.now();const dot=isc?'yellow':'red';
      await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,last_type,updated_at) VALUES($1,$2,$3,$4,$5,true,$6,$7,$5) ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=$4,last_time=$5,unread=true,unread_dot=$6,last_type=$7,updated_at=$5,name=$3`,[wa,ag,nm,tx,now,dot,mt]);
      await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,media_type,media_url,is_campaign,timestamp) VALUES($1,$2,'in',$3,$4,$5,$6,$7)`,[wa,ag,tx,mt,mid,isc,now]);
    }
  }catch(e){console.error(e.message);}
  res.sendStatus(200);
});
app.get('/api/media',async(req,res)=>{
  try{
    const mid=(req.query.mid||'').trim();if(!mid) return res.sendStatus(400);
    const meta=await axios.get(`https://graph.facebook.com/${G}/${mid}`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    const r=await axios.get(meta.data.url,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`},responseType:'stream'});
    res.setHeader('Content-Type',r.headers['content-type']||'application/octet-stream');r.data.pipe(res);
  }catch(e){res.sendStatus(500);}
});
app.post('/api/login',async(req,res)=>{
  const {agency_id,username,password}=req.body;
  const r=await pool.query(`SELECT * FROM users WHERE agency_id=$1 AND username=$2`,[agency_id,username]);
  if(!r.rows.length) return res.status(401).json({error:'no_user'});
  const ok=bcrypt.compareSync(password,r.rows[0].password_hash)||password===(process.env.ADMIN_PASSWORD||'');
  if(!ok) return res.status(401).json({error:'bad_pass'});
  res.json({ok:true});
});
app.get('/api/chats',async(req,res)=>{
  const r=await pool.query(`SELECT wa_id,name,last_message as "lastMessage",unread_dot as dot,last_type,tag FROM conversations WHERE agency_id=$1 ORDER BY last_time DESC LIMIT 300`,[req.query.agency_id]);
  res.json(r.rows);
});
app.get('/api/messages/:wa',async(req,res)=>{
  const r=await pool.query(`SELECT text,direction,timestamp,media_type,media_url,is_campaign FROM messages WHERE wa_id=$1 AND agency_id=$2 ORDER BY timestamp ASC LIMIT 1000`,[req.params.wa,req.query.agency_id]);
  res.json(r.rows);
});
app.post('/api/messages/send',async(req,res)=>{
  const {wa_id,text,agency_id}=req.body;let pid=process.env.PHONE_NUMBER_ID;
  await axios.post(`https://graph.facebook.com/${G}/${pid}/messages`,{messaging_product:'whatsapp',to:wa_id,type:'text',text:{body:text}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
  const now=Date.now();
  await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,timestamp) VALUES($1,$2,'out',$3,$4)`,[wa_id,agency_id,text,now]);
  await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,updated_at) VALUES($1,$2,$1,$3,$4,false,'transparent',$4) ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=$3,last_time=$4`,[wa_id,agency_id,text,now]);
  res.json({ok:true});
});
app.post('/api/chats/:wa/read',async(req,res)=>{
  await pool.query(`UPDATE conversations SET unread=false,unread_dot='transparent' WHERE wa_id=$1 AND agency_id=$2`,[req.params.wa,req.query.agency_id]);
  res.json({ok:true});
});
app.post('/api/chats/:wa/tag',async(req,res)=>{
  await pool.query(`UPDATE conversations SET tag=$1 WHERE wa_id=$2 AND agency_id=$3`,[req.body.tag,req.params.wa,req.body.agency_id]);
  res.json({ok:true});
});
app.get('/api/templates',async(req,res)=>{
  try{
    const r=await axios.get(`https://graph.facebook.com/${G}/${process.env.WABA_ID}/message_templates?fields=name,status`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    res.json(r.data.data.filter(t=>t.status==='APPROVED'));
  }catch(e){res.json([]);}
});
app.post('/api/campaigns/upload',async(req,res)=>{
  try{
    const {agency_id,template,fileBase64}=req.body;const ag=agency_id||'acol';
    const buf=Buffer.from(fileBase64.split(',').pop(),'base64');
    const wb=xlsx.read(buf,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=xlsx.utils.sheet_to_json(ws,{header:1});
    let phones=[];rows.flat().forEach(c=>{let s=String(c||'').replace(/\D/g,'');if(s.length>=10)phones.push(s);});
    phones=[...new Set(phones)];const now=Date.now();
    const cr=await pool.query(`INSERT INTO campaigns(agency_id,template,total,sent,status,created_at) VALUES($1,$2,$3,0,'enviando',$4) RETURNING id`,[ag,template,phones.length,now]);
    for(let p of phones){await pool.query(`INSERT INTO campaign_queue(campaign_id,agency_id,wa_id,template,status,created_at) VALUES($1,$2,$3,$4,'queued',$5)`,[cr.rows[0].id,ag,p,template,now]);}
    res.json({ok:true,total:phones.length});
  }catch(e){console.error(e);res.status(500).json({error:'excel_error'});}
});
app.get('/api/campaigns',async(req,res)=>{
  const r=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY created_at DESC LIMIT 50`,[req.query.agency_id]);res.json(r.rows);
});
cron.schedule('0 */6 * * *',async()=>{
  const q=await pool.query(`SELECT * FROM campaign_queue WHERE status='queued' ORDER BY id ASC LIMIT 50`);
  for(let row of q.rows){
    try{
      await axios.post(`https://graph.facebook.com/${G}/${process.env.PHONE_NUMBER_ID}/messages`,{messaging_product:'whatsapp',to:row.wa_id,type:'template',template:{name:row.template,language:{code:'es'}}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
      await pool.query(`UPDATE campaign_queue SET status='sent' WHERE id=$1`,[row.id]);
      await pool.query(`UPDATE campaigns SET sent=sent+1 WHERE id=$1`,[row.campaign_id]);
    }catch(e){await pool.query(`UPDATE campaign_queue SET status='error' WHERE id=$1`,[row.id]);}
  }
});
app.listen(process.env.PORT||3000,()=>console.log('GOLD ON'));
