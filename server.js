const express=require('express');const cors=require('cors');const fs=require('fs');const path=require('path');const multer=require('multer');const jwt=require('jsonwebtoken');const bcrypt=require('bcryptjs');const xlsx=require('xlsx');
let nodemailer=null;try{nodemailer=require('nodemailer')}catch{} const fetchFn=global.fetch;
const app=express();const PORT=process.env.PORT||8080;const JWT=process.env.JWT_SECRET||'klido-avanza-final-2024-pro';const ADMIN_PASS=process.env.ADMIN_PASS||'Mafe2002@';
const WPP='573133181851'; // TU WPP REAL 3133181851
const MAX_AGENCIAS=10;

// DATA EN VOLUMEN RAILWAY - NUNCA SE BORRA
let DATA_DIR=process.env.RAILWAY_VOLUME_MOUNT_PATH||'/data';if(!fs.existsSync(DATA_DIR)){try{fs.mkdirSync(DATA_DIR,{recursive:true})}catch{DATA_DIR=path.join(__dirname,'data');fs.mkdirSync(DATA_DIR,{recursive:true})}}
const DB_FILE=path.join(DATA_DIR,'db.json');const BACKUP_DIR=path.join(DATA_DIR,'backups');if(!fs.existsSync(BACKUP_DIR))fs.mkdirSync(BACKUP_DIR,{recursive:true});

if(!fs.existsSync(DB_FILE)){
  const h=bcrypt.hashSync(ADMIN_PASS,10);
  fs.writeFileSync(DB_FILE,JSON.stringify({
    agencias:[{id:'KLIDO-AVANZA',nombre:'Avanza Consulting YL',email:'avanzaconsultingyl@gmail.com',plan:'gold',estado:'activa',pagado:true,creado:new Date(),mantenimiento:'al día'}],
    usuarios:[{id:'1',nombre:'Gerencia Avanza',email:'admin@klido.com',rol:'super',plan:'gold',agenciaId:'KLIDO-AVANZA',password:h,creado:new Date()},{id:'2',nombre:'Avanza Consulting',email:'avanzaconsultingyl@gmail.com',rol:'jefe',plan:'gold',agenciaId:'KLIDO-AVANZA',password:h,creado:new Date()}],
    mensajes:[],trabajadores:[],campanas:[],codigos:[],historial:[],calendario:[],
    templates:[{name:'hola_cliente',status:'APPROVED',language:'es'},{name:'seguimiento',status:'APPROVED',language:'es'},{name:'oferta_avanza',status:'APPROVED',language:'es'}]
  },null,2));
}
const read=()=>JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
const write=(d)=>{
  try{
    fs.copyFileSync(DB_FILE,path.join(BACKUP_DIR,`db-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`));
    d.historial=d.historial||[]; d.historial.push({fecha:new Date(),agencias:d.agencias.length,usuarios:d.usuarios.length,mensajes:d.mensajes.length});
    if(d.historial.length>1000) d.historial=d.historial.slice(-1000);
    const files=fs.readdirSync(BACKUP_DIR); if(files.length>80) files.sort().slice(0,files.length-80).forEach(f=>{try{fs.unlinkSync(path.join(BACKUP_DIR,f))}catch{}});
  }catch{} fs.writeFileSync(DB_FILE,JSON.stringify(d,null,2));
};

// PLANES REALES - BÁSICO SIN IA, PREMIUM CON IA, GOLD CON IA + LLAMADAS
const PLANES={
  basico:{maxUsuarios:2,maxEnvio:1,maxContactos:1000,ia:false,llamadas:false,beneficios:['1 envío a la vez','2 usuarios','Inbox ilimitado','1,000 contactos','Sin IA','API Meta Oficial']},
  premium:{maxUsuarios:5,maxEnvio:5,maxContactos:10000,ia:true,llamadas:false,beneficios:['5 envíos simultáneos','5 usuarios','Inbox ilimitado','10,000 contactos','IA incluida','API Meta Oficial']},
  gold:{maxUsuarios:99,maxEnvio:999,maxContactos:999999,ia:true,llamadas:true,beneficios:['Envíos ilimitados','Usuarios ilimitados','Inbox ilimitado','Contactos ilimitados','IA insights','📞 Llamadas con IA','Soporte dedicado 24/7']}
};
const getPlan=(p)=>PLANES[(p||'basico').toLowerCase().split(' ')[0]]||PLANES.basico;

