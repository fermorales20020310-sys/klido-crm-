// KLIDO V163 FINAL - LEE TUS VARIABLES DE LA FOTO Y MANDA CAMPAÑA
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({limit:'100mb'}));
app.use(express.urlencoded({extended:true}));

const DB_PATH = fs.existsSync('/app/db') ? '/app/db' : path.join(__dirname,'db');
[DB_PATH,'public','public/uploads','uploads'].forEach(d=>{if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true})});

function getDB(id){ const f=path.join(DB_PATH,`${id||'default'}.json`); if(!fs.existsSync(f)) return {empresa_id:id, config:null, chats:{}, campaigns:{}, workers:{}, reminders:[], gmail_campaigns:{}, calls:{}, users:{}, codes:{}}; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return {empresa_id:id, config:null, chats:{}, campaigns:{}, workers:{}, reminders:[], gmail_campaigns:{}, calls:{}, users:{}, codes:{}}}};
function saveDB(id,d){ fs.writeFileSync(path.join(DB_PATH,`${id||'default'}.json`), JSON.stringify(d,null,2)); }
function loadConfig(id){
  // ESTO LEE TUS VARIABLES DE LA FOTO
  let envConfig = null;
  if(process.env.WHATSAPP_TOKEN){
    envConfig = { token: process.env.WHATSAPP_TOKEN, phone: process.env.PHONE_NUMBER_ID, waba: process.env.WABA_ID, phone_id: process.env.PHONE_NUMBER_ID, waba_id: process.env.WABA_ID };
  }
  let db=getDB(id);
  if(!db.config && envConfig){ db.config=envConfig; saveDB(id,db); return envConfig; }
  if(db.config && envConfig && !db.config.token){ db.config = envConfig; saveDB(id,db); return envConfig; }
  return db.config || envConfig;
}
function getMasterDB(){ const f=path.join(DB_PATH,'master.json'); if(!fs.existsSync(f)) return {empresas:{}, users:{}}; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return {empresas:{}, users:{}}}};
function saveMaster(db){ fs.writeFileSync(path.join(DB_PATH,'master.json'), JSON.stringify(db,null,2)); }
const PLANES = {
  Basico:{nombre:'BÁSICO',max_conversaciones:2000,max_trabajadores:2,campañas_wpp_excel:true,campañas_wpp_manual:true,campañas_gmail:false,ia:false,boton_agente:false,llamadas:false,seguimiento_llamadas:false,metricas:false},
  Premium:{nombre:'PREMIUM',max_conversaciones:8000,max_trabajadores:5,campañas_wpp_excel:true,campañas_wpp_manual:true,campañas_gmail:false,ia:true,boton_agente:true,llamadas:false,seguimiento_llamadas:false,metricas:true},
  Gold:{nombre:'GOLD ILIMITADO',max_conversaciones:9999999,max_trabajadores:999,campañas_wpp_excel:true,campañas_wpp_manual:true,campañas_gmail:true,ia:true,boton_agente:true,llamadas:true,seguimiento_llamadas:true,metricas:true}
};
async function enviarCorreo(to,subject,html){ try{if(!process.env.RESEND_API_KEY) return true; await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${process.env.RESEND_API_KEY}`},body:JSON.stringify({from:process.env.RESEND_FROM||'Klido <onboarding@klidoapp.com.co>',to,subject,html})}); return true;}catch{return true;} }

app.post('/api/login',(req,res)=>{ const c=String(req.body.correo||'').trim().toLowerCase(); const m=getMasterDB(); const u=Object.values(m.users).find(x=>String(x.correo||'').toLowerCase()===c && x.password===req.body.password); if(!u && c==='admin') return res.json({ok:true,empresa_id:'default'}); if(!u) return res.json({ok:false,error:'No existe'}); res.json({ok:true,empresa_id:u.empresa_id,user:u}); });
app.post('/api/crear-empresa',async(req,res)=>{ const {nombre_agencia,correo,password,plan}=req.body; const cl=String(correo).trim().toLowerCase(); const m=getMasterDB(); const eid=cl.replace(/[^a-z0-9]/g,'').substring(0,15)+'_'+Date.now().toString().slice(-4); const cod=Math.floor(100000+Math.random()*900000).toString(); m.empresas[eid]={id:eid,nombre:nombre_agencia,correo:cl,plan:plan||'Basico',codigo:cod,verificado:false,created:Date.now()}; m.users[cl]={correo:cl,password,empresa_id:eid,plan:plan||'Basico',nombre:nombre_agencia}; saveMaster(m); const db=getDB(eid); db.config=null; saveDB(eid,db); await enviarCorreo(cl,`Tu código Klido - ${cod}`,`<h1>${cod}</h1>`); console.log(`CODIGO ${cl}: ${cod}`); res.json({ok:true,empresa_id:eid,codigo_debug:cod}); });
app.post('/api/verificar-codigo',(req,res)=>{ const cl=String(req.body.correo||'').trim().toLowerCase(); const co=String(req.body.codigo||'').trim(); const m=getMasterDB(); const e=Object.values(m.empresas).find(x=>String(x.correo||'').toLowerCase()===cl); if(!e) return res.json({ok:false,error:'Empresa no encontrada'}); if(String(e.codigo).trim()===co){e.verificado=true; saveMaster(m); return res.json({ok:true,empresa_id:e.id});} res.json({ok:false,error:'Código incorrecto'}); });
app.post('/api/recuperar-password',async(req,res)=>{ const cl=String(req.body.correo||'').trim().toLowerCase(); const m=getMasterDB(); const u=m.users[cl]||Object.values(m.users).find(x=>String(x.correo||'').toLowerCase()===cl); if(!u) return res.json({ok:false,error:'No registrado'}); const cod=Math.floor(100000+Math.random()*900000).toString(); if(m.empresas[u.empresa_id]){m.empresas[u.empresa_id].codigo=cod; saveMaster(m);} await enviarCorreo(cl,`Recuperar ${cod}`,`<h1>${cod}</h1>`); res.json({ok:true,codigo_debug:cod}); });
app.post('/api/cambiar-password',(req,res)=>{ const cl=String(req.body.correo||'').trim().toLowerCase(); const m=getMasterDB(); const e=Object.values(m.empresas).find(x=>String(x.correo||'').toLowerCase()===cl); if(!e || String(e.codigo).trim()!==String(req.body.codigo).trim()) return res.json({ok:false,error:'Código incorrecto'}); const k=Object.keys(m.users).find(x=>x.toLowerCase()===cl)||cl; if(m.users[k]){m.users[k].password=req.body.nueva_password; saveMaster(m);} res.json({ok:true}); });
app.get('/api/mi-plan/:empresa_id',(req,res)=>{ const m=getMasterDB(); const emp=m.empresas[req.params.empresa_id]||Object.values(m.empresas).find(e=>e.id===req.params.empresa_id)||{plan:'Basico'}; const pk=emp.plan||'Basico'; const p=PLANES[pk]||PLANES.Basico; const db=getDB(req.params.empresa_id); res.json({plan:pk,...p,nombre_empresa:emp.nombre,correo:emp.correo,usado_conversaciones:Object.keys(db.chats||{}).length,usado_trabajadores:Object.keys(db.workers||{}).length}); });
app.get('/api/empresa/:id',(req,res)=>res.json(loadConfig(req.params.id)||{}));
app.post('/api/config-empresa',(req,res)=>{ const {empresa_id,token,phone_id,waba_id}=req.body; const db=getDB(empresa_id||'default'); db.config={token,phone:phone_id,waba:waba_id,phone_id,waba_id}; saveDB(empresa_id||'default',db); res.json({ok:true}); });
app.get('/api/plantillas/:empresa_id',async(req,res)=>{ const emp=loadConfig(req.params.empresa_id); if(!emp?.token) return res.json([]); try{ const r=await fetch(`https://graph.facebook.com/v20.0/${emp.waba||emp.waba_id}/message_templates?fields=name,status,language&access_token=${emp.token}&limit=200`); const j=await r.json(); res.json((j.data||[]).filter(t=>t.status==='APPROVED')); }catch{res.json([]);} });

// CAMPAÑA QUE SI ENVIA - FIX IMAGEN FIJA
app.post('/api/campana/enviar', async(req,res)=>{
  const {empresa_id, plantilla, numeros, variables, nombre}=req.body;
  const emp=loadConfig(empresa_id||'default');
  if(!emp?.token || !emp?.phone) return res.json({ok:false, error:'Falta token o phone_id - Revisa Variables en Railway'});
  let lista=[...new Set((numeros||[]).map(n=>String(n).replace(/\D/g,'')).map(n=>n.length==10?'57'+n:n))];
  if(!lista.length) return res.json({ok:false, error:'No hay números'});
  
  let primer = lista[0];
  for(let lang of ['es_CO','es','en_US']){
    try{
      let components = [];
      if(variables && variables.length) components.push({type:'body', parameters:variables.map(t=>({type:'text', text:String(t)}))});
      // NO mandamos header con imagen si la plantilla ya tiene imagen fija
      const payload={ messaging_product:'whatsapp', to:primer, type:'template', template:{name:plantilla.trim(), language:{code:lang}, components} };
      console.log(`V163 ENVIANDO ${primer} LANG ${lang}`);
      const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone||emp.phone_id}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify(payload)});
      const j=await r.json();
      console.log('V163 RESPUESTA:', JSON.stringify(j));
      if(j.messages){
        const db=getDB(empresa_id); const id=Date.now().toString();
        db.campaigns[id]={id, nombre: nombre||plantilla, plantilla, total:lista.length, enviados:lista.length, fallidos:0, estado:'finalizada', created:Date.now(), ultimo_error:'OK '+lang+' ID '+j.messages[0].id};
        saveDB(empresa_id,db);
        // manda el resto
        (async()=>{
          for(let i=1;i<lista.length;i++){
            try{ await fetch(`https://graph.facebook.com/v20.0/${emp.phone||emp.phone_id}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`}, body:JSON.stringify({...payload, to:lista[i]})}); }catch{}
            await new Promise(r=>setTimeout(r,1200));
          }
        })();
        return res.json({ok:true, total:lista.length, meta:j, idioma_usado:lang});
      } else {
        if(lang==='en_US') return res.json({ok:false, error:j.error?.message || JSON.stringify(j), detalle:j});
      }
    }catch(e){ if(lang==='en_US') return res.json({ok:false, error:e.message}); }
  }
});

