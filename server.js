const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/campanas', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'campanas.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/test', (req, res) => {
  res.json({ok: true, msg: 'KLIDO ONLINE'});
});

let progreso = {total:0,enviados:0,estado:'idle',errores:0};
app.get('/api/campaigns/progress',(req,res)=>res.json(progreso));
app.post('/api/campaigns/send',(req,res)=>{
  progreso={total:req.body.contacts?.length||0,enviados:0,estado:'enviando',errores:0};
  res.json({ok:true});
  let i=0;
  const iv=setInterval(()=>{ i++; progreso.enviados=i; if(i>=progreso.total){ progreso.estado='terminado'; clearInterval(iv);} },400);
});

app.listen(PORT, ()=>console.log('KLIDO OK en puerto '+PORT));
