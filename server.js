const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
const { Pool } = require('pg');

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch {}

const fetchFn = global.fetch;
const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'klido-avanza-final-2026-pro';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Mafe2002@';
const WPP = '573133181851';
const MAX_AGENCIAS = 10;
const ACOL_WA_ID = '1338474282683914';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'klido_meta_verify_token_2026';

// Directorio para respaldos y archivos cargados en Railway
let DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    DATA_DIR = path.join(__dirname, 'data');
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UP_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });

// Configuración de PostgreSQL
const usePg = !!process.env.DATABASE_URL;
let pool = null;
if (usePg) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
}

// Inicialización de estructura local o Base de Datos
if (!usePg && !fs.existsSync(DB_FILE)) {
  const h = bcrypt.hashSync(ADMIN_PASS, 10);
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(
      {
        agencias: [
          {
            id: 'KLIDO-AVANZA',
            nombre: 'Avanza Consulting YL',
            email: 'avanzaconsultingyl@gmail.com',
            plan: 'gold',
            estado: 'activa',
            pagado: true,
            codigoActivacion: 'AVANZA-111',
            creado: new Date(),
            mantenimiento: 'al día',
            whiteLabel: null,
            waPhoneId: '',
            waBusinessId: '',
            onboarding: { paso1: true, paso2: true, paso3: true }
          }
        ],
        usuarios: [
          { id: '1', nombre: 'Gerencia Avanza', email: 'admin@klido.com', rol: 'super', plan: 'gold', agenciaId: 'KLIDO-AVANZA', password: h },
          { id: '2', nombre: 'Avanza Consulting', email: 'avanzaconsultingyl@gmail.com', rol: 'jefe', plan: 'gold', agenciaId: 'KLIDO-AVANZA', password: h }
        ],
        mensajes: [],
        trabajadores: [],
        campanas: [],
        codigos: [],
        codigosActivacion: [],
        historial: [],
        calendario: [],
        kanban: [],
        templates: [
          { name: 'hola_cliente', nombre: 'hola_cliente', status: 'APPROVED', language: 'es' },
          { name: 'seguimiento', nombre: 'seguimiento', status: 'APPROVED' },
          { name: 'recordatorio_cita', nombre: 'recordatorio_cita', status: 'APPROVED' }
        ],
        notificacionesGerente: []
      },
      null,
      2
    )
  );
}

const read = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const write = (d) => {
  try {
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `db-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`));
    d.historial = d.historial || [];
    d.historial.push({ fecha: new Date(), agencias: d.agencias.length });
    if (d.historial.length > 1000) d.historial = d.historial.slice(-1000);
  } catch {}
  fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2));
};

const PLANES = {
  basico: {
    nombre: 'Básico',
    maxUsuarios: 2,
    maxEnvio: 1,
    maxContactos: 1000,
    ia: false,
    llamadas: false,
    precioAnual: 800000,
    mant: 80000,
    beneficios: ['Bandeja tiempo real', 'Campañas anti-baneo', 'Kanban CRM', 'Calendario', 'Soporte 24/7']
  },
  premium: {
    nombre: 'Premium + IA',
    maxUsuarios: 5,
    maxEnvio: 5,
    maxContactos: 10000,
    ia: true,
    llamadas: false,
    precioAnual: 1400000,
    mant: 95000,
    beneficios: ['Todo Básico', 'IA Resumen + Sugerencias', '5 usuarios', '10k contactos']
  },
  gold: {
    nombre: 'Gold + IA + Llamadas',
    maxUsuarios: 99,
    maxEnvio: 999,
    maxContactos: 999999,
    ia: true,
    llamadas: true,
    precioAnual: 2400000,
    mant: 120000,
    beneficios: ['Todo Premium', 'Llamadas directas', 'Ilimitado', 'White-label $200k', 'API Activa']
  }
};

