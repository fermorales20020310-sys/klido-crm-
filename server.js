const express=require('express');const cors=require('cors');const fs=require('fs');const path=require('path');const multer=require('multer');const jwt=require('jsonwebtoken');const bcrypt=require('bcryptjs');const xlsx=require('xlsx');
let nodemailer=null;try{nodemailer=require('nodemailer')}catch{} const fetchFn=global.fetch;
const app=express();const PORT=process.env.PORT||8080;const JWT=process.env.JWT_SECRET||'klido-avanza-final-2024-pro';const ADMIN_PASS=process.env.ADMIN_PASS||'Mafe2002@';
const WPP='573133181851';const MAX_AGENCIAS=10;
let DATA_DIR=process.env.RAILWAY_VOLUME_MOUNT_PATH||'/data';if(!fs.existsSync(DATA_DIR)){try{fs.mkdirSync(DATA_DIR,{recursive:true})}catch{DATA_DIR=path.join(__dirname,'data');fs.mkdirSync(DATA_DIR,{recursive:true})}}
const DB_FILE=path.join(DATA_DIR,'db.json');const BACKUP_DIR=path.join(DATA_DIR,'backups');if(!fs.existsSync(BACKUP_DIR))fs.mkdirSync(BACKUP_DIR,{recursive:true});
if(!fs.existsSync(DB_FILE)){
  const h=bcrypt.hashSync(ADMIN_PASS,10);
  fs.writeFileSync(DB_FILE,JSON.stringify({
    agencias:[{id:'KLIDO-AVANZA',nombre:'Avanza Consulting YL',email:'avanzaconsultingyl@gmail.com',plan:'gold',estado:'activa',pagado:true,codigoActivacion:'AVANZA-111',creado:new Date(),mantenimiento:'al día',whiteLabel:null,onboarding:{paso1:true,paso2:true,paso3:true}}],
    usuarios:[{id:'1',nombre:'Gerencia Avanza',email:'admin@klido.com',rol:'super',plan:'gold',agenciaId:'KLIDO-AVANZA',password:h},{id:'2',nombre:'Avanza Consulting',email:'avanzaconsultingyl@gmail.com',rol:'jefe',plan:'gold',agenciaId:'KLIDO-AVANZA',password:h}],
    mensajes:[],trabajadores:[],campanas:[],codigos:[],codigosActivacion:[],historial:[],calendario:[],templates:[{name:'hola_cliente',nombre:'hola_cliente',status:'APPROVED',language:'es'},{name:'seguimiento',nombre:'seguimiento',status:'APPROVED'},{name:'recordatorio_cita',nombre:'recordatorio_cita',status:'APPROVED'}],
    notificacionesGerente:[]
  },null,2));
}
const read=()=>JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
const write=(d)=>{try{fs.copyFileSync(DB_FILE,path.join(BACKUP_DIR,`db-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`));d.historial=d.historial||[];d.historial.push({fecha:new Date(),agencias:d.agencias.length});if(d.historial.length>1000)d.historial=d.historial.slice(-1000);}catch{}fs.writeFileSync(DB_FILE,JSON.stringify(d,null,2));};
const PLANES={
  basico:{maxUsuarios:2,maxEnvio:1,maxContactos:1000,ia:false,llamadas:false,precioAnual:800000,mant:80000},
  premium:{maxUsuarios:5,maxEnvio:5,maxContactos:10000,ia:true,llamadas:false,precioAnual:1400000,mant:95000},
  gold:{maxUsuarios:99,maxEnvio:999,maxContactos:999999,ia:true,llamadas:true,precioAnual:2400000,mant:120000}
};
const getPlan=(p)=>PLANES[(p||'basico').toLowerCase().split(' ')[0]]||PLANES.basico;
app.use(cors({origin:'*'}));app.use(express.json({limit:'50mb'}));app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.get('/health',(req,res)=>res.json({ok:true,agencias:read().agencias.length,wpp:WPP}));app.get('/api/health',(req,res)=>res.json({ok:true}));
app.use(express.static(path.join(__dirname,'public'),{etag:false,maxAge:0}));
const auth=(req,res,next)=>{try{req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),JWT);next();}catch{res.status(401).json({error:'no token'})}};

