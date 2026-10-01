const express=require('express');const cors=require('cors');const fs=require('fs');const path=require('path');const multer=require('multer');const jwt=require('jsonwebtoken');const bcrypt=require('bcryptjs');const xlsx=require('xlsx');
let nodemailer=null;try{nodemailer=require('nodemailer')}catch{}
const app=express();const PORT=process.env.PORT||8080;const JWT=process.env.JWT_SECRET||'klido-secreto-final-2024-avanza-consulting';const ADMIN_PASS=process.env.ADMIN_PASS||'Mafe2002@';

let DATA_DIR=process.env.RAILWAY_VOLUME_MOUNT_PATH||'/data'; if(!fs.existsSync(DATA_DIR)){ try{fs.mkdirSync(DATA_DIR,{recursive:true})}catch{DATA_DIR=path.join(__dirname,'data');fs.mkdirSync(DATA_DIR,{recursive:true})}}
const DB_FILE=path.join(DATA_DIR,'db.json'); const BACKUP_DIR=path.join(DATA_DIR,'backups'); if(!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR,{recursive:true});

if(!fs.existsSync(DB_FILE)){
  const h=bcrypt.hashSync(ADMIN_PASS,10);
  fs.writeFileSync(DB_FILE,JSON.stringify({agencias:[{id:'KLIDO-AVANZA',nombre:'Avanza Consulting YL',email:'avanzaconsultingyl@gmail.com',plan:'gold',creado:new Date(),estado:'activa'}], usuarios:[{id:'1',nombre:'Fer Admin',email:'admin@klido.com',rol:'jefe',plan:'gold',agenciaId:'KLIDO-AVANZA',password:h,creado:new Date()},{id:'2',nombre:'Avanza Consulting',email:'avanzaconsultingyl@gmail.com',rol:'jefe',plan:'gold',agenciaId:'KLIDO-AVANZA',password:h,creado:new Date()}], mensajes:[],trabajadores:[],campanas:[],codigos:[],historial:[]},null,2));
}
const read=()=>JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
const write=(d)=>{
  try{ const f=new Date().toISOString().split('T')[0]; if(fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE,path.join(BACKUP_DIR,`db-${f}-${Date.now()}.json`)); d.historial=d.historial||[]; d.historial.push({fecha:new Date(),agencias:d.agencias?.length||0,usuarios:d.usuarios?.length||0,mensajes:d.mensajes?.length||0}); if(d.historial.length>1000) d.historial=d.historial.slice(-1000);
    const files=fs.readdirSync(BACKUP_DIR); if(files.length>50) files.sort().slice(0,files.length-50).forEach(f=>{try{fs.unlinkSync(path.join(BACKUP_DIR,f))}catch{}});
  }catch{} fs.writeFileSync(DB_FILE,JSON.stringify(d,null,2));
};

app.use(cors({origin:'*'}));app.use(express.json({limit:'30mb'}));app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.get('/health',(req,res)=>res.json({ok:true}));app.get('/api/health',(req,res)=>res.json({ok:true}));
app.use(express.static(path.join(__dirname,'public'),{etag:false,maxAge:0}));

const auth=(req,res,next)=>{try{req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),JWT);next();}catch{res.status(401).json({error:'no token'})}};

