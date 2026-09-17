const express = require('express');
const app = express();
app.use(express.json());
app.get('/', (req,res)=>res.redirect('/campanas'));
app.get('/campanas', (req,res)=>res.send(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;padding:20px;background:#f0f2f5}.box{background:#fff;padding:20px;border-radius:12px;max-width:600px;margin:auto}textarea{width:100%;height:100px}button{width:100%;padding:14px;background:#0B57D0;color:#fff;border:none;border-radius:8px;margin-top:10px;font-weight:bold}</style></head><body><div class="box"><h2 style="color:#0B57D0">KLIDO AVANZA - CAMPANAS</h2><p>Plantilla: alion_co - ID 1060826656745017</p><textarea id="c" placeholder="57300..."></textarea><button onclick="enviar()">ENVIAR CAMPAÑA</button><p id="r"></p><br><a href="/bandeja">Ir a bandeja</a></div><script>async function enviar(){let raw=document.getElementById('c').value.split('\\n');let contacts=[];for(let i=0;i<raw.length;i++){let t=raw[i].replace(/[^0-9]/g,''); if(t.length>9)contacts.push({tel:t});} let r=await fetch('/api/send-campaign-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contacts})});let d=await r.json();document.getElementById('r').innerText='Enviados:'+d.sent;}</script></body></html>`));
app.get('/bandeja',(req,res)=>res.send('<h2>Bandeja OK</h2><p>Si ves esto el servidor SI esta corriendo</p><a href="/campanas">Campanas</a>'));
app.post('/api/send-campaign-template', async (req,res)=>{
  const TOKEN=process.env.WHATSAPP_TOKEN; const PHONE_ID=process.env.PHONE_NUMBER_ID;
  const axios=require('axios'); let sent=0; for(let c of req.body.contacts){try{await axios.post('https://graph.facebook.com/v20.0/'+PHONE_ID+'/messages',{messaging_product:'whatsapp',to:c.tel,type:'template',template:{name:'alion_co',language:{code:'es_CO'}}},{headers:{Authorization:'Bearer '+TOKEN}}); sent++; await new Promise(r=>setTimeout(r,800));}catch(e){}} res.json({sent});
});
app.listen(process.env.PORT||3000,()=>console.log('OK'));
