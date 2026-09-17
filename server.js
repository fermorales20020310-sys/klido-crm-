const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'klido123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
let WABA_ID = process.env.WABA_ID;

let contacts = {};
let campaigns = [];
try {
  if (fs.existsSync('./data.json')) {
    let d = JSON.parse(fs.readFileSync('./data.json'));
    contacts = d.contacts || {};
    campaigns = d.campaigns || [];
  }
} catch(e){}
function save(){ try{ fs.writeFileSync('./data.json', JSON.stringify({contacts, campaigns})); }catch(e){} }

app.use(bodyParser.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/webhook', (req,res)=>{
  if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

// WEBHOOK - AQUI ESTAN TUS 3 ARREGLOS: AMARILLO + HOT + PUNTICO ROJO
app.post('/webhook', (req,res)=>{
  const body = req.body;
  if(body.object==='whatsapp_business_account'){
    body.entry?.forEach(entry=>{
      entry.changes?.forEach(change=>{
        let msgs = change.value.messages;
        if(msgs){
          msgs.forEach(msg=>{
            let wa_id = msg.from;
            let text = msg.text?.body || `[${msg.type}]`;
            let name = change.value.contacts?.[0]?.profile?.name || wa_id;
            if(!contacts[wa_id]){
              contacts[wa_id] = { wa_id, name, lastMessage:'', hot:false, unread:0, messages:[], tag:'', fromCampaign:false, campaignName:'' };
            }
            contacts[wa_id].lastMessage = text;
            contacts[wa_id].hot = true; // 2. Llega directo a Hot
            contacts[wa_id].unread = (contacts[wa_id].unread||0)+1; // 2. Puntico rojo
            if(contacts[wa_id].tag==='alion_co' || contacts[wa_id].fromCampaign){
              contacts[wa_id].fromCampaign = true; // 1. Amarillo
            }
            contacts[wa_id].messages.push({from:'client', text, timestamp:new Date()});
          });
        }
      });
    });
    save();
  }
  res.sendStatus(200);
});

app.get('/api/contacts', (req,res)=> res.json(Object.values(contacts)));
app.get('/api/campaigns', (req,res)=> res.json(campaigns));
app.get('/api/messages/:wa_id', (req,res)=>{
  let c = contacts[req.params.wa_id];
  if(c){ c.unread=0; save(); res.json(c.messages); } else res.json([]);
});
app.get('/api/export', (req,res)=>{
  let csv='wa_id,name,tag,fromCampaign,lastMessage\n'+Object.values(contacts).map(c=>`${c.wa_id},${c.name},${c.tag},${c.fromCampaign},${(c.lastMessage||'').replace(/,/g,'')}`).join('\n');
  res.header('Content-Type','text/csv'); res.attachment('klido.csv'); res.send(csv);
});

// TUS PLANTILLAS - SE AÑADEN SOLAS CUANDO META APRUEBA
app.get('/api/templates', async (req,res)=>{
  try{
    let waba = WABA_ID;
    if(!waba){
      let inf = await axios.get(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}?fields=whatsapp_business_account`, {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}});
      waba = inf.data?.whatsapp_business_account?.id;
    }
    let r = await axios.get(`https://graph.facebook.com/v20.0/${waba}/message_templates?limit=100`, {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}});
    let approved = (r.data.data||[]).filter(t=>t.status==='APPROVED');
    res.json(approved);
  }catch(e){ res.json([]); }
});

// RESPONDER - AQUI SALE DE HOT Y PASA A BANDEJA GENERAL
app.post('/api/send', async (req,res)=>{
  let {wa_id, text}=req.body;
  try{
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {messaging_product:"whatsapp", to:wa_id, type:"text", text:{body:text}}, {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}});
    if(contacts[wa_id]){
      contacts[wa_id].messages.push({from:'me', text, timestamp:new Date()});
      contacts[wa_id].hot = false; // 3. Sale de Hot al contestar
      contacts[wa_id].unread = 0;
      contacts[wa_id].lastMessage = text;
      save();
    }
    res.json({success:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/send-campaign', async (req,res)=>{
  let {numbers, templateName, campaignName}=req.body;
  let sent=0, failed=0;
  campaigns.unshift({id:Date.now(), name:campaignName||templateName, template:templateName, total:numbers.length, date:new Date(), sent:0});
  for(let wa of numbers){
    let clean = wa.toString().replace(/\D/g,''); if(clean.length>=10 &&!clean.startsWith('57')) clean='57'+clean;
    try{
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`, {messaging_product:"whatsapp", to:clean, type:"template", template:{name:templateName, language:{code:"es_CO"}}}, {headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`}});
      if(!contacts[clean]) contacts[clean]={wa_id:clean, name:clean, lastMessage:'', hot:false, unread:0, messages:[], tag:'alion_co', fromCampaign:true, campaignName};
      contacts[clean].tag='alion_co'; contacts[clean].fromCampaign=true; contacts[clean].campaignName=campaignName||templateName;
      contacts[clean].lastMessage=`[Campaña: ${templateName}]`;
      sent++;
    }catch(e){ failed++; }
  }
  campaigns[0].sent=sent; campaigns[0].failed=failed; save();
  res.json({success:true, sent, failed});
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','bandeja.html')));
app.get('/campanas', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, ()=> console.log('KLIDO AVANZA listo'));
