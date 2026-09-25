const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const upload = multer({ dest:'/tmp/' });

// MAPEO MULTI-AGENCIA: phone_number_id -> agency_id
// Agrega en Railway: AGENCY_MAP={"123456":"tu_empresa","789012":"agencia_piloto"}
function getAgency(phoneNumberId){
  try{
    const map = JSON.parse(process.env.AGENCY_MAP || '{}');
    return map[phoneNumberId] || process.env.DEFAULT_AGENCY || 'tu_empresa';
  }catch{ return 'tu_empresa'; }
}

async function downloadMedia(mediaId){
  try{
    const meta = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`,{
      headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}
    });
    return meta.data.url; // URL temporal de Meta
  }catch(e){ console.error('media err',e.message); return null; }
}

async function initDB(){
  const alters = [
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unread BOOLEAN DEFAULT true`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unread_dot TEXT DEFAULT 'red'`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_type TEXT DEFAULT 'text'`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agency_id TEXT DEFAULT 'tu_empresa'`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_campaign BOOLEAN DEFAULT false`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS agency_id TEXT DEFAULT 'tu_empresa'`,
    `ALTER TABLE campaign_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS agency_id TEXT DEFAULT 'tu_empresa'`
  ];
  for(let q of alters){ try{ await pool.query(q); }catch(e){} }

  await pool.query(`CREATE TABLE IF NOT EXISTS conversations(
    wa_id TEXT, agency_id TEXT DEFAULT 'tu_empresa',
    name TEXT, last_message TEXT, last_time BIGINT,
    unread BOOLEAN DEFAULT true, unread_dot TEXT DEFAULT 'red',
    last_type TEXT DEFAULT 'text', updated_at BIGINT,
    PRIMARY KEY (wa_id, agency_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(
    id SERIAL PRIMARY KEY, wa_id TEXT, agency_id TEXT DEFAULT 'tu_empresa',
    direction TEXT, text TEXT, media_type TEXT, media_url TEXT,
    is_campaign BOOLEAN DEFAULT false, timestamp BIGINT, status TEXT DEFAULT 'sent'
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_msg_wa_agency ON messages(wa_id, agency_id, timestamp)`);
  console.log('KLIDO PRO MULTI-AGENCIA DB ready');
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
      let text='', media_type='text', media_id=null;
      if(msg.type==='text') text=msg.text.body;
      else if(msg.image){ text='📷 Imagen'; media_type='image'; media_id=msg.image.id; }
      else if(msg.video){ text='🎥 Video'; media_type='video'; media_id=msg.video.id; }
      else if(msg.audio){ text='🎤 Audio'; media_type='audio'; media_id=msg.audio.id; }
      else if(msg.document){ text='📄 Documento'; media_type='document'; media_id=msg.document.id; }
      else text='['+msg.type+']';

      let media_url = media_id? await downloadMedia(media_id) : null;
      const now=Date.now();

      await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,last_type,updated_at)
        VALUES($1,$2,$3,$4,$5,true,'red',$6,$5)
        ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=$4,last_time=$5,unread=true,unread_dot='red',last_type=$6,updated_at=$5,name=$3`,
        [wa_id,agency_id,name,text,now,media_type]);
      await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,media_type,media_url,timestamp) VALUES($1,$2,'in',$3,$4,$5,$6)`,
        [wa_id,agency_id,text,media_type,media_url,now]);
    }
    const status = value?.statuses?.[0];
    if(status){
      await pool.query(`UPDATE messages SET status=$1 WHERE wa_id=$2 ORDER BY id DESC LIMIT 1`,[status.status, status.recipient_id]);
    }
  }catch(e){ console.error('webhook err',e.message); }
  res.sendStatus(200);
});

// CHATS - filtrado por agencia
app.get('/api/chats', async (req,res)=>{
  const agency_id = req.query.agency_id || 'tu_empresa';
  const r = await pool.query(`SELECT wa_id as "wa_id", name, last_message as "lastMessage", unread, unread_dot as dot, last_type FROM conversations WHERE agency_id=$1 ORDER BY last_time DESC LIMIT 200`,[agency_id]);
  res.json(r.rows);
});

app.get('/api/messages/:wa', async (req,res)=>{
  const agency_id = req.query.agency_id || 'tu_empresa';
  const r = await pool.query(`SELECT text, direction, timestamp, media_type, media_url, status FROM messages WHERE wa_id=$1 AND agency_id=$2 ORDER BY timestamp ASC LIMIT 500`,[req.params.wa, agency_id]);
  res.json(r.rows);
});

app.post('/api/messages/send', async (req,res)=>{
  const {wa_id, text, agency_id} = req.body;
  const ag = agency_id || 'tu_empresa';
  // busca phone_number_id inverso
  let phoneId = process.env.PHONE_NUMBER_ID;
  try{
    const map = JSON.parse(process.env.AGENCY_MAP || '{}');
    for(let k in map){ if(map[k]===ag) phoneId=k; }
  }catch{}
  try{
    await axios.post(`https://graph.facebook.com/v21.0/${phoneId}/messages`,{
      messaging_product:'whatsapp', to:wa_id, type:'text', text:{body:text}
    },{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    const now=Date.now();
    await pool.query(`INSERT INTO messages(wa_id,agency_id,direction,text,timestamp,status) VALUES($1,$2,'out',$3,$4,'sent')`,[wa_id,ag,text,now]);
    await pool.query(`INSERT INTO conversations(wa_id,agency_id,name,last_message,last_time,unread,unread_dot,updated_at)
      VALUES($1,$2,$1,$3,$4,false,'red',$4) ON CONFLICT(wa_id,agency_id) DO UPDATE SET last_message=$3,last_time=$4,updated_at=$4`,
      [wa_id,ag,text,now]);
    res.json({ok:true});
  }catch(e){ console.error(e.response?.data||e.message); res.status(500).json({error:'send failed'}); }
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('KLIDO PRO MULTI ON '+PORT));
