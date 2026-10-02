const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_secret_key_v112_pro';

// Middlewares para procesar JSON y datos de formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos desde la carpeta public (incluye index.html, crm.html y logo.png)
app.use(express.static(path.join(__dirname, 'public')));

// Almacenamiento temporal de códigos de verificación en memoria
const codigosVerificacion = new Map();

// Base de datos local simple en archivo JSON (/data/empresas.json)
const DATA_DIR = path.join(__dirname, 'data');
const EMPRESAS_FILE = path.join(DATA_DIR, 'empresas.json');

// Crear directorio de datos si no existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Inicializar archivo de base de datos si no existe
if (!fs.existsSync(EMPRESAS_FILE)) {
  fs.writeFileSync(EMPRESAS_FILE, JSON.stringify([]));
}

// Helpers para leer y escribir empresas
function obtenerEmpresas() {
  try {
    const data = fs.readFileSync(EMPRESAS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function guardarEmpresas(empresas) {
  fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(empresas, null, 2));
}

// ==========================================
// RUTAS DE LA API (ALINEADAS AL INDEX.HTML)
// ==========================================

// 1. SOLICITAR CÓDIGO DE 6 DÍGITOS
app.post('/api/public/solicitar-codigo', (req, res) => {
  const { email, tipo } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'El correo electrónico es requerido.' });
  }

  // Generar código aleatorio de 6 dígitos
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Guardar en memoria con expiración de 10 minutos
  codigosVerificacion.set(email.toLowerCase(), {
    codigo,
    expira: Date.now() + 10 * 60 * 1000
  });

  console.log(`[KLIDO v112] Código generado para ${email}: ${codigo}`);

  // AQUÍ PUEDES INTEGRAR TU SERVICIO DE CORREO (Nodemailer, SendGrid, etc.)
  // Por ahora confirmamos la emisión
  return res.json({
    ok: true,
    mensaje: `Código de verificación enviado exitosamente a ${email}. Revisa la carpeta de spam.`
  });
});

// 2. REGISTRAR EMPRESA (CON PLAN Y LEY 1581)
app.post('/api/public/crear-empresa', (req, res) => {
  const { nombre, email, password, plan, codigo, aceptoTerminos } = req.body;

  // Validaciones
  if (!nombre || !email || !password || !plan || !codigo) {
    return res.status(400).json({ error: 'Todos los campos son obligatoria mente requeridos.' });
  }

  if (!aceptoTerminos) {
    return res.status(400).json({ error: 'Debes aceptar los Términos de la Ley 1581.' });
  }

  // Validar código de verificación
  const registroCodigo = codigosVerificacion.get(email.toLowerCase());
  
  if (!registroCodigo || registroCodigo.codigo !== codigo) {
    return res.status(400).json({ error: 'El código de 6 dígitos es incorrecto o ha expirado.' });
  }

  if (Date.now() > registroCodigo.expira) {
    codigosVerificacion.delete(email.toLowerCase());
    return res.status(400).json({ error: 'El código ha caducado. Solicita uno nuevo.' });
  }

  const empresas = obtenerEmpresas();

  // Verificar si la empresa/correo ya existe
  const existe = empresas.find(e => e.email.toLowerCase() === email.toLowerCase());
  if (existe) {
    return res.status(400).json({ error: 'Ya existe una cuenta vinculada a este correo.' });
  }

  // Crear nueva empresa (Estado pendiente de aprobación por Gerencia)
  const nuevaEmpresa = {
    id: 'emp_' + Date.now(),
    nombre,
    email: email.toLowerCase(),
    password, // En producción se recomienda hashear con bcrypt
    plan, // 'basico', 'premium' o 'gold'
    estado: 'pendiente_aprobacion', // Requiere código de desbloqueo de Gerencia
    aceptoTerminosLey1581: true,
    fechaRegistro: new Date().toISOString()
  };

  empresas.push(nuevaEmpresa);
  guardarEmpresas(empresas);

  // Limpiar código usado
  codigosVerificacion.delete(email.toLowerCase());

  return res.status(201).json({
    ok: true,
    mensaje: 'Empresa registrada con éxito. Queda pendiente para aprobación y envío del código de desbloqueo por Gerencia.'
  });
});

// 3. LOGIN DE USUARIOS/AGENCIAS
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Por favor ingresa correo y contraseña.' });
  }

  const empresas = obtenerEmpresas();
  const empresa = empresas.find(e => e.email.toLowerCase() === email.toLowerCase() && e.password === password);

  if (!empresa) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  if (empresa.estado === 'pendiente_aprobacion') {
    return res.status(403).json({ 
      error: 'Tu empresa aún no ha sido activada por Gerencia. Revisa tu correo para el código de desbloqueo.' 
    });
  }

  // Generar Token JWT
  const token = jwt.sign(
    { id: empresa.id, email: empresa.email, plan: empresa.plan },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  return res.json({
    ok: true,
    token,
    user: {
      id: empresa.id,
      nombre: empresa.nombre,
      email: empresa.email,
      plan: empresa.plan
    }
  });
});

// Ruta fallback para el index frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar Servidor
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` KLIDO CRM Multiagencia Cloud API v112`);
  console.log(` Servidor corriendo en: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
