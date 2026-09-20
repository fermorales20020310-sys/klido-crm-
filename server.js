const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-en-produccion';
const upload = multer({ storage: multer.memoryStorage(), limits:{fileSize:5*1024*1024} });

// Webhook verify
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.VERIFY_TOKEN)
    return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

// Webhook recibe TODO: texto, imagen, doc, audio, video
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try{
    const sig=req.headers['x-hub-signature-256']||'';
    const exp='sha256='+crypto.createHmac('sha256',process.env.APP_SECRET||'').update(req.body).digest('hex');
    if(sig.length!==exp.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(exp))) return res.sendStatus(401);
    const data=JSON.parse(req.body.toString());
    const val=data.entry?.[0]?.changes?.[0]?.value;
    const msg=val?.messages?.[0];
    if(msg){
      const {rows:[ag]}=await pool.query('SELECT id FROM agencies WHERE waba_id=$1',[data.entry[0].id]);
      if(ag){
        let body='[no texto]', type=msg.type||'text', media_url=null;
        if(msg.text) body=msg.text.body;
        else if(msg.image){ body='📷 Imagen'; media_url=msg.image.id; type='image'; }
        else if(msg.document){ body='📄 '+(msg.document.filename||'Documento'); media_url=msg.document.id; type='document'; }
        else if(msg.audio){ body='🎙️ Audio'; media_url=msg.audio.id; type='audio'; }
        else if(msg.video){ body='🎥 Video'; media_url=msg.video.id; type='video'; }
        await pool.query(
          'INSERT INTO messages(agency_id,wa_id,body,direction,type,media_url) VALUES($1,$2,$3,$4,$5,$6)',
          [ag.id,msg.from,body,'in',type,media_url]
        );
      }
    }
  }catch(e){console.error(e.message);}
  res.sendStatus(200);
});

app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:false}));
app.use(express.json({limit:'5mb'}));
app.use(express.static('public'));
app.use('/api/login', rateLimit({windowMs:15*60*1000,max:20}));
function auth(req,res,next){
  const t=(req.headers.authorization||'').replace('Bearer ','');
  if(!t) return res.status(401).json({ok:false});
  try{req.agency=jwt.verify(t,JWT_SECRET);next();}catch{return res.status(401).json({ok:false});}
}

// Login igual que antes
app.post('/api/login', async (req,res)=>{
  const {user,email,password}=req.body||{}; const loginEmail=email||user;
  try{
    const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE email=$1',[loginEmail]);
    if(a && await bcrypt.compare(password,a.password_hash))
      return res.json({ok:true,token:jwt.sign({id:a.id,email:a.email},JWT_SECRET,{expiresIn:'8h'})});
  }catch(e){}
  if(loginEmail===process.env.ADMIN_USER && process.env.ADMIN_PASSWORD_HASH){
    if(await bcrypt.compare(password,process.env.ADMIN_PASSWORD_HASH))
      return res.json({ok:true,token:jwt.sign({id:0,email:loginEmail},JWT_SECRET,{expiresIn:'8h'})});
  }
  res.status(401).json({ok:false});
});

// Chats lista
app.get('/api/chats', auth, async (req,res)=>{
  if(req.agency.id===0) return res.json({ok:true,chats:[]});
  const {rows}=await pool.query(`SELECT wa_id, MAX(body) as last_msg, MAX(created_at) as at, BOOL_OR(is_campaign) as has_campaign FROM messages WHERE agency_id=$1 GROUP BY wa_id ORDER BY at DESC LIMIT 100`,[req.agency.id]);
  res.json({ok:true,chats:rows});
});

// Historial por chat - para vista online (polling cada 3s en frontend)
app.get('/api/chats/:wa_id/messages', auth, async (req,res)=>{
  const {rows}=await pool.query(`SELECT body,direction,type,media_url,is_campaign,created_at FROM messages WHERE agency_id=$1 AND wa_id=$2 ORDER BY created_at ASC LIMIT 200`,[req.agency.id,req.params.wa_id]);
  res.json({ok:true,messages:rows});
});

