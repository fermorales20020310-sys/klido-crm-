let currentWa=null;
async function loadChats(){
  const r=await fetch('/api/chats'); const chats=await r.json();
  document.getElementById('chat-list').innerHTML=chats.map(c=>`
    <div class="chat-item" onclick="openChat('${c.wa_id}','${c.name}')">
      <div><b>${c.name}</b><br><small>${c.lastMessage||''}</small></div>
      ${c.unread?`<span class="dot ${c.dot}"></span>`:''}
    </div>`).join('');
}
async function openChat(wa_id,name){
  currentWa=wa_id;
  document.getElementById('chat-header').innerHTML=`<b>${name}</b> <small>${wa_id}</small>`;
  const r=await fetch('/api/messages/'+wa_id); const msgs=await r.json();
  document.getElementById('messages').innerHTML=msgs.map(m=>`
    <div class="msg ${m.direction==='in'?'in':'out'}">
      ${m.mediaUrl?`📎 <i>${m.mediaType}</i><br>`:''}${m.text||''}
      ${m.isCampaign?' <small>📢</small>':''}
    </div>`).join('');
}
async function markRead(){ if(!currentWa)return; await fetch('/api/chats/'+currentWa+'/read',{method:'POST'}); loadChats(); }
async function loadTemplates(){
  const r=await fetch('/api/templates'); const t=await r.json();
  document.getElementById('template-select').innerHTML=t.map(x=>`<option value="${x.name}">${x.name}</option>`).join('');
}
async function syncTemplates(){ await fetch('/api/templates/sync'); loadTemplates(); alert('Plantillas sincronizadas de la API'); }
async function loadCampaigns(){
  const r=await fetch('/api/campaigns'); const c=await r.json();
  document.getElementById('camp-list').innerHTML=c.map(x=>`
    <div><b>${x.name}</b> - ${x.status} (${x.sent}/${x.total})
    <button onclick="showHistory(${x.id})">Historial</button>
    <button onclick="sendCampaign(${x.id})">Enviar por API</button></div>`).join('');
}
async function uploadCampaign(){
  const fd=new FormData();
  fd.append('file', document.getElementById('excel-file').files[0]);
  fd.append('name', document.getElementById('camp-name').value);
  fd.append('template_name', document.getElementById('template-select').value);
  const r=await fetch('/api/campaigns/upload',{method:'POST',body:fd});
  const d=await r.json(); alert('Campaña creada: '+d.count); loadCampaigns();
}
async function showHistory(id){
  const r=await fetch('/api/campaigns/'+id); const d=await r.json();
  document.getElementById('camp-history').innerHTML='<h4>Historial</h4>'+d.history.map(h=>`<div>${h.wa_id} - ${h.status}</div>`).join('');
}
async function sendCampaign(id){ await fetch('/api/campaigns/'+id+'/send',{method:'POST'}); alert('Enviada'); loadCampaigns(); }
document.getElementById('tab-chats').onclick=()=>{document.getElementById('chat-list').style.display='block';document.getElementById('camp-panel').style.display='none';};
document.getElementById('tab-camp').onclick=()=>{document.getElementById('chat-list').style.display='none';document.getElementById('camp-panel').style.display='block';loadTemplates();loadCampaigns();};
loadChats(); setInterval(loadChats,5000);
