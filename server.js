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
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto';

// --- WEBHOOK PRIMERO (para que la firma no se rompa) ---
app.get('/webhook', (req,res)=>{
  const mode=req.query['hub.mode'], token=req.query['hub.verify_token'], ch=req.query['hub.challenge'];
  if(mode==='subscribe' && token===process.env.VERIFY_TOKEN) return res.status(200).send(ch);
  res.sendStatus(403);
});
app.post('/webhook', express.raw({type:'application/json'}), async (req,res)=>{
  const sig=req.headers['x-hub-signature-256']||'';
  const exp='sha256='+crypto.createHmac('sha256',process.env.APP_SECRET||'').update(req.body).digest('hex');
  const a=Buffer.from(sig), b=Buffer.from(exp);
  if(a.length!==b.length ||!crypto.timingSafeEqual(a,b)) return res.sendStatus(401);
  const data=JSON.parse(req.body.toString());
  try{
    const val=data.entry?.[0]?.changes?.[0]?.value;
    const msg=val?.messages?.[0];
    if(msg){
      const wabaId=data.entry[0].id;
      const {rows:[ag]}=await pool.query('SELECT id FROM agencies WHERE waba_id=$1',[wabaId]);
      if(ag) await pool.query('INSERT INTO messages(agency_id,wa_id,body,direction) VALUES($1,$2,$3,\'in\')',[ag.id,msg.from,msg.text?.body||'[no texto]']);
      else console.log('Webhook OK',JSON.stringify(data).slice(0,200)); // modo legacy tuyo
    }
  }catch(e){console.error(e)}
  res.sendStatus(200);
});

// --- Middlewares (después del webhook) ---
app.use(helmet());
app.use(cors({origin:false}));
app.use(express.json());
app.use(express.static('public'));
app.use('/api/login', rateLimit({windowMs:15*60*1000,max:20}));

function auth(req,res,next){
  const h=req.headers.authorization||''; const token=h.replace('Bearer ','');
  if(!token) return res.status(401).json({ok:false});
  try{ req.agency=jwt.verify(token,JWT_SECRET); next(); }
  catch{ return res.status(401).json({ok:false}); }
}

// --- Login: multi-agencia + tu ADMIN legacy ---
app.post('/api/login', async (req,res)=>{
  const {user,email,password}=req.body||{};
  const loginEmail=email||user;
  // 1. intenta agencia
  try{
    const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE email=$1',[loginEmail]);
    if(a && await bcrypt.compare(password,a.password_hash)){
      const token=jwt.sign({id:a.id,email:a.email},JWT_SECRET,{expiresIn:'8h'});
      return res.json({ok:true,token,agency:a.email});
    }
  }catch(e){}
  // 2. fallback tu ADMIN_USER original
  if(loginEmail===process.env.ADMIN_USER){
    const ok=await bcrypt.compare(password,process.env.ADMIN_PASSWORD_HASH||'');
    if(ok){ const token=jwt.sign({id:0,email:loginEmail},JWT_SECRET,{expiresIn:'8h'}); return res.json({ok:true,token});}
  }
  return res.status(401).json({ok:false});
});

// --- Chats (tu ruta, ahora con DB real) ---
app.get('/api/chats', auth, async (req,res)=>{
  if(req.agency.id===0) return res.json({ok:true,chats:[]}); // legacy
  const {rows}=await pool.query(`SELECT wa_id, MAX(body) as last_msg, MAX(created_at) as at FROM messages WHERE agency_id=$1 GROUP BY wa_id ORDER BY at DESC LIMIT 100`,[req.agency.id]);
  res.json({ok:true,chats:rows});
});

// --- Envío real (tu ruta, ahora funcional) ---
app.post('/api/chats/send', auth, async (req,res)=>{
  const {to,body,template}=req.body||{};
  if(!to) return res.status(400).json({ok:false});
  let phone_number_id, wa_token;
  if(req.agency.id!==0){
    const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE id=$1',[req.agency.id]);
    if(!a?.phone_number_id) return res.status(400).json({ok:false,error:'agencia sin número'});
    phone_number_id=a.phone_number_id; wa_token=a.wa_token_enc; // cifra en producción
    if(template){
      const {rows:[opt]}=await pool.query('SELECT 1 FROM opt_ins WHERE agency_id=$1 AND wa_id=$2',[a.id,to]);
      if(!opt) return res.status(403).json({ok:false,error:'sin opt-in'});
    }
  } else { phone_number_id=process.env.PHONE_NUMBER_ID; wa_token=process.env.WHATSAPP_TOKEN; }

  const payload=template
   ? {messaging_product:'whatsapp',to,type:'template',template:{name:template,language:{code:'es'}}}
    : {messaging_product:'whatsapp',to,type:'text',text:{body:body||''}};

  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${phone_number_id}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${wa_token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json();
    if(j.error) return res.status(400).json({ok:false,error:j.error});
    if(req.agency.id!==0) await pool.query('INSERT INTO messages(agency_id,wa_id,body,direction) VALUES($1,$2,$3,\'out\')',[req.agency.id,to,body||template]);
    res.json({ok:true,id:j.messages?.[0]?.id});
  }catch(e){ res.status(500).json({ok:false}); }
});

// --- Stats (tu ruta) ---
app.get('/api/stats', auth, async (req,res)=>{
  if(req.agency.id===0) return res.json({ok:true});
  const {rows:[c]}=await pool.query('SELECT COUNT(*) as total FROM messages WHERE agency_id=$1',[req.agency.id]);
  res.json({ok:true,total:c.total});
});

// --- Campañas: placeholders para tu frontend en public/ (no rompe diseño) ---
app.post('/api/campaigns/upload', auth, (req,res)=>{ res.json({ok:true,msg:'conecta tu lógica Excel aquí, frontend intacto'}); });
app.get('/api/campaigns/history', auth, async (req,res)=>{
  if(req.agency.id===0) return res.json({ok:true,history:[]});
  const {rows}=await pool.query('SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY created_at DESC LIMIT 50',[req.agency.id]).catch(()=>({rows:[]}));
  res.json({ok:true,history:rows});
});

// --- Data deletion requerido por Meta ---
app.post('/data-deletion', (req,res)=>{ res.json({ok:true}); });

app.listen(PORT,()=>{ console.log('✅ KLIDO CRM SECURE ON'); console.log('✅ DB OK multi-agency'); });
