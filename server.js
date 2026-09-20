const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ dest: '/tmp/' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{ rejectUnauthorized:false } });

async function initDB(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations(id SERIAL PRIMARY KEY, wa_id TEXT UNIQUE, name TEXT, last_message TEXT, last_type TEXT DEFAULT 'text', unread BOOLEAN DEFAULT true, unread_dot TEXT DEFAULT 'red', updated_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE, wa_id TEXT, direction TEXT, body TEXT, media_url TEXT, media_type TEXT, is_campaign BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS templates(id SERIAL PRIMARY KEY, name TEXT UNIQUE, body TEXT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, name TEXT, template_id INT, total INT DEFAULT 0, sent INT DEFAULT 0, status TEXT DEFAULT 'draft', created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS campaign_logs(id SERIAL PRIMARY KEY, campaign_id INT REFERENCES campaigns(id) ON DELETE CASCADE, wa_id TEXT, status TEXT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS spam_rules(id SERIAL PRIMARY KEY, wa_id TEXT UNIQUE, blocked_until TIMESTAMP, reason TEXT);
  `);
  console.log('KLIDO FULL ready');
}
initDB();

async function syncApprovedTemplates(){
  try{
    const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_BUSINESS_ID}/message_templates`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    const d = await r.json();
    const ap = (d.data||[]).filter(t=>t.status==='APPROVED');
    for(const t of ap){
      const body = t.components?.find(c=>c.type==='BODY')?.text||'';
      await pool.query(`INSERT INTO templates(name,body) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET body=EXCLUDED.body`,[t.name,body]);
    }
    console.log('Templates sync:',ap.length);
  }catch(e){console.error(e);}
}
syncApprovedTemplates();
setInterval(syncApprovedTemplates, 3600000);

async function isSpam(wa_id){
  const r = await pool.query(`SELECT COUNT(*) FROM messages WHERE wa_id=$1 AND direction='in' AND created_at > NOW() - INTERVAL '1 minute'`,[wa_id]);
  if(parseInt(r.rows[0].count)>10){
    await pool.query(`INSERT INTO spam_rules(wa_id,blocked_until,reason) VALUES($1,NOW()+INTERVAL '10 minutes','flood') ON CONFLICT(wa_id) DO UPDATE SET blocked_until=EXCLUDED.blocked_until`,[wa_id]);
    return true;
  }
  const b = await pool.query(`SELECT 1 FROM spam_rules WHERE wa_id=$1 AND blocked_until>NOW()`,[wa_id]);
  return b.rows.length>0;
}

app.get('/webhook',(req,res)=>{
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.status(403).send('Forbidden');
});

app.post('/webhook', async (req,res)=>{
  try{
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const st = value?.statuses?.[0];
    if(st) await pool.query(`UPDATE campaign_logs SET status=$1 WHERE wa_id=$2`,[st.status, st.recipient_id]);
    const msg = value?.messages?.[0];
    if(msg){
      const wa_id = msg.from;
      if(await isSpam(wa_id)) return res.sendStatus(200);
      const body = msg.text?.body || msg.caption || '[archivo]';
      const mediaId = msg.image?.id||msg.document?.id||msg.audio?.id||msg.video?.id;
      const media_url = mediaId?`media_${mediaId}`:null;
      const name = value.contacts?.[0]?.profile?.name||wa_id;
      let c = await pool.query('SELECT id FROM conversations WHERE wa_id=$1',[wa_id]);
      let cid;
      if(!c.rows.length){
        const ins = await pool.query(`INSERT INTO conversations(wa_id,name,last_message,last_type,unread,unread_dot) VALUES($1,$2,$3,$4,true,'red') RETURNING id`,[wa_id,name,body,msg.type]);
        cid=ins.rows[0].id;
      }else{
        cid=c.rows[0].id;
        await pool.query(`UPDATE conversations SET last_message=$1,last_type=$2,unread=true,unread_dot='red',updated_at=NOW(),name=$3 WHERE id=$4`,[body,msg.type,name,cid]);
      }
      await pool.query(`INSERT INTO messages(conversation_id,wa_id,direction,body,media_url,media_type) VALUES($1,$2,'in',$3,$4,$5)`,[cid,wa_id,body,media_url,msg.type]);
    }
  }catch(e){console.error(e);}
  res.sendStatus(200);
});

app.get('/api/chats', async (req,res)=>{
  const r = await pool.query(`SELECT wa_id as id, wa_id, name, last_message as "lastMessage", last_type as "lastType", unread, unread_dot as dot, updated_at as "updatedAt" FROM conversations ORDER BY updated_at DESC`);
  res.json(r.rows);
});
app.get('/api/messages/:wa_id', async (req,res)=>{
  const c = await pool.query('SELECT id FROM conversations WHERE wa_id=$1',[req.params.wa_id]);
  if(!c.rows.length) return res.json([]);
  const m = await pool.query(`SELECT body as text, direction, media_url as "mediaUrl", media_type as "mediaType", is_campaign as "isCampaign", created_at as "createdAt" FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC`,[c.rows[0].id]);
  res.json(m.rows);
});
app.post('/api/chats/:wa_id/read', async (req,res)=>{
  await pool.query(`UPDATE conversations SET unread=false WHERE wa_id=$1`,[req.params.wa_id]);
  res.json({ok:true});
});
app.get('/api/templates', async (req,res)=>{
  const r = await pool.query('SELECT * FROM templates ORDER BY created_at DESC'); res.json(r.rows);
});
app.get('/api/templates/sync', async (req,res)=>{
  await syncApprovedTemplates();
  const r = await pool.query('SELECT * FROM templates ORDER BY created_at DESC'); res.json(r.rows);
});
app.get('/api/campaigns', async (req,res)=>{
  const r = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC'); res.json(r.rows);
});
app.get('/api/campaigns/:id', async (req,res)=>{
  const c = await pool.query('SELECT * FROM campaigns WHERE id=$1',[req.params.id]);
  const logs = await pool.query('SELECT * FROM campaign_logs WHERE campaign_id=$1 ORDER BY created_at DESC',[req.params.id]);
  res.json({campaign:c.rows[0], history:logs.rows});
});
app.post('/api/campaigns/upload', upload.single('file'), async (req,res)=>{
  const wb = xlsx.readFile(req.file.path);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const {name, template_name} = req.body;
  const t = await pool.query('SELECT * FROM templates WHERE name=$1',[template_name]);
  if(!t.rows.length) return res.status(400).json({error:'Plantilla no aprobada'});
  const camp = await pool.query(`INSERT INTO campaigns(name,template_id,total,status) VALUES($1,$2,$3,'ready') RETURNING *`,[name,t.rows[0].id,rows.length]);
  for(const row of rows){
    const wa_id = String(row.telefono||row.phone||row.wa_id).replace(/\D/g,'');
    const custom = row.mensaje||row.message||'pending';
    await pool.query(`INSERT INTO campaign_logs(campaign_id,wa_id,status) VALUES($1,$2,$3)`,[camp.rows[0].id,wa_id,custom]);
    await pool.query(`UPDATE conversations SET unread=true, unread_dot='yellow' WHERE wa_id=$1`,[wa_id]);
  }
  res.json({campaign:camp.rows[0], count:rows.length});
});
app.post('/api/campaigns/:id/send', async (req,res)=>{
  const camp = await pool.query('SELECT c.*, t.name as template_name FROM campaigns c LEFT JOIN templates t ON t.id=c.template_id WHERE c.id=$1',[req.params.id]);
  if(!camp.rows.length) return res.status(404).json({error:'no campaign'});
  const tpl = camp.rows[0].template_name;
  const logs = await pool.query(`SELECT * FROM campaign_logs WHERE campaign_id=$1 AND status!='sent'`,[req.params.id]);
  await pool.query(`UPDATE campaigns SET status='sending' WHERE id=$1`,[req.params.id]);
  let sent=0;
  for(const log of logs.rows){
    try{
      const param = log.status!=='pending'?log.status:null;
      const payload={messaging_product:"whatsapp",to:log.wa_id,type:"template",template:{name:tpl,language:{code:"es_MX"},...(param?{components:[{type:"body",parameters:[{type:"text",text:param}]}]}:{})}};
      const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(r.ok){ await pool.query(`UPDATE campaign_logs SET status='sent' WHERE id=$1`,[log.id]); sent++; }
    }catch(e){console.error(e);}
  }
  await pool.query(`UPDATE campaigns SET status='sent', sent=$1 WHERE id=$2`,[sent,req.params.id]);
  res.json({ok:true,sent});
});

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('ON',PORT));
