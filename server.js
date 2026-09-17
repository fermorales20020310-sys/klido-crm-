const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));

app.get('/webhook', (req,res)=>{
  const token = process.env.VERIFY_TOKEN || 'klido123';
  if(req.query['hub.verify_token'] === token){
    console.log("Verificacion OK");
    return res.send(req.query['hub.challenge']);
  }
  console.log("Token malo:", req.query['hub.verify_token']);
  res.sendStatus(403);
});

app.post('/webhook', (req,res)=>{
  console.log("Mensaje recibido", JSON.stringify(req.body).substring(0,500));
  res.sendStatus(200);
});

app.get('/', (req,res)=> res.sendFile(__dirname+'/public/index.html'));

app.listen(process.env.PORT||3000, ()=>console.log("KLIDO AVANZA listo"));
