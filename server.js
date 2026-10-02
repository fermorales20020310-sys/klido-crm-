const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'klido_v115_final_2026_gerencia';
const VERIFY_TOKEN = 'klido123';
const ENV_TOKEN = process.env.WHATSAPP_TOKEN || process.env.META_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '';
const ENV_PHONE_ID = process.env.WA_PHONE_ID || process.env.PHONE_ID || process.env.PHONE_NUMBER_ID || '1338474282683914';
let fetchFn = global.fetch; if (!fetchFn) { try { fetchFn = require('node-fetch'); } catch(e) {} }
console.log(`[KLIDO v119 AUTOMATICO] TOKEN=${ENV_TOKEN.length} PHONE=${ENV_PHONE_ID}`);
app.get('/webhook', (req, res) => { const mode = req.query['hub.mode']; const token = req.query['hub.verify_token']; const challenge = req.query['hub.challenge']; if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge); return res.sendStatus(403); });
app.post('/webhook', express.json({limit:'15mb'}), (req, res) => { res.sendStatus(200); });
app.use(express.json({limit:'15mb'})); app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Headers','*'); res.header('Access-Control-Allow-Methods','*'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); }); app.use(express.static(path.join(__dirname,'public')));
const DATA_DIR = path.join(__dirname,'data'); const EMPRESAS_FILE = path.join(DATA_DIR,'empresas.json'); const MENSAJES_DIR = path.join(DATA_DIR,'mensajes'); if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); if(!fs.existsSync(MENSAJES_DIR)) fs.mkdirSync(MENSAJES_DIR,{recursive:true}); if(!fs.existsSync(EMPRESAS_FILE)) fs.writeFileSync(EMPRESAS_FILE,'[]');
function obtenerEmpresas(){ try{ return JSON.parse(fs.readFileSync(EMPRESAS_FILE,'utf8')).map(e=>{ if(!e.waPhoneId) e.waPhoneId=ENV_PHONE_ID; if(!e.waToken) e.waToken=ENV_TOKEN; if(!e.contactos) e.contactos=[]; if(!e.campanas) e.campanas=[]; return e; }); }catch{ return []; } }
function guardarEmpresas(l){ fs.writeFileSync(EMPRESAS_FILE, JSON.stringify(l,null,2)); }
const codigosRegistro = new Map(); const codigosReset = new Map();
function auth(req,res,next){ const t=(req.headers.authorization||'').replace('Bearer ','').trim()||req.query.token||''; if(!t) return res.status(401).json({error:'No token'}); try{ req.user=jwt.verify(t,JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Token vencido'}); } }

// --- LISTA AUTOMATICA DE META ---
app.get('/api/meta/plantillas',auth, async (req,res)=>{
  try{
    const emps=obtenerEmpresas(); const emp=emps.find(e=>e.id===req.user.empresaId||e.id===req.user.id);
    const phoneId=emp?.waPhoneId||ENV_PHONE_ID; const token=emp?.waToken||ENV_TOKEN;
    const r1=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}?fields=whatsapp_business_account`,{headers:{'Authorization':`Bearer ${token}`}});
    const j1=await r1.json(); const wabaId=j1?.whatsapp_business_account?.id;
    if(!wabaId) return res.json({ok:false, error:'No WABA ID'});
    const r2=await fetchFn(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=100`,{headers:{'Authorization':`Bearer ${token}`}});
    const j2=await r2.json(); if(!j2.data) return res.json({ok:false, raw:j2});
    const aprobadas=j2.data.filter(t=>t.status==='APPROVED');
    res.json({ok:true, plantillas:aprobadas});
  }catch(e){ res.json({ok:false, error:e.message}); }
});

// --- LOGIN Y DEMAS IGUAL ---
app.post('/api/login',(req,res)=>{ const {email,password}=req.body; if(email.toLowerCase()==='admin@klido.com'&&password==='Mafe2002@'){ const token=jwt.sign({id:'SUPER',rol:'super'},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{rol:'super'}}); } const emps=obtenerEmpresas(); for(let e of emps){ if(e.email===email.toLowerCase()&&e.password===password){ const token=jwt.sign({id:e.id,rol:'jefe',empresaId:e.id},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{empresaId:e.id,rol:'jefe'}}); } const u=e.equipo.find(u=>u.email===email.toLowerCase()&&u.password===password); if(u){ const token=jwt.sign({id:u.id,rol:u.rol,empresaId:e.id},JWT_SECRET,{expiresIn:'7d'}); return res.json({ok:true,token,user:{empresaId:e.id,rol:u.rol}}); } } return res.status(401).json({error:'Credenciales'}); });
app.get('/api/me',auth,(req,res)=>res.json({ok:true}));
app.get('/api/campanas',auth,(req,res)=>{ const emp=obtenerEmpresas().find(e=>e.id===req.user.empresaId); res.json(emp?.campanas||[]); });

