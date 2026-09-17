const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'público')));
app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURACIÓN WHATSAPP ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // Ej: 123456789...

// Estado global de la campaña (para no dar timeout)
let progreso = { total: 0, enviados: 0, estado: 'idle', errores: 0 };

// Función para enviar plantilla
async function sendWhatsAppTemplate(contact, templateName) {
  const phone = contact.WHATSAPP || contact.phone || contact.TELEFONO;
  const name = contact['NOMBRE Y APELLIDO'] || contact.nombre || 'maestro';
  
  // Limpia teléfono a formato sin +
  let cleanPhone = String(phone).replace(/\D/g,'');
  if (!cleanPhone.startsWith('57')) cleanPhone = '57' + cleanPhone.slice(-10);

  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  
  const body = {
    messaging_product: "whatsapp",
    to: cleanPhone,
    type: "template",
    template: {
      name: templateName || 'acolbogota',
      language: { code: 'es_CO' },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: String(name).split(' ')[0] }] // Primer nombre
        }
      ]
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  return await res.json();
}

// --- ENDPOINTS QUE TE FALTABAN ---

// Para que no salga 404 en los logs
app.get('/api/contacts', (req, res) => {
  res.json([]);
});

app.get('/api/campaigns/progress', (req, res) => {
  res.json(progreso);
});

// ENVIO EN SEGUNDO PLANO - ESTE ES EL ARREGLO DEL 499
app.post('/api/campaigns/send', (req, res) => {
  const { contacts, template } = req.body;
  
  if (!contacts || contacts.length === 0) {
    return res.status(400).json({ ok: false, error: 'No contacts' });
  }

  // Responde DE INMEDIATO para que Railway no corte a los 3 min
  progreso = { total: contacts.length, enviados: 0, estado: 'enviando', errores: 0 };
  res.json({ ok: true, message: `Recibidos ${contacts.length}, enviando...`, total: contacts.length });

  console.log(`🚀 Iniciando campaña ${template} a ${contacts.length} contactos`);

  // Envía en segundo plano
  (async () => {
    for (let i = 0; i < contacts.length; i++) {
      try {
        await sendWhatsAppTemplate(contacts[i], template);
        progreso.enviados++;
        console.log(`✅ ${progreso.enviados}/${progreso.total} -> ${contacts[i].WHATSAPP || contacts[i].phone}`);
      } catch (e) {
        progreso.errores++;
        console.log(`❌ Error ${contacts[i].WHATSAPP}: ${e.message.slice(0,200)}`);
      }
      // 400ms entre mensajes para no saturar Meta
      await new Promise(r => setTimeout(r, 400));
    }
    progreso.estado = 'terminado';
    console.log('🎉 Campaña terminada');
  })();
});

app.get('/api/campaigns/status', (req,res) => res.json(progreso));

// Sirve tu página de campañas
app.get('/campanas', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'campanas.html'));
});

app.get('*', (req,res) => {
  // Si no encuentra ruta, manda al CRM principal
  res.sendFile(path.join(__dirname, 'público', 'index.html'));
});

app.listen(PORT, () => console.log(`KLIDO corriendo en puerto ${PORT}`));
