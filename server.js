// KLIDO V210 - MULTIEMPRESA - PLANES COP ANUAL BLOQUEADOS - ADMIN vs TRABAJADOR
const express=require('express');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
const multer=require('multer');
const XLSX=require('xlsx');

const app=express();
app.use(cors());
app.use(express.json({limit:'200mb'}));
app.use(express.urlencoded({extended:true}));
const upload=multer({dest:'/tmp/'});

const DB_PATH='/app/db';
if(!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH,{recursive:true});
const S=s=>String(s||'').replace(/[^a-z0-9_\-@.]/gi,'').slice(0,80);
const getDB=id=>{const f=path.join(DB_PATH,`${S(id)}.json`); if(!fs.existsSync(f)) return null; try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return null}};
const saveDB=(id,d)=>fs.writeFileSync(path.join(DB_PATH,`${S(id)}.json`),JSON.stringify(d,null,2));
const listEmpresas=()=>fs.readdirSync(DB_PATH).filter(f=>f.endsWith('.json')).map(f=>{try{const j=JSON.parse(fs.readFileSync(path.join(DB_PATH,f),'utf8')); return j;}catch{return null}}).filter(j=>j&&j.empresa_id);
const findByPhone=phone=>{for(const f of fs.readdirSync(DB_PATH)){try{const j=JSON.parse(fs.readFileSync(path.join(DB_PATH,f),'utf8')); if(String(j.config?.phone)===String(phone)) return j.empresa_id}catch{}} return null;};

// PLANES DEFINIDOS COP ANUAL
const PLANES={
  basico:{nombre:'BÁSICO', precio:420000, anual:true, limite_msgs:1000, max_agentes:1, permisos:{historial:true, notas_basicas:true, camp_whatsapp:false, camp_gmail:false, ia:false, llamadas:false, stats:false, calendario:false}},
  gold:{nombre:'GOLD', precio:1200000, anual:true, limite_msgs:20000, max_agentes:5, permisos:{historial:true, notas_basicas:true, camp_whatsapp:true, camp_gmail:true, ia:true, llamadas:true, stats:true, calendario:true, asignar_chats:true, segmentar:true}},
  premium:{nombre:'PREMIUM', precio:2400000, anual:true, limite_msgs:999999, max_agentes:100, permisos:{historial:true, notas_basicas:true, camp_whatsapp:true, camp_gmail:true, ia:true, ia_avanzada:true, llamadas:true, stats:true, calendario:true, asignar_chats:true, segmentar:true, api:true, grupos:true}}
};

const VERIFY=(process.env.META_VERIFY_TOKEN||'klido123').trim();
console.log('V210 MULTI ROLES - VERIFY:',VERIFY);

const verify=(req,res)=>{ if(req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===VERIFY) return res.send(req.query['hub.challenge']); res.sendStatus(403); };
app.get('/webhook',verify); app.get('/webhook/:empresa_id',verify);

async function handle(body){
  const val=body.entry?.[0]?.changes?.[0]?.value; if(!val) return;
  const phoneId=val.metadata?.phone_number_id;
  const eid=findByPhone(phoneId)||'fermorales20020gmailcom_1234';
  let db=getDB(eid); if(!db) return; if(!db.chats) db.chats={};
  if(val.messages){
    for(const m of val.messages){
      const from=m.from; if(!db.chats[from]) db.chats[from]={id:from, mensajes:[], notas:[], tags:[], recordatorios:[], asignado_a:null, grupo:null, no_leidos:0, last:Date.now()};
      let texto=m.type==='text'?m.text.body:`📎 ${m.type} ${m.type==='image'?'📷':m.type==='video'?'🎥':m.type==='audio'?'🎤':'📄'}`;
      let media_id=m[m.type]?.id||null, media_url=null;
      if(media_id && db.config?.token){ try{const r=await fetch(`https://graph.facebook.com/v20.0/${media_id}`,{headers:{Authorization:`Bearer ${db.config.token}`}}); const j=await r.json(); media_url=j.url;}catch{}}
      db.chats[from].mensajes.push({from:'cliente', texto, type:m.type, media_id, media_url, ts:Date.now()});
      db.chats[from].no_leidos++; db.chats[from].last=Date.now();
      // IA si es Gold/Premium y plan activo
      if(db.plan_activo && PLANES[db.plan]?.permisos.ia && db.config_ia?.activa){
        // IA simple: responde si no tiene asignado
        if(!db.chats[from].asignado_a){
          setTimeout(async()=>{
            try{
              const iaTexto=`Hola! Soy la IA de ${db.nombre}. ${db.config_ia.prompt||'¿En qué te ayudo?'}`;
              await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST',headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`}, body:JSON.stringify({messaging_product:'whatsapp', to:from, type:'text', text:{body:iaTexto}})});
            }catch{}
          },1500);
        }
      }
    }
    saveDB(eid,db);
  }
}
app.post('/webhook',(req,res)=>{handle(req.body); res.sendStatus(200);});
app.post('/webhook/:empresa_id',(req,res)=>{handle(req.body); res.sendStatus(200);});