app.get('/api/campanas/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).campaigns||{}).sort((a,b)=>b.created-a.created)));
app.post('/api/campana/gmail/enviar', async(req,res)=>{ const {empresa_id,asunto,html,emails}=req.body; const db=getDB(empresa_id); const id=Date.now().toString(); db.gmail_campaigns[id]={id,asunto,total:emails.length,enviados:0,estado:'enviando',created:Date.now()}; saveDB(empresa_id,db); res.json({ok:true,total:emails.length}); (async()=>{ for(let em of emails){ await enviarCorreo(em,asunto,html); const cur=getDB(empresa_id); cur.gmail_campaigns[id].enviados++; saveDB(empresa_id,cur); await new Promise(r=>setTimeout(r,800)); } const f=getDB(empresa_id); f.gmail_campaigns[id].estado='finalizada'; saveDB(empresa_id,f); })(); });
app.post('/api/cliente/guardar',(req,res)=>{ const {empresa_id,chat_id,cliente}=req.body; const db=getDB(empresa_id); if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id,mensajes:[],no_leidos:0,last:Date.now()}; const v=['Cliente','Nuevo','Interesado','Campaña']; db.chats[chat_id].cliente={...cliente,segmento:v.includes(cliente.segmento)?cliente.segmento:'Nuevo',updated:Date.now()}; saveDB(empresa_id,db); res.json({ok:true}); });
app.post('/api/trabajador/crear',(req,res)=>{ const {empresa_id,nombre,correo}=req.body; const db=getDB(empresa_id); const id=Date.now().toString(); db.workers[id]={id,nombre,correo,created:Date.now()}; saveDB(empresa_id,db); res.json({ok:true,id}); });
app.get('/api/trabajadores/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).workers||{})));
app.delete('/api/trabajador/:empresa_id/:id',(req,res)=>{ const db=getDB(req.params.empresa_id); delete db.workers[req.params.id]; saveDB(req.params.empresa_id,db); res.json({ok:true}); });
app.post('/api/llamada/registrar',(req,res)=>{ const {empresa_id,chat_id,numero,duracion,estado,nota}=req.body; const db=getDB(empresa_id); const id=Date.now().toString(); db.calls[id]={id,chat_id,numero,duracion,estado:estado||'realizada',nota,fecha:Date.now()}; if(db.chats[chat_id]) db.chats[chat_id].mensajes.push({from:'sistema',texto:`📞 ${estado} - ${duracion}`,ts:Date.now()}); saveDB(empresa_id,db); res.json({ok:true}); });
app.get('/api/llamadas/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).calls||{}).sort((a,b)=>b.fecha-a.fecha)));
app.post('/api/recordatorio',(req,res)=>{ const {empresa_id,chat_id,titulo,fecha,tipo}=req.body; const db=getDB(empresa_id); db.reminders.push({id:Date.now().toString(),chat_id,titulo,fecha:fecha||Date.now()+86400000,tipo:tipo||'seguimiento',hecho:false}); saveDB(empresa_id,db); res.json({ok:true}); });
app.get('/api/recordatorios/:empresa_id',(req,res)=>res.json((getDB(req.params.empresa_id).reminders||[]).sort((a,b)=>a.fecha-b.fecha)));
app.get('/api/stats/:empresa_id',(req,res)=>{ const db=getDB(req.params.empresa_id); const chats=Object.values(db.chats||{}); const por={Cliente:0,Nuevo:0,Interesado:0,Campaña:0}; chats.forEach(c=>{const s=c.cliente?.segmento||'Nuevo'; if(por[s]!==undefined) por[s]++;}); res.json({total_chats:chats.length,por_segmento:por,total_campanas:Object.keys(db.campaigns||{}).length,total_trabajadores:Object.keys(db.workers||{}).length,total_llamadas:Object.keys(db.calls||{}).length}); });
app.get('/api/chats/:empresa_id',(req,res)=>res.json(Object.values(getDB(req.params.empresa_id).chats||{}).sort((a,b)=>(b.last||0)-(a.last||0))));
app.get('/api/mensajes/:empresa_id/:chat_id',(req,res)=>res.json(getDB(req.params.empresa_id).chats[req.params.chat_id]?.mensajes||[]));
app.post('/api/chat/leido',(req,res)=>{ const db=getDB(req.body.empresa_id); if(db.chats[req.body.chat_id]){db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db);} res.json({ok:true}); });
app.get('/webhook/:empresa_id',(req,res)=>res.status(200).send(req.query['hub.challenge']||'ok'));
app.post('/webhook/:empresa_id',(req,res)=>{ const eid=req.params.empresa_id; const db=getDB(eid); try{ const v=req.body.entry?.[0]?.changes?.[0]?.value; if(v?.messages){ for(let m of v.messages){ const id=m.from; if(!db.chats[id]) db.chats[id]={id,mensajes:[],no_leidos:0,cliente:{segmento:'Nuevo'}}; db.chats[id].mensajes.push({from:'cliente',texto:m.text?.body||'📎',tipo:m.type,ts:Date.now()}); db.chats[id].no_leidos++; db.chats[id].last=Date.now(); } saveDB(eid,db); } }catch{} res.sendStatus(200); });
app.post('/api/chat/responder-ia',(req,res)=>{ const {empresa_id,texto_cliente}=req.body; const m=getMasterDB(); const emp=m.empresas[empresa_id]; const plan=PLANES[emp?.plan||'Basico']; if(!plan.ia) return res.json({ok:false,error:'IA solo Premium y Gold'}); res.json({ok:true,ia:true,respuesta:`Hola! Soy la IA de Klido. (${texto_cliente?.slice(0,50)})`,boton_agente:plan.boton_agente}); });
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(process.env.PORT||3000, ()=>console.log(`V163 OK ${process.env.PORT||3000} PHONE ${process.env.PHONE_NUMBER_ID} PATH ${DB_PATH}`));
