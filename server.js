require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const PORT = process.env.PORT || 3000;
const JWT = process.env.JWT_SECRET || 'klido_secret_2026';

let empresas = [], codigos = {}, mensajes = {}, contactos = {}, campanas = [], plantillas = [];
let transporter = null;
if (process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function codigoPlan(p) { return `KLIDO-${p.toUpperCase()}-${Math.random().toString(36).substring(2,8).toUpperCase()}-${Date.now().toString().slice(-4)}`; }

async function syncPlantillas() {
  if (!process.env.WHATSAPP_TOKEN ||!process.env.WABA_ID) return;
  try {
    const r = await axios.get(`https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v20.0'}/${process.env.WABA_ID}/message_templates`, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } });
    plantillas = r.data.data.filter(t => t.status === 'APPROVED');
    console.log('[Klido] Plantillas:', plantillas.length);
  } catch (e) { console.log('Plantillas error', e.response?.data || e.message); }
}
setInterval(syncPlantillas, 5 * 60 * 1000); syncPlantillas();

// HEALTH PARA RAILPACK - OBLIGATORIO
app.get('/health', (req, res) => res.status(200).send('ok'));
app.get('/api/health', (req, res) => res.json({ ok: true, plantillas: plantillas.length }));

// PLANTILLAS
app.get('/api/plantillas', (req, res) => res.json(plantillas));
app.get('/api/templates', (req, res) => res.json(plantillas.map(p => ({ nombre: p.name, categoria: p.category, contenido: p.components, status: p.status, language: p.language }))));

// EMPRESAS
app.post('/api/empresas/crear', async (req, res) => {
  const { nombre, correo, password, plan } = req.body;
  if (empresas.find(e => e.correo === correo)) return res.status(400).json({ error: 'Correo ya registrado' });
  const hash = await bcrypt.hash(password, 10);
  const c = codigoPlan(plan);
  const emp = { id: uuidv4(), nombre, correo, passwordHash: hash, plan, codigoPlan: c, activo: true };
  empresas.push(emp); contactos[emp.id] = []; mensajes[emp.id] = {};
  res.json({ ok: true, empresa: { id: emp.id, nombre, correo, plan, codigoPlan: c } });
});

app.post('/api/login', async (req, res) => {
  const { correo, password, codigoPlan } = req.body;
  const emp = empresas.find(e => e.correo === correo);
  if (!emp) return res.status(404).json({ error: 'Empresa no existe' });
  if (!(await bcrypt.compare(password, emp.passwordHash))) return res.status(401).json({ error: 'Pass incorrecta' });
  if (codigoPlan && codigoPlan!== emp.codigoPlan) return res.status(401).json({ error: 'Código de plan inválido' });
  const token = jwt.sign({ id: emp.id, plan: emp.plan }, JWT, { expiresIn: '12h' });
  res.json({ ok: true, token, empresa: { id: emp.id, nombre: emp.nombre, plan: emp.plan } });
});

// RECUPERAR
app.post('/api/recuperar/enviar', async (req, res) => {
  const { correo } = req.body;
  const emp = empresas.find(e => e.correo === correo);
  if (!emp) return res.status(404).json({ error: 'Correo no registrado' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  codigos[correo] = { code, expires: Date.now() + 15 * 60 * 1000 };
  if (transporter) await transporter.sendMail({ from: process.env.SMTP_USER, to: correo, subject: 'Klido - Código', html: `<h2>Código: ${code}</h2>` });
  console.log(`CODIGO ${correo} -> ${code}`);
  res.json({ ok: true, previewCode:!transporter? code : undefined });
});

app.post('/api/recuperar/cambiar', async (req, res) => {
  const { correo, code, nuevaPassword } = req.body;
  const d = codigos[correo];
  if (!d || d.code!== code || Date.now() > d.expires) return res.status(400).json({ error: 'Código inválido' });
  const emp = empresas.find(e => e.correo === correo);
  emp.passwordHash = await bcrypt.hash(nuevaPassword, 10);
  delete codigos[correo];
  res.json({ ok: true });
});

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(h.replace('Bearer ', ''), JWT); next(); } catch { res.status(401).json({ error: 'Token inválido' }) }
}

// INBOX
app.get('/api/inbox', auth, (req, res) => res.json(contactos[req.user.id] || []));
app.get('/api/mensajes/:tel', auth, (req, res) => res.json(mensajes[req.user.id]?.[req.params.tel] || []));
app.post('/api/mensajes/enviar', auth, async (req, res) => {
  const { telefono, tipo, contenido } = req.body;
  if (!mensajes[req.user.id]) mensajes[req.user.id] = {};
  if (!mensajes[req.user.id][telefono]) mensajes[req.user.id][telefono] = [];
  const m = { id: uuidv4(), de: 'yo', tipo, contenido, fecha: new Date() };
  mensajes[req.user.id][telefono].push(m);
  if (tipo === 'text' && process.env.WHATSAPP_TOKEN) {
    try { await axios.post(`https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v20.0'}/${process.env.PHONE_NUMBER_ID}/messages`, { messaging_product: 'whatsapp', to: telefono, type: 'text', text: { body: contenido } }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }); } catch {}
  }
  io.to(req.user.id).emit('nuevo_mensaje', { telefono, mensaje: m });
  res.json({ ok: true });
});

