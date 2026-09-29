const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
const JWT_SECRET = process.env.JWT_SECRET || 'klido_v11_real_pro_3133181851';

app.use(cors());
app.use(express.json({limit:'20mb'}));

// LOG para ver que archivos subieron realmente a Railway
console.log('=== ARCHIVOS EN RAILWAY ===');
try{ console.log(fs.readdirSync(__dirname)); }catch(e){ console.log('Error listando', e.message) }

app.use(express.static(__dirname));

// --- TABLAS ---
(async()=>{
  try{
  await pool.query(`CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, plan TEXT, mantenimiento INT, precio_anual INT, created_at TIMESTAMP)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, company_id TEXT, email TEXT, password TEXT, role TEXT, name TEXT, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(company_id,email))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, company_id TEXT, from_number TEXT, content TEXT, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, company_id TEXT, name TEXT, template_name TEXT, total INT, status TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  console.log('Tablas OK');
  }catch(e){ console.error('DB error', e.message) }
})();

const auth = (req,res,next)=>{
  try{
    const token = req.headers.authorization?.split(' ')[1];
    if(!token) return res.status(401).json({error:'No token'});
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  }catch(e){ res.status(401).json({error:'Token invalido'}) }
};

// LOGIN
app.post('/api/auth/login', async (req,res)=>{
  const { companyId, email, password, plan } = req.body;
  try{
    if(plan){
      const hash = await bcrypt.hash(password,10);
      const precios = { basico:{m:80000, anual:800000}, premium:{m:95000, anual:1300000}, gold:{m:125000, anual:2400000} };
      const p = precios[plan] || precios.basico;
      await pool.query(`INSERT INTO companies (id, plan, mantenimiento, precio_anual, created_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (id) DO UPDATE SET plan=$2, mantenimiento=$3, precio_anual=$4`,[companyId,plan,p.m,p.anual]);
      await pool.query(`INSERT INTO users (company_id, email, password, role, name) VALUES ($1,$2,$3,'admin',$2) ON CONFLICT (company_id,email) DO NOTHING`,[companyId,email,hash]);
    }
    const user = await pool.query('SELECT * FROM users WHERE company_id=$1 AND email=$2',[companyId,email]);
    if(!user.rows[0]) return res.status(404).json({error:'Empresa no existe'});
    const ok = await bcrypt.compare(password, user.rows[0].password);
    if(!ok) return res.status(401).json({error:'Clave incorrecta'});
    const token = jwt.sign({companyId, email, role:user.rows[0].role, id:user.rows[0].id}, JWT_SECRET);
    const comp = await pool.query('SELECT * FROM companies WHERE id=$1',[companyId]);
    res.json({token, company:comp.rows[0], user:user.rows[0]});
  }catch(e){ console.error(e); res.status(500).json({error:e.message}) }
});

app.get('/api/messages', auth, async (req,res)=>{ const r = await pool.query(`SELECT * FROM messages WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100`,[req.user.companyId]); res.json(r.rows); });

// DEBUG - ver archivos
app.get('/api/debug/files', (req,res)=>{ try{ res.json({files: fs.readdirSync(__dirname), dirname: __dirname}); }catch(e){ res.json({error:e.message}) } });

// --- RUTAS CON FALLBACK ANTINOTFOUND ---
function serveOrFallback(res){
  const filePath = path.join(__dirname,'index.html');
  if(fs.existsSync(filePath)){
    return res.sendFile(filePath);
  }else{
    console.log('index.html NO EXISTE en Railway, usando fallback inline');
    return res.send(`
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Klido CRM V11 - 3133181851</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0f172a;color:#e2e8f0;font-family:system-ui}.login-card{max-width:480px;margin:40px auto;background:#1e293b;border:1px solid #334155;border-radius:20px;padding:28px} input,select{width:100%;background:#0f172a;border:1px solid #334155;color:#fff;padding:12px;border-radius:10px;margin:7px 0}.plans{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.plan{border:1px solid #334155;border-radius:12px;padding:10px;text-align:center;cursor:pointer}.plan.selected{border-color:#38bdf8;background:#0b3a4a}.btn{width:100%;background:#38bdf8;color:#000;border:0;padding:13px;border-radius:12px;font-weight:800;cursor:pointer;margin-top:10px}.badge{background:#10b981;color:#fff;padding:3px 10px;border-radius:20px;font-size:10px} </style></head>
<body><div class="login-card"><h1>Klido CRM <span class="badge">V11.2 ONLINE</span></h1><p style="color:#94a3b8;font-size:12px">Servidor prendido pero index.html no se subió a Railway. Sube tu index.html a GitHub</p><p style="color:#f87171;font-size:11px">DEBUG: Archivos que SI están: ${fs.readdirSync(__dirname).join(', ')}</p>
<input id="companyId" placeholder="ID Empresa"><input id="email" placeholder="Email"><input id="password" type="password" placeholder="Clave"><div class="plans"><div class="plan selected" data-plan="basico" onclick="selectPlan(this)"><b>Básico</b><div style="color:#38bdf8;font-size:11px">$800k + $80k</div></div><div class="plan" data-plan="premium" data-plan="premium" onclick="selectPlan(this)"><b>Premium</b><div style="color:#38bdf8;font-size:11px">$1.3M + $95k</div></div><div class="plan" data-plan="gold" onclick="selectPlan(this)"><b>Gold</b><div style="color:#38bdf8;font-size:11px">$2.4M + $125k</div></div></div><label style="font-size:11px;color:#94a3b8"><input type="checkbox" id="legalCheck"> Acepto términos /legal</label><button class="btn" onclick="login()">Entrar / Crear</button><div id="msg" style="color:#f87171;font-size:12px;margin-top:8px"></div><div style="margin-top:10px;background:#0b1220;padding:10px;border-radius:10px;font-size:11px;text-align:center">Soporte 24/7 3133181851</div></div>
<script>let sp='basico';function selectPlan(e){document.querySelectorAll('.plan').forEach(p=>p.classList.remove('selected'));e.classList.add('selected');sp=e.dataset.plan}async function login(){const c=document.getElementById('companyId').value.toLowerCase(),em=document.getElementById('email').value,p=document.getElementById('password').value;if(!c||!em||!p)return document.getElementById('msg').innerText='Completa';try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:c,email:em,password:p,plan:sp})});const d=await r.json();if(!r.ok)throw new Error(d.error);localStorage.setItem('token',d.token);alert('Login OK Plan:'+d.company.plan+' Soporte 3133181851');}catch(e){document.getElementById('msg').innerText=e.message}}<\/script></body></html>`);
  }
}

app.get('/', (req,res)=> serveOrFallback(res));
app.get('/legal', (req,res)=>{ const fp=path.join(__dirname,'legal.html'); if(fs.existsSync(fp)) return res.sendFile(fp); return res.send('Legal Ley 1581 - Soporte 3133181851'); });
app.get('/campanas', (req,res)=>{ const fp=path.join(__dirname,'campanas.html'); if(fs.existsSync(fp)) return res.sendFile(fp); return res.send('Campañas - Soporte 3133181851'); });

app.get('*', (req,res)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'API no encontrada'});
  return serveOrFallback(res);
});

app.listen(PORT, ()=> console.log('Klido V11.2 ONLINE en '+PORT));