// --- EMPRESA REGISTRO ---
app.post('/api/empresa/registrar',(req,res)=>{
  const {nombre,email,phone,token,waba,plan,admin_pass}=req.body;
  if(!phone||!token||!admin_pass) return res.json({ok:false, error:'Falta phone/token/pass admin'});
  const empresa_id=`${S(email||nombre)}_${Date.now()}`;
  const db={empresa_id, nombre, email, plan:plan||'basico', plan_activo:false, plan_pagado_hasta:null, creado:Date.now(), config:{phone:String(phone).trim(), token:String(token).trim(), waba:String(waba||'').trim()}, config_ia:{activa:false, prompt:'Soy tu asistente virtual'}, usuarios:[{id:'admin', nombre:'Admin', email, pass:admin_pass, rol:'admin', creado:Date.now()}], chats:{}, campanas:[], stats:{msgs_enviados_mes:0, reset_mes:Date.now()}};
  saveDB(empresa_id,db);
  res.json({ok:true, empresa_id, webhook_url:`https://app.klidoapp.com.co/webhook/${empresa_id}`, mensaje:'Empresa creada. Plan BLOQUEADO hasta pagar.'});
});

// Activar plan (simula pago)
app.post('/api/empresa/pagar',(req,res)=>{
  const {empresa_id, plan}=req.body; const db=getDB(empresa_id); if(!db) return res.json({ok:false});
  if(!PLANES[plan]) return res.json({ok:false, error:'Plan no existe'});
  db.plan=plan; db.plan_activo=true; db.plan_pagado_hasta=Date.now()+365*24*60*60*1000;
  saveDB(empresa_id,db);
  res.json({ok:true, plan:PLANES[plan], hasta: new Date(db.plan_pagado_hasta).toLocaleDateString()});
});

app.post('/api/login',(req,res)=>{
  const {empresa_id, email, pass}=req.body; const db=getDB(empresa_id); if(!db) return res.json({ok:false, error:'Empresa no existe'});
  const user=db.usuarios.find(u=>u.email===email && u.pass===pass); if(!user) return res.json({ok:false, error:'Credenciales mal'});
  if(!db.plan_activo) return res.json({ok:false, error:'PLAN BLOQUEADO', bloqueado:true, plan:db.plan, precio:PLANES[db.plan]?.precio});
  res.json({ok:true, user:{id:user.id, nombre:user.nombre, rol:user.rol, email:user.email}, empresa_id, plan:db.plan, permisos:PLANES[db.plan]?.permisos});
});

app.get('/api/empresas', (req,res)=>res.json(listEmpresas().map(e=>({empresa_id:e.empresa_id, nombre:e.nombre, email:e.email, phone:e.config?.phone, plan:e.plan, activo:e.plan_activo, hasta:e.plan_pagado_hasta}))));

// Admin: trabajadores
app.post('/api/admin/trabajador/add',(req,res)=>{
  const {empresa_id, admin_email, admin_pass, nombre, email, pass}=req.body;
  const db=getDB(empresa_id); if(!db) return res.json({ok:false});
  const admin=db.usuarios.find(u=>u.rol==='admin' && u.email===admin_email && u.pass===admin_pass); if(!admin) return res.json({ok:false, error:'No autorizado admin'});
  if(db.usuarios.length>=PLANES[db.plan].max_agentes) return res.json({ok:false, error:`Limite de ${PLANES[db.plan].max_agentes} agentes para plan ${db.plan}`});
  const id=`trab_${Date.now()}`;
  db.usuarios.push({id, nombre, email, pass, rol:'trabajador', creado:Date.now()});
  saveDB(empresa_id,db); res.json({ok:true, id});
});
app.post('/api/admin/trabajador/del',(req,res)=>{
  const {empresa_id, admin_email, admin_pass, trabajador_id}=req.body;
  const db=getDB(empresa_id); if(!db) return res.json({ok:false});
  const admin=db.usuarios.find(u=>u.rol==='admin' && u.email===admin_email && u.pass===admin_pass); if(!admin) return res.json({ok:false});
  db.usuarios=db.usuarios.filter(u=>u.id!==trabajador_id); saveDB(empresa_id,db); res.json({ok:true});
});
app.get('/api/admin/trabajadores/:empresa_id',(req,res)=>{ const db=getDB(req.params.empresa_id); if(!db) return res.json([]); res.json(db.usuarios); });

