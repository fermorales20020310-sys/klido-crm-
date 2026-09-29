const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const WPP = 'https://wa.me/573133181851?text=Hola%20quiero%20Klido%20Plan%20';
const upload = multer({dest:'uploads/'});

app.use(cors());
app.use(express.json({limit:'20mb'}));

console.log('=== KLIDO V11.3.2 REAL PRO ===');
console.log('FILES:', fs.readdirSync(__dirname));
console.log('HAS DB:',!!process.env.DATABASE_URL);

let pool;
try{
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
  (async()=>{
    try{
      await pool.query(`CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, plan TEXT, mantenimiento INT, precio_anual INT, created_at TIMESTAMP)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, company_id TEXT, email TEXT, password TEXT, role TEXT, name TEXT, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(company_id,email))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, company_id TEXT, from_number TEXT, content TEXT, status TEXT, assigned_to INT, is_campaign BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, company_id TEXT, name TEXT, template_name TEXT, total INT, enviados INT DEFAULT 0, status TEXT, created_by INT, created_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS campaign_logs (id SERIAL PRIMARY KEY, campaign_id INT, company_id TEXT, numero TEXT, status TEXT, error TEXT, created_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS templates (id SERIAL PRIMARY KEY, company_id TEXT, name TEXT, cuerpo TEXT, status TEXT DEFAULT 'APROBADA', updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(company_id,name))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, email TEXT, company_id TEXT, code TEXT, expires_at TIMESTAMP)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (id SERIAL PRIMARY KEY, company_id TEXT, user_id INT, accion TEXT, detalle TEXT, created_at TIMESTAMP DEFAULT NOW())`);
      console.log('DB OK');
    }catch(e){ console.error('DB init warn:', e.message) }
  })();
}catch(e){ console.error('Pool warn:', e.message); pool = { query: async()=>({rows:[]}) }; }

const JWT_SECRET = process.env.JWT_SECRET || 'klido_v11_real_pro_3133181851';
const auth = (req,res,next)=>{ try{ const t=req.headers.authorization?.split(' ')[1]; if(!t) return res.status(401).json({error:'No token'}); req.user=jwt.verify(t,JWT_SECRET); next(); }catch{ res.status(401).json({error:'Token invalido'}) } };
const isAdmin = (req,res,next)=>{ if(req.user.role!=='admin') return res.status(403).json({error:'Solo jefe'}); next(); };
const checkPlan = (p)=> async (req,res,next)=>{ try{ const c=await pool.query('SELECT plan FROM companies WHERE id=$1',[req.user.companyId]); const plan=c.rows[0]?.plan||'basico'; const perms={basico:['inbox','planes'], premium:['inbox','campanas','plantillas','planes','metricas_basicas'], gold:['inbox','campanas','plantillas','llamadas','ia','planes','metricas','workers']}; if(p!=='inbox'&&!perms[plan]?.includes(p)) return res.status(403).json({error:`Plan ${plan} no incluye ${p}`, wpp:WPP+p}); next(); }catch(e){ next(); } };