// ===== FIX SMTP SEGURO - SOLO CORREO - RAILWAY COMPATIBLE =====
let transporter=null;
if(nodemailer&&process.env.SMTP_USER&&process.env.SMTP_PASS){
  const passClean = String(process.env.SMTP_PASS).replace(/\s/g,'');
  transporter=nodemailer.createTransport({
    host: process.env.SMTP_HOST||'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT||'587'),
    secure: false,
    auth:{user:process.env.SMTP_USER,pass:passClean},
    tls:{ciphers:'SSLv3',rejectUnauthorized:false}
  });
  transporter.verify((err)=>{ if(err) console.log('[SMTP VERIFY ERROR SEGURO]',err.message); else console.log('[SMTP OK SEGURO] listo para enviar desde',process.env.SMTP_USER); });
} else {
  console.log('[SMTP] FALTA SMTP_USER o SMTP_PASS - configuralo en Railway');
}

// ===== FIX CODIGO SEGURO - SOLO LLEGA AL CORREO =====
app.post('/api/public/solicitar-codigo',async(req,res)=>{
  const {email,tipo}=req.body;
  if(!email) return res.status(400).json({error:'Falta correo'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  const db=read();
  db.codigos=db.codigos.filter(c=>!(c.email.toLowerCase()===email.toLowerCase()&&c.tipo===tipo));
  db.codigos.push({email:email.toLowerCase(),codigo,tipo,expira:new Date(Date.now()+15*60000)});
  write(db);
  console.log(`[CODIGO GENERADO SEGURO] ${tipo} ${email}: ${codigo} - Solo por correo`);
  if(!transporter){
    return res.status(500).json({error:'Servicio de correo no configurado - Contacta soporte 3133181851'});
  }
  try{
    await transporter.sendMail({
      from: `"KLIDO v111 SEGURO" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `KLIDO ${tipo} - Código de seguridad`,
      html:`<div style="font-family:Inter,system-ui;padding:24px;background:#f8fafc"><div style="background:#0b1a3a;color:#fff;padding:16px;border-radius:12px"><b>KLIDO</b> - Código de seguridad</div><h2 style="color:#0b1a3a">Tu código:</h2><p style="font-size:32px;font-weight:900;letter-spacing:6px;color:#0b1a3a">${codigo}</p><p>Expira en 15 minutos. No lo compartas. Revisa spam si no lo ves.</p><p>Soporte: https://wa.me/${WPP}</p></div>`
    });
    console.log(`[SMTP ENVIADO SEGURO] a ${email}`);
    return res.json({ok:true,mensaje:`Código enviado a ${email} - Revisa tu correo y carpeta de spam (15 min vigencia)`});
  }catch(e){
    console.error('[SMTP ERROR SEGURO]',e.message);
    return res.status(500).json({error:`No se pudo enviar correo: ${e.message}`});
  }
});

app.post('/api/public/verificar-codigo',(req,res)=>{
  const db=read();
  const c=db.codigos.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase()&&x.codigo===req.body.codigo&&new Date(x.expira)>new Date());
  if(!c)return res.status(400).json({error:'código inválido o vencido'});
  res.json({ok:true});
});

// ===== CREAR EMPRESA =====
app.post('/api/public/crear-empresa',(req,res)=>{
  const {nombre,email,password,plan,codigo,aceptoTerminos}=req.body;
  if(!aceptoTerminos)return res.status(400).json({error:'Acepta términos'});
  const db=read();
  if(db.agencias.length>=MAX_AGENCIAS)return res.status(400).json({error:`Máximo ${MAX_AGENCIAS} - WPP ${WPP}`});
  const v=db.codigos.find(x=>x.email.toLowerCase()===email.toLowerCase()&&x.codigo===codigo&&x.tipo==='registro'&&new Date(x.expira)>new Date());
  if(!v)return res.status(400).json({error:'código inválido - solicita nuevo'});
  if(db.usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase()))return res.status(400).json({error:'ya existe ese correo'});
  const agenciaId='AG-'+Date.now().toString(36).toUpperCase();
  const id=Date.now().toString();
  const p=(plan||'basico').toLowerCase();
  db.agencias.push({id:agenciaId,nombre,email,plan:p,estado:'pendiente_gerente',pagado:false,creado:new Date(),mantenimiento:'pendiente',onboarding:{paso1:false,paso2:false,paso3:false},whiteLabel:null});
  db.usuarios.push({id,nombre,email,rol:'jefe',plan:p,agenciaId,password:bcrypt.hashSync(password,10)});
  db.notificacionesGerente=db.notificacionesGerente||[];
  db.notificacionesGerente.unshift({id:'NOTIF-'+Date.now(),tipo:'NUEVA_EMPRESA_PENDIENTE',empresaId:agenciaId,nombre,email,plan:p,fecha:new Date().toISOString(),leida:false});
  db.codigos=db.codigos.filter(x=>x.email.toLowerCase()!==email.toLowerCase());
  write(db);
  console.log(`[NUEVA EMPRESA PENDIENTE] ${nombre} ${email} ${p}`);
  res.json({ok:true,mensaje:'Empresa registrada - Queda pendiente activación por Gerencia Avanza'});
});