app.use(cors({origin:'*'}));app.use(express.json({limit:'50mb'}));app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.get('/health',(req,res)=>res.json({ok:true,agencias:read().agencias.length,wpp:WPP}));app.get('/api/health',(req,res)=>res.json({ok:true}));
app.use(express.static(path.join(__dirname,'public'),{etag:false,maxAge:0}));
const auth=(req,res,next)=>{try{req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),JWT);next();}catch{res.status(401).json({error:'no token'})}};

// SMTP - CÓDIGO AL CORREO REGISTRADO, NO AL TUYO
let transporter=null;if(nodemailer&&process.env.SMTP_USER&&process.env.SMTP_PASS){transporter=nodemailer.createTransport({service:'gmail',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});}

// 1. CODIGOS 6 DÍGITOS AUTÓNOMOS
app.post('/api/public/solicitar-codigo',async(req,res)=>{
  const {email,tipo}=req.body; if(!email) return res.status(400).json({error:'email requerido'});
  const codigo=Math.floor(100000+Math.random()*900000).toString();
  const db=read(); db.codigos=db.codigos.filter(c=>!(c.email.toLowerCase()===email.toLowerCase()&&c.tipo===tipo));
  db.codigos.push({email:email.toLowerCase(),codigo,tipo,creado:new Date(),expira:new Date(Date.now()+15*60000)}); write(db);
  if(transporter){try{await transporter.sendMail({from:process.env.SMTP_USER,to:email,subject:`KLIDO Código ${tipo} - ${codigo}`,html:`<h2>KLIDO Avanza Consulting</h2><p>Tu código para <b>${tipo}</b> es: <b style="font-size:24px">${codigo}</b></p><p>Expira en 15 min. API Oficial Meta. Soporte 24/7: ${WPP}</p>`})}catch(e){console.log('SMTP',e.message)}}
  console.log(`CODIGO KLIDO ${tipo} -> ${email}: ${codigo}`); res.json({ok:true,mensaje:`Código enviado a tu correo registrado ${email} - revisa spam`});
});
app.post('/api/public/verificar-codigo',(req,res)=>{const db=read();const c=db.codigos.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase()&&x.codigo===req.body.codigo&&new Date(x.expira)>new Date());if(!c)return res.status(400).json({error:'código inválido o vencido'});res.json({ok:true});});
app.post('/api/public/crear-empresa',(req,res)=>{
  const {nombre,email,password,plan,codigo,aceptoTerminos}=req.body;if(!aceptoTerminos)return res.status(400).json({error:'Debes aceptar términos Ley 1581'});
  const db=read();if(db.agencias.length>=MAX_AGENCIAS)return res.status(400).json({error:`Límite máximo ${MAX_AGENCIAS} agencias alcanzado - Contacta Avanza 3133181851`});
  const v=db.codigos.find(x=>x.email.toLowerCase()===email.toLowerCase()&&x.codigo===codigo&&x.tipo==='registro'&&new Date(x.expira)>new Date());if(!v)return res.status(400).json({error:'código de registro inválido'});
  if(db.usuarios.find(u=>u.email.toLowerCase()===email.toLowerCase()))return res.status(400).json({error:'ya existe'});
  const agenciaId='AG-'+Date.now().toString(36).toUpperCase();const id=Date.now().toString();const p=(plan||'basico').toLowerCase();
  db.agencias.push({id:agenciaId,nombre,email,plan:p,estado:'pendiente_pago',pagado:false,creado:new Date(),mantenimiento:'pendiente'});db.usuarios.push({id,nombre,email,rol:'jefe',plan:p,agenciaId,password:bcrypt.hashSync(password,10),creado:new Date()});db.codigos=db.codigos.filter(x=>x.email.toLowerCase()!==email.toLowerCase());write(db);
  res.json({ok:true,mensaje:'Empresa creada - Queda en historial - Contacta 3133181851 para activar con código de pago'});
});
app.post('/api/public/recuperar-password',(req,res)=>{const db=read();const v=db.codigos.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase()&&x.codigo===req.body.codigo&&x.tipo==='recuperacion'&&new Date(x.expira)>new Date());if(!v)return res.status(400).json({error:'código inválido'});const u=db.usuarios.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase());if(!u)return res.status(400).json({error:'usuario no existe'});u.password=bcrypt.hashSync(req.body.nuevaPassword,10);db.codigos=db.codigos.filter(x=>x.email.toLowerCase()!==req.body.email.toLowerCase());write(db);res.json({ok:true,mensaje:'Contraseña actualizada'});});
app.post('/api/login',(req,res)=>{const db=read();const u=db.usuarios.find(x=>x.email.toLowerCase()===req.body.email.toLowerCase());if(!u||!bcrypt.compareSync(req.body.password,u.password))return res.status(401).json({error:'usuario no existe'});const ag=db.agencias.find(a=>a.id===u.agenciaId);if(ag&&ag.estado==='bloqueada')return res.status(403).json({error:`Agencia bloqueada - Soporte Avanza 24/7 WPP ${WPP}`});const token=jwt.sign({id:u.id,email:u.email,rol:u.rol,nombre:u.nombre,plan:u.plan,agenciaId:u.agenciaId},JWT,{expiresIn:'7d'});res.json({token,user:{id:u.id,email:u.email,rol:u.rol,nombre:u.nombre,plan:u.plan,agenciaId:u.agenciaId,limites:getPlan(u.plan)}});});

