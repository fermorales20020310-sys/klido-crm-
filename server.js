const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname, 'public')));
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
let progreso = {total:0,enviados:0,estado:'idle',errores:0};
async function sendWhatsAppTemplate(c,t){
 let p=String(c.WHATSAPP||'').replace(/\D/g,''); if(p.length==10)p='57'+p;
 const res=await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,{
  method:'POST', headers:{'Authorization':`Bearer ${WHATSAPP_TOKEN}`,'Content-Type':'application/json'},
  body:JSON.stringify({messaging_product:"whatsapp",to:p,type:"template",template:{name:t||'acolbogota',language:{code:'es_CO'},components:[{type:'body',parameters:[{type:'text',text:String(c.nombre||'maestro').split(' ')[0]}]}]}})
 });
 if(!res.ok) throw new Error(await res.text()); return res.json();
}
app.get('/api/campaigns/progress',(req,res)=>res.json(progreso));
app.post('/api/campaigns/send',(req,res)=>{
 const {contacts,template}=req.body;
 progreso={total:contacts.length,enviados:0,estado:'enviando',errores:0};
 res.json({ok:true,total:contacts.length});
 (async()=>{ for(let i=0;i<contacts.length;i++){ try{await sendWhatsAppTemplate(contacts[i],template); progreso.enviados++;}catch(e){progreso.errores++;} await new Promise(r=>setTimeout(r,350)); } progreso.estado='terminado'; })();
});
app.get('/campanas',(req,res)=>res.sendFile(path.join(__dirname,'public','campanas.html')));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log('KLIDO OK'));