const normalizaPlan = (p) => {
  const s = String(p || 'basico').toLowerCase();
  if (s.includes('gold')) return 'gold';
  if (s.includes('premium')) return 'premium';
  return 'basico';
};
const getPlan = (p) => PLANES[normalizaPlan(p)] || PLANES.basico;

const RESEND_FROM_FIXED = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, agencias: read().agencias.length, wpp: WPP, acol: ACOL_WA_ID, database: usePg ? 'PostgreSQL' : 'JSON Engine' }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/uploads', express.static(UP_DIR));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

const auth = (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

let transporter = null;
const useResend = !!process.env.RESEND_API_KEY;
if (nodemailer && process.env.SMTP_USER && process.env.SMTP_PASS) {
  const pc = String(process.env.SMTP_PASS).replace(/\s/g, '');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: pc },
    tls: { rejectUnauthorized: false }
  });
}

// ------------------------------------------------------------------
// WEBHOOKS DE META (WHATSAPP CLOUD API EN TIEMPO REAL)
// ------------------------------------------------------------------
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === META_VERIFY_TOKEN) {
    console.log('[META WEBHOOK] Verificado correctamente');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    try {
      body.entry?.forEach((entry) => {
        entry.changes?.forEach((change) => {
          if (change.value && change.value.messages) {
            const waPhoneId = change.value.metadata?.phone_number_id;
            const msgData = change.value.messages[0];
            const senderNum = msgData.from;
            const msgType = msgData.type;

            let textoMensaje = '';
            let mediaUrl = null;

            if (msgType === 'text') textoMensaje = msgData.text?.body || '';
            else if (['image', 'audio', 'document', 'video'].includes(msgType)) {
              textoMensaje = `[${msgType.toUpperCase()}]`;
              mediaUrl = msgData[msgType]?.id || null;
            }

            const db = read();
            const ag = db.agencias.find((a) => a.waPhoneId === waPhoneId) || db.agencias[0];

            db.mensajes.unshift({
              id: msgData.id || Date.now().toString(),
              numero: senderNum,
              nombre: change.value.contacts?.[0]?.profile?.name || senderNum,
              texto: textoMensaje,
              mediaUrl: mediaUrl,
              mediaType: msgType,
              timestamp: new Date(),
              leido: false, // Punto Rojo para no leídos
              agenciaId: ag.id,
              origen: 'inbound',
              direccion: 'inbound',
              kanban: 'nuevo',
              etiqueta: 'roja'
            });

            if (db.mensajes.length > 20000) db.mensajes = db.mensajes.slice(0, 20000);
            write(db);
          }
        });
      });
    } catch (err) {
      console.error('[META WEBHOOK ERROR]', err.message);
    }
    return res.status(200).send('EVENT_RECEIVED');
  }
  return res.sendStatus(404);
});

