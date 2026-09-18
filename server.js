const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
let axios; try{ axios=require('axios'); }catch(e){ axios=null; }

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname,'data.json');
let db = { contacts:{}, messages:{} };
try{ if(fs.existsSync(DATA_FILE)) db=JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); }catch(e){}
function save(){ try{ fs.writeFileSync(DATA_FILE, JSON.stringify(db,null,2)); }catch(e){} }

app.get('/api/contacts',(req,res)=>{ res.json(Object.values(db.contacts).sort((a,b)=>(b.lastTimestamp||0)-(a.lastTimestamp||0))); });
app.get('/api/messages/:id',(req,res)=>{ res.json(db.messages[req.params.id]||[]); if(db.contacts[req.params.id]){ db.contacts[req.params.id].unread=0; save(); } });
app.post('/api/send', async (req,res)=>{
  const {wa_id,text}=req.body; if(!wa_id||!text) return res.status(400).json({error:'falta'});
  if(!db.messages[wa_id]) db.messages[wa_id]=[];
  db.messages[wa_id].push({from:'me',text,timestamp:Date.now()});
  if(db.contacts[wa_id]){ db.contacts[wa_id].lastMessage=text; db.contacts[wa_id].lastTimestamp=Date.now(); db.contacts[wa_id].hot=false; db.contacts[wa_id].unread=0; }
  save();
  try{
    if(axios && process.env.PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN){
      await axios.post(`https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,{messaging_product:"whatsapp",to:wa_id,type:"text",text:{body:text}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    }
  }catch(e){ console.log(e.response?.data||e.message); }
  res.json({ok:true});
});

app.get('/webhook',(req,res)=>{
  if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook',(req,res)=>{
  const body=req.body;
  if(body.object==='whatsapp_business_account'){
    body.entry?.forEach(entry=>{
      entry.changes?.forEach(change=>{
        const msgs=change.value?.messages;
        if(msgs) msgs.forEach(m=>{
          const wa_id=m.from; let text=m.type==='text'?m.text.body: m.type==='image'?'[image] '+(m.image?.caption||''): `[${m.type}]`;
          const name=change.value.contacts?.[0]?.profile?.name||wa_id;
          if(!db.contacts[wa_id]) db.contacts[wa_id]={wa_id,name,lastMessage:text,lastTimestamp:Date.now(),hot:true,unread:1,fromCampaign:false,campaignName:'',tag:''};
          else { db.contacts[wa_id].lastMessage=text; db.contacts[wa_id].lastTimestamp=Date.now(); db.contacts[wa_id].hot=true; db.contacts[wa_id].unread=(db.contacts[wa_id].unread||0)+1; }
          if(text.toLowerCase().includes('alion')||m.referral){ db.contacts[wa_id].fromCampaign=true; db.contacts[wa_id].campaignName='alion_co'; db.contacts[wa_id].tag='alion_co'; }
          if(!db.messages[wa_id]) db.messages[wa_id]=[];
          db.messages[wa_id].push({from:'client',text,timestamp:Date.now()});
          save();
        });
      });
    });
    res.sendStatus(200);
  } else res.sendStatus(404);
});

app.get('/api/templates',(req,res)=>res.json([]));
app.get('/bandeja',(req,res)=>res.sendFile(path.join(__dirname,'public','bandeja.html')));
app.get('/campanas',(req,res)=>res.sendFile(path.join(__dirname,'public','campanas.html')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,()=>console.log('KLIDO OK '+PORT));
