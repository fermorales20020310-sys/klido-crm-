require('dotenv').config();
const express=require('express'),http=require('http'),{Server}=require('socket.io');
const cors=require('cors'),multer=require('multer'),xlsx=require('xlsx'),axios=require('axios');
const bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),{v4:uuidv4}=require('uuid');
const nodemailer=require('nodemailer'),path=require('path');
const app=express();const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});
app.use(cors());app.use(express.json({limit:'50mb'}));
app.use(express.static(path.join(__dirname,'public')));
const PORT=process.env.PORT||3000;
const JWT=process.env.JWT_SECRET||'klido_secret_2026_real';
let empresas=[],codigos={},mensajes={},contactos={},campanas=[],plantillas=[];
let transporter=null;
if(process.env.SMTP_USER){transporter=nodemailer.createTransport({host:process.env.SMTP_HOST||'smtp.gmail.com',port:587,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});}
function codigoPlan(p){return `KLIDO-${p.toUpperCase()}-${Math.random().toString(36).substring(2,8).toUpperCase()}-${Date.now().toString().slice(-4)}`;}
async function syncPlantillas(){
 if(!process.env.WHATSAPP_TOKEN||!process.env.WABA_ID)return;
 try{const r=await axios.get(`https://graph.facebook.com/${process.env.GRAPH_VERSION||'v20.0'}/${process.env.WABA_ID}/message_templates`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
 plantillas=r.data.data.filter(t=>t.status==='APPROVED');console.log('[Klido] Plantillas:',plantillas.length);}catch(e){console.log('Error plantillas',e.message);}
}
setInterval(syncPlantillas,5*60*1000);syncPlantillas();
app.get('/health',(req,res)=>res.json({status:'ok',v12:true,plantillas:plantillas.length}));
app.get('/api/plantillas',(req,res)=>res.json(plantillas));
app.post('/api/empresas/crear',async(req,res)=>{
 const{nombre,correo,password,plan}=req.body;
 if(empresas.find(e=>e.correo===correo))return res.status(400).json({error:'Correo ya registrado'});
 const hash=await bcrypt.hash(password,10);const c=codigoPlan(plan);
 const emp={id:uuidv4(),nombre,correo,passwordHash:hash,plan,codigoPlan:c,activo:true,createdAt:new Date()};
 empresas.push(emp);contactos[emp.id]=[];mensajes[emp.id]={};
 res.json({ok:true,empresa:{id:emp.id,nombre,correo,plan,codigoPlan:c}});
});
app.post('/api/login',async(req,res)=>{
 const{correo,password,codigoPlan}=req.body;const emp=empresas.find(e=>e.correo===correo);
 if(!emp)return res.status(404).json({error:'Empresa no existe'});
 if(!(await bcrypt.compare(password,emp.passwordHash)))return res.status(401).json({error:'Pass incorrecta'});
 if(codigoPlan&&codigoPlan!==emp.codigoPlan)return res.status(401).json({error:'Código de plan inválido'});
 const token=jwt.sign({id:emp.id,plan:emp.plan},JWT,{expiresIn:'12h'});
 res.json({ok:true,token,empresa:{id:emp.id,nombre:emp.nombre,plan:emp.plan}});
});
app.post('/api/recuperar/enviar',async(req,res)=>{
 const{correo}=req.body;const emp=empresas.find(e=>e.correo===correo);
 if(!emp)return res.status(404).json({error:'Correo no registrado'});
 const code=Math.floor(100000+Math.random()*900000).toString();codigos[correo]={code,expires:Date.now()+15*60*1000};
 if(transporter)await transporter.sendMail({from:process.env.SMTP_USER,to:correo,subject:'Klido - Código recuperación',html:`<h2>Tu código: ${code}</h2><p>Expira 15min</p>`});
 console.log(`CODIGO ${correo} -> ${code}`);
 res.json({ok:true,mensaje:'Código enviado (revisa spam). Expira 15min',previewCode:!transporter?code:undefined});
});
app.post('/api/recuperar/cambiar',async(req,res)=>{
 const{correo,code,nuevaPassword}=req.body;const d=codigos[correo];
 if(!d||d.code!==code||Date.now()>d.expires)return res.status(400).json({error:'Código inválido'});
 const emp=empresas.find(e=>e.correo===correo);emp.passwordHash=await bcrypt.hash(nuevaPassword,10);delete codigos[correo];
 res.json({ok:true});
});
function auth(req,res,next){const h=req.headers.authorization;if(!h)return res.status(401).json({error:'No token'});try{req.user=jwt.verify(h.replace('Bearer ',''),JWT);next();}catch{res.status(401).json({error:'Token inválido'})}}
app.get('/api/inbox',auth,(req,res)=>res.json(contactos[req.user.id]||[]));
app.get('/api/mensajes/:tel',auth,(req,res)=>res.json(mensajes[req.user.id]?.[req.params.tel]||[]));
app.post('/api/mensajes/enviar',auth,async(req,res)=>{
 const{telefono,tipo,contenido}=req.body;if(!mensajes[req.user.id])mensajes[req.user.id]={};if(!mensajes[req.user.id][telefono])mensajes[req.user.id][telefono]=[];
 const m={id:uuidv4(),de:'yo',tipo,contenido,fecha:new Date()};mensajes[req.user.id][telefono].push(m);
 if(tipo==='text'&&process.env.WHATSAPP_TOKEN){try{await axios.post(`https://graph.facebook.com/${process.env.GRAPH_VERSION||'v20.0'}/${process.env.PHONE_NUMBER_ID}/messages`,{messaging_product:'whatsapp',to:telefono,type:'text',text:{body:contenido}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});}catch(e){}}
 io.to(req.user.id).emit('nuevo_mensaje',{telefono,mensaje:m});res.json({ok:true,mensaje:m});
});
app.post('/webhook',(req,res)=>{
 const entry=req.body.entry?.[0]?.changes?.[0]?.value;
 if(entry?.messages){const tel=entry.messages[0].from;const txt=entry.messages[0].text?.body||`[${entry.messages[0].type}]`;const empId=empresas[0]?.id;
 if(empId){if(!mensajes[empId])mensajes[empId]={};if(!mensajes[empId][tel])mensajes[empId][tel]=[];mensajes[empId][tel].push({id:uuidv4(),de:'cliente',tipo:'text',contenido:txt,fecha:new Date()});
 let c=contactos[empId].find(x=>x.telefono===tel);if(!c){c={id:uuidv4(),telefono,nombre:entry.contacts?.[0]?.profile?.name||tel,noLeido:true,esCampana:false};contactos[empId].unshift(c);}else c.noLeido=true;
 io.to(empId).emit('nuevo_mensaje_cliente',{telefono:tel,contenido:txt});}}res.sendStatus(200);
});
app.get('/webhook',(req,res)=>{if(req.query['hub.verify_token']===process.env.VERIFY_TOKEN)res.send(req.query['hub.challenge']);else res.sendStatus(403);});
const upload=multer({dest:'uploads/'});
app.post('/api/campanas/crear',auth,upload.single('excel'),async(req,res)=>{
 const{nombre,plantillaId}=req.body;const plantilla=plantillas.find(p=>p.id===plantillaId)||plantillas[0];
 if(!plantilla)return res.status(400).json({error:'No hay plantillas aprobadas'});
 const wb=xlsx.readFile(req.file.path);const data=xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
 const tels=data.map(r=>Object.values(r).find(v=>String(v).match(/^[0-9]{10,15}$/))).filter(Boolean).map(t=>String(t).replace(/\D/g,''));
 const camp={id:uuidv4(),empresaId:req.user.id,nombre,plantilla:plantilla.name,total:tels.length,enviados:0,fecha:new Date(),estado:'en_proceso',telefonos:tels};
 campanas.push(camp);let bloque=0;
 const enviarBloque=async()=>{const lote=tels.slice(bloque*50,(bloque+1)*50);if(lote.length===0){camp.estado='finalizada';return;}
 for(let tel of lote){try{await axios.post(`https://graph.facebook.com/${process.env.GRAPH_VERSION||'v20.0'}/${process.env.PHONE_NUMBER_ID}/messages`,{messaging_product:'whatsapp',to:tel,type:'template',template:{name:plantilla.name,language:{code:plantilla.language||'es_CO'}}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});camp.enviados++;}catch(e){}await new Promise(r=>setTimeout(r,1500));}
 bloque++;io.to(req.user.id).emit('campana_update',camp);if(bloque*50<tels.length)setTimeout(enviarBloque,5*60*60*1000);else camp.estado='finalizada';};
 enviarBloque();res.json({ok:true,campana:camp,mensaje:`Campaña iniciada ${tels.length} números bloques 50/5h antibaneo`});
});
app.get('/api/campanas',auth,(req,res)=>res.json(campanas.filter(c=>c.empresaId===req.user.id)));
io.on('connection',socket=>{socket.on('join_empresa',id=>socket.join(id));});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,()=>console.log(`Klido V12 REAL en ${PORT}`));
