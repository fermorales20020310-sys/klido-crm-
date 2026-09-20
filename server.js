const express=require('express');
const {Pool}=require('pg');
const path=require('path');
const multer=require('multer');
const xlsx=require('xlsx');
require('dotenv').config();
const app=express();
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
const upload=multer({dest:'/tmp/'});
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});

async function initDB(){
 await pool.query(`CREATE TABLE IF NOT EXISTS conversations(id SERIAL PRIMARY KEY, wa_id TEXT UNIQUE, name TEXT, last_message TEXT, last_type TEXT DEFAULT 'text', unread BOOLEAN DEFAULT true, unread_dot TEXT DEFAULT 'red', updated_at TIMESTAMP DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS messages(id SERIAL PRIMARY KEY, conversation_id INT, wa_id TEXT, direction TEXT, body TEXT, media_url TEXT, media_type TEXT, is_campaign BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS templates(id SERIAL PRIMARY KEY, name TEXT UNIQUE, body TEXT, created_at TIMESTAMP DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS campaigns(id SERIAL PRIMARY KEY, name TEXT, template_id INT, total INT DEFAULT 0, sent INT DEFAULT 0, status TEXT DEFAULT 'draft', created_at TIMESTAMP DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS campaign_logs(id SERIAL PRIMARY KEY, campaign_id INT, wa_id TEXT, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS opt_outs(wa_id TEXT PRIMARY KEY, created_at TIMESTAMP DEFAULT NOW())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS spam_rules(id SERIAL PRIMARY KEY, wa_id TEXT UNIQUE, blocked_until TIMESTAMP, reason TEXT)`);
 console.log('KLIDO PROD DB OK');
}
initDB();

async function syncApprovedTemplates(){
 try{
  if(!process.env.WHATSAPP_BUSINESS_ID) return;
  const r=await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_BUSINESS_ID}/message_templates`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
  const d=await r.json();
  const approved=(d.data||[]).filter(t=>t.status==='APPROVED');
  for(const t of approved){
   const body=t.components?.find(c=>c.type==='BODY')?.text||'';
   await pool.query(`INSERT INTO templates(name,body) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET body=EXCLUDED.body`,[t.name,body]);
  }
 }catch(e){console.error(e.message)}
}
syncApprovedTemplates(); setInterval(syncApprovedTemplates,3600000);

app.get('/webhook',(req,res)=>{
 if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
 res.sendStatus(403);
});

app.post('/webhook',async(req,res)=>{
 try{
  const value=req.body.entry?.[0]?.changes?.[0]?.value;
  const st=value?.statuses?.[0];
  if(st) await pool.query(`UPDATE campaign_logs SET status=$1 WHERE id=(SELECT MAX(id) FROM campaign_logs WHERE wa_id=$2)`,[st.status,st.recipient_id]);
  const msg=value?.messages?.[0];
  if(msg){
   const wa_id=msg.from;
   const body=msg.text?.body||msg.caption||'[archivo]';
   // STOP automático
   if(body.trim().toUpperCase()==='STOP'){
    await pool.query(`INSERT INTO opt_outs(wa_id) VALUES($1) ON CONFLICT DO NOTHING`,[wa_id]);
    await fetch(`https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:"whatsapp",to:wa_id,type:"text",text:{body:"Has sido dado de baja. No recibirás más campañas."}})});
    return res.sendStatus(200);
   }
   const b=await pool.query(`SELECT 1 FROM opt_outs WHERE wa_id=$1`,[wa_id]);
   const name=value.contacts?.[0]?.profile?.name||wa_id;
   let c=await pool.query('SELECT id FROM conversations WHERE wa_id=$1',[wa_id]);
   let cid=c.rows[0]?.id;
   if(!cid){ const ins=await pool.query(`INSERT INTO conversations(wa_id,name,last_message,last_type,unread,unread_dot) VALUES($1,$2,$3,$4,true,'red') RETURNING id`,[wa_id,name,body,msg.type]); cid=ins.rows[0].id; }
   else await pool.query(`UPDATE conversations SET last_message=$1,last_type=$2,unread=true,unread_dot='red',updated_at=NOW() WHERE id=$3`,[body,msg.type,cid]);
   await pool.query(`INSERT INTO messages(conversation_id,wa_id,direction,body,media_type) VALUES($1,$2,'in',$3,$4)`,[cid,wa_id,body,msg.type]);
  }
 }catch(e){console.error(e)}
 res.sendStatus(200);
});

const delay=ms=>new Promise(r=>setTimeout(r,ms));