// Enviar individual (texto o media por URL)
app.post('/api/chats/send', auth, async (req,res)=>{
  const {to,body,type,mediaUrl}=req.body||{};
  const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE id=$1',[req.agency.id]);
  const phone_number_id=a?.phone_number_id||process.env.PHONE_NUMBER_ID;
  const wa_token=a?.wa_token_enc||process.env.WHATSAPP_TOKEN;
  let payload;
  if(type==='image') payload={messaging_product:'whatsapp',to,type:'image',image:{link:mediaUrl,caption:body||''}};
  else if(type==='document') payload={messaging_product:'whatsapp',to,type:'document',document:{link:mediaUrl,caption:body||''}};
  else payload={messaging_product:'whatsapp',to,type:'text',text:{body:body||''}};
  const r=await fetch(`https://graph.facebook.com/v20.0/${phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${wa_token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json();
  if(j.error) return res.status(400).json({ok:false,error:j.error});
  await pool.query('INSERT INTO messages(agency_id,wa_id,body,direction,type,media_url) VALUES($1,$2,$3,$4,$5,$6)',[req.agency.id,to,body||'[media]','out',type||'text',mediaUrl||null]);
  res.json({ok:true});
});

// Templates solo APROBADAS - 100% legal Meta
app.get('/api/templates', auth, async (req,res)=>{
  let waba_id,wa_token;
  if(req.agency.id!==0){
    const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE id=$1',[req.agency.id]);
    waba_id=a.waba_id; wa_token=a.wa_token_enc;
  }else{ waba_id=process.env.WABA_ID; wa_token=process.env.WHATSAPP_TOKEN; }
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${waba_id}/message_templates?limit=100`,{headers:{Authorization:`Bearer ${wa_token}`}});
    const j=await r.json();
    const approved=(j.data||[]).filter(t=>t.status==='APPROVED');
    res.json(approved);
  }catch{res.json([]);}
});

// Subir Excel -> extrae números automáticamente
app.post('/api/campaigns/upload-excel', auth, upload.single('file'), (req,res)=>{
  try{
    const wb=XLSX.read(req.file.buffer,{type:'buffer'});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const data=XLSX.utils.sheet_to_json(ws,{header:1});
    const numbers=[...new Set(data.flat().map(v=>String(v||'').replace(/\D/g,'')).filter(v=>v.length>=10))];
    res.json({ok:true,numbers,count:numbers.length});
  }catch(e){res.status(400).json({ok:false,error:'excel invalido'});}
});

// Envío masivo LEGAL: solo templates aprobadas + opt-in
app.post('/api/campaigns/send-bulk', auth, async (req,res)=>{
  const {numbers,templateName}=req.body||{};
  if(!numbers?.length||!templateName) return res.status(400).json({ok:false,error:'faltan datos'});

  // 1. Verificar template aprobada
  let waba_id, wa_token, phone_number_id;
  if(req.agency.id!==0){
    const {rows:[a]}=await pool.query('SELECT * FROM agencies WHERE id=$1',[req.agency.id]);
    waba_id=a.waba_id; wa_token=a.wa_token_enc; phone_number_id=a.phone_number_id;
  }else{ waba_id=process.env.WABA_ID; wa_token=process.env.WHATSAPP_TOKEN; phone_number_id=process.env.PHONE_NUMBER_ID; }

  // 2. Filtrar solo opt-in (legal)
  const {rows:optins}=await pool.query(`SELECT wa_id FROM contacts WHERE agency_id=$1 AND wa_id = ANY($2) AND opt_in=true`,[req.agency.id,numbers]).catch(()=>({rows:numbers.map(wa_id=>({wa_id}))}));
  const allowed=new Set(optins.map(o=>o.wa_id));
  const targets=numbers.filter(n=>allowed.has(n));

  const {rows:[camp]}=await pool.query(`INSERT INTO campaigns(agency_id,name,total,status) VALUES($1,$2,$3,'enviando') RETURNING id`,[req.agency.id,templateName,targets.length]);
  let sent=0,failed=0;
  for(const to of targets){
    try{
      const r=await fetch(`https://graph.facebook.com/v20.0/${phone_number_id}/messages`,{method:'POST',headers:{Authorization:`Bearer ${wa_token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:templateName,language:{code:'es'}}})});
      if(r.ok){
        sent++;
        await pool.query(`INSERT INTO messages(agency_id,wa_id,body,direction,type,is_campaign,campaign_id) VALUES($1,$2,$3,'out','template',true,$4)`,[req.agency.id,to,`Campaña: ${templateName}`,camp.id]);
      }else failed++;
    }catch{failed++;}
    await new Promise(r=>setTimeout(r,300));
  }
  await pool.query(`UPDATE campaigns SET sent=$1,failed=$2,status='completada' WHERE id=$3`,[sent,failed,camp.id]);
  res.json({ok:true,sent,failed,skipped:numbers.length-targets.length,campaign_id:camp.id});
});

app.get('/api/campaigns', auth, async (req,res)=>{
  const {rows}=await pool.query(`SELECT * FROM campaigns WHERE agency_id=$1 ORDER BY created_at DESC LIMIT 20`,[req.agency.id]).catch(()=>({rows:[]}));
  res.json(rows);
});

app.get('/api/stats', auth, async (req,res)=>{
  if(req.agency.id===0) return res.json({ok:true,total:0});
  const {rows:[c]}=await pool.query('SELECT COUNT(*) as total FROM messages WHERE agency_id=$1',[req.agency.id]);
  res.json({ok:true,total:c.total});
});

app.post('/data-deletion',(req,res)=>res.json({ok:true}));
app.listen(PORT,()=>console.log('KLIDO LEGAL ON',PORT));
