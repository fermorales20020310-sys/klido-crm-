const express=require('express');
const fs=require('fs');
const path=require('path');
const app=express();
app.use(express.json({limit:'50mb'}));
app.use(require('cors')());
const publicPath=path.join(__dirname,'public');
const uploadDir=path.join(publicPath,'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
app.use('/uploads',express.static(uploadDir));

const VERIFY_TOKEN=(process.env.VERIFY_TOKEN||'klido123').trim();
const META_TOKEN=process.env.WHATSAPP_TOKEN;
const PHONE_ID=process.env.PHONE_NUMBER_ID;
const WABA_ID=process.env.WABA_ID;

console.log('=== KLIDO 100% META API ===');
console.log('VERIFY:',VERIFY_TOKEN,'PHONE_ID:',PHONE_ID,'WABA_ID:',WABA_ID,'HAS_TOKEN:',!!META_TOKEN);

let memMessages=[], memContacts={}, memCampaigns=[], cacheTemplates=[];

// --- 1. TRAE PLANTILLAS REALES DEL API DE META ---
async function fetchMetaTemplates(){
  if(!WABA_ID||!META_TOKEN){ console.log('Falta WABA_ID o WHATSAPP_TOKEN'); return []; }
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?fields=name,status,language,category,components&limit=100`,{
      headers:{Authorization:`Bearer ${META_TOKEN}`}
    });
    const j=await r.json();
    if(j.error){ console.log('Error Meta templates API:', j.error.message); return cacheTemplates; }
    if(j.data){
      cacheTemplates=j.data.filter(t=>t.status==='APPROVED').map(t=>{
        const header=t.components.find(c=>c.type==='HEADER');
        const body=t.components.find(c=>c.type==='BODY');
        const buttons=t.components.find(c=>c.type==='BUTTONS');
        return {
          name:t.name,
          status:t.status,
          language:t.language,
          category:t.category,
          hasImage: header?.format==='IMAGE',
          bodyText: body?.text||'',
          buttons: buttons?.buttons||[],
          components: t.components
        };
      });
      console.log(`✅ API META - ${cacheTemplates.length} plantillas APROBADAS:`, cacheTemplates.map(t=>t.name).join(', '));
    }
    return cacheTemplates;
  }catch(e){ console.log('fetchTemplates error',e.message); return cacheTemplates; }
}
fetchMetaTemplates();
setInterval(fetchMetaTemplates, 15000); // cada 15s sincroniza con API oficial

// LOGIN
app.post('/api/login',(req,res)=>{
  const e=(process.env.ADMIN_EMAIL||'fermorales20020310@gmail.com').toLowerCase();
  const p=process.env.ADMIN_PASS||'Mafe2002@';
  if((req.body.email||'').toLowerCase()===e && (req.body.password||'')===p) return res.json({ok:true});
  res.json({ok:false});
});

// WEBHOOK META 100% - VERIFY
app.get('/webhook',(req,res)=>{
  if(req.query['hub.mode']==='subscribe' && (req.query['hub.verify_token']||'').trim()===VERIFY_TOKEN){
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// WEBHOOK META 100% - RECIBE MENSAJES Y STATUS OFICIALES
app.post('/webhook',async(req,res)=>{
  const value=req.body.entry?.[0]?.changes?.[0]?.value;
  if(!value){ return res.sendStatus(200); }

  // STATUS OFICIAL DE META - para campañas tiempo real
  if(value.statuses){
    const st=value.statuses[0];
    console.log(`📊 API META STATUS: ${st.recipient_id} -> ${st.status} (id ${st.id})`);
    memCampaigns.forEach(c=>{
      if(st.status==='sent') c.sent++;
      if(st.status==='delivered') c.delivered=(c.delivered||0)+1;
      if(st.status==='read') c.read=(c.read||0)+1;
      if(st.status==='failed'){ c.failed=(c.failed||0)+1; console.log('Failed reason:', st.errors); }
    });
  }

  // MENSAJE ENTRANTE OFICIAL API
  if(value.messages){
    const m=value.messages[0];
    const contact=value.contacts?.[0];
    const wa_id=m.from;
    const name=contact?.profile?.name||wa_id;
    let txt='', fileUrl=null;
    if(m.type==='text') txt=m.text.body;
    else if(m.type==='button') txt=`[Botón ${m.button.text}]`;
    else txt=`[${m.type.toUpperCase()} API]`;

    console.log(`💬 API META MENSAJE: ${wa_id} (${name}): ${txt}`);
    memContacts[wa_id]={wa_id,name};
    memMessages.push({wa_id,text:txt,type:m.type,direction:'in',source:'inbox',created_at:new Date(),file_url:fileUrl});
  }
  res.sendStatus(200);
});

// API 100% META - TEMPLATES EN TIEMPO REAL
app.get('/api/templates', async(_,res)=>{
  const data=await fetchMetaTemplates();
  if(data.length) return res.json(data);
  // si aún no configuraste WABA_ID, muestra alion_co de ejemplo
  res.json([{name:'alion_co', status:'APPROVED', language:'es', category:'MARKETING', hasImage:true, bodyText:'Hola {{1}}, campaña oficial Alion - {{2}}', buttons:[{type:'QUICK_REPLY',text:'Confirmar'}]}]);
});

app.get('/api/templates/stream',(req,res)=>{
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  const send=async()=>{ const data=await fetchMetaTemplates(); res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const iv=setInterval(send,3000);
  req.on('close',()=>clearInterval(iv));
  send();
});

// API 100% META - BANDEJA
app.get('/api/chats',(_,res)=>{
  const map={};
  memMessages.forEach(m=>{ if(!map[m.wa_id]||new Date(m.created_at)>new Date(map[m.wa_id].created_at)) map[m.wa_id]={wa_id:m.wa_id,text:m.text,created_at:m.created_at,source:m.source,name:memContacts[m.wa_id]?.name||m.wa_id}; });
  res.json(Object.values(map).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
});
app.get('/api/messages/:id',(req,res)=>res.json(memMessages.filter(m=>m.wa_id===req.params.wa_id)));

// API 100% META - ENVIAR MENSAJE DE BANDEJA (texto libre solo en bandeja 24h window)
app.post('/api/send',async(req,res)=>{
  const {to,message}=req.body;
  if(!META_TOKEN||!PHONE_ID) return res.json({ok:false,error:'Falta META_TOKEN'});
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{
      method:'POST',
      headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:message}})
    });
    const j=await r.json();
    console.log('API META SEND bandeja:', j.messages?'OK':'FAIL', j.error||'');
    memMessages.push({wa_id:to,text:message,direction:'out',type:'text',source:'inbox',created_at:new Date()});
    res.json({ok:!!j.messages, data:j});
  }catch(e){ res.json({ok:false,error:e.message}); }
});

// API 100% META - CAMPAÑAS TIEMPO REAL - SOLO TEMPLATE
app.get('/api/campaigns',(_,res)=>res.json(memCampaigns));
app.get('/api/campaigns/stream',(req,res)=>{
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  const send=()=>res.write(`data: ${JSON.stringify(memCampaigns)}\n\n`);
  const iv=setInterval(send,2000);
  req.on('close',()=>clearInterval(iv));
  send();
});

app.post('/api/campaigns/send-bulk',async(req,res)=>{
  const {numbers, templateName, variables} = req.body; // templateName = alion_co
  if(!META_TOKEN||!PHONE_ID) return res.json({ok:false,error:'Falta META_TOKEN o PHONE_ID - todo es con API META'});

  const tpl=cacheTemplates.find(t=>t.name===templateName) || {name:templateName||'alion_co', language:'es', hasImage:true};
  const id=Date.now();
  const camp={id, name: tpl.name, total: numbers.length, sent:0, delivered:0, read:0, failed:0, created_at:new Date().toISOString(), status:'enviando API META'};
  memCampaigns.unshift(camp);

  // ENVIO ASYNC 100% API META TEMPLATE
  (async()=>{
    for(let i=0;i<numbers.length;i++){
      const to=String(numbers[i]).replace(/\D/g,'');
      try{
        // PAYLOAD 100% OFICIAL META - TEMPLATE
        const payload={
          messaging_product:'whatsapp',
          to,
          type:'template',
          template:{
            name: tpl.name,
            language:{code: tpl.language||'es'},
            components:[]
          }
        };
        // Si la plantilla tiene variables {{1}}, {{2}} del API
        if(variables && variables.length){
          payload.template.components.push({
            type:'body',
            parameters: variables.map(v=>({type:'text', text:String(v)}))
          });
        }
        // Si tiene imagen header del API
        if(tpl.hasImage){
          payload.template.components.unshift({
            type:'header',
            parameters:[{type:'image', image:{link:'https://klido-crm-production.up.railway.app/logo.png'}}]
          });
        }

        const r=await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,{
          method:'POST',
          headers:{Authorization:`Bearer ${META_TOKEN}`,'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });
        const j=await r.json();
        if(j.messages){ camp.sent++; console.log(`API META TEMPLATE ${tpl.name} -> ${to} OK ${j.messages[0].id}`); }
        else{ camp.failed++; console.log(`API META FAIL ${to}`, j.error?.message); }
      }catch(e){ camp.failed++; }
      await new Promise(r=>setTimeout(r, 500)); // 500ms para no bloquear API META
    }
    camp.status='completada API META';
  })();

  res.json({ok:true, id, total: numbers.length, template: tpl.name});
});

app.use(express.static(publicPath));
app.get('/health',(req,res)=>res.json({ok:true, api:'100% META', verify:VERIFY_TOKEN, hasToken:!!META_TOKEN, hasWaba:!!WABA_ID, templates:cacheTemplates.map(t=>t.name), files:fs.readdirSync(publicPath)}));
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.listen(process.env.PORT||3000,()=>console.log(`🚀 KLIDO 100% META API LISTO - ${VERIFY_TOKEN} - ${cacheTemplates.length} templates`));