// ===== CODIGOS 6 DIGITOS - AUTONOMO =====
let transporter=null;
if(nodemailer && process.env.SMTP_USER && process.env.SMTP_PASS){
  transporter=nodemailer.createTransport({service:'gmail',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
}
app.post('/api/public/solicitar-codigo',async(req,res)=>{
  const {email,tipo}=req.body; if(!email) return res.status(400).json({error:'email requerido'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  const db=read(); db.codigos=db.codigos||[]; db.codigos=db.codigos.filter(c=>c.email.toLowerCase()!==email.toLowerCase()||c.tipo!==tipo);
  db.codigos.push({email:email.toLowerCase(),codigo,tipo,creado:new Date(),expira:new Date(Date.now()+15*60000)}); write(db);
  if(transporter){ try{ await transporter.sendMail({from:process.env.SMTP_USER,to:email,subject:`KLIDO Código ${tipo} - ${codigo}`,text:`Tu código KLIDO para ${tipo} es: ${codigo}. Expira en 15 min. Si no fuiste tú, ignora.`}); }catch(e){console.log('SMTP fail',e.message)}}
  console.log(`CODIGO KLIDO ${tipo} ${email}: ${codigo}`); res.json({ok:true,mensaje:`Código enviado a ${email} - ${codigo} (revisa spam) - expira 15min`});
});
app.post('/api/public/verificar-codigo',(req,res)=>{
  const {email,codigo}=req.body; const db=read(); const c=(db.codigos||[]).find(x=>x.email.toLowerCase()===email.toLowerCase()&&x.codigo===codigo&&new Date(x.expira)>new Date());
  if(!c) return res.status(400).json({error:'código inválido o vencido'}); res.json({ok:true,mensaje:'código válido'});
});
app.post('/api/public/crear-empresa',(req,res)=>{
  const {nombre,email,password,plan,codigo,aceptoTerminos}=req.body;
  if(!aceptoTerminos) return res.status(400).json({error:'acepta términos'});
  const db=read(); const v=(db.codigos||[]).find(x=>x.email.toLowerCase()===email.toLowerCase()&&x.codigo===codigo&&x.tipo==='registro'&&new Date(x.expira)>new Date());
  if(!v) return res.status(400).json({error:'código de registro inválido'});
  if(db.usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:'ya existe'});
  const agenciaId='AG-'+Date.now().toString(36).toUpperCase(); const id=Date.now().toString(); const hash=bcrypt.hashSync(password,10);
  db.agencias=db.agencias||[]; db.agencias.push({id:agenciaId,nombre,email,plan:plan||'basico',creado:new Date(),estado:'activa',codigoUsado:codigo});
  db.usuarios.push({id,nombre, email, rol:'jefe', plan:plan||'basico', agenciaId, password:hash, creado:new Date()});
  db.codigos=db.codigos.filter(x=>x.email.toLowerCase()!==email.toLowerCase()); write(db);
  res.json({ok:true,mensaje:'Empresa creada correctamente'});
});
app.post('/api/public/recuperar-password',(req,res)=>{
  const {email,codigo,nuevaPassword}=req.body; const db=read(); const v=(db.codigos||[]).find(x=>x.email.toLowerCase()===email.toLowerCase()&&x.codigo===codigo&&x.tipo==='recuperacion'&&new Date(x.expira)>new Date());
  if(!v) return res.status(400).json({error:'código inválido'}); const u=db.usuarios.find(x=>x.email.toLowerCase()===email.toLowerCase()); if(!u) return res.status(400).json({error:'usuario no existe'});
  u.password=bcrypt.hashSync(nuevaPassword,10); db.codigos=db.codigos.filter(x=>x.email.toLowerCase()!==email.toLowerCase()); write(db); res.json({ok:true,mensaje:'Contraseña actualizada'});
});

// LOGIN QUE YA TENIAS
app.post('/api/login',(req,res)=>{
  const db=read(); const u=db.usuarios.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase());
  if(!u||!bcrypt.compareSync(req.body.password,u.password)) return res.status(401).json({error:'usuario no existe'});
  const token=jwt.sign({id:u.id,email:u.email,rol:u.rol,nombre:u.nombre,plan:u.plan,agenciaId:u.agenciaId},JWT,{expiresIn:'7d'});
  res.json({token,user:{id:u.id,email:u.email,rol:u.rol,nombre:u.nombre,plan:u.plan,agenciaId:u.agenciaId}});
});

// RESTO DE TU CRM - MULTIAGENCIA
app.get('/api/mensajes',auth,(req,res)=>{ const db=read(); res.json(db.mensajes.filter(m=>m.agenciaId===req.user.agenciaId||req.user.agenciaId==='KLIDO-AVANZA').slice(-300).reverse()); });
app.post('/api/mensajes/segmentar',auth,(req,res)=>{ const db=read(); const m=db.mensajes.find(x=>x.id==req.body.id); if(m){m.segmento=req.body.segmento;write(db);} res.json({ok:true}); });
app.post('/api/mensajes/seguimiento',auth,(req,res)=>{ const db=read(); const m=db.mensajes.find(x=>x.id==req.body.id); if(m){m.seguimiento=req.body.nota;m.programado=req.body.fecha;m.leido=true;write(db);} res.json({ok:true}); });
app.get('/api/calendario',auth,(req,res)=>res.json(read().mensajes.filter(m=>m.programado&&m.agenciaId===req.user.agenciaId).sort((a,b)=>new Date(a.programado)-new Date(b.programado))));
app.get('/api/metricas',auth,(req,res)=>{ const db=read(); const ag=db.agencias||[]; res.json({totalMensajes:db.mensajes.filter(m=>m.agenciaId===req.user.agenciaId).length,noLeidos:db.mensajes.filter(m=>!m.leido&&m.agenciaId===req.user.agenciaId).length,conversion:db.mensajes.filter(m=>m.segmento==='fijo').length,totalAgencias:ag.length}); });
app.get('/api/agencias',auth,(req,res)=>{ const db=read(); if(req.user.email==='admin@klido.com'||req.user.agenciaId==='KLIDO-AVANZA') res.json({agencias:db.agencias,historial:db.historial.slice(-100).reverse(),backups:fs.readdirSync(BACKUP_DIR).slice(-20)}); else res.json({agencias:db.agencias.filter(a=>a.id===req.user.agenciaId)}); });
app.get('/api/trabajadores',auth,(req,res)=>res.json(read().trabajadores.filter(t=>t.agenciaId===req.user.agenciaId)||[]));
app.post('/api/trabajadores',auth,(req,res)=>{ const db=read(); const id=Date.now().toString(); db.trabajadores.push({id,nombre:req.body.nombre,email:req.body.email,agenciaId:req.user.agenciaId}); db.usuarios.push({id,nombre:req.body.nombre,email:req.body.email,rol:'agente',plan:req.user.plan,agenciaId:req.user.agenciaId,password:bcrypt.hashSync(req.body.password,10)}); write(db); res.json({ok:true}); });
app.delete('/api/trabajadores/:id',auth,(req,res)=>{ const db=read(); db.trabajadores=db.trabajadores.filter(t=>t.id!==req.params.id); db.usuarios=db.usuarios.filter(u=>!(u.id===req.params.id&&u.agenciaId===req.user.agenciaId)); write(db); res.json({ok:true}); });
app.get('/api/templates',auth,(req,res)=>res.json([{name:'hola_cliente'},{name:'seguimiento'},{name:'oferta_avanza'}]));
const up=multer({dest:'/tmp'}); app.post('/api/campanas/excel',auth,up.single('excel'),(req,res)=>{ try{ const wb=xlsx.readFile(req.file.path); const data=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); const db=read(); db.campanas.push({id:Date.now().toString(),fecha:new Date(),total:data.length,por:req.user.email,agenciaId:req.user.agenciaId}); write(db); res.json({ok:true,total:data.length}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/campanas/historial',auth,(req,res)=>res.json((read().campanas||[]).filter(c=>c.agenciaId===req.user.agenciaId).slice(-30).reverse()));
app.post('/api/planes/cambiar',auth,(req,res)=>{ const db=read(); const u=db.usuarios.find(x=>x.id==req.user.id); if(u){u.plan=req.body.plan; const ag=db.agencias.find(a=>a.id===u.agenciaId); if(ag) ag.plan=req.body.plan; write(db);} res.json({ok:true}); });
app.post('/api/call',auth,(req,res)=>res.json({tel:`tel:${req.body.numero}`}));
app.get('/webhook',(req,res)=>res.send(req.query['hub.challenge']||'ok')); app.post('/webhook',(req,res)=>{ try{ const msg=req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; if(msg){ const db=read(); db.mensajes.push({id:Date.now().toString(),numero:msg.from,texto:msg.text?.body||'[media]',timestamp:new Date(),segmento:'nuevo',leido:false,agenciaId:'KLIDO-AVANZA'}); if(db.mensajes.length>5000) db.mensajes=db.mensajes.slice(-5000); write(db);} }catch{} res.sendStatus(200); });
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`KLIDO AUTONOMO ${PORT} DB:${DB_FILE} BACKUPS:${BACKUP_DIR}`));
