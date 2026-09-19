const express=require('express');const fs=require('fs');const path=require('path');const app=express();
app.use(express.json({limit:'50mb'}));app.use(require('cors')());
const publicPath=path.join(__dirname,'public');
console.log('Files:',fs.readdirSync(publicPath));
let mem=[];
app.post('/api/login',(req,res)=>{const {email,password}=req.body;const e=process.env.ADMIN_EMAIL||'admin@klido.co';const p=process.env.ADMIN_PASS||'klido123';if(email===e&&password===p)return res.json({ok:true});res.json({ok:false});});
app.get('/api/campaigns',(req,res)=>res.json([{id:1,name:'Campaña Alion - 14/09',total:591,sent:591,created_at:new Date().toISOString()},{id:2,name:'Campaña Alion - 17/09',total:591,sent:591,created_at:new Date().toISOString()}]));
app.post('/api/campaigns/upload',(req,res)=>{console.log('upload',req.body);res.json({ok:true});});
app.post('/api/campaigns/send-bulk',async(req,res)=>{console.log('send-bulk',req.body.numbers?.length);res.json({ok:true,sent:req.body.numbers?.length||591});});
app.get('/api/chats',(req,res)=>res.json([]));app.get('/api/messages/:id',(req,res)=>res.json([]));app.post('/api/send',(req,res)=>res.json({ok:true}));
function findFile(name){const p=path.join(publicPath,name);if(fs.existsSync(p))return p;return null;}
app.get('/campaigns',(req,res)=>{const f=findFile('campaigns.html')||findFile('campanas.html');if(f)return res.sendFile(f);res.status(404).send('Sube public/campaigns.html');});
app.get('/campaigns.html',(req,res)=>{const f=findFile('campaigns.html')||findFile('campanas.html');if(f)return res.sendFile(f);res.status(404).send('Sube public/campaigns.html');});
app.get('/campanas.html',(req,res)=>{const f=findFile('campanas.html')||findFile('campaigns.html');if(f)return res.sendFile(f);res.status(404).send('Sube public/campanas.html');});
app.use(express.static(publicPath));
app.get('/',(req,res)=>res.sendFile(path.join(publicPath,'login.html')));
app.get('/health',(req,res)=>res.json({files:fs.readdirSync(publicPath)}));
app.listen(process.env.PORT||3000,()=>console.log('KLIDO OK'));