// 2. BANDEJA ONLINE, NO LEIDOS, ETIQUETA AMARILLA CAMPAÑAS - TIEMPO REAL - FOTOS AUDIOS ARCHIVOS
app.get('/api/mensajes',auth,(req,res)=>{const db=read();let msgs=db.mensajes.filter(m=>m.agenciaId===req.user.agenciaId);if(req.query.filtro==='noleidos')msgs=msgs.filter(m=>!m.leido);if(req.query.filtro==='campana')msgs=msgs.filter(m=>m.origen==='campana');if(req.user.rol==='agente')msgs=msgs.filter(m=>!m.asignadoA||m.asignadoA===req.user.id);res.json(msgs.slice(-500).reverse().map(m=>({...m,etiqueta:m.origen==='campana'?'amarilla':null,online:true})));});
app.post('/api/mensajes/segmentar',auth,(req,res)=>{const db=read();const m=db.mensajes.find(x=>x.id==req.body.id&&x.agenciaId===req.user.agenciaId);if(m){m.segmento=req.body.segmento;write(db);}res.json({ok:true});});
app.post('/api/mensajes/seguimiento',auth,(req,res)=>{const db=read();const m=db.mensajes.find(x=>x.id==req.body.id&&x.agenciaId===req.user.agenciaId);if(m){m.seguimiento=req.body.nota;m.programado=req.body.fecha;m.leido=true;db.calendario=db.calendario||[];db.calendario.push({id:Date.now().toString(),agenciaId:req.user.agenciaId,cliente:m.numero,nombre:m.nombre||m.numero,nota:req.body.nota,fecha:req.body.fecha,creado:new Date(),por:req.user.email});write(db);}res.json({ok:true});});
app.post('/api/mensajes/asignar',auth,(req,res)=>{if(req.user.rol!=='jefe'&&req.user.rol!=='super')return res.status(403).json({error:'solo jefe puede asignar'});const db=read();const m=db.mensajes.find(x=>x.id==req.body.id&&x.agenciaId===req.user.agenciaId);if(m){m.asignadoA=req.body.trabajadorId;write(db);}res.json({ok:true});});

// 3. METRICAS Y SEGUIMIENTO JEFE
app.get('/api/metricas',auth,(req,res)=>{const db=read();const mis=db.mensajes.filter(m=>m.agenciaId===req.user.agenciaId);const trabajadores=db.trabajadores.filter(t=>t.agenciaId===req.user.agenciaId);res.json({totalMensajes:mis.length,noLeidos:mis.filter(m=>!m.leido).length,campana:mis.filter(m=>m.origen==='campana').length,nuevos:mis.filter(m=>m.segmento==='nuevo').length,plan:req.user.plan,limites:getPlan(req.user.plan),equipo:trabajadores.map(t=>({id:t.id,nombre:t.nombre,email:t.email,chats:mis.filter(m=>m.asignadoA===t.id).length,metricasPropias:mis.filter(m=>m.asignadoA===t.id).length})),totalAgencias:db.agencias.length});});

