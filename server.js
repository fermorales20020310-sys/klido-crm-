const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const JWT_SECRET = process.env.JWT_SECRET || 'klido_v109_legal';

app.use(cors()); app.use(express.json({limit:'10mb'}));
app.use(express.static(__dirname));

// --- RUTAS LEGALES Y VISTAS ---
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));
app.get('/legal', (req,res)=> res.sendFile(path.join(__dirname,'legal.html')));
app.get('/campanas', (req,res)=> res.sendFile(path.join(__dirname,'campanas.html')));

// --- AUTH ---
const auth = (req,res,next)=>{
  try{
    const token = req.headers.authorization?.split(' ')[1];
    if(!token) return res.status(401).json({error:'No token'});
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  }catch(e){ res.status(401).json({error:'Token invalido'}) }
};

// BLOQUEO REAL POR PLAN - NUEVO V10.9
const checkPlan = (permiso) => async (req,res,next)=>{
  try{
    const comp = await pool.query('SELECT plan FROM companies WHERE id=$1',[req.user.companyId]);
    const plan = comp.rows[0]?.plan || 'basico';
    const permisos = {
      basico: ['inbox'],
      premium: ['inbox','campanas','ia_basica'],
      gold: ['inbox','campanas','ia_basica','ia_avanzada','llamadas']
    };
    if(!permisos[plan]?.includes(permiso) && permiso!== 'inbox'){
      return res.status(403).json({error:`Tu plan ${plan} no incluye ${permiso}. Actualiza a Premium/Gold - Soporte 3133181851`});
    }
    next();
  }catch(e){ next() }
};

// LOGIN + CREAR EMPRESA CON PLAN Y MANTENIMIENTO
app.post('/api/auth/login', async (req,res)=>{
  const { companyId, email, password, plan } = req.body;
  try{
    // Si viene plan, es registro nuevo
    if(plan){
      const hash = await bcrypt.hash(password,10);
      const mantenimiento = plan==='basico'?80000:plan==='premium'?95000:125000;
      await pool.query(`INSERT INTO companies (id, plan, mantenimiento, created_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (id) DO UPDATE SET plan=$2, mantenimiento=$3`,[companyId,plan,mantenimiento]);
      await pool.query(`INSERT INTO users (company_id, email, password, role) VALUES ($1,$2,$3,'admin') ON CONFLICT DO NOTHING`,[companyId,email,hash]);
    }
    const user = await pool.query('SELECT * FROM users WHERE company_id=$1 AND email=$2',[companyId,email]);
    if(!user.rows[0]) return res.status(404).json({error:'Empresa o usuario no existe'});
    const ok = await bcrypt.compare(password, user.rows[0].password);
    if(!ok) return res.status(401).json({error:'Clave incorrecta'});
    const token = jwt.sign({companyId, email, role:user.rows[0].role, id:user.rows[0].id}, JWT_SECRET);
    const comp = await pool.query('SELECT * FROM companies WHERE id=$1',[companyId]);
    res.json({token, company:comp.rows[0], user:user.rows[0]});
  }catch(e){ console.error(e); res.status(500).json({error:e.message}) }
});

// --- RUTAS PROTEGIDAS CON BLOQUEO ---
app.get('/api/messages', auth, async (req,res)=>{
  const q = req.user.role==='worker'? `SELECT * FROM messages WHERE company_id=$1 AND assigned_to=$2 ORDER BY created_at DESC` : `SELECT * FROM messages WHERE company_id=$1 ORDER BY created_at DESC`;
  const params = req.user.role==='worker'? [req.user.companyId, req.user.id] : [req.user.companyId];
  const r = await pool.query(q, params); res.json(r.rows);
});

app.post('/api/campaigns/start', auth, checkPlan('campanas'), async (req,res)=>{
  // tu logica de campaña con antibaneo 50/5h + 3s
  res.json({ok:true, msg:'Campaña iniciada - antibaneo activo'});
});

app.post('/api/calls/start', auth, checkPlan('llamadas'), async (req,res)=>{
  res.json({ok:true});
});

app.get('/api/metrics', auth, async (req,res)=>{
  const c = await pool.query('SELECT plan, mantenimiento FROM companies WHERE id=$1',[req.user.companyId]);
  res.json({plan:c.rows[0]?.plan, mantenimiento:c.rows[0]?.mantenimiento, soporte:'3133181851'});
});

app.listen(PORT, ()=> console.log('Klido V10.9 Legal corriendo en '+PORT));
