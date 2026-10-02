const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_secret_key_v112_pro';

// === FIX CORREO v112.6 - NO TOCAR ===
const RESEND_FROM_FIXED = process.env.RESEND_FROM || 'KLIDO <soporte@klidoapp.com.co>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const useResend = !!RESEND_API_KEY;
let fetchFn = global.fetch;
if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }
console.log('[CONFIG] FROM:', RESEND_FROM_FIXED);
console.log('[CONFIG] RESEND KEY:', RESEND_API_KEY ? 'OK '+RESEND_API_KEY.slice(0,12)+'...' : 'FALTA - configura en Railway');
// === FIN FIX ===

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const codigosVerificacion = new Map();
const DATA_DIR = path.join(__dirname, 'data');
const EMPRESAS_FILE = path.join(DATA_DIR, 'empresas.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE, JSON.stringify([]));

function obtenerEmpresas() {
  try { return JSON.parse(fs.readFileSync(EMPRESAS_FILE, 'utf8')); } catch { return []; }
}
function guardarEmpresas(empresas) {
  fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(empresas, null, 2));
}

// 1. SOLICITAR CODIGO - AHORA SI ENVIA CON RESEND
app.post('/api/public/solicitar-codigo', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'El correo electrónico es requerido.' });

  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  codigosVerificacion.set(email.toLowerCase(), {
    codigo,
    expira: Date.now() + 10 * 60 * 1000
  });

  console.log(`[KLIDO v112.6] Código para ${email}: ${codigo}`);

  if (useResend && fetchFn) {
    try {
      const r = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM_FIXED,
          to: email.toLowerCase(),
          subject: `KLIDO - Tu código es ${codigo}`,
          html: `<div style="font-family:sans-serif;background:#f8fafc;padding:24px"><div style="max-width:480px;margin:auto;background:white;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden"><div style="background:#020917;padding:20px;color:white;font-weight:900">KLIDO - AVANZA CONSULTING</div><div style="padding:24px"><h2 style="margin:0 0 8px">Tu código de verificación</h2><p style="color:#64748b;font-size:13px">Expira en 10 minutos.</p><div style="background:#f1f5f9;border-radius:12px;padding:20px;text-align:center;margin:20px 0"><span style="font-size:32px;font-weight:900;letter-spacing:6px">${codigo}</span></div><p style="font-size:11px;color:#94a3b8">Si no solicitaste esto ignora el correo.</p></div></div></div>`
        })
      });
      const j = await r.json();
      console.log('[RESEND RESPONSE]', r.status, j);
      if (r.ok) return res.json({ ok: true, mensaje: `Código enviado a ${email}. Revisa SPAM si no lo ves.` });
      return res.status(500).json({ error: `Resend ${r.status}: ${j.message || JSON.stringify(j)}` });
    } catch (e) {
      console.log('[RESEND ERROR]', e.message);
      return res.status(500).json({ error: e.message });
    }
  }
  return res.json({ ok: true, mensaje: `Código (sin Resend): ${codigo}` });
});

// 2. REGISTRAR EMPRESA
app.post('/api/public/crear-empresa', (req, res) => {
  const { nombre, email, password, plan, codigo, aceptoTerminos } = req.body;
  if (!nombre || !email || !password || !plan || !codigo) return res.status(400).json({ error: 'Todos los campos son obligatoriamente requeridos.' });
  if (!aceptoTerminos) return res.status(400).json({ error: 'Debes aceptar los Términos de la Ley 1581.' });

  const reg = codigosVerificacion.get(email.toLowerCase());
  if (!reg || reg.codigo !== codigo) return res.status(400).json({ error: 'El código es incorrecto o ha expirado.' });
  if (Date.now() > reg.expira) { codigosVerificacion.delete(email.toLowerCase()); return res.status(400).json({ error: 'El código ha caducado. Solicita uno nuevo.' }); }

  const empresas = obtenerEmpresas();
  if (empresas.find(e => e.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Ya existe una cuenta con este correo.' });

  const nueva = { id: 'emp_'+Date.now(), nombre, email: email.toLowerCase(), password, plan, estado: 'pendiente_aprobacion', aceptoTerminosLey1581: true, fechaRegistro: new Date().toISOString() };
  empresas.push(nueva);
  guardarEmpresas(empresas);
  codigosVerificacion.delete(email.toLowerCase());

  return res.status(201).json({ ok: true, mensaje: 'Empresa registrada. Pendiente aprobación Gerencia.' });
});

// 3. LOGIN
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Por favor ingresa correo y contraseña.' });
  const empresas = obtenerEmpresas();
  const empresa = empresas.find(e => e.email.toLowerCase() === email.toLowerCase() && e.password === password);
  if (!empresa) return res.status(401).json({ error: 'Credenciales inválidas.' });
  if (empresa.estado === 'pendiente_aprobacion') return res.status(403).json({ error: 'Tu empresa aún no ha sido activada por Gerencia.' });
  const token = jwt.sign({ id: empresa.id, email: empresa.email, plan: empresa.plan }, JWT_SECRET, { expiresIn: '24h' });
  return res.json({ ok: true, token, user: { id: empresa.id, nombre: empresa.nombre, email: empresa.email, plan: empresa.plan } });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('==================================================');
  console.log(' KLIDO CRM Multiagencia Cloud API v112.6 FIX RESEND');
  console.log(` FROM: ${RESEND_FROM_FIXED}`);
  console.log(` PORT: ${PORT}`);
  console.log('==================================================');
});
