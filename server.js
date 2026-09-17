const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

async function initDB(){
 try{
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts (
    phone TEXT PRIMARY KEY,
    name TEXT,
    last_message TEXT,
    tag TEXT DEFAULT 'campana',
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    phone TEXT,
    body TEXT,
    from_me BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  // Si la tabla ya existia, le agregamos la columna tag
  await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tag TEXT DEFAULT 'campana'`);
  console.log("DB OK con tags");
 }catch(e){ console.log("DB error", e.message); }
}
initDB();

// VERIFICACION META - ARREGLA EL FORBIDDEN
app.get('/webhook', (req,res)=>{
  const token = process.env.VERIFY_TOKEN || 'klido123';
  if(req.query['hub.verify_token'] === token) return res.send(req.query['hub.challenge']);
  return res.sendStatus(403);
// VERIFICACION META - ACEPTA /webhook Y /webhook/whatsapp
app.get(['/webhook','/webhook/whatsapp'], (req,res)=>{
// RECIBIR MENSAJES - ACEPTA LAS DOS RUTAS
app.post(['/webhook','/webhook/whatsapp'], async (req,res)=>{
  try{
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if(msg){
      const phone = msg.from;
      const body = msg.text?.body || '[media]';
      const name = entry.contacts?.[0]?.profile?.name || phone;
      // Si es por afiliacion detectamos por palabra clave, si no queda como campana (amarillo)
      const tagDetectado = body.toLowerCase().includes('afili')? 'afiliacion' : 'campana';

      await pool.query(`
        INSERT INTO contacts(phone,name,last_message,tag)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(phone) DO UPDATE SET
          last_message=$3, updated_at=NOW(), name=$2,
          tag=CASE WHEN contacts.tag IS NULL THEN $4 ELSE contacts.tag END
      `, [phone,name,body,tagDetectado]);

      await pool.query(`INSERT INTO messages(phone,body,from_me) VALUES($1,$2,false)`, [phone,body]);
    }
  }catch(e){ console.log(e.message); }
  res.sendStatus(200);
});

app.get('/api/contacts', async (req,res)=>{
  const r = await pool.query(`SELECT * FROM contacts ORDER BY updated_at DESC`);
  res.json(r.rows);
});
app.get('/api/messages/:phone', async (req,res)=>{
  const r = await pool.query(`SELECT * FROM messages WHERE phone=$1 ORDER BY created_at ASC`, [req.params.phone]);
  res.json(r.rows);
});
app.post('/api/send', async (req,res)=>{
  const {phone, body} = req.body;
  await axios.post(`https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {messaging_product:'whatsapp', to:phone, text:{body}},
    {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
  await pool.query(`INSERT INTO messages(phone,body,from_me) VALUES($1,$2,true)`, [phone,body]);
  await pool.query(`UPDATE contacts SET last_message=$2, updated_at=NOW() WHERE phone=$1`, [phone,body]);
  res.json({ok:true});
});

// CAMBIAR COLOR MANUALMENTE
app.post('/api/tag', async (req,res)=>{
  const {phone, tag} = req.body;
  await pool.query(`UPDATE contacts SET tag=$2 WHERE phone=$1`, [phone, tag]);
  res.json({ok:true});
});

app.listen(process.env.PORT||3000, ()=>console.log("KLIDO con colores listo"));
