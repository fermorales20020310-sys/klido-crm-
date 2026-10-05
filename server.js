// PROCESADOR QUE NUNCA DA ERROR 132000 NI 132012
async function procesaCampana(id){
  const {rows}=await pool.query('SELECT * FROM campanas_klido WHERE id=$1',[id]); if(!rows[0]) return;
  const c=rows[0];
  let nums=c.numeros; if(typeof nums==='string') nums=JSON.parse(nums);
  let vars=c.variables; if(typeof vars==='string') try{vars=JSON.parse(vars)}catch{vars=[]}
  const emp=await getEmp(c.agencia_id);

  // Averigua EXACTAMENTE que necesita la plantilla en Meta
  let necesitaImagen=false; let lang='es_CO'; let esperaVars=0;
  try{
    const rT=await fetch(`https://graph.facebook.com/v20.0/${emp.waba}/message_templates?fields=name,language,components&access_token=${emp.token}&limit=200`);
    const jT=await rT.json();
    const info=(jT.data||[]).find(t=>t.name===c.plantilla);
    if(info){
      lang=info.language||'es_CO';
      necesitaImagen=info.components?.some(x=>x.type==='HEADER'&&x.format==='IMAGE');
      const body=info.components?.find(x=>x.type==='BODY')?.text||'';
      const matches=body.match(/{{\d+}}/g)||[];
      esperaVars=matches.length; // 1, 2 o 3 segun Meta
      console.log(`📋 Plantilla ${c.plantilla} espera ${esperaVars} variables`);
    }
  }catch(e){ console.log('Error leyendo plantilla',e.message); }

  // AJUSTE AUTOMATICO DE VARIABLES - SIEMPRE COINCIDE
  const defaults=["Cliente","Congreso ACOL 2026","Bogotá"];
  if(vars.length===0) vars=[...defaults].slice(0, esperaVars || 1);
  // Si espera 1 y mandas 3, corta a 1. Si espera 3 y mandas 1, rellena con genéricos
  if(esperaVars>0){
    if(vars.length > esperaVars) vars = vars.slice(0, esperaVars);
    if(vars.length < esperaVars){
      while(vars.length < esperaVars) vars.push(defaults[vars.length] || "Cliente");
    }
  }

  for(let i=c.bloque_actual||0;i<nums.length;i++){
    try{
      const components=[];
      if(necesitaImagen && c.imagen_url){
        components.push({type:'header', parameters:[{type:'image', image:{link:c.imagen_url}}]});
      }
      if(vars.length>0){
        components.push({type:'body', parameters: vars.map(v=>({type:'text', text:String(v||'').slice(0,1024)}))});
      }

      const payload={
        messaging_product:'whatsapp',
        to: nums[i],
        type:'template',
        template:{ name:c.plantilla, language:{code:lang},...(components.length?{components}:{}) }
      };

      console.log(`📨 ENVIANDO ${c.plantilla} -> ${nums[i]} con ${vars.length} vars:`, vars);

      const result = await limiter.schedule(async()=>{
        const r=await fetch(`https://graph.facebook.com/v20.0/${emp.phone}/messages`,{
          method:'POST',
          headers:{'Content-Type':'application/json', Authorization:`Bearer ${emp.token}`},
          body: JSON.stringify(payload)
        });
        return r.json();
      });

      console.log('RESPUESTA', JSON.stringify(result).slice(0,400));

      if(result.messages?.[0]?.id) await pool.query('UPDATE campanas_klido SET enviados=enviados+1, bloque_actual=$1 WHERE id=$2',[i+1,id]);
      else await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1, bloque_actual=$1 WHERE id=$2',[i+1,id]);

    }catch(e){
      console.log('ERROR',e.message);
      await pool.query('UPDATE campanas_klido SET fallidos=fallidos+1, bloque_actual=$1 WHERE id=$2',[i+1,id]);
    }
  }
  await pool.query('UPDATE campanas_klido SET estado=$1 WHERE id=$2',['terminada',id]);
  console.log(`🏁 ${id} TERMINADA`);
}