// ------------------------------------------------------------------
// AUTENTICACIÓN Y ACTIVACIÓN
// ------------------------------------------------------------------
app.post('/api/public/solicitar-codigo', async (req, res) => {
  const { email, tipo } = req.body;
  if (!email) return res.status(400).json({ error: 'Falta correo' });
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  const db = read();
  db.codigos = db.codigos.filter((c) => !(c.email.toLowerCase() === email.toLowerCase() && c.tipo === tipo));
  db.codigos.push({ email: email.toLowerCase(), codigo, tipo, expira: new Date(Date.now() + 15 * 60000) });
  write(db);

  if (useResend) {
    try {
      await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM_FIXED,
          to: email,
          subject: `KLIDO - Código ${tipo}`,
          html: `<div style="font-family:Inter;background:#f8fafc;padding:24px"><div style="background:#0b1a3a;color:#fff;padding:16px;border-radius:12px"><b>KLIDO</b> - Avanza Consulting</div><h2>Código de seguridad</h2><p style="font-size:32px;letter-spacing:6px;font-weight:900">${codigo}</p><p>Expira en 15 minutos. Soporte https://wa.me/${WPP}</p></div>`
        })
      });
      return res.json({ ok: true, mensaje: `Código enviado a ${email}` });
    } catch (e) {}
  }
  if (transporter) {
    try {
      await transporter.sendMail({ from: `KLIDO <${process.env.SMTP_USER}>`, to: email, subject: `KLIDO Código ${tipo}`, html: `<h2>${codigo}</h2>` });
      return res.json({ ok: true, mensaje: `Código enviado a ${email}` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  return res.json({ ok: true, codigoPrueba: codigo, mensaje: 'Modo pruebas: código generado en servidor' });
});

app.post('/api/public/verificar-codigo', (req, res) => {
  const db = read();
  const c = db.codigos.find((x) => x.email.toLowerCase() === req.body.email.toLowerCase() && x.codigo === req.body.codigo && new Date(x.expira) > new Date());
  if (!c) return res.status(400).json({ error: 'Código inválido o expirado' });
  res.json({ ok: true });
});

app.post('/api/public/crear-empresa', (req, res) => {
  const { nombre, email, password, plan, codigo, aceptoTerminos } = req.body;
  if (!aceptoTerminos) return res.status(400).json({ error: 'Debes aceptar términos según Ley 1581 Habeas Data' });
  const db = read();
  if (db.agencias.length >= MAX_AGENCIAS) return res.status(400).json({ error: `Capacidad máxima alcanzada (${MAX_AGENCIAS} empresas). Contacta a WPP ${WPP}` });

  const v = db.codigos.find((x) => x.email.toLowerCase() === email.toLowerCase() && x.codigo === codigo && x.tipo === 'registro' && new Date(x.expira) > new Date());
  if (!v) return res.status(400).json({ error: 'Código de verificación inválido' });

  if (db.usuarios.find((u) => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'El correo ya se encuentra registrado' });

  const p = normalizaPlan(plan);
  const agenciaId = 'AG-' + Date.now().toString(36).toUpperCase();
  const id = Date.now().toString();
  const isAcol = nombre.toLowerCase().includes('acol');

  db.agencias.push({
    id: agenciaId,
    nombre,
    email,
    plan: p,
    estado: 'pendiente_gerente',
    pagado: false,
    codigoActivacion: null,
    creado: new Date(),
    mantenimiento: 'pendiente pago inicial',
    whiteLabel: null,
    waPhoneId: isAcol ? ACOL_WA_ID : '',
    waBusinessId: isAcol ? ACOL_WA_ID : '',
    onboarding: { paso1: false, paso2: false, paso3: false }
  });

  db.usuarios.push({
    id,
    nombre,
    email,
    rol: 'jefe',
    plan: p,
    agenciaId,
    password: bcrypt.hashSync(password, 10)
  });

  db.notificacionesGerente.unshift({
    id: 'NOTIF-' + Date.now(),
    tipo: 'NUEVA_EMPRESA_PENDIENTE',
    empresaId: agenciaId,
    nombre,
    email,
    plan: p,
    fecha: new Date().toISOString(),
    leida: false
  });

  db.codigos = db.codigos.filter((x) => x.email.toLowerCase() !== email.toLowerCase());
  write(db);

  res.json({
    ok: true,
    mensaje: `Empresa creada. Queda pendiente de activación por Gerencia. Se desbloqueará únicamente el plan ${p.toUpperCase()} que contrataste.`
  });
});

app.post('/api/admin/activar', auth, async (req, res) => {
  if (req.user.rol !== 'super' && req.user.email !== 'avanzaconsultingyl@gmail.com' && req.user.email !== 'admin@klido.com') {
    return res.status(403).json({ error: 'Acceso exclusivo de Gerencia General Avanza Consulting' });
  }
  const db = read();
  const ag = db.agencias.find((a) => a.id === req.body.agenciaId);
  if (!ag) return res.status(404).json({ error: 'Agencia no encontrada' });

  const codigoAct = 'KLIDO-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
  ag.codigoActivacion = codigoAct;
  ag.estado = 'activa';
  ag.pagado = true;
  ag.mantenimiento = 'al día';
  ag.fechaPago = new Date();
  ag.venceAnual = new Date(Date.now() + 365 * 24 * 3600 * 1000);

  db.codigosActivacion = db.codigosActivacion || [];
  db.codigosActivacion.push({ agenciaId: ag.id, email: ag.email, codigo: codigoAct, creado: new Date(), plan: ag.plan });
  write(db);

  res.json({ ok: true, codigo: codigoAct, mensaje: `Agencia ${ag.nombre} activada. Código enviado a ${ag.email}` });
});

app.post('/api/login', (req, res) => {
  const db = read();
  const u = db.usuarios.find((x) => x.email.toLowerCase() === req.body.email.toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password, u.password)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const ag = db.agencias.find((a) => a.id === u.agenciaId);
  if (ag && ag.estado === 'bloqueada') {
    return res.status(403).json({ error: `Su plan o empresa se encuentra bloqueado. Contacte a soporte: https://wa.me/${WPP}` });
  }
  if (ag && ag.estado === 'pendiente_gerente') {
    return res.status(403).json({ error: `Cuenta pendiente de activación. Su código se enviará a ${ag.email} tras confirmar el pago.` });
  }

  const token = jwt.sign({ id: u.id, email: u.email, rol: u.rol, nombre: u.nombre, plan: u.plan, agenciaId: u.agenciaId }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      id: u.id,
      email: u.email,
      rol: u.rol,
      nombre: u.nombre,
      plan: u.plan,
      agenciaId: u.agenciaId,
      limites: getPlan(u.plan),
      waPhoneId: ag?.waPhoneId || ''
    }
  });
});