app.post('/api/campaigns/:id/send',async(req,res)=>{
 const camp=await pool.query('SELECT c.*, t.name as tpl FROM campaigns c LEFT JOIN templates t ON t.id=c.template_id WHERE c.id=$1',[req.params.id]);
 if(!camp.rows.length) return res.status(404).json({error:'no campaign'});
 const tpl=camp.rows[0].tpl;
 // filtra opt-outs
 await pool.query(`UPDATE campaign_logs SET status='blocked_optout' WHERE campaign_id=$1 AND wa_id IN (SELECT wa_id FROM opt_outs)`,[req.params.id]);
 const logs=await pool.query(`SELECT * FROM campaign_logs WHERE campaign_id=$1 AND status NOT IN ('sent','blocked_optout') ORDER BY id`,[req.params.id]);
 await pool.query(`UPDATE campaigns SET status='sending' WHERE id=$1`,[req.params.id]);
 res.json({ok:true, queued:logs.rows.length, msg:'Enviando por tandas anti-spam'});

 // fondo por tandas
 (async()=>{
  let sent=0;
  for(let i=0;i<logs.rows.length;i++){
   const log=logs.rows[i];
   try{
    const param=log.status!=='pending'?log.status:null;
    await fetch(`https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,{
     method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},
     body:JSON.stringify({messaging_product:"whatsapp",to:log.wa_id,type:"template",template:{name:tpl,language:{code:"es_MX"},...(param?{components:[{type:"body",parameters:[{type:"text",text:param}]}]}:{})}})
    });
    await pool.query(`UPDATE campaign_logs SET status='sent' WHERE id=$1`,[log.id]);
    await pool.query(`INSERT INTO conversations(wa_id,name,last_message,unread,unread_dot,updated_at) VALUES($1,$1,$2,true,'yellow',NOW()) ON CONFLICT(wa_id) DO UPDATE SET unread=true, unread_dot='yellow', updated_at=NOW(), last_message=EXCLUDED.last_message`,[log.wa_id,'📢 '+tpl]);
    sent++;
    await pool.query(`UPDATE campaigns SET sent=$1 WHERE id=$2`,[sent,req.params.id]);
   }catch(e){console.error(e)}
   await delay(2000); // 2 seg entre mensajes
   if((i+1)%45===0) await delay(5*60*1000); // pausa 5 min cada 45
  }
  await pool.query(`UPDATE campaigns SET status='sent' WHERE id=$1`,[req.params.id]);
 })();
});

// resto APIs igual
app.get('/api/chats',async(req,res)=>{const r=await pool.query(`SELECT wa_id as id, wa_id, name, last_message as "lastMessage", unread, unread_dot as dot FROM conversations ORDER BY updated_at DESC`);res.json(r.rows)});
app.get('/api/messages/:wa_id',async(req,res)=>{const c=await pool.query('SELECT id FROM conversations WHERE wa_id=$1',[req.params.wa_id]);if(!c.rows.length)return res.json([]);const m=await pool.query(`SELECT body as text, direction FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC`,[c.rows[0].id]);res.json(m.rows)});
app.post('/api/messages/send',async(req,res)=>{const{wa_id,text}=req.body;const r=await fetch(`https://graph.facebook.com/v21.0/${process.env.PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:"whatsapp",to:wa_id,type:"text",text:{body:text}})});if(!r.ok)return res.status(400).json(await r.json());let c=await pool.query('SELECT id FROM conversations WHERE wa_id=$1',[wa_id]);let cid=c.rows[0]?.id||(await pool.query(`INSERT INTO conversations(wa_id,name,last_message,unread) VALUES($1,$1,$2,false) RETURNING id`,[wa_id,text])).rows[0].id;await pool.query(`INSERT INTO messages(conversation_id,wa_id,direction,body) VALUES($1,$2,'out',$3)`,[cid,wa_id,text]);res.json({ok:true})});
app.post('/api/chats/:wa_id/read',async(req,res)=>{await pool.query(`UPDATE conversations SET unread=false WHERE wa_id=$1`,[req.params.wa_id]);res.json({ok:true})});
app.get('/api/templates',async(req,res)=>{const r=await pool.query('SELECT * FROM templates');res.json(r.rows)});
app.get('/api/templates/sync',async(req,res)=>{await syncApprovedTemplates();const r=await pool.query('SELECT * FROM templates');res.json(r.rows)});
app.get('/api/campaigns',async(req,res)=>{const r=await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');res.json(r.rows)});
app.get('/api/campaigns/:id',async(req,res)=>{const c=await pool.query('SELECT * FROM campaigns WHERE id=$1',[req.params.id]);const l=await pool.query('SELECT * FROM campaign_logs WHERE campaign_id=$1 ORDER BY created_at DESC',[req.params.id]);res.json({campaign:c.rows[0],history:l.rows})});
app.post('/api/campaigns/upload',upload.single('file'),async(req,res)=>{const wb=xlsx.readFile(req.file.path);const rows=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);const{name,template_name}=req.body;const t=await pool.query('SELECT * FROM templates WHERE name=$1',[template_name]);if(!t.rows.length)return res.status(400).json({error:'Plantilla no aprobada'});const camp=await pool.query(`INSERT INTO campaigns(name,template_id,total,status) VALUES($1,$2,$3,'ready') RETURNING *`,[name,t.rows[0].id,rows.length]);for(const row of rows){const wa_id=String(row.telefono||row.phone||row.wa_id||'').replace(/\D/g,'');if(!wa_id)continue;const opt=await pool.query(`SELECT 1 FROM opt_outs WHERE wa_id=$1`,[wa_id]);if(opt.rows.length)continue;await pool.query(`INSERT INTO campaign_logs(campaign_id,wa_id,status) VALUES($1,$2,$3)`,[camp.rows[0].id,wa_id,row.mensaje||'pending'])}res.json({ok:true,count:rows.length})});

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000,()=>console.log('KLIDO PROD ON'));
