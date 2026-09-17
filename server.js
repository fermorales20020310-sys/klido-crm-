const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// asegura que public existe
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  fs.mkdirSync(path.join(__dirname, 'public'));
}
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/test', (req, res) => res.json({ok:true, msg:'KLIDO ONLINE'}));

app.get('/', (req,res)=>{
  const p = path.join(__dirname,'public','index.html');
  if(fs.existsSync(p)) return res.sendFile(p);
  res.send('<h1>KLIDO CRM</h1><a href="/campanas.html">Ir a Campanas</a>');
});

app.get('/campanas', (req,res)=>{
  const p = path.join(__dirname,'public','campanas.html');
  if(fs.existsSync(p)) return res.sendFile(p);
  res.send('Falta campanas.html - crealo en public/');
});

app.listen(PORT, ()=>console.log('KLIDO OK en '+PORT));