// ------------------------------------------------------------------
// INBOX, MENSAJES Y KANBAN
// ------------------------------------------------------------------
app.get('/api/mensajes', auth, (req, res) => {
  const db = read();
  let msgs = db.mensajes.filter((m) => m.agenciaId === req.user.agenciaId);

  if (req.query.filtro === 'noleidos') msgs = msgs.filter((m) => !m.leido);
  if (req.query.filtro === 'campana') msgs = msgs.filter((m) => m.origen === 'campana');
  if (req.user.rol === 'agente') msgs = msgs.filter((m) => !m.asignadoA || m.asignadoA === req.user.id);

  res.json(
    msgs
      .slice(-1000)
      .reverse()
      .map((m) => ({
        ...m,
        etiquetaPunto: !m.leido ? 'rojo' : m.origen === 'campana' ? 'amarillo' : null
      }))
  );
});

app.post('/api/mensajes/leer', auth, (req, res) => {
  const db = read();
  const m = db.mensajes.find((x) => x.id == req.body.id && x.agenciaId === req.user.agenciaId);
  if (m) {
    m.leido = true;
    if (!m.kanban) m.kanban = 'nuevo';
    write(db);
  }
  res.json({ ok: true });
});

app.post('/api/mensajes/enviar', auth, (req, res) => {
  const { numero, texto } = req.body;
  if (!numero || !texto) return res.status(400).json({ error: 'Número y texto son obligatorios' });
  const db = read();

  const msg = {
    id: Date.now().toString(),
    agenciaId: req.user.agenciaId,
    numero,
    nombre: numero,
    texto: String(texto),
    timestamp: new Date(),
    leido: true,
    direccion: 'outbound',
    origen: 'outbound',
    kanban: 'negociacion',
    mediaUrl: null,
    mediaType: 'texto'
  };

  db.mensajes.unshift(msg);
  if (db.mensajes.length > 15000) db.mensajes = db.mensajes.slice(0, 15000);
  write(db);
  res.json({ ok: true, msg });
});