// Chats con rol
app.get('/api/chats/:empresa_id/:user_id',(req,res)=>{
  const db=getDB(req.params.empresa_id); if(!db) return res.json([]);
  const user=db.usuarios.find(u=>u.id===req.params.user_id); if(!user) return res.json([]);
  let chats=Object.values(db.chats||{});
  if(user.rol==='trabajador'){ chats=chats.filter(c=>c.asignado_a===user.id ||!c.asignado_a); } // ve asignados y sin asignar
  res.json(chats.sort((a,b)=>b.last-a.last));
});
app.post('/api/admin/asignar',(req,res)=>{ const {empresa_id, chat_id, trabajador_id}=req.body; const db=getDB(empresa_id); if(!db?.chats?.[chat_id]) return res.json({ok:false}); db.chats[chat_id].asignado_a=trabajador_id; saveDB(empresa_id,db); res.json({ok:true}); });

// Mensajes, notas, tags, recordatorios, calendario
app.get('/api/mensajes/:empresa_id/:chat_id',(req,res)=>{ const db=getDB(req.params.empresa_id); res.json((db?.chats?.[req.params.chat_id]?.mensajes||[]).sort((a,b)=>a.ts-b.ts)); });
app.post('/api/mensaje/enviar', async (req,res)=>{
  const {empresa_id, chat_id, texto, user_id}=req.body; const db=getDB(empresa_id); if(!db) return res.json({ok:false});
  if(!db.plan_activo) return res.json({ok:false, error:'PLAN BLOQUEADO'});
  const user=db.usuarios.find(u=>u.id===user_id); if(user?.rol==='trabajador'){ const chat=db.chats[chat_id]; if(chat?.asignado_a && chat.asignado_a!==user_id) return res.json({ok:false, error:'Chat no asignado a ti'}); }
  try{
    const r=await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`}, body:JSON.stringify({messaging_product:'whatsapp', to:String(chat_id).replace(/\D/g,''), type:'text', text:{body:texto}})});
    const j=await r.json(); if(j.error) return res.json({ok:false, error:j.error});
    if(!db.chats[chat_id]) db.chats[chat_id]={id:chat_id, mensajes:[], notas:[], tags:[], recordatorios:[], asignado_a:user_id, last:Date.now()};
    db.chats[chat_id].mensajes.push({from:'agente', texto, ts:Date.now(), por:user_id}); db.chats[chat_id].last=Date.now(); saveDB(empresa_id,db); res.json({ok:true});
  }catch(e){ res.json({ok:false, error:e.message}); }
});
app.post('/api/chat/nota',(req,res)=>{ const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false}); db.chats[req.body.chat_id].notas=db.chats[req.body.chat_id].notas||[]; db.chats[req.body.chat_id].notas.push({texto:req.body.nota, por:req.body.user_id, ts:Date.now()}); saveDB(req.body.empresa_id,db); res.json({ok:true}); });
app.post('/api/chat/tag',(req,res)=>{ const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false}); db.chats[req.body.chat_id].tags=db.chats[req.body.chat_id].tags||[]; if(!db.chats[req.body.chat_id].tags.includes(req.body.tag)) db.chats[req.body.chat_id].tags.push(req.body.tag); saveDB(req.body.empresa_id,db); res.json({ok:true}); });
app.post('/api/chat/recordatorio',(req,res)=>{ const db=getDB(req.body.empresa_id); if(!db?.chats?.[req.body.chat_id]) return res.json({ok:false}); db.chats[req.body.chat_id].recordatorios=db.chats[req.body.chat_id].recordatorios||[]; db.chats[req.body.chat_id].recordatorios.push({texto:req.body.texto, fecha:req.body.fecha, por:req.body.user_id, ts:Date.now()}); saveDB(req.body.empresa_id,db); res.json({ok:true}); });
app.post('/api/chat/leido',(req,res)=>{ const db=getDB(req.body.empresa_id); if(db?.chats?.[req.body.chat_id]){ db.chats[req.body.chat_id].no_leidos=0; saveDB(req.body.empresa_id,db);} res.json({ok:true}); });

// Estadisticas
app.get('/api/stats/:empresa_id',(req,res)=>{
  const db=getDB(req.params.empresa_id); if(!db) return res.json({ok:false});
  const chats=Object.values(db.chats||{}); const total=chats.length; const sinAsignar=chats.filter(c=>!c.asignado_a).length;
  const porAgente={}; chats.forEach(c=>{ const a=c.asignado_a||'sin asignar'; porAgente[a]=(porAgente[a]||0)+1; });
  res.json({ok:true, total_chats:total, sin_asignar:sinAsignar, por_agente:porAgente, plan:db.plan, permisos:PLANES[db.plan]?.permisos, plan_activo:db.plan_activo});
});

// Campañas
app.post('/api/campana/excel', upload.single('file'), (req,res)=>{
  try{ const wb=XLSX.readFile(req.file.path); const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1}); let nums=[]; rows.flat().forEach(v=>{ const m=String(v||'').match(/(\d{10,15})/g); if(m) nums.push(...m); }); nums=[...new Set(nums.map(n=>n.replace(/\D/g,'')))]; fs.unlinkSync(req.file.path); res.json({ok:true, total:nums.length, numeros:nums}); }catch(e){ res.json({ok:false, error:e.message}); }
});
app.post('/api/campana/enviar', async (req,res)=>{
  const {empresa_id, numeros, mensaje}=req.body; const db=getDB(empresa_id); if(!db) return res.json({ok:false});
  if(!PLANES[db.plan]?.permisos.camp_whatsapp) return res.json({ok:false, error:'PLAN BLOQUEADO: Campañas solo Gold/Premium'});
  let enviados=0; for(const num of numeros){ try{ await fetch(`https://graph.facebook.com/v20.0/${db.config.phone}/messages`,{method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${db.config.token}`}, body:JSON.stringify({messaging_product:'whatsapp', to:num, type:'text', text:{body:mensaje}})}); enviados++; await new Promise(r=>setTimeout(r,400)); }catch{} }
  res.json({ok:true, enviados});
});

app.get('/api/planes',(req,res)=>res.json(PLANES));

const INDEX=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Klido V210</title><style>body{margin:0;font-family:Arial;background:#0b141a;color:#111}.wrap{display:flex;height:100vh} #l{width:380px;background:#fff;border-right:1px solid #ddd;display:flex;flex-direction:column} #r{flex:1;display:flex;flex-direction:column;background:#efeae2}.it{padding:10px;border-bottom:1px solid #eee;cursor:pointer}.it:hover{background:#f5f5f5}.b{max-width:68%;padding:8px 12px;border-radius:8px;margin:4px 10px;font-size:14px}.c{background:#fff;align-self:flex-start}.a{background:#d9fdd3;align-self:flex-end} #msgs{flex:1;overflow:auto;display:flex;flex-direction:column} input,select,button{padding:8px;border-radius:8px;border:1px solid #ccc;margin:2px} button{background:#000;color:#fff;cursor:pointer}.badge{padding:2px 6px;border-radius:10px;font-size:11px;background:#25d366;color:#fff}</style></head><body><div class="wrap"><div id="l"><div style="padding:10px;border-bottom:1px solid #ddd"><h3>Klido V210 - Planes COP Anual</h3><div id="loginBox"><input id="le" placeholder="Email empresa"><input id="lp" type="password" placeholder="Pass admin/trabajador"><select id="eid"></select><button onclick="login()">Entrar</button><div id="loginMsg"></div><hr><b>Registrar agencia</b><br><input id="rn" placeholder="Nombre agencia"><input id="re" placeholder="Email admin"><input id="rp" placeholder="Pass admin"><input id="rph" placeholder="Phone ID"><input id="rtk" placeholder="Token"><input id="rw" placeholder="WABA"><select id="rplan"><option value="basico">BÁSICO $420k/año</option><option value="gold">GOLD $1.2M/año (Gmail+IA+Llamadas)</option><option value="premium">PREMIUM $2.4M/año (IA avanzada)</option></select><button onclick="registrar()">Registrar</button><button onclick="pagar()">PAGAR PLAN (activar)</button></div><div id="panelInfo" style="display:none"></div><input id="q" placeholder="Buscar chat" style="width:96%;margin:6px"></div><div id="list" style="flex:1;overflow:auto"></div></div><div id="r"><div id="top" style="padding:10px;background:#f0f2f5;display:flex;justify-content:space-between"><b id="cur">Login requerido</b><div><button onclick="verStats()">Stats</button> <button onclick="document.getElementById('camp').style.display='block'">Campaña</button> <button onclick="document.getElementById('adm').style.display='block'">Admin</button></div></div><div id="msgs"></div><div style="padding:8px;background:#f0f2f5;display:flex;gap:6px"><input id="txt" style="flex:1" placeholder="Mensaje"><button onclick="send()">Enviar</button></div></div></div><div id="camp" style="display:none;position:fixed;top:10%;left:30%;width:40%;background:#fff;padding:20px;border:1px solid #000;border-radius:10px"><h3>Campaña WhatsApp (Gold/Premium)</h3><input id="m1" style="width:100%" placeholder="Mensaje"><input id="nums" style="width:100%" placeholder="Numeros 57300...,57301..."><input type="file" id="file"><br><br><button onclick="enviarCamp()">Enviar</button><button onclick="this.parentElement.style.display='none'">Cerrar</button><div id="campRes"></div></div><div id="adm" style="display:none;position:fixed;top:5%;left:25%;width:50%;background:#fff;padding:20px;border:1px solid #000;border-radius:10px;max-height:90vh;overflow:auto"><h3>Panel Admin</h3><div id="admContent"></div><h4>Agregar trabajador</h4><input id="tn" placeholder="Nombre"><input id="te" placeholder="Email trabajador"><input id="tp" placeholder="Pass"><button onclick="addTrab()">Agregar</button><hr><div id="trabList"></div><button onclick="this.parentElement.style.display='none'">Cerrar</button></div><script>let S={empresa_id:null,user:null,permisos:{}}; async function loadEmpresas(){const r=await fetch('/api/empresas');const emps=await r.json();const sel=document.getElementById('eid');sel.innerHTML='';emps.forEach(e=>{const o=document.createElement('option');o.value=e.empresa_id;o.textContent=e.nombre+' ('+e.plan+(e.activo?' ✅':' 🔒 BLOQ')+')';sel.appendChild(o);});} async function registrar(){const body={nombre:document.getElementById('rn').value,email:document.getElementById('re').value,admin_pass:document.getElementById('rp').value,phone:document.getElementById('rph').value,token:document.getElementById('rtk').value,waba:document.getElementById('rw').value,plan:document.getElementById('rplan').value};const r=await fetch('/api/empresa/registrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();alert(JSON.stringify(j));loadEmpresas();} async function pagar(){const eid=document.getElementById('eid').value;const plan=document.getElementById('rplan').value;const r=await fetch('/api/empresa/pagar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:eid,plan})});const j=await r.json();alert('Plan activado: '+JSON.stringify(j));loadEmpresas();} async function login(){const empresa_id=document.getElementById('eid').value;const email=document.getElementById('le').value;const pass=document.getElementById('lp').value;const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id,email,pass})});const j=await r.json();if(!j.ok){document.getElementById('loginMsg').innerText=j.error + (j.bloqueado?' - PAGA PARA DESBLOQUEAR':'' );return;}S={empresa_id, user:j.user, permisos:j.permisos, plan:j.plan};document.getElementById('cur').innerText=j.user.rol.toUpperCase()+' - '+j.user.nombre+' - Plan '+j.plan.toUpperCase();document.getElementById('panelInfo').style.display='block';document.getElementById('panelInfo').innerHTML='Permisos: '+Object.keys(j.permisos).filter(k=>j.permisos[k]).join(', ');document.getElementById('loginMsg').innerText='OK '+j.user.rol;loadChats();loadTrab();} let curChat=null; async function loadChats(){if(!S.empresa_id||!S.user) return;const r=await fetch('/api/chats/'+S.empresa_id+'/'+S.user.id);const chats=await r.json();const q=document.getElementById('q').value.toLowerCase();const list=document.getElementById('list');list.innerHTML='';chats.filter(c=>!q||c.id.includes(q)).forEach(c=>{const d=document.createElement('div');d.className='it';d.innerHTML='<b>'+c.id+'</b> '+(c.asignado_a?'<small>->'+c.asignado_a+'</small>':'<small>sin asignar</small>')+'<br><small>'+(c.mensajes?.slice(-1)[0]?.texto||'').slice(0,40)+'</small> '+(c.no_leidos?'<span class=badge>'+c.no_leidos+'</span>':'');d.onclick=()=>openChat(c.id);list.appendChild(d);});} async function openChat(id){curChat=id;document.getElementById('cur').innerText=id+' - '+S.user.rol;const r=await fetch('/api/mensajes/'+S.empresa_id+'/'+id);const msgs=await r.json();const m=document.getElementById('msgs');m.innerHTML='';msgs.forEach(x=>{const d=document.createElement('div');d.className='b '+(x.from==='agente'?'a':'c');let h=x.texto;if(x.media_url){if(x.type==='image') h+='<br><img src="'+x.media_url+'" style="max-width:200px">';else if(x.type==='video') h+='<br><video src="'+x.media_url+'" controls style="max-width:220px"></video>';else if(x.type==='audio') h+='<br><audio src="'+x.media_url+'" controls></audio>';else h+='<br><a href="'+x.media_url+'" target=_blank>Archivo</a>';}d.innerHTML=h;m.appendChild(d);});m.scrollTop=m.scrollHeight;await fetch('/api/chat/leido',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:S.empresa_id,chat_id:id})});} async function send(){const t=document.getElementById('txt').value;if(!t||!curChat) return;document.getElementById('txt').value='';await fetch('/api/mensaje/enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:S.empresa_id,chat_id:curChat,texto:t,user_id:S.user.id})});openChat(curChat);} async function verStats(){const r=await fetch('/api/stats/'+S.empresa_id);const j=await r.json();alert(JSON.stringify(j,null,2));} async function loadTrab(){if(!S.empresa_id) return;const r=await fetch('/api/admin/trabajadores/'+S.empresa_id);const us=await r.json();document.getElementById('trabList').innerHTML=us.map(u=>u.rol+' - '+u.nombre+' ('+u.email+') id:'+u.id+' <button onclick="delTrab(\\''+u.id+'\\')">X</button>').join('<br>');document.getElementById('admContent').innerHTML='Usuarios: '+us.length+' / Max: '+(S.permisos?' check plan':'');} async function addTrab(){const eid=S.empresa_id;const admin_email=document.getElementById('le').value;const admin_pass=document.getElementById('lp').value;const nombre=document.getElementById('tn').value;const email=document.getElementById('te').value;const pass=document.getElementById('tp').value;const r=await fetch('/api/admin/trabajador/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:eid,admin_email,admin_pass,nombre,email,pass})});const j=await r.json();alert(JSON.stringify(j));loadTrab();} async function delTrab(id){const eid=S.empresa_id;const admin_email=document.getElementById('le').value;const admin_pass=document.getElementById('lp').value;const r=await fetch('/api/admin/trabajador/del',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:eid,admin_email,admin_pass,trabajador_id:id})});const j=await r.json();alert(JSON.stringify(j));loadTrab();} async function enviarCamp(){const eid=S.empresa_id;const mensaje=document.getElementById('m1').value;let numeros=document.getElementById('nums').value.split(',').map(s=>s.trim()).filter(Boolean);const file=document.getElementById('file').files[0];if(file){const fd=new FormData();fd.append('file',file);const r=await fetch('/api/campana/excel',{method:'POST',body:fd});const j=await r.json();if(j.ok) numeros=j.numeros;}document.getElementById('campRes').innerText='Enviando '+numeros.length;const r2=await fetch('/api/campana/enviar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({empresa_id:eid,numeros,mensaje})});const j2=await r2.json();document.getElementById('campRes').innerText='Enviados '+j2.enviados;} document.getElementById('q').addEventListener('input',loadChats); setInterval(()=>{if(S.empresa_id) loadChats();},4000); loadEmpresas();<\/script></body></html>`;

app.get('/',(req,res)=>res.send(INDEX));
app.listen(process.env.PORT||3000,()=>console.log('KLIDO V210 ROLES + PLANES COP BLOQUEADOS OK'));
