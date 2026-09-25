const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

function getAgency(phoneNumberId){
  try{
    const map = JSON.parse(process.env.AGENCY_MAP || '{}');
    if(phoneNumberId && map[phoneNumberId]) return map[phoneNumberId];
    return process.env.DEFAULT_AGENCY || 'tu_empresa';
  }catch{ return process.env.DEFAULT_AGENCY || 'tu_empresa'; }
}

async function initDB(){
  await pool.query(`CREATE TABLE IF NOT EXISTS conversations(
    wa_id TEXT, agency_id TEXT DEFAULT 'tu_empresa',
    name TEXT, last_message TEXT, last_time BIGINT,
    unread BOOLEAN DEFAULT true, unread_dot TEXT DEFAULT 'red',
    last_type TEXT DEFAULT 'text', updated_at BIGINT
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_conv_wa_agency ON conversations(wa_id, agency_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(
    id SERIAL PRIMARY KEY, wa_id TEXT, agency_id TEXT DEFAULT 'tu_empresa',
    direction TEXT, text TEXT, media_type TEXT, media_url TEXT,
    is_campaign BOOLEAN DEFAULT false, timestamp BIGINT, status TEXT DEFAULT 'sent'
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_wa_agency ON messages(wa_id, agency_id, timestamp)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(
    id SERIAL PRIMARY KEY, agency_id TEXT, template TEXT, total INT DEFAULT 0,
    sent INT DEFAULT 0, status TEXT DEFAULT 'programada', created_at BIGINT
  )`);
  console.log('KLIDO GOLD DB ready');
}
initDB();

app.use(express.static(path.join(__dirname,'public')));

app.get('/webhook',(req,res)=>{
  if(req.query['hub.verify_token']===process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook', async (req,res)=>{
  try{
    const change = req.body.entry?.[0]?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];
    const phoneNumberId = value?.metadata?.phone_number_id;
    const agency_id = getAgency(phoneNumberId);
    if(msg){
      const wa_id = msg.from;
      const name = value.contacts?.[0]?.profile?.name || wa_id;
      let text='', media_type='text', media_id=null, is_campaign=false;
      if(msg.type==='text') text=msg.text.body;
      else if(msg.image){ text='📷 Imagen'; media_type='image'; media_id=msg.image.id; }
      else if(msg.video){ text='🎥 Video'; media_type='video'; media_id=msg.video.id; }
      else if(msg.audio){ text='🎤 Audio'; media_type='audio'; media_id=msg.audio.id; }
      else if(msg.document){ text='📄 Documento'; media_type='document'; media_id=msg.document.id; }
      else text='['+msg.type+']';
      if(msg.context) is_campaign = true;
      let media_url = media_id? media_id : null;
      const now=Date.now();
      const dot = is_campaign? 'yellow' : 'red';
      await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,last_type,updated_at)
        VALUES($1,$2,$3,$4,$5,true,$7,$6,$5)
        ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=EXCLUDED.last_message,last_time=EXCLUDED.last_time,unread=true,unread_dot=$7,last_type=EXCLUDED.last_type,updated_at=EXCLUDED.updated_at,name=EXCLUDED.name`,
        [wa_id,agency_id,name,text,now,media_type,dot]);
      await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,media_type,media_url,is_campaign,timestamp) VALUES($1,$2,'in',$3,$4,$5,$6,$7)`,
        [wa_id,agency_id,text,media_type,media_url,is_campaign,now]);
    }
    const status = value?.statuses?.[0];
    if(status){
      await pool.query(`UPDATE messages SET status=$1 WHERE id = (SELECT id FROM messages WHERE wa_id=$2 ORDER BY id DESC LIMIT 1)`,[status.status, status.recipient_id]);
    }
  }catch(e){ console.error('webhook err',e.message); }
  res.sendStatus(200);
});