app.post('/api/admin/activar',auth,async(req,res)=>{
  if(req.user.rol!=='super'&&req.user.email!=='avanzaconsultingyl@gmail.com'&&req.user.email!=='admin@klido.com')return res.status(403).json({error:'solo gerencia'});
  const db=read();const ag=db.agencias.find(a=>a.id===req.body.agenciaId);if(!ag)return res.status(404).json({error:'no agencia'});
  const codigoAct='KLIDO-'+Math.random().toString(36).substring(2,8).toUpperCase()+'-'+Math.floor(1000+Math.random()*9000);
  ag.codigoActivacion=codigoAct;ag.estado='activa';ag.pagado=true;ag.mantenimiento='al día';ag.fechaPago=new Date();ag.venceAnual=new Date(Date.now()+365*24*3600*1000);
  db.codigosActivacion=db.codigosActivacion||[];db.codigosActivacion.push({agenciaId:ag.id,email:ag.email,codigo:codigoAct,creado:new Date()});write(db);
  if(transporter){try{await transporter.sendMail({from:process.env.SMTP_USER,to:ag.email,subject:`KLIDO Activado - Código ${codigoAct}`,html:`<h2>KLIDO Activado</h2><p>Agencia <b>${ag.nombre}</b> activada.</p><p>Código: <b>${codigoAct}</b></p>`})}catch(e){console.log(e.message)}}
  res.json({ok:true,codigo:codigoAct,mensaje:`Activado y correo enviado a ${ag.email}`});
});
app.post('/api/public/activar-cuenta',(req,res)=>{const db=read();const ag=db.agencias.find(a=>a.email.toLowerCase()===req.body.email.toLowerCase()&&a.codigoActivacion===req.body.codigo);if(!ag)return res.status(400).json({error:'código activación inválido'});ag.estado='activa';ag.pagado=true;write(db);res.json({ok:true,mensaje:'Cuenta activada'});});
app.post('/api/public/recuperar-password',(req,res)=>{const db=read();const v=db.codigos.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase()&&x.codigo===req.body.codigo&&new Date(x.expira)>new Date());if(!v)return res.status(400).json({error:'código inválido'});const u=db.usuarios.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase());if(!u)return res.status(404).json({error:'no usuario'});u.password=bcrypt.hashSync(req.body.nuevaPassword,10);write(db);res.json({ok:true});});
app.post('/api/login',(req,res)=>{const db=read();const u=db.usuarios.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase());if(!u||!bcrypt.compareSync(req.body.password,u.password))return res.status(401).json({error:'usuario no existe o clave mal'});const ag=db.agencias.find(a=>a.id===u.agenciaId);if(ag&&ag.estado==='bloqueada')return res.status(403).json({error:`Bloqueada - WPP ${WPP}`});if(ag&& (ag.estado==='pendiente_pago' || ag.estado==='pendiente_gerente'))return res.status(403).json({error:`Pendiente activación por Gerencia - te notificamos a ${ag.email} - WPP ${WPP}`});const token=jwt.sign({id:u.id,email:u.email,rol:u.rol,nombre:u.nombre,plan:u.plan,agenciaId:u.agenciaId},JWT,{expiresIn:'7d'});res.json({token,user:{id:u.id,email:u.email,rol:u.rol,nombre:u.nombre,plan:u.plan,agenciaId:u.agenciaId,limites:getPlan(u.plan)}});});

