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
const WABA_ID = process.env.WABA_ID;

let contacts = {};
let campaigns = [];

// Persistencia para que no se borren tus 83 contactos al reiniciar Railway
try {
  if (fs.existsSync('./data.json')) {
    const d = JSON.parse(fs.readFileSync('./data.json'));
    contacts = d.contacts || {};
    campaigns = d.campaigns || [];
    Object.values(contacts).forEach(c => {
      if(!c.messages) c.messages=[];
      if(c.hot===undefined) c.hot=false;
      if(c.unread===undefined) c.unread=0;
      if(c.fromCampaign===undefined) c.fromCampaign = c.tag==='alion_co';
    });
  }
} catch(e){}

function save() {
  try { fs.writeFileSync('./data.json', JSON.stringify({ contacts, campaigns })); } catch(e){}
}

app.use(bodyParser.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/webhook', (req,res)=>{
  if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

// WEBHOOK TIEMPO REAL - MENSAJE NUEVO -> HOT + PUNTICO ROJO + AMARILLO SI ES DE CAMPAÑA
app.post('/webhook', (req,res)=>{
  const body=req.body;
  if(body.object==='whatsapp_business_account'){
    body.entry?.forEach(entry=>{
      entry.changes?.forEach(change=>{
        const msgs=change.value.messages;
        if(msgs){
          msgs.forEach(msg=>{
            const wa_id=msg.from;
            const text=msg.text?.body||`[${msg.type}]`;
            const name=change.value.contacts?.[0]?.profile?.name||wa_id;
            if(!contacts[wa_id]){
              contacts[wa_id]={ wa_id, name, lastMessage:'', hot:false, unread:0, messages:[], tag:'', fromCampaign:false, campaignName:'' };
            }
            contacts[wa_id].lastMessage=text;
            contacts[wa_id].hot=true; // ENTRA DIRECTO A HOT
            contacts[wa_id].unread=(contacts[wa_id].unread||0)+1; // CIRCULO ROJO
            // Si ya era de campaña, se mantiene amarillo
            if(contacts[wa_id].tag==='alion_co' || contacts[wa_id].fromCampaign){
              contacts[wa_id].fromCampaign=true;
            }
            contacts[wa_id].messages.push({ from:'client', text, timestamp:new Date() });
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
app.get('/api/export', (req,res)=>{
  const csv = 'wa_id,name,tag,fromCampaign,campaignName,lastMessage\n' + Object.values(contacts).map(c=>`${c.wa_id},"${c.name}",${c.tag},${c.fromCampaign},"${c.campaignName||''}","${(c.lastMessage||'').replace(/"/g,'')}"`).join('\n');
  res.header('Content-Type','text/csv'); res.attachment('klido_leads.csv'); res.send(csv);
});

app.get('/api/messages/:wa_id', (req,res)=>{
  const c=contacts[req.params.wa_id];
  if(c){ c.unread=0; save(); res.json(c.messages); } else res.json([]);
});

// PLANTILLAS APROBADAS - SE AÑADEN AUTOMATICO CUANDO META APRUEBA
app.get('/api/templates', async (req,res)=>{
  try{
    const url=`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?limit=100`;
    const r=await axios.get(url,{ headers:{ Authorization:`Bearer ${WHATSAPP_TOKEN}` } });
    const approved=(r.data.data||[]).filter(t=>t.status==='APPROVED');
    res.json(approved);
  }catch(e){ res.status(500).json([]); }
});

// RESPONDER ORGANICO -> SALE DE HOT Y PASA A BANDEJA GENERAL
app.post('/api/send', async (req,res)=>{
  const { wa_id, text }=req.body;
  try{
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product:"whatsapp", to:wa_id, type:"text", text:{ body:text } },
      { headers:{ Authorization:`Bearer ${WHATSAPP_TOKEN}` } }
    );
    if(contacts[wa_id]){
      contacts[wa_id].messages.push({ from:'me', text, timestamp:new Date() });
      contacts[wa_id].hot=false; // SALE DE HOT DEFINITIVO
      contacts[wa_id].unread=0;
      contacts[wa_id].lastMessage=text;
      save();
    }
    res.json({ success:true });
  }catch(e){ res.status(500).json({ error:e.response?.data||e.message }); }
});

// ENVIAR CAMPAÑA CON PLANTILLA APROBADA + MARCA AMARILLO
app.post('/api/send-campaign', async (req,res)=>{
  const { numbers, templateName, campaignName }=req.body;
  let sent=0, failed=0;
  const campId=Date.now();
  campaigns.unshift({ id:campId, name:campaignName||templateName, template:templateName, total:numbers.length, date:new Date(), sent:0 });

  for(let wa_id of numbers){
    let clean=wa_id.toString().replace(/\D/g,'');
    if(clean.length>=10 &&!clean.startsWith('57')) clean='57'+clean;
    try{
      await axios.post(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
        { messaging_product:"whatsapp", to:clean, type:"template", template:{ name:templateName, language:{ code:"es_CO" } } },
        { headers:{ Authorization:`Bearer ${WHATSAPP_TOKEN}` } }
      );
      if(!contacts[clean]) contacts[clean]={ wa_id:clean, name:clean, lastMessage:'', hot:false, unread:0, messages:[], tag:'alion_co', fromCampaign:true, campaignName:campaignName||templateName };
      contacts[clean].tag='alion_co';
      contacts[clean].fromCampaign=true;
      contacts[clean].campaignName=campaignName||templateName;
      contacts[clean].lastMessage=`[Campaña: ${templateName}]`;
      contacts[clean].messages.push({ from:'me', text:`[Plantilla ${templateName} enviada]`, timestamp:new Date() });
      sent++;
    }catch(e){ failed++; }
  }
  campaigns[0].sent=sent; campaigns[0].failed=failed; save();
  res.json({ success:true, sent, failed });
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','bandeja.html')));
app.get('/bandeja', (req,res)=> res.sendFile(path.join(__dirname,'public','bandeja.html')));
app.get('/campanas', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, ()=> console.log(`KLIDO AVANZA listo en ${PORT}`));