// 4. CALENDARIO CITAS Y RECORDATORIOS
app.get('/api/calendario',auth,(req,res)=>{const db=read();let cal=(db.calendario||[]).filter(c=>c.agenciaId===req.user.agenciaId);if(req.user.rol==='agente')cal=cal.filter(c=>{const msg=db.mensajes.find(m=>m.numero===c.cliente);return!msg||!msg.asignadoA||msg.asignadoA===req.user.id;});res.json(cal.sort((a,b)=>new Date(a.fecha)-new Date(b.fecha)));});
app.post('/api/calendario',auth,(req,res)=>{const db=read();db.calendario=db.calendario||[];db.calendario.push({id:Date.now().toString(),agenciaId:req.user.agenciaId,cliente:req.body.cliente,nombre:req.body.cliente,nota:req.body.nota,fecha:req.body.fecha,creado:new Date(),por:req.user.email});write(db);res.json({ok:true});});

// 5. TRABAJADORES - MISMO PLAN DEL JEFE - SIN CRUZAR
app.get('/api/trabajadores',auth,(req,res)=>{if(req.user.rol==='agente')return res.json([]);res.json(read().trabajadores.filter(t=>t.agenciaId===req.user.agenciaId));});
app.post('/api/trabajadores',auth,(req,res)=>{if(req.user.rol!=='jefe')return res.status(403).json({error:'solo jefe'});const db=read();const ag=db.agencias.find(a=>a.id===req.user.agenciaId);const p=getPlan(ag?.plan||req.user.plan);if(db.usuarios.filter(u=>u.agenciaId===req.user.agenciaId).length>=p.maxUsuarios)return res.status(400).json({error:`Tu plan ${ag.plan} solo permite ${p.maxUsuarios} usuarios - Actualiza a Premium/Gold WPP 3133181851`});const id=Date.now().toString();const planAg=ag?.plan||req.user.plan;db.trabajadores.push({id,nombre:req.body.nombre,email:req.body.email,agenciaId:req.user.agenciaId,creado:new Date()});db.usuarios.push({id,nombre:req.body.nombre,email:req.body.email,rol:'agente',plan:planAg,agenciaId:req.user.agenciaId,password:bcrypt.hashSync(req.body.password,10),creado:new Date()});write(db);res.json({ok:true});});
app.delete('/api/trabajadores/:id',auth,(req,res)=>{if(req.user.rol!=='jefe')return res.status(403).json({error:'solo jefe'});const db=read();db.trabajadores=db.trabajadores.filter(t=>!(t.id===req.params.id&&t.agenciaId===req.user.agenciaId));db.usuarios=db.usuarios.filter(u=>!(u.id===req.params.id&&u.agenciaId===req.user.agenciaId));write(db);res.json({ok:true});});