// WEBHOOK
app.post('/webhook', (req, res) => {
  const entry = req.body.entry?.[0]?.changes?.[0]?.value;
  if (entry?.messages) {
    const tel = entry.messages[0].from;
    const txt = entry.messages[0].text?.body || `[${entry.messages[0].type}]`;
    const empId = empresas[0]?.id;
    if (empId) {
      if (!mensajes[empId]) mensajes[empId] = {};
      if (!mensajes[empId][tel]) mensajes[empId][tel] = [];
      mensajes[empId][tel].push({ id: uuidv4(), de: 'cliente', tipo: 'text', contenido: txt, fecha: new Date() });
      let c = contactos[empId].find(x => x.telefono === tel);
      if (!c) { c = { id: uuidv4(), telefono: tel, nombre: entry.contacts?.[0]?.profile?.name || tel, noLeido: true, esCampana: false }; contactos[empId].unshift(c); } else c.noLeido = true;
      io.to(empId).emit('nuevo_mensaje_cliente', { telefono: tel });
    }
  }
  res.sendStatus(200);
});
app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']); else res.sendStatus(403); });

// CAMPAÑAS - COMPATIBLE CON campanas.html
const upload = multer({ dest: 'uploads/' });
app.post('/api/campanas/upload', auth, upload.single('file'), async (req, res) => {
  try {
    const wb = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const tels = data.map(r => { const val = Object.values(r).find(v => String(v).replace(/\D/g, '').length >= 10); return val? String(val).replace(/\D/g, '') : null; }).filter(Boolean).map(t => t.length === 10? '57' + t : t);
    if (!contactos[req.user.id]) contactos[req.user.id] = [];
    const ids = [];
    tels.forEach(t => { let c = contactos[req.user.id].find(x => x.telefono === t); if (!c) { c = { id: uuidv4(), telefono: t, nombre: t, noLeido: false, esCampana: true }; contactos[req.user.id].push(c); } else c.esCampana = true; ids.push(c.id); });
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, detectados: tels.length, contactos_ids: ids });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/campanas/enviar', auth, async (req, res) => {
  const { plantilla, contactos_ids } = req.body;
  const plantillaReal = plantillas.find(p => p.name === plantilla) || plantillas[0];
  if (!plantillaReal) return res.status(400).json({ error: 'No hay plantillas' });
  const tels = contactos_ids.map(id => { const c = (contactos[req.user.id] || []).find(x => x.id === id); return c? c.telefono : null; }).filter(Boolean);
  const camp = { id: uuidv4(), empresaId: req.user.id, nombre: plantilla, plantilla, total: tels.length, enviados: 0, estado: 'en_proceso', telefonos: tels, fecha: new Date() };
  campanas.push(camp);
  let idx = 0;
  const enviarBloque = async () => {
    const lote = tels.slice(idx, idx + 50);
    if (lote.length === 0) { camp.estado = 'completado'; io.to(req.user.id).emit('campana_update', camp); return; }
    for (let tel of lote) {
      try { await axios.post(`https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v20.0'}/${process.env.PHONE_NUMBER_ID}/messages`, { messaging_product: 'whatsapp', to: tel, type: 'template', template: { name: plantillaReal.name, language: { code: plantillaReal.language || 'es_CO' } } }, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }); camp.enviados++; } catch {}
      await new Promise(r => setTimeout(r, 800));
    }
    idx += 50; io.to(req.user.id).emit('campana_update', camp);
    if (idx < tels.length) setTimeout(enviarBloque, 5 * 60 * 60 * 1000); else camp.estado = 'completado';
  };
  enviarBloque();
  res.json({ ok: true, campana: camp });
});

app.get('/api/campanas', auth, (req, res) => res.json(campanas.filter(c => c.empresaId === req.user.id)));
app.get('/api/campanas/:id/logs', auth, (req, res) => {
  const camp = campanas.find(c => String(c.id) === req.params.id && c.empresaId === req.user.id);
  if (!camp) return res.json([]);
  res.json(camp.telefonos.map(t => ({ telefono: t, estado: 'enviado' })));
});

io.on('connection', socket => { socket.on('join_empresa', id => socket.join(id)); });
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
server.listen(PORT, '0.0.0.0', () => console.log(`Klido V12 Railpack en ${PORT}`));