const up = multer({ dest: UP_DIR });
app.post('/api/mensajes/media', auth, up.single('file'), (req, res) => {
  const db = read();
  const tipo = req.body.tipo || 'archivo';
  const numero = req.body.numero;
  if (!req.file) return res.status(400).json({ error: 'Archivo no adjuntado' });

  const url = `/uploads/${req.file.filename}`;
  db.mensajes.unshift({
    id: Date.now().toString(),
    numero: numero || 'media',
    nombre: req.user.nombre,
    texto: req.body.texto || `[${tipo.toUpperCase()}] ${req.file.originalname}`,
    mediaUrl: url,
    mediaType: tipo,
    timestamp: new Date(),
    leido: true,
    agenciaId: req.user.agenciaId,
    origen: 'outbound',
    direccion: 'outbound',
    kanban: 'negociacion'
  });
  write(db);
  res.json({ ok: true, url, tipo });
});

app.get('/api/kanban', auth, (req, res) => {
  const db = read();
  const msgs = db.mensajes.filter((m) => m.agenciaId === req.user.agenciaId);
  const kanban = { nuevo: [], negociacion: [], cotizado: [], ganado: [], perdido: [] };
  msgs.forEach((m) => {
    const etapa = m.kanban || 'nuevo';
    if (kanban[etapa]) kanban[etapa].push(m);
    else kanban.nuevo.push(m);
  });
  res.json(kanban);
});

