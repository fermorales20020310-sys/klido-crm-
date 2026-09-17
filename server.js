//... (usa el mismo que te pasé antes pero con este fix en la parte de webhook)
app.post('/webhook', (req,res)=>{
  console.log(JSON.stringify(req.body, null, 2));
  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if(msg){
    const from = msg.from;
    const text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || `[${msg.type}]`;
    const name = value.contacts?.[0]?.profile?.name || from;
    if(!chats[from]) chats[from] = {tel: from, nombre: name, msgs: []};
    chats[from].nombre = name;
    // fix: si msgs eran strings viejos, los limpia
    chats[from].msgs = chats[from].msgs.filter(m=> typeof m === 'object').map(m=>{
      if(typeof m === 'string'){ try{ return JSON.parse(m); }catch(e){ return null; } } return m;
    }).filter(Boolean);
    chats[from].msgs.push({from:'cliente', text, time: new Date().toLocaleString()});
    chats[from].unread = (chats[from].unread || 0) + 1;
    save();
  }
  res.sendStatus(200);
});
app.get('/api/clear', (req,res)=>{ chats={}; save(); res.json({ok:true, cleared:true}); });
