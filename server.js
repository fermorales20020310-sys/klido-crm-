const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static('público'));

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID || '1338474282683914';

// Webhook verificación (lo que ya tenías)
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  console.log('Mensaje recibido:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// ===== NUEVO: API CAMPAÑAS ACOL - 2000/día =====
app.post('/api/campaigns/send', async (req, res) => {
  const contacts = req.body.contacts || [];
  if (!contacts.length) return res.json({ ok: false, error: 'Sin contactos' });

  let enviados = 0, fallidos = 0;
  const lote = contacts.slice(0, 2000); // respeta tu límite

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
    } catch(e) { fallidos++; }

    await new Promise(x => setTimeout(x, 400)); // 2.5 msg/seg seguro
  }

  res.json({ ok: true, enviados, fallidos, total: lote.length });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'público', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('KLIDO CRM corriendo en', PORT));