// --- ENVIO AUTOMATICO QUE SI LLEGA ---
app.post('/api/campanas',auth, async (req,res)=>{
  let emps=obtenerEmpresas(); const i=emps.findIndex(e=>e.id===req.user.empresaId); if(i===-1) return res.status(404).json({error:'No empresa'});
  const { nombre, plantilla, plantillaIdioma, lista, contactos, plantillaVars, headerImageUrl } = req.body;
  if(!plantilla) return res.status(400).json({error:'Selecciona plantilla'});
  let listaNorm=(lista||[]).map(x=> typeof x==='object'? {phone:String(x.phone).replace(/\D/g,''), nombre:x.nombre||''} : {phone:String(x).replace(/\D/g,''), nombre:''}).filter(x=>x.phone.length>=10);
  if(listaNorm.length===0) return res.status(400).json({error:'Lista vacía'});
  const camp={id:'camp_'+Date.now(), nombre:nombre||plantilla, plantilla, numeros:listaNorm.length, fecha:new Date().toISOString(), estado:'enviando', enviados:0};
  emps[i].campanas.push(camp); guardarEmpresas(emps);
  console.log(`[CAMPANA AUTO v119] plantilla=${plantilla} idioma=${plantillaIdioma} nums=${listaNorm.length}`);
  res.json({ok:true, campana:camp});

  setTimeout(async ()=>{
    try{
      let emps2=obtenerEmpresas(); const emp=emps2[i]; const phoneId=emp.waPhoneId||ENV_PHONE_ID; const token=emp.waToken||ENV_TOKEN;
      let enviados=0;
      for(const entry of listaNorm){
        const toClean=entry.phone;
        let bodyVars = plantillaVars? String(plantillaVars).split(',').map(s=>s.trim()).filter(Boolean) : [];
        if(bodyVars.length===0 && entry.nombre) bodyVars=[entry.nombre];
        if(bodyVars.length===0) bodyVars=['Cliente'];

        let components=[];
        if(headerImageUrl){ components.push({type:'header', parameters:[{type:'image', image:{link:headerImageUrl}}]}); }
        if(bodyVars.length>0){ components.push({type:'body', parameters:bodyVars.map(t=>({type:'text', text:t}))}); }

        let payload={messaging_product:'whatsapp', to:toClean, type:'template', template:{name:plantilla, language:{code:plantillaIdioma||'es_CO'}, components}};
        // si no hay vars, envia sin components para plantillas simples
        if(components.length===0) payload.template.components=[];

        try{
          const r=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
          const j=await r.json();
          console.log(`[ENVIO] ${toClean} ${plantilla} -> ${r.status} ${JSON.stringify(j).slice(0,500)}`);
          if(r.ok) enviados++;
          // si falla por header, reintenta sin header
          if(!r.ok && headerImageUrl){
             payload.template.components=payload.template.components.filter(c=>c.type!=='header');
             const r2=await fetchFn(`https://graph.facebook.com/v20.0/${phoneId}/messages`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
             const j2=await r2.json(); console.log(`[REINTENTO SIN HEADER] ${toClean} -> ${r2.status}`); if(r2.ok) enviados++;
          }
        }catch(e){ console.log('ERR',e.message); }
        await new Promise(x=>setTimeout(x,1200));
      }
      let emps3=obtenerEmpresas(); const idx=emps3.findIndex(e=>e.id===emp.id); if(idx!==-1){ const cIdx=emps3[idx].campanas.findIndex(c=>c.id===camp.id); if(cIdx!==-1){ emps3[idx].campanas[cIdx].enviados=enviados; emps3[idx].campanas[cIdx].estado='enviada'; guardarEmpresas(emps3);} }
      console.log(`[FINAL v119] ${enviados}/${listaNorm.length}`);
    }catch(e){ console.error(e); }
  },500);
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`KLIDO v119 AUTOMATICO PORT ${PORT}`));