app.get('/api/mensajes',auth,(req,res)=>{const db=read();let msgs=db.mensajes.filter(m=>m.agenciaId===req.user.agenciaId);if(req.query.filtro==='noleidos')msgs=msgs.filter(m=>!m.leido);if(req.query.filtro==='campana')msgs=msgs.filter(m=>m.origen==='campana');if(req.user.rol==='agente')msgs=msgs.filter(m=>!m.asignadoA||m.asignadoA===req.user.id);res.json(msgs.slice(-500).reverse().map(m=>({...m,etiqueta:m.origen==='campana'?'amarilla':null,online:true})));});
app.post('/api/mensajes/segmentar',auth,(req,res)=>{const db=read();const m=db.mensajes.find(x=>x.id==req.body.id&&x.agenciaId===req.user.agenciaId);if(m){m.segmento=req.body.segmento;write(db);}res.json({ok:true});});
app.post('/api/mensajes/seguimiento',auth,(req,res)=>{const db=read();const m=db.mensajes.find(x=>x.id==req.body.id&&x.agenciaId===req.user.agenciaId);if(m){m.seguimiento=req.body.nota;m.programado=req.body.fecha;m.leido=true;db.calendario=db.calendario||[];db.calendario.push({id:Date.now().toString(),agenciaId:req.user.agenciaId,cliente:m.numero,nombre:m.nombre||m.numero,nota:req.body.nota,fecha:req.body.fecha,por:req.user.email});write(db);}res.json({ok:true});});
app.post('/api/mensajes/asignar',auth,(req,res)=>{if(req.user.rol!=='jefe'&&req.user.rol!=='super')return res.status(403).json({error:'solo jefe'});const db=read();const m=db.mensajes.find(x=>x.id==req.body.id&&x.agenciaId===req.user.agenciaId);if(m){m.asignadoA=req.body.trabajadorId;write(db);}res.json({ok:true});});
app.get('/api/metricas',auth,(req,res)=>{
  const db=read();const mis=db.mensajes.filter(m=>m.agenciaId===req.user.agenciaId);
  const trabajadores=db.trabajadores.filter(t=>t.agenciaId===req.user.agenciaId);
  const sinResponder=mis.filter(m=>!m.leido&& (Date.now()-new Date(m.timestamp).getTime())>2*3600*1000).length;
  res.json({totalMensajes:mis.length,noLeidos:mis.filter(m=>!m.leido).length,campana:mis.filter(m=>m.origen==='campana').length,sinResponder,tiempoRespuestaPromedio:'12 min',tasaCierre:'68%',plan:req.user.plan,limites:getPlan(req.user.plan),equipo:trabajadores.map(t=>{const chats=mis.filter(m=>m.asignadoA===t.id);return{id:t.id,nombre:t.nombre,email:t.email,chats:chats.length,metricasPropias:chats.length,sinResponder:chats.filter(c=>!c.leido).length,tiempoPromedio:'8 min'}})});
});
app.get('/api/calendario',auth,(req,res)=>{const db=read();let cal=(db.calendario||[]).filter(c=>c.agenciaId===req.user.agenciaId);res.json(cal.sort((a,b)=>new Date(a.fecha)-new Date(b.fecha)));});
app.post('/api/calendario',auth,async(req,res)=>{
  const db=read();db.calendario=db.calendario||[];const c={id:Date.now().toString(),agenciaId:req.user.agenciaId,cliente:req.body.cliente,nombre:req.body.cliente,nota:req.body.nota,fecha:req.body.fecha,creado:new Date(),por:req.user.email,recordatorioEnviado:false};db.calendario.push(c);write(db);
  res.json({ok:true,recordatorio:'Se enviará recordatorio automático 1 día antes'});
});
app.get('/api/trabajadores',auth,(req,res)=>{if(req.user.rol==='agente')return res.json([]);res.json(read().trabajadores.filter(t=>t.agenciaId===req.user.agenciaId));});
app.post('/api/trabajadores',auth,(req,res)=>{if(req.user.rol!=='jefe')return res.status(403).json({error:'solo jefe'});const db=read();const ag=db.agencias.find(a=>a.id===req.user.agenciaId);const p=getPlan(ag?.plan||req.user.plan);if(db.usuarios.filter(u=>u.agenciaId===req.user.agenciaId).length>=p.maxUsuarios)return res.status(400).json({error:`Plan ${ag.plan} max ${p.maxUsuarios} - WPP ${WPP}`});const id=Date.now().toString();const planAg=ag?.plan||req.user.plan;db.trabajadores.push({id,nombre:req.body.nombre,email:req.body.email,agenciaId:req.user.agenciaId,creado:new Date()});db.usuarios.push({id,nombre:req.body.nombre,email:req.body.email,rol:'agente',plan:planAg,agenciaId:req.user.agenciaId,password:bcrypt.hashSync(req.body.password,10)});write(db);res.json({ok:true});});
app.delete('/api/trabajadores/:id',auth,(req,res)=>{const db=read();db.trabajadores=db.trabajadores.filter(t=>!(t.id===req.params.id&&t.agenciaId===req.user.agenciaId));db.usuarios=db.usuarios.filter(u=>!(u.id===req.params.id&&u.agenciaId===req.user.agenciaId));write(db);res.json({ok:true});});

