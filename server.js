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

async function initDB(){
  // Migración para no romper DB existente
  const alters = [
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unread BOOLEAN DEFAULT true`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unread_dot TEXT DEFAULT 'red'`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_type TEXT DEFAULT 'text'`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_campaign BOOLEAN DEFAULT false`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT`,
    `ALTER TABLE campaign_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`
  ];
  for(let q of alters){ try{ await pool.query(q); }catch(e){} }

  await pool.query(`CREATE TABLE IF NOT EXISTS conversations(
    wa_id TEXT PRIMARY KEY, name TEXT, last_message TEXT,
    last_time BIGINT, unread BOOLEAN DEFAULT true, unread_dot TEXT DEFAULT 'red',
    last_type TEXT DEFAULT 'text', updated_at BIGINT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages(
    id SERIAL PRIMARY KEY, wa_id TEXT, direction TEXT, text TEXT,
    media_type TEXT, media_url TEXT, is_campaign BOOLEAN DEFAULT false,
    timestamp BIGINT, status TEXT DEFAULT 'sent'
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS templates(
    id SERIAL PRIMARY KEY, name TEXT UNIQUE, body TEXT, synced_at BIGINT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(
    id SERIAL PRIMARY KEY, name TEXT, template_name TEXT, total INT DEFAULT 0,
    sent INT DEFAULT 0, status TEXT DEFAULT 'draft', created_at BIGINT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaign_logs(
    id SERIAL PRIMARY KEY, campaign_id INT, wa_id TEXT, status TEXT DEFAULT 'pending',
    error TEXT, sent_at BIGINT
  )`);
  console.log('KLIDO PROD ON - DB ready');
}
initDB();

app.use(express.static(path.join(__dirname,'public')));

// WEBHOOK VERIFY
app.get('/webhook',(req,res)=>{
  if(req.query['hub.verify_token']===process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

// WEBHOOK RECEIVE
app.post('/webhook', async (req,res)=>{
  try{
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if(msg){
      const wa_id = msg.from;
      const name = entry.contacts?.[0]?.profile?.name || wa_id;
      let text='', media_type='text', media_url=null;
      if(msg.type==='text') text=msg.text.body;
      else if(msg.image){ text='📷 Imagen'; media_type='image'; media_url=msg.image.id; }
      else if(msg.video){ text='🎥 Video'; media_type='video'; media_url=msg.video.id; }
      else if(msg.audio){ text='🎤 Audio'; media_type='audio'; media_url=msg.audio.id; }
      else if(msg.document){ text='📄 Documento'; media_type='document'; }
      else text='['+msg.type+']';

      const now=Date.now();
      await pool.query(`INSERT INTO conversations(wa_id,name,last_message,last_time,unread,unread_dot,last_type,updated_at)
        VALUES($1,$2,$3,$4,true,'red',$5,$4)
        ON CONFLICT(wa_id) DO UPDATE SET last_message=$3,last_time=$4,unread=true,unread_dot='red',last_type=$5,updated_at=$4,name=$2`,
        [wa_id,name,text,now,media_type]);
      await pool.query(`INSERT INTO messages(wa_id,direction,text,media_type,media_url,timestamp) VALUES($1,'in',$2,$3,$4,$5)`,
        [wa_id,text,media_type,media_url,now]);
    }
    // status updates (delivered/read)
    const status = entry?.statuses?.[0];
    if(status){
      await pool.query(`UPDATE messages SET status=$1 WHERE wa_id=$2 ORDER BY id DESC LIMIT 1`,[status.status, status.recipient_id]);
    }
  }catch(e){ console.error('webhook err',e.message); }
  res.sendStatus(200);
});

// CHATS
app.get('/api/chats', async (req,res)=>{
  const r = await pool.query(`SELECT wa_id as wa_id, name, last_message as "lastMessage", unread, unread_dot as dot FROM conversations ORDER BY last_time DESC LIMIT 200`);
  res.json(r.rows);
});
app.post('/api/chats/:wa/read', async (req,res)=>{
  await pool.query(`UPDATE conversations SET unread=false WHERE wa_id=$1`,[req.params.wa]);
  res.json({ok:true});
});
app.get('/api/messages/:wa', async (req,res)=>{
  const r = await pool.query(`SELECT text, direction, timestamp FROM messages WHERE wa_id=$1 ORDER BY timestamp ASC LIMIT 500`,[req.params.wa]);
  res.json(r.rows);
});
app.post('/api/messages/send', async (req,res)=>{
  const {wa_id, text} = req.body;
  try{
    await axios.post(`https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,{
      messaging_product:'whatsapp', to:wa_id, type:'text', text:{body:text}
    },{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    const now=Date.now();
    await pool.query(`INSERT INTO messages(wa_id,direction,text,timestamp,status) VALUES($1,'out',$2,$3,'sent')`,[wa_id,text,now]);
    await pool.query(`INSERT INTO conversations(wa_id,name,last_message,last_time,unread,unread_dot,updated_at)
      VALUES($1,$1,$2,$3,false,'red',$3) ON CONFLICT(wa_id) DO UPDATE SET last_message=$2,last_time=$3,updated_at=$3`,
      [wa_id,text,now]);
    res.json({ok:true});
  }catch(e){ console.error(e.response?.data||e.message); res.status(500).json({error:'send failed'}); }
});

// TEMPLATES
app.get('/api/templates', async (req,res)=>{
  const r=await pool.query(`SELECT name, body FROM templates ORDER BY name`);
  res.json(r.rows);
});
app.get('/api/templates/sync', async (req,res)=>{
  try{
    const r=await axios.get(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_BUSINESS_ID}/message_templates`,
      {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    for(let t of r.data.data){
      await pool.query(`INSERT INTO templates(name,body,synced_at) VALUES($1,$2,$3)
        ON CONFLICT(name) DO UPDATE SET body=$2,synced_at=$3`,
        [t.name, t.components?.find(c=>c.type==='BODY')?.text||'', Date.now()]);
    }
    res.json({ok:true,count:r.data.data.length});
  }catch(e){ res.status(500).json({error:e.message}); }
});

// CAMPAIGNS
app.post('/api/campaigns/upload', upload.single('file'), async (req,res)=>{
  const wb=XLSX.readFile(req.file.path);
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const c=await pool.query(`INSERT INTO campaigns(name,template_name,total,status,created_at) VALUES($1,$2,$3,'draft',$4) RETURNING id`,
    [req.body.name, req.body.template_name, rows.length, Date.now()]);
  const cid=c.rows[0].id;
  for(let row of rows){
    let phone=String(row.telefono||row.phone||row.Telefono||'').replace(/\D/g,'');
    if(phone) await pool.query(`INSERT INTO campaign_logs(campaign_id,wa_id,status) VALUES($1,$2,'pending')`,[cid,phone]);
  }
  res.json({ok:true,id:cid,count:rows.length});
});
app.get('/api/campaigns', async (req,res)=>{
  const r=await pool.query(`SELECT * FROM campaigns ORDER BY id DESC`);
  res.json(r.rows);
});
app.get('/api/campaigns/:id', async (req,res)=>{
  const h=await pool.query(`SELECT wa_id,status FROM campaign_logs WHERE campaign_id=$1 ORDER BY id`,[req.params.id]);
  res.json({history:h.rows});
});
app.post('/api/campaigns/:id/send', async (req,res)=>{
  const cid=req.params.id;
  await pool.query(`UPDATE campaigns SET status='sending' WHERE id=$1`,[cid]);
  const camp=(await pool.query(`SELECT template_name FROM campaigns WHERE id=$1`,[cid])).rows[0];
  // envío por tandas sin bloquear
  (async()=>{
    const logs=(await pool.query(`SELECT id,wa_id FROM campaign_logs WHERE campaign_id=$1 AND status='pending' LIMIT 500`,[cid])).rows;
    for(let l of logs){
      try{
        await axios.post(`https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,{
          messaging_product:'whatsapp', to:l.wa_id, type:'template',
          template:{name:camp.template_name, language:{code:'es_CO'}}
        },{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
        await pool.query(`UPDATE campaign_logs SET status='sent', sent_at=$1 WHERE id=$2`,[Date.now(),l.id]);
        await pool.query(`UPDATE campaigns SET sent=sent+1 WHERE id=$1`,[cid]);
      }catch(e){
        await pool.query(`UPDATE campaign_logs SET status='failed', error=$1 WHERE id=$2`,[e.message,l.id]);
      }
      await new Promise(r=>setTimeout(r,800)); // anti-bloqueo
    }
    await pool.query(`UPDATE campaigns SET status='done' WHERE id=$1`,[cid]);
  })();
  res.json({ok:true,msg:'Enviando por tandas'});
});

// DASHBOARD STATS
app.get('/api/stats', async (req,res)=>{
  const total=(await pool.query(`SELECT COUNT(*) FROM conversations`)).rows[0].count;
  const unread=(await pool.query(`SELECT COUNT(*) FROM conversations WHERE unread=true`)).rows[0].count;
  const today=(await pool.query(`SELECT COUNT(*) FROM messages WHERE timestamp>$1`,[Date.now()-86400000])).rows[0].count;
  res.json({total,unread,today});
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('KLIDO PROD ON port '+PORT));
