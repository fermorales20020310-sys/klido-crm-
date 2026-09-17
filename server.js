const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static('público'));
app.use(express.static('public'));
app.use(express.static('.'));

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID || '1338474282683914';
const VERIFY = process.env.VERIFY_TOKEN || 'klido123';

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY) {
    res.send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  console.log('Webhook:', JSON.stringify(req.body).slice(0,500));
  res.sendStatus(200);
});

// PÁGINA DE CAMPAÑAS - Esta arregla tu Not Found
app.get('/campanas.html', (req, res) => {
  const rutas = [
    path.join(__dirname, 'campanas.html'),
    path.join(__dirname, 'público', 'campanas.html'),
    path.join(__dirname, 'public', 'campanas.html'),
    path.join(__dirname, 'público', 'campañas.html')
  ];
  for (let p of rutas) { if (fs.existsSync(p)) return res.sendFile(p); }
  return res.status(404).send('Sube campanas.html a la raíz del repo');
});

// API PARA ENVIAR LOS 600
app.post('/api/campaigns/send', async (req, res) => {
  const contacts = req.body.contacts || [];
  if (!contacts.length) return res.json({ ok:false, error:'Sin contactos' });

  let enviados = 0, fallidos = 0;
  const lote = contacts.slice(0, 600);

  for (let c of lote) {
    let raw = String(c.TELEFONO || c.whatsapp || c.Mensajes || c.phone || '').split(',').pop() || '';
    let phone = raw.replace(/\D/g,'');
    if (phone.length < 10) continue;
    if (!phone.startsWith('57')) phone = '57' + phone.replace(/^57/, '');

    try {
      const r = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: { name: "acolbogota", language: { code: "es_CO" } }
        })
      });
      if (r.ok) enviados++; else fallidos++;
    } catch(e){ fallidos++; }
    await new Promise(x => setTimeout(x, 400));
  }
  res.json({ ok:true, enviados, fallidos, total:lote.length });
});

app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'público', 'index.html');
  const p2 = path.join(__dirname, 'public', 'index.html');
  const p3 = path.join(__dirname, 'campanas.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  return res.redirect('/campanas.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO corriendo en', PORT));