// LOGIN TUYO
app.post('/api/auth/login', async (req,res)=>{
 const { companyId, email, password, plan } = req.body;
 try{
  if(plan){ const h=await bcrypt.hash(password,10); const pr={basico:{m:80000,a:800000},premium:{m:95000,a:1300000},gold:{m:125000,a:2400000}}; const p=pr[plan]||pr.basico; await pool.query(`INSERT INTO companies (id,plan,mantenimiento,precio_anual,created_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (id) DO UPDATE SET plan=$2,mantenimiento=$3,precio_anual=$4`,[companyId,plan,p.m,p.a]); await pool.query(`INSERT INTO users (company_id,email,password,role,name) VALUES ($1,$2,$3,'admin',$2) ON CONFLICT (company_id,email) DO NOTHING`,[companyId,email,h]); }
  const u=await pool.query('SELECT * FROM users WHERE company_id=$1 AND email=$2',[companyId,email]); if(!u.rows[0]) return res.status(404).json({error:'Empresa no existe'}); const ok=await bcrypt.compare(password,u.rows[0].password); if(!ok) return res.status(401).json({error:'Clave incorrecta'}); const token=jwt.sign({companyId,email,role:u.rows[0].role,id:u.rows[0].id},JWT_SECRET); const comp=await pool.query('SELECT * FROM companies WHERE id=$1',[companyId]); try{await pool.query(`INSERT INTO audit_log (company_id,user_id,accion) VALUES ($1,$2,'login')`,[companyId,u.rows[0].id])}catch{} res.json({token,company:comp.rows[0],user:u.rows[0]});
 }catch(e){ res.status(500).json({error:e.message}) }
});
app.post('/api/auth/forgot', async (req,res)=>{ const {companyId,email}=req.body; const code=Math.floor(100000+Math.random()*900000).toString(); try{await pool.query(`INSERT INTO password_resets (email,company_id,code,expires_at) VALUES ($1,$2,$3,NOW()+INTERVAL '15 minutes')`,[email,companyId,code])}catch{} res.json({ok:true,demoCode:code}); });
app.post('/api/auth/reset', async (req,res)=>{ const {companyId,email,code,newPassword}=req.body; const r=await pool.query(`SELECT * FROM password_resets WHERE company_id=$1 AND email=$2 AND code=$3 AND expires_at>NOW() ORDER BY id DESC LIMIT 1`,[companyId,email,code]); if(!r.rows[0]) return res.status(400).json({error:'Codigo invalido'}); const h=await bcrypt.hash(newPassword,10); await pool.query(`UPDATE users SET password=$1 WHERE company_id=$2 AND email=$3`,[h,companyId,email]); res.json({ok:true}); });

app.get('/api/workers', auth, isAdmin, async (req,res)=>{ const r=await pool.query(`SELECT id,email,name,role FROM users WHERE company_id=$1`,[req.user.companyId]); res.json(r.rows); });
app.post('/api/workers', auth, isAdmin, async (req,res)=>{ const {email,password,name}=req.body; const h=await bcrypt.hash(password,10); await pool.query(`INSERT INTO users (company_id,email,password,role,name) VALUES ($1,$2,$3,'worker',$4)`,[req.user.companyId,email,h,name]); res.json({ok:true}); });
app.delete('/api/workers/:id', auth, isAdmin, async (req,res)=>{ await pool.query(`DELETE FROM users WHERE id=$1 AND company_id=$2`,[req.params.id,req.user.companyId]); res.json({ok:true}); });

app.get('/api/templates', auth, async (req,res)=>{ const r=await pool.query(`SELECT * FROM templates WHERE company_id=$1 ORDER BY updated_at DESC`,[req.user.companyId]); res.json(r.rows); });
app.post('/api/templates/sync', auth, checkPlan('plantillas'), async (req,res)=>{ await pool.query(`INSERT INTO templates (company_id,name,cuerpo,status) VALUES ($1,'bienvenida','Hola {{1}} bienvenido','APROBADA') ON CONFLICT (company_id,name) DO UPDATE SET status='APROBADA'`,[req.user.companyId]); await pool.query(`INSERT INTO templates (company_id,name,cuerpo,status) VALUES ($1,'promo_gold','Hola {{1}} oferta Gold','APROBADA') ON CONFLICT (company_id,name) DO UPDATE SET status='APROBADA'`,[req.user.companyId]); const r=await pool.query(`SELECT * FROM templates WHERE company_id=$1`,[req.user.companyId]); res.json(r.rows); });

app.post('/api/campaigns/upload', auth, checkPlan('campanas'), upload.single('file'), async (req,res)=>{ try{ const wb=xlsx.readFile(req.file.path); const data=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); const nums=data.map(row=>Object.values(row)[0]).filter(n=>n).map(n=>n.toString().replace(/\D/g,'')).filter(n=>n.length>=10); fs.unlinkSync(req.file.path); res.json({ok:true,total:nums.length,preview:nums.slice(0,5),numeros:nums}); }catch(e){ res.status(500).json({error:e.message}) } });
app.post('/api/campaigns/start', auth, checkPlan('campanas'), async (req,res)=>{ const {name,templateName,numeros}=req.body; const c=await pool.query(`INSERT INTO campaigns (company_id,name,template_name,total,created_by,status) VALUES ($1,$2,$3,$4,$5,'completada') RETURNING id`,[req.user.companyId,name,templateName,numeros.length,req.user.id]); for(let n of numeros){ await pool.query(`INSERT INTO campaign_logs (campaign_id,company_id,numero,status) VALUES ($1,$2,$3,'enviado')`,[c.rows[0].id,req.user.companyId,n]); } res.json({ok:true,msg:`Campaña ${name} ${numeros.length} nums plantilla ${templateName}`}); });
app.get('/api/campaigns/history', auth, async (req,res)=>{ const q=req.user.role==='worker'?`SELECT * FROM campaigns WHERE company_id=$1 AND created_by=$2 ORDER BY id DESC`:`SELECT * FROM campaigns WHERE company_id=$1 ORDER BY id DESC`; const p=req.user.role==='worker'?[req.user.companyId,req.user.id]:[req.user.companyId]; const r=await pool.query(q,p); res.json(r.rows); });