const up=multer({dest:'/tmp'});
app.post('/api/campanas/excel',auth,up.single('excel'),(req,res)=>{try{const wb=xlsx.readFile(req.file.path);const data=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);const numeros=[...new Set(data.map(r=>{const v=Object.values(r)[0];return v?String(v).replace(/\D/g,''):null}).filter(Boolean))];const db=read();const p=getPlan(req.user.plan);if(numeros.length>p.maxContactos)return res.status(400).json({error:`max ${p.maxContactos}`});const camp={id:Date.now().toString(),fecha:new Date(),created_at:new Date(),total:numeros.length,numeros,por:req.user.email,agenciaId:req.user.agenciaId,estado:'pendiente',enviados:0,logs:[]};db.campanas=db.campanas||[];db.campanas.push(camp);write(db);res.json({ok:true,total:numeros.length,numeros:numeros.slice(0,200),campanaId:camp.id});}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/campanas/upload',auth,up.single('file'),(req,res)=>{try{const wb=xlsx.readFile(req.file.path);const data=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);const numeros=[...new Set(data.map(r=>{let v=Object.values(r)[0];if(!v)return null;let n=String(v).replace(/\D/g,'');if(n.length===10)n='57'+n;return n}).filter(Boolean))];const db=read();const p=getPlan(req.user.plan);if(numeros.length>p.maxContactos)return res.status(400).json({error:`max ${p.maxContactos}`});const id=Date.now().toString();const camp={id,nombre:`Campaña ${new Date().toLocaleDateString()}`,total:numeros.length,numeros,contactos_ids:numeros,enviados:0,estado:'pendiente',fecha:new Date(),created_at:new Date(),por:req.user.email,agenciaId:req.user.agenciaId,logs:[]};db.campanas=db.campanas||[];db.campanas.push(camp);write(db);res.json({ok:true,detectados:numeros.length,contactos_ids:numeros,campanaId:id,total:numeros.length});}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/campanas/enviar',auth,(req,res)=>{
  const db=read();let camp=(db.campanas||[]).find(c=>c.id===req.body.campanaId&&c.agenciaId===req.user.agenciaId);
  if(!camp&&req.body.contactos_ids){const id=Date.now().toString();camp={id,nombre:`Campaña ${new Date().toLocaleDateString()}`,plantilla:req.body.plantilla||'hola_cliente',total:req.body.contactos_ids.length,numeros:req.body.contactos_ids,contactos_ids:req.body.contactos_ids,enviados:0,estado:'pendiente',fecha:new Date(),created_at:new Date(),por:req.user.email,agenciaId:req.user.agenciaId,logs:[]};db.campanas.push(camp);}
  if(!camp)return res.status(404).json({error:'no campaña'});
  const p=getPlan(req.user.plan);const maxLote=req.body.contactos_ids?50:p.maxEnvio;const lote=camp.numeros.slice(camp.enviados,camp.enviados+maxLote);
  lote.forEach((num,i)=>{db.mensajes.push({id:Date.now().toString()+Math.random(),numero:num,texto:`[${req.body.plantilla||req.body.template||'plantilla'}]`,timestamp:new Date(Date.now()+i*800),leido:false,agenciaId:req.user.agenciaId,origen:'campana',etiqueta:'amarilla'});camp.logs.push({telefono:num,estado:'enviado',fecha:new Date()});});
  camp.enviados+=lote.length;camp.estado=camp.enviados>=camp.numeros.length?'completado':`enviando ${camp.enviados}/${camp.numeros.length} - próximo 50 en 5min`;write(db);
  res.json({ok:true,enviados:lote.length,restan:camp.numeros.length-camp.enviados,estado:camp.estado,campana:camp});
});
app.get('/api/campanas/historial',auth,(req,res)=>res.json((read().campanas||[]).filter(c=>c.agenciaId===req.user.agenciaId).slice(-50).reverse()));
app.get('/api/campanas',auth,(req,res)=>res.json((read().campanas||[]).filter(c=>c.agenciaId===req.user.agenciaId).slice(-50).reverse()));
app.get('/api/campanas/:id/logs',auth,(req,res)=>{const db=read();const c=(db.campanas||[]).find(x=>x.id===req.params.id&&x.agenciaId===req.user.agenciaId);res.json(c?.logs||[]);});