// ------------------------------------------------------------------
// CAMPAÑAS Y CARGA DE EXCEL
// ------------------------------------------------------------------
app.post('/api/campanas/upload', auth, up.single('file'), (req, res) => {
  try {
    const wb = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const numeros = [
      ...new Set(
        data
          .map((r) => {
            let v = Object.values(r)[0];
            if (!v) return null;
            let n = String(v).replace(/\D/g, '');
            if (n.length === 10) n = '57' + n;
            return n;
          })
          .filter(Boolean)
      )
    ];

    const db = read();
    const p = getPlan(db.agencias.find((a) => a.id === req.user.agenciaId)?.plan || req.user.plan);
    if (numeros.length > p.maxContactos) return res.status(400).json({ error: `El plan ${p.nombre} permite máximo ${p.maxContactos} contactos.` });

    const id = Date.now().toString();
    const camp = {
      id,
      nombre: `Campaña ${new Date().toLocaleDateString()}`,
      total: numeros.length,
      numeros,
      contactos_ids: numeros,
      enviados: 0,
      estado: 'pendiente',
      fecha: new Date(),
      por: req.user.email,
      agenciaId: req.user.agenciaId,
      logs: []
    };

    db.campanas = db.campanas || [];
    db.campanas.push(camp);
    write(db);
    res.json({ ok: true, detectados: numeros.length, contactos_ids: numeros, campanaId: id, total: numeros.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------------
// INTEGRACIÓN DE INTELIGENCIA ARTIFICIAL (IA)
// ------------------------------------------------------------------
app.post('/api/ia/resumen', auth, async (req, res) => {
  const db = read();
  const ag = db.agencias.find((a) => a.id === req.user.agenciaId);
  const p = getPlan(ag?.plan || req.user.plan);

  if (!p.ia) {
    return res.status(403).json({ error: `Las funciones de IA están disponibles únicamente en planes Premium e IA Gold. Adquiere tu plan en https://wa.me/${WPP}` });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.json({
      ok: true,
      resumen: `[MOCK IA] Cliente con interés alto. Solicitó información del plan ${p.nombre}. Se sugiere agendar llamada de cierre.`
    });
  }

  try {
    const response = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Eres un analista de CRM experto. Genera un resumen ejecutivo breve de la conversación y sugiere la acción de seguimiento clave.' },
          { role: 'user', content: req.body.conversacion || `Historial de mensajes con el número ${req.body.numero}` }
        ]
      })
    });
    const data = await response.json();
    const resumen = data.choices?.[0]?.message?.content || 'No se pudo generar el resumen.';
    res.json({ ok: true, resumen });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// PANEL GERENTE GENERAL (AVANZA CONSULTING)
// ------------------------------------------------------------------
app.get('/api/gerente/agencias', auth, (req, res) => {
  if (req.user.rol !== 'super' && req.user.email !== 'avanzaconsultingyl@gmail.com') {
    return res.status(403).json({ error: 'Acceso reservado para la Gerencia General' });
  }
  const db = read();
  const resumen = db.agencias.map((ag) => {
    const usuarios = db.usuarios.filter((u) => u.agenciaId === ag.id);
    const mensajes = db.mensajes.filter((m) => m.agenciaId === ag.id);
    return {
      ...ag,
      totalUsuarios: usuarios.length,
      totalMensajes: mensajes.length
    };
  });
  res.json(resumen);
});

app.post('/api/gerente/bloquear', auth, (req, res) => {
  if (req.user.rol !== 'super' && req.user.email !== 'avanzaconsultingyl@gmail.com') {
    return res.status(403).json({ error: 'Acceso reservado para la Gerencia General' });
  }
  const db = read();
  const ag = db.agencias.find((a) => a.id === req.body.agenciaId);
  if (!ag) return res.status(404).json({ error: 'Agencia no encontrada' });

  ag.estado = req.body.bloquear ? 'bloqueada' : 'activa';
  write(db);
  res.json({ ok: true, estado: ag.estado });
});

// ------------------------------------------------------------------
// CONTRATO DIGITAL (LEGALIDAD COLOMBIA - LEY 1581)
// ------------------------------------------------------------------
app.get('/api/contrato/:agenciaId', auth, (req, res) => {
  const db = read();
  const ag = db.agencias.find((a) => a.id === req.params.agenciaId);
  if (!ag) return res.status(404).send('Agencia no encontrada');
  const p = getPlan(ag.plan);

  res.send(`
    <html>
      <head>
        <title>Contrato Servicio CRM Klido - ${ag.nombre}</title>
        <style>
          body { font-family: sans-serif; padding: 40px; color: #0b1a3a; line-height: 1.6; }
          .box { border: 2px solid #0b1a3a; border-radius: 12px; padding: 30px; max-width: 800px; margin: 0 auto; }
          h1 { color: #0b1a3a; border-bottom: 2px solid #0b1a3a; padding-bottom: 10px; }
          .btn { background: #0b1a3a; color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>KLIDO - CONTRATO DE PRESTACIÓN DE SERVICIOS CRM</h1>
          <p><b>Razón Social / Empresa:</b> ${ag.nombre}</p>
          <p><b>Correo Electrónico Registrado:</b> ${ag.email}</p>
          <p><b>Plan Suscrito:</b> ${ag.plan.toUpperCase()}</p>
          <p><b>Valor Anual:</b> $${p.precioAnual.toLocaleString('es-CO')} COP (+ Mantenimiento Trimestral: $${p.mant.toLocaleString('es-CO')} COP)</p>
          <p><b>Código Único de Activación:</b> ${ag.codigoActivacion || 'PENDIENTE'}</p>
          <hr>
          <h3>TÉRMINOS Y CONDICIONES (COLOMBIA)</h3>
          <p>1. <b>Protección de Datos:</b> En cumplimiento de la Ley 1581 de 2012 de Colombia (Habeas Data), KLIDO y Avanza Consulting garantizan el aislamiento confidencial de los datos de su agencia. No habrá cruce ni filtración de información entre agencias inscritas.</p>
          <p>2. <b>Conexión Oficial:</b> La mensajería opera mediante la integración oficial con la API de Meta (WhatsApp Cloud API).</p>
          <button class="btn" onclick="window.print()">Imprimir o Descargar PDF</button>
        </div>
      </body>
    </html>
  `);
});

// Configuración general del sistema
app.get('/api/config', (req, res) =>
  res.json({
    empresa: 'KLIDO Avanza',
    wpp: WPP,
    maxAgencias: MAX_AGENCIAS,
    planes: PLANES,
    acolWaId: ACOL_WA_ID,
    ayuda: `https://wa.me/${WPP}?text=Soporte%20KLIDO`
  })
);

app.listen(PORT, () => {
  console.log(`[KLIDO v12.0 ENGINE OK] Servidor ejecutándose en el puerto ${PORT}`);
});
