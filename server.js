const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '10mb' }));
// Sirve las dos carpetas por si acaso
app.use(express.static('público'));
app.use(express.static('public'));
app.use(express.static('.'));

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID || '1338474282683914';

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  console.log('Mensaje:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Ruta directa para campañas (ESTA ARREGLA TU ERROR)
app.get('/campanas.html', (req, res) => {
  const p1 = path.join(__dirname, 'público', 'campanas.html');
  const p2 = path.join(__dirname, 'public', 'campanas.html');
  const p3 = path.join(__dirname, 'campanas.html');
  // intenta en orden
  const fs = require('fs');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  if (fs.existsSync(p3)) return res.sendFile(p3);
  return res.status(404).send('No encontré campanas.html - súbelo a la carpeta público');
});

app.post('/api/campaigns/send', async (req, res) => {
  const contacts = req.body.contacts || [];
  if (!contacts.length) return res.json({ ok: false });

  let enviados = 0;
  const lote = contacts.slice(0, 600);

  for (let c of lote) {
    let raw = String(c.TELEFONO || c.whatsapp || c.Mensajes || '').split(',').pop() || '';
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
      if (r.ok) enviados++;
    } catch(e) {}
    await new Promise(x => setTimeout(x, 400));
  }
  res.json({ ok: true, enviados, total: lote.length });
});

app.get('/', (req, res) => {
  const fs = require('fs');
  const p1 = path.join(__dirname, 'público', 'index.html');
  const p2 = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  res.send('KLIDO CRM funcionando - entra a /campanas.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO en', PORT));
