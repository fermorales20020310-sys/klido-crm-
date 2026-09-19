const express=require('express');
const fs=require('fs');
const path=require('path');
const app=express();
app.use(express.json({limit:'50mb'}));
app.use(require('cors')());
const publicPath=path.join(__dirname,'public');

// ESTA ES LA RUTA QUE TE FALTA - TIENE QUE ESTAR ANTES DE STATIC
const VERIFY_TOKEN=(process.env.VERIFY_TOKEN||'klido123').trim();
console.log('VERIFY_TOKEN que usará el server:', VERIFY_TOKEN);

app.get('/webhook',(req,res)=>{
  console.log('Llego petición GET /webhook', req.query);
  const mode=req.query['hub.mode'];
  const token=(req.query['hub.verify_token']||'').trim();
  const challenge=req.query['hub.challenge'];
  console.log(`Comparando token recibido "${token}" vs esperado "${VERIFY_TOKEN}"`);
  if(mode==='subscribe' && token===VERIFY_TOKEN){
    console.log('✅ VERIFY OK');
    return res.status(200).send(challenge);
  }
  console.log('❌ VERIFY FAIL');
  return res.status(403).send('Forbidden - token no coincide');
});

app.post('/webhook',(req,res)=>{
  console.log('=== MENSAJE ENTRANTE POST /webhook ===', JSON.stringify(req.body).slice(0,1000));
  res.sendStatus(200);
});

// RUTAS API MINIMAS PARA QUE FUNCIONE TODO
app.post('/api/login',(req,res)=>{
  const e=(process.env.ADMIN_EMAIL||'fermorales20020310@gmail.com').toLowerCase();
  const p=process.env.ADMIN_PASS||'Mafe2002@';
  if((req.body.email||'').toLowerCase()===e && (req.body.password||'')===p) return res.json({ok:true});
  res.json({ok:false});
});
app.get('/api/chats',(req,res)=>res.json([]));
app.get('/api/messages/:id',(req,res)=>res.json([]));
app.get('/api/campaigns',(req,res)=>res.json([{id:1,name:'Campaña Alion 14/09',total:591,sent:591,created_at:new Date().toISOString()}]));
app.post('/api/send',(req,res)=>res.json({ok:true}));
app.post('/api/campaigns/upload',(req,res)=>res.json({ok:true}));
app.post('/api/campaigns/send-bulk',(req,res)=>res.json({ok:true,sent:req.body.numbers?.length||0}));

app.use(express.static(publicPath));
app.get('/health',(req,res)=>res.json({ok:true, verify:VERIFY_TOKEN, files:fs.readdirSync(publicPath)}));
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.listen(process.env.PORT||3000,()=>console.log('🚀 SERVER CON /webhook LISTO - VERIFY='+VERIFY_TOKEN));