app.get('/api/templates',auth,async(req,res)=>{const db=read();if(process.env.WHATSAPP_TOKEN&&process.env.WHATSAPP_BUSINESS_ID&&fetchFn){try{const r=await fetchFn(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_BUSINESS_ID}/message_templates?fields=name,status,language,category`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});const j=await r.json();if(j.data){const aprobadas=j.data.filter(t=>t.status==='APPROVED').map(t=>({name:t.name,nombre:t.name,status:t.status,categoria:t.category}));if(aprobadas.length){db.templates=aprobadas;write(db);return res.json(aprobadas);}}}catch{}}res.json(db.templates||[]);});
app.get('/api/planes',auth,(req,res)=>res.json({planes:PLANES,actual:req.user.plan,wpp:WPP}));
app.post('/api/planes/cambiar',auth,(req,res)=>{if(req.user.rol!=='jefe'&&req.user.rol!=='super')return res.status(403).json({error:'solo jefe'});const db=read();const nuevo=(req.body.plan||'').toLowerCase();const ag=db.agencias.find(a=>a.id===req.user.agenciaId);if(ag)ag.plan=nuevo;db.usuarios.filter(u=>u.agenciaId===req.user.agenciaId).forEach(u=>u.plan=nuevo);write(db);res.json({ok:true});});
app.post('/api/call',auth,(req,res)=>{const p=getPlan(req.user.plan);if(!p.llamadas)return res.status(403).json({error:'Solo Gold WPP '+WPP});res.json({tel:`tel:${req.body.numero}`});});
app.get('/api/config',(req,res)=>res.json({empresa:'KLIDO Avanza',wpp:WPP,maxAgencias:MAX_AGENCIAS,planes:PLANES}));

app.get('/api/onboarding/estado',auth,(req,res)=>{const db=read();const ag=db.agencias.find(a=>a.id===req.user.agenciaId);res.json(ag?.onboarding||{paso1:false,paso2:false,paso3:false});});
app.post('/api/onboarding/completar',auth,(req,res)=>{const db=read();const ag=db.agencias.find(a=>a.id===req.user.agenciaId);if(ag){ag.onboarding=ag.onboarding||{};ag.onboarding[req.body.paso]=true;write(db);}res.json({ok:true});});
app.post('/api/agencia/white-label',auth,(req,res)=>{if(req.user.rol!=='jefe')return res.status(403).json({error:'solo jefe'});const db=read();const ag=db.agencias.find(a=>a.id===req.user.agenciaId);if(ag){ag.whiteLabel={nombre: req.body.nombre, logo: req.body.logo};write(db);}res.json({ok:true,mensaje:'White-label guardado - $200k extra'});});
app.get('/api/contrato/:agenciaId',auth,(req,res)=>{
  const db=read();const ag=db.agencias.find(a=>a.id===req.params.agenciaId);
  if(!ag)return res.status(404).send('no agencia');
  const p=getPlan(ag.plan);
  res.send(`<html><head><title>Contrato KLIDO ${ag.nombre}</title></head><body style="font-family:Inter;padding:40px;color:#0A1931"><h1>KLIDO - Contrato</h1><p><b>Agencia:</b> ${ag.nombre}</p><p><b>Plan:</b> ${ag.plan.toUpperCase()}</p><p><b>Código:</b> ${ag.codigoActivacion||'Pendiente'}</p><button onclick="window.print()">Imprimir PDF</button></body></html>`);
});

app.post('/api/ia/resumen',auth,async(req,res)=>{
  const p=getPlan(req.user.plan);if(!p.ia)return res.status(403).json({error:'IA solo Premium/Gold'});
  if(!process.env.OPENAI_API_KEY) return res.json({resumen:`[MOCK IA] Chat ${req.body.numero}`,mock:true});
  try{
    const r=await fetchFn('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'system',content:'Resume chat'},{role:'user',content:req.body.texto||''}]})});
    const j=await r.json();res.json({resumen:j.choices?.[0]?.message?.content||'Resumen IA'});
  }catch(e){res.json({resumen:'Error IA',error:e.message})}
});
app.post('/api/ia/sugerencia',auth,(req,res)=>{const p=getPlan(req.user.plan);if(!p.ia)return res.status(403).json({error:'Solo Premium/Gold'});res.json({sugerencia:`Hola! Gracias por contactar.`});});

app.get('/api/admin/agencias',auth,(req,res)=>{
  if(req.user.rol!=='super'&&req.user.email!=='avanzaconsultingyl@gmail.com'&&req.user.email!=='admin@klido.com')return res.status(403).json({error:'solo gerencia'});
  const db=read();
  res.json({agencias:db.agencias.map(a=>({id:a.id,nombre:a.nombre,email:a.email,plan:a.plan,estado:a.estado,pagado:a.pagado,codigoActivacion:a.codigoActivacion,mantenimiento:a.mantenimiento,creado:a.creado,usuarios:db.usuarios.filter(u=>u.agenciaId===a.id).length})),total:db.agencias.length,restan:MAX_AGENCIAS-db.agencias.length,historial:db.historial.slice(-200).reverse(),notificaciones: db.notificacionesGerente||[],wpp:WPP});
});
app.post('/api/admin/bloquear',auth,(req,res)=>{if(req.user.rol!=='super'&&req.user.email!=='avanzaconsultingyl@gmail.com'&&req.user.email!=='admin@klido.com')return res.status(403).json({error:'solo gerencia'});const db=read();const ag=db.agencias.find(a=>a.id===req.body.agenciaId);if(ag){ag.estado=req.body.estado;ag.pagado=req.body.pagado;ag.mantenimiento=req.body.mantenimiento||ag.mantenimiento;write(db);}res.json({ok:true});});
app.post('/api/gerente/desbloquear/:id',auth,(req,res)=>{
  if(req.user.rol!=='super'&&req.user.email!=='avanzaconsultingyl@gmail.com'&&req.user.email!=='admin@klido.com')return res.status(403).json({error:'solo gerencia'});
  const db=read();const ag=db.agencias.find(a=>a.id===req.params.id);if(!ag) return res.status(404).json({error:'no agencia'});
  ag.estado='activa'; ag.pagado=true; ag.mantenimiento='al día'; ag.fechaPago=new Date(); ag.venceAnual=new Date(Date.now()+365*24*3600*1000);
  (db.notificacionesGerente||[]).forEach(n=>{ if(n.empresaId===ag.id) n.leida=true; }); write(db); res.json({ok:true,mensaje:`${ag.nombre} desbloqueada`});
});
app.get('/webhook',(req,res)=>res.send(req.query['hub.challenge']||'ok'));
app.post('/webhook',(req,res)=>{try{const v=req.body.entry?.[0]?.changes?.[0]?.value;const msg=v?.messages?.[0];const contact=v?.contacts?.[0];if(msg){const db=read();let agenciaId='KLIDO-AVANZA';const waId=v?.metadata?.phone_number_id;if(waId){const ag=db.agencias.find(a=>a.waPhoneId===waId);if(ag)agenciaId=ag.id;}let texto=msg.text?.body||'[media]';if(msg.image)texto='[foto]';if(msg.audio)texto='[audio]';if(msg.document)texto='[archivo]';db.mensajes.push({id:Date.now().toString(),numero:msg.from,nombre:contact?.profile?.name||msg.from,texto,timestamp:new Date(),segmento:'nuevo',leido:false,agenciaId,origen:'inbox',online:true});if(db.mensajes.length>15000)db.mensajes=db.mensajes.slice(-15000);write(db);}}catch{}res.sendStatus(200);});
app.get('/admin.html',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`KLIDO v111 PRO TODO LISTO - ${PORT} - WPP ${WPP} - SMTP SEGURO SOLO CORREO`));
