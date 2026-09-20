const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-en-produccion';

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['x-hub-signature-256'] || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET || '').update(req.body).digest('hex');
    if (sig.length!== expected.length ||!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(401);
    const data = JSON.parse(req.body.toString());
    const msg = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg) {
      const wabaId = data.entry[0].id;
      const { rows: [ag] } = await pool.query('SELECT id FROM agencies WHERE waba_id = $1', [wabaId]);
      if (ag) await pool.query('INSERT INTO messages(agency_id, wa_id, body, direction) VALUES($1,$2,$3,$4)', [ag.id, msg.from, msg.text?.body || '[no texto]', 'in']);
    }
  } catch (e) { console.error(e.message); }
  res.sendStatus(200);
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
app.use('/api/login', rateLimit({ windowMs: 15*60*1000, max: 20 }));

function auth(req,res,next){
  const token = (req.headers.authorization||'').replace('Bearer ','');
  if(!token) return res.status(401).json({ok:false});
  try{ req.agency = jwt.verify(token, JWT_SECRET); next(); }catch{ return res.status(401).json({ok:false}); }
}

app.post('/api/login', async (req,res)=>{
  const {user,email,password}=req.body||{};
  const loginEmail=email||user;
  try{
    const {rows:[a]} = await pool.query('SELECT * FROM agencies WHERE email=$1',[loginEmail]);
    if(a && await bcrypt.compare(password,a.password_hash)){
      return res.json({ok:true, token: jwt.sign({id:a.id,email:a.email},JWT_SECRET,{expiresIn:'8h'})});
    }
  }catch(e){}
  if(loginEmail===process.env.ADMIN_USER && process.env.ADMIN_PASSWORD_HASH){
    if(await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH)){
      return res.json({ok:true, token: jwt.sign({id:0,email:loginEmail},JWT_SECRET,{expiresIn:'8h'})});
    }
  }
  res.status(401).json({ok:false});
});

app.get('/api/chats', auth, async (req,res)=>{
  if(req.agency.id===0) return res.json({ok:true,chats:[]});
  const {rows}=await pool.query(`SELECT wa_id, MAX(body) as last_msg, MAX(created_at) as at FROM messages WHERE agency_id=$1 GROUP BY wa_id ORDER BY at DESC LIMIT 100`,[req.agency.id]);
  res.json({ok:true,chats:rows});
});

app.post('/api/chats/send', auth, async (req,res)=>{
  const {to,body,template}=req.body||{};
  let phone_number_id, wa_token;
  if(req.agency.id!==0){
    const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE id=$1',[req.agency.id]);
    phone_number_id=a.phone_number_id; wa_token=a.wa_token_enc;
  }else{ phone_number_id=process.env.PHONE_NUMBER_ID; wa_token=process.env.WHATSAPP_TOKEN; }
  const payload= template? {messaging_product:'whatsapp',to,type:'template',template:{name:template,language:{code:'es'}}} : {messaging_product:'whatsapp',to,type:'text',text:{body:body||''}};
  const r=await fetch(`https://graph.facebook.com/v20.0/${phone_number_id}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${wa_token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json();
  if(j.error) return res.status(400).json({ok:false,error:j.error});
  if(req.agency.id!==0) await pool.query('INSERT INTO messages(agency_id,wa_id,body,direction) VALUES($1,$2,$3,$4)',[req.agency.id,to,body||template,'out']);
  res.json({ok:true});
});

app.get('/api/stats', auth, async (req,res)=>{
  if(req.agency.id===0) return res.json({ok:true,total:0});
  const {rows:[c]}=await pool.query('SELECT COUNT(*) as total FROM messages WHERE agency_id=$1',[req.agency.id]);
  res.json({ok:true,total:c.total});
});

app.get('/api/templates', auth, async (req,res)=>{
  let waba_id, wa_token;
  if(req.agency.id!==0){
    const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE id=$1',[req.agency.id]);
    waba_id=a.waba_id; wa_token=a.wa_token_enc;
  }else{ waba_id=process.env.WABA_ID; wa_token=process.env.WHATSAPP_TOKEN; }
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${waba_id}/message_templates?limit=50`,{headers:{Authorization:`Bearer ${wa_token}`}});
    const j=await r.json(); res.json(j.data||[]);
  }catch{ res.json([]); }
});

app.post('/api/campaigns/send-bulk', auth, async (req,res)=>{
  const {numbers,templateName}=req.body||{};
  if(!numbers?.length||!templateName) return res.status(400).json({ok:false});
  const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE id=$1',[req.agency.id]).catch(()=>({rows:[{}]}));
  const phone_number_id=a?.phone_number_id||process.env.PHONE_NUMBER_ID;
  const wa_token=a?.wa_token_enc||process.env.WHATSAPP_TOKEN;
  let sent=0,failed=0;
  for(const to of numbers){
    try{
      const r=await fetch(`https://graph.facebook.com/v20.0/${phone_number_id}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${wa_token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:templateName,language:{code:'es'}}})});
      r.ok?sent++:failed++;
    }catch{failed++;}
    await new Promise(r=>setTimeout(r,250));
  }
  res.json({ok:true,sent,failed});
});

app.get('/api/campaigns', auth, async (req,res)=>{
  const {rows}=await pool.query('SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY created_at DESC LIMIT 20',[req.agency.id]).catch(()=>({rows:[]}));
  res.json(rows);
});

app.post('/data-deletion', (req,res)=>{res.json({ok:true});});
app.listen(PORT, ()=>console.log('KLIDO ON',PORT));
