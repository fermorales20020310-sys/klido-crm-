const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
let pool = null;

async function initDB(){
  const { Pool } = require('pg');
  if(!process.env.DATABASE_URL) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try{
    await pool.query(`CREATE TABLE IF NOT EXISTS contacts (phone TEXT PRIMARY KEY);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY);`);
    await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, name TEXT, total INT DEFAULT 0, sent INT DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());`);

    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_message TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lastMessage TEXT;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unread INT DEFAULT 0;`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'inbox';`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS campaign_name TEXT;`);

    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS phone TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS text TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS body TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT;`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP DEFAULT NOW();`);
    console.log('✅ DB PRO REPARADA');
  }catch(e){ console.log(e.message); }
}
initDB();

const app = express();
app.use(cors());
app.use(bodyParser.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';

app.get('/webhook',(req,res)=>{ if(req.query['hub.verify_token']==VERIFY_TOKEN) return res.send(req.query['hub.challenge']); res.sendStatus(403); });
app.post('/webhook', async(req,res)=>{
  res.sendStatus(200);
  try{
    const val=req.body.entry?.[0]?.changes?.[0]?.value;
    const msg=val?.messages?.[0];
    if(!msg||!pool) return;
    const phone=msg.from; const text=msg.text?.body||'📎'; const name=val.contacts?.[0]?.profile?.name||phone;
    await pool.query('INSERT INTO messages(phone,text,body,direction) VALUES($1,$2,$2,$3)',[phone,text,'in']);
    await pool.query(`INSERT INTO contacts(phone,name,last_message,unread,updated_at,source) VALUES($1,$2,$3,1,NOW(),'inbox') ON CONFLICT(phone) DO UPDATE SET last_message=$3, unread=contacts.unread+1, updated_at=NOW()`,[phone,name,text]);
  }catch(e){}
});

app.get('/api/contacts', async(_,res)=>{
  try{
    let r=await pool.query(`SELECT phone, COALESCE(name,phone) as name, COALESCE(last_message,lastMessage,'') as "lastMessage", COALESCE(unread,0) as unread, COALESCE(source,'inbox') as source, campaign_name FROM contacts ORDER BY updated_at DESC`);
    res.json(r.rows);
  }catch(e){ res.json([]); }
});

app.get('/api/messages/:phone', async(req,res)=>{
  try{
    let p=req.params.phone.replace(/\D/g,'').slice(-10);
    let r=await pool.query(`SELECT COALESCE(text,body,'') as text, direction FROM messages WHERE phone LIKE '%'||$1||'%' ORDER BY id ASC`,[p]);
    res.json(r.rows);
  }catch(e){ res.json([]); }
});

app.post('/api/send', async(req,res)=>{
  try{
    const {phone,message}=req.body;
    await pool.query('INSERT INTO messages(phone,text,direction) VALUES($1,$2,$3)',[phone,message,'out']);
    await pool.query(`INSERT INTO contacts(phone,last_message,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(phone) DO UPDATE SET last_message=$2, updated_at=NOW()`,[phone,message]);
    if(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID){
      await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone.replace(/\D/g,''),type:'text',text:{body:message}})});
    }
    res.json({ok:true});
  }catch(e){ res.json({ok:true}); }
});

app.post('/api/campaign/send', async(req,res)=>{
  try{
    const {phones,message,campaignName}=req.body;
    await pool.query('INSERT INTO campaigns(name,total,sent) VALUES($1,$2,$2)',[campaignName,phones.length]);
    for(let phone of phones){
      let clean=phone.replace(/\D/g,'');
      await pool.query(`INSERT INTO contacts(phone,name,source,campaign_name,last_message,updated_at) VALUES($1,$1,'campaign',$2,$3,NOW()) ON CONFLICT(phone) DO UPDATE SET source='campaign', campaign_name=$2, last_message=$3, updated_at=NOW()`,[clean,campaignName,message]);
      await pool.query('INSERT INTO messages(phone,text,direction) VALUES($1,$2,$3)',[clean,message,'out']);
      if(process.env.WHATSAPP_TOKEN && process.env.PHONE_NUMBER_ID){
        try{ await fetch(`https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:clean,type:'text',text:{body:message}})}); await new Promise(r=>setTimeout(r,1200));
        }catch(e){}
      }
    }
    res.json({ok:true});
  }catch(e){ res.json({ok:false, error:e.message}); }
});

app.get('/api/campaigns', async(_,res)=>{
  try{ let r=await pool.query('SELECT * FROM campaigns ORDER BY id DESC'); res.json(r.rows); }catch(e){ res.json([]); }
});
app.post('/api/read/:phone', async(req,res)=>{ try{ await pool.query(`UPDATE contacts SET unread=0 WHERE phone LIKE '%'||$1||'%'`,[req.params.phone.slice(-10)]); }catch(e){} res.json({ok:true}); });
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000,()=>console.log('🚀 KLIDO PRO AMARILLO'));
