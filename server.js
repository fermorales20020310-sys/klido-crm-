import express from 'express';
import pg from 'pg';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Tablas
await pool.query(`
CREATE TABLE IF NOT EXISTS contacts (id SERIAL PRIMARY KEY, phone TEXT UNIQUE, name TEXT, last_msg_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, contact_phone TEXT, from_me BOOLEAN, body TEXT, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, name TEXT, template_name TEXT, status TEXT DEFAULT 'draft', total_contacts INT, sent INT DEFAULT 0, failed INT DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS campaign_contacts (id SERIAL PRIMARY KEY, campaign_id INT REFERENCES campaigns(id) ON DELETE CASCADE, phone TEXT, name TEXT, status TEXT DEFAULT 'pending', error TEXT);
`);

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "klido_verify_123";
const AI_ENABLED = (process.env.AI_ENABLED || "false").toLowerCase() === "true";

// Webhook verify
app.get('/webhook/whatsapp', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

// Webhook receive - MANUAL, ya no responde la IA si AI_ENABLED=false
app.post('/webhook/whatsapp', async (req, res) => {
  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (msg) {
    const phone = msg.from;
    const body = msg.text?.body || `[${msg.type}]`;
    const name = value.contacts?.[0]?.profile?.name || phone;
    await pool.query(`INSERT INTO contacts (phone, name) VALUES ($1,$2) ON CONFLICT (phone) DO UPDATE SET name=$2, last_msg_at=NOW()`, [phone, name]);
    await pool.query(`INSERT INTO messages (contact_phone, from_me, body) VALUES ($1, false, $2)`, [phone, body]);
  }
  res.sendStatus(200);
});

// APIs basicas
app.get('/api/contacts', async (req,res)=>{
  const r = await pool.query(`SELECT * FROM contacts ORDER BY last_msg_at DESC`);
  res.json(r.rows);
});
app.get('/api/messages/:phone', async (req,res)=>{
  const r = await pool.query(`SELECT * FROM messages WHERE contact_phone=$1 ORDER BY created_at ASC LIMIT 200`, [req.params.phone]);
  res.json(r.rows);
});
app.post('/api/send', async (req,res)=>{
  const {phone, body} = req.body;
  await sendWhatsAppText(phone, body);
  await pool.query(`INSERT INTO messages (contact_phone, from_me, body) VALUES ($1,true,$2)`, [phone, body]);
  res.json({ok:true});
});

// --- CAMPAÑAS MASIVAS ---
app.get('/api/campaigns', async (req,res)=>{
  const r = await pool.query(`SELECT * FROM campaigns ORDER BY id DESC`);
  res.json(r.rows);
});

app.post('/api/campaigns/create', async (req,res)=>{
  const {name, template_name, contacts} = req.body; // contacts = [{phone, name}]
  if(!contacts || contacts.length > 2000) return res.status(400).json({error:"Max 2000 contactos"});
  const camp = await pool.query(`INSERT INTO campaigns (name, template_name, total_contacts) VALUES ($1,$2,$3) RETURNING *`, [name, template_name, contacts.length]);
  const campId = camp.rows[0].id;
  for(let c of contacts){
    let cleanPhone = c.phone.replace(/\D/g,'');
    if(!cleanPhone.startsWith('57') && cleanPhone.length==10) cleanPhone = '57'+cleanPhone;
    await pool.query(`INSERT INTO campaign_contacts (campaign_id, phone, name) VALUES ($1,$2,$3)`, [campId, cleanPhone, c.name || '']);
  }
  res.json(camp.rows[0]);
});

app.post('/api/campaigns/:id/start', async (req,res)=>{
  const id = req.params.id;
  const camp = (await pool.query(`SELECT * FROM campaigns WHERE id=$1`, [id])).rows[0];
  if(!camp) return res.status(404).json({error:"No existe"});
  await pool.query(`UPDATE campaigns SET status='running' WHERE id=$1`, [id]);
  res.json({ok:true, msg:"Campaña iniciada en segundo plano"});
  // proceso en background
  runCampaign(id, camp.template_name);
});

async function runCampaign(campaignId, templateName){
  const contacts = (await pool.query(`SELECT * FROM campaign_contacts WHERE campaign_id=$1 AND status='pending'`, [campaignId])).rows;
  for(let c of contacts){
    try{
      await sendWhatsAppTemplate(c.phone, templateName, [c.name || '']);
      await pool.query(`UPDATE campaign_contacts SET status='sent' WHERE id=$1`, [c.id]);
      await pool.query(`UPDATE campaigns SET sent=sent+1 WHERE id=$1`, [campaignId]);
    }catch(e){
      await pool.query(`UPDATE campaign_contacts SET status='failed', error=$1 WHERE id=$2`, [String(e).slice(0,200), c.id]);
      await pool.query(`UPDATE campaigns SET failed=failed+1 WHERE id=$1`, [campaignId]);
    }
    await new Promise(r=>setTimeout(r, 1200)); // 1.2 seg = ~50 por minuto, seguro para Meta
  }
  await pool.query(`UPDATE campaigns SET status='finished' WHERE id=$1`, [campaignId]);
}

async function sendWhatsAppText(phone, body){
  const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_ID}/messages`;
  await fetch(url, {method:'POST', headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type':'application/json'}, body: JSON.stringify({messaging_product:'whatsapp', to:phone, type:'text', text:{body}})});
}
async function sendWhatsAppTemplate(phone, templateName, params){
  const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_ID}/messages`;
  await fetch(url, {method:'POST', headers:{'Authorization':`Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type':'application/json'}, body: JSON.stringify({
    messaging_product:'whatsapp', to:phone, type:'template',
    template:{name:templateName, language:{code:'es_CO'}, components: params?.length? [{type:'body', parameters: params.map(p=>({type:'text', text:p}))}] : []}
  })});
}

app.listen(process.env.PORT || 3000, ()=>console.log('Klido CRM con campañas listo'));
