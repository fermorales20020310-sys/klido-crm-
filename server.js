// server.js - KLIDO con Resend (sin tocar diseño)
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

async function sendEmail(to, subject, html){
  // USA RESEND SI EXISTE (Railway ya no bloquea porque es HTTPS)
  if(process.env.RESEND_API_KEY){
    console.log('TRY RESEND TO', to);
    const r = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        'Authorization':'Bearer '+process.env.RESEND_API_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        from: process.env.RESEND_FROM || 'KLIDO CRM <onboarding@resend.dev>',
        to: [to],
        subject,
        html
      })
    });
    const data = await r.json();
    if(!r.ok){
      console.error('RESEND ERR', data);
      throw new Error('Resend: '+JSON.stringify(data));
    }
    console.log('MAIL OK via Resend', data.id, '->', to);
    return data;
  } else {
    throw new Error('Falta RESEND_API_KEY en Railway');
  }
}

// --- RUTAS QUE YA TENIAS ---

// login, register, etc... deja todo igual como lo tenias

app.post('/api/forgot-password', async (req,res)=>{
  console.log('FORGOT REQ', req.body);
  const {email} = req.body;
  if(!email) return res.status(400).json({error:'Email requerido'});
  const clean = email.trim().toLowerCase();
  try{
    const users = await pool.query(`SELECT agency_id FROM users WHERE LOWER(username)=LOWER($1)`, [clean]);
    if(!users.rows.length){
      return res.status(404).json({error:'No registrado: '+clean});
    }
    let count=0;
    for(let u of users.rows){
      const token = crypto.randomBytes(32).toString('hex');
      const expires = Date.now() + 1000*60*15;
      await pool.query(`INSERT INTO password_resets(agency_id,email,token,expires_at) VALUES($1,$2,$3,$4)`, [u.agency_id, clean, token, expires]);
      const link = `https://${req.get('host')}/reset.html?token=${token}`;
      console.log('LINK RESET', link);
      await sendEmail(clean, `Restablecer clave - Agencia ${u.agency_id}`, `
        <div style="font-family:sans-serif;padding:20px">
          <h2>KLIDO CRM</h2>
          <p>Agencia: <b>${u.agency_id}</b></p>
          <p><a href="${link}" style="background:#000;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Cambiar mi clave</a></p>
          <p>${link}</p><p>Expira 15 min</p>
        </div>`);
      count++;
    }
    res.json({ok:true, count});
  }catch(e){
    console.error('MAIL ERR FULL', e.message);
    res.status(500).json({error:e.message});
  }
});

// agrega esta ruta para probar sin usar el forgot
app.get('/api/debug-smtp', async (req,res)=>{
  try{
    await sendEmail(process.env.RESEND_FROM?.match(/<(.+)>/)?.[1] || 'delivered@resend.dev', 'Test KLIDO', 'Test OK '+Date.now());
    res.json({ok:true, msg:'Probado Resend, revisa logs'});
  }catch(e){ res.status(500).json({ok:false, error:e.message}); }
});

// --- DEJA TODAS TUS OTRAS RUTAS ABAJO TAL CUAL ---
// app.post('/api/login'... etc

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('KLIDO en '+PORT));