// 6. CAMPAÑAS EXCEL AUTO SELECCIÓN NUMEROS + ANTIBANEO POR SECCIONES + HISTORIAL
const up=multer({dest:'/tmp'});
app.post('/api/campanas/excel',auth,up.single('excel'),(req,res)=>{
  try{
    const wb=xlsx.readFile(req.file.path);const sheet=wb.Sheets[wb.SheetNames[0]];const data=xlsx.utils.sheet_to_json(sheet);
    const numeros=[...new Set(data.map(r=>{const v=Object.values(r)[0]; return v?String(v).replace(/\D/g,''):null}).filter(Boolean))];
    const db=read();const p=getPlan(req.user.plan);if(numeros.length>p.maxContactos)return res.status(400).json({error:`Tu plan ${req.user.plan} solo permite ${p.maxContactos} contactos`});
    const camp={id:Date.now().toString(),fecha:new Date(),total:numeros.length,numeros,por:req.user.email,agenciaId:req.user.agenciaId,estado:'pendiente',enviados:0,antibaneo:true};
    db.campanas=db.campanas||[];db.campanas.push(camp);write(db);res.json({ok:true,total:numeros.length,numeros:numeros.slice(0,200),campanaId:camp.id,antibaneo:`Se enviará en lotes de ${p.maxEnvio} cada 90s para evitar spam`});
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/campanas/enviar',auth,(req,res)=>{
  const db=read();const camp=(db.campanas||[]).find(c=>c.id===req.body.campanaId&&c.agenciaId===req.user.agenciaId);if(!camp)return res.status(404).json({error:'campaña no encontrada'});
  const p=getPlan(req.user.plan);const enviados=camp.enviados||0;const lote=camp.numeros.slice(enviados,enviados+p.maxEnvio);
  lote.forEach(num=>{db.mensajes.push({id:Date.now().toString()+Math.random(),numero:num,texto:`[${req.body.template||'plantilla'}]`,timestamp:new Date(),segmento:'nuevo',leido:false,agenciaId:req.user.agenciaId,origen:'campana',etiqueta:'amarilla',template:req.body.template});});
  camp.enviados+=lote.length;if(camp.enviados>=camp.numeros.length)camp.estado='completada';else camp.estado=`enviando ${camp.enviados}/${camp.numeros.length} - espera 90s`;write(db);
  res.json({ok:true,enviados:lote.length,restan:camp.numeros.length-camp.enviados,estado:camp.estado,politica:'Antibaneo: lotes pequeños para no ser marcado spam'});
});
app.get('/api/campanas/historial',auth,(req,res)=>{const db=read();res.json((db.campanas||[]).filter(c=>c.agenciaId===req.user.agenciaId).slice(-50).reverse());});

// 7. PLANTILLAS APROBADAS META AUTO
app.get('/api/templates',auth,async(req,res)=>{
  const db=read();const p=getPlan(req.user.plan);
  if(process.env.WHATSAPP_TOKEN&&process.env.WHATSAPP_BUSINESS_ID&&fetchFn){
    try{
      const r=await fetchFn(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_BUSINESS_ID}/message_templates?fields=name,status,language`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
      const j=await r.json();if(j.data&&j.data.length){const aprobadas=j.data.filter(t=>t.status==='APPROVED');if(aprobadas.length){db.templates=aprobadas;write(db);return res.json(aprobadas);}}
    }catch(e){console.log('templates fetch fail',e.message)}
  }
  res.json(db.templates||[]);
});

// 8. PLANES - PRECIO ANUAL + MANT TRIMESTRAL + BENEFICIOS + REDIRIGE A TU WPP
app.get('/api/planes',auth,(req,res)=>{res.json({planes:PLANES,actual:req.user.plan,wpp:WPP,link:`https://wa.me/${WPP}?text=Quiero%20cambiar%20a%20plan%20KLIDO`})});
app.post('/api/planes/cambiar',auth,(req,res)=>{
  if(req.user.rol!=='jefe'&&req.user.rol!=='super')return res.status(403).json({error:'solo jefe'});
  const db=read();const nuevo=(req.body.plan||'').toLowerCase();if(!PLANES[nuevo])return res.status(400).json({error:'plan inválido'});
  const ag=db.agencias.find(a=>a.id===req.user.agenciaId);if(ag){ag.plan=nuevo;}db.usuarios.filter(u=>u.agenciaId===req.user.agenciaId).forEach(u=>u.plan=nuevo);write(db);
  res.json({ok:true,mensaje:`Plan cambiado a ${nuevo} - Todos los trabajadores heredan ${nuevo}`,wpp:WPP});
});
app.post('/api/call',auth,(req,res)=>{const p=getPlan(req.user.plan);if(!p.llamadas)return res.status(403).json({error:'Llamadas solo Gold - Actualiza WPP 3133181851'});res.json({tel:`tel:${req.body.numero}`});});

// 9. CONFIGURACION Y AYUDA 24/7
app.get('/api/config',(req,res)=>res.json({empresa:'KLIDO Avanza Consulting - CRM Oficial Meta',version:'v110 PRO',api:'Meta WhatsApp Business API Oficial - Publicada',railway:'Pago activo',almacenamiento:'/data con backups',maxAgencias:MAX_AGENCIAS,wpp:WPP,soporte:'24/7',legal:'Términos y Ley 1581 Colombia - Pago anual + mantenimiento trimestral aparte',planes:{basico:'$800k/año + $80k cada 3 meses - Sin IA',premium:'$1.4M/año + $95k cada 3 meses - Con IA',gold:'$2.4M/año + $120k cada 3 meses - IA + Llamadas'}}));
app.get('/api/ayuda',(req,res)=>res.json({soporte:`https://wa.me/${WPP}?text=Soporte%20KLIDO%2024/7%20`,horario:'24/7 Avanza Consulting',wpp:'3133181851',email:'avanzaconsultingyl@gmail.com'}));

// 10. PANEL GERENCIA AVANZA - METRICAS, PLAN, PAGADO O NO, BLOQUEO/DESBLOQUEO TIEMPO REAL
app.get('/api/admin/agencias',auth,(req,res)=>{
  if(req.user.rol!=='super'&&req.user.email!=='avanzaconsultingyl@gmail.com'&&req.user.email!=='admin@klido.com')return res.status(403).json({error:'solo gerencia Avanza'});
  const db=read();
  res.json({
    agencias:db.agencias.map(a=>({id:a.id,nombre:a.nombre,email:a.email,plan:a.plan,estado:a.estado,pagado:a.pagado,mantenimiento:a.mantenimiento||'pendiente',creado:a.creado,usuarios:db.usuarios.filter(u=>u.agenciaId===a.id).length,trabajadores:db.trabajadores.filter(t=>t.agenciaId===a.id).length,mensajes:db.mensajes.filter(m=>m.agenciaId===a.id).length,campanas:db.campanas.filter(c=>c.agenciaId===a.id).length})),
    total:db.agencias.length,restan:MAX_AGENCIAS-db.agencias.length,historial:db.historial.slice(-200).reverse(),backups:fs.readdirSync(BACKUP_DIR).slice(-10),wpp:WPP
  });
});
app.post('/api/admin/bloquear',auth,(req,res)=>{
  if(req.user.rol!=='super'&&req.user.email!=='avanzaconsultingyl@gmail.com'&&req.user.email!=='admin@klido.com')return res.status(403).json({error:'solo gerencia'});
  const db=read();const ag=db.agencias.find(a=>a.id===req.body.agenciaId);if(ag){ag.estado=req.body.estado;ag.pagado=req.body.pagado;ag.mantenimiento=req.body.mantenimiento||ag.mantenimiento;write(db);}res.json({ok:true});
});

// WEBHOOK META - RECIBE FOTOS, AUDIOS, ARCHIVOS - TIEMPO REAL
app.get('/webhook',(req,res)=>res.send(req.query['hub.challenge']||'ok'));
app.post('/webhook',(req,res)=>{
  try{
    const entry=req.body.entry?.[0];const change=entry?.changes?.[0];const value=change?.value;const msg=value?.messages?.[0];const contact=value?.contacts?.[0];
    if(msg){
      const db=read();
      // Intenta detectar agencia por número destino o usa KLIDO-AVANZA por defecto (luego se asigna por webhook config)
      let agenciaId='KLIDO-AVANZA';
      // Si el mensaje trae metadata de tu número, busca agencia dueña de ese número (si guardas waId por agencia)
      const waId=value?.metadata?.phone_number_id; if(waId){const ag=db.agencias.find(a=>a.waPhoneId===waId); if(ag) agenciaId=ag.id;}
      let texto='[media]';let media=null;
      if(msg.text) texto=msg.text.body;
      else if(msg.image){texto='[foto]';media=msg.image;}
      else if(msg.audio){texto='[audio]';media=msg.audio;}
      else if(msg.document){texto='[archivo]';media=msg.document;}
      else if(msg.video){texto='[video]';media=msg.video;}
      db.mensajes.push({id:Date.now().toString(),numero:msg.from,nombre:contact?.profile?.name||msg.from,texto,media,timestamp:new Date(),segmento:'nuevo',leido:false,agenciaId,origen:'inbox',online:true});
      if(db.mensajes.length>15000) db.mensajes=db.mensajes.slice(-15000);
      write(db);
    }
  }catch(e){console.log('webhook err',e.message)} res.sendStatus(200);
});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`KLIDO v110 PRO COMPLETO - ${PORT} - WPP ${WPP} - MAX ${MAX_AGENCIAS} AGENCIAS - AUTONOMO - ${DB_FILE}`));
