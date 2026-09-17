const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({limit: '50mb'}));
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

app.post('/api/send', async (req, res) => {
  const { to, message } = req.body;
  if(!TOKEN ||!PHONE_ID) return res.status(500).json({error: 'Falta TOKEN o PHONE_ID'});
  try {
    const url = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;
    const r = await axios.post(url, {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: message }
    }, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
    res.json({ok:true, id: r.data.messages[0].id});
  } catch(e) {
    res.status(500).json({ok:false, error: e.response?.data || e.message});
  }
});

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','campanas.html')));
app.listen(PORT, ()=> console.log('KLIDO REAL EN '+PORT));