app.get('/api/messages', auth, async (req,res)=>{ const q=req.user.role==='worker'?`SELECT * FROM messages WHERE company_id=$1 AND assigned_to=$2 ORDER BY created_at DESC LIMIT 500`:`SELECT * FROM messages WHERE company_id=$1 ORDER BY created_at DESC LIMIT 500`; const p=req.user.role==='worker'?[req.user.companyId,req.user.id]:[req.user.companyId]; const r=await pool.query(q,p); res.json(r.rows); });
app.get('/api/metrics', auth, async (req,res)=>{ const comp=await pool.query('SELECT * FROM companies WHERE id=$1',[req.user.companyId]); const w=await pool.query('SELECT COUNT(*) FROM users WHERE company_id=$1',[req.user.companyId]); const m=await pool.query('SELECT COUNT(*) FROM messages WHERE company_id=$1',[req.user.companyId]); const ca=await pool.query('SELECT COUNT(*) FROM campaigns WHERE company_id=$1',[req.user.companyId]); const a=await pool.query(`SELECT * FROM audit_log WHERE company_id=$1 ORDER BY id DESC LIMIT 50`,[req.user.companyId]); res.json({company:comp.rows[0]||{}, stats:{workers:w.rows[0]?.count||0, mensajes:m.rows[0]?.count||0, campanas:ca.rows[0]?.count||0}, audit:a.rows}); });
app.get('/api/plans', async (req,res)=>{ res.json([{id:'basico',nombre:'Básico',precio_anual:800000,mantenimiento:80000,features:['1 sede','3 users','Inbox'],wpp:WPP+'BASICO'},{id:'premium',nombre:'Premium',precio_anual:1300000,mantenimiento:95000,features:['3 sedes','10 users','Campañas','Plantillas'],wpp:WPP+'PREMIUM'},{id:'gold',nombre:'Gold',precio_anual:2400000,mantenimiento:125000,features:['Ilimitado','IA','Llamadas','24/7 3133181851'],wpp:WPP+'GOLD'}]); });
app.get('/api/audit', auth, isAdmin, async (req,res)=>{ const r=await pool.query(`SELECT * FROM audit_log WHERE company_id=$1 ORDER BY id DESC LIMIT 200`,[req.user.companyId]); res.json(r.rows); });
app.get('/api/debug/files', (req,res)=> res.json({files:fs.readdirSync(__dirname), hasIndex:fs.existsSync(path.join(__dirname,'index.html')), hasDB:!!process.env.DATABASE_URL}));
app.get('/api/health', (req,res)=> res.json({ok:true, hasIndex:fs.existsSync(path.join(__dirname,'index.html'))}));

app.use(express.static(__dirname));
app.get('/legal', (req,res)=>{ const fp=path.join(__dirname,'legal.html'); if(fs.existsSync(fp)) return res.sendFile(fp); return res.send('Legal Ley 1581 - 3133181851'); });
function serveIndex(res){ const fp=path.join(__dirname,'index.html'); if(fs.existsSync(fp)) return res.sendFile(fp); return res.status(200).send(`<h1>Klido V11.3.2 ONLINE 3133181851</h1><p>Archivos: ${fs.readdirSync(__dirname).join(', ')}</p>`); }
app.get('/', (req,res)=> serveIndex(res));
app.get('*', (req,res)=>{ if(req.path.startsWith('/api/')) return res.status(404).json({error:'API no encontrada'}); return serveIndex(res); });

app.listen(PORT, '0.0.0.0', ()=> console.log('Klido V11.3.2 REAL PRO TODO en '+PORT));