app.get('/api/media', async (req,res)=>{
  try{
    const mid = req.query.mid || req.query.url;
    if(!mid) return res.sendStatus(400);
    let fileUrl = mid;
    if(!mid.startsWith('http')){
      const meta = await axios.get(`https://graph.facebook.com/v21.0/${mid}`,{
        headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}
      });
      fileUrl = meta.data.url;
    }
    const r = await axios.get(fileUrl, {
      headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`},
      responseType:'stream'
    });
    res.setHeader('Content-Type', r.headers['content-type'] || 'audio/ogg');
    r.data.pipe(res);
  }catch(e){ console.error('media proxy err', e.message); res.sendStatus(500); }
});

app.get('/api/chats', async (req,res)=>{
  const agency_id = req.query.agency_id || 'tu_empresa';
  const r = await pool.query(`SELECT wa_id as "wa_id", name, last_message as "lastMessage", unread, unread_dot as dot, last_type FROM conversations WHERE agency_id=$1 ORDER BY last_time DESC LIMIT 200`,[agency_id]);
  res.json(r.rows);
});

app.get('/api/messages/:wa', async (req,res)=>{
  const agency_id = req.query.agency_id || 'tu_empresa';
  const r = await pool.query(`SELECT text, direction, timestamp, media_type, media_url, status, is_campaign FROM messages WHERE wa_id=$1 AND agency_id=$2 ORDER BY timestamp ASC LIMIT 500`,[req.params.wa, agency_id]);
  res.json(r.rows);
});

app.post('/api/messages/send', async (req,res)=>{
  const {wa_id, text, agency_id} = req.body;
  const ag = agency_id || 'tu_empresa';
  let phoneId = process.env.PHONE_NUMBER_ID;
  try{ const map = JSON.parse(process.env.AGENCY_MAP || '{}'); for(let k in map){ if(map[k]===ag) phoneId=k; } }catch{}
  try{
    await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`,{
      messaging_product:'whatsapp', to:wa_id, type:'text', text:{body:text}
    },{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    const now=Date.now();
    await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,timestamp,status) VALUES($1,$2,'out',$3,$4,'sent')`,[wa_id,ag,text,now]);
    await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,updated_at)
      VALUES($1,$2,$1,$3,$4,false,$4) ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=EXCLUDED.last_message,last_time=EXCLUDED.last_time,updated_at=EXCLUDED.updated_at`,
      [wa_id,ag,text,now]);
    res.json({ok:true});
  }catch(e){ console.error(e.response?.data||e.message); res.status(500).json({error:'send failed'}); }
});

app.post('/api/campaigns', async (req,res)=>{
  const {agency_id, template, phones} = req.body;
  const ag = agency_id || 'tu_empresa';
  const list = Array.isArray(phones)? phones : [];
  const now = Date.now();
  const r = await pool.query(`INSERT INTO campaigns(agency_id,template,total,sent,status,created_at) VALUES($1,$2,$3,0,'programada',$4) RETURNING id`,[ag,template||'hello_world',list.length,now]);
  const campId = r.rows[0].id;
  for(let p of list.slice(0,2000)){
    await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,media_type,is_campaign,timestamp,status) VALUES($1,$2,'out',$3,'text',true,$4,'queued')`,[String(p),ag,`CAMPAIGN:${campId}:${template}`,now]);
  }
  res.json({ok:true, id:campId, total:list.length});
});

app.get('/api/campaigns', async (req,res)=>{
  const agency_id = req.query.agency_id || 'tu_empresa';
  const r = await pool.query(`SELECT id, agency_id, template, total, sent, status, created_at FROM campaigns WHERE agency_id=$1 ORDER BY created_at DESC LIMIT 100`,[agency_id]);
  res.json(r.rows);
});

app.post('/api/chats/:wa/read', async (req,res)=>{
  const agency_id = req.query.agency_id || req.body.agency_id || 'tu_empresa';
  await pool.query(`UPDATE conversations SET unread=false, unread_dot='transparent' WHERE wa_id=$1 AND agency_id=$2`,[req.params.wa, agency_id]);
  res.json({ok:true});
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('KLIDO GOLD ON '+PORT));
